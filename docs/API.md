# API — Aeri

## Providers

### TrackingProvider

```ts
interface TrackingProvider {
  id: 'anilist' | 'mal'
  getUser(token: string): Promise<User>
  getAnimeList(token: string): Promise<AnimeListEntry[]>
  updateProgress(id: string, episode: number): Promise<void>
  updateStatus(id: string, status: AnimeStatus): Promise<void>
  updateRating(id: string, rating: number): Promise<void>
  search(query: string): Promise<Anime[]>
  getAnime(id: string): Promise<Anime>
}
```

- `services/anilist.ts` implements AniList GraphQL (`https://graphql.anilist.co`)
- `services/mal.ts` implements MAL REST (`https://api.myanimelist.net/v2`)
- Both adapt to common `Anime` / `AnimeListEntry` types (`src/types/anime.ts`).

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
  rating?: number // 0-10
  genres: string[]
  studios?: string[]
  format?: string // TV, Movie
}
```

## Mapping

`src/lib/identity.ts` holds map. Never equate `anilistId === malId`.

## Caching

- In-memory map (`Map<string, {value, expiry}>`) TTL 5min for metadata
- IndexedDB for persistent cache (key `anime:${internalId}`, TTL 24h)
- Deduplicate concurrent fetches via promise memo.

## Search

Debounced 300ms. Searches title fields + alt titles. Returns `Anime[]` sorted by relevance then popularity.

## Mock Mode

Phase 2: `src/data/mockAnime.ts` satisfies same interfaces deterministically; no network. Enables visual polish before wiring.

## Error Handling

All provider methods throw `ProviderError { code, message, retryable }`. UI maps to friendly copy:
- `NETWORK` → "Couldn’t reach AniList. Check your connection."
- `AUTH` → "Session expired. Reconnect."
- `NOT_FOUND` → "We couldn’t find that anime."
- Generic → "Something went wrong."

No raw error dumps.
