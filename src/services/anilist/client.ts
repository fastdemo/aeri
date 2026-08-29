import { getAnilistToken, clearAnilistToken } from '../../storage/anilist'
import { getCache, putCache } from '../../storage/db'
import { ProviderError } from './errors'
import { ANILIST_GRAPHQL } from '../../lib/anilistConfig'

const MEMORY_TTL = 1000 * 60 * 5 // 5 min
const memoryCache = new Map<string, { value: any; expiry: number }>()
const inflight = new Map<string, Promise<any>>()

function memKey(query: string, vars: any): string {
  return `${query.slice(0, 120)}::${JSON.stringify(vars ?? {})}`
}

export async function anilistGraphQL<T>(
  query: string,
  variables?: Record<string, any>,
  opts?: { token?: string | null; useCache?: boolean; cacheKey?: string; force?: boolean; signal?: AbortSignal },
): Promise<T> {
  const token = opts?.token ?? getAnilistToken()
  const useCache = opts?.useCache ?? true
  const cacheKey = opts?.cacheKey
  const force = opts?.force ?? false
  const externalSignal = opts?.signal

  const mKey = cacheKey ?? memKey(query, variables)
  void `${mKey}::${token ?? 'anon'}`

  // Memory hit fast path (no inflight)
  if (useCache && !force) {
    const hit = memoryCache.get(mKey)
    if (hit && hit.expiry > Date.now()) {
      return hit.value as T
    }
  }

  // Deduplicate inflight — disabled for StrictMode compatibility (would share aborted promise)
  // if (inflight.has(dedupKey)) {
  //   return inflight.get(dedupKey) as Promise<T>
  // }
  void inflight

  const p = (async () => {
    // IDB check after dedupe (so concurrent callers share same IDB+fetch promise)
    if (useCache && !force && cacheKey) {
      try {
        const cached = await getCache<T>(cacheKey)
        if (cached) {
          memoryCache.set(mKey, { value: cached, expiry: Date.now() + MEMORY_TTL })
          return cached
        }
      } catch {}
      if (externalSignal?.aborted) throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError')
    }

    let res: Response
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort((externalSignal as any).reason)
      else externalSignal.addEventListener('abort', () => controller.abort((externalSignal as any).reason), { once: true })
    }
    try {
      res = await fetch(ANILIST_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        if (externalSignal?.aborted) throw e
        throw new ProviderError('NETWORK', 'AniList is taking too long to respond. Showing cached content where available.', true)
      }
      throw new ProviderError('NETWORK', 'Couldn’t reach AniList. Check your connection.', true)
    } finally {
      clearTimeout(timeoutId)
    }

    const json = await res.json().catch(() => null)

    if (!res.ok || json?.errors) {
      const msg = json?.errors?.[0]?.message ?? json?.errors?.[0]?.status ?? res.statusText
      const status = res.status
      if (status === 401 || status === 403 || (msg && /unauthorized|forbidden|invalid token/i.test(msg))) {
        clearAnilistToken()
        throw new ProviderError('AUTH', 'Session expired. Reconnect to AniList.', false)
      }
      if (status === 404) {
        throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
      }
      if (status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '2') * 1000 || 2000
        if (!externalSignal?.aborted) {
          await new Promise(r => setTimeout(r, Math.min(retryAfter, 5000)))
          if (externalSignal?.aborted) throw new ProviderError('NETWORK', 'AniList is rate-limited. Try again in a moment.', true)
          try {
            const retryController = new AbortController()
            const retryTimeout = setTimeout(() => retryController.abort(), 8000)
            if (externalSignal) {
              if (externalSignal.aborted) retryController.abort((externalSignal as any).reason)
              else externalSignal.addEventListener('abort', () => retryController.abort((externalSignal as any).reason), { once: true })
            }
            const retryRes = await fetch(ANILIST_GRAPHQL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ query, variables }),
              signal: retryController.signal,
            })
            clearTimeout(retryTimeout)
            const retryJson = await retryRes.json().catch(() => null)
            if (retryRes.ok && !retryJson?.errors) {
              const data = retryJson.data as T
              if (useCache) {
                memoryCache.set(mKey, { value: data, expiry: Date.now() + MEMORY_TTL })
                if (cacheKey) putCache(cacheKey, data).catch(() => {})
              }
              return data
            }
          } catch {}
        }
        throw new ProviderError('NETWORK', 'AniList is rate-limited. Try again in a moment.', true)
      }
      if (status >= 500) {
        throw new ProviderError('NETWORK', 'AniList is temporarily unavailable.', true)
      }
      throw new ProviderError('UNKNOWN', msg || `AniList error (${status})`, false)
    }

    const data = json.data as T
    if (useCache) {
      memoryCache.set(mKey, { value: data, expiry: Date.now() + MEMORY_TTL })
      if (cacheKey) {
        putCache(cacheKey, data).catch(() => {})
      }
    }
    return data
  })()

  // inflight.set(dedupKey, p)
  try {
    return await p
  } finally {
    // inflight.delete(dedupKey)
  }
}

export function clearAnilistMemoryCache() {
  memoryCache.clear()
  inflight.clear()
}
