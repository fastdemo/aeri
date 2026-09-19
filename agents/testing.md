# Testing — Aeri

## Playwright specs (`tests/`)

| Spec | Proves |
|---|---|
| `playback-matrix.spec.ts` | byte classification (TS/fMP4 vs PNG/JPEG/HTML), playlist/nested handling, worker-era aniwave smoke (Bebop E1/E2, Frieren E1), official-vs-demo controls, fallback/source-switch, 1440+375 viewports, cache/abort behavior |
| `series-grouping.spec.ts` | AoT S1/S2/S3 → same 6-season group + selector nav; Naruto multi vs Bebop standalone |
| `streaming-production.spec.ts` | **live** playback per show: `<video>` exists, `currentTime` advances, rs≥2, no fatal error (runs against production) |
| `related-entries.spec.ts` (to add) | S1/S2/S3 independent ids + modal/page/watch show Related Entries, no season selector, ranked order, direct-id navigation, tracking/progress isolation |

Ad-hoc `zz-*.spec.ts` probes are scratch — delete before finishing.
(`series-grouping.spec.ts` REMOVED with the season system — superseded by
related-entries.)

Ad-hoc `zz-*.spec.ts` probes are scratch — delete before finishing.

## Scripts (`scripts/`)

- `verify-env.mjs` (prebuild gate: refuses build without `VITE_*` IDs),
  `verify-build.mjs` (bake check), `verify-live.mjs` (live bundle + matching
  probes, 1 retry), `bench-stream.mjs` (resolve/playlist/variant + same
  segment direct-vs-worker + byte classification → JSON + matrix).

## What each layer proves

- Typecheck (`tsc --noEmit` / `tsc -b`) + `oxlint`: no type/lint errors.
- `verify:build`: IDs baked (catches the D049-class outage).
- `verify:live`: live bundle hash + auth/MAL/PKCE bake + 4 provider-identity
  matches (Bebop/AoT/Frieren/Naruto).
- Playwright matrix: byte-correctness + matching + fallback (no speed claims
  from lucky runs — multi-sample where it matters).
- Production playback: real `<video>` progression on the live URL (the only
  accepted "streaming works" evidence). Moto: never 200-only, never demo.

## Mobile / WebKit

- Emulated viewports 390×844 / 412×915 / 375×667 + touch (tap, modal,
  suggestions) in Chromium; iPad Pro 11 (834) for topbar fit.
- Real Safari hardware: **not available** — native-HLS path preserved but
  device playback untested; say so explicitly in reports.

## Deployment verification

After deploy: root 200 → bundle hash → bake grep → endpoint probes →
Playwright live specs → themed/role-specific spot checks (signed-out gates,
Related Entries presence/order, settings persistence).
