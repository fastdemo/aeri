// Streaming benchmark: reproducible per-provider/CDN measurements.
// Usage: node scripts/bench-stream.mjs [BASE_URL]
// Measures (production by default): resolve, playlist, variant, then the SAME
// segments direct-to-CDN vs via-worker (signed URLs). No secrets needed.
// Output: JSON to stdout + markdown matrix to stderr (or file via redirect).
const BASE = process.argv[2] ?? 'https://aeri.fastdemo.workers.dev'

const CASES = [
  { provider: 'aniwave', anilistId: 1, episode: 1, title: 'Cowboy Bebop', label: 'Bebop E1' },
  { provider: 'aniwave', anilistId: 1, episode: 2, title: 'Cowboy Bebop', label: 'Bebop E2' },
  { provider: 'anikoto', anilistId: 1, episode: 1, title: 'Cowboy Bebop', label: 'Bebop E1 (ank)' },
  { provider: 'aniwave', anilistId: 154587, episode: 1, title: 'Sousou no Frieren', label: 'Frieren E1' },
]

async function timedFetch(url, init = {}, timeoutMs = 90000) {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs)
  const t0 = Date.now()
  let ttfb = -1
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    ttfb = Date.now() - t0
    const buf = Buffer.from(await res.arrayBuffer())
    const total = Date.now() - t0
    return { status: res.status, headers: res.headers, bytes: buf, totalMs: total, ttfbMs: ttfb, buf }
  } finally { clearTimeout(tid) }
}

function decodeTarget(signedUrl) {
  const q = new URL(signedUrl).searchParams
  const u = q.get('u') || ''
  const b64 = u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (u.length % 4)) % 4)
  return Buffer.from(b64, 'base64').toString('utf8')
}

function parseMaster(text) {
  const variants = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#EXT-X-STREAM-INF:(.*)/)
    if (m && lines[i + 1] && !lines[i + 1].startsWith('#')) {
      const attrs = m[1]
      const bw = /BANDWIDTH=(\d+)/.exec(attrs)?.[1]
      const res = /RESOLUTION=([\dx]+)/.exec(attrs)?.[1]
      variants.push({ bandwidth: bw ? Number(bw) : null, resolution: res || null, uri: lines[i + 1].trim() })
    }
  }
  return variants
}

function classify(buf) {
  if (buf.length >= 188 && buf[0] === 0x47) return 'MPEG-TS'
  if (buf.length >= 12 && buf.subarray(4, 8).toString() === 'ftyp') return 'MP4-fragment'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'PNG (poison?)'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'JPEG (poison?)'
  if (buf.subarray(0, 7).toString().startsWith('#EXTM3U')) return 'playlist-nested'
  if (buf.subarray(0, 6).toString() === 'WEBVTT') return 'VTT'
  if (buf.subarray(0, 3).toString() === 'ID3') return 'ID3-timed-meta'
  return 'unknown(' + buf.subarray(0, 4).toString('hex') + ')'
}

function segUris(variantText, limit = 2) {
  return variantText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, limit)
}

const results = []
for (const c of CASES) {
  const r = { case: c.label, provider: c.provider, ok: false }
  try {
    const srcUrl = `${BASE}/api/sources/${c.provider}-${c.anilistId}-${c.episode}?language=sub&provider=${c.provider}&title=${encodeURIComponent(c.title)}`
    const t0 = Date.now()
    const sj = await (await fetch(srcUrl, { signal: AbortSignal.timeout(60000) })).json()
    r.resolveMs = Date.now() - t0
    const src = (sj?.sources || [])[0]
    if (!src?.url) { r.error = 'no source'; results.push(r); continue }
    r.providerTitle = sj?.providerTitle ?? null
    r.providerAnimeId = sj?.providerAnimeId ?? null
    const pl = await timedFetch(src.url)
    r.playlistMs = pl.totalMs
    r.playlistTtfbMs = pl.ttfbMs
    r.playlistBytes = pl.bytes.length
    const plText = pl.buf.toString('utf8')
    r.variants = parseMaster(plText)
    // variant URL = first URI line (master) or the playlist itself (media)
    let variantUrl = src.url
    if (r.variants.length) {
      variantUrl = new URL(r.variants[0].uri, src.url).toString()
      // NOTE: master URI lines are already signed by the worker rewrite; if a
      // variant ever arrives unsigned (direct CDN), resolve relative to playlist target
      if (!variantUrl.includes('/api/stream')) {
        try { variantUrl = new URL(r.variants[0].uri, decodeTarget(src.url)).toString() } catch {}
      }
    }
    const v = await timedFetch(variantUrl)
    r.variantMs = v.totalMs
    r.variantBytes = v.bytes.length
    const vText = v.buf.toString('utf8')
    const segs = segUris(vText, 2)
    r.segments = []
    for (const sUri of segs) {
      const workerSeg = sUri.startsWith('http') ? sUri : new URL(sUri, variantUrl).toString()
      const target = workerSeg.includes('/api/stream') ? decodeTarget(workerSeg) : workerSeg
      const via = await timedFetch(workerSeg)
      const direct = await timedFetch(target, { headers: { Referer: 'https://megaplay.buzz/', 'User-Agent': 'Mozilla/5.0' } })
      const host = new URL(target).hostname
      r.segments.push({
        host,
        bytes: via.bytes.length,
        workerMs: via.totalMs, workerTtfbMs: via.ttfbMs,
        workerKBs: via.bytes.length / 1024 / (via.totalMs / 1000),
        directMs: direct.totalMs, directTtfbMs: direct.ttfbMs,
        directKBs: direct.bytes.length / 1024 / (direct.totalMs / 1000),
        identical: via.bytes.equals(direct.bytes),
        workerCt: via.headers.get('content-type'),
        kind: classify(via.buf),
      })
    }
    r.ok = true
  } catch (e) {
    r.error = String((e && e.message) || e).slice(0, 160)
  }
  results.push(r)
}

console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1))

// markdown matrix to stderr
const err = (s) => process.stderr.write(s + '\n')
err('\n| Case | Resolve | Playlist | Seg host | Seg bytes | Direct KB/s | Worker KB/s | Identical | Kind | Variants |')
err('|---|---|---|---|---|---|---|---|---|---|')
for (const r of results) {
  if (!r.ok) { err(`| ${r.case} | FAIL ${r.error || ''} | | | | | | | | |`); continue }
  const s0 = (r.segments || [])[0] || {}
  const v = (r.variants || []).map((x) => `${x.resolution || '?'}@${x.bandwidth ? Math.round(x.bandwidth / 1000) + 'k' : '?'}`).join(', ') || 'single'
  err(`| ${r.case} | ${r.resolveMs}ms | ${r.playlistMs}ms | ${s0.host || '?'} | ${s0.bytes ?? '?'} | ${s0.directKBs?.toFixed(1) ?? '?'} | ${s0.workerKBs?.toFixed(1) ?? '?'} | ${s0.identical ?? '?'} | ${s0.kind ?? '?'} | ${v} |`)
}
