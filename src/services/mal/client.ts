import { getMalToken, getMalRefreshToken, setMalTokens, clearMalTokens, isMalTokenExpired } from '../../storage/mal'
import { refreshMalToken } from './auth'
import { getCache, putCache } from '../../storage/db'
import { MAL_API_BASE } from '../../lib/malConfig'

type MalErrorCode = 'NETWORK' | 'AUTH' | 'NOT_FOUND' | 'UNKNOWN'
export class MalProviderError extends Error {
  code: MalErrorCode
  retryable: boolean
  constructor(code: MalErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'MalProviderError'
    this.code = code
    this.retryable = retryable
  }
}

const MEMORY_TTL = 1000 * 60 * 5
const memoryCache = new Map<string, { value: any; expiry: number }>()
const inflight = new Map<string, Promise<any>>()

function memKey(url: string): string {
  return url
}

async function ensureFreshToken(): Promise<string | null> {
  const token = getMalToken()
  if (!token) return null
  if (!isMalTokenExpired()) return token
  const refresh = getMalRefreshToken()
  if (!refresh) return token // try using it, will fail and be cleared
  try {
    const res = await refreshMalToken(refresh)
    setMalTokens(res.access_token, res.refresh_token ?? refresh, res.expires_in)
    return res.access_token
  } catch {
    clearMalTokens()
    throw new MalProviderError('AUTH', 'MyAnimeList session expired. Please reconnect.', false)
  }
}

export async function malFetch<T>(path: string, opts: RequestInit & { cacheKey?: string; useCache?: boolean; method?: string } = {}): Promise<T> {
  const useCache = opts.useCache ?? (opts.method === undefined || opts.method === 'GET')
  const cacheKey = opts.cacheKey
  const method = opts.method ?? 'GET'
  const url = path.startsWith('http') ? path : `${MAL_API_BASE}${path}`

  const token = await ensureFreshToken()

  // For GET, check cache
  if (useCache && method === 'GET') {
    const mKey = cacheKey ?? memKey(url)
    const hit = memoryCache.get(mKey)
    if (hit && hit.expiry > Date.now()) return hit.value as T
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

  const dedupKey = `${url}::${token ?? 'anon'}::${method}`
  if (inflight.has(dedupKey)) return inflight.get(dedupKey) as Promise<T>

  const p = (async () => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(opts.headers as Record<string, string> ?? {}),
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    let res: Response
    try {
      res = await fetch(url, { ...opts, method, headers })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg) || /CORS/i.test(String(e))) {
        throw new MalProviderError(
          'NETWORK',
          'MyAnimeList blocked the request (CORS). Aeri runs on GitHub Pages with no backend, and the MAL API (api.myanimelist.net / myanimelist.net/v1/oauth2) does not send CORS headers for browser fetches. The token and REST calls will fail from this origin — this is a MAL API limitation for static sites. Your AniList sync still works.',
          false
        )
      }
      throw new MalProviderError('NETWORK', 'Couldn’t reach MyAnimeList. Check your connection.', true)
    }

    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch {}

    if (!res.ok) {
      const msg = json?.message || json?.error || json?.error_description || res.statusText
      if (res.status === 401 || res.status === 403 || (msg && /unauthorized|forbidden|invalid token|not authorized/i.test(msg))) {
        clearMalTokens()
        throw new MalProviderError('AUTH', 'MyAnimeList session expired. Please reconnect.', false)
      }
      if (res.status === 404) throw new MalProviderError('NOT_FOUND', 'We couldn’t find that anime on MyAnimeList.', false)
      if (res.status === 429) throw new MalProviderError('NETWORK', 'MyAnimeList is rate-limited. Try again in a moment.', true)
      if (res.status >= 500) throw new MalProviderError('NETWORK', 'MyAnimeList is temporarily unavailable.', true)
      throw new MalProviderError('UNKNOWN', msg || `MyAnimeList error (${res.status})`, false)
    }

    const data = (json ?? {}) as T
    if (useCache && method === 'GET') {
      const mKey = cacheKey ?? memKey(url)
      memoryCache.set(mKey, { value: data, expiry: Date.now() + MEMORY_TTL })
      if (cacheKey) putCache(cacheKey, data).catch(() => {})
    }
    return data
  })()

  inflight.set(dedupKey, p)
  try { return await p } finally { inflight.delete(dedupKey) }
}

export function clearMalMemoryCache() {
  memoryCache.clear()
  inflight.clear()
}
