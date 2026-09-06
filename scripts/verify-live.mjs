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
  check('auth-proxy URL baked', js.includes('graceful-dream'), 'AniList login needs it')
  check('MAL client ID baked', js.includes('ce55a1d5'), 'MAL login needs it')
  check('plain PKCE active', /code_challenge_method.{0,16}plain/.test(js), 'S256 breaks MAL login')
} catch (e) {
  check('live reachable', false, String(e))
  process.exit(1)
}
process.exit(failures.length ? 1 : 0)
