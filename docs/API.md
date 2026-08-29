# API — Aeri

## Providers

### TrackingProvider

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
- `src/providers/mal/provider.ts` implements MAL REST (`https://api.myanimelist.net/v2`) — Phase 4
- Both adapt to common `Anime` / `AnimeListEntry` types (`src/types/anime.ts`).

#### AniList implementation (Phase 3)

**Authentication (browser-safe, no backend):** Implicit grant (`response_type=token`) via `https://anilist.co/api/v2/oauth/authorize?client_id={VITE_ANILIST_CLIENT_ID}&response_type=token`. Redirect URI is `window.location.origin + import.meta.env.BASE_URL` (e.g. `https://fastdemo.github.io/aeri/`). Token is parsed from `window.location.hash` **before** `HashRouter` mounts (`src/main.tsx` early handler) and again in `src/services/anilist/auth.ts:handleAnilistOAuthCallback`. Token stored via `src/storage/anilist.ts` (`aeri:anilist:token`, `aeri:anilist:token_expiry`) — never scattered `localStorage.getItem`. Manual paste fallback (`parseManualToken`) supports `access_token` fragments or raw JWT for local dev without `VITE_ANILIST_CLIENT_ID`.

**User:** `Viewer { id name avatar { large } bannerImage }` via `VIEWER_QUERY`. Cached 5 min (memory) + 24 h (IndexedDB) + deduped. Requires `Authorization: Bearer <token>`.

**List:** `MediaListCollection(userId, type:ANIME)` after resolving `Viewer.id`. Iterates **all** `lists` (including custom lists per AniList docs — entries can be hidden from default status buckets). Maps each `MediaListEntry` via `src/services/anilist/mapper.ts:mapAniListEntryToAeri`. De-duplicates by `internalId`. Cache key `anilist:list:<userId>`.

**Anime fetch:** `Media(id, type:ANIME)` — `coverImage { extraLarge large medium }`, `bannerImage`, `title { romaji english native }`, `description` (HTML stripped), `seasonYear/startDate`, `episodes/duration/status/averageScore/genres/studios/format/popularity/idMal`. Cache key `anilist:anime:<id>`.

**Search:** `Page(perPage:12) { media(search, type:ANIME) }` — debounced 300 ms in `src/pages/Search.tsx`. Uses same mapper. Cache key `anilist:search:<lower>`.

**Progress/status/rating sync:** `SaveMediaListEntry` mutation. `updateProgress` looks up `mediaListEntry.id` via `Media { mediaListEntry }` if not in cached list, then `SaveMediaListEntry(id|mediaId, progress)`; `updateStatus` maps `watching→CURRENT, completed→COMPLETED, planned→PLANNING, on_hold→PAUSED, dropped→DROPPED` via `src/services/anilist/mapper.ts:aeriStatusToAnilist`; `updateRating` sends `score` (0-10, respects user's scoring format — 10-point assumption for Phase 3). All require `Authorization` header. On success clears memory cache (`clearAnilistMemoryCache`) to force fresh list.

**My List integration:** `src/contexts/AniListContext.tsx` provides `isAuthenticated, user, animeList, loadingUser/loadingList, error, authExpired`. `src/pages/MyList.tsx` and `src/pages/Home.tsx` consume `animeList` for `Continue Watching` and `My List` rows; fall back to `mockAnime` when unauthenticated. `src/components/detail/DetailModal.tsx` and `src/components/episodes/EpisodeList.tsx` + `src/pages/Watch.tsx` call `updateProgress` optimistically.

**Loading/error/auth-expired states:** `AniListContext` tracks `loadingUser/loadingList`, `error`, `authExpired`. `ProviderError` codes `NETWORK/AUTH/NOT_FOUND/UNKNOWN` map to friendly UI: `MyList` shows `RowSkeleton` while loading, inline retry on `NETWORK`, amber banner on `AUTH` with reconnect CTA, `AniListConnectCompact` for paste/redirect. `DetailModal` shows status/score badges and syncing spinner; `Search` shows pulse skeletons. No raw dumps.

**Local caching:** `src/services/anilist/client.ts:anilistGraphQL` — in-memory `Map<query+vars, {value, expiry}>` TTL 5 min, IndexedDB via `src/storage/db.ts:putCache/getCache` TTL 24 h, and `inflight` dedup map for concurrent requests. All queries use `cacheKey` where appropriate (viewer, list, anime, search). Mutations use `useCache:false`.

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
  coverImage: string   // portrait, unused on homepage rows
  backdropImage: string // landscape, used for hero/cards
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
  progress?: { episode: number; percent: number }
  listStatus?: AnimeStatus
  inList?: boolean
}
```

## Mapping

`src/lib/identity.ts` holds map. Never equate `anilistId === malId`. `src/services/anilist/mapper.ts` handles AniList→Aeri: `mapAniListMediaToAnime` (strips HTML, picks `extraLarge→large→medium`, `banner→cover` fallback, `averageScore/10`, `stolabs`), `mapAniListEntryToAeri` (status via `anilistStatusToAeri`, percent from `progress/episodes`, `inList/listStatus`).

## Caching

- In-memory `Map<string,{value,expiry}>` TTL 5 min for metadata (viewer, media, search, lists)
- IndexedDB `cache` store key `anilist:*` TTL 24 h via `putCache/getCache`
- Deduplicate concurrent fetches via `inflight` promise map
- Early hash token parsing in `src/main.tsx` avoids HashRouter conflict with `#access_token=...`

## Search

Debounced 300 ms in `src/pages/Search.tsx`. When `isAuthenticated`, delegates to `aniListProvider.search` (AniList `Page` query); otherwise filters `mockAnime` titles/genres. Returns `Anime[]` sorted by AniList relevance or mock popularity.

## Mock Mode

Phase 2: `src/data/mockAnime.ts` satisfies same interfaces deterministically; no network. Phase 3 retains mock as fallback when unauthenticated (Home, MyList, Search, Browse). Authenticated paths use real AniList data with no visual redesign.

## Error Handling

All provider methods throw `ProviderError { code, message, retryable }` (`src/services/anilist/errors.ts`). Client clears token on 401/403 and throws `AUTH`. UI maps to friendly copy:
- `NETWORK` → "Couldn’t reach AniList. Check your connection." (retryable, `retry` button in MyList)
- `AUTH` → "Session expired. Reconnect." (amber banner, `AniListConnectCompact`)
- `NOT_FOUND` → "We couldn’t find that anime."
- Generic → "Something went wrong."

No raw error dumps. `src/contexts/AniListContext` surfaces `error` + `authExpired` for skeletons/banners.
