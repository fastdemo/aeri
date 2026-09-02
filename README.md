<img src="img/aeri-icon.png" alt="Aeri icon" width="128" height="128" />

# Aeri

A minimal anime discovery and tracking app that feels like a streaming service, not a database. Browse, search, keep track of what you're watching, and pick up where you left off.

**Live at:** https://aeri.fastdemo.workers.dev/

## Preview

<img src="img/aerithumb.png" alt="Aeri preview" width="800" />

## Highlights

Aeri tries to be the quiet, cinematic way to browse anime. Big hero, horizontal rows, no clutter. Just open it, find something, watch, and let it remember.

* **Discovery** — Trending, popular, currently airing, and new releases from AniList
* **Search** — Live search with real results as you type
* **Tracking** — Connect AniList and MyAnimeList to sync status, progress, and ratings
* **Episode handling** — Remembers where you left off, season-aware grouping, correct S1:E12 vs global numbering
* **Details** — Cover, banner, description, studios, genres, relations, seasons grouped sensibly
* **Seasons** — Related TV seasons are grouped via relations, movies and OVAs stay separate
* **Responsive** — Works on phone, tablet, and desktop, touch rows and readable hero
* **Caching** — Local cache for fast repeat loads
* **PWA** — Installable on supported browsers where practical

## Quick start

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # production build
```

No backend needed for browsing and tracking. Video and MAL auth use the same Cloudflare Worker when you want the full experience.

## Tech

* **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4
* **Routing:** HashRouter (`/#/`) so refresh and deep links work without server rewrites
* **Data:** AniList GraphQL for discovery and MAL REST for tracking, both through small adapter layers
* **State:** React Context + hooks, no heavy store
* **Storage:** localStorage for prefs and IndexedDB for watch history, progress, and cached metadata
* **Worker:** Cloudflare Worker serves the same `dist` and proxies video and auth where the browser cannot due to CORS

## Development phases

This is what actually shipped. I am being honest here.

**Completed**

* [x] Phase 1 — Foundation, routing, design system, and hosting setup
* [x] Phase 2 — Visual prototype with mock data
* [x] Phase 3 — AniList auth, list syncing, progress, status, and ratings
* [x] Phase 4 — Real discovery: trending, popular, airing, search, and dynamic hero
* [x] Phase 5 — MyAnimeList auth via PKCE, list syncing, and merged dedup
* [x] Phase 6 — Browse filters and pagination, live search, real detail, My List, episode progress, caching, and responsive polish
* [x] Phase 7.1 — Performance, metadata accuracy, real episode titles and thumbnails, and removal of placeholder content
* [x] Phase 8 — Series grouping into seasons, episode completeness, UI cleanup, and settings
* [x] Phase 9 — Episode integrity, season-aware numbering, One Piece offset handling, and cache fixes
* [x] Phase 10 — Worker architecture, provider abstraction, and normalized sources
* [x] Phase 11 — Navigation reliability and episode integrity in production
* [x] Phase 12 — Dynamic homepage behavior and randomization
* [x] Phase 13 — Cloudflare migration, production auth, and homepage row fixes

**Partially completed**

* [~] Phase 7 — Real Video Playback and Multi Provider Streaming

What works:

* VideoProvider abstraction, Cloudflare Worker backend, HLS player via `hls.js`, source normalization, demo HLS test source, fallback UI with tried providers, watch position, and tracking integration

What does not work reliably:

* Resolving real anime episodes to playable sources in production. The architecture is there, but no provider consistently returns real episode sources for arbitrary anime. DemoProvider proves the player works, but it is not real anime streaming. Streaming is currently not fully working and should not be presented as completed.

No other major phase was fully completed beyond what is listed above. The phase list here reflects what is actually live, not what was planned.

## Deployment

Aeri is now hosted on **Cloudflare Workers** with assets.

**Live:** https://aeri.fastdemo.workers.dev/

The original plan was GitHub Pages at `fastdemo.github.io/aeri`, and some docs still mention it for historical context, but all current user flows, OAuth redirects, and API calls are on the Cloudflare origin. The redirect URL for both AniList and MAL is `https://aeri.fastdemo.workers.dev/` and must match exactly what is configured in each provider dashboard.

Local env:

```bash
VITE_ANILIST_CLIENT_ID=49713
VITE_MAL_CLIENT_ID=ce55a1d587f549b33c1fa36ec10fe8d2
```

These are public client IDs and are baked into the production bundle at build time.

```bash
npm run build
# Cloudflare serves `dist` at the Worker origin
```

`gh-pages` is kept for history but is not the current site.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Credits

* **AniList** and **MyAnimeList** for metadata and tracking. Aeri would not exist without them.
* Built by an anime fan for anime fans. No plans to monetize.

Made with love by **@fastdemo** <3
