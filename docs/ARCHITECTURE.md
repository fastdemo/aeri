# ARCHITECTURE — Aeri

## Overview

Aeri is a static frontend SPA deployed to GitHub Pages. No backend process exists at runtime.

```
User Browser
  ├─ React SPA (Vite)
  ├─ IndexedDB / localStorage (progress, cache)
  ├─ Service Worker (PWA shell, optional)
  ├─ AniList GraphQL (direct, CORS)
  └─ MAL REST (direct, OAuth PKCE)
```

## Routing

- `HashRouter` (`react-router-dom`). Paths: `#/`, `#/browse`, `#/anime/:id`, `#/watch/:id/:episode`, `#/list`, `#/search`.
- Why hash: GH Pages serves static files only; `/#/anime/123` does not require server rewrite, refresh never 404s.
- Alternative (`BrowserRouter` + `404.html` hack) was considered and rejected for simplicity.

## Data Flow

```
UI Component
  → hook (useAnime, useList)
    → service (anilist.ts / mal.ts / recommendations)
      → provider adapter (TrackingProvider / VideoProvider)
        → fetch + cache
          → storage (IndexedDB) + state
```

UI never calls fetch directly.

## Mock Data (Phase 2)

`src/data/mockAnime.ts` provides deterministic anime list with backdrop, cover, genres, progress.
All rows and hero consume mock until AniList wiring (Phase 3).

## Identity

Canonical `internalId` (slug). Optional `anilistId`, `malId`. Mapping table `src/lib/identity.ts`.

## Storage

- `src/storage/preferences.ts` — small JSON in localStorage (theme, player prefs)
- `src/storage/db.ts` — IndexedDB via `idb` (history, progress, cache). Versioned, migrations.

## Performance

- Tailwind v4 eliminates separate build step; Vite handles CSS.
- Cards lazy-render, images lazy-load.
- Detail + Watch lazy via `React.lazy`.
- No heavy carousel library.

## Future Extensibility

- New provider: implement `TrackingProvider`
- New video source: implement `VideoProvider`
- Requires only identity mapping extension, no UI changes.
