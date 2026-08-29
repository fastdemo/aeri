import { getCache, putCache } from '../../storage/db'

const MEMORY_TTL = 1000 * 60 * 5
const memoryCache = new Map<string, { value: any; expiry: number }>()
const inflight = new Map<string, Promise<any>>()

export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>, useCache = true): Promise<T> {
  if (useCache) {
    const hit = memoryCache.get(key)
    if (hit && hit.expiry > Date.now()) return hit.value as T
    try {
      const cached = await getCache<T>(key)
      if (cached) {
        memoryCache.set(key, { value: cached, expiry: Date.now() + MEMORY_TTL })
        return cached
      }
    } catch {}
  }
  if (inflight.has(key)) return inflight.get(key) as Promise<T>
  const p = (async () => {
    const data = await fetcher()
    if (useCache) {
      memoryCache.set(key, { value: data, expiry: Date.now() + MEMORY_TTL })
      putCache(key, data).catch(() => {})
    }
    return data
  })()
  inflight.set(key, p)
  try { return await p } finally { inflight.delete(key) }
}

export function clearVideoMemoryCache() {
  memoryCache.clear()
  inflight.clear()
}

export function isCorsError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /Failed to fetch|NetworkError|Load failed|CORS|ERR_FAILED/i.test(msg)
}
