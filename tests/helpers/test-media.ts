import type { Page } from '@playwright/test'

/**
 * Controlled media doubles for deterministic player tests.
 *
 * SCOPE — READ CAREFULLY. These doubles replace ONLY the final media bytes
 * (MP4 file, HLS playlist/segments) served to the browser's `<video>` /
 * hls.js element. They NEVER replace provider resolution: MegaVid's
 * `/mal/{id}/{ep}/{lang}/source` JSON, AnimeGG's search→series→episode→
 * embed→play scrape chain, and the worker's signed `/api/stream` relay all
 * run UNMODIFIED unless a test explicitly routes them. A test that wants
 * to prove END-TO-END provider playback must NOT call the byte-level
 * helpers below — it routes nothing (or only blocks a tier) and asserts
 * on live upstream bytes (see playback-authenticated.spec.ts "live" suite,
 * explicitly labeled).
 *
 * Two deterministic doubles:
 * - MP4 (`routeControlledMp4`): answers AnimeGG `/play/...` URLs and any
 *   direct `.mp4` with a 302 to a tiny public CORS-open MP4 (MDN flower,
 *   already used by the existing demo control). 302 — not content
 *   synthesis — so content-type/sniff checks still observe a REAL file.
 * - HLS (`routeControlledHls`): serves a REAL multivariant playlist +
 *   segments by rewriting the playlist text fetched LIVE from the mux
 *   test-stream master. Segment URLs stay absolute upstream (CORS-open),
 *   so hls.js pulls REAL TS bytes. If the mux master is unreachable the
 *   helper throws — never synthesizes segments.
 */

const FLOWER_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const MUX_MASTER = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`controlled-hls upstream ${res.status} for ${url}`)
  return res.text()
}

/**
 * Redirect AnimeGG-signed MP4 URLs to a controlled real file. Matches the
 * provider's own URL shape (`/play/<id>/video.mp4?...`) — nothing else.
 * Every other request passes through, so resolution + relay + player
 * wiring are all genuinely exercised; only the final bytes are stable.
 */
export async function routeControlledMp4(page: Page): Promise<void> {
  await page.route('**/play/*/video.mp4**', async (route) => {
    await route.fulfill({ status: 302, headers: { location: FLOWER_MP4 } })
  })
}

/**
 * Serve a REAL HLS multivariant playlist for MegaVid-signed `.m3u8` URLs.
 * Fetches the mux master LIVE, rewrites relative segment/playlist URIs to
 * absolute upstream URLs, and fulfills with the correct content-type.
 * Throws when the upstream master is unreachable (explicit failure, never
 * silent synthesis).
 */
export async function routeControlledHls(page: Page): Promise<void> {
  const master = await fetchText(MUX_MASTER)
  const base = MUX_MASTER.slice(0, MUX_MASTER.lastIndexOf('/') + 1)
  const rewritten = master
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t || t.startsWith('#')) return line
      if (/^https?:\/\//.test(t)) return line
      return base + t
    })
    .join('\n')
  if (!/#EXTM3U/.test(rewritten) || !/#EXT-X-STREAM-INF/.test(rewritten)) {
    throw new Error('controlled-hls upstream master is not a multivariant playlist')
  }
  await page.route('**/*.m3u8**', async (route) => {
    const url = route.request().url()
    // Only stand in for provider-signed playlists, never for arbitrary m3u8.
    if (!/megavid|megaplay|animegg|aniwatch|cdnx|oeeee|broforgotsave|echovideo|dpopdrop/.test(url)) {
      await route.continue()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: rewritten })
  })
}

/**
 * Scope upstream blocking WITHOUT breaking the identity doubles.
 *
 * CONSTRAINT (verified 2026-10-10): a later-registered `/^https?:\/\//`
 * handler swallows requests and earlier glob routes NEVER fire — so this
 * helper FULFILLS the identity endpoints itself (same doubles as
 * test-auth) instead of continue()ing into them. Single owner of the
 * broad pattern: call at most once per page, AFTER setupAuth's glob
 * routes (they become inert shadows — harmless, still unrouted in
 * afterEach). `blocked` records every aborted URL so tests can assert the
 * block actually did something (a vacuous no-op route would also yield
 * no-source and prove nothing).
 */
export async function blockUpstreamMedia(
  page: Page,
  blocked: string[],
  opts?: { allowRelay?: boolean },
): Promise<void> {
  const allowRelay = opts?.allowRelay ?? false
  await page.route(/^https?:\/\//, async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    // Identity doubles (fulfilled here — never continued, never upstream).
    if (url.includes('api.myanimelist.net/v2/users/@me') || url.includes('/api/mal/users/@me')) {
      if (url.includes('/animelist') || url.includes('/mangalist')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], paging: {} }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 424242, name: 'aeri-test-user' }) })
      return
    }
    if (/api\.myanimelist\.net\/v2\/(anime|manga)\//.test(url) || /\/api\/mal\/(anime|manga)\//.test(url)) {
      // Writes accepted; reads get an empty-but-valid node (titles resolve
      // via the AniList fixture, never via MAL detail here).
      if (method !== 'GET' || url.includes('/my_list_status')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 0, title: 'x', my_list_status: { status: 'watching', score: 0, num_episodes_watched: 0 } }) })
      return
    }
    // App shell + metadata fixtures stay live.
    if (
      url.includes('127.0.0.1') || url.includes('localhost')
      || url.includes('graphql.anilist.co')
      || url.includes('/src/') || url.includes('/@vite/') || url.includes('/@react-refresh')
      || url.includes('mdn.mozilla.net') || url.includes('test-streams.mux.dev')
    ) {
      await route.continue()
      return
    }
    // Worker relay: live by default (playback suites need it); aborted only
    // when the test explicitly asks (fail-closed shape).
    if (url.includes('aeri.fastdemo.workers.dev')) {
      if (allowRelay) { await route.continue(); return }
      blocked.push(url.slice(0, 100))
      await route.abort('blockedbyclient')
      return
    }
    blocked.push(url.slice(0, 100))
    await route.abort('blockedbyclient')
  })
}

export async function unrouteControlledMedia(page: Page): Promise<void> {
  await page.unroute('**/play/*/video.mp4**').catch(() => {})
  await page.unroute('**/*.m3u8**').catch(() => {})
  await page.unroute(/^https?:\/\//).catch(() => {})
}
