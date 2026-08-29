import { getCache, putCache } from '../../storage/db'

const MEMORY_TTL = 1000 * 60 * 5
const memoryCache = new Map<string, { value: any; expiry: number }>()
const inflight = new Map<string, Promise<any>>()

// Video providers on GitHub Pages are mostly CORS-blocked/DNS-failed/Cloudflare.
// Each provider fetch is bounded so Watch does not appear frozen for tens of seconds.
// Timeout 3500ms was chosen after Playwright profiling: CORS/DNS failures typically
// resolve in 200-800ms (preflight 405) or 1-2s (DNS), but we bound at 3.5s to handle slow networks
// without making the user wait through a sequential chain of 6×3.5s = 21s.
export const VIDEO_PROVIDER_TIMEOUT_MS = 3500

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

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = VIDEO_PROVIDER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(input, { ...init, signal: controller.signal })
    return res
  } catch (e) {
    if ((e as any)?.name === 'AbortError') {
      throw new Error(`Provider timeout after ${timeoutMs}ms`)
    }
    throw e
  } finally {
    clearTimeout(id)
  }
}
