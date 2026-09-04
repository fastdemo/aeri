# ARCHITECTURE — Aeri

## Overview

Aeri is a React SPA (Vite + HashRouter) served by the Cloudflare Worker `aeri` at `https://aeri.fastdemo.workers.dev/`, which serves `dist` assets and same-origin `/api/*` (video, MAL proxy, AniList token proxy). A standalone `auth-proxy/` Node service on non-Cloudflare hosting handles AniList token exchange because AniList 403-blocks all Cloudflare Worker IPs (see D041).

```
User Browser
  ├─ React SPA (Vite, HashRouter #/)
  ├─ IndexedDB / localStorage (progress, cache, tokens, prefs)
  ├─ AniList GraphQL direct from browser (CORS OK, https://graphql.anilist.co)
  │    ├─ TrackingProvider (auth Authorization Code via auth-proxy/Worker, Viewer, MediaListCollection, SaveMediaListEntry)
  │    └─ AnimeMetadataProvider (public: trending/popular/airing/new/search/Media)
  ├─ Cloudflare Worker `aeri` (same-origin /api: video, MAL, AniList token w/ secret)
  ├─ auth-proxy (non-CF host, AniList token exchange w/ secret, preferred)
  └─ MAL REST via Worker proxy (CORS-blocked direct, PKCE https://myanimelist.net/v1/oauth2)
```

## Routing

- `HashRouter` (`react-router-dom`). Paths: `#/`, `#/browse`, `#/anime/:id`, `#/watch/:id/:episode`, `#/list`, `#/search`, `#/settings`.
- Why hash: refresh and deep links work without server rewrites on any static host.
- AniList Authorization Code flow returns `?code=` + `?state=` (search params, survive HashRouter); handled in `AniListContext` effect (exchange via auth-proxy/Worker), never in the hash. MAL `?code=` likewise parsed in `MALContext` effect. Each context ignores the other's callback by matching URL `state` against its own stored state (D042).

## Data Flow

```
UI Component (Home/Browse/Search/Detail/Watch/MyList)
  → hook (useTrending/usePopular/useAiring/useNewReleases/useAnimeSearch/useAnimeDetail, useTracking/useAniList/useMAL)
    → provider adapter (AnimeMetadataProvider / TrackingProvider → AniListProvider / MALProvider)
      → service (services/anilist/client.ts:anilistGraphQL, mapper.ts, auth.ts + services/mal/client.ts:malFetch, mapper.ts, auth.ts)
        → fetch + shared cache (memory 5min + IndexedDB 24h + inflight dedup via storage/db.ts, keys anilist:* + mal:*)
          → storage (IndexedDB + localStorage via storage/anilist.ts + storage/mal.ts)
            + normalized Anime types (types/anime.ts) via lib/identity.ts
```

UI never calls fetch directly. `AnimeCard`/`Hero` receive normalized `Anime` only. Tracking UI uses `useTracking` (merged), not direct provider.

## Providers

- **TrackingProvider**: two implementations behind same interface:
  - `src/providers/anilist/provider.ts` (`AniListProvider`): user-specific, Authorization Code grant (client 50024; implicit rejected with `unsupported_grant_type`, proven live), `Viewer`, `MediaListCollection` (all `lists` including custom), `SaveMediaListEntry`. Token exchange server-side only (`/api/anilist/token` on Worker or `auth-proxy`, secret never in browser). Context `AniListContext` provides optimistic updates, `clearAnilistMemoryCache` on mutation.
  - `src/providers/mal/provider.ts` (`MALProvider`, Phase 5): user-specific, PKCE S256, `GET /users/@me`, `GET /users/@me/animelist` paginated + `GET /anime/{id}` + `PUT /anime/{id}/my_list_status`. Context `MALContext` mirrors `AniListContext` with `ensureFreshToken` refresh and `clearMalMemoryCache`. Both through `src/services/mal/*` + `src/lib/malConfig.ts` + `src/storage/mal.ts`.
  - `src/contexts/TrackingContext.tsx` (Phase 5) merges `AniListContext` + `MALContext`: `dedupAndMerge` keys by `mal-<malId>` if present else `anilist-<id>`, AniList first (richer banner), MAL second merges identity, picks max progress, exposes `isAuthenticated/isAniListAuthenticated/isMALAuthenticated/combinedList` and `updateProgress/anime/status/rating` fan-out to both where IDs exist (UI stays provider-agnostic, no dashboard).
- **AnimeMetadataProvider** (`src/providers/metadata/types.ts` + `anilistMetadata.ts`): public discovery, no token needed. Methods `getTrending/getPopular/getAiring/getNewReleases/search/getAnime` share `MEDIA_FIELDS` and `mapAniListMediaToAnime`. Used by `Home` (hero + 4 rows), `Browse` (popular filtered), `Search` (always real), `AnimeDetail`/`Watch` (real detail). Keeps UI decoupled from GraphQL. No MAL metadata provider — AniList remains primary discovery.
- **VideoProvider** stub (`src/providers/video/types.ts`) until Phase 7.

## Mock Data (Phase 2 → Phase 4)

- `src/data/mockAnime.ts` provides deterministic 20-item list with picsum backdrops (now fallback/test fixture only).
- Phase 2: all rows/hero consumed mock until AniList wiring.
- Phase 3: mock used as fallback when unauthenticated or on error; `Home`/`MyList` used `animeList` when auth.
- **Phase 4:** `mockAnime.ts` kept but production `Home`/`Browse`/`Search`/`AnimeDetail`/`Watch` no longer depend on mock when real data available — they use `AnimeMetadataProvider` with mock only as fallback if remote fails (via Section fallback) or for unauthenticated empty `Continue Watching`/`My List`. This satisfies “keep available as fallback/test fixture”.

## Identity

Canonical `internalId` (`anilist-<id>` / `mal-<id>` for real, slug for mock). Optional `anilistId`, `malId`. Mapping via `src/lib/identity.ts` + `src/services/anilist/mapper.ts` (preserves `idMal`) + `src/services/mal/mapper.ts` (preserves `malId` for dedup). Never `anilistId === malId`. Cross-provider dedup via `malId` (AniList `idMal` ↔ MAL `id`) in `TrackingContext:dedupAndMerge` — prevents visually identical duplicates when same anime in both services, merged as one Aeri `Anime` (AniList banner kept, identities merged, max progress, AniList status primary, no silent overwrite).

## Normalized Anime Type (Phase 5)

`Anime { identity:{internalId, anilistId?, malId?}, title{romaji, english?, native?}, description, coverImage/backdropImage/bannerImage, year/season/episodes/duration/status/rating(0-10)/genres/studios/format/popularity/progress/listStatus/inList }` — same shape for both providers; provider-specific structures mapped at service/provider boundary. `AnimeCard`/`Hero`/`ContentRow` unchanged.

## Storage

- `src/storage/preferences.ts` — small JSON in localStorage (theme, player prefs)
- `src/storage/anilist.ts` — `aeri:anilist:token` + expiry/type, abstraction (no scattered getItem)
- `src/storage/mal.ts` — Phase 5: `aeri:mal:access_token` + `refresh_token` + `token_expiry` + `oauth_state`/`code_verifier` transient, same abstraction
- `src/storage/db.ts` — IndexedDB (`progress`, `cache`, `history`), shared for tracking + metadata + MAL (`anilist:*` + `mal:*` + `mal:viewer`/`mal:list`), versioned, migrations. `putCache/getCache` used by both `anilistGraphQL` and `malFetch`.

## Hooks

- `src/hooks/useAnimeMetadata.ts` — `useTrending`, `usePopular`, `useAiring`, `useNewReleases`, `useUpcoming`, `useFinished`, `useBrowse` (with `sort/status/genre/seasonYear/season/format/perPage/page`, `hasNextPage`, `loadMore`), `useAnimeSearch` (debounced 300 ms, live while typing, stale-ignore), `useAnimeDetail`. Each manages `data/loading/error` with `ProviderError` friendly messages, uses provider + shared cache (public, no token). `useBrowse` resets `page` on filter change and appends on `loadMore`.
- `src/contexts/AniListContext.tsx` — AniList auth state, `animeList` for personal rows, optimistic updates.
- `src/contexts/MALContext.tsx` — Phase 5: MAL auth state (`isAuthenticated/token/user/animeList/loadingUser/loadingList/error/authExpired/redirectUri/hasClientId/login/logout/setManualToken/refresh/updateProgress/updateStatus/updateRating`), handles `?code=` callback via `handleMalOAuthCallback`, mirrors AniList shape. **Parked in Phase 6** (no changes, CORS limitation documented in `docs/MAL_BROWSER_FEASIBILITY.md`).
- `src/contexts/TrackingContext.tsx` — Phase 5: unified `useTracking()` merging both contexts (deduped `combinedList`, `isAuthenticated`, `isAniListAuthenticated`, `isMALAuthenticated`, fan-out mutations). UI consumes this, not direct provider. Parked for MAL in Phase 6.

## App Wiring

`src/App.tsx`: `HashRouter → AniListProvider → MALProvider → TrackingProvider → Layout`. `src/components/anilist/AniListConnect.tsx` + `src/components/mal/MALConnect.tsx` in Settings/MyList; navbar `SearchSuggestions` picks open `DetailModal` (state lifted to `Navbar`, never `/anime/:id` navigation); `Navbar` shows avatar when authenticated, else Connect button; `Home` `Continue Watching`/`My List` use `combinedList`.

## Sync Strategy

Optimistic UI → provider mutation → failure restore → `clearMemoryCache` → `refresh` list. Reuses same TTL/dedup/inflight. No continuous polling, no duplicate requests, no request waterfall; homepage 4 parallel metadata requests cached, MAL list only when authenticated.

## Error States

`ProviderError`/`MalProviderError` `NETWORK/AUTH/NOT_FOUND/UNKNOWN` → concise friendly copy, no raw dump. `AUTH` clears tokens and shows reconnect CTA; `NETWORK` retryable with `Retry` buttons covering both providers.

## Loading States

Reuses `RowSkeleton`/`Skeleton` mirroring final layout, no new spinner design.

## Performance

- Tailwind v4 eliminates separate build step; Vite handles CSS.
- Cards `loading="lazy"` (hero `eager` for LCP, `fetchPriority="high"`), images `decoding="async"`, fallback `backdrop||cover`, `onError` hide.
- Detail + Watch not yet code-split via `React.lazy` (future), but metadata hooks dedup inflight.
- **Phase 4:** Homepage issues 4 parallel `Page` requests (trending/popular/airing/new) — not dozens — each cached 5 min memory + 24 h IDB + dedup. Browse 1 request, Search debounced. **Phase 5:** Same; MAL adds no extra discovery requests (reuse `malFetch` cache/dedup), list fetched once per auth (paging `limit=1000`, up to 500 safety), mutations invalidate only memory cache.
- **Phase 6:** Homepage still 4 parallel `Page` (trending/popular/airing/new, each `perPage:12`, second load cached 0 new), Browse `perPage:24` with `page` pagination (`hasNextPage` + `Load more`, append), filters server-side via `browse` (single request per filter change, deduped by `anilist:browse:…` key), Search live while typing debounced 300ms + 400ms URL sync, no duplicate/stale (hook `cancelled` + `clearTimeout` + `inflight` dedup). No dozens of requests, no huge datasets.
- No heavy carousel library.

## Video Provider Architecture (Phase 7 → 7.1)

```
Watch.tsx (shell renders immediately with anime title/backdrop, episode list immediate from anime.episodes/streamingEpisodes)
  ├─ useAnimeDetail (real anime) ──→ Anime (with streamingEpisodes)
  ├─ immediateEpisodes (derived from anime, no provider wait, shown instantly)
  ├─ resolveEpisodesWithFallback(Anime) ──→ VideoEpisode[] (parallel, 4s timeout, via registry, cached, fallback to Mock, does NOT block UI)
  │     ├─ AllAnime (CORS but query exact, Cloudflare)
  │     ├─ AnimePahe (CORS blocked, 3.5s timeout)
  │     ├─ AniKoto (DNS fail, 3.5s)
  │     ├─ MegaPlay (200 but HTML Error)
  │     ├─ AnimeParadise (CORS blocked)
  │     ├─ AniNeko (no stable API)
  │     └─ Mock (episode list only, no video, ensures navigation)
  ├─ resolveSourcesWithFallback(VideoEpisode) ──→ VideoSourceEnhanced[] (parallel, 4s, tried[] isolated, only selected episode, not all)
  │     └─ VideoPlayer (embed iframe vs direct video, controls, subtitles, source selector if >1, loading/error/no-source distinct)
  ├─ TrackingContext.updateProgress(anime, epNum) (isolated, throttled 5s)
  └─ storage/db.ts watchPos (putWatchPos/getWatchPos/clearWatchPos, DB v2, resume prompt)
```

**Performance (Phase 7.1):** Shell renders 85ms, Home 4 parallel `POST graphql.anilist.co` at 141ms (all at same time, not waterfall), responses 840ms, hero 1.4s, first row 1.4s, cached Home 0 new (IDB), Watch shell 29ms, title 873ms, episode list 876ms immediate, source no-source 2.3s (parallel 3.5s max, not 21s sequential). `anilistGraphQL` now has 8s `AbortController` timeout (AniList p95 <1.5s, 8s allows slow nets without freezing shell), `fetchWithTimeout` 3500ms for video, `registry` 4000ms parallel.

- `src/providers/video/types.ts` + `base.ts` (cachedFetch, isCorsError) + `registry.ts` (priority, fallback) + 6 stubs + `mock.ts` + `src/components/player/VideoPlayer.tsx` (native + embed, loading/error, source switch, sub/dub, subtitles)
- **No backend/proxy:** All real providers are browser-incompatible on GH Pages (CORS `No Allow-Origin` → `ERR_FAILED`), so Watch shows no-source UI with `Tried:` and retry, not blank. Episode navigation still works via Mock. Future browser-compatible provider would just be added to `videoProviders[]` with no UI change.
- **Performance:** Only selected episode's source is fetched (not all), inflight dedup, memory+IDB cache, no video pre-download, no dozens of requests.

## Future Extensibility

- New metadata provider: implement `AnimeMetadataProvider` (e.g. MAL, Kitsu) — requires only `map` + `identity` extension, no UI change.
- New tracking provider: implement `TrackingProvider`.
- New video source: implement `VideoProvider` (add to `registry.ts` priority, handle CORS/embed as above).
