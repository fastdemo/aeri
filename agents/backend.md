# Backend — Cloudflare Worker `aeri`

Production: `https://aeri.fastdemo.workers.dev/` — serves `dist/` + same-origin
`/api/*`. Never deploy production to `aeri-production`. Local preview has no
Worker (use `customVideoApiUrl` → production for provider paths; manga
provider falls back to production Worker automatically on localhost).

## Entry / config

- `worker/src/index.ts` (~660 lines), `worker/wrangler.toml`
  (`name = "aeri-video"`).
- Env: `ALLOWED_ORIGIN` (production = worker origin; preview = `*`),
  `PROXY_ALLOWLIST` (subtitle/CDN hosts), secrets `ANILIST_CLIENT_SECRET`,
  `MAL_CLIENT_SECRET`, `RESOLVER_SECRET` (all via `wrangler secret put` —
  never in code/bundles).
- `compatibility_date 2025-09-01`, `nodejs_compat`.

## Routes

| Method/path | Purpose |
|---|---|
| `GET /health`, `/api/health`, `/api/video/health` | health + provider capability list |
| `GET /[api/][video/]map/:anilistId` | title lookup (best-effort AniList + AllAnime), cached 1h |
| `GET /[api/][video/]episodes/:anilistId?provider=&title=&…` | per-provider episode list (pinned provider or official→demo fallback), cached 1h |
| `GET /[api/][video/]sources\|watch/<path>?provider=&language=&title=&english=&native=&episodes=&format=&year=` | source resolution; **pinned `?provider=` tries ONLY that provider and fails fast** (no worker-side cascade), cached 60s |
| `POST /anilist/token`, `/api/anilist/token` | AniList code exchange (injects `ANILIST_CLIENT_SECRET`); maps CF 403 to structured `ANILIST_IP_BLOCKED` |
| `POST /mal/token`, `/api/mal/token` | MAL exchange (injects `MAL_CLIENT_SECRET`) |
| `GET/PUT /mal/api/*`, `/api/mal/*` | MAL REST proxy (forwards auth/body) |
| `GET /proxy`, `/api/proxy` | allowlisted generic proxy (subtitles etc.), 1h cache |
| `GET /api/stream`, `/stream?u&e&s` | **signed delivery** (see streaming.md) |
| `GET /api/manga/match/:anilistId?title=&english=&native=&chapters=&volumes=&year=` | WeebCentral series match (fail-closed scoring, threshold 40, ambiguous→error), cached 10m |
| `GET /api/manga/chapters/:providerMangaId` | chapter list (provider chapters, never volumes), cached 5m |
| `GET /api/manga/pages/:providerChapterId` | page URLs re-signed to same-origin `/api/manga/img`, cached 5m |
| `GET /api/manga/img?u&e&s` | **signed manga image relay** (HMAC+expiry, planeptune/compsci88 only, byte-sniffed content-type) |
| `GET /api/diag` | bearer-`RESOLVER_SECRET` self-test (resolve + allowlist + CDN) |
| `GET /api/debug/provider-test?url=` | unauthenticated egress probe (used for provider research) |
| others | SPA fallback via `ASSETS`; 404 lists available endpoints |

## Provider routing details

- 10 providers instantiated in order (official, anikoto, aniwave,
  animepahe, miruro-alias, allanime-stub, megaplay-stub, animeparadise-stub,
  anineko-stub, demo); `priorityProviders = [official, miruro, demo]`.
- Episodes route: pinned provider tried with 5s timeout; else official, then
  demo fallback.
- Sources route: hint validation (`numParam`, year < 3000); pinned-only fast
  path; else ordered cascade; `sortByLanguageAndQuality` (preferred lang,
  1080>720>480>360, embeds first); demo **never** auto-included (explicit
  `?provider=demo` only).
- `parseSourceRequest` accepts `watch/<provider>/<id>/<lang>/<ep>` and
  `<provider>[-anilist]-<id>-<ep>` dash forms.

## CORS

`ALLOWED_ORIGIN` allowlist or `*`; allows Content-Type, Authorization,
Range, `X-MAL-CLIENT-ID`; exposes Content-Length/Range. Loopback dev origins
(`http://localhost:*`, `http://127.0.0.1:*`) are echoed explicitly (never `*`)
so local preview can call production APIs. Worker→AniList
GraphQL is expected to 403 (documented; browser does metadata instead).

## Errors

JSON `{error}` with `no-store`; upstream failures → 502 `Upstream
failed/blocked`; oversize text → `Too large`; `/api/stream` without valid
token → 403.
