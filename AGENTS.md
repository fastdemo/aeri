# AGENTS.md — Aeri Development Instructions

> This document is the authoritative instruction file for all agents (human or AI) working on Aeri. Read this before making substantial changes. Update when major architectural decisions change.

## 1. What is Aeri

Aeri is a minimal anime discovery, tracking, and watching web application. It feels like a **purpose-built anime streaming service** with Netflix-style cinematic browsing — not a database, not a dashboard, not a piracy site.

Core loop: Open → See something worth watching → Continue watching → Discover → Open anime → Watch → Progress remembered → MAL/AniList synced.

---

## 2. Architecture

### 2.1 Static-only constraint

Aeri is deployed to **GitHub Pages** (`https://USERNAME.github.io/REPOSITORY/`). There is no backend.

- No Express / Next.js API routes / server sessions / secrets / DB
- Everything is static frontend: Vite + React + TypeScript
- Persistence via `localStorage` (small settings) and `IndexedDB` (structured data)
- PWA support where practical (manifest, offline shell, caching)

### 2.2 Tech stack

| Layer | Choice |
|-------|--------|
| Build | Vite 6+ with `base: '/REPO/'` for GH Pages |
| UI | React 19, TypeScript strict |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Routing | HashRouter (`react-router-dom`) — guarantees deep links & refresh work on GH Pages without 404 |
| State | React Context + hooks; no Redux unless justified |
| Storage | `storage/` abstraction over localStorage / IndexedDB |
| Data | AniList GraphQL + MAL REST via adapters (mock data until Phase 3) |
| Testing | Playwright for browser visual verification |
| PWA | `vite-plugin-pwa` if added — offline shell only, not offline video |
| Deployment | GitHub Actions `deploy.yml` building to `gh-pages` |

### 2.3 Project structure

```
src/
├── components/
│   ├── navigation/    # Navbar
│   ├── hero/          # Hero
│   ├── cards/         # AnimeCard
│   ├── rows/          # ContentRow / Carousel
│   ├── detail/        # Detail modal/overlay
│   ├── episodes/      # EpisodeList
│   ├── player/        # Video player shell
│   └── ui/            # Button, Skeleton, Modal primitives
├── pages/             # Home, Browse, MyList, Watch, Search
├── layouts/           # RootLayout
├── hooks/
├── services/          # anilist, mal, recommendations
├── providers/         # anilist/, mal/, video/ abstractions
├── recommendations/
├── storage/           # localStorage + IndexedDB abstraction
├── types/             # Anime, Episode, Identity
├── lib/               # utils, constants
├── data/              # mock anime data
└── styles/            # globals.css, tokens
```

Do not create empty ceremony folders. Only create when code lives there.

---

## 3. Design System — Critical

Aeri MUST NOT look like a typical anime site. The anime artwork provides personality; UI stays quiet.

### 3.1 Principles

- Near-black background (`#0a0a0a` / `#080808`), not pure black
- Subtle dark navigation — recedes, never a heavy sidebar
- Restrained typography — readable, not bold everywhere
- Large cinematic hero, edge-to-edge, with layered gradients (left→transparent, bottom→background), never solid overlay
- Landscape cards, horizontal rows, no vertical grids on home
- Minimal chrome, minimal badges, progress bars only when relevant
- Quiet hover (slight scale, 150-200ms), no bouncing
- Dark modal/detail presentation that feels like expansion, not navigation

Refer to `docs/DESIGN_SYSTEM.md` for full tokens.

### 3.2 Tokens (CSS variables)

Defined in `src/styles/globals.css`:

```css
:root {
  --bg: #070708;
  --bg-soft: #0f0f10;
  --surface: #141416;
  --surface-elevated: #1c1c1e;
  --text: #f5f5f5;
  --text-muted: #9a9aa0;
  --text-faint: #6b6b70;
  --border: rgba(255,255,255,0.08);
  --accent: #e50914; /* restrained — use sparingly or desaturated */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

### 3.3 Typography

- Font: Inter / Geist Sans (system fallback) — weights 400,500,600 only
- Hero title: 2.2rem, 600, letter-spacing tight
- Row title: 0.95rem, 600
- Card title: 0.8rem, 500
- Body: 0.875rem, 400, line-height 1.6, muted color

### 3.4 Visual Quality Bar

If conflict: **better visual quality > more features**, **cleaner hierarchy > more information**, **simple UI > fancy UI**. Every UI change must be verified in a real browser at multiple viewports.

---

## 4. Component Rules

- One reusable `AnimeCard` with variants (`default` | `continue` | `compact`), not duplicated card components
- Rows: `<ContentRow title>` wrapping horizontal scroll, not vertical grids
- Use semantic HTML, Tailwind only inside components — no CSS-in-JS proliferation
- No heavy carousel library — native scroll + snap + optional scroll buttons
- Skeleton loaders must mirror final layout (no full-page spinners)
- All interactive elements: keyboard accessible, visible focus, aria where needed
- Respect `prefers-reduced-motion`

---

## 5. GitHub Pages Limitations

- Site lives at `/REPO/` subpath — set `base` in `vite.config.ts` dynamically (`process.env.GITHUB_REPOSITORY` or hardcode `/aeri/`)
- Assets, images, CSS, JS, manifest, routes must use relative base
- Use `HashRouter` so `/#/anime/123` survives refresh. If using BrowserRouter, must add `404.html` hack — prefer HashRouter simplicity.
- Deploy via `.github/workflows/deploy.yml`: `npm ci && npm run build` → upload `dist` to `gh-pages`
- Test deep links: `/`, `/#/browse`, `/#/anime/123`, `/#/watch/123/4`, `/#/list`

---

## 6. API Architecture

All external calls through abstractions. No direct fetch in UI components.

```
TrackingProvider (interface)
├── AniListProvider
└── MyAnimeListProvider

VideoProvider (interface)
└── AuthorizedProvider (stub until Phase 7)
```

Mock data in `src/data/mockAnime.ts` drives Phase 2 visual prototype.

---

## 7. Authentication Rules

- OAuth for AniList (implicit/code flow via redirect, token in memory + storage) and MAL (PKCE)
- Tokens stored in storage abstraction, never in plain `localStorage.getItem` scattered
- No server sessions; all refresh client-side
- UI must handle auth failure gracefully (not raw errors)

---

## 8. MAL / AniList Rules

- No API calls directly inside UI components — only through `services/anilist.ts` / `services/mal.ts` adapters
- Rate-limit, cache, deduplicate requests
- Common `AnimeList` type returned to app

---

## 9. Anime Identity Mapping

```ts
interface AnimeIdentity {
  internalId: string      // Aeri canonical (slug or uuid)
  anilistId?: number
  malId?: number
  kitsuId?: number
}
interface Anime {
  identity: AnimeIdentity
  title: { romaji: string; english?: string; native?: string }
  // ...
}
```

Never assume `anilistId === malId`. Explicit map table. Enables adding new providers later.

---

## 10. Local Storage Rules

Abstraction layer: `src/storage/`

- `storage/preferences.ts` → localStorage (UI prefs, theme)
- `storage/db.ts` → IndexedDB (watch history, progress, cached metadata, recently viewed)
- No scattered `localStorage.getItem(...)` — all through `storage` helpers
- Versioned schema, migration on open

Persist: watch history, progress, preferences, cached metadata, recently viewed, UI prefs

---

## 11. Video Provider Abstraction

```ts
interface VideoProvider {
  getEpisodes(anime: Anime): Promise<Episode[]>
  getSources(episode: Episode): Promise<VideoSource[]>
}
```

Player never knows provider implementation. Use only authorized embeddable sources. Never bypass DRM/paywall/ads.

---

## 12. Accessibility

- Semantic HTML (`nav`, `main`, `dialog`, `button`)
- Keyboard navigation for rows, modals, player
- Visible focus rings (`:focus-visible`)
- ARIA labels on icon buttons, dialogs (`role="dialog" aria-modal`)
- Contrast ≥ 4.5:1 for text over hero (gradient ensures)
- No hover-only actions
- Respect `prefers-reduced-motion`

---

## 13. Performance

- Lazy-load artwork (`loading="lazy"`, IntersectionObserver)
- Responsive images (`srcset` if available)
- Code splitting (`React.lazy` for Watch, Detail)
- Request deduplication + simple cache map
- Minimal dependencies (no heavy carousel)
- Image decoding async
- Lighthouse performance target > 90 on desktop

---

## 14. Browser Testing

Mandatory after major UI changes:

1. `npm run dev` → launch via Playwright
2. Navigate, click, inspect a11y, take screenshots at 1440 / 768 / 375
3. Compare against reference screenshots (hero gradients, nav spacing, card dims, row spacing, typography)
4. Check console errors, deep links, responsive

See `.opencode/skills/browser-testing/SKILL.md`.

---

## 15. Git Conventions

- Focused commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`
- Examples: `feat: establish Aeri design system`, `feat: build cinematic homepage`
- Avoid `finished website` dumps
- Branch per phase if needed; keep `main` deployable

---

## 16. Visual Quality Requirements

Before calling done, Aeri must:

- Feel like a real streaming product for anime — not a Tailwind demo
- Hero feels cinematic (correct height, gradient, text readability)
- Rows feel continuous, not boxed
- Detail modal feels immersive, dark, expanded
- Watch page is almost entirely video
- Mobile is intentional (touch rows, readable hero, usable player)
- No visual jank, no giant spinners, no neon, no glassmorphism

---

## 17. Workflow for Agents

1. Read this file + relevant `docs/`
2. Check `TODO.md` — keep `Now` small
3. Implement with mock data first (Phase 2) before wiring APIs
4. Verify visually via Playwright — do not declare done on code inspection alone
5. Update docs when architecture shifts

---

## 18. Docs & Verification Discipline (mandatory)

Past sessions broke login for days because docs described flows nobody re-verified (implicit grant, GH Pages base, "no backend"). These rules prevent repeats:

- **Update `docs/` (never `README.md` — the owner writes that) in the same commit as the behavior change**, once proven correct: new/changed auth flows → `API.md` + `ARCHITECTURE.md` + a `DECISIONS.md` entry; deploy/hosting changes → `DEPLOYMENT.md`; completed work → `TODO.md`. A docs update based on a guess is worse than none — verify first, then write.
- **Verify every task with real evidence, using the right tool for the job:**
  - UI/behavior changes → Playwright MCP on a live or preview build (click through the actual flow, read console + network, screenshot at 1440/768/375). Never declare done from code inspection alone.
  - **Use Playwright sparingly — it is slow.** Prefer cheap probes first: `curl` for endpoints/bundles, `node`/`python3` one-liners for pure logic, targeted `evaluate` assertions over full-page snapshots. One well-chosen browser pass beats five exploratory ones: batch multiple assertions into a single `evaluate`, reuse one page load for several checks, avoid `wait_for` sleeps longer than needed, and never screenshot when text assertions suffice. Full multi-viewport screenshot sweeps are for final verification, not iteration.
  - Library/framework/API questions (OAuth params, Wrangler config, Vite behavior) → Context7 MCP, not memory.
  - Repo history, runs, and deploys → GitHub MCP + Actions API; after any push, confirm the live bundle hash and endpoint behavior, never trust the workflow badge alone (failed runs have published before).
  - AniList/MAL/third-party behavior → test the real endpoint (curl or browser) and record exact status/body in the decision entry.
  - Cloudflare Workers/routes/secrets → `wrangler` CLI (`--dry-run` for config, real deploy when authorized) and live endpoint probes.
  - The `search` tool (code search) for locating every usage before changing shared code — no silent callers left behind.
- **Secrets stay out of code, bundles, logs, and chat.** `ANILIST_CLIENT_SECRET` lives only in Worker secrets / auth-proxy env / the owner's keychain. Verify absence with bundle greps, never by printing values.
- **Never report success on a 302, a URL shape, or a token's existence.** Auth is done only when the authenticated UI loads its data in a real browser session.
