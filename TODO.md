# TODO — Aeri

## Now (Phases 1–8 done)
- [x] AGENTS.md + docs + skills (Phase 1)
- [x] Vite/React/TS/Tailwind + HashRouter + GH Pages config
- [x] Visual prototype on mock data
- [x] Playwright verification at 1440/768/375 + deep-link
- [x] AniList integration (Phase 3)
- [x] Real Anime Discovery & Metadata (Phase 4)
- [x] MyAnimeList integration (Phase 5) — PKCE, MALProvider, mapper, MALContext + TrackingContext merged dedup via malId, MyList/Home/Detail/Watch/EpisodeList/Navbar compact, verified via Playwright (Home/Browse/Search/Detail/Watch, unauth/MAL/AniList/both, loading/empty/API failure/mobile), build passing
- [x] MAL CORS diagnosis + feasibility (Parked) — redirect_uri fix, CORS-specific errors, docs/MAL_BROWSER_FEASIBILITY.md, GH Pages build with VITE_MAL_CLIENT_ID, Pages live
- [x] Complete AniList Discovery & Core Experience (Phase 6) — Hero real, Trending/Popular/Airing/New real, Browse tabs (Popular/Trending/Airing/Upcoming/Finished) + genre/year/season/format filters + pagination (useBrowse), Search live while typing (debounced, stale-ignore, URL sync), Detail real, MyList empty when unauth (no mock), Episode/Watch progress via TrackingContext, loading/error/empty for all, caching 4 parallel Home + Browse perPage 24 + dedup, mobile 375/768/1440 no overflow, a11y, no mock discovery, tsc/build pass, GH Actions/Pages live
- [x] Performance: shell 85ms, Home 4 parallel at 141ms, hero 1.4s, Watch shell 29ms + episode list 876ms immediate + no-source 2.3s (was 21s), anilistGraphQL 8s Abort, video fetchWithTimeout 3.5s + parallel registry 4s — Phase 7.1
- [x] Metadata accuracy: studios filtered isAnimationStudio/isMain, isAdult not T18, streamingEpisodes real titles/thumbnails via MEDIA_FIELDS, mapper corrected, UI labels accurate — Phase 7.1
- [x] Remove placeholders: picsum only in mockAnime.ts fixture, T18/Let You Down/KENN/Explosive removed, EpisodeList real titles or Episode N without title + EP fallback div, DetailModal/Hero no fake, Watch/AnimeDetail legacy frieren mock resolver removed, Home hero no mock fallback (shows error), MyList empty when unauth, no production fake anime on API failure — Phase 7.1
- [x] Video fast: fetchWithTimeout 3500ms + parallel registry (was sequential), Watch episode list immediate from anime (not blocked), source discovery parallel 4s max, transparent states (Finding/No compatible source/Temporary), Retry, no fake URLs — Phase 7.1
- [x] Series grouping: AnimeSeriesGroup via relations PREQUEL/SEQUEL TV only, conservative, DetailModal + AnimeDetail Season 1 ▼ with ordered seasons, each retains anilistId, movies/OVAs/spin-offs not merged — Phase 8
- [x] Top 10 removed: 0 in production (was 54), no ranking badges — Phase 8
- [x] Episode completeness: Media.episodes authoritative, streamingEpisodes enriches, 28→28 not 12, 24 caps 100, movies not blindly 12, no fake titles/thumbnails — Phase 8
- [x] AERI removed: red AERI badge gone, titles repositioned cleanly — Phase 8
- [x] Settings: /settings with Account (AniList/MAL moved from My List), Playback (autoplay/subtitles/volume), Appearance (reduced motion), Data (clear cache/watchPos/reset), About (version/providers/storage), centralized preferences.ts, persists reload, no tokens exposed — Phase 8
- [x] Video embed: API vs embed separately tested via Playwright from https://fastdemo.github.io origin, X-Frame-Options/CSP checked, no playable source without backend, documented — Phase 8
- [x] Tests: Playwright 1440/768/375 for all above, tsc/build pass, GH Actions/Pages live — Phase 7.1 + 8
- [x] Phases 9–13: Episode data integrity (One Piece offset guard, season-aware mapping, cache fixes), Worker architecture (Cloudflare Worker serves frontend + `/api` at same origin, `worker/src/index.ts` + `worker/src/providers.ts` normalized sources), MAL first-class via Worker proxy (`/mal/token`, `/mal/api/*`), real streaming providers (Official Trailer honest YouTube per-anime, Custom endpoint, AniKoto + AnimePahe via Worker), dynamic home feed (Because You Watched weighted random + shuffled rows), navigation reliability + episode integrity — verified, build passing, Pages + Worker live

## Next
- [x] Recommendation engine: scoring now genre-overlap primary (50×overlap + rating + log(popularity) + recency), filters zero-overlap, Home uses `getRecommendations` for Top Picks + Because You Watched with shuffle sampling — wired and varied per refresh
- [x] AniList Authorization Code via Worker/auth-proxy (client 50024; implicit proven dead twice), MAL/AniList callback isolation, ANILIST_CLIENT_SECRET server-side only, auth-proxy standalone + Settings endpoint + VITE_AUTH_API_URL, friendly IP-block error — verified live (Viewer/list pending real user approval)
- [x] Browse fills complete rows at every viewport (perPage = columns × 5), search suggestions open DetailModal popup (no /anime navigation, type=button fix), episode estimate for unknown totals (One Piece 1176 + kept in-range titles, modal line from normalized map), Settings copy simplified — verified via Playwright (1440/1100/390, modal, episodes, settings)
- [ ] Tune recommendation diversity (collaborative/embedding) when more history signals available

## Later
- [ ] PWA offline shell tuning
- [ ] a11y + perf audits (Lighthouse >90)

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
