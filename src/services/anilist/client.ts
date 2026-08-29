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
  opts?: { token?: string | null; useCache?: boolean; cacheKey?: string; force?: boolean },
): Promise<T> {
  const token = opts?.token ?? getAnilistToken()
  const useCache = opts?.useCache ?? true
  const cacheKey = opts?.cacheKey
  const force = opts?.force ?? false

  const mKey = cacheKey ?? memKey(query, variables)

  // memory cache check
  if (useCache && !force) {
    const hit = memoryCache.get(mKey)
    if (hit && hit.expiry > Date.now()) {
      return hit.value as T
    }
    // IndexedDB cache check (24h)
    if (cacheKey) {
      try {
        const cached = await getCache<T>(cacheKey)
        if (cached) {
          memoryCache.set(mKey, { value: cached, expiry: Date.now() + MEMORY_TTL })
          return cached
        }
      } catch {}
    }
  }

  // deduplicate inflight
  const dedupKey = `${mKey}::${token ?? 'anon'}`
  if (inflight.has(dedupKey)) {
    return inflight.get(dedupKey) as Promise<T>
  }

  const p = (async () => {
    let res: Response
    try {
      res = await fetch(ANILIST_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      })
    } catch (e) {
      throw new ProviderError('NETWORK', 'Couldn’t reach AniList. Check your connection.', true)
    }

    const json = await res.json().catch(() => null)

    if (!res.ok || json?.errors) {
      const msg = json?.errors?.[0]?.message ?? json?.errors?.[0]?.status ?? res.statusText
      const status = res.status
      if (status === 401 || status === 403 || (msg && /unauthorized|forbidden|invalid token/i.test(msg))) {
        // auth expired — clear token so UI can prompt reconnect, but don't throw away silently
        clearAnilistToken()
        throw new ProviderError('AUTH', 'Session expired. Reconnect to AniList.', false)
      }
      if (status === 404) {
        throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
      }
      if (status === 429) {
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
        // fire and forget IDB
        putCache(cacheKey, data).catch(() => {})
      }
    }
    return data
  })()

  inflight.set(dedupKey, p)
  try {
    return await p
  } finally {
    inflight.delete(dedupKey)
  }
}

export function clearAnilistMemoryCache() {
  memoryCache.clear()
  inflight.clear()
}
