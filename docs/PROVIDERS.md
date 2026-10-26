# PROVIDERS — Aeri

This is the authoritative ownership map for every external service Aeri
talks to. When code and this document disagree, the code wins; fix the
document in the same change that discovers the drift.

**The short version:** AniList is Aeri's metadata backbone. Users may
connect **exactly two tracker providers — AniList or MyAnimeList — and
exactly one tracker is active at a time.** Kitsu is a narrow episode-name /
episode-thumbnail fallback, never a general metadata provider. Video
providers supply playback only.

---

## 1. Ownership table

| Concern | Owner | Allowed fallback | Never |
|---|---|---|---|
| Discovery rows, browse, search | AniList | none | MAL, Kitsu |
| Titles, descriptions, artwork, banners, genres, studios, year/season, format, status, relations | AniList | none for mapped entries | Kitsu |
| Canonical identity (`internalId`, `anilistId`, `malId`) | AniList id + its `idMal`; MAL id for tracker-only entries | none | Kitsu |
| Episode / chapter totals | AniList | the active tracker's own count for an entry with no AniList record; the video-provider catalog may widen the count when AniList has none or is clearly incomplete | Kitsu |
| Episode names + episode thumbnails | AniList | Kitsu, **whole-entry only**, under the gate in §3 | MAL, video providers |
| User's list, progress, status, score, tracker dates | Active tracker: AniList **or** MAL | none — no merge, no fan-out | Kitsu |
| Playback sources, source mapping, duration hints | Video-provider registry (AniWave / AnimeGG) | next enabled provider | Kitsu |

Two deliberate edge cases, both verified in code:

- **MAL tracker rows are display-enriched through AniList.** A row that the
  batch proves has no AniList mapping (`noAniListRecord`) may render its own
  stable MAL-side record so it does not vanish. That is a tracker-list edge
  case, not discovery and not an invitation to use MAL metadata elsewhere.
  Every mapped MAL entry renders the AniList record.
- **Video-provider episode catalogs can supply episode slots and duration.**
  They never supply display names or thumbnails; `normalizeEpisodes()` only
  reads AniList + the Kitsu fallback for those two fields.

---

## 2. Tracker choice — exactly two

`TrackingProviderId = 'anilist' | 'mal'` (`src/storage/preferences.ts`).
There is no third tracker. The active tracker is persisted as the
`trackingProvider` preference.

Resolution order (`getTrackingProvider`):

1. The user's explicit pick, when that account is connected.
2. Otherwise AniList, when AniList is connected.
3. Otherwise MAL, when MAL is connected.
4. Otherwise no tracker (`null`); tracking UI is signed out.

Both accounts may stay connected, but **only the active tracker's list is
read and only the active tracker receives writes** (`TrackingContext`). There
is no cross-provider list merge and no fan-out mutation. The user switches
trackers in the sign-in modal or Settings → Tracking.

AniList remains the **metadata backbone even when MAL is the active
tracker**: MAL list entries are progressively resolved through AniList
(`Media(idMal:, type: ANIME|MANGA)` / batch resolution, cached), and mapped
entries render AniList titles, art, relations, descriptions, and episode
metadata. MAL remains the source of truth for the user's MAL progress,
status, score, and dates. When the last connected account disconnects, the
tracker preference resets and the app returns Home.

---

## 3. Kitsu episode fallback — the whole-entry gate

Kitsu is used for **episode names and episode thumbnails only**. It never
supplies a tracker, identity, totals, discovery rows, descriptions, show
artwork, scores, statuses, or any other metadata. The contract lives in
`src/services/kitsu/client.ts` + `src/hooks/useKitsuEpisodes.ts`.

### Gate

The gate is evaluated on the AniList data that **survives the display
guards** — `anilistEpisodeMetadataSurvivesGuards()` in
`src/lib/episodes.ts` calls `survivingStreamingEpisodes()` and then asks
whether any surviving row has a usable title/thumbnail. Data the guards
throw away is not usable data (D127). In order:

1. Apply the season-pollution guard (`discardSeasonPollutedStreaming`,
   which needs relations — a `PREQUEL` entry with the same episode count)
   and the local-range guard, then remove trailer/preview entries and sort
   (`filterAndSortStreamingEpisodes`).
2. If **any** surviving entry has a non-generic title or a valid `http(s)`
   thumbnail, AniList owns the whole entry. Kitsu is **never requested**;
   rows without AniList data keep the UI placeholder.
3. Only when the surviving list has **zero** usable titles and **zero**
   valid thumbnails may Kitsu be consulted.

This is deliberately strict. Partial AniList data that survives the guards
is still AniList data. Example: AniList Naruto (20) carries a partial 26-row
list for a 220-episode finished entry; those rows are in range, so the gate
stays closed, Kitsu is never called, and rows without names keep the UI
placeholder. Counter-example (the D127 fix): AniList Code Geass R2 (2904)
carries **S1's** 25-row list; the season guard drops it (relations show a
25-episode PREQUEL), so nothing survives, Kitsu is allowed, and the
`anilist/anime` mapping → Kitsu 2634 supplies 25 named episodes with
thumbnails.

### Mapping and fetch

Kitsu mapping is id-based and conservative:

1. `GET /mappings?filter[externalSite]=anilist/anime&filter[externalId]=<anilistId>`
2. `GET /mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=<malId>`
3. Otherwise unavailable.

There is **no title search** and no fuzzy matching, so a sequel cannot borrow
another season's episode list. The mapped Kitsu anime id is internal to the
fallback and never becomes Aeri identity.

Episodes:

```text
GET https://kitsu.io/api/edge/anime/<kitsuId>/episodes
    ?page[limit]=20&page[offset]=<n>
```

- The API is CORS-open (`access-control-allow-origin: *`, verified live
  2026-10-23).
- `page[limit]` is capped at 20 by Kitsu; 100 returns HTTP 400.
- Aeri caps the scan at 500 episodes and reads `meta.count` to stop early.
- Only `attributes.number` / `relativeNumber`, a title
  (`canonicalTitle`, then `titles.en` / `en_jp` / `ja_jp`) and a thumbnail
  (`original`, then `large` / `medium`) are consumed. Rows without a number,
  or with neither a title nor a thumbnail, are skipped.
- A title that is just `Episode N` is treated as generic and does not count
  as usable metadata.

### Result states and UI behavior

`useKitsuEpisodes()` returns `idle | loading | resolved | unavailable |
error` plus the `allowed` gate flag:

- `idle` — AniList has usable metadata, the title is manga, or there is no
  record. No request.
- `loading` — the gate is open and Kitsu is in flight. Only fields that are
  still empty show a skeleton.
- `resolved` — Kitsu names/thumbnails are merged **by episode number**.
- `unavailable` — no mapping, or Kitsu has no usable rows. Placeholder: the
  show's own artwork + `Episode N`.
- `error` — network/HTTP/timeout. Also placeholder; not cached as absence.

If Kitsu has nothing, the UI keeps the existing placeholder. No fabricated
titles, no poster-as-episode-thumbnail fakery, no provider titles.

### Surfaces

The fallback is display-only and is used by:

- `components/detail/DetailModal.tsx` — E-line and `EpisodeList`
- `components/episodes/EpisodeList.tsx`
- `pages/Watch.tsx` — episode selector / next-episode labels
- `components/cards/AnimeCard.tsx` — continue variant's next-episode name
  (D128; gated on its resolved AniList record, one request per card)

Cards: only the **continue** variant calls it, and only after its own AniList
record resolves and the display guards discard that record's list (D128) —
one request for one card, never per rail item. Default cards never call it.
Proven by `tests/continue-card-episode-name.spec.ts` (CG R2: the caption is
Kitsu's episode-5 name, never S1's row).

### Caching

| Layer | Positive | Negative | Notes |
|---|---|---|---|
| Memory | 30 min | 30 min | max 120 keys |
| IndexedDB | 7 days | 24 hours | `kitsu:episodes:v1:anilist:<id>` / `:mal:<id>` |
| Inflight | shared promise | shared promise | per identity key |

Network/HTTP failures are returned as `error` and are **not** cached as
absence, so a later visit can retry. Caller aborts reject locally but do not
cancel the shared fetch; the shared result still lands in cache. Requests
have a 10s timeout.

### Sanitization order (important)

```text
raw AniList record
  ├─ survivingStreamingEpisodes: season guard → trailer filter + sort → range guard
  ├─ whole-entry gate: any usable title/thumb SURVIVING the guards?
  │     ├─ yes → AniList owns the entry; Kitsu never requested
  │     └─ no  → Kitsu names/thumbnails (by number)
  └─ display sanitization (same guards, separate call)
        └─ normalizeEpisodes() → AniList values → Kitsu values → placeholder
```

The display path is intentionally allowed to discard unsafe AniList rows,
and discarded rows are exactly what opens the fallback (D127).

---

## 4. Video providers

`src/providers/video/registry.ts` owns playback. Verified providers are
AniWave (Worker resolver HLS; Tier 1) and AnimeGG (browser-direct MP4;
Tier 2 fallback), subject to Settings toggles/order. **MegaVid was removed
entirely (D124, 2026-10-24):** its JSON returns
`Access-Control-Allow-Origin: https://megavid.buzz`, so the browser can
never read it. The old `25 episodes • megavid` text was the episode-list
provider, not the playing source; the stream was AniWave. The provider
file, registry entry, health mapping, cache key, and tests were removed;
current comments were updated (one removal rationale remains in the
registry). Old `megavid` prefs are ignored. Provider episodes
feed source mapping, episode slots, and duration hints.
`normalizeEpisodes()` never reads their titles or thumbnails; that rule was
tightened with this batch.

### Watch source resolution (D121, 2026-10-24)

`resolveSourcesWithFallback()` still returns one language from the first
provider that answers. Watch wraps it in `resolveSourcesForLanguages()`,
which resolves the selected episode in **sub and dub in parallel** (one
fallback pass per language), unions `tried`, dedupes sources by
provider/language/quality/URL, and orders the preferred language first.
Initial load and both Retry paths use this resolver.

The Watch source picker is keyed by **option index**, not URL: two providers
can hand back the same URL, and the old URL-keyed native select jumped to
the first match. The picker lists only the active audio language
(`selectedSource.language ?? preferredAudio`) and its label is the provider
alone; a real quality suffix is appended only when it is not `auto`. There
is no language or embed suffix and no trailing Auto hint (D124). Selecting
an option sets the player source; the Sub/Dub toggle switches over the
already-resolved list without refetching and re-filters the picker, and a
language with no source stays disabled. Verified playback means
`currentTime` advances after each switch, not just a changed URL; D123 also
confirmed `currentSrc` changes on the Dub switch.

**Direct-only player (D125, 2026-10-24).** Watch applies `isPlayableSource`
before the picker: only `hls`/`mp4` sources (or a direct URL with no embed
flag) are offered. Embed-only provider results remain in `tried` for the
no-source UI but never render an iframe. The player is lazy-loaded Video.js
v10 (`VideoJsPlayer` + default `VideoSkin` + `HlsJsVideo`), one media
element for both HLS and MP4, so the old native-controls/iframe paths and
the direct `hls.js` dependency are gone.

Provider reality (2026-10-24): AniWave is the only browser-usable provider
in production and resolves through the same-origin Worker relay. MegaVid
was removed entirely after its CORS header proved the browser origin is
blocked (D124). AnimeGG remains the verified Tier-2 fallback but currently
fails Playwright with `ERR_CERT_AUTHORITY_INVALID` (and its CORS error is
visible in the console while tried); the picker and resolver are
provider-count agnostic, but no fake alternatives are surfaced.

Episode tiles in Watch use `ep.thumbnail || anime.backdropImage ||
anime.coverImage` (the EpisodeList rule). AniList/Kitsu own the thumbnail
when present; the show's own artwork is the fallback, never a fabricated
placeholder. Tiles label `Episode N` (not `EN`), fade into `var(--bg)` at
the bottom, use the same 6px border/radius frame as Related Anime, and use
the AnimeCard hover frost + 30px play glyph; the current tile is marked by
a white top-left `Now playing` chip, not a ring/bar/dot (D124).

---

## 5. Code map

| File | Responsibility |
|---|---|
| `src/services/anilist/client.ts` | shared GraphQL transport, cache, 429 cooldown |
| `src/services/anilist/mapper.ts` | AniList → normalized `Anime` |
| `src/providers/metadata/anilistMetadata.ts` | discovery/search/detail, shared `MEDIA_FIELDS` |
| `src/contexts/TrackingContext.tsx` | one active tracker, tracker resolution, writes |
| `src/services/mal/enrichment.ts` | MAL rows → AniList display metadata |
| `src/services/kitsu/client.ts` | Kitsu mapping, episode paging, cache |
| `src/hooks/useKitsuEpisodes.ts` | whole-entry gate + fetch lifecycle |
| `src/lib/episodes.ts` | `hasUsableAniListEpisodeMetadata`, sanitization, `normalizeEpisodes` |
| `src/providers/video/registry.ts` | video-provider order/fallback; dual-language Watch resolution |
| `src/components/related/RelatedRow.tsx` | Home-style Related Anime/Manga row (Watch + Read) |

---

## 6. Verification (2026-10-24)

- `npx tsc --noEmit` — clean.
- Production build — clean (Vite 8; existing chunk-size warnings only).
- Deterministic browser probes (`kitsu-episode.probe.spec.ts` 7/7):
  - AniList data → **0** Kitsu requests, AniList title/thumb rendered.
  - zero AniList data → exactly one AniList mapping + one episode page;
    Kitsu names/thumbnails rendered.
  - partial AniList data (airing) → **0** Kitsu requests; missing rows
    placeholders.
  - finished partial AniList list dropped by the season guard → still **0**
    Kitsu requests; placeholders (discarded data never triggers Kitsu).
  - no Kitsu mapping → AniList mapping then MAL mapping, **0** episode
    requests; placeholders.
  - mapping but no usable Kitsu rows → placeholders.
  - Watch selector receives Kitsu names.
- Live records (`kitsu-live.probe.spec.ts` 1/1): Monster (AniList 19) → 74
  Kitsu thumbnails, 5 Kitsu requests; FMA:B (5114, full AniList list) → 0
  Kitsu requests; Naruto (20, partial AniList list) → 0 Kitsu requests.
- Watch source/UI probe (D124, production 2026-10-24; **superseded in part
  by D128, 2026-10-25**: the heading order is now `Synopsis` ABOVE
  `Episodes`, the header carries an `N episodes` count, and the h1 is the
  show name with no episode suffix — the geometry below still records the
  D124 nav/tile state): source picker shows
  one option `aniwave` (provider-only; no `auto`, language, or trailing
  Auto). Sub playback advanced 2.955s and Dub 2.501s, both
  `readyState 4` with no error; both sources are AniWave through the
  same-origin relay. The nav is a left-aligned row: 1440px x =
  104/209/315 (97/98/74px), 375px x = 16/121/227 (same widths, overflow 0);
  the middle `Episode N` is a white non-focusable span, and E25 Next is a
  disabled button at opacity 0.4. Metadata is `Fall 2006 • TV • 24m`; no
  `25 episodes` text; 25 tiles all `Episode N`; the tile frame matches
  Related Anime exactly (6px radius, 1px border); the current tile uses the
  white top-left `Now playing` chip (no ring/bar/dot); hover overlay is
  `opacity 0→1`, `blur(8px)`, with a 30px play glyph. Settings lists
  AniWave + AnimeGG and no MegaVid; the production bundle has 0
  `megavid` occurrences.
- Read related rail (production): 36 `Related Manga` cards, 236×314,
  rendered after the reader chapter nav and a Synopsis block (D126).
- Watch both rails + Synopsis (production, D122): FMA:B heading order
  `Episodes`, `Synopsis`, `Related Anime`, `Related Manga`; 10 anime cards
  236×134, 5 manga cards 236×314, 40px below Synopsis, 64 episode images.
- Visual checks: Monster detail 1440 / 768 / 375, Watch selector 1440 / 375,
  Incognito off/on dark + on light; Watch related rails, Synopsis, episode
  hover, first-episode nav, and 375 layout all passed. Screenshot files were
  deleted at the owner's request (2026-10-24); the probe assertions and
  measured geometry above are the evidence.
