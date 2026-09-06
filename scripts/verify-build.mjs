// Fails the build if required public env vars didn't bake into the bundle.
// Run AFTER `npm run build` (CI + local). This is the automatic version of
// the RELEASING.md preflight: two login outages shipped because deploys were
// built without VITE_AUTH_API_URL / VITE_MAL_CLIENT_ID.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const required = ['VITE_AUTH_API_URL', 'VITE_MAL_CLIENT_ID', 'VITE_ANILIST_CLIENT_ID']
const missing = required.filter((k) => !String(process.env[k] ?? '').trim())
if (missing.length) {
  console.error(`verify-build: missing env: ${missing.join(', ')}`)
  process.exit(1)
}
const assetsDir = join(dist, 'assets')
if (!existsSync(assetsDir)) {
  console.error('verify-build: dist/assets missing — run npm run build first')
  process.exit(1)
}
const js = readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
const bundle = js.map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n')
let failed = false
for (const k of required) {
  const value = String(process.env[k]).trim()
  // Client IDs are long hex; the auth URL is distinctive by host. Check a
  // stable substring so formatting differences can't false-pass.
  const needle = k === 'VITE_AUTH_API_URL'
    ? (() => { try { return new URL(value).host } catch { return value } })()
    : value.slice(0, 8)
  if (!needle || !bundle.includes(needle)) {
    console.error(`verify-build: bundle missing baked ${k} (looked for "${needle}")`)
    failed = true
  } else {
    console.log(`verify-build: ${k} baked OK`)
  }
}
// Secret VALUES must never appear in the client bundle (only their names
// inside error-message strings, which is harmless).
for (const k of ['ANILIST_CLIENT_SECRET', 'MAL_CLIENT_SECRET']) {
  const secret = String(process.env[k] ?? '')
  if (secret && bundle.includes(secret)) {
    console.error(`verify-build: SECRET LEAK — ${k} value found in bundle`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
