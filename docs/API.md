# API — Aeri

## Providers

### TrackingProvider (user-specific)

```ts
interface TrackingProvider {
  id: 'anilist' | 'mal'
  getUser(token?: string): Promise<AniListUser>
  getAnimeList(token?: string): Promise<AnimeListEntry[]>
  getAnime(id: string): Promise<Anime>
  search(query: string): Promise<Anime[]>
  updateProgress(id: string, episode: number): Promise<void>
  updateStatus(id: string, status: AnimeStatus): Promise<void>
  updateRating(id: string, rating: number): Promise<void>
}
```

- `src/providers/anilist/provider.ts` (`AniListProvider`, singleton `aniListProvider`) implements AniList GraphQL (`https://graphql.anilist.co`)
- `src/providers/mal/provider.ts` implements MAL REST (`https://api.myanimelist.net/v2`) — Phase 5
- Both adapt to common `Anime` / `AnimeListEntry` types (`src/types/anime.ts`).

#### AniList Tracking implementation (Authorization Code, client 50024)

**Authentication (Authorization Code Grant via server):** `response_type=code` + random `state` via `https://anilist.co/api/v2/oauth/authorize?client_id=50024&response_type=code&redirect_uri={origin+BASE_URL}&state={random}`. Implicit grant is rejected by this client (`400 unsupported_grant_type`, proven live twice — do not revert). Callback `?code=&state=` is handled in `AniListContext` effect: state validated against `aeri:anilist:oauth_state`, code exchanged via `POST /api/anilist/token` (Worker injects `ANILIST_CLIENT_SECRET`, or preferred `auth-proxy` on non-Cloudflare hosting since AniList 403-blocks all Cloudflare Worker IPs — see D041; endpoint order `customAuthApiUrl` → `VITE_AUTH_API_URL` → worker/same-origin). Browser never calls `https://anilist.co/api/v2/oauth/token` and never holds the secret. Token stored via `src/storage/anilist.ts` (`aeri:anilist:token`, `aeri:anilist:token_expiry`). MAL codes are ignored by state-match guard (D042). Manual paste fallback (`parseManualToken`) supports raw tokens or code URLs.

**User:** `Viewer { id name avatar { large } bannerImage }` via `VIEWER_QUERY`. Cached 5 min (memory) + 24 h (IndexedDB) + deduped. Requires `Authorization: Bearer <token>`.

**List:** `MediaListCollection(userId, type:ANIME)` after resolving `Viewer.id`. Iterates **all** `lists` (including custom lists per AniList docs — entries can be hidden from default status buckets). Maps each `MediaListEntry` via `src/services/anilist/mapper.ts:mapAniListEntryToAeri`. De-duplicates by `internalId`. Cache key `anilist:list:<userId>`.

**Anime fetch:** `Media(id, type:ANIME)` — `coverImage { extraLarge large medium }`, `bannerImage`, `title { romaji english native }`, `description` (HTML stripped), `seasonYear/startDate`, `episodes/duration/status/averageScore/genres/studios/format/popularity/idMal`. Cache key `anilist:anime:<id>`.

**Search (tracking):** `Page(perPage:12) { media(search, type:ANIME) }` — debounced 300 ms. Uses same mapper. Cache key `anilist:search:<lower>` (tracking search path, now superseded by metadata provider for public search).

**Progress/status/rating sync:** `SaveMediaListEntry` mutation. `updateProgress` looks up `mediaListEntry.id` via `Media { mediaListEntry }` if not in cached list, then `SaveMediaListEntry(id|mediaId, progress)`; a progress write that CREATES the entry also sends `status: CURRENT` + `startedAt` today (D116). `updateStatus` maps `watching→CURRENT, completed→COMPLETED, planned→PLANNING, on_hold→PAUSED, dropped→DROPPED` via `aeriStatusToAnilist` and always sends FuzzyDateInput `startedAt` for watching / `completedAt` for completed; `updateRating` sends `score` (0-10, respects user's scoring format — 10-point assumption for Phase 3). Progress calls originate only at ≥80% watched/read or on ended (never on page open), and reaching a known total auto-completes. All require `Authorization` header. On success clears memory cache (`clearAnilistMemoryCache`) to force fresh list.

**My List integration:** `src/contexts/AniListContext.tsx` provides `isAuthenticated, user, animeList, loadingUser/loadingList, error, authExpired`. `src/pages/MyList.tsx` and `src/pages/Home.tsx` consume `animeList` for `Continue Watching` and `My List` rows; fall back to mock when unauthenticated. `src/components/detail/DetailModal.tsx` and `src/components/episodes/EpisodeList.tsx` + `src/pages/Watch.tsx` call `updateProgress` optimistically.

**Loading/error/auth-expired states:** `AniListContext` tracks `loadingUser/loadingList`, `error`, `authExpired`. `ProviderError` codes `NETWORK/AUTH/NOT_FOUND/UNKNOWN` map to friendly UI: `MyList` shows `RowSkeleton` while loading, inline retry on `NETWORK`, amber banner on `AUTH` with reconnect CTA, `AniListConnectCompact` for paste/redirect. `DetailModal` shows status/score badges and syncing spinner; `Search` shows pulse skeletons. No raw dumps.

**Local caching:** `src/services/anilist/client.ts:anilistGraphQL` — in-memory `Map<query+vars, {value, expiry}>` TTL 5 min, IndexedDB via `src/storage/db.ts:putCache/getCache` TTL 24 h, and `inflight` dedup map for concurrent requests. All queries use `cacheKey` where appropriate (viewer, list, anime, search). Mutations use `useCache:false`.

#### MAL Tracking implementation (Phase 5)

**Authentication (PKCE `plain` via Worker proxy):** `GET https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id={VITE_MAL_CLIENT_ID}&code_challenge=<verifier>&code_challenge_method=plain&state=<random>` via `src/services/mal/auth.ts:buildMalAuthorizeUrl`. MAL supports ONLY `plain` (S256 proven broken live — D051). `code_verifier` random 96 chars (43-128), `state` 32 chars, `code_challenge === verifier`. Redirect URI `window.location.origin + import.meta.env.BASE_URL` (production: `https://aeri.fastdemo.workers.dev/` — base is `/`; the old `https://fastdemo.github.io/aeri/` example is historical GH Pages). Code is parsed from `window.location.search` (`?code=&state=`) in `src/contexts/MALContext.tsx` effect and `src/services/mal/auth.ts:handleMalOAuthCallback` (state validated, verifier retrieved from storage). Exchange `POST /api/mal/token` on the Worker (preferred; Worker injects `MAL_CLIENT_SECRET` server-side, then proxies `https://myanimelist.net/v1/oauth2/token`) with direct `POST https://myanimelist.net/v1/oauth2/token` fallback (`client_id, grant_type=authorization_code, code, code_verifier`, `Content-Type: application/x-www-form-urlencoded`, `Accept: application/json`) → `{ access_token, refresh_token, expires_in }`. Refresh via `grant_type=refresh_token` when expiry within 1 min (`isMalTokenExpired` buffer), same Worker endpoint (secret injected for both grants). Tokens stored via `src/storage/mal.ts` (`aeri:mal:access_token`, `aeri:mal:refresh_token`, `aeri:mal:token_expiry`, plus `aeri:mal:oauth_state`/`code_verifier` transient). No `client_secret` in the browser, no hard-coded secret — `VITE_MAL_CLIENT_ID` env (fallback empty, manual paste path). Manual paste fallback `parseMalManualToken` supports raw token or URL with `code`.

**User:** `GET /users/@me` → `{ id, name, picture }` via `malFetch` (Bearer). Cached 5 min + 24 h + dedup. Mapped to `AniListUser` shape `{ id, name, avatar:{large} }`.

**List:** `GET /users/@me/animelist?fields=list_status{status,score,num_episodes_watched,updated_at},num_episodes,genres,main_picture,alternative_titles,start_date,synopsis,mean,status,media_type,studios,nsfw&limit=1000&nsfw=true` with pagination via `paging.next` (stripped to relative, loop up to 500 safety). Maps each `MALListEntryRaw` via `src/services/mal/mapper.ts:mapMALEntryToAeri` (status `watching/completed/on_hold/dropped/plan_to_watch` → `watching/completed/on_hold/dropped/planned`, percent from `progress/episodes`, `inList/listStatus`, preserves `malId`). Cache key `mal:list` (first page) + `mal:viewer`.

**Anime fetch:** `GET /anime/{id}?fields=id,title,main_picture,alternative_titles,start_date,synopsis,mean,num_episodes,status,genres,studios,media_type,nsfw,my_list_status{status,score,num_episodes_watched}` via `mapMALNodeToAnime` (title `ja→romaji`/`en→english`, `main_picture.large`, `mean` 0-10, `nsfw` passed). Cache key `mal:anime:<id>`.

**Search (tracking-only):** `GET /anime?q=<query>&limit=12&fields=...&nsfw=true` → `mapMALNodeToAnime`. Cache key `mal:search:<lower>`. Not used for UI discovery (public `AnimeMetadataProvider` remains primary); kept for provider conformance.

**Progress/status/rating sync:** `PUT /anime/{id}/my_list_status` (`Content-Type: application/x-www-form-urlencoded`, body `status`/`num_watched_episodes`/`start_date`/`finish_date`/`score`). `updateProgress` fetches current `my_list_status` to preserve status then sends `num_watched_episodes`; when the title is not in the list it also sends `start_date` (today) so a progress-created entry is dated. Manga progress uses `/manga/{id}` and `num_chapters_read`, and reads `/manga/{id}?fields=my_list_status{status}` first (manga ids are a separate namespace from anime ids). `updateStatus` maps `watching→watching, completed→completed, planned→plan_to_watch, on_hold→on_hold, dropped→dropped` via `aeriStatusToMal` and always sends `start_date` for watching / `finish_date` for completed (D116); `updateRating` sends `score` 0-10. Progress calls originate only at ≥80% watched/read or on ended — never on page open — and broken records are gated before any request. Requires Bearer. On success `clearMalMemoryCache()` to force fresh list. `toMalId` resolves `mal-123` or numeric; throws `NOT_FOUND` friendly for `anilist-xxx` without `malId`.

**My List integration:** `src/contexts/MALContext.tsx` mirrors `AniListContext` (`isAuthenticated, user, animeList, loadingUser/loadingList, error, authExpired`, `login/logout/setManualToken/refresh`, optimistic `updateProgress/updateStatus/updateRating` with `malId` resolution from `anime.identity` or the tracker's list). `src/contexts/TrackingContext.tsx` exposes a single active tracker (`trackingProvider`, switchable via `TrackerPicker` in the sign-in modal and Settings; auto AniList-first): reads (`combinedList`) and all mutations go to that account only — no merging, no fan-out. When the tracker is MAL, `src/services/mal/enrichment.ts:enrichMalEntriesWithAnilist` upgrades entries to AniList display metadata via kind-scoped `Media(idMal:, type: ANIME|MANGA)` lookups (cached `anilist:bymal:anime:<id>` / `anilist:bymal:manga:<id>`; tracking truth stays MAL). **D110 (owner rule 2026-10-20): AniList is the sole metadata renderer** — the resolved array stays resident across list re-fires (no reset to raw MAL between passes); **D111 (owner rule 2026-10-21) supercharges it: resolution is BATCH-FIRST** — one `Page(perPage: 50) { media(idMal_in: …) }` request per ≤50-id chunk resolves the whole list (`anilistMetadata.getBatchByMalIds`), seeding every per-id cache key (positives AND definitive negatives `{ Media: null }`), then the per-entry pipeline runs only as a throttle fallback; the D110 display gate gains the show-everything term — display when `identity.anilistId != null` OR `noAniListRecord === true` (a batch-PROVEN unmapped entry shows its stable MAL-side record; entries whose lookups haven't answered stay held back until a later pass). UI (`Home` Continue Watching, `MyList`, `DetailModal`, `EpisodeList`, `Watch`) uses `useTracking`, not direct provider.

**Loading/error/auth-expired states:** `MalProviderError` same codes as `ProviderError`; `MALContext` clears tokens on 401/403 and surfaces `authExpired`; `MyList` shows `RowSkeleton`, retry buttons for both providers, amber `Session expired` banner, compact `MALConnectCompact` (MAL badge `#2e51a2`, paste token fallback, redirect URI hint). No raw dumps.

**Local caching (shared):** `src/services/mal/client.ts:malFetch` reuses same `memoryCache` TTL 5 min + IDB `putCache/getCache` TTL 24 h + `inflight` dedup as `anilistGraphQL`, with `ensureFreshToken` auto-refresh (1 min buffer) and `clearMalTokens` on AUTH. Keys `mal:*`. Homepage discovery uses ONE aliased AniList request (D127), cached; MAL list only fetched when authenticated.

### AnimeMetadataProvider (public discovery, Phase 4 → Phase 6)

```ts
interface AnimeMetadataProvider {
  id: string
  getAnime(id: string): Promise<Anime>
  search(query: string, perPage?: number): Promise<Anime[]>
  getTrending(perPage?: number): Promise<Anime[]>
  getPopular(perPage?: number): Promise<Anime[]>
  getAiring(perPage?: number): Promise<Anime[]>
  getNewReleases(perPage?: number): Promise<Anime[]>
  getHomeFeed(perPage?: number): Promise<HomeFeed>        // D127 — one request for Home's four rails
  getUpcoming(perPage?: number): Promise<Anime[]>      // Phase 6
  getFinished(perPage?: number): Promise<Anime[]>      // Phase 6
  browse(params: BrowseParams): Promise<{ data: Anime[]; hasNextPage: boolean; pageInfo } > // Phase 6
}
type BrowseParams = { sort?: string; status?: string; genre?: string; seasonYear?: number; season?: string; format?: string; perPage?: number; page?: number }
```

- `src/providers/metadata/types.ts` defines the abstraction; `src/providers/metadata/anilistMetadata.ts` (`AniListMetadataProvider`, singleton `anilistMetadataProvider`) is the first implementation. UI never imports AniList GraphQL types directly — all through normalized `Anime`.
- **Implementation:** Uses `anilistGraphQL` (same client/cache/dedup as TrackingProvider, no token required for public data). Queries:
  - `Trending`: `Page(media(type:ANIME, isAdult:false, sort:TRENDING_DESC))`
  - `Popular`: `sort:POPULARITY_DESC`
  - `Airing`: `sort:POPULARITY_DESC, status:RELEASING`
  - `New Releases`: `sort:START_DATE_DESC, status:FINISHED`
  - `Upcoming`: `sort:POPULARITY_DESC, status:NOT_YET_RELEASED` (Phase 6)
  - `Finished`: `sort:END_DATE_DESC, status:FINISHED` (Phase 6)
  - `Browse`: dynamic `Page(media(type:ANIME, isAdult:false, sort, status, genre, seasonYear, season, format))` with `pageInfo { hasNextPage currentPage lastPage }` for pagination (Phase 6)
  - `Search`: `Page(media(search, type:ANIME, isAdult:false))`
  - `Anime`: `Media(id, type:ANIME)`
  All share `MEDIA_FIELDS` (`id/idMal/title/description/coverImage{extraLarge large medium}/bannerImage/startDate/season/seasonYear/episodes/duration/status/averageScore/genres/studios/format/popularity`). Mapped via `mapAniListMediaToAnime` (HTML stripped via `cleanDescription`, `banner→cover` fallback, `averageScore/10`, `external IDs` `idMal`).
- **Caching:** Same architecture extended — memory 5 min + IDB 24 h + `inflight` dedup, keys `anilist:home:<perPage>` (D127 — the four Home rails as ONE unit), `anilist:trending:<perPage>`, `anilist:popular:<perPage>`, `anilist:airing:<perPage>`, `anilist:new:<perPage>`, `anilist:upcoming:<perPage>`, `anilist:finished:<perPage>`, `anilist:browse:<sort:status:genre:year:season:format:perPage:page>`, `anilist:search:<query>:<perPage>`, `anilist:anime:<id>`. Public metadata therefore not refetched on every navigation; Home issues ONE aliased request cold and 0 while warm. Browse `useBrowse` deduplicates per filter set and supports `loadMore` via `page` increment without refetching previous pages (append).
- **Home usage (D127):** `src/pages/Home.tsx` uses `useHomeFeed(24)` → `HOME_FEED_QUERY`, which aliases trending / popular / airing / new releases into one request with the light `HOME_CARD_FIELDS` set (no relations, streamingEpisodes, staff, or studios). `mapHomePage` keeps those light records out of the shared media cache, since `getAnime` requires relations. `Because you watched` and the other derived rows are computed in memory from that feed. Hero is the first trending entry (real `bannerImage` or `cover` fallback) with `RowSkeleton` while loading. `Continue Watching`/`My List` via `useTracking` `combinedList`. Unauthenticated users still get useful public discovery; no mock discovery path. Card art is viewport-gated (`useNearViewport`) with above-the-fold tiles eager.
- **Browse usage:** `src/pages/Browse.tsx` uses `useBrowse` with category tabs `Popular (POPULARITY_DESC)`, `Trending (TRENDING_DESC)`, `Airing (RELEASING)`, `Upcoming (NOT_YET_RELEASED)`, `Finished (FINISHED+END_DATE_DESC)` and filters `genre`, `seasonYear`, `season` (WINTER/SPRING/SUMMER/FALL), `format` (TV/MOVIE/OVA/SPECIAL) as server-side AniList filters. `perPage = columns × 5` via `useGridColumns()` (10/15/20/25/30 for 2/3/4/5/6 cols) so every fetch renders complete rows at any viewport; pagination via `hasNextPage` + `Load more` (appends full rows). Loading shows `perPage` pulse slots, error shows retry, empty shows “No titles match your filters.” No mock.
- **Search usage:** `src/pages/Search.tsx` uses `useAnimeSearch(liveQuery, 12)` (debounced, URL-synced). Navbar `SearchSuggestions` pushes the show's canonical `/anime/<id>`/`/manga/<id>` URL — the floating overlay card renders there (D097); option buttons carry `type="button"` so picks never submit the wrapping search form.
- **Detail usage:** `src/components/detail/DetailRoute.tsx` (overlay route for `/anime/:id` + `/manga/:id`) resolves via the carried record → tracking-list copy (`'mal-…'` ids) → `useAnimeDetail` / `useMangaDetail` (`anilistMetadataProvider.getAnime`/`getManga`) for real metadata (title, alt titles, description, cover/banner, episodes/duration/status/year/season/genres/studios/score/popularity/external IDs). `src/pages/AnimeDetail.tsx` is deleted (D097); legacy slug fallback removed with it.
- **Images (Phase 6):** Real content uses `coverImage.extraLarge/large` and `bannerImage` from AniList; `AnimeCard` `loading="lazy"` + `fallbackSrc = backdropImage || coverImage` with `onError` hide, `decoding="async"`, `Hero`/`Watch` `loading="eager"` `fetchPriority="high"` for LCP. No huge artwork loading below fold; Picsum remains only in `mockAnime.ts` fallback/test fixture.

### VideoProvider (Phase 7)

```ts
type VideoLanguage = 'sub' | 'dub'
interface VideoEpisode { id: string; animeId: string; number: number; title?: string; provider: string; providerEpisodeId: string; language?: VideoLanguage }
interface VideoSourceEnhanced extends VideoSource { provider: string; language?: VideoLanguage; subtitles?: SubtitleTrack[]; embed?: boolean; quality: string; type: string; url: string }
```

`embed` remains in the provider contract for transparency, but Watch filters
embeds out before the player (D125); direct `hls`/`mp4` sources only reach
Video.js.

```ts
interface SubtitleTrack { language: string; label: string; url: string; type?: string }
interface ProviderCapabilities { id: string; name: string; displayName: string; languages: VideoLanguage[]; subtitles: boolean; embed: boolean; directVideo: boolean; search: boolean; episodes: boolean; sources: boolean }
interface VideoProvider {
  id: string; name: string; capabilities: ProviderCapabilities
  resolveAnimeId(anime: Anime): Promise<string | null>
  getEpisodes(anime: Anime): Promise<VideoEpisode[]>
  getSources(episode: VideoEpisode): Promise<VideoSourceEnhanced[]>
}
```

- `src/providers/video/types.ts` defines `VideoEpisode`, `VideoSourceEnhanced`, `SubtitleTrack`, `ProviderCapabilities`, `VideoProvider` (normalized from provider-specific JSON).
- `src/providers/video/base.ts` — `cachedFetch(key, fetcher)` with memory 5m + IDB 24h + `inflight` dedup (reuses `src/storage/db.ts`), `isCorsError()` for `Failed to fetch`, `fetchWithTimeout(input, init, 3500ms)` via `AbortController` (3500ms chosen after Playwright profiling: CORS/DNS failures 200-800ms, bound at 3.5s), `VIDEO_PROVIDER_TIMEOUT_MS = 3500`.
- Implementations (`src/providers/video/*.ts`): `MockVideoProvider` (episodes only, no sources, for navigation), `AnimeGGProvider`, and `AniWaveProvider` are `verified`; the older AllAnime/AnimePahe/AniKoto/MegaPlay/AnimeParadise/AniNeko files remain as unverified stubs and are excluded from every request by the verified-only pool. `MegaVidProvider` was deleted (D124).
- `src/providers/video/registry.ts` — `videoProviders[]` order is `[aniwave, animegg, custom, miruro, …unverified stubs, mock]`; `getEnabledProviders()` filters `status === 'verified'`, so production requests only AniWave/AnimeGG (subject to Settings). Old `megavid` prefs are ignored. **Phase 7.1:** `resolveEpisodesWithFallback` runs in parallel (`Promise.allSettled`, 4000ms registry timeout). `resolveSourcesForLanguages()` wraps `resolveSourcesWithFallback()` once per requested language (`sub`, `dub`) and unions/dedupes the results; single-language callers use the old resolver unchanged. Episode list in Watch is **immediate** from `anime.episodes/streamingEpisodes` (not blocked by video provider), source discovery runs in background. `getProviderCapabilities()` for UI.
- **Identity:** `AniList anime (anilistId/malId/title) → provider anime ID → provider episode ID → source`. Stable `anilistId`/`malId` preferred, title fallback. Successful mappings cached (`video:allanime:resolve:anilistId`). No expensive search on every episode click.
- **Watch usage:** `src/pages/Watch.tsx` → `useAnimeDetail` for anime → `resolveEpisodesWithFallback` (single episode list fetch) → `resolveSourcesForLanguages` for `effectiveEpisode` (only selected episode, not all; `['sub','dub']` in one pass) → `isPlayableSource` (direct HLS/MP4 only) → lazy `src/components/player/VideoPlayer.tsx` (one Video.js v10 `VideoJsPlayer` + default `VideoSkin` + `HlsJsVideo`; HLS via MSE/native fallback, direct MP4; `crossOrigin`, `subtitles` tracks, `onTimeUpdate`/`onEnded`, cover-cropped poster). Source selector is index-keyed (duplicate URLs cannot collapse options), lists only the resolved **direct** sources for the active audio language with the provider-only label (a real quality only when not `auto`; no trailing Auto; D124), and Sub/Dub switches over the same list without refetching; a missing language stays disabled. Embed-only sources are filtered out and never create an iframe (D125). Subtitles render as `track` elements inside the player.
- **Caching:** Reuses `memoryCache`/`IDB`/`inflight` from `base.ts`, no second cache, only fetches selected episode's source, deduplicates concurrent `resolveEpisodes`/`resolveSources`.
- **Playback:** Video.js v10's default skin owns `play/pause/seek/volume/fullscreen/PiP/Cast/AirPlay/captions/settings/buffering/error`; the app still owns the `aspect-video` container, resume/volume/subtitle/MediaSession effects, `isLoadingVideo`/no-source states, and `prefers-reduced-motion`. Errors surface in the default-skin alert dialog (not a second custom overlay).
- **Progress sync:** `Watch → TrackingContext → AniList` (isolated): `useEffect` on mount calls `updateProgress(anime, epNum)` + `localStorage aeri:progress:…`, `handleTimeUpdate` throttled 5s via `putWatchPos`, near end `>92%` calls `updateProgress`, `onEnded` clears `watchPos` + updates progress. No coupling `VideoProvider → AniList`.
- **Local watch position:** `src/storage/db.ts` `DB_VERSION 2` adds `watchPos` store `{id, episode, currentTime, duration, updatedAt}`, `putWatchPos`/`getWatchPos`/`clearWatchPos`, `onTimeUpdate` throttled, `getWatchPos` on load shows resume prompt `Resume from M:SS?` if `>30s && <90%` and same episode, otherwise auto-seek, `clearWatchPos` on near-complete or Restart.
- **Limitations (historical — pre-Worker era, documented 2026-08-29):** All 6 real providers return **no-source** from browser due to CORS (`No 'Access-Control-Allow-Origin'` for `api.myanimelist.net` style, `animepahe.ru`/`animeparadise.moe` CORS blocked, `anikoto.to` DNS fail, `megaplay.buzz` 200 but HTML Error, `allanime.day` CORS OK but query requires exact schema and Cloudflare; all fetch from `https://fastdemo.github.io` → `ERR_FAILED` → `Failed to fetch`). Documented in provider files as `browser-incompatible` without proxy. `MockVideoProvider` ensures episode navigation still works, Watch shows **no-source UI** `Video unavailable • No browser-compatible source was found for Episode N. Aeri is static with no backend; most providers require a server proxy. Try another episode or source. Tried: …` with `Retry` + `Episodes` + provider caps footer, not blank.
- Authorized sources only, no DRM bypass, no secrets in `VITE_*` (client IDs are public; `ANILIST_CLIENT_SECRET` lives only in Worker secrets / auth-proxy env, never in bundles).

## Anime Type (normalized) — Phase 7.1 corrections

```ts
interface AnimeIdentity { internalId: string; anilistId?: number; malId?: number }
interface Anime {
  identity: AnimeIdentity
  title: { romaji: string; english?: string; native?: string }
  description: string // AniList HTML stripped (cleanDescription), 900 chars max, no fake suffix
  coverImage: string   // AniList extraLarge>large>medium, real, no picsum
  backdropImage: string // AniList bannerImage or cover fallback (hero/cards), real
  bannerImage?: string
  year?: number // seasonYear ?? startDate.year, real
  season?: string // WINTER/SPRING/SUMMER/FALL, real
  episodes?: number // real, no fake
  duration?: number // real minutes
  status?: string // FINISHED/RELEASING/NOT_YET_RELEASED/HIATUS/CANCELLED, real
  rating?: number // 0-10 (averageScore/10), real
  genres: string[] // real AniList genres, no inference
  studios?: string[] // real: only isAnimationStudio true (filtered from nodes), not producers; edges.isMain preferred
  format?: string // TV, Movie, OVA, SPECIAL etc., real
  streamingEpisodes?: { title?: string; thumbnail?: string; url?: string; site?: string }[] // real AniList streamingEpisodes (Crunchyroll etc.), title/thumbnail only if provided, not fabricated
  isAdult?: boolean // real isAdult, NOT mapped to T18/PG-13; UI hides age rating when unavailable
  popularity?: number
  progress?: { episode: number; percent: number }
  listStatus?: AnimeStatus
  inList?: boolean
}
```

## Mapping

`src/lib/identity.ts` holds map. Never equate `anilistId === malId`. `src/services/anilist/mapper.ts` handles AniList→Aeri: `mapAniListMediaToAnime` (strips HTML, picks `extraLarge→large→medium`, `banner→cover` fallback, `averageScore/10`, `stolabs`, preserves `idMal`), `mapAniListEntryToAeri` (status via `anilistStatusToAeri`, percent from `progress/episodes`, `inList/listStatus`). `src/services/mal/mapper.ts` handles MAL→Aeri: `mapMALNodeToAnime`/`mapMALEntryToAeri` (`malStatusToAeri`/`aeriStatusToMal`, `mean` 0-10, `main_picture`, title `ja`/`en`, percent from `num_episodes_watched/num_episodes`, preserves `malId` for `TrackingContext` dedup).

## Caching

- In-memory `Map<string,{value,expiry}>` TTL 5 min for all metadata (trending/popular/airing/new/search/anime + viewer/lists) — shared by `anilistGraphQL` and `malFetch`
- IndexedDB `cache` store keys `anilist:*` + `mal:*` TTL 24 h via `putCache/getCache` (shared for tracking + metadata + MAL, no second system)
- Deduplicate concurrent fetches via `inflight` promise map (both clients)
- Early `?code=` handling: AniList and MAL callbacks are both search params and survive HashRouter; each context claims only codes whose `state` matches its own stored state (D042). No hash-token parsing remains.
- Public metadata cached same as tracking; Home's four rails ride ONE aliased request (D127) deduped and cached; MAL user/list cached same TTL

## Search

Debounced 300 ms in `src/hooks/useAnimeMetadata.ts:useAnimeSearch` and `src/pages/Search.tsx`. Always delegates to `anilistMetadataProvider.search` (AniList `Page` query) for real results, regardless of auth. Returns `Anime[]` sorted by AniList relevance. Handles loading (pulse), empty (`No results for “q”`), network/rate-limit (friendly string from `ProviderError`), no raw dump.

## Mock Mode

Phase 2: `src/data/mockAnime.ts` satisfies same interfaces deterministically; no network. Phase 3 retains mock as fallback when unauthenticated. **Phase 4:** `mockAnime.ts` kept as fallback/test fixture only; production `Home`/`Browse`/`Search`/`AnimeDetail`/`Watch` no longer depend on mock when real AniList data is available — they use `AnimeMetadataProvider` with mock only as fallback if remote fails or for unauthenticated `Continue Watching`/`My List` empty states.

## Error Handling

All provider methods throw `ProviderError`/`MalProviderError` `{ code, message, retryable }` (`src/services/anilist/errors.ts` / `src/services/mal/client.ts`). Client clears token on 401/403 and throws `AUTH`. UI maps to friendly copy:
- `NETWORK` → "Couldn’t reach AniList/MyAnimeList. Check your connection." / "rate-limited. Try again" / "temporarily unavailable" (retryable, `retry` button in MyList, `RowSkeleton`/`error` banner in Home/Browse)
- `AUTH` → "Session expired. Reconnect." (amber banner, `AniListConnectCompact` / `MALConnectCompact`; `MalProviderError: "MyAnimeList session expired. Please reconnect."`)
- `NOT_FOUND` → "We couldn’t find that anime." / "We couldn’t find that anime on MyAnimeList. This title may not be linked to MAL."
- Generic → "Something went wrong."

No raw error dumps. `src/contexts/AniListContext` + `MALContext` surface `error` + `authExpired` for skeletons/banners; `src/contexts/TrackingContext` merges; `src/hooks/useAnimeMetadata` surfaces `error` for section error banners.
