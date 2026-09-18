# Current State — Aeri (living document, update on every behavior change)

## Working

- Discovery (Home rails, Browse filters+pagination, Search live+debounced),
  detail pages, My List, Continue Watching, progress sync (both trackers).
- AniList + MAL auth (Deno + Worker paths), tracker switching, sync toggles.
- Season groups (AoT 6, Naruto multi, MHA; movies/OVAs excluded; selector
  navigates to canonical season; idempotent across entries).
- Streaming: aniwave→echovideo default, Re:Zero S1/S2 + Bebop/AoT/Frieren/
  Naruto verified with advancing playback; fail-closed matching; Retry/fallback.
- Manga browse (real AniList data, chapters/volumes, no reader).
- 17 themes (global tokens, persist, pre-render init); 2-decimal ratings by
  tracker; responsive + touch behavior; 404 + signed-out gates + profile
  placeholder; footer/nav fit behaviors.
- AniList resilience: dedup + shared cooldown + stale serve + paced
  enrichment; no user-facing countdowns.

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

- 2-decimal ratings; auth-gated routes + sign-in-on-card-tap; sign-in
  scroll-lock + bare brand marks; browse shuffle key includes category;
  manga chapters/volumes fields; sub/dub toggle surface token.
- Theme token sweep (no hardcoded colors); pure black/white Aeri Dark;
  capture-free hover titles (name/year/format/genre).

## Needs verification

- Full Playwright suite + `verify:live` after this docs task lands (docs
  only — no behavior changed, but the checklist still applies).
