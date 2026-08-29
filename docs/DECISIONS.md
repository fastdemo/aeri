# DECISIONS — Aeri

## D001 — Static-only hosting

Decided: GitHub Pages, no backend. Rationale: spec-mandated, keeps ops trivial. Consequence: IndexedDB/localStorage only; all auth client-side.

## D002 — HashRouter

Decided: `HashRouter` over `BrowserRouter`. GH Pages has no rewrite; hash URLs survive refresh without 404.html hack. Cleaner for forks. Tradeoff: URLs contain `#`.

## D003 — Tailwind v4 via @tailwindcss/vite

Decided: Tailwind v4 with Vite plugin. Single pass, no PostCSS config proliferation. Tokens via CSS variables.

## D004 — Mock-first visual prototype

Decided: Phase 2 builds full UI on `src/data/mockAnime.ts` before AniList/MAL. Rationale: visual quality bar requires iteration without API instability.

## D005 — Single AnimeCard with variants

Decided: one component with `variant="default|continue|compact"` rather than duplicated card types. Keeps design consistent.

## D006 — No carousel library

Decided: native scroll + snap. Avoids heavy deps, preserves momentum scrolling. Sufficient for Netflix-style rows.

## D007 — Identity normalization

Decided: explicit `AnimeIdentity` with optional `anilistId`/`malId`. Prevents ID conflation and enables future providers.

## D008 — Video provider abstraction deferred

Decided: stub `VideoProvider` until Phase 7; player uses mock episodes initially. Avoids integrating unauthorized sources.

## D009 — Base path env-aware

Decided: `base` derived from `GITHUB_REPOSITORY` env in CI, fallback `/aeri/` locally. Supports forks without code change.

## D010 — AniList implicit grant for static hosting

Decided: `response_type=token` implicit grant via `https://anilist.co/api/v2/oauth/authorize?client_id={VITE_ANILIST_CLIENT_ID}` with redirect `origin + BASE_URL` (`/aeri/`). No server, no client secret. Token parsed from hash fragment and stored via `src/storage/anilist.ts` (`aeri:anilist:token`). Manual paste fallback (`parseManualToken`) for dev without registered client. Tradeoff: token lives in localStorage; expiry handled via `aeri:anilist:token_expiry`.

## D011 — Early hash parsing before HashRouter

Decided: parse `#access_token=...` in `src/main.tsx` before `createRoot`, then clean URL to `#/` via `history.replaceState`. Prevents HashRouter interpreting `#access_token=...` as route. Also handled in `src/services/anilist/auth.ts:handleAnilistOAuthCallback` for in-app fallback.

## D012 — AniList mapper and status translation

Decided: central `src/services/anilist/mapper.ts` for `AriListMedia → Anime` (HTML stripped, `averageScore/10`, `extraLarge→large→medium` fallback, `banner→cover`). Status maps: `CURRENT/REPEATING→watching`, `COMPLETED→completed`, `PLANNING→planned`, `PAUSED→on_hold`, `DROPPED→dropped` and inverse for mutations. Ensures normalized `Anime`/`AnimeListEntry` for all providers.

## D013 — Caching: memory 5 min + IndexedDB 24 h + inflight dedup

Decided: `src/services/anilist/client.ts:anilistGraphQL` uses in-memory `Map` TTL 5 min, IndexedDB `cache` via `src/storage/db.ts` TTL 24 h (keys `anilist:viewer`, `anilist:list:<userId>`, `anilist:anime:<id>`, `anilist:search:<q>`), and `inflight` promise map to deduplicate concurrent fetches. Mutations bypass cache and clear memory to force refresh.

## D014 — AniList context with optimistic updates

Decided: `src/contexts/AniListContext.tsx` provides `isAuthenticated, user, animeList, loadingUser/loadingList, error, authExpired, login/logout/setManualToken/refresh/updateProgress/updateStatus/updateRating`. `updateProgress/Status/Rating` optimistically patch `animeList` then `SaveMediaListEntry` mutation and reload list. Surfaced via `ProviderError` codes for UI skeletons/banners. Keeps visual design unchanged (MyList rows, Home Continue Watching, DetailModal badges, EpisodeList/water page sync remain quiet).

## D015 — No visual redesign for Phase 3

Decided: MyList and Home keep streaming row aesthetic; connection state via minimal `AniListConnectCompact` bar and Navbar avatar dot (emerald/auth, amber/expired, white/unauthenticated). No dashboard. Spec: "Do not redesign the existing UI."
