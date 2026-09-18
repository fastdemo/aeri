# Architecture — Aeri

```mermaid
flowchart TB
    subgraph Browser
        UI[React 19 SPA<br/>HashRouter #/]
        UI --> Hooks[hooks + contexts<br/>useAnimeMetadata, useSeriesGroup,<br/>AniList/MAL/TrackingContext]
        Hooks --> Clients[API clients<br/>anilistGraphQL, malFetch]
        Clients --> AL[(AniList GraphQL<br/>graphql.anilist.co)]
        Clients --> CF1[same-origin /api/*]
    end
    subgraph Cloudflare["Cloudflare Worker: aeri"]
        CF1 --> API[Worker routes<br/>video, auth, proxy, stream]
        API --> MAL[(MAL API<br/>api.myanimelist.net)]
        API --> ANILIST_AUTH[(anilist.co OAuth token)]
        API --> PROV[provider sites<br/>aniwaves.ru, anikotoapi.site,<br/>megaplay.buzz, animepahe.ru]
        API --> CDN[(video CDNs<br/>echovideo, roburn, dpopdrop...)]
        API --> Player[VideoPlayer<br/>hls.js / native HLS]
    end
    UI --> Player
    CDN --> Player
```

The static frontend (`dist/`) is served by the **same Worker** that exposes
`/api/*`, so production is same-origin (no CORS gap). Localhost preview has
no Worker, so provider calls need `customVideoApiUrl` pointed at production.

## Frontend runtime

- Vite 8 + React 19 + TypeScript strict + Tailwind v4 (`@tailwindcss/vite`).
- `src/main.tsx`: applies persisted theme **before first render** (no flash),
  early MAL OAuth `?code=` handling, then renders `<App/>`.
- `src/App.tsx`: `HashRouter` (required — no server rewrites on Workers static
  hosting), providers `AniList → MAL → Tracking`, `Layout` (Navbar + Routes +
  footer). Routes: `/`, `/browse`, `/search`, `/list`, `/anime/:id`,
  `/watch/:id/:episode`, `/settings`, `/manga`, `/profile` (placeholder),
  `*` → 404.

## Backend runtime

- Cloudflare Worker `aeri` (`worker/src/index.ts`), `compatibility_date`
  2025-09-01, `nodejs_compat`. Serves `dist/` assets + SPA fallback.
- See `backend.md` for routes, `streaming.md` for the video path.

## Request boundaries

| Boundary | Direction | Notes |
|---|---|---|
| Browser → AniList GraphQL | direct POST | CORS-open; all metadata/seasons/search |
| Browser → MAL REST | **blocked by CORS** | must go through Worker `/mal/api/*`, `/mal/token` |
| Browser → provider sites | blocked/challenged | Worker resolves server-side instead |
| Browser → video CDNs | signed URLs only | via Worker `/api/stream` relay (Range passthrough, playlist rewrite) |
| Browser → AniList token endpoint | never direct | secret lives in Worker/Deno only |

## External services

- **AniList GraphQL** (`graphql.anilist.co`): metadata backbone. Reduced
  ~30 req/min limit + burst limiter; honored via shared cooldown (see
  `anilist.md`).
- **MAL** (`myanimelist.net` OAuth + `api.myanimelist.net` REST): PKCE `plain`
  only; token exchange + API through Worker proxy.
- **Deno auth service**: standalone `auth-proxy/` on non-Cloudflare hosting,
  same `/api/anilist/token` contract — required because AniList 403-blocks
  all Cloudflare egress IPs. URL baked as `VITE_AUTH_API_URL`.
- **Providers/CDNs**: aniwaves.ru (filter/ajax servers/embeds), anikotoapi.site
  (series JSON), megaplay.buzz (getSourcesNew), echovideo/roburn/dpopdrop CDNs.

## Data flow

- Public metadata: AniList → `anilistGraphQL` (memory 5m/400 + IDB 24h +
  inflight dedup) → shared `anilist:media:<id>` record → pages/hooks.
- Tracking: active tracker only (never merged) → `combinedList` → Home/MyList/
  Detail/Watch. MAL entries enriched with AniList display metadata (paced).
- Seasons: `useSeriesGroup(routeId)` walks relations in parallel with page
  metadata → cached model → selector navigates to canonical season entries.
- Video: Watch metadata → `/api/sources` (worker resolves + signs) →
  `/api/stream` relay → `VideoPlayer` (hls.js or native).

## Authentication flow

- AniList: Authorization Code + `state`; browser → provider login →
  `?code=` return → exchange via Deno/Worker (`ANILIST_CLIENT_SECRET`
  server-side) → token in `storage/anilist`, viewer+list load. Navbar reopens
  sign-in popup on return (`sessionStorage aeri:signin:oauth`).
- MAL: PKCE `plain` (verifier = challenge, 96ch) → same callback shape →
  exchange via Worker `/mal/token` (injects `MAL_CLIENT_SECRET`) → tokens in
  `storage/mal`. Stuck `?code=` states are cleaned on any exchange failure.

## Media flow

Watch metadata (AniList, browser) → hint params → Worker
`resolveSource` (filter → match → servers → embed extract → sign) →
`/api/stream?u&e&s` → upstream CDN (playlist rewritten to signed URLs) →
`<video>` via hls.js (Chromium) or native HLS (Safari). Progress → IDB
`watchPos` (5s throttle) + tracker at ≥80% / on end.

## Caching / persistence

- Memory (module maps) + IndexedDB (`aeri` v2: `progress`, `cache`,
  `history`, `watchPos`) + `localStorage aeri:prefs` (settings).
- AniList: memory 5m + IDB 24h + shared inflight + stale-while-throttled.
- Series models: memory 30m/100 + IDB 24h + per-id inflight.
- Video: browser mem 5m (empty 2m) + IDB 1h (empty 5m); signed URLs never
  cached; resolver caches 5–10m.

## Error handling

- `ProviderError` codes: `NETWORK` (retryable), `AUTH`, `NOT_FOUND`,
  `UNKNOWN`, `THROTTLED` (machine-readable; hooks keep cached pages silently).
- Watch: `Video unavailable` (no compatible source) vs `Couldn't load video`
  (transient), with Retry; never fake URLs, never demo-as-proof.

## Security boundaries

HMAC-signed expiring stream URLs (6h) minted only by resolve path;
allowlisted https hosts; DoH private-IP reject fail-closed; strict title/
season/episode/format/year matching (fail closed); secrets only in Worker
secrets / Deno env / owner keychain — never in bundles. See `security.md`.
