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

## 5. Next steps if playback is pursued later

* Finalize `worker/src/providers.ts` licensed mapping (negotiate embed rights or use only APIs that explicitly permit browser use).
* Add `GET /captions/:episodeId` to the worker for `SubtitleTrack` support (already typed in `VideoSourceEnhanced`).
* Add server-side MAL OAuth token exchange/refresh so Settings → MAL Connect works from GH Pages (worker sets CORS for `myanimelist.net` flow).
* Keep client `src/providers/video/registry.ts` timeout `3500ms` + parallel fallback; do not lower further (already Phase 7.1 optimized).
