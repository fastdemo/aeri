# Security — Aeri

## Secrets (values never in code, bundles, logs, chat)

| Secret | Lives in | Consumed |
|---|---|---|
| `ANILIST_CLIENT_SECRET` | Worker prod env + Deno project env | server-side token exchange only |
| `MAL_CLIENT_SECRET` | Worker prod env (if confidential app) | `/mal/token` injection |
| `RESOLVER_SECRET` | Worker prod env | HMAC stream signing + `/api/diag` bearer |
| `CLOUDFLARE_API_TOKEN` etc. | CI/repo secrets (owner) | deploys |

Verify absence with bundle greps (error-string *names* like
`CLIENT_SECRET` may appear; *values* must not).

## Auth

- AniList: Authorization Code + state; browser never sees secret; tokens in
  `aeri:anilist:*` storage; `last_code` dedup; failures clean URL+state.
- MAL: PKCE `plain` (verifier=challenge); same storage/cleanup discipline.
- Callback isolation via state matching (both use `?code=`).
- OAuth-return popup reopen via `sessionStorage` (no token in URL).

## Streaming integrity

- Signed `/api/stream?u&e&s`: HMAC-SHA256 (SubtleCrypto), 6h expiry,
  const-time compare, https-only, ≤2048 chars. No token = no fetch.
- `hostAllowed`: suffix allowlist + rotation regexes (echovideo/roburn/
  dpopdrop/megaplay/anikoto/vidnest/aniwaves/pahe…). Unknown hosts rejected
  (logged as `mint-reject-host`).
- SSRF: DoH A/AAAA lookup, private-range reject (v4/v6, localhost),
  fail-closed, 5-min DNS cache (bounded 1000).
- Relay: Range passthrough, 120s cap, 5MB text cap, `text/html` → 502,
  client-abort propagation. No DRM/CAPTCHA/encryption-bypass, ever.
- Matching: threshold 40, episode/type/year checks, `ani_id` verify,
  ambiguous → throw. Wrong-show playback is treated as a security-grade bug.

## Platform

- CORS: `ALLOWED_ORIGIN` allowlist (prod = worker origin) + Range/auth
  headers; MAL proxied because it sends no CORS headers.
- User data: stays in browser (IDB/localStorage); tokens never logged;
  diagnostics are counters only (`getAnilistStats`).
- No torrents, no open proxy (`/proxy` allowlisted), no IP rotation, no
  fake clients, no multi-endpoint request fanning.
