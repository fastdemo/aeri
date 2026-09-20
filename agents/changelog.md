# Changelog — Aeri (architectural changes only)

## 2026-09-20 — MangaDex primary; shared-header alignment; manga progress+ordering (D091)

### Changed
- Manga provider MangaDex-first (WeebCentral search outage 2026-09-19: both
  `/search/simple` and `/search/data` 500/empty for ALL queries incl. the
  site's own htmx quick-search — curl + browser verified). New Worker
  `mangadex.ts` + routes `mdx-match/mdx-chapters/mdx-pages`; match prefers
  `links.al` (verified AniList mapping), else scored titles (threshold 40,
  ties fail closed). WeebCentral paths retained as fallback.
- Provider units opaque (`providerUnitId/providerLabel/number/kind/unitType`,
  `sortProviderUnits` at presentation): "Volume 3" never renamed; oneshot
  `chapter:null` → "Oneshot: <title>"; unnumbered keep provider order.
- Licensed/external-only titles (Solo Leveling): EN feed empty BUT
  `/aggregate` lists chapters → worker resolves external URLs, frontend
  shows "Licensed — read officially" links, never the reader. External+pages
  edge (Goodbye Eri) stays readable. Dead at-home 404s → per-image Retry.
- Manga progress = unit+page in IDB `read:<internalId>` (+provider+label);
  mount-clobber guard (never persist page 0 over nonzero), unmount/pagehide
  flush, observer-map clear() bug fixed (refs attach before effects —
  clear wiped all tracking), resume scroll with layout-aware retries.
  `body{overflow-x:clip}` (hidden made body the scroll container, breaking
  window scroll APIs). Continue captions use stored provider label.
- `chapterOrder` pref (`oldest|latest`, default oldest, Settings → Manga,
  `aeri:prefs-changed` broadcast): chapter lists, reader selector, prev/next.
- DetailModal content grid: row 1 = description|metadata, row 2 =
  episodes|related (ONE shared grid row — Episodes/Related Shows headers
  same-y by construction, E-line or not; no offsets). Related grid fixed
  2-col; related caches scoped `<scope>:<id>`; `leading-[22.4px]` hack gone.

### Why
- Single manga outage took down ALL manga; per-show offset hacks could never
  cover both E-line states; scroll tracking silently dead (clear-before-
  observe); resume clobbered by mount flushes.

### Verification
- Alignment delta 0: 5 anime titles × E-line on/off @1440 (mobile stacks,
  768/375 checked, overflow 0). Manga: Berserk 425u/94pp, Vagabond 114u,
  Chainsaw 99u, Eri oneshot, Uzumaki 1u/28pp, SL external 16 links; images
  naturalWidth-verified. Tracking: page 5 persisted, resume scrollY 7442,
  per-title isolation. Ordering: oldest default, latest flip, Settings
  section (auth-gated page — verified in bundle, UI click needs account).

## 2026-09-20 — Verified provider registry + Settings (D092)

### Changed
- `status: verified|unverified|broken` on every anime + manga provider.
  Settings derives both sections from `verifiedVideoProviders()` /
  `verifiedMangaProviders()` — no hardcoded lists. Anime shows AniWave +
  Official Trailer only (6 stubs/dead hidden); manga shows MangaDex +
  WeebCentral (both re-verified end-to-end today).
- Anime resolver pool + capabilities + health map = verified-only; stale
  prefs for dead providers ignored. New `enabledMangaProviders` pref
  (independent from anime toggles); manga fallback iterates verified +
  enabled in registry order; all-disabled → "No Manga providers are
  enabled." (no silent fallback, no disabled requests).
- Reader records winning provider; pages/external links use the same
  provider (unit IDs are provider-scoped). Page cache namespaced per
  provider+chapter.
- WeebCentral recovered from 2026-09-19 outage; new `official.lowee.us`
  page host supported (parser + relay allowlist). Solo Leveling fully
  readable via WeebCentral (201u/49pp) — complements MangaDex externals.
- `npm run verify:providers`: 30-check matrix (5 manga × 2 providers +
  SL externals + 3 anime × episodes/sources/TS bytes).

### Verification
- `verify:providers` 30/30; disabled-provider request interception clean;
  all-off state shows the enabled-message; typecheck/lint/build clean.

## 2026-09-19 — Season system removed; Related Entries; episode/chapter unification

### Changed
- Season selector, group model, spine walk, stem dedup, franchise merging
  all removed. Entries independent by AniList id (route/tracking/progress/
  matching/caches). `series.ts` stubbed, `useSeriesGroup` deleted.
- New Related Entries (ranked AniList relations, direct-id links) at the
  bottom of modal + detail page + watch. Ranking: sequel→prequel→parent→
  character→summary→alternative→spinoff→side-story→adaptation→OVA/ONA→
  special→movie→other, TV-boosted. Relations ride on Media queries.
- Episodes/Chapters unified: transparent wrappers, per-row surface cards,
  `01` numbers, right-side counts (`Episodes | 25 episodes`), no provider
  names, no `S1:` anywhere. Continue captions `E<number>`.
- DetailModal shows exactly the opened entry; opens scrolled to top.
  Continue Watching per-entry, recency order. Titles: display-strip only.

### Why
- Season-as-identity merged distinct entries (wrong progress, wrong
  streams, hidden S2/S3). Relations are navigation context, not identity.

### Impact
- Old `anilist:seriesgroup:*` / `:spine:` cache keys go unused (no
  migration — progress was always per-id). Related-links use plain anchors
  (modal closes on any hashchange).

### Verification
- Local Playwright: AoT modal 11 related (S2 first), no selector; `01`
  numbering; Mocha borders visible; live: related present, manga reader
  24/10 pages, browse 90 cards, `verify:live` 8/8.

## 2026-09-18 — Auth gates + sign-in UX + browse shuffle key

### Changed
- Signed-out users: card/hero/search picks open `SignInModal` (not preview);
  `/watch`, `/anime`, `/list`, `/settings`, `/profile` redirect `/`.
- Sign-in modal scroll-locks background; provider logos bare white, full-size.
- Browse/Manga page-1 shuffle key now includes category id.

### Why
- Media/tracking pages are members-only; stale-grid reuse across categories
  sharing a sort (Airing vs Popular).

### Impact
- Deep links to media pages bounce home when signed out (intended).

### Verification
- Local Playwright: card→signin, all five gates → `#/`, all categories
  populate (90 imgs each).

## 2026-09-16 — Unified season groups + 404 + manga route + blur fix

### Changed
- Selection follows route id; selector navigates to canonical `anilist-<id>`;
  `resolveGroup` idempotent. Real 404 page; `/manga` route (then placeholder);
  suggestions blur `isolation: isolate`.

### Why
- Disconnected "AOT experiences" from per-page group state.

### Impact
- Season URLs are the selected season's identity (shareable, stable).

### Verification
- Live specs: AoT S1/S2/S3 same 6-group; Naruto multi; Bebop standalone.

## 2026-09-15 — Season performance (slim-spine + batch, then unified fetch)

### Changed
- Chain walk carries full display fields per hop (1 req/step, no batch pass);
  shared `anilist:media` record (page costs ~1 cold, 0 warm); card prewarm.

### Why
- Cold season loads cost N+1 requests (page + walk + batch).

### Impact
- AoT cold 8→7 atoms; warm revisits 0 requests.

### Verification
- Local request audits; burst 21 reqs / 0× 429.

## 2026-09-14 — AniList resilience + source-quality verdict

### Changed
- Shared inflight dedup, 429 shared cooldown (no retry), THROTTLED code with
  silent cached recovery, enrichment pacing (2×12, 2.5s tail), trailer folded
  into shared Media query. Megaplay `enc` → anikoto rejected (kept, canary).

### Why
- 30/min throttle + duplicate metadata broke playback; fastest pipe served
  PNG poison.

### Impact
- No user-facing countdowns; aniwave/echovideo stands as the ceiling.

### Verification
- `verify:live` 8/8; matrix 21 passed; live playback advancing.
