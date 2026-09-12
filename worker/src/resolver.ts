/**
 * In-worker stream resolver + signed delivery (replaces the Fly `aeri-stream` service).
 *
 * Why this exists: the worker can resolve source URLs but historically needed a
 * clean-egress host to fetch bytes. Live probes (2026-09-10) proved Cloudflare
 * edge reaches every upstream in the current pipeline with REAL data
 * (aniwaves.ru filter/ajax, anikotoapi.site series JSON, megaplay getSourcesNew
 * returning real file+tracks), so resolution AND delivery run here, in-process.
 *
 * Security model (same as the Fly service it replaces):
 * - /api/stream carries HMAC-signed, expiring tokens minted ONLY by the
 *   in-worker resolve path. No token = no fetch. Hostnames are allowlisted,
 *   https-only, private IPs rejected (DoH check, fail-closed).
 * - RESOLVER_SECRET lives only in worker secrets; the browser never sees it.
 * - No DRM/auth/CAPTCHA/Turnstile bypass: plain HTTP fetches of the provider's
 *   public JSON APIs + CDN playlist/segments with the provider's normal
 *   Referer. Anything requiring a challenge fails closed.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const TOKEN_TTL_S = 6 * 3600
const FETCH_TIMEOUT_MS = 12000

// Hosts this resolver may fetch playlists/segments/subtitles from. Suffix
// rules cover CDN rotations (mikora/akirax/shiora…); megap* covers future
// megaplay edge hosts. Nothing else is fetchable via /api/stream.
const CDN_SUFFIXES = [
  'imgnex.top',
  'mikora.top',
  'akirax.buzz',
  'shiora.site',
  'megaplay.buzz',
  'megap.shiora.site',
  'anikototv.to',
  'anikotoapi.site',
  'vidnest.fun',
  'aniwaves.ru',
  'echovideo.ru',
  'echovideo.to',
  'play.echovideo.ru',
  'st2.dpopdrop89.store',
]
const CDN_REGEXES = [
  /^megap[a-z0-9-]*\.[a-z0-9.-]+$/i,
  /^st\d+\.[a-z0-9-]+\.store$/i,
  // dood file-CDN rotation (st2./px.dpopdrop89.store, ...)
  /^[a-z0-9-]+\.dpopdrop\d+\.store$/i,
  // echovideo file-CDN rotation (st2./px.roburnt10.store, roburnd*, ...)
  /^[a-z0-9-]+\.roburn[a-z0-9-]*\.store$/i,
  /^hls[a-z0-9-]*\.echovideo\.(to|ru)$/i,
  /^[a-z0-9-]+\.imgnex\.top$/i,
]

export interface ResolveContext {
  secret: string
  publicOrigin: string
}

// Per-request context (constant per deployment; module state shared across
// concurrent requests is safe — mirrors the previous setResolverConfig pattern).
let resolveCtx: ResolveContext | null = null
export function setResolveContext(ctx: ResolveContext | null) {
  resolveCtx = ctx && ctx.secret ? { secret: ctx.secret, publicOrigin: ctx.publicOrigin.replace(/\/$/, '') } : null
}
export function getResolveContext(): ResolveContext | null {
  return resolveCtx
}

const log = (obj: Record<string, unknown>) => {
  try { console.log(JSON.stringify({ t: new Date().toISOString(), ...obj })) } catch {}
}

// ---------- crypto (SubtleCrypto; no Node APIs) ----------

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(u: string): string {
  const b64 = u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (u.length % 4)) % 4)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

let keyCache: { secret: string; key: CryptoKey | null } = { secret: '', key: null }
async function hmacKey(secret: string): Promise<CryptoKey> {
  if (keyCache.key && keyCache.secret === secret) return keyCache.key
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  keyCache = { secret, key }
  return key
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function signToken(secret: string, url: string, exp: number): Promise<{ u: string; e: string; s: string }> {
  const u = b64urlEncode(url)
  const e = String(exp)
  const s = await hmacHex(secret, `${u}.${e}`)
  return { u, e, s }
}

async function verifyToken(secret: string, u: string | null, e: string | null, s: string | null): Promise<string | null> {
  try {
    if (!secret || !u || !e || !s) return null
    const exp = Number(e)
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null
    const want = await hmacHex(secret, `${u}.${e}`)
    if (!constEq(String(s), want)) return null
    const url = b64urlDecode(String(u))
    if (!/^https:\/\//.test(url) || url.length > 2048) return null
    return url
  } catch { return null }
}

// ---------- allowlist + SSRF guard ----------

export function hostAllowed(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  for (const sfx of CDN_SUFFIXES) {
    if (h === sfx || h.endsWith('.' + sfx)) return true
  }
  return CDN_REGEXES.some((re) => re.test(h))
}

function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true
  return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || p[0] === 0
}

function ipv6Private(ip: string): boolean {
  return /^(::1|::ffff:127\.|fe80|fc00|fd00)/i.test(ip)
}

const dnsCache = new Map<string, { at: number; priv: boolean }>()
const DNS_CACHE_TTL_MS = 5 * 60 * 1000

async function isPrivateHost(hostname: string): Promise<boolean> {
  // Best-effort SSRF guard against DNS rebinding to internal ranges.
  // Workers have no node:dns — resolve via DNS-over-HTTPS, fail closed.
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return ipv4Private(h)
  if (h.includes(':')) return ipv6Private(h)
  const now = Date.now()
  const hit = dnsCache.get(h)
  if (hit && now - hit.at < DNS_CACHE_TTL_MS) return hit.priv
  const doh = async (type: string): Promise<string[]> => {
    try {
      const r = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(h)}&type=${type}`,
        { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000) },
      )
      if (!r.ok) return []
      const j: any = await r.json().catch(() => null)
      return Array.isArray(j?.Answer) ? j.Answer.map((a: any) => String(a?.data || '')) : []
    } catch { return [] }
  }
  try {
    const [aRecs, aaaaRecs] = await Promise.all([doh('A'), doh('AAAA')])
    const addrs = [...aRecs, ...aaaaRecs].map((s) => s.replace(/\.$/, ''))
    let priv = true
    if (addrs.length) {
      priv = addrs.some((ip) => (ip.includes(':') ? ipv6Private(ip) : /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ipv4Private(ip) : true))
    }
    dnsCache.set(h, { at: now, priv })
    if (dnsCache.size > 1000) {
      const oldest = dnsCache.keys().next().value as string | undefined
      if (oldest !== undefined) dnsCache.delete(oldest)
    }
    return priv
  } catch { return true }
}

// ---------- upstream fetch ----------

async function fetchUpstream(
  url: string,
  opts: { headers?: Record<string, string>; range?: string | null; timeoutMs?: number; signal?: AbortSignal | null } = {},
): Promise<Response> {
  const { headers = {}, range, timeoutMs = FETCH_TIMEOUT_MS, signal } = opts
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(new Error('upstream timeout')), timeoutMs)
  const onAbort = () => {
    try { ctrl.abort((signal as any)?.reason ?? new DOMException('Aborted', 'AbortError')) } catch {}
  }
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const h: Record<string, string> = { 'User-Agent': UA, ...headers }
    if (range) h.Range = range
    return await fetch(url, { headers: h, signal: ctrl.signal, redirect: 'follow' })
  } finally {
    clearTimeout(tid)
    if (signal) signal.removeEventListener?.('abort', onAbort)
  }
}

function contentTypeFor(url: string, upstreamCt: string | null): string {
  if (upstreamCt && !/text\/html/i.test(upstreamCt)) return upstreamCt.split(';')[0].trim()
  if (/\.m3u8(\?|$)/i.test(url)) return 'application/vnd.apple.mpegurl'
  if (/\.vtt(\?|$)/i.test(url)) return 'text/vtt'
  if (/\.mp4(\?|$)/i.test(url)) return 'video/mp4'
  if (/\.ts(\?|$)/i.test(url)) return 'video/mp2t'
  if (/\.m4s(\?|$)/i.test(url)) return 'video/iso.segment'
  if (/\.mpd(\?|$)/i.test(url)) return 'application/dash+xml'
  return upstreamCt || 'application/octet-stream'
}

// ---------- AniKoto/MegaPlay resolution ----------

const resolveCache = new Map<string, { id: number; at: number }>()
const RESOLVE_TTL_MS = 10 * 60 * 1000

async function resolveSeriesId(anilistId: number, romaji: string, english: string, native: string, signal?: AbortSignal | null): Promise<number> {
  const key = `r:${anilistId}`
  const hit = resolveCache.get(key)
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.id
  const fRes = await fetchUpstream(
    `https://anikototv.to/filter?keyword=${encodeURIComponent(romaji)}&page=1`,
    { headers: { Accept: 'text/html', Referer: 'https://anikototv.to/' }, signal, timeoutMs: 8000 },
  )
  if (!fRes.ok) throw new Error(`filter ${fRes.status}`)
  const html = await fRes.text()
  const cards: { id: number; name: string; jp: string }[] = []
  const seen = new Set<number>()
  const re = /data-tip="(\d+)"[\s\S]{0,3000}?<a class="name d-title"[^>]*?(?:data-jp="([^"]*)")?[^>]*>([^<]{1,120})<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && cards.length < 40) {
    const id = Number(m[1])
    if (!Number.isFinite(id) || seen.has(id)) continue
    seen.add(id)
    cards.push({ id, name: (m[3] || '').trim(), jp: (m[2] || '').trim() })
  }
  if (!cards.length) throw new Error('no filter results')
  const variants = [romaji, english, native].filter(Boolean) as string[]
  const score = (t: string) => {
    const n = (t || '').toLowerCase().trim()
    if (!n) return 0
    const vs = variants.map((v) => v.toLowerCase().trim()).filter(Boolean)
    if (vs.some((v) => v === n)) return 3
    if (vs.some((v) => v && (v.startsWith(n) || n.startsWith(v)))) return 2
    if (vs.some((v) => v && (v.includes(n) || n.includes(v)))) return 1
    return 0
  }
  const ranked = cards
    .map((c) => ({ c, s: Math.max(score(c.name), score(c.jp)) }))
    .sort((a, b) => b.s - a.s)
  const cands = (ranked.some((r) => r.s > 0) ? ranked.filter((r) => r.s > 0) : ranked).slice(0, 4)
  const checks = await Promise.all(cands.map(async ({ c }) => {
    try {
      const r = await fetchUpstream(`https://www.anikotoapi.site/series/${c.id}`,
        { headers: { Accept: 'application/json' }, signal })
      if (!r.ok) return null
      const v: any = await r.json().catch(() => null)
      return String(v?.data?.anime?.ani_id) === String(anilistId) ? c.id : null
    } catch { return null }
  }))
  const id = checks.find((x) => typeof x === 'number')
  if (id == null) throw new Error('no verified series match')
  resolveCache.set(key, { id, at: Date.now() })
  if (resolveCache.size > 500) {
    const oldest = resolveCache.keys().next().value as string | undefined
    if (oldest !== undefined) resolveCache.delete(oldest)
  }
  return id
}

// ---------- title matching ----------

// Hints the frontend already holds (AniList metadata). The worker cannot
// fetch AniList itself (CF egress is IP-blocked), so the caller supplies
// everything the matcher is allowed to use. Nothing here is secret.
export interface MatchHints {
  english?: string | null
  native?: string | null
  expectedEpisodes?: number | null
  expectedFormat?: string | null
  year?: number | null
}

// Minimum similarity (0-100) to accept a provider candidate. Below this the
// resolver fails closed ('no confident match') instead of playing whatever
// the search endpoint happened to return first.
const MATCH_THRESHOLD = 40

function normalizeTitle(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

// Similarity of one provider-side name against all known variants.
// exact = 100, prefix either way = 60, substring either way = 40,
// token overlap scales 0-50 (same tokens in any order always passes).
function titleScore(name: string, variants: string[]): number {
  const n = normalizeTitle(name)
  if (!n) return 0
  let best = 0
  for (const raw of variants) {
    const v = normalizeTitle(raw)
    if (!v) continue
    if (v === n) return 100
    if (v.startsWith(n) || n.startsWith(v)) best = Math.max(best, 60)
    else if (v.includes(n) || n.includes(v)) best = Math.max(best, 40)
    best = Math.max(best, Math.round(tokenJaccard(n, v) * 50))
  }
  return best
}

function splitTitles(title: string): { romaji: string; english: string } {
  return {
    romaji: String(title || '').split('||')[0]?.trim() || String(title || ''),
    english: String(title || '').split('||')[1]?.trim() || '',
  }
}

// Provider types are coarse (TV/Movie/OVA/Special); AniList formats are
// finer (TV/MOVIE/OVA/ONA/SPECIAL/MUSIC). Only the movie↔non-movie conflict
// is a hard mismatch — everything else defers to title scoring so a quirky
// provider label can never alone veto a strong title match.
function typeCompatible(expectedFormat: string | null | undefined, actualType: string | null | undefined): boolean {
  const e = String(expectedFormat || '').toLowerCase()
  const a = String(actualType || '').toLowerCase()
  if (!e || !a) return true
  const eMovie = e === 'movie'
  const aMovie = a === 'movie'
  return eMovie === aMovie
}

// ---------- AniWave resolution ----------

const AW_BASE = 'https://aniwaves.ru'

async function awGet(path: string, referer: string | null, signal?: AbortSignal | null, timeoutMs = 8000): Promise<Response> {
  return fetchUpstream(`${AW_BASE}${path}`, {
    headers: { Accept: '*/*', Referer: referer || `${AW_BASE}/`, 'X-Requested-With': 'XMLHttpRequest' },
    signal, timeoutMs,
  })
}

const awResolveCache = new Map<string, { id: number; name: string; count: number; at: number }>()
const AW_RESOLVE_TTL_MS = 10 * 60 * 1000

 

interface AwCandidate { id: number; name: string; jp: string; count: number; type: string }

function parseAwCards(html: string): AwCandidate[] {
  // Filter cards carry everything the matcher may use: provider id
  // (data-tip), display name, romaji name (data-jp), episode total and
  // release type. Split by item block so counts/types attach to the right id.
  const out: AwCandidate[] = []
  const seen = new Set<number>()
  for (const block of html.split('<div class="item "')) {
    const tip = /data-tip="(\d+)"/.exec(block)
    const nm = /<a class="name d-title"[^>]*href="\/watch\/([a-z0-9\-]+)-(\d+)"[^>]*>([^<]{1,120})<\/a>/.exec(block)
    if (!tip || !nm) continue
    const id = Number(tip[1])
    if (!Number.isFinite(id) || seen.has(id)) continue
    const jp = /data-jp="([^"]*)"/.exec(nm[0])
    const cnt = /ep-status total"><span>\s*(\d+)/.exec(block)
    const typ = /<div class="right">([A-Za-z]+)<\/div>/.exec(block)
    const name = (nm[3] || '').trim()
    if (!name) continue
    seen.add(id)
    out.push({
      id,
      name,
      jp: (jp?.[1] || '').trim(),
      count: cnt ? Number(cnt[1]) : 0,
      type: (typ?.[1] || '').trim(),
    })
    if (out.length >= 30) break
  }
  return out
}

async function awFindAnime(
  title: string,
  signal?: AbortSignal | null,
  episode?: number | null,
  hints?: MatchHints | null,
): Promise<{ id: number; name: string; count: number }> {
  const { romaji, english: englishFromTitle } = splitTitles(title)
  const english = (hints?.english || englishFromTitle || '').trim()
  const native = (hints?.native || '').trim()
  const variants = [romaji, english, native].filter(Boolean) as string[]
  const expectedEps = Number(hints?.expectedEpisodes) || 0
  const gRes = await fetchUpstream(
    `https://aniwaves.ru/filter?keyword=${encodeURIComponent(romaji)}&page=1`,
    { headers: { Accept: 'text/html', Referer: 'https://aniwaves.ru/' }, signal, timeoutMs: 8000 },
  )
  if (!gRes.ok) throw new Error(`aw filter ${gRes.status}`)
  const html = await gRes.text()
  const cands = parseAwCards(html)
  if (!cands.length) throw new Error('aw no filter results')
  // Hard filters first: a candidate that cannot serve the requested episode,
  // or is the wrong release type, is out regardless of title similarity.
  const viable = cands.filter((c) => {
    if (episode && episode > 0 && c.count > 0 && c.count < episode) return false
    if (!typeCompatible(hints?.expectedFormat, c.type)) return false
    return true
  })
  if (!viable.length) {
    throw new Error(`aw no viable candidate (requested ep ${episode ?? '?'}, format ${hints?.expectedFormat || '?'})`)
  }
  const scored = viable.map((c, i) => ({
    c, i,
    s: Math.max(titleScore(c.name, variants), c.jp ? titleScore(c.jp, variants) : 0),
    dist: expectedEps > 0 && c.count > 0 ? Math.abs(c.count - expectedEps) : Number.MAX_SAFE_INTEGER,
  }))
  const best = Math.max(...scored.map((x) => x.s))
  if (best < MATCH_THRESHOLD) {
    const names = scored.slice(0, 3).map((x) => `"${x.c.name}"`).join(', ')
    throw new Error(`aw no confident match for "${romaji}" (best score ${best}, e.g. ${names})`)
  }
  scored.sort((a, b) => b.s - a.s || a.dist - b.dist || a.i - b.i)
  const [first, second] = scored
  if (second && second.s === first.s && second.dist === first.dist && second.c.id !== first.c.id) {
    throw new Error(`aw ambiguous match for "${romaji}": "${first.c.name}" vs "${second.c.name}"`)
  }
  // Liveness check on the winner only: the episode list must exist and
  // cover the request. Runner-ups are different shows by construction, so a
  // missing list fails closed instead of silently substituting another show.
  {
    const c = first.c
    try {
      const eRes = await fetchUpstream(`https://aniwaves.ru/ajax/episode/list/${c.id}`, {
        headers: { Accept: '*/*', Referer: 'https://aniwaves.ru/', 'X-Requested-With': 'XMLHttpRequest' },
        signal, timeoutMs: 6000,
      })
      if (!eRes.ok) throw new Error('list-missing')
      const eHtml = await eRes.text()
      const collect = (h: string) => [...h.matchAll(/(?:ep-(\d+)|data-ep[^0-9]*(\d+)|>(\d{1,4})<)/gi)]
        .map((x) => Number(x[1] || x[2] || x[3])).filter((n) => Number.isFinite(n) && n > 0 && n < 5000)
      let nums = collect(eHtml)
      if (!nums.length) {
        try {
          const j = JSON.parse(eHtml)
          nums = collect(j?.result || '')
        } catch {}
      }
      if (!nums.length) throw new Error('list-missing')
      const maxEp = Math.max(...nums)
      if (episode && episode > 0 && maxEp < episode) {
        throw new Error(`aw episode ${episode} not listed for "${c.name}" (has ${maxEp})`)
      }
      log({ ev: 'aw-match', id: c.id, name: c.name, score: first.s, count: maxEp })
      return { id: c.id, name: c.name, count: maxEp }
    } catch (e) {
      if (e instanceof Error && /not listed/.test(e.message)) throw e
    }
  }
  throw new Error(`aw episode list missing for "${first.c.name}"`)
}

async function awExtractEchovideo(embedUrl: string, signal?: AbortSignal | null): Promise<{ url: string; kind: string } | null> {
  const m = embedUrl.match(/^(https?:\/\/[^/]+)\/embed-1\/([^?#]+)/)
  if (!m) return null
  const [, origin, id] = m
  const res = await fetchUpstream(`${origin}/embed-1/getSources?id=${encodeURIComponent(id)}`, {
    headers: {
      'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json', Referer: embedUrl,
    },
    signal, timeoutMs: 8000,
  })
  if (!res.ok) return null
  const j: any = await res.json().catch(() => null)
  const file = j?.sources
  const url = typeof file === 'string' ? file : file?.file || file?.url
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null
  return { url, kind: 'hls' }
}

async function awExtractDood(embedUrl: string, signal?: AbortSignal | null): Promise<{ url: string; kind: string } | null> {
  const origin = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [])[1]
  if (!origin) return null
  const res = await fetchUpstream(embedUrl, {
    headers: { 'User-Agent': UA, Referer: 'https://aniwaves.ru/' }, signal, timeoutMs: 8000,
  })
  if (!res.ok) return null
  const html = await res.text()
  const pass = html.match(/\/pass_md5\/[^'"\s]+/)
  const token = html.match(/token=([a-zA-Z0-9]+)/)
  if (!pass || !token) return null
  const bRes = await fetchUpstream(origin + pass[0], {
    headers: { 'User-Agent': UA, Referer: embedUrl }, signal, timeoutMs: 8000,
  })
  if (!bRes.ok) return null
  const base = (await bRes.text()).trim()
  if (!/^https?:\/\//.test(base)) return null
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 10; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return { url: `${base}${suffix}.mp4?token=${token[1]}&expiry=${Date.now()}`, kind: 'mp4' }
}

interface ResolveResult {
  file: string
  subs: { label: string; file: string }[]
  intro: unknown
  outro: unknown
  kind: 'hls' | 'mp4'
  providerAnimeId?: number | null
  providerTitle?: string | null
}

async function aniwaveResolve(
  anilistId: number, title: string, episode: number, language: string,
  signal?: AbortSignal | null, hints?: MatchHints | null,
): Promise<ResolveResult> {
  const { romaji } = splitTitles(title)
  const key = `aw:${anilistId || normalizeTitle(romaji)}`
  const hit0 = awResolveCache.get(key)
  let found: { id: number; name: string; count: number } | null =
    hit0 && Date.now() - hit0.at < AW_RESOLVE_TTL_MS ? hit0 : null
  if (found && episode > 0 && found.count > 0 && found.count < episode) found = null
  if (!found) {
    const fresh = await awFindAnime(title, signal, episode, hints)
    awResolveCache.set(key, { ...fresh, at: Date.now() })
    if (awResolveCache.size > 500) {
      const oldest = awResolveCache.keys().next().value as string | undefined
      if (oldest !== undefined) awResolveCache.delete(oldest)
    }
    found = fresh
  }
  const animeId = found.id
  const sRes = await awGet(`/ajax/server/list?servers=${animeId}&eps=${episode}`, `${AW_BASE}/watch/${animeId}/ep-1`, signal, 6000)
  if (!sRes.ok) throw new Error(`aw servers ${sRes.status}`)
  const sj: any = await sRes.json().catch(() => null)
  const sHtml = sj?.result || ''
  const jobs: { type: string; linkId: string; server: string }[] = []
  const typeRe = /<div class="type" data-type="(sub|dub|ssub)"[\s\S]*?<ul>([\s\S]*?)<\/ul>/gi
  let tm: RegExpExecArray | null
  while ((tm = typeRe.exec(sHtml)) !== null) {
    const type = tm[1]
    if (type !== language && !(language === 'sub' && type === 'ssub')) continue
    const liRe = /data-link-id="([^"]+)"[^>]*>([^<]{1,30})/gi
    let lm: RegExpExecArray | null
    while ((lm = liRe.exec(tm[2])) !== null) jobs.push({ type, linkId: lm[1], server: lm[2].trim() })
  }
  if (!jobs.length) throw new Error('aw no servers')
  const results = await Promise.all(jobs.slice(0, 6).map(async (job) => {
    try {
      const r = await awGet(`/ajax/sources?id=${encodeURIComponent(job.linkId)}`, `${AW_BASE}/`, signal, 6000)
      if (!r.ok) return null
      const j: any = await r.json().catch(() => null)
      const embedUrl = j?.result?.url || (typeof j?.result === 'string' ? j.result : null)
      if (!embedUrl || typeof embedUrl !== 'string') return null
      if (/echovideo|\/embed-1\//.test(embedUrl)) return await awExtractEchovideo(embedUrl, signal)
      if (/myvidplay|playmogo|dood|d0o0d|ds2play|vide0/.test(embedUrl)) return await awExtractDood(embedUrl, signal)
      return null
    } catch { return null }
  }))
  const hit = results.find((x) => x && x.url)
  if (!hit) throw new Error('aw no playable stream')
  if (episode > 0 && found.count > 0 && found.count < episode) {
    throw new Error(`aw episode ${episode} not listed for "${found.name}" (has ${found.count})`)
  }
  return { file: hit.url, subs: [], intro: null, outro: null, kind: hit.kind === 'mp4' ? 'mp4' : 'hls', providerAnimeId: found.id, providerTitle: found.name }
}

async function anikotoResolve(
  anilistId: number, title: string, episode: number, language: string,
  signal?: AbortSignal | null, hints?: MatchHints | null,
): Promise<ResolveResult> {
  const { romaji, english: englishFromTitle } = splitTitles(title)
  const english = (hints?.english || englishFromTitle || '').trim()
  const native = (hints?.native || '').trim()
  const seriesId = await resolveSeriesId(anilistId, romaji, english, native, signal)
  const sRes = await fetchUpstream(`https://www.anikotoapi.site/series/${seriesId}`,
    { headers: { Accept: 'application/json' }, signal })
  if (!sRes.ok) throw new Error(`series ${sRes.status}`)
  const sj: any = await sRes.json().catch(() => null)
  const seriesAnime = sj?.data?.anime
  // Belt-and-braces on top of the ani_id verification: provider year must
  // agree (season-boundary tolerance ±1). Year comes from the caller hint.
  const hintYear = Number(hints?.year) || 0
  const provYear = Number(seriesAnime?.year) || 0
  if (hintYear > 0 && provYear > 0 && Math.abs(hintYear - provYear) > 1) {
    throw new Error(`year mismatch for "${seriesAnime?.title || seriesId}" (want ${hintYear}, provider ${provYear})`)
  }
  const providerTitle = String(seriesAnime?.title || seriesAnime?.alternative || '').trim() || null
  const eps = sj?.data?.episodes
  if (!Array.isArray(eps)) throw new Error('no episodes')
  const ep = eps.find((e: any) => e.number === episode)
  if (!ep) throw new Error(`episode ${episode} missing`)
  const embedUrl = ep.embed_url?.[language] || ep.embed_url?.sub
  if (typeof embedUrl !== 'string' || !/^https:\/\//.test(embedUrl)) throw new Error('no embed url')
  let srcId = (embedUrl.match(/\/stream\/s-\d+\/(\d+)(?:\/|$)/) || [])[1] || null
  try {
    const pRes = await fetchUpstream(embedUrl,
      { headers: { Accept: 'text/html', Referer: 'https://anikototv.to/' }, signal })
    if (pRes.ok) {
      const ph = await pRes.text()
      const dm = ph.match(/id="megaplay-player"[\s\S]{0,400}?data-id="(\d+)"/)
      if (dm?.[1]) srcId = dm[1]
    }
  } catch {}
  if (!srcId) throw new Error('no stream id')
  const gRes = await fetchUpstream(`https://megaplay.buzz/stream/getSourcesNew?id=${encodeURIComponent(srcId)}`, {
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: embedUrl,
    },
    signal,
  })
  if (!gRes.ok) throw new Error(`sources ${gRes.status}`)
  const gj: any = await gRes.json().catch(() => null)
  const file = gj?.sources?.file
  if (typeof file !== 'string' || !/^https:\/\//.test(file)) throw new Error('no stream file')
  const subs = Array.isArray(gj?.tracks) ? gj.tracks
    .filter((t: any) => t && typeof t.file === 'string' && /^https:\/\//.test(t.file) && t.kind !== 'thumbnails')
    .map((t: any) => ({ label: t.label || 'English', file: t.file })) : []
  return { file, subs, intro: gj?.intro ?? null, outro: gj?.outro ?? null, kind: 'hls', providerAnimeId: seriesId, providerTitle }
}

// ---------- public API ----------

export interface ResolvedSource {
  provider: string
  url: string
  type: 'hls' | 'mp4'
  language: string
  quality: string
  subtitles: { language: string; label: string; url: string; type?: string }[]
  intro: unknown
  outro: unknown
  providerAnimeId?: number | null
  providerTitle?: string | null
}

export async function resolveSource(opts: {
  provider: 'aniwave' | 'anikoto'
  anilistId: number
  title: string
  episode: number
  language: string
  signal?: AbortSignal | null
  hints?: MatchHints | null
}): Promise<ResolvedSource> {
  const ctx = getResolveContext()
  if (!ctx) throw new Error('resolver not configured')
  const { provider, anilistId, title, episode, language, signal, hints } = opts
  if (!Number.isFinite(anilistId) || anilistId <= 0 || !Number.isFinite(episode) || episode <= 0) {
    throw new Error('anilistId + episode required')
  }
  const lang = language === 'dub' ? 'dub' : 'sub'
  const t0 = Date.now()
  try {
    const r = provider === 'aniwave'
      ? await aniwaveResolve(anilistId, title, episode, lang, signal, hints)
      : await anikotoResolve(anilistId, title, episode, lang, signal, hints)
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S
    const mint = async (cdnUrl: string): Promise<string | null> => {
      try {
        const h = new URL(cdnUrl).hostname
        if (!hostAllowed(h)) { log({ ev: 'mint-reject-host', host: h }); return null }
        if (await isPrivateHost(h)) { log({ ev: 'mint-reject-private', host: h }); return null }
        const { u, e, s } = await signToken(ctx.secret, cdnUrl, exp)
        return `${ctx.publicOrigin}/api/stream?u=${encodeURIComponent(u)}&e=${encodeURIComponent(e)}&s=${s}`
      } catch { return null }
    }
    const playlist = await mint(r.file)
    if (!playlist) throw new Error('URL signing unavailable')
    const subtitles: ResolvedSource['subtitles'] = []
    for (const t of r.subs || []) {
      const file = await mint(t.file)
      if (file) subtitles.push({ language: 'en', label: t.label, url: file, type: 'vtt' })
    }
    log({ ev: 'resolve', provider, anilistId, episode, language: lang, ms: Date.now() - t0, subs: subtitles.length })
    return {
      provider, url: playlist, type: r.kind, language: lang, quality: 'auto',
      subtitles, intro: r.intro, outro: r.outro,
      providerAnimeId: r.providerAnimeId ?? null,
      providerTitle: r.providerTitle ?? null,
    }
  } catch (e) {
    const msg = String((e && (e as Error).message) || e).slice(0, 200)
    log({ ev: 'resolve-fail', provider, anilistId, episode, language: lang, ms: Date.now() - t0, err: msg })
    throw e
  }
}

export async function findAniwaveEpisodes(
  title: string, signal?: AbortSignal | null, hints?: MatchHints | null,
): Promise<{
  provider: string; animeId: number; title: string; count: number; episodes: { number: number }[]
}> {
  const found = await awFindAnime(title, signal, null, hints)
  log({ ev: 'episodes', provider: 'aniwave', animeId: found.id, count: found.count })
  return {
    provider: 'aniwave',
    animeId: found.id,
    title: found.name,
    count: found.count,
    episodes: Array.from({ length: found.count }, (_, i) => ({ number: i + 1 })),
  }
}

// ---------- signed delivery ----------

function plainTextResponse(cors: Record<string, string>, status: number, text: string): Response {
  const h = new Headers(cors)
  h.set('Cache-Control', 'no-store')
  return new Response(text, { status, headers: h })
}

export async function handleStream(request: Request, cors: Record<string, string>): Promise<Response> {
  const ctx = getResolveContext()
  if (!ctx) return plainTextResponse(cors, 500, 'Resolver not configured')
  const url = new URL(request.url)
  const target = await verifyToken(ctx.secret, url.searchParams.get('u'), url.searchParams.get('e'), url.searchParams.get('s'))
  if (!target) return plainTextResponse(cors, 403, 'Forbidden')
  let host: string
  try { host = new URL(target).hostname } catch {
    return plainTextResponse(cors, 400, 'Bad URL')
  }
  if (!hostAllowed(host)) {
    log({ ev: 'stream-reject-host', host })
    return plainTextResponse(cors, 403, 'Host not allowed')
  }
  if (await isPrivateHost(host)) {
    return plainTextResponse(cors, 403, 'Forbidden')
  }
  const ctrl = new AbortController()
  const clientSignal = request.signal
  const onClientAbort = () => {
    try { ctrl.abort((clientSignal as any)?.reason ?? new DOMException('Aborted', 'AbortError')) } catch {}
  }
  if (clientSignal) {
    if (clientSignal.aborted) onClientAbort()
    else clientSignal.addEventListener('abort', onClientAbort, { once: true })
  }
  const tid = setTimeout(() => { try { ctrl.abort(new Error('stream timeout')) } catch {} }, 120000)
  try {
    const up = await fetchUpstream(target, {
      headers: {
        Accept: '*/*',
        Referer: 'https://megaplay.buzz/',
        Origin: 'https://megaplay.buzz',
      },
      range: request.headers.get('Range'),
      timeoutMs: 120000,
      signal: ctrl.signal,
    })
    if (!up.ok && up.status !== 206) {
      log({ ev: 'stream-upstream', host, status: up.status })
      return plainTextResponse(cors, 502, 'Upstream failed')
    }
    const ct = contentTypeFor(target, up.headers.get('content-type'))
    if (ct === 'text/html') {
      try { await up.body?.cancel() } catch {}
      log({ ev: 'stream-blocked', host })
      return plainTextResponse(cors, 502, 'Upstream blocked')
    }
    // Content sniffing (not URL/headers): variant playlists often arrive as
    // application/octet-stream with no .m3u8 extension. Buffer a small head,
    // sniff for playlist/VTT magic, then process text (cap 5MB) or relay bytes.
    const reader = up.body?.getReader()
    if (!reader) throw new Error('no body')
    const headChunks: Uint8Array[] = []
    let headLen = 0
    let upstreamDone = false
    try {
      while (headLen < 16384) {
        const { done, value } = await reader.read()
        if (done) { upstreamDone = true; break }
        if (value) { headChunks.push(value); headLen += value.length }
      }
    } catch (e) {
      try { reader.releaseLock() } catch {}
      throw e
    }
    let headText = ''
    try {
      const cat = new Uint8Array(headLen)
      let off = 0
      for (const c of headChunks) { cat.set(c, off); off += c.length }
      headText = new TextDecoder().decode(cat).slice(0, 200)
    } catch {}
    const isTextBody = /^\s*(#EXTM3U|WEBVTT)/i.test(headText)
    if (!isTextBody) {
      // Binary: relay head + rest with Range passthrough, no buffering.
      const headers = new Headers(cors)
      headers.set('Content-Type', ct)
      headers.set('Cache-Control', 'no-store')
      headers.set('Accept-Ranges', 'bytes')
      const cr = up.headers.get('content-range')
      if (cr) headers.set('Content-Range', cr)
      // Length unknown (head consumed): omit Content-Length for correctness.
      log({ ev: 'stream-bin', host, ct, status: up.status, range: request.headers.get('Range') || '-' })
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (const c of headChunks) controller.enqueue(c)
            if (!upstreamDone) {
              for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                if (value) controller.enqueue(value)
              }
            }
            controller.close()
          } catch (e) {
            controller.error(e)
          } finally {
            try { reader.releaseLock() } catch {}
            clearTimeout(tid)
            if (clientSignal) clientSignal.removeEventListener?.('abort', onClientAbort)
          }
        },
        async cancel() {
          try { await reader.cancel() } catch {}
          clearTimeout(tid)
          if (clientSignal) clientSignal.removeEventListener?.('abort', onClientAbort)
        },
      })
      return new Response(stream, { status: up.status, headers })
    }
    // Small text bodies: cap size, rewrite playlists, fix types.
    const rest: Uint8Array[] = []
    let total = headLen
    try {
      if (!upstreamDone) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) { rest.push(value); total += value.length }
          if (total > 5 * 1024 * 1024) break
        }
      }
    } catch {}
    try { reader.releaseLock() } catch {}
    if (total > 5 * 1024 * 1024) {
      return plainTextResponse(cors, 502, 'Too large')
    }
    const cat = new Uint8Array(total)
    let off = 0
    for (const c of [...headChunks, ...rest]) { cat.set(c, off); off += c.length }
    const text = new TextDecoder().decode(cat)
    let outText = text
    let outCt = ct
    if (/^\s*#EXTM3U/i.test(text)) {
      outCt = 'application/vnd.apple.mpegurl'
      const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S
      const lines = text.split('\n')
      const out: string[] = []
      for (const line of lines) {
        const t = line.trim()
        if (!t || t.startsWith('#')) { out.push(line); continue }
        let abs: string
        try { abs = new URL(t, target).toString() } catch { out.push(line); continue }
        if (!/^https:\/\//.test(abs)) { out.push(line); continue }
        let h2: string
        try { h2 = new URL(abs).hostname } catch { out.push(line); continue }
        if (!hostAllowed(h2)) { out.push(line); continue }
        const { u, e, s } = await signToken(ctx.secret, abs, exp)
        out.push(`${ctx.publicOrigin}/api/stream?u=${encodeURIComponent(u)}&e=${encodeURIComponent(e)}&s=${s}`)
      }
      outText = out.join('\n')
    } else if (/WEBVTT/i.test(text.slice(0, 20))) {
      outCt = 'text/vtt'
    }
    const buf = new TextEncoder().encode(outText)
    log({ ev: 'stream-text', host, ct: outCt, bytes: buf.length, status: up.status })
    const headers = new Headers(cors)
    headers.set('Content-Type', outCt)
    headers.set('Content-Length', String(buf.length))
    headers.set('Cache-Control', 'no-store')
    headers.set('Accept-Ranges', 'bytes')
    return new Response(buf as BodyInit, { status: up.status === 206 ? 206 : 200, headers })
  } catch (e) {
    log({ ev: 'stream-error', host, err: String((e && (e as Error).message) || e).slice(0, 120) })
    return plainTextResponse(cors, 502, 'Fetch failed')
  } finally {
    clearTimeout(tid)
    if (clientSignal) clientSignal.removeEventListener?.('abort', onClientAbort)
  }
}

// ---------- authenticated self-test (proves egress + pipeline) ----------

export async function handleDiag(request: Request, cors: Record<string, string>): Promise<Response> {
  const ctx = getResolveContext()
  const h = request.headers.get('Authorization') || ''
  if (!ctx || !h.startsWith('Bearer ') || !constEq(h.slice(7), ctx.secret)) {
    const rh = new Headers(cors)
    rh.set('Content-Type', 'application/json')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: rh })
  }
  const t0 = Date.now()
  const out: any = { ok: true, steps: {} }
  try {
    const r = await anikotoResolve(1, 'Cowboy Bebop', 1, 'sub', request.signal)
    out.steps.resolve = { ok: true, ms: Date.now() - t0, hasFile: !!r.file, subs: r.subs.length }
    const hh = new URL(r.file)
    const allowed = hostAllowed(hh.hostname)
    out.steps.allowlist = { ok: allowed, host: hh.hostname }
    const ctrl = new AbortController()
    const tid = setTimeout(() => { try { ctrl.abort() } catch {} }, FETCH_TIMEOUT_MS)
    try {
      const pr = await fetch(r.file, {
        method: 'GET',
        headers: { 'User-Agent': UA, Referer: 'https://megaplay.buzz/', Range: 'bytes=0-1023' },
        signal: ctrl.signal,
      })
      const head = await pr.text().then((t) => t.slice(0, 120)).catch(() => '')
      out.steps.cdn = { ok: pr.status === 206 || pr.status === 200, status: pr.status, head }
      if (!out.steps.cdn.ok || !out.steps.allowlist.ok) out.ok = false
    } finally { clearTimeout(tid) }
  } catch (e) {
    out.ok = false
    out.steps.error = String((e && (e as Error).message) || e).slice(0, 300)
  }
  out.ms = Date.now() - t0
  const rh = new Headers(cors)
  rh.set('Content-Type', 'application/json')
  rh.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(out), { status: out.ok ? 200 : 502, headers: rh })
}
