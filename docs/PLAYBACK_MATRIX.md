# Playback Matrix — Phase 13 QA

> **A source is not successful merely because it returns 200.** This matrix distinguishes transport success (HTTP 200, HTML error page, JSON `{error}`, Cloudflare interstitial, CORS-blocked opaque) from actual playback (decoder has frames, `readyState>=2`, `videoWidth>0`, `currentTime` advances).

---

## 1. Tiered Verification Model

Every cell in the matrix runs the same 5-probe ladder. A cell passes only if it clears T2–T4. T0–T1 failures must be surfaced as `no-source` / `tried[]` rather than a false green.

| Tier | Name | What it checks | Why 200 is insufficient |
|------|------|----------------|-------------------------|
| **T0** | **Transport** | `status`, `content-type`, `content-length`, `cross-origin` headers, `Access-Control-Allow-Origin`, `X-Frame-Options`, `CSP frame-ancestors`, `Range` support | `megaplay` returns `200` with `<title>Error - MegaPlay</title>` HTML body. `AllAnime` returns `200` but body is `{"errors":[{"message":"BAD_USER_INPUT"}]}` or `clock.json` `Just a moment` Turnstile. Browser reports `200` via `fetch` caught as HTML, not video. |
| **T1** | **Source entity** | Body sniff: not `text/html`, not `application/json` error, not `…attention required…`/ `just a moment` / `error - megaplay` / `domain for sale`, `content-type` ∈ `{video/mp4, video/webm, application/vnd.apple.mpegurl, application/x-mpegURL}`, `content-length>0`, for HLS: manifest starts with `#EXTM3U` and contains `#EXTINF`, for MP4: `206 Partial Content` support or at least `accept-ranges: bytes` | `animepahe.ru` `301 → animepahe.su` returns `200` HTML “Domain for Sale”. `anikoto.to` DNS `ERR_NAME_NOT_RESOLVED` surfaces as `TypeError: Failed to fetch` not `200`, but must be distinguished from CORS `ERR_FAILED`. |
| **T2** | **Element** | For **direct video** (`mp4`/`hls`): `<video>` exists, `src` set or `hls.js` attached, `networkState !== NETWORK_NO_SOURCE (=3)`, `error === null`, `readyState >= 2 (HAVE_CURRENT_DATA)`, `videoWidth>0 && videoHeight>0`, `duration` finite `>5s && < 3600*5`, `paused === false` after `play()`. For **embed**: `<iframe>` exists, `contentWindow` not blocked `X-Frame-Options: DENY`, `load` event fired, `boundingBox.width>100`, no Aeri overlay `No playable source`, for YouTube: `src` matches `youtube-nocookie.com/embed/<id>` and `id` equals AniList `trailer.id` for that `anilistId`. | `200` iframe `onload` fires even when YouTube shows “Video unavailable” inside the frame. `200` video `src` assignment fires `loadedmetadata` with `videoWidth=0` if the resource was HTML. |
| **T3** | **Playback** | `currentTime` advances `>0.5s` within 12s of `play()`, `timeupdate` event fires ≥2×, `playing` event fires, `ended` does **not** fire within 3s of start, `buffered.length>0` or `seekable`, HLS: `hls.js` events `MANIFEST_PARSED → LEVEL_LOADED → FRAG_LOADED` with no `fatal` `ERROR`, no `MEDIA_ERROR` | `200` HLS manifest that points to 403 segments never advances `currentTime` (stalls at 0). `200` MP4 with `content-type:text/html` decodes 0 frames → `readyState` stuck at 0. |
| **T4** | **User-visible** | No perpetual spinner (`Finding video source…` auto-cleared ≤4.5s), no `Embed failed` error, source selector reflects `tried[]`, switching source resets T2→T3 without leaking old `hls` instance, controls visible and keyboard accessible, mobile: touch scroll works, `playsInline` prevents fullscreen hijack, no `overflow-x` | A `200` that passed T0 but failed T2 was previously shown as “success” if only fetch status checked. This tier catches it. |

**Verdict per cell:**

```
PASS (PLAYABLE)      = T0 ✓  T1 ✓  T2 ✓  T3 ✓  T4 ✓
PASS (CORRECTLY UNAVAILABLE) = T0 or T1 correctly fails, Watch shows "No playable source" + tried[] + Retry, no false success reported
FAIL (FALSE 200)     = T0 ✓ but T1 ✗ or T2 ✗ — reported as failure, not success
FAIL (STALL)         = T0–T2 ✓ but T3 ✗ — stall/timeout, reported as failure
```

A cell is **not** green if only `fetch` returned `200`.

---

## 2. Dimensions

### 2.1 Providers (Phase 13 focus)

| Provider | `id` | Expected GH Pages (no Worker) | With Worker `VITE_VIDEO_API_URL` | Languages | Type |
|----------|------|-------------------------------|----------------------------------|-----------|------|
| **AniKoto** | `anikoto` | DNS `ERR_NAME_NOT_RESOLVED` / CORS blocked → `resolveAnimeId=null` → `getEpisodes=[]` → `tried:['anikoto']` → `PASS (CORRECTLY UNAVAILABLE)` if detected correctly | Worker stub still `[]` (no scraper on Free tier) — same verdict | `sub/dub` | `embed` (would-be) |
| **AnimePahe** | `animepahe` | `301 → .su → Domain for Sale` HTML, CORS `ERR_FAILED` → `[]` | Same stub `[]` | `sub` only | `embed`/`hls` (would-be) |
| **OfficialTrailer** | `official` | Browser-direct `https://graphql.anilist.co` CORS `*` → YouTube `youtube-nocookie.com/embed/<ytId>` per-anime (embed-only) → `PASS (PLAYABLE)` if trailer exists, else `PASS (CORRECTLY UNAVAILABLE)` | Worker `GET /sources/official-<id>-<ep>` → same YouTube embed (verified) → `PASS (PLAYABLE)` | `sub/dub` | `embed` |
| **Demo (Mux)** | `demo` | `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` CORS `*` HLS → `PASS (PLAYABLE)` for HLS path verification only (not anime) | Worker alias same | `sub/dub` | `hls` |
| **Custom** | `custom` | Requires `localStorage aeri:prefs.customVideoApiUrl` — if unset `[]` | If configured → full-episode `mp4/hls` via Worker proxy with `Access-Control-Allow-Origin` + `Range` → `PASS (PLAYABLE)` | `sub/dub` | `hls/mp4/embed` |

### 2.2 Anime Fixtures

All IDs are `anilistId` (canonical). `expectEpisodes` is `Media.episodes ?? streamingEpisodes.length` (authoritative). Used to derive `late`/`final`.

| Fixture | `anilistId` | `malId` | Title (romaji) | `expectedEps` | `late` (n-1) | `final` | Format | Notes |
|---------|------------|---------|----------------|---------------|-------------|--------|--------|-------|
| **AOT S1** | `16498` | `16498` | `Shingeki no Kyojin` | `25` | `24` | `25` | TV | Core provider mapping test. S2 is `20958` (12 eps) — used for global-offset guard. |
| **Frieren** | `154587` | `52991` | `Sousou no Frieren` | `28` | `27` | `28` | TV | 28 eps, no offset, clean titles. Hero fixture. |
| **Demon Slayer** | `101922` | `38000` | `Kimetsu no Yaiba` | `26` | `25` | `26` | TV | Popular, tests S1→S2 boundary (S2 is `145545` 11eps). |
| **One Piece** | `21` | `21` | `One Piece` | `streamingLen≈69` shown generic (episodes `null`, global-offset guard → generic `Episode N`) | `68` | `69` | TV Airing | Edge: `episodes=null`, `streamingEpisodes` global numbers starting ~130 — matrix asserts generic not “Episode 130”. Final >1100 real count oob tested separately. |
| **Your Name (movie)** | `21519` | `32281` | `Kimi no Na wa.` | `1` | `1` | `1` | Movie | Expect `isMovie` UI hides Ep list, no `prev/next`. |
| **Cowboy Bebop** | `1` | `1` | `Cowboy Bebop` | `26` | `25` | `26` | TV | Canonical worker doc example (`official-1-1` → YouTube). Control. |

Episode cases per fixture: `1`, `2`, `5`, `late`, `final`. Plus **oob** (`final+1`) which must return `sources=[]` and show `No playable source`, not crash.

### 2.3 Source Resolution

| Language | Providers expected to support | Probe |
|----------|------------------------------|-------|
| `sub` | all (anikoto, animepahe, official, demo) | `preferredLanguage=sub` → source `language===sub` or no language tag (treated as sub) |
| `dub` | `anikoto` (claims dub), `official` (returns same trailer with `language=dub`), `demo` | `preferredLanguage=dub` → `animepahe` must correctly return `[]` (sub-only) and `tried` must include fallback to official → not reported as dub failure if official dub trailer exists |
| None/undefined | fallback | omit `language` query → worker default `sub` |

Cover: `preferredProvider=anikoto` and `animepahe` explicitly, and `null` (auto).

### 2.4 Player Probes (per source type)

| Type | T0 header | T1 body | T2 element | T3 playback |
|------|-----------|---------|------------|-------------|
| `hls` (`*.m3u8`) | `content-type: application/vnd.apple.mpegurl` or `application/x-mpegURL`, `200/206`, `access-control-allow-origin:*` | `#EXTM3U` present, segments fetch `200` with `content-type: video/MP2T` or `video/mp4` | `hls.js` `MANIFEST_PARSED`, `video.readyState>=2`, `videoWidth 1280` | `currentTime` advances, `buffered.end(0)>1s`, no `fatal` error |
| `mp4` | `content-type: video/mp4`, `accept-ranges: bytes`, proxied via Worker `/proxy` → `206` on Range | `>1MB`, not `text/html`, `content-range: bytes 0-…` | `readyState>=2`, `videoWidth>0`, `duration>5` | `currentTime>0.5` after `play()` |
| `embed` (YouTube) | `content-type: text/html` expected, `x-frame-options` **must not** be `DENY`/`SAMEORIGIN` for `/embed`, `content-security-policy: frame-ancestors *` | `iframe src` exactly `https://www.youtube-nocookie.com/embed/<ytId>?rel=0…` | `iframe` `load` fired, `boundingBox.width>100`, no Aeri error overlay, `allow="… fullscreen"` present | Visual: player chrome visible (YouTube red play not blocked by `referrerPolicy`), `postMessage` on `onReady` not required but load verified; negative: `src` that is `animepahe` `kwik` without Worker must show `X-Frame-Options: DENY` → caught at T0 |

### 2.5 Viewport / Interaction

| Viewport | Size | Extra checks |
|----------|------|--------------|
| Desktop | `1440×900` | Hover scale on cards, `aspect-video` `1280×720`, source `<select>` visible, keyboard `Tab` → focus ring |
| Tablet | `768×900` | Rows `overflow-x:auto` with `scroll-snap`, no `overflow-x` on body |
| Mobile | `375×667` | Touch swipe rows, `playsInline`, episode grid `2-col`, `Next/Previous` tappable `44px` min, no horizontal scroll |

All viewports assert `prefers-reduced-motion` disables `hls.js` worker churn only (animation), not playback.

### 2.6 Cross-cutting

| Case | Probe |
|------|-------|
| **Source switching** | Load `ep1 sub` → switch `<select>` to second quality or `dub` → assert old `hls` destroyed (`hlsRef.current===null` previous), new `video.src` differs, T2→T3 re-runs and passes, `currentTime` resets to 0 then advances, no `abort` leak |
| **Fallback** | `preferredProvider=anikoto` on `16498/1/sub` → first `getSources` returns `[]` → registry must try `animepahe → official → demo` in order with `tried[]` length `≥2`, final `sources` from fallback provider, `provider` label in UI matches fallback (`Official Trailer` not `AniKoto`) |
| **Negative 200** | Direct `fetch` to `megaplay` `200 HTML Error` and `animepahe.ru/api?m=search` `200 HTML Domain for Sale` and `allanime clock.json` `Just a moment` — all must be classified `T1 ✗` not success |
| **Cache** | Second visit to same `anilistId/ep` within 5 min must hit `video:*` `memoryCache`/`IDB` (no extra `fetch`), verified by `request` interceptor count |

---

## 3. Full Matrix (cells)

Each row is a test case. `Expect` is with Worker unset (GH Pages live) unless noted `[W]` (requires Worker).

`→ Verdict` uses §1 definitions.

| # | Provider | Anime | Ep | Lang | With Worker? | Expected → Verdict | Key assertion (beyond 200) |
|---|----------|-------|----|------|--------------|--------------------|----------------------------|
| 1 | anikoto | `16498` AOT | 1 | sub | no | `[]`, `tried:[anikoto,⋯,official]` → `PASS (CORRECTLY UNAVAILABLE)` | `resolveAnimeId(null)` within 3500ms, `getSources([])` not HTML, player shows `No playable source`, not spinner |
| 2 | anikoto | `16498` AOT | 2 | sub | no | same | `episode mapping` exists in `providerEpisodes` or falls back to synthetic `stableId`, but `sources` still `[]` |
| 3 | anikoto | `16498` AOT | 5 | sub | no | same | same |
| 4 | anikoto | `16498` AOT | 24 late | sub | no | same | late ep number near final, offset guard not triggered (count 25) |
| 5 | anikoto | `16498` AOT | 25 final | sub | no | same | final ep |
| 6 | anikoto | `16498` AOT | 26 oob | sub | no | `[]` + no crash | `epNum>episodes.length` → oob `No playable source` |
| 7 | anikoto | `154587` Frieren | 1 | sub | no | `PASS (CORRECTLY UNAVAILABLE)` | 28 eps, title not generic |
| 8 | anikoto | `154587` Frieren | 27 late | sub | no | same | late |
| 9 | anikoto | `154587` Frieren | 28 final | sub | no | same | final |
| 10 | anikoto | `154587` Frieren | 28 final | dub | no | same (dub also unavailable) | dub fallback to official dub trailer if Worker present else same unavailable |
| 11 | anikoto | `101922` Demon Slayer | 1 | sub | no | same | 26 eps |
| 12 | anikoto | `21` One Piece | 1 | sub | no | same + generic title guard | `normalizeEpisodes` yields `Episode 1` not `Episode 130`, `episode mapping` generic |
| 13 | anikoto | `21` One Piece | 68 late | sub | no | same | generic `Episode 68` not `Episode 197` |
| 14 | anikoto | `21519` Your Name | 1 | sub | no | same (movie 1) | `isMovie` hides `Episodes` list |
| 15 | animepahe | `16498` AOT | 1 | sub | no | `PASS (CORRECTLY UNAVAILABLE)` | CORS `ERR_FAILED` → `null` within 3500ms |
| 16 | animepahe | `16498` AOT | 1 | dub | no | `[]` (sub-only) → `tried` includes official dub fallback if Worker else same unavailable | `preferredLanguage=dub` filtered → `[]` but not reported as pahe dub success |
| 17 | animepahe | `16498` AOT | 5 | sub | no | same | ep5 |
| 18 | animepahe | `154587` Frieren | 1 | sub | no | same |  |
| 19 | animepahe | `154587` Frieren | 28 final | sub | no | same |  |
| 20 | animepahe | `101922` Demon Slayer | 25 late | sub | no | same |  |
| 21 | animepahe | `21` One Piece | 1 | sub | no | same + generic guard |  |
| 22 | **official** | `16498` AOT | 1 | sub | no (browser-direct) | `PASS (PLAYABLE)` embed YouTube if trailer exists else `PASS (CORRECTLY UNAVAILABLE)` but never false 200 | `readyState>=2` not applicable for embed; instead `iframe load + boundingBox + ytId matches AniList trailer` |
| 23 | official | `154587` Frieren | 1 | sub | no | same |  |
| 24 | official | `1` Cowboy Bebop | 1 | sub | no/[W] | `PASS (PLAYABLE)` → `https://www.youtube-nocookie.com/embed/<ytId>` verified `X-Frame-Options` allows embed, or Worker MP4 `206` + `videoWidth>0` | T2 `iframe load` + T4 no overlay |
| 25 | official | `1` Cowboy Bebop | 1 | dub | [W] | `PASS (PLAYABLE)` dub variant same yt with `language=dub` | language param echoed |
| 26 | official | `1` Cowboy Bebop | 1 | sub | [W] HLS fallback | `demo` HLS `PASS (PLAYABLE)` `readyState>=2 videoWidth>0 currentTime>0.5` | `test-streams.mux.dev/x36xhzz.m3u8` `content-type: application/vnd.apple.mpegurl` + `#EXTM3U` |
| 27 | demo | `1` Cowboy Bebop | 1 | sub | no | `PASS (PLAYABLE)` HLS mux | T1 manifest sniff, T3 currentTime advances |
| 28 | demo | `16498` AOT | 25 final | sub | no | `PASS (PLAYABLE)` HLS mux | same |
| 29 | **fallback** | `16498` AOT | 1 | sub | no | `preferredProvider=anikoto` → `tried=['anikoto',…]` → fallback to `official` embed `PASS (PLAYABLE)` | assert `tried.length>=2` and final `provider==='official'` |
| 30 | fallback | `154587` Frieren | 1 | dub | no | `preferredProvider=animepahe` (sub-only) + `preferredLanguage=dub` → `tried` includes `animepahe` then `official/dub` | dub filter correct |
| 31 | switch | `1` Cowboy Bebop | 1 | sub→dub | [W]/no | load `sub` → switch to `dub` → T2→T3 re-verified, old url ≠ new url | `hlsRef.destroy` called, no leak |
| 32 | switch | `1` Cowboy Bebop | 1 | 1080p→720p | [W] | load `1080p` → switch `720p` → new source `readyState>=2` | quality order |
| 33 | mobile | `154587` Frieren | 1 | sub | no | same as #23 but viewport `375` | `playsInline`, no `overflow-x`, touch swipe, controls tappable |
| 34 | desktop | `154587` Frieren | 1 | sub | no | same as #23 but viewport `1440` | `aspect-video` 16:9, not overflow |
| 35 | negative 200 | — | — | — | — | `fetch(megaplay)` `200` but `text/html Error` → T1 ✗ | body sniff catches `Error - MegaPlay` |
| 36 | negative 200 | — | — | — | — | `fetch(animepahe.su)` `200 Domain for Sale` → T1 ✗ | catches `domain for sale` |
| 37 | negative 200 | — | — | — | — | `fetch(allanime clock.json)` `Just a moment` Turnstile → T1 ✗ | catches `just a moment` |

Total 37 cells. Rows 1–21 are the requested `AniKoto`/`AnimePahe` real-provider mapping × episode × lang matrix. Rows 22–37 cover source resolution, playback vs 200, switching, fallback, mobile/desktop.

**Pass criteria for CI:**

- Zero cells report `FAIL (FALSE 200)` or `FAIL (STALL)`.
- Rows 1–21 are allowed to be `PASS (CORRECTLY UNAVAILABLE)` on GH Pages (CORS/DNS) — the pass is that the harness correctly identifies unavailability rather than claiming `200` success. With a configured Worker + scraper they would become `PASS (PLAYABLE)` but the same probes apply.
- Rows 22–28 must be `PASS (PLAYABLE)` (official/demo) — these are the controls proving the Harness itself can detect real playback. If these fail, the harness is broken, not the providers.
- Negative-200 rows 35–37 must be `T1 ✗` — proves Harness distinguishes 200 from playback.

---

## 4. How to run

```bash
# 1. Dev server (GH Pages base is /aeri/, but Playwright uses localhost)
npm run dev # → http://localhost:5173/aeri/

# 2. With Worker (optional, for [W] rows)
#   worker: npx wrangler dev --port 8787
#   frontend .env: VITE_VIDEO_API_URL=http://127.0.0.1:8787
#   or: VITE_VIDEO_API_URL=https://aeri-video.<you>.workers.dev npm run dev

# 3. Headed single provider
npx playwright test tests/playback-matrix.spec.ts -g "anikoto" --headed

# 4. Full matrix, three viewports, HTML report
npx playwright test tests/playback-matrix.spec.ts --project=chromium --reporter=html

# 5. Against deployed GH Pages (uses fastdemo origin, no localhost)
PLAYBACK_BASE_URL=https://fastdemo.github.io/aeri/ npx playwright test tests/playback-matrix.spec.ts
```

`playwright.config.ts` already sets `baseURL` from `PLAYBACK_BASE_URL` with fallback `http://localhost:5173/aeri/`, and `projects` for `chromium`, `mobile` (`375×667`), `firefox`.

---

## 5. Files

- `src/lib/playback-verification.ts` — pure helpers `isRealVideoResponse`, `isHlsManifest`, `probeVideoElement`, `probeEmbedElement`, `assertCurrentTimeAdvances`. Unit-tested, no DOM dependency beyond types.
- `tests/playback-matrix.spec.ts` — Playwright spec generating the 37 cells via `for` loops, using helpers plus live `Watch` navigation `/#/watch/<id>/<ep>`.
- `playwright.config.ts` — (if missing, fallback config in spec) three projects, `webServer` auto-start.

---

## 6. Relation to existing architecture

- Uses `resolveEpisodesWithFallback` / `resolveSourcesWithFallback` indirectly via `Watch.tsx` UI, not direct provider import — matches user path (deep link → watch → sources). Direct provider probes complement via `fetch` interception.
- Honors `fetchWithTimeout 3500ms` + `registry 4000ms` parallel: probes wait `≤ 8s` total, matching Watch's `2.3s to no-source` budget.
- Respects `VITE_VIDEO_API_URL` and `getEffectiveVideoApiUrl()` (custom URL in `localStorage`).
- Mobile/desktop switching uses `test.use({ viewport })` not UA spoof.
