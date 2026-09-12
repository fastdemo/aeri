# DECISIONS — Aeri

## D001 — Static-only hosting
GitHub Pages, no backend, IDB/localStorage only.

## D002 — HashRouter
`HashRouter` to avoid 404 on Pages.

## D003 — Tailwind v4 via @tailwindcss/vite

## D004 — Mock-first visual prototype
Phase 2 mock.

## D005 — Single AnimeCard

## D006 — No carousel library

## D007 — Identity normalization

## D008 — Video provider deferred

## D009 — Base path env-aware

## D010 — AniList implicit grant
`response_type=token`, hash before HashRouter, `aeri:anilist:token`.

## D011 — Early hash parsing before HashRouter

## D012 — AniList mapper/status

## D013 — Caching memory 5m + IDB 24h + dedup

## D014 — AniList context optimistic

## D015 — No visual redesign Phase 3

## D016 — AnimeMetadataProvider (Phase 4)

## D017 — Home real discovery

## D018 — Search always real

## D019 — Browse real

## D020 — Detail/Watch real metadata + images lazy

## D021 — Mock as fallback only (Phase 4)

## D022 — MAL PKCE for static (Phase 5) [superseded by D051: PKCE method is now `plain`, token exchange via Worker `/api/mal/token` with server-side `MAL_CLIENT_SECRET`]
`code_verifier` random 96, `code_challenge` S256 SHA256 base64url, `state` 32, `GET https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id={VITE_MAL_CLIENT_ID}&code_challenge=S256&state`, redirect `origin+BASE_URL` (`/aeri/`), `POST https://myanimelist.net/v1/oauth2/token` (`client_id, code, code_verifier, grant_type=authorization_code`) via `fetch` (CORS, form urlencoded), `refresh_token` flow, tokens in `aeri:mal:*` via `storage/mal.ts`, no secret committed, `VITE_MAL_CLIENT_ID` env like AniList. Early search `?code` handling in `MALContext` + `main.tsx` not needed (search preserved). Manual paste fallback for dev.

## D023 — MAL client reuse cache (Phase 5)
`malFetch` reuses same memory 5m + IDB 24h + inflight dedup as `anilistGraphQL`, with `ensureFreshToken` auto-refresh 1min buffer, `clearMalTokens` on 401/403, friendly `MalProviderError`.

## D024 — MAL mapper/status (Phase 5)
`malStatusToAeri`/`aeriStatusToMal` (`watching/completed/on_hold/dropped/plan_to_watch` ↔ `watching/completed/planned/on_hold/dropped`), `mapMALNodeToAnime` (title `ja→romaji`, `en→english`, `mean` 0-10, `main_picture`, `genres/studios`), percent from `num_episodes_watched/num_episodes`, preserves `malId` for dedup.

## D025 — Dual-provider dedup via malId (Phase 5) [superseded by D052: single active tracker, no merged reads]
`TrackingContext:dedupAndMerge` keys by `mal-<malId>` if present else `anilist-<id>`, AniList first (richer banner), MAL second merges identity (`malId`/`anilistId`), picks max progress, keeps AniList status as primary. Prevents visually identical duplicates, no silent overwrite without explicit rule documented.

## D026 — Unified Tracking abstraction (Phase 5) [superseded by D052: writes go to the active tracker only, reads are the tracker's list]
`TrackingContext` wraps `AniListContext` + `MALContext`, exposes `isAuthenticated/isAniListAuthenticated/isMALAuthenticated/combinedList/loading/error/authExpired/updateProgress/updateStatus/updateRating` that fan-out to both providers where IDs exist (`updateProgress(anime, ep)` resolves `anilistId`/`malId` from `anime.identity`). UI (Home Continue Watching, MyList, DetailModal, EpisodeList, Watch) uses `useTracking` not direct provider, stays provider-agnostic, no dashboard.

## D027 — No visual redesign for MAL (Phase 5)
MyList stacks `AniListConnectCompact` + `MALConnectCompact` (compact `MAL` badge `#2e51a2`), Navbar shows first authenticated avatar (AniList preferred) with emerald dot, Home sync label `AniList • MAL` when both, My List shows `Merged • deduped by MAL ID`. Same near-black, landscape cards, quiet gradients.

## D028 — Browse as real AniList discovery (Phase 6)
`AnimeMetadataProvider.browse` with `Page(media(type:ANIME, isAdult:false, sort, status, genre, seasonYear, season, format))` + `pageInfo { hasNextPage }`, cache key `anilist:browse:sort:status:genre:year:season:format:perPage:page`, `useBrowse` manages `page` reset on filter change and `loadMore` append. `Browse.tsx` category tabs `Popular (POPULARITY_DESC)`, `Trending (TRENDING_DESC)`, `Airing (RELEASING)`, `Upcoming (NOT_YET_RELEASED)`, `Finished (FINISHED+END_DATE_DESC)` + filters `genre` (10), `seasonYear` (2020-2025), `season` (WINTER/SPRING/SUMMER/FALL), `format` (TV/MOVIE/OVA/SPECIAL) as server-side AniList filters, `perPage 24`, pagination, compact rounded `select`s, loading pulse grid, error retry, empty “No titles match”. No mock, no table.

## D029 — Search live while typing (Phase 6)
`Search.tsx` now uses `liveQuery = input.trim()` with `useAnimeSearch(liveQuery,12)` (debounced 300ms inside hook) + 400ms URL `replace` sync for deep link, `useEffect` sync for back navigation, `cancelled` + `clearTimeout` prevents stale, error shows retry button, `q` param initial from `searchParams`. No duplicate requests (inflight dedup).

## D030 — MyList empty when unauth (Phase 6)
`MyList.tsx` production no longer shows `mockAnime.filter(inList)` when unauthenticated; `sourceList` is `[]` when not `isAuthenticated`, `syncLabel` is `connect AniList to sync`, empty state is centered card with “Your list is empty” + CTA to connect. Mock remains in `src/data/mockAnime.ts` for tests/development only. Prevents fake discovery as normal path.

## D031 — MAL parked for Phase 6 (Phase 6)
Per `docs/MAL_BROWSER_FEASIBILITY.md`, MAL `api.myanimelist.net` and `myanimelist.net/v1/oauth2/token` send no `Access-Control-Allow-Origin` for `https://fastdemo.github.io` origin (Playwright `No CORS header` → `ERR_FAILED` → `Failed to fetch`), so static GH Pages SPA cannot complete auth or REST. No backend/proxy added. `VITE_MAL_CLIENT_ID` still injected, `hasClientId` logic intact, CORS-specific errors in `malFetch`/`exchangeMalCodeForToken` remain, but no new MAL work. AniList is primary for discovery/tracking.

## D032 — VideoProvider abstraction for static Pages (Phase 7)
`VideoProvider { resolveAnimeId, getEpisodes, getSources }` normalized to `VideoEpisode { number, provider, providerEpisodeId, language }` + `VideoSourceEnhanced { url, provider, quality, language, type, embed, subtitles[] }` + `ProviderCapabilities`, `base.ts cachedFetch` reuses `storage/db.ts` (memory 5m + IDB 24h + inflight, key `video:provider:…`), `registry.ts` priority `[allanime, animepahe, anikoto, megaplay, animeparadise, anineko, mock]` with `resolveEpisodesWithFallback`/`resolveSourcesWithFallback` isolated (one provider failing doesn't crash Watch, only selected episode fetched). `Watch.tsx` and `VideoPlayer.tsx` consume only the abstraction, not provider APIs.

## D033 — No backend/CORS proxy for video (Phase 7)
Investigated 2026-08-29 from `https://fastdemo.github.io` origin via Playwright: AnimePahe `https://animepahe.ru/api?m=search` → CORS `No Allow-Origin` `ERR_FAILED`; AniKoto `https://anikoto.to/api/search` → `ERR_NAME_NOT_RESOLVED`; MegaPlay `https://megaplay.buzz/api/search` → `200 CORS:*` but HTML `Error - MegaPlay` not JSON; AnimeParadise `https://www.animeparadise.moe/api/search` → CORS blocked; AllAnime `https://api.allanime.day/api` → `CORS: https://fastdemo.github.io` (allows origin) but requires exact GraphQL `SearchInput` schema + Cloudflare, still no browser video without proxy. No provider provides `Access-Control-Allow-Origin: *` for search+episodes+sources that yields playable `m3u8`/`mp4` or embed without proxy. Therefore all real providers are **browser-incompatible** on static GH Pages. Decision: do not add CORS proxies, Cloudflare Workers, Vercel functions, or third-party proxy APIs; keep `MockVideoProvider` for episode navigation and show no-source UI `Video unavailable` with `Tried:` and `Retry`. Documented in `src/providers/video/*.ts` headers and final provider report.

## D034 — Local watch position on static DB (Phase 7)
`storage/db.ts` `DB_VERSION 2` adds `watchPos` store `{id, episode, currentTime, duration, updatedAt}`, `putWatchPos`/`getWatchPos`/`clearWatchPos` reuse existing IDB wrapper. `Watch` `onTimeUpdate` throttled 5s via `putWatchPos`, `getWatchPos` on load shows `Resume from M:SS?` if `>30s && <90%` same episode, `onEnded` clears and calls `updateProgress`. No second storage, no video files, no interference with AniList `progress`.

## D035 — Watch remains Netflix-like with no-source state (Phase 7)
Watch keeps near-black `bg-black`, `aspect-video` `bg-[#0a0a0a]`, top gradient `← title`, bottom no-source card `Video unavailable` + `Try another episode or source` + `Tried: …` + `Retry`/`Episodes` + provider caps, `Episode` grid, `Source:` selector only if `sources.length>1`, `Resume` prompt as rounded `bg-black/80` at bottom. Navbar/Home/Browse/Search/MyList/Detail not redesigned, only Watch-related UI.

## D036 — Performance: shell immediate + parallel Home + timeouts (Phase 7.1)
Shell (Navbar) renders <100ms (85ms measured), Home 4 parallel `POST graphql.anilist.co` at 141ms (all at same time, not waterfall) via separate `useEffect` + `inflight` dedup, responses 840ms, hero 1.4s, cached Home 0 new (memory 5m + IDB 24h). `anilistGraphQL` now has `AbortController` 8000ms timeout (AniList p95 <1.5s, 8s allows slow nets, on abort throws `AniList is taking too long…` not freeze). Watch shell 29ms, title 873ms, episode list immediate from `anime` (876ms, not blocked by video provider), source no-source 2.3s (parallel 3.5s max, not 21s sequential). Documented per-task.

## D037 — Metadata accuracy: studios, age rating, episode titles/images (Phase 7.1)
`MEDIA_FIELDS` now `studios { edges { isMain } nodes { name isAnimationStudio } }` + `streamingEpisodes { title thumbnail url site }` + `isAdult`. Mapper filters studios to `isAnimationStudio` true (prefers `isMain`), not all nodes (producers). `isAdult` is boolean, NOT mapped to `T18`/`PG-13`; UI hides age rating when unavailable (removed hardcoded `T18` and `nudity, violence…` from Hero/DetailModal). Episode titles/thumbnails now from `anime.streamingEpisodes` real (AniList `MediaStreamingEpisode` e.g., Frieren `Episode 1 - The Journey's End` + Crunchyroll thumbnail) — if missing, shows `Episode N` without title and `EP 01` fallback div, not `Let You Down`/`picsum`. DetailModal `S1:E1 “Let You Down”` and `Cast: KENN…` and `This series is: Explosive…` removed; real `Genres`, `Studios`, `Format`, `Status`, `Year/Season` shown, `description` only `cleanDescription` without fake suffix.

## D038 — Remove all placeholder production content (Phase 7.1)
Repo-wide audit: `picsum` only in `src/data/mockAnime.ts` (test fixture, not in `EpisodeList`/`Hero`/`Watch` production UI), `T18`/`Let You Down`/`KENN`/`Explosive` removed from `Hero`/`DetailModal`/`EpisodeList`, `mockAnime` production imports removed from `Home` (hero fallback now error UI), `MyList` (now empty CTA), `Watch`/`AnimeDetail` (legacy `frieren` slug resolver removed, now shows not found, real `anilist-*` only). `heroAnime` import removed, `mockAnime` remains only as `src/data/mockAnime.ts` for tests. Production cannot silently fall back to fake anime on API failure (shows error/empty).

## D039 — Video provider fast failure (Phase 7.1)
`src/providers/video/base.ts` `VIDEO_PROVIDER_TIMEOUT_MS 3500` via `fetchWithTimeout` (`AbortController`), `registry.ts` changed from sequential `for await` (21s worst) to **parallel** `Promise.allSettled` with 4000ms registry timeout, so no-source resolves ~3.5s not tens of seconds. Watch shows `Finding episodes…`/`Finding video source…` with `Tried:` list, then distinct `Video unavailable` (no compatible source) vs `Couldn’t load video` (temporary), with `Retry`. Episode list is immediate from AniList, not blocked. No fake URLs, no backend/proxy.

## D040 — AniList Authorization Code via Worker (client 50024)
Client `50024` rejects implicit grant: `GET /api/v2/oauth/authorize?response_type=token` returns `400 unsupported_grant_type` (proven live twice, incl. retest after redirect-URI cleanup). Frontend now uses `response_type=code` + random `state` (`aeri:anilist:oauth_state`), redirect `origin + BASE_URL` (`https://aeri.fastdemo.workers.dev/`). `POST /api/anilist/token` on the Worker injects `ANILIST_CLIENT_SECRET` server-side and proxies `https://anilist.co/api/v2/oauth/token` (`grant_type=authorization_code`). Browser never calls the token endpoint directly and never holds the secret. Old implicit handling (`#access_token`, hash parsing in `main.tsx`) removed. Do NOT switch back without a fresh live proof.

## D041 — AniList blocks Cloudflare Worker IPs; standalone auth-proxy
All `anilist.co` requests from Worker egress return `403 "manually blocked"` (homepage, authorize, token endpoint — verified via `/api/debug/provider-test`), while the identical token request from a residential IP reaches the OAuth handler (`401 invalid_client` on bad secret). Direct browser exchange is impossible (secret required + no CORS headers). Therefore `auth-proxy/` (zero-dep Node, `POST /api/anilist/token` + `GET /health`, `Dockerfile`, `fly.toml`) runs on non-Cloudflare hosting with `ANILIST_CLIENT_SECRET`. Frontend prefers `customAuthApiUrl` (Settings → Account) then `VITE_AUTH_API_URL` (baked), then worker/same-origin (`getEffectiveAuthApiUrl`). Worker maps upstream 403 to structured `ANILIST_IP_BLOCKED` → friendly UI copy. Secret verified absent from bundles.

## D042 — AniList/MAL callback isolation via state match
Both providers use `?code=` + `?state=` on the same origin, so each context must ignore the other's callback: `AniListContext` skips exchange when URL state matches stored MAL state (but not AniList's); `MALContext` ignores codes whose state matches stored AniList state and stays silent when it has no verifier/state (previously its 600ms fallback deleted AniList codes from the URL and showed bogus "verifier missing"). Fixed after live repro (Settings showed both errors stacked).

## D043 — Browse grid fills complete rows at every viewport
Fixed `perPage: 24` left ragged last rows (24 ≢ 0 mod 5 at `lg`). `useGridColumns()` mirrors the grid breakpoints (2/3/4/5/6) and `perPage = cols × 5` (10/15/20/25/30, ≤ AniList max 50), so every fetch (incl. Load-more appends) renders whole rows. Skeletons render `perPage` slots. Verified via Playwright computed grid columns at 1440/1100/390.

## D044 — Search suggestions open DetailModal, never navigate
Navbar `SearchSuggestions` picks previously navigated to `/anime/:id` (full page). Now selection lifts to `Navbar.previewAnime` and renders the same `DetailModal` as Home/Browse; route changes close it. Fixed latent submit bug: option buttons lacked `type="button"` inside the search `<form>`, so clicks submitted the form to `/search` (this also raced the old navigation). `/anime/:id` route kept for deep links.

## D045 — Episode count estimate for unknown totals (One Piece)
AniList reports `episodes: null` for ongoing long-runners and `streamingEpisodes` covers only a slice, so lists truncated to ~10. `estimateAiredEpisodeCount()` prefers `nextAiringEpisode.episode - 1`, then max aired `airingSchedule` episode, then streaming length; `resolveEpisodeCount` takes the max signal when no authoritative count (One Piece: 1176, verified live in modal). Streaming titles kept only when their numbers fit the estimate (else discarded as before). `DetailModal` next-episode line now reads from the normalized episode map instead of raw `streamingEpisodes[i]`, fixing mislabeled S1:E1 titles.

## D046 — Settings copy simplified, features kept
Settings text trimmed of endpoint URLs, env var names, storage internals, and version/provider details. All controls kept (accounts, auth/video custom endpoints + Test, playback, providers, data/cache, about). Footer "No backend" removed (Worker + auth-proxy exist).

## D047 — Browse fixed preload with local slicing + shuffle (supersedes D043)
D043's `perPage = cols x 5` refetched on every resize (annoying reload flash). Now: fixed `PAGE_SIZE = 30` fetch (theoretical max: 6 cols x 5 rows), `useGridColumns()` only slices locally to complete rows (`slice(0, len - len % cols)`), so resize re-slices with zero requests (verified: no new GraphQL on 1440→900). Page-1 results shuffle once per filter signature (ref keyed on signature + head ids, so Load-more appends keep order and filter changes reshuffle). Skeletons render `cols x 5`. Verified full rows at 6/5/4/2 cols via computed grid styles.

## D048 — ContentRow header + exact one-card arrows
Row subtitles ("Under 12 episodes") now sit right-aligned on the header line at the same 14px size as the title, keeping muted color; dead hover-hint span removed. Arrow buttons scroll exactly one card (`firstChild.width + gap`, quantized to the card grid) instead of fixed 320px, so rows never end misaligned — verified scrollLeft delta 244 = 236 + 8 after one click. Desktop-only arrows unchanged.

## D049 — MAL works via Worker; client ID must be baked at build time
MAL login was failing with "Client ID not configured" on production because local `wrangler deploy` builds used a `.env` without `VITE_MAL_CLIENT_ID` (CI sets it, local did not). The Worker proxy itself reaches MAL fine (fake-code probe returns MAL's own `401 invalid_client`, no IP block unlike AniList). Verified live: Connect MAL → `myanimelist.net/.../dialog/authorization` (accepted params, login prompt — no `invalid_client`/`redirect_uri` rejection), PKCE verifier (96ch) + state (32ch) persisted for the callback. Fix: `.env` + `.env.example` carry the public IDs; lesson recorded — after every local deploy, grep the live bundle for the baked IDs.

## D050 — Per-account sync toggles + MAL dead-code cleanup
Settings → Account shows Sync toggles (Status / Episodes watched / Score) under each connected account (both APIs support all three). Stored in `prefs.sync`, default all-on (previous fan-out behavior); `TrackingContext` skips mutations per provider+field via `isSyncEnabled` (reads stay merged). Separately, MAL `invalid_grant/invalid_client` (dead/used/expired code — the exact upstream shape verified live) now clears URL + verifier/state and throws "login attempt expired, Connect again" instead of retrying the dead code forever.

## D051 — MAL PKCE must be `plain`, not S256
MAL docs state twice that only the `plain` method is supported. Our S256 flow was proven broken live: approval renders, but every token exchange fails `invalid_grant` / "Failed to verify `code_verifier`" (challenge↔verifier binding itself was byte-exact — the method was the problem). `buildMalAuthorizeUrl` now sends `code_challenge = verifier` with `code_challenge_method=plain`. Never switch back without a successful live token exchange as proof.

## D052 — Single active tracker; AniList-only metadata backbone
Both accounts may stay connected, but exactly one is the active tracker (`prefs.trackingProvider`, auto AniList-first): `TrackingContext` reads/writes that account only — no merged reads, no fan-out writes, so the services can never contradict on screen or diverge silently. Sign-in (Navbar modal, Settings) offers both providers with a "Track with" single-select switchable anytime. MAL tracker entries are upgraded to AniList display metadata via `Media(idMal:)` (`anilist:bymal:*` cache; unmatched keep MAL fallbacks); `getAnime` resolves `mal-*` ids the same way, fixing MAL detail deep-links. Discovery/search/detail never touch MAL. This supersedes the D025/D026 merged-dedup + fan-out design (kept per-field sync toggles now gate the active tracker).

## D053 — Sign-in polish, actionable AniList errors, paced MAL enrichment
Sign-in modal: both CTAs are white "Connect" pills with real inline brand marks (Simple Icons paths, CC0 — external <img> SVGs can't inherit CSS color, so they rendered black). AniList token exchange distinguishes three outcomes: login server unreachable from the browser (ad-blocker/Brave Shields), build missing `VITE_AUTH_API_URL` (only ever talked to the blocked Worker — a deploy misconfiguration, proven live 2026-09-06 when the bundle lacked the fly URL), and genuine AniList outages. MAL→AniList enrichment is rate-limit-safe: in-progress/watching first (burst ≤40), then a ~80 req/min paced drip; display labels (`formatLabel`/`statusLabel`) guarantee no raw MAL strings (`tv`, `currently_airing`, `of 0`) anywhere even for unmatched entries. Settings account cards are themselves the tracker radio (no separate picker block); disconnecting the last account resets the tracker pick and returns Home.

## D054 — Post-auth returns to the sign-in popup; verify scripts run automatically
OAuth start stashes `sessionStorage aeri:signin:oauth`; on return the navbar reopens the popup (connected state + connect-the-other + tracker pick + Continue), success or failure. Navbar avatar + fallback letter follow the active tracker. Settings cards are the tracker radio (selected = `border-white`, no TRACKING text). Disconnecting the last account resets the tracker pick and returns Home. Release automation: `npm run verify:build` (fails when baked IDs are missing — wired into CI after `npm run build`) and `npm run verify:live` (bundle + endpoint probes, referenced by RELEASING.md step 4).

## D055 — Anime page, de-overlapped player, label normalization
Browse renamed to Anime (label only — route stays `/browse` since `/anime/:id` is taken). Infinite scroll via sentinel + IntersectionObserver (re-subscribes on loading/page so stale closures can't skip pages; `loadMore` still guards). Filters widened (18 genres, years 2026→2000 + '90s + '80s & earlier via new `startDate_greaterThan/lesserThan` range plumbing, ONA/Music formats). Season selects use the filter-style SVG chevron (`appearance-none`, no more native-arrow + glyph overlap). Player keeps native controls + hls.js (no new deps): in-player source selects, timestamp chip removed (a selector already lives below the player), errors moved top-center, resume prompt top-center. Format/status labels normalized everywhere (`tv`→TV, `currently_airing`→Airing). Row titles truncate so subtitles stay flush right; navbar avatar sits on black for transparent pfps.

## D056 — Search relevance, stable feed, recency sort, agent autonomy
Search page lost its duplicate bar (navbar owns search; page is URL-driven). Results re-ranked conservatively (exact → prefix → substring → genre/studio → rest, popularity tiebreak) with a parallel genre-browse boost when the query names a genre (`lib/genres.ts` now the single genre source for filters + search). Home self-refresh fixed: all `shuffle`/`Math.random` in render memos replaced by per-mount stable ordering (same data = same order all session; fresh shuffle each full load) — background tracking/enrichment updates no longer reshuffle rows. Every home row has a right header (Trending Now shows the live season, e.g. Summer 2026). My List sorts by last activity (`updatedAt` now plumbed from AniList `MediaList.updatedAt` + MAL `list_status.updated_at`). Continue Watching is strict `watching` with no cap; home My List row uncapped. AGENTS.md §17: agents ship end-to-end and never route work to the non-technical owner.

## D057 — Continue card actions, 80% completion, unified motion language
Continue cards: centered play affordance with hover scale, progress bar flush to the thumbnail's bottom edge (5px, white on #333333, red removed), metadata as `S1:E1 • Title` in #FFFFFF/#A0A0A0, and a hover/touch ⋮ menu (Mark as watched → completed; Remove → on hold, non-destructive). Episode counts as complete at ≥80% watched (was 92%). Motion: three keyframes only (fade/pop/slide, ≤200ms, transform+opacity), entrance classes on sign-in + detail modals, mobile drawer, and dropdowns; card image fade-in via onLoad class (no re-render); existing reduced-motion guard covers everything; GPU-heavy backdrop-blur removed from player loading states. No new animation deps. DESIGN_SYSTEM.md gains a Copy Voice section (never all-caps).

## D058 — Card/menu/modal refinements, scroll-aware arrows, frosted suggestions
Continue bar now 3px white with soft glow; play affordance shrunk to a quiet dark chip; ⋮ is chromeless with drop shadow and a compact menu. DetailModal renders one panel always (the group-loading skeleton panel caused the double open animation) and its progress bar matches the card (white glow); top scrim runs diagonally from top-left for title contrast. Row arrows are scroll-aware (left hidden at start, right hidden at end — the "always visible" right arrow). My List Connected shows the active tracker only. Search suggestions use frosted `bg-black/70 backdrop-blur-2xl`.

## D059 — Arrow visibility truth, per-tracker scores, no modal rate button
Row/hero arrows: the stuck-visible right arrow was `focus:opacity-100` persisting after click (now `focus-visible`) plus the hero next arrow never having hover gating at all. Arrows co-reveal on row hover; navbar avatar dot removed entirely. Continue bars now 2px with glow; play chip shrunk again; ⋮ up to 24px chromeless; hover title overlay removed from continue cards. Scores follow the tracker (MAL mean preserved through enrichment instead of overwritten by AniList average). Season selectors show `Season N` only (no outside label/counters). Preview-card star rating UI removed (button + picker; score readout kept).

## D060 — Tracker-truthful progress, season-1 default, scroll restoration
Tracking truth lives in one rule: backbone is always AniList, only the score (and status/progress values) come from the tracker. Modal resolves its entry from the opened anime OR the displayed season (per-season ids meant S2 progress was invisible from S1), shows Resume/Play/bar only when an episode was actually watched (untouched entries carry episode 0), and completed entries always render a full bar. Detail opens show Season 1 (no auto-jump), and remount per anime via `key` so stale series state can't leak foreign episodes across titles. Route changes scroll to top (pathname-only, so search typing never jumps). My List sorts by last activity (`updatedAt` from both providers). Footer is a cropped oversized watermark. Mobile suggestion taps fixed (outside-pointerdown handler now knows the mobile container). Search header restyled.

## D061 — Per-season progress truth, slim footer
Cross-season number leakage removed: the modal shows progress/resume/bar ONLY from the displayed season's own entry (S2 view can no longer show S1's "26 of 7"); status still falls back across the franchise. Group seasons carry both ids (relations query already fetched `idMal`), so per-season matching works for both trackers. Footer replaced with a 40px utility bar (wordmark + tagline | © | GitHub, Privacy, Status→health endpoint) instead of the watermark.

## D062 — Real-streaming investigation: resolution solved, playback IP-gated
Researched Mangayomi extension sources directly (hianime/anikoto providers, vidnest/shirayuki resolver APIs, anilix Go AllAnime client, ani-cli persisted queries, MiruroAPI pipe docs). Ecosystem pattern: parallel chains of JSON resolver APIs with fallbacks; native-only advantages (no CORS, custom Referer, residential IPs) don't transfer. Implemented one full provider through Aeri's existing abstraction (no infra replaced): AniKoto `filter→data-tip→ani_id verify→episodes→embed data-id→getSourcesNew→HLS+VTT`, signed URLs never cached, VTT via allowlisted `/proxy`. Verified live: Bebop 26/Naruto 220/AoT 25/Frieren 28 episodes with real titles; HLS+subs for multiple episodes sub+dub. **Not declared complete:** every discovered CDN 403-challenges worker + test-network IPs (megaplay embeds also error), so no cell reaches playback from verifiable networks. Other providers eliminated with evidence (Pahe CF-challenge, Miruro hard-blocks CF Workers, HiAnime 521/flaky, Shirayuki down, AllAnime `AA_CRYPTO_MISSING`). Option B (clean-IP resolver host) defined, unbuilt — needs owner-provisioned hosting. Owner acceptance: set Preferred source AniKoto on an unflagged network; success = episode plays, anything else = existing no-source UI.

## D063 — AniWave playback works end-to-end (2026-09-07)
AniWave (`aniwaves.ru`, no crypto on any step: filter → episode list → servers → embed extract for echovideo HLS / dood MP4) implemented in the Fly resolver + thin worker/frontend providers through the existing abstraction. Verified in Aeri's unmodified player: Bebop E1 (10+ min continuous, episode frames screenshotted), Bebop E2 switch, Frieren E1 on mobile 375 — all readyState 4 with advancing currentTime. Watch-position persistence and resume path intact; subtitle `<track>` plumbing proven via resolver-signed VTT (echovideo itself is hardsubbed). Also fixed along the way: episode-scoped resume seek, backpressure-safe proxy streaming (no more short-body protocol errors), `prebuild` env gate, `.dev.vars` gitignore. Demo can never mask real failures (worker auto-fallback excludes it).

## D064 — Fly org trial ended: both Fly apps unreachable (2026-09-07)
`flyctl machines list -a aeri-stream` → `Error: failed to list VMs: trial has ended, please add a credit card by visiting https://fly.io/trial`. Both `https://aeri-stream.fly.dev/health` (playback resolver) and `https://graceful-dream-569.fly.dev/` (auth-proxy, login) fail with connection-closed from two independent networks (agent shell + test browser), while Cloudflare worker + frontend stay healthy. Blast radius: video playback (resolver down → worker falls back to poisoned anikoto/MegaPlay) and AniList/MAL login (auth-proxy down). Code is green (both CI workflows success on 5be23c2); no code fix possible — owner action required: add a payment method to the Fly org, then agent restarts machines (`flyctl machines start`) and re-runs acceptance. Verified 2026-09-07 ~15:50Z; resolver was serving traffic at 15:21Z the same day.

## D065 — Stream resolver merged into the Cloudflare Worker; Fly retired (2026-09-10)
The resolver comment claimed "video CDNs hard-block Cloudflare Worker egress IPs" — live probes (2026-09-10, from the production worker itself via `/api/debug/provider-test`) disproved it for the current pipeline: aniwaves.ru filter/ajax, anikotoapi.site series JSON, and megaplay getSourcesNew all return REAL data from CF edge (AniList itself still 403s CF — auth stays off-Cloudflare, see D066). So `stream-resolver/server.js` was ported 1:1 to `worker/src/resolver.ts` (fetch-handler, SubtleCrypto HMAC, DoH-based private-IP guard fail-closed, streaming relay with playlist rewrite) and `AnikotoProvider`/`AniwaveProvider` now call it in-process — no HTTP hop, no bearer secret on the wire, no RESOLVER_URL config. Signed delivery (`/api/stream`) is same-origin. Two real allowlist gaps found test-driven via `mint-reject-host` logging (parallel-race winners vary per resolve): `px.roburnt10.store` → generalized roburn regex; `px.dpopdrop89.store` → generalized dpopdrop regex. A 403-segment scare was my own truncated test URL, and an echovideo-404 scare was stale embed IDs from slow manual probing (fresh IDs → 200 + file). Verified on preview worker then production: diag ok, Bebop E1/E2 + Frieren resolve, playlist rewrite, real MPEG-TS bytes (`47 40`), VTT subtitles with real lines, Range parity with CDN behavior. `stream-resolver/` + fly.toml retained as reference only (see RETIRED.md). Fly services no longer required for playback.

## D066 — Auth-proxy → Deno Deploy, no credit card (2026-09-10, pending owner click)
AniList still 403-blocks CF edge (re-probed 2026-09-10: dummy code → ANILIST_IP_BLOCKED), so the token exchange must stay off-Cloudflare. Replacement: `auth-proxy/deno.ts` (same contract as server.js, zero-dep fetch handler, `deno check` + locally served + exercised: /health ok, INVALID code → AniList's own `invalid_client`, no secret in responses). Target is Deno Deploy free tier: no card, non-CF egress, ms-scale wake (inside the frontend's 8s budget — Render-style sleepers would blow it). Owner step (dashboard only, no CLI): dash.deno.com signup → New Project → link Aeri repo → entrypoint `auth-proxy/deno.ts` → env ANILIST_CLIENT_SECRET (from keychain) → paste project URL back. Then agent bakes VITE_AUTH_API_URL to it and verifies `invalid_grant` (not blocked). Docker `server.js` + Dockerfile kept as fallback for any Docker host. MAL login already flows through the CF worker and never needed Fly.

## D067 — Slow streaming is upstream CDN throughput, not worker buffering (2026-09-12)
Measured production, not guessed: cold resolve 4.1s → ~1s warm; playlist fetch 2.2s (upstream-bound); 576KB segment 11.1s via worker at ~50KB/s with TTFB 1.9s; the SAME bytes direct sandbox→CDN (`hlsxst2.echovideo.to`) take 8.4s at ~68KB/s, byte-identical. Worker cost per 11s segment relay: **45ms CPU (0.4% of wall)** via `wrangler tail` — the `/api/stream` path genuinely streams (`ReadableStream` relay after a 16KB sniff; only playlists/VTT buffer, capped 5MB). Bottleneck = per-connection CDN egress speed to these regions (suspected throttling; direct fetch is equally slow), plus one extra network leg through the worker (~25% wall). Nothing in our code buffers video. Hardening only: stream timeout 60s→120s (slow segments near the cap 502'd). No new proxy added.

Latency fix in the same area: the worker used to cascade through ALL providers (~12s each) even when the caller pinned `?provider=X`, while the frontend runs its own fallback chain with 9s budgets — a miss burned a minute worker-side after the caller gave up (double fallback). Now a pinned provider is tried alone and fails fast (stub miss 1.9s); unpinned requests keep the cascade. Frontend behavior unchanged-or-faster.

## D068 — Provider title matching: verified identity, fail closed (2026-09-12)
Root cause of wrong-show results: `awFindAnime` scored ONLY the provider display name against usually-romaji-only input, and when every candidate scored 0 it fell back to the UNFILTERED top-3, accepting the first entry with any episode list. Episode-list presence is not identity: e.g. a "Cowboy Bebop: Tengoku no Tobira" (movie) request scored 0/0 and played S1; an AoT Season 3 request would play S1. Fix (worker + frontend): parse `data-jp` (romaji), episode total, and release type from filter cards; score display+jp against romaji+english+native (exact 100 / prefix 60 / substring 40 / token-Jaccard ×50); hard pre-filters (count ≥ requested episode, movie↔TV conflict); threshold ≥40 (below → 'no confident match'); count-proximity tie-break; exact ties → 'ambiguous match'. AniKoto keeps ani_id verification plus a new ±1 year check (both resolver and direct paths). Requested episode beyond the provider list fails closed ('not listed'). Responses now carry `providerAnimeId`/`providerTitle`; `verify-live.mjs` asserts all four mapping cases post-deploy. Verified on preview: Bebop→80163, AoT S1→74865, Frieren→74575, Naruto→76396, AoT S3→74861 (not S1), Bebop movie→80164 (not S1), ep99/garbage→0 sources. Year is NOT available on aniwaves cards (documented gap; title+count+type carry the verification there).

## D069 — AniList login still needs one owner backend; implicit grant unsuitable (2026-09-12)
Exactly one AniList request fails from Cloudflare: `POST anilist.co/api/v2/oauth/token` (the authorization-code exchange AND refresh share it) → 403 "manually blocked" (re-probed; worker maps it to ANILIST_IP_BLOCKED). Authorization (user's browser), callback (same-origin read), and GraphQL (browser-side, CORS-open) need no backend. Implicit grant IS documented by AniList but this client (50024) rejects it (`unsupported_grant_type`, proven live twice; re-probing needs a logged-in session, i.e. owner hands). Even if enabled, implicit is the deprecated flow (removed from OAuth 2.1) and returns tokens in URL fragments — Authorization Code + server-side secret is the correct architecture, so the backend is unavoidable by design, not by accident. Clarification: Deno is ONE owner deployment (`auth-proxy/deno.ts`, written + locally verified: /health ok, INVALID code → AniList's own `invalid_client`, no secret leakage) whose URL is baked as VITE_AUTH_API_URL — normal users never create accounts, deploy, or configure anything. MAL login already flows through the worker and never needed Fly/Deno.

## D070 — Deno auth verified live; Aeri pointed at it (2026-09-14)
The deployed Deno app initially served the repo's static index.html (dashboard entrypoint ambiguity). Fixed repo-side with root `deno.json` (`deploy.runtime: {type dynamic, entrypoint ./auth-proxy/deno.ts}`), which overrides dashboard settings — the next push redeployed the handler. Verified with real requests, not the badge: `/health` → healthy + secretConfigured:true; `POST /api/anilist/token` with an invalid code → AniList's OWN `invalid_request` ("Cannot decrypt the authorization code"), proving secret injection + non-blocked egress + CORS for the production origin; alias path identical. Aeri config (both workflows, .env.example, docs, verify-live gate) switched from dead Fly to `https://aeri.fastdemo.deno.net`. Full OAuth completion still needs a real user login (untestable headlessly), but every machine-verifiable step passes. Secret audit: no secret values in src/worker/bundles (only error-string names); VITE_ vars carry only public IDs/URLs.
