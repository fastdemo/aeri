import { getMalToken, getMalRefreshToken, setMalTokens, clearMalTokens, isMalTokenExpired } from '../../storage/mal'
import { refreshMalToken } from './auth'
import { getCache, putCache } from '../../storage/db'
import { MAL_API_BASE } from '../../lib/malConfig'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

function getMalWorkerBase(): string | null {
  try {
    const base = getEffectiveVideoApiUrl()
    return base ? base.replace(/\/$/, '') : null
  } catch { return null }
}

function buildMalUrls(path: string): string[] {
  const direct = path.startsWith('http') ? path : `${MAL_API_BASE}${path}`
  const workerBase = getMalWorkerBase()
  if (!workerBase) return [direct]
  // Worker expects /mal/api/<path without leading domain>
  // path is like /users/@me?fields=...  or https://api.myanimelist.net/v2/...
  let workerPath = path
  if (workerPath.startsWith('http')) {
    try {
      const u = new URL(workerPath)
      // strip /v2 prefix if present
      workerPath = u.pathname.replace(/^\/v2\//, '/').replace(/^\//, '/') + u.search
      if (!workerPath.startsWith('/')) workerPath = '/' + workerPath
    } catch { workerPath = path }
  }
  if (!workerPath.startsWith('/')) workerPath = '/' + workerPath
  // Ensure worker path is /mal/api/<rest>
  const workerUrl = `${workerBase}/mal/api${workerPath}`
  return [workerUrl, direct]
}

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

    const urls = buildMalUrls(path)

    let res: Response | null = null
    let lastError: any = null
    for (const tryUrl of urls) {
      try {
        const ctrl = new AbortController()
        const tid = setTimeout(() => ctrl.abort(), 8000)
        const sig = (opts as any).signal
        if (sig) {
          if (sig.aborted) ctrl.abort((sig as any).reason)
          else sig.addEventListener('abort', () => ctrl.abort((sig as any).reason), { once: true })
        }
        try {
          // For worker we need to ensure path is correctly prefixed; for direct we use original url
          res = await fetch(tryUrl, { ...opts, method, headers, signal: ctrl.signal })
        } finally { clearTimeout(tid) }
        // If we got a response, even 4xx, we stop trying (worker gave us a real response with CORS)
        break
      } catch (e) {
        lastError = e
        const msg = e instanceof Error ? e.message : String(e)
        const isCors = /Failed to fetch|NetworkError|Load failed|CORS/i.test(msg) || /CORS/i.test(String(e))
        const isAbort = (e as any)?.name === 'AbortError'
        if (isCors && !isAbort && tryUrl !== urls[urls.length - 1]) {
          // try next URL (worker -> direct)
          continue
        }
        if (isAbort) throw new MalProviderError('NETWORK', 'MyAnimeList request timed out after 8s', true)
        if (isCors) {
          throw new MalProviderError(
            'NETWORK',
            'MyAnimeList blocked the request (CORS). Configure a worker via Settings → Playback Sources → Custom video endpoint (same worker proxies MAL), or test from a non-GH Pages origin. AniList still works as it sends CORS headers.',
            false
          )
        }
        throw new MalProviderError('NETWORK', 'Couldn’t reach MyAnimeList. Check your connection.', true)
      }
    }
    if (!res) {
      if (lastError) throw lastError
      throw new MalProviderError('NETWORK', 'Couldn’t reach MyAnimeList.', true)
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
