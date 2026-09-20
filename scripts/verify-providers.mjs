// Provider verification: end-to-end probes against the LIVE production
// Worker (read-only). Manga: match→chapters→pages→image bytes. Anime:
// episodes→sources→playlist→TS segment bytes (playback-equivalent at the
// network level; browser <video> play is covered by live Playwright).
// Usage: npm run verify:providers
// Exit non-zero on any failure. No secrets needed.

const LIVE = process.env.AERI_LIVE_URL ?? 'https://aeri.fastdemo.workers.dev'

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

async function j(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ---------- Manga ----------
const MANGA_CASES = [
  { anilistId: 30002, title: 'Berserk', minUnits: 300, kind: 'long-running chapters' },
  { anilistId: 30656, title: 'Vagabond', minUnits: 50, kind: 'chapters' },
  { anilistId: 105778, title: 'Chainsaw Man', minUnits: 50, kind: 'chapters' },
  { anilistId: 30436, title: 'Uzumaki', minUnits: 1, kind: 'volume-like/short' },
  { anilistId: 146983, title: 'Goodbye Eri', minUnits: 1, kind: 'oneshot' },
]

for (const c of MANGA_CASES) {
  const tag = `manga ${c.title} (${c.kind})`
  try {
    // MangaDex
    const m = await j(`${LIVE}/api/manga/mdx-match/${c.anilistId}?title=${encodeURIComponent(c.title)}`)
    const ch = await j(`${LIVE}/api/manga/mdx-chapters/${m.providerMangaId}`)
    const units = ch.chapters?.length ?? 0
    check(`${tag} mdx match+units`, !!m.providerMangaId && units >= c.minUnits, `${units}u`)
    if (units > 0) {
      const pg = await j(`${LIVE}/api/manga/mdx-pages/${ch.chapters[0].providerChapterId}`)
      const urls = pg.pages ?? []
      let imgOk = false, ct = ''
      if (urls.length) {
        const r = await fetch(urls[0], { headers: { Referer: `${LIVE}/` } })
        const buf = await r.arrayBuffer()
        ct = r.headers.get('content-type') ?? ''
        imgOk = r.ok && buf.byteLength > 5000 && ct.startsWith('image/')
      }
      check(`${tag} mdx pages render`, urls.length > 0 && imgOk, `${urls.length}pp ${ct}`)
    }
  } catch (e) { check(`${tag} mdx`, false, String(e).slice(0, 100)) }
  try {
    // WeebCentral
    const m = await j(`${LIVE}/api/manga/match/${c.anilistId}?title=${encodeURIComponent(c.title)}&format=MANGA`)
    const ch = await j(`${LIVE}/api/manga/chapters/${m.providerMangaId}`)
    const units = ch.chapters?.length ?? 0
    check(`${tag} wc match+units`, !!m.providerMangaId && units >= c.minUnits, `${units}u`)
    if (units > 0) {
      const pg = await j(`${LIVE}/api/manga/pages/${ch.chapters[0].providerChapterId}`)
      const urls = pg.pages ?? []
      let imgOk = false, ct = ''
      if (urls.length) {
        const r = await fetch(urls[0], { headers: { Referer: `${LIVE}/` } })
        const buf = await r.arrayBuffer()
        ct = r.headers.get('content-type') ?? ''
        imgOk = r.ok && buf.byteLength > 5000 && ct.startsWith('image/')
      }
      check(`${tag} wc pages render`, urls.length > 0 && imgOk, `${urls.length}pp ${ct}`)
    }
  } catch (e) { check(`${tag} wc`, false, String(e).slice(0, 100)) }
}

// Licensed-title behavior: Solo Leveling must surface external links, never crash
try {
  const m = await j(`${LIVE}/api/manga/mdx-match/105398?title=Solo%20Leveling`)
  const ch = await j(`${LIVE}/api/manga/mdx-chapters/${m.providerMangaId}`)
  check('manga Solo Leveling external links', (ch.chapters?.length ?? 0) === 0 && (ch.external?.length ?? 0) > 0, `${ch.external?.length ?? 0} ext`)
} catch (e) { check('manga Solo Leveling external links', false, String(e).slice(0, 100)) }

// ---------- Anime (aniwave verified; official = trailer by design) ----------
const ANIME_CASES = [
  { anilistId: 21, title: 'One Piece' },
  { anilistId: 20, title: 'Naruto' },
  { anilistId: 1535, title: 'Death Note' },
]
for (const c of ANIME_CASES) {
  try {
    const eps = await j(`${LIVE}/api/episodes/${c.anilistId}?provider=aniwave&title=${encodeURIComponent(c.title)}`)
    const n = eps.episodes?.length ?? 0
    check(`anime ${c.title} episodes`, n > 0, `${n}eps`)
    const src = await j(`${LIVE}/api/sources/aniwave-${c.anilistId}-1?language=sub&provider=aniwave&title=${encodeURIComponent(c.title)}&english=${encodeURIComponent(c.title)}`)
    const urls = src.sources ?? []
    check(`anime ${c.title} sources`, urls.length > 0, `${urls.length}src`)
    if (urls.length) {
      // Walk relay: master playlist → media playlist → first TS segment, verify sync bytes
      const master = await (await fetch(urls[0].url, { headers: { Referer: `${LIVE}/` } })).text()
      const l2line = master.split('\n').find(l => l.includes('/api/stream'))
      const media = l2line ? await (await fetch(l2line.trim(), { headers: { Referer: `${LIVE}/` } })).text() : ''
      const segline = media.split('\n').find(l => l.includes('/api/stream'))
      let tsOk = false, n = 0
      if (segline) {
        const r = await fetch(segline.trim(), { headers: { Referer: `${LIVE}/` } })
        const buf = Buffer.from(await r.arrayBuffer())
        n = buf.length
        tsOk = r.ok && n > 50000 && buf[0] === 0x47 && buf[188] === 0x47
      }
      check(`anime ${c.title} stream bytes`, tsOk, `${n}B TS`)
    }
  } catch (e) { check(`anime ${c.title}`, false, String(e).slice(0, 100)) }
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURES`)
  process.exit(1)
}
console.log('\nall provider checks passed')
