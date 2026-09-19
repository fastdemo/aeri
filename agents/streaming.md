# Streaming — Aeri (video + manga delivery)

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

## Manga chain (WeebCentral → planeptune)

WeebCentral is the authority for series identity, chapters, chapter
navigation, page membership. Observed (2026-09-18, no JSON API — htmx HTML):
`POST /search/simple?location=main` (`text=<q>`) → `/series/<ULID>/<slug>` →
`/series/<ULID>/full-chapter-list` (`<a href="/chapters/<ULID>">` + own
`<span class="">` label + `<time datetime>`) →
`/chapters/<ULID>/images?is_prev=False&reading_style=long_strip&current_page=1`
(static image URLs). Chapter HTML itself contains NO images — the adapter
must make the `/images` request. Labels: `# N` for SBR-style series (number
= N), `Chapter/Prologue/Epilogue N` elsewhere; label parsing reads only the
chapter's own span (sibling Last-Read/new spans ignored). Matching reuses
the anime philosophy (variants + exact/prefix/substring/token scoring,
threshold 40, ambiguous→fail closed). `hot.`/`scans-hot.` rotation handled.

`hot.planeptune.us` = page-image CDN (dumb file host; verified real JPEG
bytes, no referer needed). `temp.compsci88.com` = cover/static CDN only.
Browser-direct `<img>` is BLOCKED by Chromium ORB (upstream serves
`image/png` headers on JPEG bytes — opaque mismatch), so pages go through
signed same-origin `/api/manga/img` (HMAC+expiry like `/api/stream`,
planeptune/compsci88 suffix allowlist, DoH private-IP reject, magic-byte
content-type sniff, 24h cache). Not an open proxy. Upstream challenge/5xx =
honest error state, never bypassed.

Routes: `/api/manga/match/:anilistId` (10m) → `/api/manga/chapters/:wid`
(5m, provider chapters never volumes) → `/api/manga/pages/:chid` (5m,
re-signed URLs). Frontend: `src/providers/manga/` (`MangaProvider`
search/getManga/getChapters/getChapterPages over Worker; `manga:*`
namespaced mem cache; AbortController per nav). Reader: `src/pages/Read.tsx`
(`#/read/:id/:chapter`: first/latest/ch-N/raw id; vertical continuous,
lazy imgs, per-image retry, chapter selector + prev/next + `[`/`]` keys,
chapter+page → IDB `read:<id>` 5s-throttle via IntersectionObserver +
tracker at last page).

## Watch route

`/watch/:id/:episode` (`src/pages/Watch.tsx`): `useAnimeDetail` →
`resolveEpisodesWithFallback` (4s/provider, first non-empty) →
`resolveSourcesWithFallback` (preferred first 9s, then parallel rest; language
filter; `bypassCache` on Retry) → `VideoPlayer`. Episode list is this
entry's own episodes (1..N, no offsets). Below the player: Related Entries.

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

## Matching (fail closed — never first-result, always the exact entry)

`worker/src/resolver.ts`: variants = romaji + english + native OF THE ROUTED
ENTRY; provider `name` + `data-jp` scored (exact 100 / prefix 60 / substring
40 / token-Jaccard×50); `MATCH_THRESHOLD = 40`; hard pre-filters (episode
count of this entry, movie↔TV veto); count-proximity tiebreak; exact ties →
`ambiguous match` throw. AniKoto adds `ani_id == anilistId` verify + ±1 year
check. No season graph anywhere: S3's hints (title + 22 eps + 2018) can never
resolve to S1. Winner gets a liveness check (episode list must exist and
cover the request). Every miss throws a named error → empty sources, never a
wrong show.

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
