# ARCHITECTURE — Aeri

## Overview

Aeri is a static frontend SPA deployed to GitHub Pages. No backend process exists at runtime.

```
User Browser
  ├─ React SPA (Vite)
  ├─ IndexedDB / localStorage (progress, cache, token via storage/anilist.ts)
  ├─ Service Worker (PWA shell, optional)
  ├─ AniList GraphQL (direct, CORS, https://graphql.anilist.co)
  │    ├─ TrackingProvider (auth, Viewer, MediaListCollection, SaveMediaListEntry)
  │    └─ AnimeMetadataProvider (public: trending/popular/airing/new/search/Media)
  └─ MAL REST (direct, OAuth PKCE — Phase 5)
```

## Routing

- `HashRouter` (`react-router-dom`). Paths: `#/`, `#/browse`, `#/anime/:id`, `#/watch/:id/:episode`, `#/list`, `#/search`.
- Why hash: GH Pages serves static files only; `/#/anime/123` does not require server rewrite, refresh never 404s.
- Alternative (`BrowserRouter` + `404.html` hack) was considered and rejected for simplicity.
- Early hash token parsing in `src/main.tsx` before `HashRouter` mounts avoids `#access_token=…` being treated as route.

## Data Flow

```
UI Component (Home/Browse/Search/Detail/Watch/MyList)
  → hook (useTrending/usePopular/useAiring/useNewReleases/useAnimeSearch/useAnimeDetail, useAniList)
    → provider adapter (AnimeMetadataProvider / TrackingProvider)
      → service (services/anilist/client.ts:anilistGraphQL, mapper.ts, auth.ts)
        → fetch + shared cache (memory 5min + IndexedDB 24h + inflight dedup via storage/db.ts)
          → storage (IndexedDB + localStorage via storage/anilist.ts)
            + normalized Anime types (types/anime.ts) via lib/identity.ts
```

UI never calls fetch directly. `AnimeCard`/`Hero` receive normalized `Anime` only.

## Providers

- **TrackingProvider** (`src/providers/anilist/provider.ts`): user-specific, requires token (`Viewer`, `MediaListCollection`, `SaveMediaListEntry`). Context `AniListContext` provides optimistic updates.
- **AnimeMetadataProvider** (`src/providers/metadata/types.ts` + `anilistMetadata.ts`): public discovery, no token needed. Methods `getTrending/getPopular/getAiring/getNewReleases/search/getAnime` share `MEDIA_FIELDS` and `mapAniListMediaToAnime`. Used by `Home` (hero + 4 rows), `Browse` (popular filtered), `Search` (always real), `AnimeDetail`/`Watch` (real detail). Keeps UI decoupled from GraphQL.
- **VideoProvider** stub (`src/providers/video/types.ts`) until Phase 7.

## Mock Data (Phase 2 → Phase 4)

- `src/data/mockAnime.ts` provides deterministic 20-item list with picsum backdrops (now fallback/test fixture only).
- Phase 2: all rows/hero consumed mock until AniList wiring.
- Phase 3: mock used as fallback when unauthenticated or on error; `Home`/`MyList` used `animeList` when auth.
- **Phase 4:** `mockAnime.ts` kept but production `Home`/`Browse`/`Search`/`AnimeDetail`/`Watch` no longer depend on mock when real data available — they use `AnimeMetadataProvider` with mock only as fallback if remote fails (via Section fallback) or for unauthenticated empty `Continue Watching`/`My List`. This satisfies “keep available as fallback/test fixture”.

## Identity

Canonical `internalId` (`anilist-<id>` for real, slug for mock). Optional `anilistId`, `malId`. Mapping via `src/lib/identity.ts` + `src/services/anilist/mapper.ts` (preserves `idMal`). Never `anilistId === malId`.

## Storage

- `src/storage/preferences.ts` — small JSON in localStorage (theme, player prefs)
- `src/storage/anilist.ts` — `aeri:anilist:token` + expiry, abstraction (no scattered getItem)
- `src/storage/db.ts` — IndexedDB (`progress`, `cache`, `history`), shared for tracking + metadata (`anilist:trending`, `anilist:popular`, etc.). Versioned, migrations.

## Hooks

- `src/hooks/useAnimeMetadata.ts` — `useTrending`, `usePopular`, `useAiring`, `useNewReleases`, `useAnimeSearch` (debounced 300 ms), `useAnimeDetail`. Each manages `data/loading/error` with `ProviderError` friendly messages, uses provider + shared cache.
- `src/contexts/AniListContext.tsx` — auth state, `animeList` for personal rows.

## Performance

- Tailwind v4 eliminates separate build step; Vite handles CSS.
- Cards `loading="lazy"` (hero `eager` for LCP), images `decoding="async"`, fallback `backdrop||cover`, `onError` hide.
- Detail + Watch not yet code-split via `React.lazy` (future), but metadata hooks dedup inflight.
- **Phase 4:** Homepage issues 4 parallel `Page` requests (trending/popular/airing/new) — not dozens — each cached 5 min memory + 24 h IDB + dedup. Browse 1 request, Search debounced.
- No heavy carousel library.

## Future Extensibility

- New metadata provider: implement `AnimeMetadataProvider` (e.g. MAL, Kitsu) — requires only `map` + `identity` extension, no UI change.
- New tracking provider: implement `TrackingProvider`.
- New video source: implement `VideoProvider`.
