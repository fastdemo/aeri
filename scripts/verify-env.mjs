// Pre-build gate: refuse to compile a production bundle without the IDs that
// login depends on. A successful `vite build` here does NOT mean the bundle
// is shippable — without these, the app builds fine and then fails at login
// time with no build error. CI sets them via workflow env; local shells must
// source .env first.
const required = ['VITE_AUTH_API_URL', 'VITE_MAL_CLIENT_ID', 'VITE_ANILIST_CLIENT_ID']
const missing = required.filter((k) => !String(process.env[k] ?? '').trim())
if (missing.length) {
  console.error(`\nREFUSING TO BUILD — missing env: ${missing.join(', ')}`)
  console.error('Local: `set -a; source .env; set +a` first (see .env.example).')
  console.error('Otherwise push and let CI build+deploy — do NOT `wrangler deploy` a bundle built without these.\n')
  process.exit(1)
}
console.log('prebuild: required VITE_* present')
