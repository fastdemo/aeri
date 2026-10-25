# ARCHITECTURE — Aeri

## Overview

Aeri is a React SPA (Vite + BrowserRouter) served by the Cloudflare Worker `aeri` at `https://aeri.fastdemo.workers.dev/`, which serves `dist` assets, SPA-fallbacks every non-asset GET to `index.html`, and hosts same-origin `/api/*` (video, MAL proxy, AniList token proxy). A standalone `auth-proxy/` Node service on non-Cloudflare hosting handles AniList token exchange because AniList 403-blocks all Cloudflare Worker IPs (see D041).

```
User Browser
  ├─ React SPA (Vite, BrowserRouter paths + legacy-hash shim)
  ├─ IndexedDB / localStorage (progress, cache, tokens, prefs)
  ├─ AniList GraphQL direct from browser (CORS OK, https://graphql.anilist.co)
  │    ├─ TrackingProvider (auth Authorization Code via auth-proxy/Worker, Viewer, MediaListCollection, SaveMediaListEntry)
  │    └─ AnimeMetadataProvider (public: trending/popular/airing/new/search/Media)
  ├─ Cloudflare Worker `aeri` (same-origin /api: video, MAL, AniList token w/ secret)
  ├─ auth-proxy (non-CF host, AniList token exchange w/ secret, preferred)
  └─ MAL REST via Worker proxy (CORS-blocked direct, PKCE https://myanimelist.net/v1/oauth2)
```

## Routing

- `BrowserRouter` (D098 — path URLs are canonical). Paths: `/`, `/anime`, `/anime/:id` (overlay detail route), `/watch/:id/:episode`, `/list`, `/search`, `/settings`, `/manga`, `/manga/:id` (overlay detail route).
- Why it's safe here: the Worker serves the SPA shell for every non-asset GET (`assets.binding: ASSETS` + `not_found_handling: "single-page-application"` in `wrangler.jsonc`; the Worker's own fallback block returns index.html for extension-less non-API paths). Refresh and deep links work natively; no `404.html` copy is involved.
- **Legacy-hash shim (D098):** URLs shared before the swap (`/#/anime/123`, `/#/search?q=x`) are translated to their path form in `main.tsx` — at boot and again on `hashchange` (solely a same-document fragment edit while the app is open). A post-mount translation re-dispatches `popstate` so the mounted router syncs to the new path immediately. The fragment is then REMOVED from the address bar (one-time normalization, not a redirect).
- **Detail overlay (D097):** `/anime/:id` + `/manga/:id` exist ONLY as overlay routes rendering `DetailRoute` (floating card via `DetailModal`) ON TOP of the page the card was opened from — `location.state.background` carries that page; bare deep links default to Home behind. The standalone `AnimeDetail` page is deleted. Every preview card / suggestion pick pushes the show's canonical URL; browser Back, Esc, ✕ or backdrop close it (Back hands the history entry back). Signed-out deep links redirect to Home with the sign-in popup (`/?signin=1` hop; members-only per pre-existing policy). Scroll reset is keyed on the background surface so open/close never yanks the page behind the card.
- AniList Authorization Code flow returns `?code=` + `?state=` (search params); handled in `AniListContext` effect (exchange via auth-proxy/Worker). MAL `?code=` likewise parsed in `MALContext` effect (plus the pre-router early handler in `main.tsx`, which only cleans error params). Each context ignores the other's callback by matching URL `state` against its own stored state (D042). All OAuth URL cleanups (`history.replaceState`) target the basename root — no `#/` anywhere.

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

UI never calls fetch directly. `AnimeCard`/`Hero` receive normalized `Anime` only. Tracking UI uses `useTracking` (single active tracker), not direct provider.

Episode names/thumbnails use a narrower pipeline: raw AniList `streamingEpisodes`
→ season/range display guards → whole-entry gate on the SURVIVING rows
(D127) → Kitsu (only when nothing usable survives)
→ UI placeholder. Full contract: [`docs/PROVIDERS.md`](PROVIDERS.md) §3.

## Providers

**Authoritative ownership map: [`docs/PROVIDERS.md`](PROVIDERS.md).** The
short version: **AniList is the metadata backbone**; users may connect
**exactly two tracker providers (AniList or MyAnimeList)**, with exactly one
active tracker at a time; **Kitsu is a narrow episode-name/thumbnail
fallback only**, never a general metadata provider; video providers supply
playback only.

- **TrackingProvider**: exactly two implementations behind the same interface:
  - `src/providers/anilist/provider.ts` (`AniListProvider`): user-specific, Authorization Code grant (client 50024; implicit rejected with `unsupported_grant_type`, proven live), `Viewer`, `MediaListCollection` (all `lists` including custom), `SaveMediaListEntry`. Token exchange server-side only (`/api/anilist/token` on Worker or `auth-proxy`, secret never in browser). Context `AniListContext` provides optimistic updates, `clearAnilistMemoryCache` on mutation.
  - `src/providers/mal/provider.ts` (`MALProvider`): user-specific, PKCE `plain` (challenge === verifier; S256 proven broken live, D051), `GET /users/@me`, `GET /users/@me/animelist` paginated + `GET /anime/{id}` + `PUT /anime/{id}/my_list_status`. Token exchange via Worker `/api/mal/token` (injects `MAL_CLIENT_SECRET` server-side). Context `MALContext` mirrors `AniListContext` with `ensureFreshToken` refresh and `clearMalMemoryCache`. Both through `src/services/mal/*` + `src/lib/malConfig.ts` + `src/storage/mal.ts`.
  - `src/contexts/TrackingContext.tsx`: **one active tracker** (`trackingProvider: 'anilist' | 'mal'`, explicit pick → AniList → MAL). Both accounts may stay connected, but only the active tracker's list is read and only it receives writes — **no cross-provider merge and no fan-out mutations**. Switchable in the sign-in modal + Settings. MAL tracker lists are upgraded to AniList display metadata via kind-scoped `Media(idMal:, type: ANIME|MANGA)` enrichment (`src/services/mal/enrichment.ts`, cached); **D110 owner rule: AniList is the sole metadata renderer — MAL-fallback paint never happens for a mapped entry**; **D111 owner rule (2026-10-21): resolution is BATCH-FIRST — one `idMal_in` request per ≤50-id chunk resolves the whole list (`getBatchByMalIds`, per-id cache seeds incl. definitive negatives), per-entry drip only as throttle fallback; display gate = AniList-resolved OR `noAniListRecord` (a proven unmapped entry displays its stable MAL-side record; unresolved stay hidden until a later pass)**. UI consumes `useTracking`, never direct providers. Discovery/metadata is AniList-only in all cases. Progress writes reach the active tracker only at ≥80% playback / 80% of chapter pages or on ended (never on page open); reaching a known total auto-completes the entry, and explicit Watching/Completed status changes stamp today's start/finish date (D116).
- **AnimeMetadataProvider** (`src/providers/metadata/types.ts` + `anilistMetadata.ts`): the backbone. Public discovery, no token needed. Methods `getHomeFeed/getTrending/getPopular/getAiring/getNewReleases/search/getAnime` share `MEDIA_FIELDS` and `mapAniListMediaToAnime`. `getHomeFeed` (D127) aliases Home's four rails into ONE request with a light card field set, cached as `anilist:home:<perPage>`. Used by `Home` (hero + rows via `useHomeFeed`), `Browse`, `Search`, detail overlays, and `Watch`. Keeps UI decoupled from GraphQL. AniList also owns episode names/thumbnails when present.
- **Kitsu episode fallback** (`src/services/kitsu/client.ts` + `src/hooks/useKitsuEpisodes.ts`): **names + episode thumbnails only**, for the whole entry, only when nothing usable survives the AniList display guards (D127 — season/range guards run first). Id-based mapping through `anilist/anime` then `myanimelist/anime`; no title search. Never tracker/identity/totals/discovery/artwork. A missing or empty Kitsu result leaves the existing UI placeholder. Full contract + gate: [`docs/PROVIDERS.md`](PROVIDERS.md) §3.
- **VideoProvider** (`src/providers/video/types.ts` + `registry.ts`): playback sources and source-mapped episode slots/duration. Never display titles or thumbnails.

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
- `src/contexts/MALContext.tsx` — MAL auth state (`isAuthenticated/token/user/animeList/loadingUser/loadingList/error/authExpired/redirectUri/hasClientId/login/logout/setManualToken/refresh/updateProgress/updateStatus/updateRating`), handles `?code=` callback via `handleMalOAuthCallback`, mirrors the AniList shape. Both trackers are live; `TrackingContext` selects the single active one (no cross-provider merge). MAL API transport stays behind the Worker proxy (`docs/PROVIDERS.md` §2).
- `src/contexts/TrackingContext.tsx` — unified `useTracking()`: exactly one active tracker (AniList or MAL), deduped active-tracker `combinedList`, `isAuthenticated`, `isAniListAuthenticated`, `isMALAuthenticated`, single-active-tracker mutations. UI consumes this, not direct provider. Both trackers are live; switching is a preference, never a merge.

## App Wiring

`src/App.tsx`: `BrowserRouter → AniListProvider → MALProvider → TrackingProvider → Layout` (D098; legacy `#/` links are translated in `main.tsx`). `src/components/anilist/AniListConnect.tsx` + `src/components/mal/MALConnect.tsx` in Settings/MyList; navbar `SearchSuggestions` picks push the show's canonical `/anime/<id>` or `/manga/<id>` URL and the floating card overlays (D097); `Navbar` shows avatar when authenticated, else Connect button; `Home` `Continue Watching`/`My List` use `combinedList`.

## Sync Strategy

Optimistic UI → provider mutation → failure restore → `clearMemoryCache` → `refresh` list. Reuses same TTL/dedup/inflight. No continuous polling, no duplicate requests, no request waterfall; Home's four rails ride ONE aliased metadata request (D127), MAL list only when authenticated.

Tracker writes (D127): opening an episode or chapter writes status Watching/Reading + the start date once (skipped when already Watching, suppressed by Incognito) — the "I started this" signal. Unit completion is separate: progress advances by one only at ≥80% playback / 80% of chapter pages or on ended, and only for a unit past the tracked progress, so rewatches never regress the list.

## Error States

`ProviderError`/`MalProviderError` `NETWORK/AUTH/NOT_FOUND/UNKNOWN` → concise friendly copy, no raw dump. `AUTH` clears tokens and shows reconnect CTA; `NETWORK` retryable with `Retry` buttons covering both providers.

## Loading States

Reuses `RowSkeleton`/`Skeleton` mirroring final layout, no new spinner design.

## Performance

- Tailwind v4 eliminates separate build step; Vite handles CSS.
- Cards `loading="lazy"` (hero `eager` for LCP, `fetchPriority="high"`), images `decoding="async"`, fallback `backdrop||cover`, `onError` hide.
- Detail + Watch not yet code-split via `React.lazy` (future), but metadata hooks dedup inflight.
- **Phase 4 (historical; superseded by D127):** Homepage issued 4 parallel `Page` requests (trending/popular/airing/new), each cached 5 min memory + 24 h IDB + dedup. Browse 1 request, Search debounced. **Phase 5:** Same; MAL adds no extra discovery requests (reuse `malFetch` cache/dedup), list fetched once per auth (paging `limit=1000`, up to 500 safety), mutations invalidate only memory cache.
- **Phase 6 (historical; superseded by D127):** Homepage then still used 4 parallel `Page` queries, each `perPage:12`, second load cached 0 new. **Current (D127):** ONE aliased `HOME_FEED_QUERY` request for all four rails with light `HOME_CARD_FIELDS` (cold 1 request, warm 0), plus viewport-gated card art. Browse `perPage:24` with `page` pagination (`hasNextPage` + `Load more`, append), filters server-side via `browse` (single request per filter change, deduped by `anilist:browse:…` key), Search live while typing debounced 300ms + 400ms URL sync, no duplicate/stale (hook `cancelled` + `clearTimeout` + `inflight` dedup). No dozens of requests, no huge datasets.
- No heavy carousel library.

## Video Provider Architecture (Phase 7 → 7.1)

```
Watch.tsx (shell renders immediately with anime title/backdrop, episode list immediate from anime.episodes/streamingEpisodes)
  ├─ useAnimeDetail (real anime) ──→ Anime (with streamingEpisodes)
  ├─ immediateEpisodes (derived from anime, no provider wait, shown instantly)
  ├─ resolveEpisodesWithFallback(Anime) ──→ VideoEpisode[] (parallel, 4s timeout, via registry, cached, fallback to Mock, does NOT block UI)
  │     ├─ AniWave (Worker resolver HLS; Tier 1, only browser-usable in production)
  │     ├─ AnimeGG (MP4; Tier 2 fallback, cert invalid in Playwright)
  │     └─ Mock (episode list only, no video, ensures navigation)
  ├─ resolveSourcesForLanguages(VideoEpisode) ──→ sources in sub+dub (parallel per language, tried[] union, only selected episode, not all)
  │     └─ Watch filters to direct HLS/MP4 (`isPlayableSource`; embed-only sources never enter the picker or player) → lazy VideoPlayer (Video.js v10 default skin + HlsJsVideo: HLS via MSE/native fallback, direct MP4; subtitles, resume, MediaSession; index-keyed source selector filtered to the active audio language, provider-only label with real quality only when not auto, no trailing Auto, Sub/Dub over the same list, loading/error/no-source distinct; D124/D125)
  ├─ nav: left-aligned Previous · white non-interactive current `Episode N` status · Next; unavailable sides are disabled manga-reader pills (D124)
  ├─ Synopsis heading above the description
  ├─ Related Anime + Related Manga rails (ContentRow + AnimeCard, home widths, 40px below Synopsis; D121/D122)
  ├─ episode grid tiles: AniList/Kitsu thumbnail → show backdrop/cover fallback, `Episode N`, base-color bottom gradient, same 6px border/radius frame as Related Anime, AnimeCard hover frost + play, white top-left `Now playing` chip (D124)
  ├─ TrackingContext.updateProgress(anime, epNum) (isolated, throttled 5s)
  └─ storage/db.ts watchPos (putWatchPos/getWatchPos/clearWatchPos, DB v2, resume prompt)
```

**Performance (Phase 7.1):** Shell renders 85ms, Home 4 parallel `POST graphql.anilist.co` at 141ms (all at same time, not waterfall), responses 840ms, hero 1.4s, first row 1.4s, cached Home 0 new (IDB), Watch shell 29ms, title 873ms, episode list 876ms immediate, source no-source 2.3s (parallel 3.5s max, not 21s sequential). `anilistGraphQL` now has 8s `AbortController` timeout (AniList p95 <1.5s, 8s allows slow nets without freezing shell), `fetchWithTimeout` 3500ms for video, `registry` 4000ms parallel. **D125:** the player route is lazy — main JS `599.94 kB` / `165.39 kB` gzip; `VideoPlayer` chunk `821.29 kB` / `243.16 kB` gzip; default-skin CSS `84.45 kB` / `9.71 kB` gzip. Home/Browse/Search/List load neither Video.js nor its CSS.

- `src/providers/video/types.ts` + `base.ts` (cachedFetch, isCorsError) + `registry.ts` (priority, fallback) + `mock.ts` + `src/components/player/VideoPlayer.tsx` (lazy Video.js v10 `VideoPlayer`/`VideoSkin` + `HlsJsVideo`; default skin; direct HLS/MP4 only; volume/resume/subtitles/MediaSession; no native controls, no iframe)
- **Production provider reality (2026-10-24):** AniWave resolves through the `aeri` Worker's same-origin signed relay and is the only browser-usable provider; it is Tier 1. AnimeGG is the Tier-2 fallback but fails Playwright with `ERR_CERT_AUTHORITY_INVALID` (CORS error visible while tried). MegaVid was removed entirely (D124) after its `Access-Control-Allow-Origin: https://megavid.buzz` proved the browser origin can never read it. Embed-only sources are filtered out before the player (D125). When nothing resolves, Watch shows the no-source UI with `Tried:` + Retry; episode navigation still works via Mock. Future browser-compatible providers just register in `videoProviders[]` with no UI change.
- **Performance:** Only selected episode's source is fetched (not all), inflight dedup, memory+IDB cache, no video pre-download, no dozens of requests.

## Future Extensibility

- New full metadata provider: implement `AnimeMetadataProvider` — requires only `map` + `identity` extension, no UI change. Kitsu is intentionally **not** a full metadata provider; its narrow episode fallback is documented in `docs/PROVIDERS.md` and must not grow into one.
- New tracking provider: implement `TrackingProvider` — the supported product surface is still exactly AniList or MAL unless the owner explicitly broadens it.
- New video source: implement `VideoProvider` (add to `registry.ts` priority) returning **direct HLS/MP4** sources. Embed/iframe sources are filtered by Watch and are not a second player path.
