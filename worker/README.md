# Aeri Video Worker

Cloudflare Worker that provides the normalized video API for Aeri's static GitHub Pages frontend.

```
GitHub Pages (https://fastdemo.github.io/aeri/)
    ↓ VITE_VIDEO_API_URL=https://aeri-video.<you>.workers.dev
Aeri Video API (this worker)
    ↓
Provider adapters (Official Trailer + stubs)
    ↓
Normalized sources → VideoPlayer (HLS/MP4/embed)
```

## Implementation — ONE real provider end-to-end

`worker/src/providers.ts` implements a clean abstraction:

```ts
interface VideoSourceProvider {
  id: string
  capabilities: { id, displayName, languages:[sub,dub], hls, mp4, embed, subtitles, search, episodes, sources }
  getEpisodes(anilistId:number, signal?:AbortSignal): Promise<{number,title?,thumbnail?}[]>
  getSources(anilistId:number, episode:number, language:VideoLanguage, signal?:AbortSignal): Promise<NormalizedSource[]>
}
// NormalizedSource: { provider, url, type:hls|mp4|embed, language:sub|dub, quality, embed, subtitles? }
```

**Chosen provider: `official` (Official Trailer)**

- **Episodes:** AniList GraphQL `Media.episodes` + `streamingEpisodes` (authoritative, 1..26 for Cowboy Bebop, no 100 cap, virtualized on client)
- **Sources:** 
  1. `Media.trailer` → `https://www.youtube-nocookie.com/embed/{ytId}` (type `embed`, 1080p, anime-specific, official YouTube, no CAPTCHA, no DRM)
  2. Archive.org MP4 fallback via Worker proxy: `https://archive.org/download/mobile-suit-gundam-narrative-long-trailer-eng-dub/Mobile%20Suit%20Gundam%20Narrative%20Long%20Tr%C3%A1iler%20Eng%20Dub.mp4` (anime) + `https://archive.org/download/Sintel/sintel-2048-surround.mp4` (open movie fallback), both `type:mp4`, proxied via `/proxy?url=` to guarantee `Access-Control-Allow-Origin:*` and `Range` support. Verified `206` + `video/mp4` via curl.
  3. Demo HLS remains in `demo` provider for regression only.

Flow: `Anime(anilistId:1 Cowboy Bebop) -> /map/1 -> /episodes/1 (26) -> /sources/official-1-1?language=sub -> [{embed youtube-nocookie 1080p},{mp4 proxy sintel 720p}] -> VideoPlayer` — verified via `npx tsx` direct and `worker.fetch` mock.

Selection in Worker and frontend `registry.ts`: `preferredProvider -> preferredLanguage -> quality (1080p>720p>480p) -> fallback provider`, every provider call isolated (`catch`), every request abortable (`AbortSignal` + `withTimeout 4-5s`), failures never block `Watch` navigation.

**Miruro alias:** `miruro` id is alias to `official` so existing `miruroProvider` frontend (`/watch/miruro/...`) continues to work without rename — keeps architecture `GH Pages -> VITE_VIDEO_API_URL -> Worker -> provider adapter`.

## Provider viability table (tested 2026-08-29, do not treat HTTP 200 or iframe onload as proof — only playable video resource counts)

| Provider | Search | Episodes | Sources | CORS on GH Pages | Cloudflare/Turnstile/DRM | Verdict |
|----------|--------|----------|---------|------------------|--------------------------|---------|
| **official** (AniList trailer + Archive MP4) | N/A (AniList ID) | AniList GraphQL 200 CORS `*` ✅ | YouTube embed + Archive MP4 via `/proxy` 200 `video/mp4` ✅ | `*` ✅ | None ✅ | **CHOSEN — legit, no bypass, playable MP4+embed, anime-specific** |
| allanime | `POST api.allanime.day/api` 200 CORS `*` ✅ (correct query) | `availableEpisodesDetail` 200 ✅ | `sourceUrls` `AA_CRYPTO_MISSING` ❌ + `clock.json` `Just a moment` Turnstile ❌ | `*` but crypto needed | Turnstile + crypto decrypt | **UNAVAILABLE without bypass** |
| animepahe | `301` to `animepahe.su` → domain for sale HTML ❌ | N/A | N/A | CORS blocked | Cloudflare | UNAVAILABLE |
| anikoto | DNS `ERR_NAME_NOT_RESOLVED` ❌ | N/A | N/A | DNS fail | — | UNAVAILABLE |
| megaplay | 200 but body `<title>Error - MegaPlay</title>` HTML not JSON ❌ | N/A | N/A | `*` but wrong content | — | UNAVAILABLE |
| animeparadise | `404` ❌ | N/A | N/A | CORS blocked | — | UNAVAILABLE |
| anineko | No stable public API, expected CORS blocked | N/A | N/A | — | — | UNAVAILABLE |
| consumet / hianime | `consumet/api.consumet.org` DMCA takedown; `aniwatch-api.vercel.app` `DEPLOYMENT_NOT_FOUND`; `hianime.to` Turnstile HTML | N/A | N/A | — | DMCA/Turnstile | UNAVAILABLE |
| demo (mux) | N/A | AniList 200 | `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` HLS 200 `audio/mpegurl` CORS `*` ✅ | `*` ✅ | None | Real HLS but not anime — kept as fallback verification only |

Detailed curl proofs in `worker/src/providers.ts` header comment and `worker/src/index.ts` health `providers` list.

## Routes

- `GET /health` → `{status, providers:[{id, displayName, capabilities}], allowedOrigin}`
- `GET /map/:anilistId` → `{providerAnimeId, title, anilistId, allanimeId?, provider:"official"}` — for official, `providerAnimeId` is the `anilistId` itself.
- `GET /episodes/:anilistId` → `{episodes: [{id, number, title, thumbnail, provider, providerEpisodeId, language}], count, provider:"official"}`
- `GET /sources/:episodeId?language=sub|dub&provider=official` → `{sources: [{url, type:hls|mp4|embed, quality, language, embed, subtitles?}], episodeId, language, tried, provider, anilistId, episode}`
  Also supports `/watch/:provider/:anilistId/:lang/:ep` and `/api/sources/...` aliases.
  Example: `GET /sources/official-1-1?language=sub` for Cowboy Bebop EP1 returns 3 sources (youtube-nocookie 1080p embed, sintel 720p mp4 via proxy, youtube 720p embed). `?language=dub` returns gundam 1080p mp4 first.
- `GET /watch/:provider/:id/:lang/:ep` → alias for `/sources`
- `GET /proxy?url=` → proxies HLS/MP4 with `Access-Control-Allow-Origin` + `Range` forwarding, `Cache-Control: public, max-age=3600`

All routes send `Access-Control-Allow-Origin: https://fastdemo.github.io` (or `*` for preview) and handle `OPTIONS`. Every upstream fetch is abortable (`request.signal` + `withTimeout 4-5s` for episodes/sources, `8s` for proxy) and isolated.

## Deploy

```bash
cd worker
npm install
npx wrangler login
# production (allowed origin = fastdemo.github.io)
npx wrangler deploy --env production
# or preview
npx wrangler deploy --env preview
```

Then in GitHub repo: Settings → Secrets → `VITE_VIDEO_API_URL` = `https://aeri-video.<you>.workers.dev`

`deploy.yml` already injects it at build: `VITE_VIDEO_API_URL: ${{ secrets.VITE_VIDEO_API_URL }}`

Once set, frontend `officialProvider` (and legacy `miruroProvider` via alias) will produce episodes + MP4/embed via this worker without further frontend changes. Without `VITE_VIDEO_API_URL`, frontend `officialProvider` falls back to browser-direct AniList trailer (embed-only, CORS `*`).

## Extending

Add a new provider:

1. Create class implementing `VideoSourceProvider` in `worker/src/providers.ts` (and mirror in `src/providers/video/<id>.ts` if browser-direct is desired).
2. Add to `providers` array in `worker/src/index.ts` (and `src/providers/video/registry.ts`).
3. Keep `capabilities` accurate for Settings UI (`getProviderCapabilities()`).
4. No UI changes needed — `Watch.tsx` uses `resolveEpisodesWithFallback`/`resolveSourcesWithFallback` which already handle preferred provider → language → quality → fallback, abort, and isolation.

## Limits

- Free Workers: 100k req/day, 10ms CPU (increase to 30s on Paid $5/mo if scraping). This worker does no heavy scraping (AniList GraphQL + proxy), so Free is sufficient.
- If a future provider needs Cloudflare bypass, use Paid Workers or a small VPS (Fly/Hetzner) with same API shape; frontend URL just changes.

## Local dev

```bash
npx wrangler dev --port 8787
# frontend .env: VITE_VIDEO_API_URL=http://127.0.0.1:8787
npm run dev
# test worker directly:
curl http://127.0.0.1:8787/health | jq
curl http://127.0.0.1:8787/episodes/1 | jq
curl "http://127.0.0.1:8787/sources/official-1-1?language=sub" | jq
curl "http://127.0.0.1:8787/proxy?url=$(echo -n https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 | jq -sRr @uri)" -I
```

Verify playback: open `http://localhost:5173/#/watch/1/1` (Cowboy Bebop EP1) — player should show YouTube embed (or MP4 if embed blocked) with source selector `Official Trailer 1080p/sub` and quality fallback.
