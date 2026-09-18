# Streaming — Aeri

```mermaid
flowchart LR
    AL[AniList metadata<br/>browser] --> W[Watch page]
    W --> H[hint params<br/>title/en/native/eps/format/year]
    H --> API["/api/sources<br/>(pinned provider)"]
    API --> R[resolver.ts<br/>filter → match → servers → embed extract]
    R --> S[signed /api/stream URL<br/>HMAC 6h]
    S --> ST[/api/stream relay<br/>allowlist + DoH + rewrite/Range]
    ST --> CDN[(echovideo / roburn<br/>dpopdrop / megaplay)]
    CDN --> V[VideoPlayer<br/>hls.js / native HLS]
    V --> P[progress → IDB + tracker]
```

## Watch route

`/watch/:id/:episode` (`src/pages/Watch.tsx`): `useAnimeDetail` + `useSeriesGroup`
in parallel → `resolveEpisodesWithFallback` (4s/provider, first non-empty) →
`resolveSourcesWithFallback` (preferred first 9s, then parallel rest; language
filter; `bypassCache` on Retry) → `VideoPlayer`. Episode list renders
immediately from AniList metadata, never blocked on providers.

## Provider registry

- Frontend (`src/providers/video/registry.ts`): order aniwave, official,
  custom, miruro, allanime, animepahe, anikoto, megaplay, animeparadise,
  anineko, mock. `enabledProviders`/`providerOrder` prefs honored.
  `checkProviderHealth` hard-maps availability when worker is configured.
- Worker (`worker/src/providers.ts`): `OfficialTrailerProvider` (YouTube
  embeds only — archive fallbacks return `[]`), `DemoProvider` (fixed mux HLS,
  explicit-request only), `AllAnimeStubProvider` (count only), real
  `AnimePaheProvider` (search→release→kwik embed), real `AnikotoProvider`
  (`ani_id` verify + megaplay HLS/VTT), resolver-only `AniwaveProvider`,
  `MiruroAliasProvider` (trailer relabeled), `GenericStubProvider` empties.

## Matching (fail closed — never first-result)

`worker/src/resolver.ts`: variants = romaji + english + native; provider
`name` + `data-jp` scored (exact 100 / prefix 60 / substring 40 /
token-Jaccard×50); `MATCH_THRESHOLD = 40`; hard pre-filters (episode count,
movie↔TV veto); count-proximity tiebreak; exact ties → `ambiguous match`
throw. AniKoto adds `ani_id == anilistId` verify + ±1 year check. Winner gets
a liveness check (episode list must exist and cover the request). Every miss
throws a named error → empty sources, never a wrong show.

## Source / server resolution

- AniWave: `filter?keyword=` → `parseAwCards` (≤30) → match → `/ajax/server/
  list` (≤6 sub/dub jobs, `firstSuccess` race) → `/ajax/sources` → embed
  extract (echovideo HLS via `/embed-1/getSources`, dood MP4 via pass_md5).
- AniKoto: `filter` → data-tip → `ani_id` verify → episodes → embed `data-id`
  → megaplay `getSourcesNew` → HLS + VTT tracks (+ intro/outro).
- Results carry `providerAnimeId`/`providerTitle` for verification; signed
  delivery mints playlist + subtitle tokens (6h).

## Signed URLs / relay (`handleStream`)

Token `u.e.s` verified (const-time HMAC, expiry, https, ≤2048 chars) →
`hostAllowed` (suffixes + rotation regexes) → DoH private-IP reject →
upstream fetch (provider Referer, Range passthrough, 120s timeout) →
16KB sniff: binary streams relayed via `ReadableStream` (~45ms CPU/segment);
playlists/VTT rewritten to signed URLs (5MB cap); `text/html` → 502 blocked.

## VideoPlayer (`src/components/player/VideoPlayer.tsx`)

Props: sources, selectedSource, subtitles, onTimeUpdate/onEnded,
initialTime, animeTitle, episodeNumber, volume, autoplay. Native HLS when
`canPlayType`, else lazy `hls.js` (fatal → error state). Resume seek within
5s margins; volume effect; AirPlay/Cast availability + pickers; MediaSession;
subtitle track forcing. Embed path renders iframe. Loading spinner only on
buffering events; **no per-tick React state** — `onTimeUpdate` forwards to
Watch, which writes IDB throttled 5s + tracker at ≥80%/end.

## Progress / fallback

IDB `watchPos` (resume prompt when >30s and <90%); tracker progress at ≥80%
and on ended (then clears). No-source UI distinguishes unavailable vs
transient + Retry; `tried` provider list shown.

## Known limitations (verified, not fixable in app code)

- Single-rendition HLS masters (~650–690kbps); upstream per-connection
  throughput is a lottery (tens–hundreds KB/s) — worker relay proven ≥ direct.
- Parallel segment fetching does not scale (aggregate upstream throttle).
- AniKoto/MegaPlay returns encrypted `enc` (bypass-class to reverse) → 0
  sources; animepahe kwik needs JS-unpack; animekai/hianime/gogo unreachable
  from CF edge (530/1016). Aniwave/echovideo is the ceiling.
- Title-less requests (no `?title=`) fail matching — Watch always sends hints.
