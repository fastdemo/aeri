# ARCHITECTURE — Aeri

## Overview

Aeri is a static frontend SPA deployed to GitHub Pages. No backend process exists at runtime.

```
User Browser
  ├─ React SPA (Vite, HashRouter #/)
  ├─ IndexedDB / localStorage (progress, cache, tokens via storage/anilist.ts + storage/mal.ts)
  ├─ Service Worker (PWA shell, optional)
  ├─ AniList GraphQL (direct, CORS, https://graphql.anilist.co)
  │    ├─ TrackingProvider (auth implicit grant, Viewer, MediaListCollection, SaveMediaListEntry)
  │    └─ AnimeMetadataProvider (public: trending/popular/airing/new/search/Media)
  └─ MAL REST (direct, CORS, https://api.myanimelist.net/v2, OAuth PKCE https://myanimelist.net/v1/oauth2 — Phase 5)
       └─ TrackingProvider (auth PKCE S256, users/@me, animelist paginated, anime/{id}, my_list_status PUT)
```

## Routing

- `HashRouter` (`react-router-dom`). Paths: `#/`, `#/browse`, `#/anime/:id`, `#/watch/:id/:episode`, `#/list`, `#/search`.
- Why hash: GH Pages serves static files only; `/#/anime/123` does not require server rewrite, refresh never 404s.
- Alternative (`BrowserRouter` + `404.html` hack) was considered and rejected for simplicity.
- Early hash token parsing in `src/main.tsx` before `HashRouter` mounts avoids `#access_token=…` being treated as route; MAL `?code=` + `state` parsed in `MALContext` effect (search, not hash) and preserved through `replaceState`.

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
  - `src/providers/anilist/provider.ts` (`AniListProvider`): user-specific, implicit grant, `Viewer`, `MediaListCollection` (all `lists` including custom), `SaveMediaListEntry`. Context `AniListContext` provides optimistic updates, `clearAnilistMemoryCache` on mutation.
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

- `src/hooks/useAnimeMetadata.ts` — `useTrending`, `usePopular`, `useAiring`, `useNewReleases`, `useAnimeSearch` (debounced 300 ms), `useAnimeDetail`. Each manages `data/loading/error` with `ProviderError` friendly messages, uses provider + shared cache (public, no token).
- `src/contexts/AniListContext.tsx` — AniList auth state, `animeList` for personal rows, optimistic updates.
- `src/contexts/MALContext.tsx` — Phase 5: MAL auth state (`isAuthenticated/token/user/animeList/loadingUser/loadingList/error/authExpired/redirectUri/hasClientId/login/logout/setManualToken/refresh/updateProgress/updateStatus/updateRating`), handles `?code=` callback via `handleMalOAuthCallback`, mirrors AniList shape.
- `src/contexts/TrackingContext.tsx` — Phase 5: unified `useTracking()` merging both contexts (deduped `combinedList`, `isAuthenticated`, `isAniListAuthenticated`, `isMALAuthenticated`, fan-out mutations). UI consumes this, not direct provider.

## App Wiring

`src/App.tsx`: `HashRouter → AniListProvider → MALProvider → TrackingProvider → Layout`. `src/main.tsx` early hash parsing for AniList before `HashRouter`. MAL has no early `main.tsx` handler needed (search params survive HashRouter). `src/components/mal/MALConnect.tsx` + `src/components/anilist/AniListConnect.tsx` stacked in `MyList`; `Navbar` shows first authenticated avatar (AniList preferred) with emerald dot; `Home` `Continue Watching`/`My List` use `combinedList` with `AniList • MAL` label when both (deduped), `MyList` shows `Merged • deduped by MAL ID` when both.

## Sync Strategy

Optimistic UI → provider mutation → failure restore → `clearMemoryCache` → `refresh` list. Reuses same TTL/dedup/inflight. No continuous polling, no duplicate requests, no request waterfall; homepage 4 parallel metadata requests cached, MAL list only when authenticated.

## Error States

`ProviderError`/`MalProviderError` `NETWORK/AUTH/NOT_FOUND/UNKNOWN` → concise friendly copy, no raw dump. `AUTH` clears tokens and shows reconnect CTA; `NETWORK` retryable with `Retry` buttons covering both providers.

## Loading States

Reuses `RowSkeleton`/`Skeleton` mirroring final layout, no new spinner design.

## Performance

- Tailwind v4 eliminates separate build step; Vite handles CSS.
- Cards `loading="lazy"` (hero `eager` for LCP), images `decoding="async"`, fallback `backdrop||cover`, `onError` hide.
- Detail + Watch not yet code-split via `React.lazy` (future), but metadata hooks dedup inflight.
- **Phase 4:** Homepage issues 4 parallel `Page` requests (trending/popular/airing/new) — not dozens — each cached 5 min memory + 24 h IDB + dedup. Browse 1 request, Search debounced. **Phase 5:** Same; MAL adds no extra discovery requests (reuse `malFetch` cache/dedup), list fetched once per auth (paging `limit=1000`, up to 500 safety), mutations invalidate only memory cache.
- No heavy carousel library.

## Future Extensibility

- New metadata provider: implement `AnimeMetadataProvider` (e.g. MAL, Kitsu) — requires only `map` + `identity` extension, no UI change.
- New tracking provider: implement `TrackingProvider`.
- New video source: implement `VideoProvider`.
