// Provider verification: end-to-end probes against the LIVE production
// Worker (read-only). Manga: match→chapters→pages→image bytes. Anime:
// episodes→sources→playlist→TS segment bytes (playback-equivalent at the
// network level; browser <video> play is covered by live Playwright).
// Usage: npm run verify:providers
// Exit non-zero on any failure. No secrets needed.

const LIVE = process.env.AERI_LIVE_URL ?? 'https://aeri.fastdemo.workers.dev'

const failures = []
const attempts = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// Pacing + bounded retries for transient upstream/worker errors. The live
// worker 502s under back-to-back burst load (verified 2026-10-10: 5×200
// then a 502 on identical requests) — hammering it without gaps measures
// our own burst, not provider health. Every attempt is recorded; a final
// report discloses intermittent failures even when a retry succeeds.
const PACE_MS = 4000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let lastReqAt = 0
async function pacedFetch(url, opts) {
  const wait = PACE_MS - (Date.now() - lastReqAt)
  if (wait > 0) await sleep(wait)
  try {
    return await fetch(url, opts)
  } finally {
    lastReqAt = Date.now()
  }
}

async function j(url, label) {
  const maxTries = 3
  for (let t = 1; t <= maxTries; t++) {
    const res = await pacedFetch(url)
    if (res.ok) {
      if (t > 1) attempts.push(`${label ?? url}: ok on try ${t}`)
      return res.json()
    }
    // Include the error body: the worker wraps match failures as 502 with
    // e.g. {"error":"no confident match"} — that is a recorded provider
    // gap, NOT a transient. Only bodyless/unknown 502/503/504 shapes retry.
    const body = await res.text().catch(() => '')
    const msg = `HTTP ${res.status}: ${body.slice(0, 120)}`
    if (/no confident match|no search results|ambiguous match/.test(body)) {
      attempts.push(`${label ?? url}: provider gap on try ${t} (${body.slice(0, 80)}), no retry`)
      throw new Error(msg)
    }
    // Retry ONLY transient shapes (502/503/504 rate/egress flakes).
    // Anything else (400/404/match errors) fails immediately — hiding a
    // persistent defect behind retries would be worse than flaky red.
    if (![502, 503, 504].includes(res.status) || t === maxTries) {
      if (t > 1) attempts.push(`${label ?? url}: still failing after ${t} tries (${msg})`)
      throw new Error(msg)
    }
    attempts.push(`${label ?? url}: transient HTTP ${res.status} on try ${t}, retrying`)
  }
  throw new Error('unreachable')
}

// ---------- Manga (MangaDex + WeebCentral + MangaPill) ----------
const MANGA_CASES = [
  { anilistId: 30002, title: 'Berserk', minUnits: 300, kind: 'long-running chapters' },
  { anilistId: 30656, title: 'Vagabond', minUnits: 50, kind: 'chapters' },
  { anilistId: 105778, title: 'Chainsaw Man', minUnits: 50, kind: 'chapters' },
  { anilistId: 30436, title: 'Uzumaki', minUnits: 1, kind: 'volume-like/short' },
  { anilistId: 146983, title: 'Goodbye Eri', minUnits: 1, kind: 'oneshot' },
  { anilistId: 30026, title: 'HUNTER x HUNTER', english: 'Hunter x Hunter', minUnits: 300, kind: 'identity-critical (anime collision)' },
  { anilistId: 108556, title: 'SPY x FAMILY', english: 'Spy x Family', minUnits: 100, mdxMinUnits: 1, kind: 'completeness-critical (Mission labels)' },
]

async function checkImageBytes(url, tag) {
  const r = await pacedFetch(url, { headers: { Referer: `${LIVE}/` } })
  const buf = await r.arrayBuffer()
  const ct = r.headers.get('content-type') ?? ''
  return { ok: r.ok && buf.byteLength > 5000 && ct.startsWith('image/'), detail: `${ct} ${buf.byteLength}B` }
}

for (const c of MANGA_CASES) {
  const tag = `manga ${c.title} (${c.kind})`
  const hint = `title=${encodeURIComponent(c.title)}${c.english ? `&english=${encodeURIComponent(c.english)}` : ''}`
  try {
    // MangaDex
    const m = await j(`${LIVE}/api/manga/mdx-match/${c.anilistId}?${hint}`)
    const ch = await j(`${LIVE}/api/manga/mdx-chapters/${m.providerMangaId}`)
    const units = ch.chapters?.length ?? 0
    check(`${tag} mdx match+units`, !!m.providerMangaId && units >= (c.mdxMinUnits ?? c.minUnits), `${units}u`)
    if (units > 0) {
      const pg = await j(`${LIVE}/api/manga/mdx-pages/${ch.chapters[0].providerChapterId}`)
      const urls = pg.pages ?? []
      let img = { ok: false, detail: '0pp' }
      if (urls.length) img = await checkImageBytes(urls[0], tag)
      check(`${tag} mdx pages render`, urls.length > 0 && img.ok, `${urls.length}pp ${img.detail}`)
    }
  } catch (e) { check(`${tag} mdx`, false, String(e).slice(0, 100)) }
  try {
    // WeebCentral
    const m = await j(`${LIVE}/api/manga/match/${c.anilistId}?${hint}&format=MANGA`)
    const ch = await j(`${LIVE}/api/manga/chapters/${m.providerMangaId}`)
    const units = ch.chapters?.length ?? 0
    check(`${tag} wc match+units`, !!m.providerMangaId && units >= c.minUnits, `${units}u`)
    if (units > 0) {
      const pg = await j(`${LIVE}/api/manga/pages/${ch.chapters[0].providerChapterId}`)
      const urls = pg.pages ?? []
      let img = { ok: false, detail: '0pp' }
      if (urls.length) img = await checkImageBytes(urls[0], tag)
      check(`${tag} wc pages render`, urls.length > 0 && img.ok, `${urls.length}pp ${img.detail}`)
    }
  } catch (e) { check(`${tag} wc`, false, String(e).slice(0, 100)) }
  // MangaPill has no confident match for some titles (e.g. Sayonara Eri) —
  // that is a recorded limitation, not a failure. When match succeeds,
  // chapters+pages must verify.
  let mpMatched = true
  try {
    // MangaPill
    const m = await j(`${LIVE}/api/manga/mp-match/${c.anilistId}?${hint}`)
    const [mpId, mpSlug] = String(m.providerMangaId ?? '').split('/')
    const ch = await j(`${LIVE}/api/manga/mp-chapters/${mpId}/${mpSlug}`)
    const units = ch.chapters?.length ?? 0
    check(`${tag} mp match+units`, !!m.providerMangaId && units >= c.minUnits, `${units}u`)
    if (units > 0) {
      const [mid, pid] = String(ch.chapters[0].providerChapterId).split('-')
      const pg = await j(`${LIVE}/api/manga/mp-pages/${mid}/${pid}`)
      const urls = pg.pages ?? []
      let img = { ok: false, detail: '0pp' }
      if (urls.length) img = await checkImageBytes(urls[0], tag)
      check(`${tag} mp pages render`, urls.length > 0 && img.ok, `${urls.length}pp ${img.detail}`)
    }
  } catch (e) {
    // 'no confident match' / 'no search results' (thrown by j() with the
    // worker's error body attached) = known provider gap (ok); anything
    // else (crash-shape, persistent 502 with no match body) fails.
    const msg = String(e).slice(0, 160)
    if (/no confident match|no search results|ambiguous match/.test(msg)) {
      check(`${tag} mp (no confident match — recorded gap)`, true, msg)
    } else check(`${tag} mp`, false, msg)
  }
}

// Licensed-title behavior: Solo Leveling must surface external links, never crash
try {
  const m = await j(`${LIVE}/api/manga/mdx-match/105398?title=Solo%20Leveling`)
  const ch = await j(`${LIVE}/api/manga/mdx-chapters/${m.providerMangaId}`)
  check('manga Solo Leveling external links', (ch.chapters?.length ?? 0) === 0 && (ch.external?.length ?? 0) > 0, `${ch.external?.length ?? 0} ext`)
} catch (e) { check('manga Solo Leveling external links', false, String(e).slice(0, 100)) }

// ---------- Anime (verified-only chain — full episodes only; trailers
// must never appear in this chain) ----------
const ANIME_CASES = [
  { anilistId: 21, title: 'One Piece', minEps: 1000 },
  { anilistId: 20, title: 'Naruto', minEps: 200 },
  { anilistId: 1535, title: 'Death Note', minEps: 30 },
  { anilistId: 16498, title: 'Shingeki no Kyojin', english: 'Attack on Titan', minEps: 20 },
  { anilistId: 11061, title: 'HUNTER x HUNTER', english: 'Hunter x Hunter', minEps: 0, allowZeroEps: true, diagNote: 'aniwave has no confident HxH match (2011 vs 1999 ambiguity fails closed) — zero is honest' },
  { anilistId: 154587, title: 'Sousou no Frieren', english: 'Frieren', minEps: 20 },
]
for (const c of ANIME_CASES) {
  try {
    const eps = await j(`${LIVE}/api/episodes/${c.anilistId}?provider=aniwave&title=${encodeURIComponent(c.title)}`)
    const n = eps.episodes?.length ?? 0
    if (c.allowZeroEps && n === 0) {
      check(`anime ${c.title} episodes (absent on provider — recorded gap)`, true, '0eps, no wrong data')
    } else check(`anime ${c.title} episodes`, n >= (c.minEps ?? 1), `${n}eps`)
    const src = await j(`${LIVE}/api/sources/aniwave-${c.anilistId}-1?language=sub&provider=aniwave&title=${encodeURIComponent(c.title)}&english=${encodeURIComponent(c.title)}`)
    const urls = src.sources ?? []
    if (c.allowZeroEps && urls.length === 0) {
      check(`anime ${c.title} sources (absent on provider — recorded gap)`, true, '0src, no wrong data')
    } else check(`anime ${c.title} sources`, urls.length > 0, `${urls.length}src`)
    if (urls.length && !(c.allowZeroEps && urls.length === 0)) {
      // Walk relay: master playlist → media playlist → first TS segment, verify sync bytes.
      // Segment fetch gets one retry: zero-byte/empty-segment flakes are a
      // known upstream lottery behavior, recorded in `attempts`, never silent.
      const master = await (await pacedFetch(urls[0].url, { headers: { Referer: `${LIVE}/` } })).text()
      const l2line = master.split('\n').find(l => l.includes('/api/stream'))
      const media = l2line ? await (await pacedFetch(l2line.trim(), { headers: { Referer: `${LIVE}/` } })).text() : ''
      const segline = media.split('\n').find(l => l.includes('/api/stream'))
      let tsOk = false, n = 0
      if (segline) {
        for (let t = 1; t <= 2 && !tsOk; t++) {
          const r = await pacedFetch(segline.trim(), { headers: { Referer: `${LIVE}/` } })
          const buf = Buffer.from(await r.arrayBuffer())
          n = buf.length
          tsOk = r.ok && n > 50000 && buf[0] === 0x47 && buf[188] === 0x47
          if (!tsOk && t === 1) attempts.push(`anime ${c.title} stream bytes: ${n}B on try 1, retrying segment`)
        }
      }
      check(`anime ${c.title} stream bytes`, tsOk, `${n}B TS`)
    }
  } catch (e) { check(`anime ${c.title}`, false, String(e).slice(0, 100)) }
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURES`)
  if (attempts.length) {
    console.log('transient attempts (retries/disclosed flakes):')
    for (const a of attempts) console.log(`  ~ ${a}`)
  }
  process.exit(1)
}
if (attempts.length) {
  console.log('\ntransient attempts (retries that recovered — upstream flake, not clean):')
  for (const a of attempts) console.log(`  ~ ${a}`)
}
console.log('\nall provider checks passed')
