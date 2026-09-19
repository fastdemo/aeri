# Changelog — Aeri (architectural changes only)

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
