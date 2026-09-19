# Data — Aeri

## Core types (`src/types/anime.ts`)

- `AnimeIdentity { internalId, anilistId?, malId? }` — `internalId` is
  `anilist-<id>` or `mal-<id>`; **never assume id equality across providers**.
- `Anime`: identity (`anilist-<id>` — THE identity; no franchise/group id),
  `title{romaji,english?,native?}`, description,
  cover/backdrop/banner, year, season, `episodes?`, `chapters?`/`volumes?`
  (AniList manga metadata: published totals, NOT readable units),
  duration, status string, `rating?`, `ratings?{anilist,mal}`,
  genres[], studios[], format, popularity, `streamingEpisodes[]` (order =
  slot identity, never filter), `trailer?{id,site}`, nextAiringEpisode,
  airingSchedule, isAdult, `relations?{edges:[{relationType,node}]}` (raw
  AniList shape — Related Entries only), `progress?{episode,percent}`,
  inList, listStatus.
- Manga reading units (`src/providers/manga/types.ts`): `Manga` (the shared
  `Anime` record) → `Volumes` (AniList `volumes` metadata only) →
  `Chapters` (provider `MangaChapter`: ULID id, `label`, numeric `number`,
  never a volume number) → `Pages` (`MangaPage`: ordered image URLs).
  The reader operates on provider chapters even though browse/detail show
  volume metadata. Never convert chapter counts into volume counts.
- `Episode {id, animeId, number, title, thumbnail?, duration?, description?}`,
  `VideoSource {url, quality, type}`,
  `AnimeListEntry {anime, status, progress, score?, updatedAt?}` (unix s;
  absent sorts last).

## AniList records (`services/anilist/mapper.ts`)

`AniListMedia` mirrors GraphQL (nullable everything); mapped with studio
filtering, order-preserving streaming episodes, trailer, schedules.
`AniListMediaListEntryRaw` → `mapAniListEntryToAeri` (progress percent,
score passthrough, updatedAt).

## Provider records

- Worker `NormalizedSource` (provider, url=signed, type hls|mp4|embed,
  language, quality, subtitles[], `providerAnimeId/Title` for verification).
- Frontend `VideoEpisode` (stable `providerEpisodeId`), `VideoSourceEnhanced`
  (+ embed flag, headers, subtitles). Signed URLs expire — never cached.

## User state

- Tracking: active tracker's `combinedList` (in-memory context) + per-entry
  progress/percent. No cross-user state (single-user browser app).
- Watch: `watchPos{id,episode,currentTime,duration,updatedAt}` (IDB, 5s
  throttled writes, resume prompt >30s & <90%, cleared on end).
- Read: `readPos{id:`read:<mangaId>`,chapterId,chapterLabel?,page,maxPage?,updatedAt}`
  (IDB `watchPos` store, `read:` namespace so manga never collides with
  anime; 5s-throttled writes from IntersectionObserver; tracker chapter
  marked at last page). Anime progress = episode+seconds; manga = chapter+page.

## Settings (`localStorage aeri:prefs`)

autoplay, subtitles, volume, `theme` (default `aeri-dark`), preferredAudio
(`sub`), preferredProvider (null), enabledProviders, providerOrder,
customVideoApiUrl, preferredQuality (dead key — no consumers), customAuthApiUrl,
sync{anilist,mal:{status,progress,rating}} (default all true),
trackingProvider. Applied pre-render (theme) or read per render/resolve
(volume/autoplay/subtitles/audio/provider prefs; toggles/order/URL apply on
next resolve — Retry/episode-change, no live subscription).

## Cache records

- AniList memory map + IDB `cache` store (24h TTL): keys `anilist:trending:`,
  `:popular:`, `:airing:`, `:new:`, `:browse:`, `:browsemanga:`,
  `:anime:<id>`, `:manga:<id>`, `:bymal:`, `:search:`,
  `:related:<id>`, `:seriesgroup:` (legacy, unused),
  `anilist:viewer`, `anilist:list:<viewerId>`,
  `anilist:media:<id>` (shared per-entry record — one id, one record).
- Video: `video:*` (mem 5m/empty 2m, IDB 1h/empty 5m); resolver 5–10m.
- Manga: `manga:weebcentral:match:<anilistId>` (mem 10m) /
  `:chapters:<wid>` / `:pages:<chid>` (mem 5m); Worker match 10m, chapters
  + pages 5m. `manga:*` namespace — anime entries can never satisfy manga
  requests. Request races: AbortController per nav + `cancelled` flag +
  stale-result rejection (rapid A→B→C settles on C, no delays).
- Tokens: `aeri:anilist:*`, `aeri:mal:*` (+ `last_code` dedup,
  `oauth_state`, `code_verifier`).

## URL / route identifiers

HashRouter: `#/`, `#/browse`, `#/search?q=`, `#/anime/anilist-<id>` (THAT
entry — no resolution),
`#/watch/<id>/<ep>` (this entry's episode 1..N),
`#/read/<id>/<chapter>` (`first`|`latest`|`ch-N`|provider chapter id),
`#/list`, `#/settings`, `#/manga`, `#/profile`. Related entries link
directly to their own `#/anime/anilist-<id>`.
