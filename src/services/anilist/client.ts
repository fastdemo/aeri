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

// --- Service-status telemetry (D112) — counted classes are TRUE
// unreachability only: network refused/timed out, server errors, or
// AniList's own global API-off 403. Throttles (429/cooldown fast path),
// auth failures and GraphQL errors do NOT mean the service is down. A live
// success resets the streak; a stale-cache rescue is neutral — a fully warm
// cache during an outage is the good case (app working, no down page), and
// uncacheable misses arm the page within two failing requests.
let consecutiveHardFails = 0
let serviceDownNotified = false
const HARD_FAIL_THRESHOLD = 2
export const ANILIST_OUTAGE_RE = /temporarily disabled due to severe stability|temporarily disabled/i

function noteAnilistHardFail(outageReason?: string | null): void {
  consecutiveHardFails += 1
  if (serviceDownNotified) return
  if (consecutiveHardFails < HARD_FAIL_THRESHOLD && !outageReason) return
  serviceDownNotified = true
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('aeri:service-down', { detail: { service: 'anilist', reason: outageReason ?? null } }))
    } catch {}
  }
}

function noteAnilistOk(): void {
  consecutiveHardFails = 0
  if (!serviceDownNotified) return
  serviceDownNotified = false
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('aeri:service-up', { detail: { service: 'anilist' } })) } catch {}
  }
}

export function isAnilistServiceDown(): boolean {
  return serviceDownNotified
}

/** Self-heal probe: one tiny live query. True = AniList's API answers with
 *  real data again (the success path resets the streak and lifts the app's
 *  down state); false = still down (the caller keeps its page). */
export async function anilistServiceProbe(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query { Page(perPage: 1) { media(sort: TRENDING_DESC) { id } } }', variables: {} }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    const json = await res.json().catch(() => null as any)
    const alive = res.ok && json?.data != null && !json?.errors && !ANILIST_OUTAGE_RE.test(String(json?.errors?.[0]?.message ?? ''))
    if (alive) noteAnilistOk()
    return alive
  } catch {
    return false
  }
}

export function getAnilistStats() {
  return { ...stats, cooldownUntil: rateLimitedUntil }
}

/** True while the shared 429 cooldown is armed. Decorative fetches (related
 * second-hop enrichment) check this and defer to cache-only behavior so a
 * throttle window is never spent on non-critical requests. */
export function isAnilistCooling(): boolean {
  return Date.now() < rateLimitedUntil
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
        noteAnilistHardFail()
        throw new ProviderError('NETWORK', 'AniList is taking too long to respond. Showing cached content where available.', true)
      }
      const stale = await readStale()
      if (stale !== null) return stale
      noteAnilistHardFail()
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
      if (status === 401 || (msg && /unauthorized|invalid token|not authorized/i.test(msg))) {
        clearAnilistToken()
        throw new ProviderError('AUTH', 'Session expired. Reconnect to AniList.', false)
      }
      if (status === 403 || (msg && ANILIST_OUTAGE_RE.test(msg))) {
        // AniList's global API-off outage answers 403 with
        // "The AniList API has been temporarily disabled due to severe
        // stability issues." (cloudflare-served, origin-independent). That is
        // a SERVICE outage — not the user's session — so the token stays.
        // Counted as a hard fail; an explicit operator message arms the app's
        // down state immediately (single request, no threshold needed).
        const explicit = ANILIST_OUTAGE_RE.test(msg)
        noteAnilistHardFail(explicit ? 'AniList’s API is temporarily disabled by its operator (severe stability issues).' : null)
        const stale = await readStale()
        if (stale !== null) return stale
        throw new ProviderError('NETWORK', 'AniList’s API is offline right now — a service-side outage, not a problem on your end.', true)
      }
      if (status === 404) {
        throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
      }
      if (isServerError) {
        noteAnilistHardFail()
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
    noteAnilistOk()
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

/** Publish a response into BOTH cache layers (memory + IDB) under a key, so
 *  later per-key reads (e.g. `anilist:bymal:anime:<id>`) resolve from cache
 *  with zero network. Value must be the exact shape callers read back.
 *  D111: the batched by-MAL lookup uses this — one request resolves the
 *  whole tracker list and every per-id key carries its answer (positive or
 *  definitive negative), so per-entry lookups become cache hits instantly
 *  and repeat visits never re-ask. */
export async function anilistCachePut(key: string, value: unknown): Promise<void> {
  if (!key) return
  memoryCache.set(key, { value, expiry: Date.now() + MEMORY_TTL })
  if (memoryCache.size > MEMORY_MAX) {
    const oldest = memoryCache.keys().next().value as string | undefined
    if (oldest !== undefined) memoryCache.delete(oldest)
  }
  try { await putCache(key, value) } catch {}
}
