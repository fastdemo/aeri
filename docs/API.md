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

#### AniList Tracking implementation (Phase 3)

**Authentication (browser-safe, no backend):** Implicit grant (`response_type=token`) via `https://anilist.co/api/v2/oauth/authorize?client_id={VITE_ANILIST_CLIENT_ID}&response_type=token`. Redirect URI is `window.location.origin + import.meta.env.BASE_URL` (e.g. `https://fastdemo.github.io/aeri/`). Token is parsed from `window.location.hash` **before** `HashRouter` mounts (`src/main.tsx` early handler) and again in `src/services/anilist/auth.ts:handleAnilistOAuthCallback`. Token stored via `src/storage/anilist.ts` (`aeri:anilist:token`, `aeri:anilist:token_expiry`) — never scattered `localStorage.getItem`. Manual paste fallback (`parseManualToken`) supports `access_token` fragments or raw JWT for local dev without `VITE_ANILIST_CLIENT_ID`.

**User:** `Viewer { id name avatar { large } bannerImage }` via `VIEWER_QUERY`. Cached 5 min (memory) + 24 h (IndexedDB) + deduped. Requires `Authorization: Bearer <token>`.

**List:** `MediaListCollection(userId, type:ANIME)` after resolving `Viewer.id`. Iterates **all** `lists` (including custom lists per AniList docs — entries can be hidden from default status buckets). Maps each `MediaListEntry` via `src/services/anilist/mapper.ts:mapAniListEntryToAeri`. De-duplicates by `internalId`. Cache key `anilist:list:<userId>`.

**Anime fetch:** `Media(id, type:ANIME)` — `coverImage { extraLarge large medium }`, `bannerImage`, `title { romaji english native }`, `description` (HTML stripped), `seasonYear/startDate`, `episodes/duration/status/averageScore/genres/studios/format/popularity/idMal`. Cache key `anilist:anime:<id>`.

**Search (tracking):** `Page(perPage:12) { media(search, type:ANIME) }` — debounced 300 ms. Uses same mapper. Cache key `anilist:search:<lower>` (tracking search path, now superseded by metadata provider for public search).

**Progress/status/rating sync:** `SaveMediaListEntry` mutation. `updateProgress` looks up `mediaListEntry.id` via `Media { mediaListEntry }` if not in cached list, then `SaveMediaListEntry(id|mediaId, progress)`; `updateStatus` maps `watching→CURRENT, completed→COMPLETED, planned→PLANNING, on_hold→PAUSED, dropped→DROPPED` via `aeriStatusToAnilist`; `updateRating` sends `score` (0-10, respects user's scoring format — 10-point assumption for Phase 3). All require `Authorization` header. On success clears memory cache (`clearAnilistMemoryCache`) to force fresh list.

**My List integration:** `src/contexts/AniListContext.tsx` provides `isAuthenticated, user, animeList, loadingUser/loadingList, error, authExpired`. `src/pages/MyList.tsx` and `src/pages/Home.tsx` consume `animeList` for `Continue Watching` and `My List` rows; fall back to mock when unauthenticated. `src/components/detail/DetailModal.tsx` and `src/components/episodes/EpisodeList.tsx` + `src/pages/Watch.tsx` call `updateProgress` optimistically.

**Loading/error/auth-expired states:** `AniListContext` tracks `loadingUser/loadingList`, `error`, `authExpired`. `ProviderError` codes `NETWORK/AUTH/NOT_FOUND/UNKNOWN` map to friendly UI: `MyList` shows `RowSkeleton` while loading, inline retry on `NETWORK`, amber banner on `AUTH` with reconnect CTA, `AniListConnectCompact` for paste/redirect. `DetailModal` shows status/score badges and syncing spinner; `Search` shows pulse skeletons. No raw dumps.

**Local caching:** `src/services/anilist/client.ts:anilistGraphQL` — in-memory `Map<query+vars, {value, expiry}>` TTL 5 min, IndexedDB via `src/storage/db.ts:putCache/getCache` TTL 24 h, and `inflight` dedup map for concurrent requests. All queries use `cacheKey` where appropriate (viewer, list, anime, search). Mutations use `useCache:false`.

#### MAL Tracking implementation (Phase 5)

**Authentication (browser-safe, no backend, PKCE S256):** `GET https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id={VITE_MAL_CLIENT_ID}&code_challenge=<base64url-SHA256-verifier>&code_challenge_method=S256&state=<random>` via `src/services/mal/auth.ts:buildMalAuthorizeUrl`. `code_verifier` random 96 chars (43-128), `state` 32 chars, `code_challenge` is SHA256 base64url of verifier. Redirect URI `window.location.origin + import.meta.env.BASE_URL` (`https://fastdemo.github.io/aeri/`). Code is parsed from `window.location.search` (`?code=&state=`) in `src/contexts/MALContext.tsx` effect and `src/services/mal/auth.ts:handleMalOAuthCallback` (state validated, verifier retrieved from storage). Exchange `POST https://myanimelist.net/v1/oauth2/token` (`client_id, grant_type=authorization_code, code, code_verifier`, `Content-Type: application/x-www-form-urlencoded`, `Accept: application/json`) → `{ access_token, refresh_token, expires_in }`. Refresh via `grant_type=refresh_token` when expiry within 1 min (`isMalTokenExpired` buffer). Tokens stored via `src/storage/mal.ts` (`aeri:mal:access_token`, `aeri:mal:refresh_token`, `aeri:mal:token_expiry`, plus `aeri:mal:oauth_state`/`code_verifier` transient). No `client_secret`, no hard-coded secret — `VITE_MAL_CLIENT_ID` env (fallback empty, manual paste path). Manual paste fallback `parseMalManualToken` supports raw token or URL with `code`.

**User:** `GET /users/@me` → `{ id, name, picture }` via `malFetch` (Bearer). Cached 5 min + 24 h + dedup. Mapped to `AniListUser` shape `{ id, name, avatar:{large} }`.

**List:** `GET /users/@me/animelist?fields=list_status{status,score,num_episodes_watched,updated_at},num_episodes,genres,main_picture,alternative_titles,start_date,synopsis,mean,status,media_type,studios,nsfw&limit=1000&nsfw=true` with pagination via `paging.next` (stripped to relative, loop up to 500 safety). Maps each `MALListEntryRaw` via `src/services/mal/mapper.ts:mapMALEntryToAeri` (status `watching/completed/on_hold/dropped/plan_to_watch` → `watching/completed/on_hold/dropped/planned`, percent from `progress/episodes`, `inList/listStatus`, preserves `malId`). Cache key `mal:list` (first page) + `mal:viewer`.

**Anime fetch:** `GET /anime/{id}?fields=id,title,main_picture,alternative_titles,start_date,synopsis,mean,num_episodes,status,genres,studios,media_type,nsfw,my_list_status{status,score,num_episodes_watched}` via `mapMALNodeToAnime` (title `ja→romaji`/`en→english`, `main_picture.large`, `mean` 0-10, `nsfw` passed). Cache key `mal:anime:<id>`.

**Search (tracking-only):** `GET /anime?q=<query>&limit=12&fields=...&nsfw=true` → `mapMALNodeToAnime`. Cache key `mal:search:<lower>`. Not used for UI discovery (public `AnimeMetadataProvider` remains primary); kept for provider conformance.

**Progress/status/rating sync:** `PUT /anime/{id}/my_list_status` (`Content-Type: application/x-www-form-urlencoded`, body `status`/`num_watched_episodes`/`score`). `updateProgress` fetches current `my_list_status` to preserve status then sends `num_watched_episodes`; `updateStatus` maps `watching→watching, completed→completed, planned→plan_to_watch, on_hold→on_hold, dropped→dropped` via `aeriStatusToMal`; `updateRating` sends `score` 0-10. Requires Bearer. On success `clearMalMemoryCache()` to force fresh list. `toMalId` resolves `mal-123` or numeric; throws `NOT_FOUND` friendly for `anilist-xxx` without `malId`.

**My List integration:** `src/contexts/MALContext.tsx` mirrors `AniListContext` (`isAuthenticated, user, animeList, loadingUser/loadingList, error, authExpired`, `login/logout/setManualToken/refresh`, optimistic `updateProgress/updateStatus/updateRating` with `malId` resolution from `anime.identity` or `combinedList`). `src/contexts/TrackingContext.tsx` merges both: `dedupAndMerge` keys by `mal-<malId>` if present else `anilist-<id>`, AniList inserted first (richer banner), MAL second merges identity (`malId`/`anilistId`), picks max progress, keeps AniList status. Exposes `isAuthenticated/isAniListAuthenticated/isMALAuthenticated/combinedList/loading/error/authExpired` and `updateProgress(anime, ep)/updateStatus(anime, status)/updateRating(anime, rating)` fan-out to both providers where IDs exist. UI (`Home` Continue Watching, `MyList`, `DetailModal`, `EpisodeList`, `Watch`) uses `useTracking`, not direct provider.

**Loading/error/auth-expired states:** `MalProviderError` same codes as `ProviderError`; `MALContext` clears tokens on 401/403 and surfaces `authExpired`; `MyList` shows `RowSkeleton`, retry buttons for both providers, amber `Session expired` banner, compact `MALConnectCompact` (MAL badge `#2e51a2`, paste token fallback, redirect URI hint). No raw dumps.

**Local caching (shared):** `src/services/mal/client.ts:malFetch` reuses same `memoryCache` TTL 5 min + IDB `putCache/getCache` TTL 24 h + `inflight` dedup as `anilistGraphQL`, with `ensureFreshToken` auto-refresh (1 min buffer) and `clearMalTokens` on AUTH. Keys `mal:*`. Homepage discovery still 4 parallel AniList metadata requests (cached); MAL list only fetched when authenticated.

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
- **Caching:** Same architecture extended — memory 5 min + IDB 24 h + `inflight` dedup, keys `anilist:trending:<perPage>`, `anilist:popular:<perPage>`, `anilist:airing:<perPage>`, `anilist:new:<perPage>`, `anilist:upcoming:<perPage>`, `anilist:finished:<perPage>`, `anilist:browse:<sort:status:genre:year:season:format:perPage:page>`, `anilist:search:<query>:<perPage>`, `anilist:anime:<id>`. Public metadata therefore not refetched on every navigation; homepage 4 sections issue 4 parallel requests first load, then served from cache. Browse `useBrowse` deduplicates per filter set and supports `loadMore` via `page` increment without refetching previous pages (append). Second Home load is cached (0 new requests).
- **Home usage (Phase 6):** `src/pages/Home.tsx` uses hooks `useTrending/usePopular/useAiring/useNewReleases` for `Trending Now`, `Popular on Aeri`, `Currently Airing`, `New Releases`, plus `Because you watched` (deterministic filter of trending by Fantasy/Adventure). Hero is `trending.data?.[0]` (real `bannerImage` or `cover` fallback) with `RowSkeleton` while loading, fallback `heroAnime` only if remote fails. `Continue Watching`/`My List` via `useTracking` `combinedList` (real when auth, hidden when unauth). Unauthenticated users still get useful public discovery; no mock discovery path.
- **Browse usage (Phase 6):** `src/pages/Browse.tsx` uses `useBrowse` with category tabs `Popular (POPULARITY_DESC)`, `Trending (TRENDING_DESC)`, `Airing (RELEASING)`, `Upcoming (NOT_YET_RELEASED)`, `Finished (FINISHED+END_DATE_DESC)` and filters `genre`, `seasonYear`, `season` (WINTER/SPRING/SUMMER/FALL), `format` (TV/MOVIE/OVA/SPECIAL) as server-side AniList filters. `perPage 24`, pagination via `hasNextPage` + `Load more`, client-side no giant table, horizontal filters are compact rounded `select`s (Netflix-like). Loading shows pulse grid, error shows retry, empty shows “No titles match your filters.” No mock.
- **Search usage (Phase 6):** `src/pages/Search.tsx` uses `useAnimeSearch(liveQuery, 12)` where `liveQuery = input.trim()` — **search while typing** (debounced 300ms inside `useAnimeSearch`, plus 400ms URL sync). Updates URL `?q=` via `replace` for deep link/share, handles `q` initial from `searchParams` and back navigation. Loading shows pulse grid, error shows retry button, empty shows “No results for …”, no stale results (hook `cancelled` flag + `clearTimeout`), no duplicate requests (cache + inflight), keyboard-friendly cards. Works for all users, no auth gate.
- **Detail usage:** `src/pages/AnimeDetail.tsx` + `DetailModal` fetch via `useAnimeDetail` / `anilistMetadataProvider.getAnime` for real metadata (title, alt titles, description, cover/banner, episodes/duration/status/year/season/genres/studios/score/popularity/external IDs). Fallback to `fromList` or `mock` only if remote fails or legacy slug (`frieren` → `anilist-154587` resolver) for deep-link compat; otherwise no fake display.
- **Images (Phase 6):** Real content uses `coverImage.extraLarge/large` and `bannerImage` from AniList; `AnimeCard` `loading="lazy"` + `fallbackSrc = backdropImage || coverImage` with `onError` hide, `decoding="async"`, `Hero`/`Watch` `loading="eager"` `fetchPriority="high"` for LCP. No huge artwork loading below fold; Picsum remains only in `mockAnime.ts` fallback/test fixture.

### VideoProvider

```ts
interface VideoProvider {
  id: string
  getEpisodes(anime: Anime): Promise<Episode[]>
  getSources(episode: Episode): Promise<VideoSource[]>
}
```

- Player calls only this interface.
- Authorized sources only. No DRM bypass.

## Anime Type (normalized)

```ts
interface AnimeIdentity { internalId: string; anilistId?: number; malId?: number }
interface Anime {
  identity: AnimeIdentity
  title: { romaji: string; english?: string; native?: string }
  description: string
  coverImage: string   // AniList extraLarge/large/medium (real) or fallback
  backdropImage: string // AniList bannerImage or cover fallback, hero/cards
  bannerImage?: string
  year?: number
  season?: string
  episodes?: number
  duration?: number
  status?: string
  rating?: number // 0-10 (AniList averageScore/10)
  genres: string[]
  studios?: string[]
  format?: string // TV, Movie
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
- Early hash token parsing in `src/main.tsx` avoids HashRouter conflict with `#access_token=...`; MAL `?code=` parsed in `MALContext` effect
- Public metadata cached same as tracking; homepage 4 parallel requests deduped and cached; MAL user/list cached same TTL

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
