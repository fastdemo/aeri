# Aeri — minimal anime streaming

> A purpose-built anime discovery, tracking, and watching web app. Cinematic browsing like a modern streaming service, not a database.

**Live:** `https://fastdemo.github.io/aeri/#/` (GitHub Pages, HashRouter)

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173/aeri/#/
npm run build    # static dist/
npm run preview  # http://localhost:4173/aeri/#/
```

## Stack

- Vite + React 19 + TypeScript (strict)
- Tailwind CSS v4 (`@tailwindcss/vite`)
- React Router `HashRouter` (GH Pages safe — no 404 on refresh)
- IndexedDB + localStorage via `src/storage/` abstraction
- PWA manifest (`public/manifest.webmanifest`)

No backend. All data is static + browser persistence + direct AniList/MAL calls via adapters (mock data in Phase 2).

## Structure

See `AGENTS.md` and `docs/ARCHITECTURE.md` for authoritative rules.

```
src/
  components/navigation | hero | cards | rows | detail | episodes | player | ui
  pages/  Home Browse Search MyList Watch AnimeDetail
  data/mockAnime.ts  — deterministic 20-title catalog for visual prototype
  types/anime.ts
  storage/  preferences.ts (localStorage) + db.ts (IndexedDB)
  providers/anilist|mal|video
  recommendations/engine.ts
  lib/identity.ts
  styles/globals.css  — design tokens (near-black, quiet UI)
```

## Design

`docs/DESIGN_SYSTEM.md` — near-black (#070708), cinematic hero with layered gradients, landscape 16:9 cards, horizontal rows, dark modal, restrained typography. Artwork provides color, UI stays quiet.

## Deployment (GitHub Pages)

- `vite.config.ts` `base` is env-aware: `/${GITHUB_REPOSITORY.split('/')[1]}/` in CI, `/aeri/` locally
- HashRouter ensures `/#/anime/<id>` survives refresh
- Workflow `.github/workflows/deploy.yml` → `npm ci && npm run build` → `actions/deploy-pages`

Test deep links after build:

```
http://localhost:4173/aeri/#/
http://localhost:4173/aeri/#/browse
http://localhost:4173/aeri/#/anime/frieren
http://localhost:4173/aeri/#/watch/frieren/17
http://localhost:4173/aeri/#/list
```

## Docs

- `AGENTS.md` — must-read for contributors
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/API.md`
- `docs/DEPLOYMENT.md`
- `docs/DECISIONS.md`
- `.opencode/skills/` — frontend-design, browser-testing, github-pages, anime-data

## Phases

- [x] Phase 1 — foundation (Vite, tokens, routing, GH Pages)
- [x] Phase 2 — visual prototype on mock data (nav, hero, rows, cards, detail, watch, search, my list)
- [ ] Phase 3 — AniList
- [ ] Phase 4 — MAL
- [ ] Phase 5 — persistence
- [ ] Phase 6 — recommendations
- [ ] Phase 7 — video
- [ ] Phase 8 — polish
