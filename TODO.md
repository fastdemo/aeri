# TODO — Aeri

## Now
- [x] AGENTS.md + docs + skills (Phase 1)
- [x] Vite/React/TS/Tailwind + HashRouter + GH Pages config
- [x] Visual prototype on mock data
- [x] Playwright verification at 1440/768/375 + deep-link
- [x] AniList integration (Phase 3)
- [x] Real Anime Discovery & Metadata (Phase 4)
- [x] MyAnimeList integration (Phase 5) — PKCE, MALProvider, mapper, MALContext + TrackingContext merged dedup via malId, MyList/Home/Detail/Watch/EpisodeList/Navbar compact, verified via Playwright (Home/Browse/Search/Detail/Watch, unauth/MAL/AniList/both, loading/empty/API failure/mobile), build passing
- [x] MAL CORS diagnosis + feasibility (Parked) — redirect_uri fix, CORS-specific errors, docs/MAL_BROWSER_FEASIBILITY.md, GH Pages build with VITE_MAL_CLIENT_ID, Pages live
- [x] Complete AniList Discovery & Core Experience (Phase 6) — Hero real, Trending/Popular/Airing/New real, Browse tabs (Popular/Trending/Airing/Upcoming/Finished) + genre/year/season/format filters + pagination (useBrowse), Search live while typing (debounced, stale-ignore, URL sync), Detail real, MyList empty when unauth (no mock), Episode/Watch progress via TrackingContext, loading/error/empty for all, caching 4 parallel Home + Browse perPage 24 + dedup, mobile 375/768/1440 no overflow, a11y, no mock discovery, tsc/build pass, GH Actions/Pages live

## Next
- [ ] Local persistence polish — history, watch progress, migrations
- [ ] Recommendation engine wiring

## Later
- [ ] VideoProvider + player (Phase 7)
- [ ] PWA offline shell tuning
- [ ] a11y + perf audits

## Phase 6 Verification
- Home uses real AniList: trending[0] banner, 4 sections real, hero fallback only on error
- Browse functional: 5 categories server-side, 4 filters, Load more, no mock, 1 request per filter change
- Search live: input → useAnimeSearch debounce, URL sync, no stale, retry
- Detail real: Media query, cleaned description, all fields
- My List: empty when unauth with CTA, auth shows combinedList tabs
- Tracking: status/rating/progress via aniListProvider, Continue Watching
- MAL parked: CORS limitation documented, no backend
- Loading/error/empty: RowSkeleton, retry, empty messages
- Caching: memory 5m + IDB 24h + inflight, Home 4 parallel, Browse 1 per change, second Home cached 0
- Responsive: 375/768/1440 no overflow, cards usable touch
- Build: tsc --noEmit pass, npm run build pass
