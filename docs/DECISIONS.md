# DECISIONS — Aeri

## D001 — Static-only hosting
GitHub Pages, no backend, IDB/localStorage only.

## D002 — HashRouter
`HashRouter` to avoid 404 on Pages.

## D003 — Tailwind v4 via @tailwindcss/vite

## D004 — Mock-first visual prototype
Phase 2 mock.

## D005 — Single AnimeCard

## D006 — No carousel library

## D007 — Identity normalization

## D008 — Video provider deferred

## D009 — Base path env-aware

## D010 — AniList implicit grant
`response_type=token`, hash before HashRouter, `aeri:anilist:token`.

## D011 — Early hash parsing before HashRouter

## D012 — AniList mapper/status

## D013 — Caching memory 5m + IDB 24h + dedup

## D014 — AniList context optimistic

## D015 — No visual redesign Phase 3

## D016 — AnimeMetadataProvider (Phase 4)

## D017 — Home real discovery

## D018 — Search always real

## D019 — Browse real

## D020 — Detail/Watch real metadata + images lazy

## D021 — Mock as fallback only (Phase 4)

## D022 — MAL PKCE for static (Phase 5)
`code_verifier` random 96, `code_challenge` S256 SHA256 base64url, `state` 32, `GET https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id={VITE_MAL_CLIENT_ID}&code_challenge=S256&state`, redirect `origin+BASE_URL` (`/aeri/`), `POST https://myanimelist.net/v1/oauth2/token` (`client_id, code, code_verifier, grant_type=authorization_code`) via `fetch` (CORS, form urlencoded), `refresh_token` flow, tokens in `aeri:mal:*` via `storage/mal.ts`, no secret committed, `VITE_MAL_CLIENT_ID` env like AniList. Early search `?code` handling in `MALContext` + `main.tsx` not needed (search preserved). Manual paste fallback for dev.

## D023 — MAL client reuse cache (Phase 5)
`malFetch` reuses same memory 5m + IDB 24h + inflight dedup as `anilistGraphQL`, with `ensureFreshToken` auto-refresh 1min buffer, `clearMalTokens` on 401/403, friendly `MalProviderError`.

## D024 — MAL mapper/status (Phase 5)
`malStatusToAeri`/`aeriStatusToMal` (`watching/completed/on_hold/dropped/plan_to_watch` ↔ `watching/completed/planned/on_hold/dropped`), `mapMALNodeToAnime` (title `ja→romaji`, `en→english`, `mean` 0-10, `main_picture`, `genres/studios`), percent from `num_episodes_watched/num_episodes`, preserves `malId` for dedup.

## D025 — Dual-provider dedup via malId (Phase 5)
`TrackingContext:dedupAndMerge` keys by `mal-<malId>` if present else `anilist-<id>`, AniList first (richer banner), MAL second merges identity (`malId`/`anilistId`), picks max progress, keeps AniList status as primary. Prevents visually identical duplicates, no silent overwrite without explicit rule documented.

## D026 — Unified Tracking abstraction (Phase 5)
`TrackingContext` wraps `AniListContext` + `MALContext`, exposes `isAuthenticated/isAniListAuthenticated/isMALAuthenticated/combinedList/loading/error/authExpired/updateProgress/updateStatus/updateRating` that fan-out to both providers where IDs exist (`updateProgress(anime, ep)` resolves `anilistId`/`malId` from `anime.identity`). UI (Home Continue Watching, MyList, DetailModal, EpisodeList, Watch) uses `useTracking` not direct provider, stays provider-agnostic, no dashboard.

## D027 — No visual redesign for MAL (Phase 5)
MyList stacks `AniListConnectCompact` + `MALConnectCompact` (compact `MAL` badge `#2e51a2`), Navbar shows first authenticated avatar (AniList preferred) with emerald dot, Home sync label `AniList • MAL` when both, My List shows `Merged • deduped by MAL ID`. Same near-black, landscape cards, quiet gradients.

## D028 — Browse as real AniList discovery (Phase 6)
`AnimeMetadataProvider.browse` with `Page(media(type:ANIME, isAdult:false, sort, status, genre, seasonYear, season, format))` + `pageInfo { hasNextPage }`, cache key `anilist:browse:sort:status:genre:year:season:format:perPage:page`, `useBrowse` manages `page` reset on filter change and `loadMore` append. `Browse.tsx` category tabs `Popular (POPULARITY_DESC)`, `Trending (TRENDING_DESC)`, `Airing (RELEASING)`, `Upcoming (NOT_YET_RELEASED)`, `Finished (FINISHED+END_DATE_DESC)` + filters `genre` (10), `seasonYear` (2020-2025), `season` (WINTER/SPRING/SUMMER/FALL), `format` (TV/MOVIE/OVA/SPECIAL) as server-side AniList filters, `perPage 24`, pagination, compact rounded `select`s, loading pulse grid, error retry, empty “No titles match”. No mock, no table.

## D029 — Search live while typing (Phase 6)
`Search.tsx` now uses `liveQuery = input.trim()` with `useAnimeSearch(liveQuery,12)` (debounced 300ms inside hook) + 400ms URL `replace` sync for deep link, `useEffect` sync for back navigation, `cancelled` + `clearTimeout` prevents stale, error shows retry button, `q` param initial from `searchParams`. No duplicate requests (inflight dedup).

## D030 — MyList empty when unauth (Phase 6)
`MyList.tsx` production no longer shows `mockAnime.filter(inList)` when unauthenticated; `sourceList` is `[]` when not `isAuthenticated`, `syncLabel` is `connect AniList to sync`, empty state is centered card with “Your list is empty” + CTA to connect. Mock remains in `src/data/mockAnime.ts` for tests/development only. Prevents fake discovery as normal path.

## D031 — MAL parked for Phase 6 (Phase 6)
Per `docs/MAL_BROWSER_FEASIBILITY.md`, MAL `api.myanimelist.net` and `myanimelist.net/v1/oauth2/token` send no `Access-Control-Allow-Origin` for `https://fastdemo.github.io` origin (Playwright `No CORS header` → `ERR_FAILED` → `Failed to fetch`), so static GH Pages SPA cannot complete auth or REST. No backend/proxy added. `VITE_MAL_CLIENT_ID` still injected, `hasClientId` logic intact, CORS-specific errors in `malFetch`/`exchangeMalCodeForToken` remain, but no new MAL work. AniList is primary for discovery/tracking.

## D032 — VideoProvider abstraction for static Pages (Phase 7)
`VideoProvider { resolveAnimeId, getEpisodes, getSources }` normalized to `VideoEpisode { number, provider, providerEpisodeId, language }` + `VideoSourceEnhanced { url, provider, quality, language, type, embed, subtitles[] }` + `ProviderCapabilities`, `base.ts cachedFetch` reuses `storage/db.ts` (memory 5m + IDB 24h + inflight, key `video:provider:…`), `registry.ts` priority `[allanime, animepahe, anikoto, megaplay, animeparadise, anineko, mock]` with `resolveEpisodesWithFallback`/`resolveSourcesWithFallback` isolated (one provider failing doesn't crash Watch, only selected episode fetched). `Watch.tsx` and `VideoPlayer.tsx` consume only the abstraction, not provider APIs.

## D033 — No backend/CORS proxy for video (Phase 7)
Investigated 2026-08-29 from `https://fastdemo.github.io` origin via Playwright: AnimePahe `https://animepahe.ru/api?m=search` → CORS `No Allow-Origin` `ERR_FAILED`; AniKoto `https://anikoto.to/api/search` → `ERR_NAME_NOT_RESOLVED`; MegaPlay `https://megaplay.buzz/api/search` → `200 CORS:*` but HTML `Error - MegaPlay` not JSON; AnimeParadise `https://www.animeparadise.moe/api/search` → CORS blocked; AllAnime `https://api.allanime.day/api` → `CORS: https://fastdemo.github.io` (allows origin) but requires exact GraphQL `SearchInput` schema + Cloudflare, still no browser video without proxy. No provider provides `Access-Control-Allow-Origin: *` for search+episodes+sources that yields playable `m3u8`/`mp4` or embed without proxy. Therefore all real providers are **browser-incompatible** on static GH Pages. Decision: do not add CORS proxies, Cloudflare Workers, Vercel functions, or third-party proxy APIs; keep `MockVideoProvider` for episode navigation and show no-source UI `Video unavailable` with `Tried:` and `Retry`. Documented in `src/providers/video/*.ts` headers and final provider report.

## D034 — Local watch position on static DB (Phase 7)
`storage/db.ts` `DB_VERSION 2` adds `watchPos` store `{id, episode, currentTime, duration, updatedAt}`, `putWatchPos`/`getWatchPos`/`clearWatchPos` reuse existing IDB wrapper. `Watch` `onTimeUpdate` throttled 5s via `putWatchPos`, `getWatchPos` on load shows `Resume from M:SS?` if `>30s && <90%` same episode, `onEnded` clears and calls `updateProgress`. No second storage, no video files, no interference with AniList `progress`.

## D035 — Watch remains Netflix-like with no-source state (Phase 7)
Watch keeps near-black `bg-black`, `aspect-video` `bg-[#0a0a0a]`, top gradient `← title`, bottom no-source card `Video unavailable` + `Try another episode or source` + `Tried: …` + `Retry`/`Episodes` + provider caps, `Episode` grid, `Source:` selector only if `sources.length>1`, `Resume` prompt as rounded `bg-black/80` at bottom. Navbar/Home/Browse/Search/MyList/Detail not redesigned, only Watch-related UI.
