import { getAnilistToken, clearAnilistToken } from '../../storage/anilist'
import { getCache, putCache } from '../../storage/db'
import { ProviderError } from './errors'
import { ANILIST_GRAPHQL } from '../../lib/anilistConfig'

const MEMORY_TTL = 1000 * 60 * 5 // 5 min
const MEMORY_MAX = 400 // bound: public metadata only, evict oldest first
const memoryCache = new Map<string, { value: any; expiry: number }>()
const inflight = new Map<string, Promise<any>>()

// --- Rate-limit state (AniList temporarily 30 req/min + burst limiter) ---
// A single shared cooldown: one 429 parks ALL AniList traffic until the
// server says to resume, so one throttle never becomes five more requests.
let rateLimitedUntil = 0

// --- Diagnostics (no tokens, no user data — counters only) ---
const stats = {
  requests: 0, // network fetches actually sent
  memoryHits: 0,
  idbHits: 0,
  dedupHits: 0, // concurrent callers sharing one in-flight fetch
  status429: 0,
  cooldownSkips: 0, // fetches avoided during cooldown
  staleServed: 0, // stale cache served instead of a doomed fetch
  lastRemaining: null as number | null,
  cooldownUntil: 0,
}

export function getAnilistStats() {
  return { ...stats, cooldownUntil: rateLimitedUntil }
}

function memKey(query: string, vars: any): string {
  return `${query.slice(0, 120)}::${JSON.stringify(vars ?? {})}`
}

function abortRace<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal || signal.aborted !== true) {
    if (!signal) return p
    if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true })
    }),
  ])
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

  // Memory hit fast path (counts even when shared across components)
  if (useCache && !force) {
    const hit = memoryCache.get(mKey)
    if (hit && hit.expiry > Date.now()) {
      stats.memoryHits += 1
      return hit.value as T
    }
  }

  // StrictMode-safe inflight dedup: concurrent callers for the same resource
  // share ONE network promise. Each caller races its own abort signal, so one
  // unmounted component never cancels the fetch others are waiting on — the
  // underlying request runs on its own timeout controller only.
  // NOTE: dedup covers cache MISSES only (memory/IDB are checked outside).
  // Two mounts racing on a cold id BOTH miss memory, BOTH miss IDB, then meet
  // here: the second joins the first's fetch instead of sending its own.
  const dedupKey = `${mKey}::${token ?? 'anon'}`
  const shared = inflight.get(dedupKey)
  if (useCache && !force && shared) {
    stats.dedupHits += 1
    return abortRace(shared as Promise<T>, externalSignal)
  }

  // Stale lookup helper: expired memory entry or IDB copy, served when the
  // network is unavailable or throttled (never invented — only real data).
  const readStale = async (): Promise<T | null> => {
    if (!useCache || !cacheKey) {
      const hit = memoryCache.get(mKey)
      if (hit) { stats.staleServed += 1; return hit.value as T }
      return null
    }
    const hit = memoryCache.get(mKey)
    if (hit) { stats.staleServed += 1; return hit.value as T }
    try {
      const cached = await getCache<T>(cacheKey)
      if (cached) {
        memoryCache.set(mKey, { value: cached, expiry: Date.now() }) // stale marker
        stats.idbHits += 1
        stats.staleServed += 1
        return cached
      }
    } catch {}
    return null
  }

  // Cooldown fast path: while rate-limited, NEVER hit the network — serve
  // stale cache or fail with a machine-readable THROTTLED error (no request
  // is sent). UI layers must treat THROTTLED as "keep showing cached data,
  // never surface a countdown to the user during normal browsing".
  if (Date.now() < rateLimitedUntil) {
    const stale = await readStale()
    if (stale !== null) return stale
    stats.cooldownSkips += 1
    throw new ProviderError('THROTTLED', 'AniList is temporarily busy. Showing cached content.', true)
  }

  const p = (async () => {
    // IDB check after dedupe (so concurrent callers share same IDB+fetch promise)
    if (useCache && !force && cacheKey) {
      try {
        const cached = await getCache<T>(cacheKey)
        if (cached) {
          memoryCache.set(mKey, { value: cached, expiry: Date.now() + MEMORY_TTL })
          stats.idbHits += 1
          return cached
        }
      } catch {}
    }

    let res: Response
    // The shared fetch runs on its own timeout controller ONLY — individual
    // caller aborts race in abortRace() above and never kill it for others.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    stats.requests += 1
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
        // Underlying timeout (not a caller abort — callers can't reach this
        // controller): serve stale before failing.
        const stale = await readStale()
        if (stale !== null) return stale
        throw new ProviderError('NETWORK', 'AniList is taking too long to respond. Showing cached content where available.', true)
      }
      const stale = await readStale()
      if (stale !== null) return stale
      throw new ProviderError('NETWORK', 'Couldn’t reach AniList. Check your connection.', true)
    } finally {
      clearTimeout(timeoutId)
    }

    // Track the server's burst signal for diagnostics (never logged per-user).
    try {
      const rem = res.headers.get('X-RateLimit-Remaining') ?? res.headers.get('x-ratelimit-remaining')
      if (rem !== null) {
        const n = Number(rem)
        if (Number.isFinite(n)) { stats.lastRemaining = n }
      }
    } catch {}

    const json = await res.json().catch(() => null)

    if (!res.ok || json?.errors) {
      const rawMsg = json?.errors?.[0]?.message ?? json?.errors?.[0]?.status ?? res.statusText
      const msg = typeof rawMsg === 'string' ? rawMsg : String(rawMsg ?? '')
      const status = res.status
      const errStatus = (json?.errors?.[0] as any)?.status
      // AniList sometimes returns 200 with errors: { message: "Something went horribly wrong", status: 500 }
      // Treat any 500 as transient network, not UNKNOWN
      const isServerError = status >= 500 || errStatus === 500 || errStatus === '500' || /horribly wrong/i.test(msg) || /internal server/i.test(msg)
      if (status === 401 || status === 403 || (msg && /unauthorized|forbidden|invalid token/i.test(msg))) {
        clearAnilistToken()
        throw new ProviderError('AUTH', 'Session expired. Reconnect to AniList.', false)
      }
      if (status === 404) {
        throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
      }
      if (isServerError) {
        throw new ProviderError('NETWORK', 'AniList is temporarily unavailable. Please try again in a moment.', true)
      }
      if (status === 429) {
        stats.status429 += 1
        // Honor the server's signals: Retry-After wins, else X-RateLimit-Reset,
        // else a conservative 60s. ONE shared cooldown for all queries — every
        // other caller fails fast or serves stale until it expires. No retry:
        // retrying a 429 is what turns one throttle into a storm.
        let waitMs = 60000
        const retryAfter = res.headers.get('Retry-After') ?? res.headers.get('retry-after')
        const reset = res.headers.get('X-RateLimit-Reset') ?? res.headers.get('x-ratelimit-reset')
        if (retryAfter !== null && Number.isFinite(Number(retryAfter))) {
          waitMs = Math.min(Math.max(Number(retryAfter) * 1000, 1000), 120000)
        } else if (reset !== null && Number.isFinite(Number(reset))) {
          const resetMs = Number(reset) * 1000
          // Reset may be epoch seconds or seconds-until-reset; handle both.
          waitMs = resetMs > Date.now() - 60000
            ? Math.min(Math.max(resetMs - Date.now(), 1000), 120000)
            : Math.min(Math.max(Number(reset) * 1000, 1000), 120000)
        }
        rateLimitedUntil = Date.now() + waitMs
        stats.cooldownUntil = rateLimitedUntil
        const stale = await readStale()
        if (stale !== null) return stale
        throw new ProviderError('THROTTLED', 'AniList is temporarily busy. Showing cached content.', true)
      }
      if (status >= 500) {
        throw new ProviderError('NETWORK', 'AniList is temporarily unavailable.', true)
      }
      throw new ProviderError('UNKNOWN', msg || `AniList error (${status})`, false)
    }

    const data = json.data as T
    if (useCache) {
      memoryCache.set(mKey, { value: data, expiry: Date.now() + MEMORY_TTL })
      if (memoryCache.size > MEMORY_MAX) {
        const oldest = memoryCache.keys().next().value as string | undefined
        if (oldest !== undefined) memoryCache.delete(oldest)
      }
      if (cacheKey) {
        putCache(cacheKey, data).catch(() => {})
      }
    }
    return data
  })()

  // inflight.set(dedupKey, p)
  if (useCache && !force) inflight.set(dedupKey, p)
  try {
    return await abortRace(p, externalSignal)
  } finally {
    // inflight.delete(dedupKey)
    if (inflight.get(dedupKey) === p) inflight.delete(dedupKey)
  }
}

export function clearAnilistMemoryCache() {
  memoryCache.clear()
  inflight.clear()
}
