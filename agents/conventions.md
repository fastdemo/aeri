# Conventions — Aeri

## How to change things safely

1. Read `AGENTS.md` + `agents/README.md` + the relevant doc(s) here.
2. Inspect the real code path end-to-end before editing (imports → runtime).
3. Keep changes minimal and local; prefer existing abstractions over new ones.
4. Verify with the right tool: Playwright for UI, `curl`/node for
   endpoints/logic, Context7 for library/API questions, bundle greps for
   secrets, live probes for deploys. Never declare done from inspection alone.

## Code

- TypeScript strict; `oxlint` clean; `tsc --noEmit` clean.
- One `AnimeCard` (variants, not copies); rows scroll horizontally, grids only
  on browse/manga; no carousel libs; skeletons mirror layout.
- Tailwind in components only; **all color via `var(--…)` tokens or
  `color-mix()` derivations** — never hardcoded white/black/brand hex.
- Semantic HTML, keyboard support, `aria` on icon buttons/dialogs/menus,
  `prefers-reduced-motion` respected.
- No `fetch` in UI components (health-Test button excepted); data lives in
  providers/services/registry; hints threaded as params, never invented.

## Data / state

- Single active tracker; no merged reads, no fan-out writes; per-field sync
  toggles gate mutations.
- `anilistId ≠ malId` — explicit identity, never assumed equal.
- Storage only via `storage/` helpers (`aeri:prefs`, IDB `aeri` v2); versioned
  schema; no scattered `localStorage.getItem`.
- Caches: bounded, expiring, fail-soft; stale-while-throttled; no permanent
  "fastest CDN" assumptions.

## Boundaries (do not casually cross)

- Streaming/matching/security/rate-limit/auth/Worker architecture: fix only
  with evidence + regression tests (playback = `currentTime` advancing).
- Router stays `HashRouter`; base `/` for Worker (Pages base only for
  explicit `gh-pages` builds).
- Manga mirrors Anime structure; no reader/sources invented.
- Settings: every control real (Reduced-motion readout is the known
  exception); dead keys (`preferredQuality`) stay dead, not wired speculatively.

## Git / docs

- Focused commits (`feat:/fix:/docs:/chore:/refactor:`); `main` deployable.
- **No GitHub ops** (push/PR/Actions/`gh-pages`) unless explicitly asked.
- Docs updated in the same change once proven: `agents/*.md` + `context.md`
  + `changelog.md` + `current-state.md` as the change warrants. Docs describe
  code — never the reverse.
