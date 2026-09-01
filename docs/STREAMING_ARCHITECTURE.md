# Streaming Architecture Research — Aeri

> Status: Research and planning only. No playback implementation in this commit beyond existing `VideoProvider` abstraction + `VITE_VIDEO_API_URL` hook. No scraping, no DRM bypass.

## Summary

Aeri is a **static GitHub Pages SPA** (Vite + HashRouter, no backend). Browser playback is constrained by:

* **CORS** — most anime search/episode/source APIs do not send `Access-Control-Allow-Origin` for `https://fastdemo.github.io`.
* **Embed restrictions** — `X-Frame-Options` / `CSP frame-ancestors` blocks iframe embeds from unauthorized origins.
* **No secrets in client** — `VITE_*` is public at build time; no token refresh without server.

Existing Aeri already has the right abstraction to support future playback without coupling UI to a provider:

```
VideoProvider (interface)
  getEpisodes(anime) -> VideoEpisode[]
  getSources(episode) -> VideoSourceEnhanced[]
                 ↕
        Registry + base.ts (cachedFetch with IDB + timeout + parallel fallback)
                 ↕
        Watch.tsx + VideoPlayer.tsx (never knows provider impl)
```

`src/storage/preferences.ts:customVideoApiUrl` + `VITE_VIDEO_API_URL` already allow a self-hosted backend to be injected without rebuild: `GET /health`, `GET /episodes/:id`, `GET /sources/:id?language=`. The player prefers `preferredProvider` / `preferredAudio` / `preferredQuality` from `preferences`.

The goal below is to list **viable, maintainable, legitimate** architectures that fit this model.

---

## 1. Constraints that eliminate whole classes of approaches

* **Static only, no server sessions** (`AGENTS.md:1`). So any architecture requiring server-side session cookies, DB, or secrets must be opt-in external (worker, not built into GH Pages).
* **HashRouter + base `/aeri/`** — deep links must not 404. Any embed must allow `https://fastdemo.github.io` as ancestor.
* **Legal** — no scraping of pirate indexes, no bypass of paywalls/ads/DRM, no proxy that launders unauthorized sources. If a source does not explicitly allow browser embedding, it is not viable.
* **Maintainability** — provider HTML structure changes frequently. Browser-scraped providers (AllAnime, AnimePahe, Anikoto, etc.) were investigated in Phase 7 and all failed `PLAYBACK_MATRIX.md` T0–T3 (CORS or HTML error). Any architecture depending on fragile DOM scraping is not maintainable.

---

## 2. Viable architectures (ranked)

### A. Official licensed embeds — most legitimate, lowest maintenance

**How:** Use official embeddable players from licensed distributors that explicitly allow embedding:

* Crunchyroll / HIDIVE / ADN / YouTube (official channels) provide iframe embeds with `allow="autoplay; fullscreen"` and permissive `frame-ancestors`.
* Aeri would store only **metadata** (AniList IDs) and resolve to an official URL when available: `VideoProvider.getSources()` returns a single `VideoSourceEnhanced` of type `embed` with the official `https://www.crunchyroll.com/embed/...` style URL.
* No HLS handling in client; the embed's own player handles adaptive streaming.

**Pros:** Fully legitimate, no CORS issue (iframe src is navigated, not fetched), no backend, no secrets.

**Cons:** Coverage limited to titles the licensor makes embeddable; not every anime has an embed; search for licensed URL requires a licensed-API mapping (AniList sometimes has `siteUrl`/`streamingEpisodes` but often not).

**Aeri fit:** Add `OfficialEmbedProvider` already scaffolded in `src/providers/video/official.ts`. Feed it a mapping table `anilistId -> licensedEmbedUrl` (curated or via a licensed API). This is already behind `VITE_VIDEO_API_URL` optional — when no embed exists, show existing `Video unavailable • Tried:` UI.

### B. Bring-your-own backend — GH Pages stays static, playback is external opt-in

**How:** Keep GH Pages static, but allow the user (or deployer) to configure a **self-hosted, authorized** video worker:

* Worker implements `GET /health`, `GET /episodes/:animeId`, `GET /sources/:episodeId?language=sub|dub` and returns normalized `VideoSourceEnhanced[]` JSON (already defined in `src/providers/video/types.ts`).
* Worker runs where CORS can be set (`Access-Control-Allow-Origin: https://fastdemo.github.io`) and where licensed source contracts allow server-side fetching, HLS manifest signing, or range proxying.
* Aeri never hardcodes the worker URL: `getEffectiveVideoApiUrl()` prefers `preferences.customVideoApiUrl` (set in Settings → Playback Sources) over build-time `VITE_VIDEO_API_URL`. No backend is required to use the app; without a URL the player shows `No playable source` with `Change source`.

**Pros:** Keeps GH Pages constraint, no scraping in client, user/host controls keys and licensing, works with HLS.js (`hls.js` already bundled) for direct `application/vnd.apple.mpegurl` sources.

**Cons:** Requires the user/deployer to run and maintain a worker; Aeri itself remains without playback until configured.

**Aeri fit:** Already fully wired. `worker/` folder contains a Cloudflare Worker template (`worker/README.md`, `src/providers.ts` health checks). Settings → Playback Sources UI lets the user set/test the URL and toggle provider order. This is the intended path for real playback.

### C. Fully server-rendered / hybrid (not viable for current constraint)

* Next.js / Cloudflare Pages Functions / Vercel that proxies APIs and injects `Access-Control-Allow-Origin` and handles OAuth refresh server-side.
* Would solve MAL OAuth CORS and provider CORS, but violates “static-only GH Pages, no backend” and would require migrating off `HashRouter` GH Pages.

**Not recommended** unless Aeri drops the static constraint.

---

## 3. What was investigated and why it failed (Phase 7 + re-check 2026-09-01)

All browser-direct providers were probed from `https://fastdemo.github.io` origin via `fetch` + `PLAYBACK_MATRIX.md` T0–T3:

* AllAnime `https://api.allanime.day/api` — allows `Origin: https://fastdemo.github.io` but requires exact `SearchInput` GraphQL variables and Cloudflare Turnstile; returns `BAD_USER_INPUT` / `Just a moment` HTML, no stable CORS `sources` for browser.
* AnimePahe `https://animepahe.ru/api` — `CORS: no Allow-Origin` (`ERR_FAILED`), `301 → animepahe.su` HTML “Domain for Sale” for release, `301` not CORS.
* Anikoto `https://anikototv.to/ajax/...` — `ERR_NAME_NOT_RESOLVED`.
* MegaPlay `https://megaplay.buzz/api` — `200` CORS OK but body `Error - MegaPlay` HTML.
* AnimeParadise `https://www.animeparadise.moe/api` — CORS blocked.

None yield `content-type: video/*` or `application/vnd.apple.mpegurl` with `#EXTM3U` in a browser `fetch` from GH Pages. Therefore a pure-browser provider is **not viable** without a server.

---

## 4. Recommended path for Aeri

1. **Keep A.** (official embeds) as the zero-backend happy path — expand `official.ts` mapping over time.
2. **Keep B.** (BYO worker via `customVideoApiUrl` / `VITE_VIDEO_API_URL`) as the GH Pages-compatible real playback path — no Aeri backend, user opts in.
3. **Do not invest** in browser-scraped providers; document them as infeasible in `PLAYBACK_MATRIX.md`.
4. **Do not compromise** UI/data work for streaming — playback remains behind `VideoPlayer` abstraction, shows `Finding… → Tried: … → Retry` when no source.

---

## 5. Seanime study — streaming-only architecture (2026-09-01)

Seanime was reviewed specifically for **streaming** (torrent intentionally excluded) via `5rahim/seanime` (Go + React, 4.1k stars) and `seanime-extensions` docs.

**Not implemented: torrent.** No torrent UI, downloads, or BitTorrent client were added to Aeri. Seanime's torrent/debrid features were noted only as context and explicitly not carried over.

### How Seanime does streaming

* **Server is required.** Seanime is a **media server** (`main.go` + Echo + SQLite + Goja) + React frontend (`seanime-web`). It is not a static site and cannot run on GH Pages.
* **Extension system for online streaming.** Community provider is a JS file executed **server-side** in a sandboxed `Goja` runtime (not in the browser):
  ```ts
  abstract class AnimeProvider {
    search(opts: SearchOptions): Promise<SearchResult[]>
    findEpisodes(id: string): Promise<EpisodeDetails[]>
    findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer>
    getSettings(): { episodeServers: string[]; supportsDub: boolean }
  }
  // findEpisodeServer returns
  // { server, headers, videoSources: [{ url, type: 'm3u8', quality, subtitles[] }] }
  ```
  The extension marketplace (`seanime-extensions`, `SinonCute/seanime-extensions` via AniMapper) installs a `manifest.json` raw URL; the server fetches and runs it in Goja.
* **Source discovery/resolution.** Provider `search` fetches an upstream API with server `fetch` (custom `headers`, `Cookie`, `Referer`, `user-agent`), parses HTML/JSON, returns `SearchResult[]`. `findEpisodes` paginates `api?m=release&id=...&page=N`, normalizes `number` (subtracts lowest, filters non-integers). `findEpisodeServer` fetches the episode page (`/play/...`), extracts `button[data-src]` / `kwik` iframe, then decodes `eval(...)` packed JS to get the `m3u8`.
* **Passing sources to the player.** `EpisodeServer.videoSources` is passed to Seanime's `VideoCore` (Denshi/Electron libmpv or web `hls.js`). Headers from the provider (`Referer`) are forwarded to the HLS loader. Subtitles come as `EpisodeServer.videoSources[].subtitles[]`.
* **Provider fallbacks & failure handling.** `getSettings().episodeServers` declares fallback servers (`["kwik"]`, etc.). `findEpisodes` throws `No episodes found` when empty; `findEpisodeServer` throws `Failed to fetch episode server` when `kwik` regex misses. Seanime surfaces `Tried:` and retries next server — same UX Aeri already has (`Tried: ... • Retry`).
* **External API/worker is mandatory.** All three steps use server `fetch` with privileges the browser lacks (no CORS, can set `Cookie`/`Referer`). Seanime's Go server (or `seanime-server-mobile` on `127.0.0.1:43211`) is that API. The web frontend (`seanime-web`) never talks directly to upstream anime sites.

### What this means for Aeri (static GH Pages, no backend)

* **Aeri's constraint matches Seanime's conclusion:** Browser-only `fetch` to the same upstreams fails `PLAYBACK_MATRIX.md` T0 CORS (`No Allow-Origin` from `https://fastdemo.github.io`). A small user-configurable worker **is still the only practical architecture** that preserves GH Pages staticity.
* **Aeri already mirrors Seanime's abstraction, just smaller:**
  ```
  Seanime:  Extension (Goja) -> Go server -> VideoCore
  Aeri:     VideoProvider (registry/base) -> optional customVideoApiUrl / VITE_VIDEO_API_URL -> VideoPlayer (hls.js)
  ```
  `src/storage/preferences.ts:customVideoApiUrl` + `getEffectiveVideoApiUrl()` + `src/providers/video/registry.ts` (parallel 4s, 3500ms timeout, `triedProviders`) + `src/providers/video/types.ts:VideoSourceEnhanced` already provide the same seam Seanime uses, without Goja or torrent.
* **Torrents are not a fit.** Seanime's value is local library + debrid torrent streaming via `anacrolix/torrent` inside the Go server. Aeri is a discovery/tracking UI on GH Pages; adding torrent UI/downloads would violate the static-only constraint, legal scope, and the request not to implement torrenting.

### Concrete recommendation for Aeri

1. **Do not add torrent functionality** — no BitTorrent client, no debrid, no download UI.
2. **Keep the BYO worker as the sanctioned streaming path** (already wired). The worker should implement Seanime's three-step shape but via simple authenticated endpoints:
   `GET /health` → `GET /episodes/:anilistId` → `GET /sources/:episodeId?language=sub|dub` returning `VideoSourceEnhanced[]` with `url`, `type: 'm3u8'`, `quality`, `headers`, `subtitles`. Aeri's `worker/` Cloudflare template is the place for this — it can run the same `fetch`+`Referer`+`Cookie` logic Seanime's Goja does, but as a plain Worker.
3. **Keep official embeds as the zero-backend path** (Seanime does not prioritize this, but for Aeri it is the only no-worker legitimate option). Expand `src/providers/video/official.ts` only with licensor-permitted iframe URLs.
4. **Do not reintroduce browser-scraped providers.** They are fragile (upstream HTML changes) and CORS-blocked — exactly why Seanime runs them server-side.

## 6. Aeri implementation — MAL + Streaming + Because You Watched (live)

### MAL — first-class via worker

MAL is CORS-blocked on `https://fastdemo.github.io` for all `myanimelist.net` and `api.myanimelist.net` fetches (see `docs/MAL_BROWSER_FEASIBILITY.md`). The fix is a **worker proxy**, not a browser hack:

* **Worker:** `worker/src/index.ts` now proxies `POST /mal/token` → `https://myanimelist.net/v1/oauth2/token` and `GET|PUT /mal/api/*` → `https://api.myanimelist.net/v2/*`, forwarding `Authorization`, `X-MAL-CLIENT-ID`, `Content-Type` and body, returning `Access-Control-Allow-Origin` for `https://fastdemo.github.io` (or `*` in preview). The worker is the same `VITE_VIDEO_API_URL` / `customVideoApiUrl` used for streaming, so one URL configures both.
* **Frontend:** `src/services/mal/auth.ts:fetchMalTokenWithFallback` and `src/services/mal/client.ts:buildMalUrls` try the worker first (`${workerBase}/mal/token`, `${workerBase}/mal/api/...`) then fall back to direct `https://myanimelist.net` / `https://api.myanimelist.net`. When a worker is configured, token exchange, refresh, `GET /users/@me`, `GET /users/@me/animelist`, `GET /anime/:id`, `PUT /anime/:id/my_list_status` all succeed with CORS.
* **Identity:** `src/services/anilist/mapper.ts` sets `malId = idMal` on every AniList `Anime`; `src/providers/mal/provider.ts` + `src/lib/identity.ts:matchIdentity` and `src/contexts/TrackingContext.tsx:dedupAndMerge` key on `mal-${malId}` so an AniList entry and its MAL counterpart dedup correctly. Title fallback via `getFranchiseTitle` is not needed for mapping because `idMal` is authoritative, but the UI still uses `getFranchiseTitle` for display dedup (Continue Watching franchise merging).
* **Episode mapping:** All MAL `Anime` objects flow through the same smart episode system (`src/lib/episodes.ts:getDisplayEpisodeNumber` / `getLocalEpisodeNumber` / `getNumberingOffsetAndMode`). Watch uses `localEpNum` for `PUT /my_list_status {num_watched_episodes}` and `displayEpNum` for UI (`S2:E14`), so restarting vs continuing seasons work for MAL as well.
* **Tracking fan-out:** `src/contexts/TrackingContext.tsx:updateProgress|Status|Rating` still fans out to both AniList and MAL when authenticated, but `src/services/mal/client.ts` now deduplicates via `inflight` and `memoryCache`, and `TrackingContext` uses `Promise.allSettled` with per-provider `catch(()=>{})` so a MAL 404/401 does not roll back AniList. No duplicate writes beyond the intentional dual-sync.
* **UI:** `src/pages/MyList.tsx` + `src/pages/Settings.tsx` already show `12 titles • AniList` vs `• MAL` vs `• AniList • MAL`, handle `authExpired`, `loading`, empty list, and manual token fallback. No fake data.

### Streaming — real provider + player

Aeri keeps the `VideoProvider` abstraction from `src/providers/video/types.ts` and `registry.ts`, now backed by the worker:

* **Contract (worker):**
  ```
  GET /health -> { status, providers[] }
  GET /map/:anilistId -> { providerAnimeId, title }
  GET /episodes/:anilistId[?provider=animepahe] -> { episodes: [{ id, number, title, thumbnail, provider, providerEpisodeId }], count }
  GET /sources/:episodeId?language=sub|dub&provider=... -> { sources: [{ url, type: 'hls'|'mp4'|'embed', quality, provider, language, embed, subtitles[], headers }], tried[] }
  GET /watch/:provider/:anilistId/:lang/:episode -> same as /sources (compat)
  GET /proxy?url= -> CORS proxy for HLS segments / subtitles (allowlist)
  ```
  The worker implements `VideoSourceProvider` per `worker/src/providers.ts` (Official Trailer + Demo HLS + stubs that document viability). `DemoProvider` returns `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` for any `anilistId`, so the player is verifiably HLS-capable even without a real upstream.

* **Frontend registry:** `src/providers/video/registry.ts:resolveEpisodesWithFallback` and `resolveSourcesWithFallback` race `getEnabledProviders()` (ordered by `preferences.providerOrder`) with 4s timeout, try preferred provider first then parallel fallback, return `tried[]` for UI. `base.ts:cachedFetch` memoizes with IDB 1h and `providerId` 5m negative cache.

* **Player:** `src/components/player/VideoPlayer.tsx` handles `isHlsSource` via lazy `hls.js` (worker `enableWorker:true`, fallback to native `canPlayType` on Safari), `crossOrigin="anonymous"` only when subtitles need it, `volume`/`autoplay`/`initialTime` from `preferences`, `track` elements for `subtitles`, `play/pause/seek/fullscreen` via native controls, `onTimeUpdate` throttled 5s `putWatchPos` + `>92%` `updateProgress`, `onEnded` `clearWatchPos` + autoplay next.

* **Watch page:** `src/pages/Watch.tsx` is now a streaming interface, not a placeholder. It resolves `sanitizedAnimeForWatch` + `seriesGroup` + `numberingCtx` (`getNumberingOffsetAndMode`) to compute `effectiveSeasonNumber` and `displayEpNum`/`localEpNum`, shows `S:E` in top bar and title, `prev/next` via `getDisplayEpisodeNumber`, episode grid with `S:E` labels, source selector + SUB/DUB toggle, `Finding…` / `Tried:` / `Retry` (bypassCache) / `Change source` → `/settings`, `No playable source` when `tried` exhausted, and local `watchPos` resume.

### Because You Watched — weighted random

`src/pages/Home.tsx:becauseContext` now scores each `combinedList` entry by `statusWeight * scoreWeight * ratingWeight * popularityWeight * recencyWeight * availabilityWeight * poolBoost`, filters to those with `overlapCount >=2` (can actually recommend), takes top 10, then weighted random pick via `Math.random()*total`. `becauseRecommendations` takes `getRecommendations(refGenres, candidates)` top 16 then `shuffle` sample 8, so both reference and lineup vary on refresh while staying genre-relevant and never including `listIds` duplicates.

## 7. Next steps if playback is pursued later

* Finalize `worker/src/providers.ts` licensed mapping (negotiate embed rights or use only APIs that explicitly permit browser use).
* Add `GET /captions/:episodeId` to the worker for `SubtitleTrack` support (already typed in `VideoSourceEnhanced`).
* Add server-side MAL OAuth token exchange/refresh so Settings → MAL Connect works from GH Pages (worker sets CORS for `myanimelist.net` flow).
* Keep client `src/providers/video/registry.ts` timeout `3500ms` + parallel fallback; do not lower further (already Phase 7.1 optimized).
