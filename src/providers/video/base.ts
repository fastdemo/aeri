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

export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>, useCache = true, ttlMs?: number): Promise<T> {
  if (useCache) {
    const hit = memoryCache.get(key)
    if (hit && hit.expiry > Date.now()) return hit.value as T
    // If memory miss but we have a cached empty negative entry that is stale, we still want to try network for retry
    // Manual retry can call clearVideoMemoryCache() + deleteCache(key) to force network.
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
      const isEmptyArray = Array.isArray(data) && (data as any).length === 0
      const memTtl = isEmptyArray ? 1000 * 60 * 2 : MEMORY_TTL // 2m for empty (negative cache), 5m for success
      const idbTtl = ttlMs ?? (isEmptyArray ? 1000 * 60 * 5 : 1000 * 60 * 60) // 5m vs 1h for video
      memoryCache.set(key, { value: data, expiry: Date.now() + memTtl })
      if (!isEmptyArray || ttlMs !== undefined) {
        putCache(key, data, idbTtl).catch(() => {})
      } else {
        // Don't persist empty long-term, but keep short negative cache for 5m to avoid spam
        putCache(key, data, 1000 * 60 * 5).catch(() => {})
      }
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

export function deleteVideoCache(key: string) {
  memoryCache.delete(key)
  inflight.delete(key)
}

export function isCorsError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /Failed to fetch|NetworkError|Load failed|CORS|ERR_FAILED/i.test(msg)
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = VIDEO_PROVIDER_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort((externalSignal as any).reason)
    else externalSignal.addEventListener('abort', () => controller.abort((externalSignal as any).reason), { once: true })
  }
  try {
    const res = await fetch(input, { ...init, signal: controller.signal })
    return res
  } catch (e) {
    if ((e as any)?.name === 'AbortError') {
      if (externalSignal?.aborted) throw e
      throw new Error(`Provider timeout after ${timeoutMs}ms`)
    }
    throw e
  } finally {
    clearTimeout(id)
  }
}
