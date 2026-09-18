# MAL (MyAnimeList) — Aeri

## Auth (`src/services/mal/auth.ts`, `storage/mal.ts`)

- OAuth Authorization Code with **PKCE `plain` only** (S256 proven broken
  live — every exchange failed verification; never switch back without a
  successful live exchange). Verifier 96ch, state 32ch, both in
  `aeri:mal:*` storage.
- Client ID must be 32-char hex (`VITE_MAL_CLIENT_ID`); flow refuses to start
  otherwise. Redirect URI is origin+base, exact-match registered in MAL app
  dashboard.
- `exchangeMalCodeForToken`: POST `client_id + code + code_verifier +
  redirect_uri` via `fetchMalTokenWithFallback` (Worker `/mal/token` first,
  then direct — direct is CORS-blocked on static hosting, hence the worker).
  `refreshMalToken` shares the endpoint; Worker injects `MAL_CLIENT_SECRET`
  server-side for both grants.
- `handleMalOAuthCallback`: parses `?code=&state=`/`error`, state-mismatch →
  CSRF error, missing verifier → clean error. `aeri:mal:last_code` dedupes
  double exchange. **Any exchange failure cleans URL + verifier + state** —
  a stuck `?code=` re-triggered the same failure every load and left a black
  non-hash page (reported incident, fixed).
- `AniListContext` ignores callbacks whose state matches stored MAL state and
  vice versa (callback isolation — both use `?code=`).

## Tracking (`src/providers/mal/provider.ts`, `MALContext.tsx`)

- Same `AnimeListEntry` shape as AniList (statuses mapped
  `watching/completed/on_hold/dropped/plan_to_watch`).
- `TrackingContext` uses **one active tracker**: both accounts may stay
  connected, but reads/writes go through exactly one (explicit pick or
  AniList-first). No merged reads, no fan-out writes.
- MAL entries are upgraded to AniList display metadata via `Media(idMal:)`
  (`anilist:bymal:*` cache); unmatched keep MAL fallbacks. Score follows the
  tracker (MAL mean preserved through enrichment, not overwritten).

## Worker proxy (`worker/src/index.ts`)

- `POST /mal/token`, `/api/mal/token` → `myanimelist.net/v1/oauth2/token`
  (secret injection).
- `GET/PUT /mal/api/*`, `/api/mal/*` → `api.myanimelist.net/v2/*` (auth/body
  forwarded). Required: MAL sends no CORS headers for browser origins.

## Enrichment (`src/services/mal/enrichment.ts`)

MAL tracker only: background upgrade of entries to AniList metadata.
Priority (watching/progress, ≤12) at concurrency 2, then sequential tail
drip every 2.5s (~24/min — headroom under the 30/min AniList limit).
Per-entry fail-soft (keeps MAL fallback); `onBatch` flushes UI every 8.

## Current status / limitations

- Login flows through the CF worker (never needed Fly/Deno). Fake-code probe
  returns MAL's own 401 (proves reachability).
- MAL provides no banner (cover reused), no season (year only), coarse
  `media_type` formats — display is always AniList-backed where matched.
- Big MAL lists converge slowly by design (rate-limit safety over speed).
