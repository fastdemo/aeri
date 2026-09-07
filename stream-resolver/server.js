// Aeri streaming resolver + delivery proxy (runs on Fly, NOT Cloudflare).
//
// Why this exists: video CDNs hard-block Cloudflare Worker egress IPs, so the
// Worker can resolve source URLs but neither it nor some viewers can fetch
// bytes. This service provides (a) source resolution from a clean egress and
// (b) signed-URL HLS/segment/VTT delivery proxying with strict allowlisting.
//
// Security model:
// - /health is public. Everything else needs auth or an unforgeable token.
// - /api/resolve requires `Authorization: Bearer <RESOLVER_SECRET>`
//   (server-to-server only; the browser never sees the secret).
// - /api/stream carries HMAC-signed, expiring tokens minted ONLY by
//   /api/resolve. No token = no fetch. Hostnames are allowlisted, https-only,
//   private IPs rejected (best-effort DNS check).
// - No DRM/auth/CAPTCHA/Turnstile bypass: plain HTTP fetches of the
//   provider's public JSON APIs + CDN playlist/segments with the provider's
//   normal Referer. Anything requiring a challenge fails closed.
//
// Env:
//   PORT              (default 8788)
//   RESOLVER_SECRET   (required for /api/* — 32+ random hex)
//   PUBLIC_URL        (e.g. https://aeri-stream.fly.dev — used to mint URLs)
//   ALLOWED_ORIGIN    (default https://aeri.fastdemo.workers.dev; comma list or *; localhost always allowed for dev)

import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'

const PORT = Number(process.env.PORT || 8788)
const SECRET = process.env.RESOLVER_SECRET || ''
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
const ALLOWLIST = (process.env.ALLOWED_ORIGIN || 'https://aeri.fastdemo.workers.dev')
  .split(',').map((s) => s.trim()).filter(Boolean)
const EXTRA_SUFFIXES = (process.env.EXTRA_CDN_SUFFIXES || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const TOKEN_TTL_S = 6 * 3600
const FETCH_TIMEOUT_MS = 12000
// Hosts this service may fetch playlists/segments/subtitles from. Suffix
// rules cover CDN rotations (mikora/akirax/shiora…); megap* covers future
// megaplay edge hosts. Nothing else is fetchable via /api/stream.
const CDN_SUFFIXES = [
  'imgnex.top',
  'mikora.top',
  'akirax.buzz',
  'shiora.site',
  'megaplay.buzz',
  'anikototv.to',
  'anikotoapi.site',
  'vidnest.fun',
  'aniwaves.ru',
  'echovideo.ru',
  'echovideo.to',
  'play.echovideo.ru',
  'st2.dpopdrop89.store',
  ...EXTRA_SUFFIXES,
]
const CDN_REGEXES = [
  /^megap[a-z0-9-]*\.[a-z0-9.-]+$/i,
  // megaplay edge rotations observed in the wild
  /^st\d+\.[a-z0-9-]+\.store$/i,
  /^hls[a-z0-9-]*\.echovideo\.(to|ru)$/i,
  /^[a-z0-9-]+\.imgnex\.top$/i,
]

const log = (obj) => {
  try { console.log(JSON.stringify({ t: new Date().toISOString(), ...obj })) } catch {}
}

function corsHeaders(origin) {
  const allowAll = ALLOWLIST.includes('*')
  let allowOrigin = '*'
  if (!allowAll) {
    const isLocal = origin && /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(origin)
    if (origin && (ALLOWLIST.includes(origin) || isLocal)) allowOrigin = origin
    else allowOrigin = ALLOWLIST[0] || '*'
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
    'Access-Control-Max-Age': '86400',
    ...(allowAll ? {} : { Vary: 'Origin' }),
  }
}

function sendJson(res, status, data, origin) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...corsHeaders(origin),
  })
  res.end(body)
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function checkAuth(req) {
  if (!SECRET) return false
  const h = req.headers.authorization || ''
  if (!h.startsWith('Bearer ')) return false
  const got = Buffer.from(h.slice(7))
  const want = Buffer.from(SECRET)
  return got.length === want.length && timingSafeEqual(got, want)
}

function signToken(url, exp) {
  const u = Buffer.from(url, 'utf8').toString('base64url')
  const sig = createHmac('sha256', SECRET).update(`${u}.${exp}`).digest('hex')
  return { u, e: String(exp), s: sig }
}

function verifyToken(u, e, s) {
  try {
    if (!SECRET || !u || !e || !s) return null
    const exp = Number(e)
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null
    const want = createHmac('sha256', SECRET).update(`${u}.${e}`).digest('hex')
    const a = Buffer.from(String(s)), b = Buffer.from(want)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const url = Buffer.from(String(u), 'base64url').toString('utf8')
    if (!/^https:\/\//.test(url) || url.length > 2048) return null
    return url
  } catch { return null }
}

function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  for (const sfx of CDN_SUFFIXES) {
    if (h === sfx || h.endsWith('.' + sfx)) return true
  }
  return CDN_REGEXES.some((re) => re.test(h))
}

async function isPrivateHost(hostname) {
  // Best-effort SSRF guard against DNS rebinding to internal ranges.
  try {
    const addrs = await dnsLookup(hostname, { all: true })
    const priv = (ip) => {
      if (ip.includes(':')) return /^(::1|fe80|fc00|fd00)/i.test(ip)
      const p = ip.split('.').map(Number)
      if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true
      return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || p[0] === 0
    }
    return addrs.length === 0 || addrs.some((a) => priv(a.address))
  } catch { return true }
}

async function fetchUpstream(url, { headers = {}, range, timeoutMs = FETCH_TIMEOUT_MS, externalSignal } = {}) {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(new Error('upstream timeout')), timeoutMs)
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', () => ctrl.abort(externalSignal.reason), { once: true })
  }
  try {
    const h = { 'User-Agent': UA, ...headers }
    if (range) h.Range = range
    const res = await fetch(url, { headers: h, signal: ctrl.signal, redirect: 'follow' })
    return res
  } finally { clearTimeout(tid) }
}

function contentTypeFor(url, upstreamCt) {
  if (upstreamCt && !/text\/html/i.test(upstreamCt)) return upstreamCt.split(';')[0].trim()
  if (/\.m3u8(\?|$)/i.test(url)) return 'application/vnd.apple.mpegurl'
  if (/\.vtt(\?|$)/i.test(url)) return 'text/vtt'
  if (/\.mp4(\?|$)/i.test(url)) return 'video/mp4'
  if (/\.ts(\?|$)/i.test(url)) return 'video/mp2t'
  if (/\.m4s(\?|$)/i.test(url)) return 'video/iso.segment'
  if (/\.mpd(\?|$)/i.test(url)) return 'application/dash+xml'
  return upstreamCt || 'application/octet-stream'
}

// ---- AniKoto/MegaPlay resolution (mirrors the extension pipeline) ----
// Small in-process caches: resolve verdicts 10 min, series payloads 5 min.
// Signed delivery URLs are NEVER cached (minted fresh per call).
const resolveCache = new Map()
const RESOLVE_TTL_MS = 10 * 60 * 1000

async function resolveSeriesId(anilistId, romaji, english, signal) {
  const key = `r:${anilistId}`
  const hit = resolveCache.get(key)
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.id
  const fetchOpt = { externalSignal: signal }
  // 1. filter page → (seriesId, name) cards ranked by title similarity
  const fRes = await fetchUpstream(
    `https://anikototv.to/filter?keyword=${encodeURIComponent(romaji)}&page=1`,
    { headers: { Accept: 'text/html', Referer: 'https://anikototv.to/' }, ...fetchOpt, timeoutMs: 8000 },
  )
  if (!fRes.ok) throw new Error(`filter ${fRes.status}`)
  const html = await fRes.text()
  const cards = []
  const seen = new Set()
  const re = /data-tip="(\d+)"[\s\S]{0,3000}?<a class="name d-title"[^>]*?(?:data-jp="([^"]*)")?[^>]*>([^<]{1,120})<\/a>/g
  let m
  while ((m = re.exec(html)) !== null && cards.length < 40) {
    const id = Number(m[1])
    if (!Number.isFinite(id) || seen.has(id)) continue
    seen.add(id)
    cards.push({ id, name: (m[3] || '').trim(), jp: (m[2] || '').trim() })
  }
  if (!cards.length) throw new Error('no filter results')
  const score = (t) => {
    const n = (t || '').toLowerCase().trim()
    if (!n) return 0
    const vs = [romaji.toLowerCase().trim(), english.toLowerCase().trim()].filter(Boolean)
    if (vs.some((v) => v === n)) return 3
    if (vs.some((v) => v && (v.startsWith(n) || n.startsWith(v)))) return 2
    if (vs.some((v) => v && (v.includes(n) || n.includes(v)))) return 1
    return 0
  }
  const ranked = cards
    .map((c) => ({ c, s: Math.max(score(c.name), score(c.jp)) }))
    .sort((a, b) => b.s - a.s)
  const cands = (ranked.some((r) => r.s > 0) ? ranked.filter((r) => r.s > 0) : ranked).slice(0, 4)
  // 2. verify ani_id via series API (parallel)
  const checks = await Promise.all(cands.map(async ({ c }) => {
    try {
      const r = await fetchUpstream(`https://www.anikotoapi.site/series/${c.id}`,
        { headers: { Accept: 'application/json' }, ...fetchOpt })
      if (!r.ok) return null
      const v = await r.json().catch(() => null)
      return String(v?.data?.anime?.ani_id) === String(anilistId) ? c.id : null
    } catch { return null }
  }))
  const id = checks.find((x) => typeof x === 'number')
  if (id == null) throw new Error('no verified series match')
  resolveCache.set(key, { id, at: Date.now() })
  if (resolveCache.size > 500) resolveCache.delete(resolveCache.keys().next().value)
  return id
}

const AW_BASE = 'https://aniwaves.ru'
const AW_UA = UA

async function awGet(path, referer, signal, timeoutMs = 8000) {
  const r = await fetchUpstream(`${AW_BASE}${path}`, {
    headers: { Accept: '*/*', Referer: referer || `${AW_BASE}/`, 'X-Requested-With': 'XMLHttpRequest' },
    externalSignal: signal, timeoutMs,
  })
  return r
}

// AniWave: /filter → /watch slug → /ajax/episode/list → /ajax/server/list → /ajax/sources → embed → streams.
// Embeds handled: echovideo (/embed-1/getSources → m3u8), dood-family (page → /pass_md5/ + token → mp4).
async function aniwaveResolve(anilistId, title, episode, language, signal) {
  const romaji = String(title || '').split('||')[0]?.trim() || String(title || '')
  const english = String(title || '').split('||')[1]?.trim() || ''
  const score = (t) => {
    const n = (t || '').toLowerCase().trim()
    if (!n) return 0
    const vs = [romaji.toLowerCase().trim(), english.toLowerCase().trim()].filter(Boolean)
    if (vs.some((v) => v === n)) return 3
    if (vs.some((v) => v && (v.startsWith(n) || n.startsWith(v)))) return 2
    if (vs.some((v) => v && (v.includes(n) || n.includes(v)))) return 1
    return 0
  }
  // 1. filter → (animeId, name)
  const fRes = await awGet(`/filter?keyword=${encodeURIComponent(romaji)}&page=1`, `${AW_BASE}/`, signal)
  if (!fRes.ok) throw new Error(`aw filter ${fRes.status}`)
  const fHtml = await fRes.text()
  const cands = []
  const seen = new Set()
  const fre = /href="\/watch\/([a-z0-9\-]+)-(\d+)"[^>]*>([^<]{1,120})<\/a>/gi
  let fm
  while ((fm = fre.exec(fHtml)) !== null && cands.length < 30) {
    const id = Number(fm[2])
    const name = (fm[3] || '').trim()
    if (!Number.isFinite(id) || seen.has(id)) continue
    seen.add(id)
    cands.push({ id, name })
  }
  if (!cands.length) throw new Error('aw no filter results')
  cands.sort((a, b) => score(b.name) - score(a.name))
  const top = (cands.some((c) => score(c.name) > 0) ? cands.filter((c) => score(c.name) > 0) : cands).slice(0, 3)
  // 2. verify by episode-list presence + pick first verifiable
  let animeId = null
  let epCount = 0
  for (const c of top) {
    try {
      const eRes = await awGet(`/ajax/episode/list/${c.id}`, `${AW_BASE}/watch/x-${c.id}`, signal, 6000)
      if (!eRes.ok) continue
      const eHtml = await eRes.text()
      // count episode entries
      const nums = [...eHtml.matchAll(/ep-(\d+)|data-ep(?:isode)?[^0-9]*(\d+)|>(\d{1,4})</gi)]
        .map((x) => Number(x[1] || x[2] || x[3])).filter((n) => Number.isFinite(n) && n > 0 && n < 5000)
      const maxEp = nums.length ? Math.max(...nums) : 0
      if (maxEp > 0) { animeId = c.id; epCount = maxEp; break }
    } catch {}
  }
  if (animeId == null) throw new Error('aw no verifiable match')
  // 3. servers for this episode
  const sRes = await awGet(`/ajax/server/list?servers=${animeId}&eps=${episode}`, `${AW_BASE}/watch/${animeId}/ep-1`, signal, 6000)
  if (!sRes.ok) throw new Error(`aw servers ${sRes.status}`)
  const sj = await sRes.json().catch(() => null)
  const sHtml = sj?.result || ''
  const jobs = []
  const typeRe = /<div class="type" data-type="(sub|dub|ssub)"[\s\S]*?<ul>([\s\S]*?)<\/ul>/gi
  let tm
  while ((tm = typeRe.exec(sHtml)) !== null) {
    const type = tm[1]
    if (type !== language && !(language === 'sub' && type === 'ssub')) continue
    const liRe = /data-link-id="([^"]+)"[^>]*>([^<]{1,30})/gi
    let lm
    while ((lm = liRe.exec(tm[2])) !== null) jobs.push({ type, linkId: lm[1], server: lm[2].trim() })
  }
  if (!jobs.length) throw new Error('aw no servers')
  // 4. resolve each linkId → embed → extract (parallel, first playable wins)
  const results = await Promise.all(jobs.slice(0, 6).map(async (job) => {
    try {
      const r = await awGet(`/ajax/sources?id=${encodeURIComponent(job.linkId)}`, `${AW_BASE}/`, signal, 6000)
      if (!r.ok) return null
      const j = await r.json().catch(() => null)
      const embedUrl = j?.result?.url || (typeof j?.result === 'string' ? j.result : null)
      if (!embedUrl || typeof embedUrl !== 'string') return null
      if (/echovideo|\/embed-1\//.test(embedUrl)) return await awExtractEchovideo(embedUrl, signal)
      if (/myvidplay|playmogo|dood|d0o0d|ds2play|vide0/.test(embedUrl)) return await awExtractDood(embedUrl, signal)
      return null
    } catch { return null }
  }))
  const hit = results.find((x) => x && x.url)
  if (!hit) throw new Error('aw no playable stream')
  return { file: hit.url, subs: [], intro: null, outro: null, kind: hit.kind || 'hls' }
}

async function awExtractEchovideo(embedUrl, signal) {
  const m = embedUrl.match(/^(https?:\/\/[^/]+)\/embed-1\/([^?#]+)/)
  if (!m) return null
  const [, origin, id] = m
  const res = await fetchUpstream(`${origin}/embed-1/getSources?id=${encodeURIComponent(id)}`, {
    headers: {
      'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json', Referer: embedUrl,
    },
    externalSignal: signal, timeoutMs: 8000,
  })
  if (!res.ok) return null
  const j = await res.json().catch(() => null)
  const file = j?.sources
  const url = typeof file === 'string' ? file : file?.file || file?.url
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null
  return { url, kind: 'hls', subtitles: [] }
}

async function awExtractDood(embedUrl, signal) {
  const origin = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [])[1]
  if (!origin) return null
  const res = await fetchUpstream(embedUrl, {
    headers: { 'User-Agent': UA, Referer: 'https://aniwaves.ru/' }, externalSignal: signal, timeoutMs: 8000,
  })
  if (!res.ok) return null
  const html = await res.text()
  const pass = html.match(/\/pass_md5\/[^'"\s]+/)
  const token = html.match(/token=([a-zA-Z0-9]+)/)
  if (!pass || !token) return null
  const bRes = await fetchUpstream(origin + pass[0], {
    headers: { 'User-Agent': UA, Referer: embedUrl }, externalSignal: signal, timeoutMs: 8000,
  })
  if (!bRes.ok) return null
  const base = (await bRes.text()).trim()
  if (!/^https?:\/\//.test(base)) return null
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 10; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return { url: `${base}${suffix}.mp4?token=${token[1]}&expiry=${Date.now()}`, kind: 'mp4', subtitles: [] }
}

async function anikotoResolve(anilistId, title, episode, language, signal) {
  const fetchOpt = (extra = {}) => ({ externalSignal: signal, ...(extra || {}) })
  const romaji = String(title || '').split('||')[0]?.trim() || String(title || '')
  const english = String(title || '').split('||')[1]?.trim() || ''
  const seriesId = await resolveSeriesId(anilistId, romaji, english, signal)
  // 3. episodes → embed_url → megaplay data-id → getSourcesNew JSON
  const sRes = await fetchUpstream(`https://www.anikotoapi.site/series/${seriesId}`,
    { headers: { Accept: 'application/json' }, ...fetchOpt() })
  if (!sRes.ok) throw new Error(`series ${sRes.status}`)
  const sj = await sRes.json().catch(() => null)
  const eps = sj?.data?.episodes
  if (!Array.isArray(eps)) throw new Error('no episodes')
  const ep = eps.find((e) => e.number === episode)
  if (!ep) throw new Error(`episode ${episode} missing`)
  const embedUrl = ep.embed_url?.[language] || ep.embed_url?.sub
  if (typeof embedUrl !== 'string' || !/^https:\/\//.test(embedUrl)) throw new Error('no embed url')
  let srcId = (embedUrl.match(/\/stream\/s-\d+\/(\d+)(?:\/|$)/) || [])[1] || null
  try {
    const pRes = await fetchUpstream(embedUrl,
      { headers: { Accept: 'text/html', Referer: 'https://anikototv.to/' }, ...fetchOpt() })
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
    ...fetchOpt(),
  })
  if (!gRes.ok) throw new Error(`sources ${gRes.status}`)
  const gj = await gRes.json().catch(() => null)
  const file = gj?.sources?.file
  if (typeof file !== 'string' || !/^https:\/\//.test(file)) throw new Error('no stream file')
  const subs = Array.isArray(gj?.tracks) ? gj.tracks
    .filter((t) => t && typeof t.file === 'string' && /^https:\/\//.test(t.file) && t.kind !== 'thumbnails')
    .map((t) => ({ label: t.label || 'English', file: t.file })) : []
  return { file, subs, intro: gj?.intro ?? null, outro: gj?.outro ?? null }
}

function streamUrlFor(cdnUrl) {
  if (!PUBLIC_URL || !SECRET) return null
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S
  const { u, e, s } = signToken(cdnUrl, exp)
  return `${PUBLIC_URL}/api/stream?u=${encodeURIComponent(u)}&e=${encodeURIComponent(e)}&s=${s}`
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || null
  let url
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  } catch {
    return sendJson(res, 400, { error: 'Invalid request' }, origin)
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      status: 'healthy',
      service: 'aeri-stream-resolver',
      secretConfigured: !!SECRET,
      publicUrl: PUBLIC_URL || null,
      time: new Date().toISOString(),
    }, origin)
  }

  // Authenticated self-test: full resolve for a fixed case + CDN reachability
  // from THIS host's egress. This is the decisive pre-flight for playback.
  if (url.pathname === '/api/diag') {
    if (!checkAuth(req)) return sendJson(res, 401, { error: 'Unauthorized' }, origin)
    const t0 = Date.now()
    const out = { ok: true, steps: {} }
    try {
      const r = await anikotoResolve(1, 'Cowboy Bebop', 1, 'sub', req.signal)
      out.steps.resolve = { ok: true, ms: Date.now() - t0, hasFile: !!r.file, subs: r.subs.length }
      const h = new URL(r.file)
      const allowed = hostAllowed(h.hostname)
      out.steps.allowlist = { ok: allowed, host: h.hostname }
      // HEAD the playlist (no body download)
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
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
      out.steps.error = String((e && e.message) || e).slice(0, 300)
    }
    out.ms = Date.now() - t0
    return sendJson(res, out.ok ? 200 : 502, out, origin)
  }

  // Episode listing for providers whose episode data lives behind search
  // (AniWave has no id-based episode API): filter → best slug → ajax list.
  if (req.method === 'POST' && url.pathname === '/api/episodes') {
    if (!checkAuth(req)) return sendJson(res, 401, { error: 'Unauthorized' }, origin)
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON body' }, origin)
    }
    const provider = body.provider === 'aniwave' ? 'aniwave' : null
    const title = String(body.title || '')
    if (!provider || !title.trim()) return sendJson(res, 400, { error: 'provider=aniwave + title required' }, origin)
    try {
      const romaji = title.split('||')[0]?.trim() || title
      const gRes = await fetchUpstream(
        `https://aniwaves.ru/filter?keyword=${encodeURIComponent(romaji)}&page=1`,
        { headers: { Accept: 'text/html', Referer: 'https://aniwaves.ru/' } },
      )
      if (!gRes.ok) throw new Error(`aw filter ${gRes.status}`)
      const html = await gRes.text()
      const cands = []
      const seen = new Set()
      const fre = /href="\/watch\/([a-z0-9\-]+)-(\d+)"[^>]*>([^<]{1,120})<\/a>/gi
      let fm
      while ((fm = fre.exec(html)) !== null && cands.length < 30) {
        const id = Number(fm[2])
        const name = (fm[3] || '').trim()
        if (!Number.isFinite(id) || seen.has(id) || !name) continue
        seen.add(id)
        cands.push({ id, name })
      }
      if (!cands.length) throw new Error('aw no filter results')
      const rom = romaji.toLowerCase().trim()
      const eng = String(title.split('||')[1] || '').toLowerCase().trim()
      const score = (t) => {
        const n = (t || '').toLowerCase().trim()
        if (!n) return 0
        const vs = [rom, eng].filter(Boolean)
        if (vs.some((v) => v === n)) return 3
        if (vs.some((v) => v && (v.startsWith(n) || n.startsWith(v)))) return 2
        if (vs.some((v) => v && (v.includes(n) || n.includes(v)))) return 1
        return 0
      }
      cands.sort((a, b) => score(b.name) - score(a.name))
      const top = (cands.some((c) => score(c.name) > 0) ? cands.filter((c) => score(c.name) > 0) : cands).slice(0, 3)
      for (const c of top) {
        try {
          const eRes = await fetchUpstream(`https://aniwaves.ru/ajax/episode/list/${c.id}`, {
            headers: { Accept: '*/*', Referer: 'https://aniwaves.ru/', 'X-Requested-With': 'XMLHttpRequest' },
          })
          if (!eRes.ok) continue
          const eHtml = await eRes.text()
          const nums = [...eHtml.matchAll(/(?:ep-(\d+)|data-ep[^0-9]*(\d+)|>(\d{1,4})<)/gi)]
            .map((x) => Number(x[1] || x[2] || x[3])).filter((n) => Number.isFinite(n) && n > 0 && n < 5000)
          // Also try JSON wrapper {result: html}
          let count = nums.length ? Math.max(...nums) : 0
          if (!count) {
            try {
              const j = JSON.parse(eHtml)
              const h2 = j?.result || ''
              const n2 = [...h2.matchAll(/(?:ep-(\d+)|data-ep[^0-9]*(\d+)|>(\d{1,4})<)/gi)]
                .map((x) => Number(x[1] || x[2] || x[3])).filter((n) => Number.isFinite(n) && n > 0 && n < 5000)
              if (n2.length) count = Math.max(...n2)
            } catch {}
          }
          if (count > 0) {
            log({ ev: 'episodes', provider: 'aniwave', animeId: c.id, count })
            return sendJson(res, 200, {
              provider: 'aniwave',
              animeId: c.id,
              title: c.name,
              count,
              episodes: Array.from({ length: count }, (_, i) => ({ number: i + 1 })),
            }, origin)
          }
        } catch {}
      }
      throw new Error('aw no episodes found')
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200)
      log({ ev: 'episodes-fail', ms: 0, err: msg })
      return sendJson(res, 502, { error: 'EPISODES_FAILED', message: msg }, origin)
    }
  }

  // Authenticated resolution: returns resolver-signed delivery URLs.
  if (req.method === 'POST' && url.pathname === '/api/resolve') {
    if (!checkAuth(req)) return sendJson(res, 401, { error: 'Unauthorized' }, origin)
    if (!PUBLIC_URL || !SECRET) return sendJson(res, 500, { error: 'Resolver not configured (PUBLIC_URL/SECRET)' }, origin)
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON body' }, origin)
    }
    const anilistId = Number(body.anilistId)
    const episode = Number(body.episode)
    const language = body.language === 'dub' ? 'dub' : 'sub'
    const title = String(body.title || '')
    const provider = body.provider === 'aniwave' ? 'aniwave' : 'anikoto'
    if (!Number.isFinite(anilistId) || anilistId <= 0 || !Number.isFinite(episode) || episode <= 0) {
      return sendJson(res, 400, { error: 'anilistId + episode required' }, origin)
    }
    const t0 = Date.now()
    try {
      const r = provider === 'aniwave'
        ? await aniwaveResolve(anilistId, title, episode, language, req.signal)
        : await anikotoResolve(anilistId, title, episode, language, req.signal)
      const playlist = streamUrlFor(r.file)
      if (!playlist) throw new Error('URL signing unavailable')
      const subtitles = (r.subs || [])
        .map((t) => ({ label: t.label, file: streamUrlFor(t.file) }))
        .filter((t) => t.file)
      const kind = r.kind === 'mp4' ? 'mp4' : 'hls'
      log({ ev: 'resolve', provider, anilistId, episode, language, ms: Date.now() - t0, subs: subtitles.length })
      return sendJson(res, 200, {
        provider,
        url: playlist,
        type: kind,
        language,
        quality: 'auto',
        subtitles: subtitles.map((t) => ({ language: 'en', label: t.label, url: t.file })),
        intro: r.intro,
        outro: r.outro,
      }, origin)
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200)
      log({ ev: 'resolve-fail', anilistId, episode, language, ms: Date.now() - t0, err: msg })
      return sendJson(res, 502, { error: 'RESOLVE_FAILED', message: msg }, origin)
    }
  }

  // Signed delivery: playlists, segments, subtitles. Token + expiry + host
  // allowlist enforced BEFORE any upstream fetch. Streams body, no buffering.
  if (req.method === 'GET' && url.pathname === '/api/stream') {
    const target = verifyToken(url.searchParams.get('u'), url.searchParams.get('e'), url.searchParams.get('s'))
    if (!target) {
      res.writeHead(403, { ...corsHeaders(origin), 'Cache-Control': 'no-store' })
      res.end('Forbidden')
      return
    }
    let host
    try { host = new URL(target).hostname } catch {
      res.writeHead(400, { ...corsHeaders(origin) })
      res.end('Bad URL')
      return
    }
    if (!hostAllowed(host)) {
      log({ ev: 'stream-reject-host', host })
      res.writeHead(403, { ...corsHeaders(origin) })
      res.end('Host not allowed')
      return
    }
    if (await isPrivateHost(host)) {
      res.writeHead(403, { ...corsHeaders(origin) })
      res.end('Forbidden')
      return
    }
    const isPlaylist = /\.m3u8(\?|$)/i.test(target)
    // Playlists/VTT are small: cap to avoid abuse. Segments stream unbounded
    // but abort on client disconnect or provider stall.
    const ctrl = new AbortController()
    const onClose = () => ctrl.abort()
    req.on('close', onClose)
    const tid = setTimeout(() => ctrl.abort(), 60000)
    try {
      const up = await fetchUpstream(target, {
        headers: {
          Accept: '*/*',
          Referer: 'https://megaplay.buzz/',
          Origin: 'https://megaplay.buzz',
        },
        range: req.headers.range,
        timeoutMs: 60000,
      })
      if (!up.ok && up.status !== 206) {
        clearTimeout(tid)
        req.off('close', onClose)
        log({ ev: 'stream-upstream', host, status: up.status })
        res.writeHead(502, { ...corsHeaders(origin), 'Cache-Control': 'no-store' })
        res.end('Upstream failed')
        return
      }
      const ct = contentTypeFor(target, up.headers.get('content-type'))
      if (ct === 'text/html') {
        clearTimeout(tid)
        req.off('close', onClose)
        await up.body?.cancel().catch(() => {})
        log({ ev: 'stream-blocked', host })
        res.writeHead(502, { ...corsHeaders(origin), 'Cache-Control': 'no-store' })
        res.end('Upstream blocked')
        return
      }
      // Decide text vs binary by CONTENT SNIFFING, not URL/headers: variant
      // playlists often have no .m3u8 extension and arrive as
      // application/octet-stream. Buffer a small head, sniff for playlist /
      // VTT magic, then either process text (cap 5MB) or stream bytes.
      const reader = up.body?.getReader()
      if (!reader) throw new Error('no body')
      const headChunks = []
      let headLen = 0
      let upstreamDone = false
      try {
        while (headLen < 16384) {
          const { done, value } = await reader.read()
          if (done) { upstreamDone = true; break }
          if (value) { headChunks.push(value); headLen += value.length }
        }
      } catch (e) {
        reader.releaseLock?.()
        throw e
      }
      const headText = Buffer.concat(headChunks).toString('utf8').slice(0, 200)
      const isTextBody = /^\s*(#EXTM3U|WEBVTT)/i.test(headText)
      if (!isTextBody) {
        // Binary: write head + stream rest with Range passthrough, no buffering.
        const headers = {
          ...corsHeaders(origin),
          'Content-Type': ct,
          'Cache-Control': 'no-store',
          'Accept-Ranges': 'bytes',
        }
        const cr = up.headers.get('content-range')
        if (cr) headers['Content-Range'] = cr
        // Length unknown now (head buffered); use chunked unless upstream gave total.
        // Prefer correctness over Content-Length: omit it when head was consumed.
        log({ ev: 'stream-bin', host, ct, status: up.status, range: req.headers.range || '-' })
        res.writeHead(up.status, headers)
        try {
          for (const c of headChunks) {
            if (res.writableEnded) break
            res.write(c)
          }
          if (!upstreamDone) {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (res.writableEnded) break
              if (value) res.write(value)
            }
          }
          res.end()
        } catch {}
        try { reader.releaseLock() } catch {}
        clearTimeout(tid)
        req.off('close', onClose)
        return
      }
      {
        // Small text bodies: cap size, rewrite playlists, fix types.
        const rest = []
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
        clearTimeout(tid)
        req.off('close', onClose)
        if (total > 5 * 1024 * 1024) {
          res.writeHead(502, { ...corsHeaders(origin) })
          res.end('Too large')
          return
        }
        const text = Buffer.concat([...headChunks, ...rest]).toString('utf8')
        // Rewrite every URI line (absolute or relative-to-playlist) into a
        // signed proxy URL so hls.js never touches the CDN directly (it
        // can't send the required Referer, and raw hosts may be blocked).
        // Non-playlists (VTT) have no URI lines and pass through untouched.
        let outText = text
        let outCt = ct
        if (/^\s*#EXTM3U/i.test(text)) {
          outCt = 'application/vnd.apple.mpegurl'
          if (PUBLIC_URL && SECRET) {
            const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S
            outText = text.split('\n').map((line) => {
              const t = line.trim()
              if (!t || t.startsWith('#')) return line
              let abs
              try { abs = new URL(t, target).toString() } catch { return line }
              if (!/^https:\/\//.test(abs)) return line
              let h
              try { h = new URL(abs).hostname } catch { return line }
              if (!hostAllowed(h)) return line
              const { u, e, s } = signToken(abs, exp)
              return `${PUBLIC_URL}/api/stream?u=${encodeURIComponent(u)}&e=${encodeURIComponent(e)}&s=${s}`
            }).join('\n')
          }
        } else if (/WEBVTT/i.test(text.slice(0, 20))) {
          outCt = 'text/vtt'
        }
        const buf = Buffer.from(outText, 'utf8')
        log({ ev: 'stream-text', host, ct: outCt, bytes: buf.length, status: up.status })
        res.writeHead(up.status === 206 ? 206 : 200, {
          ...corsHeaders(origin),
          'Content-Type': outCt,
          'Content-Length': buf.length,
          'Cache-Control': 'no-store',
          'Accept-Ranges': 'bytes',
        })
        res.end(buf)
        return
      }
    } catch (e) {
      clearTimeout(tid)
      req.off('close', onClose)
      log({ ev: 'stream-error', host, err: String((e && e.message) || e).slice(0, 120) })
      if (!res.headersSent) {
        res.writeHead(502, { ...corsHeaders(origin), 'Cache-Control': 'no-store' })
        res.end('Fetch failed')
      } else try { res.end() } catch {}
      return
    }
  }

  return sendJson(res, 404, { error: 'Not found', available: ['GET /health', 'GET /api/diag', 'POST /api/resolve', 'GET /api/stream'] }, origin)
})

server.listen(PORT, () => {
  console.log(`aeri-stream-resolver listening on :${PORT} (secret configured: ${!!SECRET}, public: ${PUBLIC_URL || 'unset'})`)
})
