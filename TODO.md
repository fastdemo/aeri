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

## Now
- [x] Performance: shell 85ms, Home 4 parallel at 141ms, hero 1.4s, Watch shell 29ms + episode list 876ms immediate + no-source 2.3s (was 21s), anilistGraphQL 8s Abort, video fetchWithTimeout 3.5s + parallel registry 4s
- [x] Metadata accuracy: studios filtered isAnimationStudio/isMain, isAdult not T18, streamingEpisodes real titles/thumbnails via MEDIA_FIELDS, mapper corrected, UI labels accurate (Studios not Producers, no fake T18/nudity/cast/This series is/Let You Down)
- [x] Remove placeholders: picsum only in mockAnime.ts fixture, T18/Let You Down/KENN/Explosive removed, EpisodeList real titles or Episode N without title + EP fallback div, DetailModal/Hero no fake, Watch/AnimeDetail legacy frieren mock resolver removed, Home hero no mock fallback (shows error), MyList empty when unauth, no production fake anime on API failure
- [x] Video fast: fetchWithTimeout 3500ms + parallel registry (was sequential), Watch episode list immediate from anime (not blocked), source discovery parallel 4s max, transparent states (Finding/No compatible source/Temporary), Retry, no fake URLs
- [x] Tests: Playwright Home/Browse/Search/Detail/Watch at 1440/768/375, no overflow, no fake, tsc/build pass, GH Actions/Pages live

## Next
- [ ] Recommendation engine wiring (Phase 8 — not started)

## Later
- [ ] PWA offline shell tuning
- [ ] a11y + perf audits

## Phase 7 Video (static, no backend) — Parked as no-source (Phase 7)
- [x] VideoProvider abstraction (types `VideoEpisode`/`VideoSourceEnhanced`/`SubtitleTrack`/`ProviderCapabilities`, base cachedFetch, registry fallback)
- [x] 6 providers investigated (AllAnime CORS but query exact, AnimePahe CORS blocked, AniKoto DNS fail, MegaPlay 200 HTML Error, AnimeParadise CORS blocked, AniNeko no stable API) + Mock (episode list)
- [x] Watch uses registry (resolveEpisodesWithFallback, resolveSourcesWithFallback only selected episode, isolated)
- [x] Player VideoPlayer (embed iframe vs direct video, controls, subtitles, loading, error, source switch)
- [x] No-source UI (Video unavailable + Tried + Retry) not blank, no fake URLs in production
- [x] Sub/dub where available (capabilities), subtitles where available
- [x] AniList progress still via TrackingContext (isolated), Watch → TrackingContext not VideoProvider → AniList
- [x] Local watch position DB v2 watchPos (put/get/clear, throttled 5s, resume prompt, completion >92% → progress, Ended clears)
- [x] Episode navigation (prev/next/arbitrary, EpisodeList preserved, routing)
- [x] Caching reuse (video:… keys, memory+IDB+inflight, only selected source)
- [x] Performance (1 episodes list + 1 source per Watch, no waterfall)
- [x] Security: no secrets in VITE_*, no backend/proxy/CORS bypass/DRM bypass
- [x] Responsive 375/768/1440 no overflow, aspect-video, controls usable
- [x] Build pass, GH Actions/Pages live, docs updated, provider report

## Phase 7.1 Fixes (Performance, Metadata, Placeholders, Video Fast)
- Home: parallel 4, shell 85ms, hero error not mock
- Browse: 5 categories + filters, Load more, no mock
- Search: live typing, no stale, retry
- Detail: real studios (isAnimationStudio), no T18/cast/fake series is, description clean, streamingEpisodes
- EpisodeList: real titles/thumbnails from streamingEpisodes, no picsum, EP fallback, no Let You Down
- Watch: immediate episode list, parallel video 4s, no freeze
- Video: 3500ms timeout + parallel, ~2.3s to no-source
- Build: tsc --noEmit pass, npm run build pass

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
