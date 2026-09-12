// Post-deploy live check: confirms the serving bundle matches expectations.
// Usage: npm run verify:live  (no secrets needed — read-only probes)
const LIVE = process.env.AERI_LIVE_URL ?? 'https://aeri.fastdemo.workers.dev'

async function getText(url, init) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.text()
}

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

try {
  const html = await getText(`${LIVE}/`)
  const asset = html.match(/assets\/index-[^"]+\.js/)?.[0]
  check('root serves index', !!asset, asset ?? 'no bundle ref')
  if (!asset) throw new Error('no bundle to check')

  const js = await getText(`${LIVE}/${asset}`)
  check('auth-proxy URL baked', js.includes('aeri.fastdemo.deno.net'), 'AniList login needs it')
  check('MAL client ID baked', js.includes('ce55a1d5'), 'MAL login needs it')
  check('plain PKCE active', /code_challenge_method.{0,16}plain/.test(js), 'S256 breaks MAL login')
} catch (e) {
  check('live reachable', false, String(e))
  process.exit(1)
}

// Provider title matching (D068): the resolver must map each AniList ID to
// the SAME show on the provider — never the first search result. Romaji-only
// titles are the weakest input, so they are the strongest test.
const MATCH_CASES = [
  { anilistId: 1, romaji: 'Cowboy Bebop', want: 'bebop' },
  { anilistId: 16498, romaji: 'Shingeki no Kyojin', want: 'attack on titan' },
  { anilistId: 154587, romaji: 'Sousou no Frieren', want: 'frieren' },
  { anilistId: 20, romaji: 'Naruto', want: 'naruto' },
]
// Upstream CDNs throttle in windows; one retry separates a transient blip
// (pass) from a real matching regression (fail twice = fail).
async function fetchMatch(c, attempt) {
  const u = `${LIVE}/api/sources/aniwave-${c.anilistId}-1?language=sub&provider=aniwave&title=${encodeURIComponent(c.romaji)}${attempt > 0 ? `&retry=${attempt}` : ''}`
  const res = await fetch(u)
  if (!res.ok) return { http: res.status, json: null }
  return { http: 200, json: await res.json().catch(() => null) }
}
try {
  for (const c of MATCH_CASES) {
    let got = '', n = 0, ep = '', detail = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 5000))
      try {
        const { http, json: j } = await fetchMatch(c, attempt)
        if (http !== 200) { detail = `HTTP ${http}`; continue }
        got = String(j?.providerTitle || '')
        n = j?.sources?.length ?? 0
        ep = String(j?.episode)
        if (n > 0 && got.toLowerCase().includes(c.want) && ep === '1') break
        detail = JSON.stringify(j)?.slice(0, 160)
      } catch (e) { detail = String(e).slice(0, 120) }
    }
    const ok = n > 0 && got.toLowerCase().includes(c.want) && ep === '1'
    check(`match ${c.romaji} → provider "${got.slice(0, 44)}"`, ok, ok ? '' : (detail || 'no source'))
  }
} catch (e) {
  check('matching probes', false, String(e))
}
process.exit(failures.length ? 1 : 0)
