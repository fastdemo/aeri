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

### AnimeMetadataProvider (public discovery, Phase 4)

```ts
interface AnimeMetadataProvider {
  id: string
  getAnime(id: string): Promise<Anime>
  search(query: string, perPage?: number): Promise<Anime[]>
  getTrending(perPage?: number): Promise<Anime[]>
  getPopular(perPage?: number): Promise<Anime[]>
  getAiring(perPage?: number): Promise<Anime[]>
  getNewReleases(perPage?: number): Promise<Anime[]>
}
```

- `src/providers/metadata/types.ts` defines the abstraction; `src/providers/metadata/anilistMetadata.ts` (`AniListMetadataProvider`, singleton `anilistMetadataProvider`) is the first implementation. UI never imports AniList GraphQL types directly — all through normalized `Anime`.
- **Implementation:** Uses `anilistGraphQL` (same client/cache/dedup as TrackingProvider, no token required for public data). Queries:
  - `Trending`: `Page(media(type:ANIME, isAdult:false, sort:TRENDING_DESC))`
  - `Popular`: `sort:POPULARITY_DESC`
  - `Airing`: `sort:POPULARITY_DESC, status:RELEASING`
  - `New Releases`: `sort:START_DATE_DESC, status:FINISHED`
  - `Search`: `Page(media(search, type:ANIME, isAdult:false))`
  - `Anime`: `Media(id, type:ANIME)`
  All share `MEDIA_FIELDS` (`id/idMal/title/description/coverImage{extraLarge large medium}/bannerImage/startDate/season/seasonYear/episodes/duration/status/averageScore/genres/studios/format/popularity`). Mapped via `mapAniListMediaToAnime` (HTML stripped via `cleanDescription`, `banner→cover` fallback, `averageScore/10`, `external IDs` `idMal`).
- **Caching:** Same architecture extended — memory 5 min + IDB 24 h + `inflight` dedup, keys `anilist:trending:<perPage>`, `anilist:popular:<perPage>`, `anilist:airing:<perPage>`, `anilist:new:<perPage>`, `anilist:search:<query>`, `anilist:anime:<id>`. Public metadata therefore not refetched on every navigation; homepage 4 sections issue 4 parallel requests first load, then served from cache.
- **Home usage:** `src/pages/Home.tsx` uses hooks `useTrending/usePopular/useAiring/useNewReleases` (from `src/hooks/useAnimeMetadata.ts`) for `Trending Now`, `Popular on Aeri`, `Currently Airing`, `New Releases`, plus `Because you watched` (deterministic filter of trending by Fantasy/Adventure). Hero is `trending[0]` (real banner) with fallback `heroAnime` mock. `Continue Watching`/`My List` remain `AniListContext` user-specific (hidden when unauthenticated). Unauthenticated users still get useful public discovery.
- **Browse usage:** `src/pages/Browse.tsx` uses `usePopular(24)` and client-side `genres` filter, no mock.
- **Search usage (Phase 4):** `src/pages/Search.tsx` always uses `useAnimeSearch` → `anilistMetadataProvider.search` (public, debounced 300 ms inside hook), no longer gated by `isAuthenticated`. Handles loading (pulse), empty (`No results`), network/rate-limit (`ProviderError` → friendly `error` string), no raw GraphQL dump.
- **Detail usage:** `src/pages/AnimeDetail.tsx` + `DetailModal` fetch via `useAnimeDetail` / `anilistMetadataProvider.getAnime` for real metadata (title, alt titles, description, cover/banner, episodes/duration/status/year/season/genres/studios/score/popularity/external IDs). Fallback to `fromList` or `mock` only if remote fails.
- **Images:** Real content uses `coverImage.extraLarge/large` and `bannerImage` from AniList; `AnimeCard` uses `loading="lazy"` + `fallbackSrc = backdropImage || coverImage` with `onError` hide, `Hero`/`Watch` use `loading="eager"` for LCP. Picsum remains only in `mockAnime.ts` fallback.

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

`src/lib/identity.ts` holds map. Never equate `anilistId === malId`. `src/services/anilist/mapper.ts` handles AniList→Aeri: `mapAniListMediaToAnime` (strips HTML, picks `extraLarge→large→medium`, `banner→cover` fallback, `averageScore/10`, `stolabs`, preserves `idMal`), `mapAniListEntryToAeri` (status via `anilistStatusToAeri`, percent from `progress/episodes`, `inList/listStatus`).

## Caching

- In-memory `Map<string,{value,expiry}>` TTL 5 min for all metadata (trending/popular/airing/new/search/anime + viewer/lists)
- IndexedDB `cache` store keys `anilist:*` TTL 24 h via `putCache/getCache` (shared for tracking + metadata, no second system)
- Deduplicate concurrent fetches via `inflight` promise map
- Early hash token parsing in `src/main.tsx` avoids HashRouter conflict with `#access_token=...`
- Public metadata cached same as tracking; homepage 4 parallel requests deduped and cached

## Search

Debounced 300 ms in `src/hooks/useAnimeMetadata.ts:useAnimeSearch` and `src/pages/Search.tsx`. Always delegates to `anilistMetadataProvider.search` (AniList `Page` query) for real results, regardless of auth. Returns `Anime[]` sorted by AniList relevance. Handles loading (pulse), empty (`No results for “q”`), network/rate-limit (friendly string from `ProviderError`), no raw dump.

## Mock Mode

Phase 2: `src/data/mockAnime.ts` satisfies same interfaces deterministically; no network. Phase 3 retains mock as fallback when unauthenticated. **Phase 4:** `mockAnime.ts` kept as fallback/test fixture only; production `Home`/`Browse`/`Search`/`AnimeDetail`/`Watch` no longer depend on mock when real AniList data is available — they use `AnimeMetadataProvider` with mock only as fallback if remote fails or for unauthenticated `Continue Watching`/`My List` empty states.

## Error Handling

All provider methods throw `ProviderError { code, message, retryable }` (`src/services/anilist/errors.ts`). Client clears token on 401/403 and throws `AUTH`. UI maps to friendly copy:
- `NETWORK` → "Couldn’t reach AniList. Check your connection." / "AniList is rate-limited. Try again" / "temporarily unavailable" (retryable, `retry` button in MyList, `RowSkeleton`/`error` banner in Home/Browse)
- `AUTH` → "Session expired. Reconnect." (amber banner, `AniListConnectCompact`)
- `NOT_FOUND` → "We couldn’t find that anime."
- Generic → "Something went wrong."

No raw error dumps. `src/contexts/AniListContext` surfaces `error` + `authExpired` for skeletons/banners; `src/hooks/useAnimeMetadata` surfaces `error` for section error banners.
