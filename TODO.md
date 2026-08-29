# TODO — Aeri

## Now
- [x] AGENTS.md + docs + skills (Phase 1)
- [x] Vite/React/TS/Tailwind + HashRouter + GH Pages config
- [x] Visual prototype on mock data (nav, hero, rows, cards, detail modal, episode list, watch, search, browse, my list)
- [x] Playwright verification at 1440/768/375 + deep-link check + preview base check
- [x] AniList integration (Phase 3) — implicit grant, Viewer + MediaListCollection, mapper, My List + Home + progress/status/rating sync, loading/error/auth-expired, memory+IDB cache + dedup
- [x] Real Anime Discovery & Metadata (Phase 4) — AnimeMetadataProvider (AniList), Home Trending/Popular/Airing/New, Search real, Detail real metadata, Browse real, images lazy + fallback, shared cache, mock fallback only

## Next
- [ ] MyAnimeList integration (Phase 5) — OAuth PKCE, `MALProvider`
- [ ] Local persistence polish (Phase 6) — history, watch progress, migrations
- [ ] Recommendation engine wiring (Phase 6) — deterministic sections ready

## Later
- [ ] VideoProvider + player (Phase 7, authorized sources only)
- [ ] PWA offline shell tuning
- [ ] a11y + perf audits (Lighthouse, keyboard, reduced-motion)
- [ ] Final GH Pages deployment verification on `fastdemo/aeri`

## Phase 4 Verification
- Home: real trending/popular/airing/new, hero from trending[0], Continue Watching/My List from AniList when auth else hidden + public discovery still works
- Browse: real popular filtered by genre, loading skeleton, error friendly
- Search: always real AniList debounced 300ms, loading pulse, empty, network/rate-limit friendly
- Anime detail: real metadata via getAnime (title/alt/desc/cover/banner/episodes/duration/status/year/season/genres/studios/score/popularity/idMal) stripped HTML
- Images: AniList artwork, lazy where appropriate, fallback backdrop||cover
- Caching: shared memory 5min + IDB 24h + inflight dedup, 4 parallel homepage requests (not dozens)
- Mock retained as fallback/test fixture only
