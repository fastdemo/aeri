# TODO — Aeri

## Now
- [x] AGENTS.md + docs + skills (Phase 1)
- [x] Vite/React/TS/Tailwind + HashRouter + GH Pages config
- [x] Visual prototype on mock data
- [x] Playwright verification at 1440/768/375 + deep-link
- [x] AniList integration (Phase 3)
- [x] Real Anime Discovery & Metadata (Phase 4)
- [x] MyAnimeList integration (Phase 5) — PKCE, MALProvider, mapper, MALContext + TrackingContext merged dedup via malId, MyList/Home/Detail/Watch/EpisodeList/Navbar compact, verified via Playwright (Home/Browse/Search/Detail/Watch, unauth/MAL/AniList/both, loading/empty/API failure/mobile), build passing

## Next
- [ ] Local persistence polish (Phase 6) — history, watch progress, migrations
- [ ] Recommendation engine wiring (Phase 6)

## Later
- [ ] VideoProvider + player (Phase 7)
- [ ] PWA offline shell tuning
- [ ] a11y + perf audits

## Phase 5 Verification
- Unauthenticated Home/Browse/Search/Detail/Watch still behave (public AniList metadata)
- MAL auth PKCE mocked: login → user → My List
- MAL tracking: status/rating/watch progress via mal-xxx
- AniList still works (regression)
- Dual provider dedup to 1 when same malId (52991)
- Screenshots Home/Browse/Search/MyList/Detail/Watch + mobile, no Netflix-like regression
