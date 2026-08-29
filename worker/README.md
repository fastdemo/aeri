# Aeri Video Worker

Cloudflare Worker that provides the normalized video API for Aeri's static GitHub Pages frontend.

```
GitHub Pages (https://fastdemo.github.io/aeri/)
    ↓ VITE_VIDEO_API_URL=https://aeri-video.<you>.workers.dev
Aeri Video API (this worker)
    ↓
Provider adapters (Miruro, AllAnime, etc.)
    ↓
Normalized sources → VideoPlayer (HLS/MP4/embed)
```

## Routes

- `GET /health` → `{status, providers}`
- `GET /map/:anilistId` → `{providerAnimeId, title}` (AniList title → AllAnime `_id`)
- `GET /episodes/:anilistId` → `{episodes: [{id, number, title, thumbnail, provider, providerEpisodeId, language}]}`
  authoritative from AniList `episodes` + `streamingEpisodes`
- `GET /sources/:episodeId?language=sub|dub` → `{sources: [{url, type:hls|mp4|embed, quality, language, embed, subtitles}]}`
  currently returns demo HLS (`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`) to prove pipeline; swap with real upstream
- `GET /watch/:provider/:id/:lang/:ep` → alias for `/sources`
- `GET /proxy?url=` → proxies HLS segments with CORS & Referer

All routes send `Access-Control-Allow-Origin: https://fastdemo.github.io` (or `*` for preview) and handle `OPTIONS`.

## Deploy

```bash
cd worker
npm install
npx wrangler login
# production (allowed origin = fastdemo.github.io)
npx wrangler deploy --env production
# or preview
npx wrangler deploy --env preview
# set secrets if needed
# npx wrangler secret put SCRAPER_API_KEY --env production
```

Then in GitHub repo: Settings → Secrets → `VITE_VIDEO_API_URL` = `https://aeri-video.<you>.workers.dev`

`deploy.yml` already injects it at build: `VITE_VIDEO_API_URL: ${{ secrets.VITE_VIDEO_API_URL }}`

Once set, frontend's `miruroProvider` (priority 1) will produce episodes + HLS via this worker without further frontend changes.

## Swapping to real provider

Replace the demo HLS in `src/index.ts` `DEM0_HLS` block with real fetch:

```ts
const upstream = await fetch(`https://api.miruro.tv/api/episodes/${anilistId}`)
const sources = await upstream.json() // map to normalized
```

or proxy AllAnime clock/player with `Referer` and decrypt as needed.

## Limits

- Free Workers: 100k req/day, 10ms CPU (increase to 30s on Paid $5/mo if scraping)
- This demo does no heavy scraping, so Free is sufficient
- If providers need Cloudflare bypass, use Paid Workers (edge-to-edge) or a small VPS (Fly/Hetzner) with same API shape; frontend URL just changes.

## Local dev

```bash
npx wrangler dev --port 8787
# frontend .env: VITE_VIDEO_API_URL=http://127.0.0.1:8787
npm run dev
```
