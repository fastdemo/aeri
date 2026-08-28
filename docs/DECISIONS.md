# DECISIONS — Aeri

## D001 — Static-only hosting

Decided: GitHub Pages, no backend. Rationale: spec-mandated, keeps ops trivial. Consequence: IndexedDB/localStorage only; all auth client-side.

## D002 — HashRouter

Decided: `HashRouter` over `BrowserRouter`. GH Pages has no rewrite; hash URLs survive refresh without 404.html hack. Cleaner for forks. Tradeoff: URLs contain `#`.

## D003 — Tailwind v4 via @tailwindcss/vite

Decided: Tailwind v4 with Vite plugin. Single pass, no PostCSS config proliferation. Tokens via CSS variables.

## D004 — Mock-first visual prototype

Decided: Phase 2 builds full UI on `src/data/mockAnime.ts` before AniList/MAL. Rationale: visual quality bar requires iteration without API instability.

## D005 — Single AnimeCard with variants

Decided: one component with `variant="default|continue|compact"` rather than duplicated card types. Keeps design consistent.

## D006 — No carousel library

Decided: native scroll + snap. Avoids heavy deps, preserves momentum scrolling. Sufficient for Netflix-style rows.

## D007 — Identity normalization

Decided: explicit `AnimeIdentity` with optional `anilistId`/`malId`. Prevents ID conflation and enables future providers.

## D008 — Video provider abstraction deferred

Decided: stub `VideoProvider` until Phase 7; player uses mock episodes initially. Avoids integrating unauthorized sources.

## D009 — Base path env-aware

Decided: `base` derived from `GITHUB_REPOSITORY` env in CI, fallback `/aeri/` locally. Supports forks without code change.
