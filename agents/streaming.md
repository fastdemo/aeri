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

## Manga chain (MangaDex → at-home CDN)

MangaDex is the authority for series identity, chapters, page membership
(switched 2026-09-20: WeebCentral's `/search/simple` + `/search/data`
endpoints return 500/empty for ALL queries including the site's own htmx
quick-search — provider-side outage, curl + browser verified; WeebCentral
code paths retained as fallback but MangaDex is primary). JSON API,
no key: search `/manga?title=&includes[]=cover_art` →
`/manga/<uuid>/feed?translatedLanguage[]=en&contentRating[]=safe,suggestive,erotica&order[chapter]=asc`
→ `/at-home/server/<chapterUuid>` → `{baseUrl}/data-saver|data/<hash>/<file>`.
Matching: `attributes.links.al` (AniList id string — verified mapping, score
floor 100) preferred; else title variants + exact/prefix/substring/token
scoring, threshold 40, ties fail closed. Worker serializes ≤4 req/s, one
429 backoff retry. Data-saver default (~38% smaller); filenames opaque, never
derived; per-chapter rotating host — resolved fresh, never cached across
chapters. Covers: `uploads.mangadex.org/covers/<uuid>/<file>.512.jpg`.

Licensed titles (e.g. Solo Leveling — all EN chapters external/off-site):
feed `total=0` BUT `/aggregate?translatedLanguage[]=en` lists chapters →
worker resolves external URLs via batched `/chapter?ids[]=` and returns them
as `external[]`; frontend shows "Licensed — read officially" link buttons,
never the reader. `aggregate` empty too = genuinely no EN content ("No
readable English chapters"). External+pages>0 edge (mirrored oneshots, e.g.
Goodbye Eri) stays readable. Dead at-home image 404s (purged CDN files)
surface per-image Retry, never fabricated pages.

Routes: `/api/manga/mdx-match/:anilistId` (1h) → `/api/manga/mdx-chapters/:uuid`
(10m, `{readable, external}`) → `/api/manga/mdx-pages/:chUuid?quality=saver|data`.
No image relay needed (real JPEG bytes, correct content-type — direct `<img>`).
Frontend: `src/providers/manga/mangadex.ts` (`manga:*` namespaced mem cache;
AbortController per nav). Reader: `src/pages/Read.tsx`
(`#/read/:id/:chapter`: first/latest/ch-N/raw id; vertical continuous, lazy
imgs, per-image retry, selector + prev/next + `[`/`]` keys, chapter+page →
IDB `read:<internalId>` via IntersectionObserver with mount-clobber guard
(never persist page 0 over nonzero) + unmount/pagehide flush; tracker at
last page). Chapter order pref (`chapterOrder: oldest|latest`, default
oldest, Settings → Manga section, `aeri:prefs-changed` broadcast) sorts at
presentation (`sortProviderUnits`, numeric, volumes own run) — provider data
untouched. Provider units opaque: `providerChapterId/providerLabel(number,
kind,unitType)`; "Volume 3" never renamed to chapter; continue captions use
the stored provider label.

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

## Provider registry (D092) — verified-only, data-driven

Settings → Providers derives BOTH sections from registries (never hardcoded):
anime `verifiedVideoProviders()`, manga `verifiedMangaProviders()`.
`unverified`/`broken` providers exist in code but never appear in Settings
and are never requested (anime pool filters `status === 'verified'`;
manga fallback iterates verified + enabled only; capabilities advertise
verified only; health map has verified keys only).

Verified 2026-09-20 (`npm run verify:providers` — match→units/episodes→
pages/stream bytes→rendered images in a real browser):

| Provider | Media | Units/Episodes | Pages/Stream | Status |
|---|---|---|---|---|
| MangaDex | Manga | 425u Berserk | 94pp JPEG direct | Verified |
| WeebCentral | Manga | 403u Berserk | 24pp signed-relay JPEG | Verified |
| MangaPill | Manga | 405u Berserk | 24pp signed-relay JPEG | Verified (fallback, default OFF) |
| AniWave | Anime | 1178ep One Piece | HLS TS sync markers | Verified |
| Official Trailer | Anime | trailer only | embed | Verified (fallback) |
| Miruro / Custom | Anime | — | trailer-alias / user endpoint | Unverified |
| AllAnime/Pahe/Koto/Mega/Paradise/Neko | Anime | 0 | 0 | Broken (stubs) |

Rejected with reason (never exposed): ComicK (api DNS dead), MangaFire
(API needs account token — bypass would defeat access control), Jikan
(metadata only, no chapters), Consumet (self-host required, no public
endpoint), xComic (Qwik `/query/` GraphQL-ish POST — no stable public
contract), LikeManga (no discoverable search API), MangaGo (CF challenge),
VyManga (403). WeebCentral was 500-down 2026-09-19 (provider-side, verified
via the site's own htmx request failing), recovered 2026-09-20; page hosts
rotate planeptune + lowee (parser + relay allowlist accept both; the relay
sends a per-host Referer — the mangapill CDN 403s without mangapill.com).
Licensed titles (Solo Leveling) readable via WeebCentral (201u/49pp) while
MangaDex hosts zero pages (16 external links) — the pair complement each
other. MangaPill (server-rendered HTML, no JS/auth/CAPTCHA) covers SxF
completeness gaps (170u Chapter-labeled units where MDX has 2).

Fallback: enabled + verified only, registry order (mangadex → weebcentral →
mangapill; preferred anime source first when enabled), first non-empty wins.
All manga providers disabled → "No Manga providers are enabled." (no silent
fallback, no disabled-provider requests). Anime mirrors with 4s/9s timeouts.
