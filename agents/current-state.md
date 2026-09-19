# Current State — Aeri (living document, update on every behavior change)

## Working

- Discovery (Home rails, Browse filters+pagination, Search live+debounced —
  distinct ids never collapsed), detail pages, My List, per-entry Continue
  Watching (recency order), progress sync (both trackers, per-entry ids).
- AniList + MAL auth (Deno + Worker paths), tracker switching, sync toggles.
- Independent anime entries (no season system): S1/S2/S3 = separate ids,
  routes, tracking, progress, matching, caches. Related Entries (ranked
  AniList relations) on detail + watch + modal; no selector anywhere.
- Streaming: aniwave→echovideo default, Re:Zero S1/S2 + Bebop/AoT/Frieren/
  Naruto verified with advancing playback; fail-closed per-entry matching
  (S2 aniwave resolves 12 eps, never S1's); Retry/fallback.
- Manga reading (WeebCentral primary): browse → DetailModal (Read/Continue
  always present, chapters+volumes metadata) → chapter list (provider
  chapters, own-span labels) → `#/read/:id/:chapter` vertical-continuous
  reader (signed `/api/manga/img` pages, selector + prev/next + keys,
  chapter+page progress). Verified: Berserk Ch 386 (24 signed pages,
  ordered, 1200×1694 rendered), Solo Leveling Ch 200 (49 pages, 720×4000
  long-strip, responsive on scroll). Open to signed-out users.
- 17 themes (global tokens, persist, pre-render init); 2-decimal ratings by
  tracker; responsive + touch behavior; 404 + signed-out gates (anime) +
  profile placeholder; footer/nav fit behaviors.
- AniList resilience: dedup + shared cooldown + stale serve + paced
  enrichment; no user-facing countdowns. `useMangaDetail` (type: MANGA —
  ANIME query returns null for manga ids).

## Partially working

- Volume/autoplay/subtitles/audio/provider prefs apply per render; provider
  toggles/order/custom URL apply on next resolve (Retry/episode change).
- `customAuthApiUrl` works but has no Settings input; `preferredQuality` is a
  dead key (no consumers) — both intentionally unwired.
- Enrichment tail converges slowly on huge MAL lists (by design).

## Broken

- Nothing currently known-broken on production. (If you find something, put
  it here with repro + date — do not silently fix and forget.)

## In progress

- `agents/` knowledge system (this task) — needs `context.md`, README/AGENTS
  updates, validation, deploy.

## Known limitations

- Upstream throughput lottery (tens–hundreds KB/s vs ~670kbps streams);
  single-rendition masters; no ABR to tune; parallel segments don't scale.
- AniKoto `enc` (bypass-class) → 0 sources; Pahe kwik needs JS-unpack;
  animekai/hianime/gogo unreachable from CF edge.
- Worker cannot read AniList (IP-blocked) — browser holds metadata.
- Real Safari hardware untested (native-HLS path preserved, unverified).
- Title-less `/api/sources` calls fail matching (Watch always sends hints).

## Recently changed

- Season system REMOVED (D084): no selector/group/spine/dedup anywhere.
  Entries independent by AniList id; Related Entries (ranked relations,
  direct links) on modal + detail + watch; E-numbers (no S:); per-entry
  Continue Watching; relations ride on Media queries (zero extra requests).
- Episodes/Chapters visual unification (D083): transparent wrappers,
  per-row surface cards, `01` numbers, right-side counts, no provider names.
- Manga reader (D083): WeebCentral provider + signed image relay + Read page
  + ChapterList + shared AnimeCard manga treatment + open manga (no sign-in
  gate) + loopback CORS for local preview + `useMangaDetail` type fix.
- DetailModal manga path bypasses `sanitizeAnimeForDisplay` (episode-number
  validation throws on manga streaming data — shared fix, anime unaffected).
- Chapter label parsing reads the chapter's own `<span class="">` only
  (Last-Read/new badge spans previously leaked into labels/numbers).
- 2-decimal ratings; auth-gated routes + sign-in-on-card-tap; sign-in
  scroll-lock + bare brand marks; browse shuffle key includes category;
  manga chapters/volumes fields; sub/dub toggle surface token.
- Theme token sweep (no hardcoded colors); pure black/white Aeri Dark;
  capture-free hover titles (name/year/format/genre).

## Needs verification

- Full Playwright suite + `verify:live` after deploy (reader verified locally
  against production Worker; production SPA check pending).
- Real Safari hardware untested (reader uses plain `<img>`, no HLS path).
