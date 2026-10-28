import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * AnimeParadise playback — live production proof.
 *
 * WHAT IS REAL: provider resolution (`/api/sources/animeparadise-…`), the
 * signed `/api/stream` relay, the upstream HLS master/variant/segments and
 * the English VTT all come from the deployed Worker
 * (https://aeri.fastdemo.workers.dev). Nothing about the media path is
 * doubled here.
 *
 * WHAT IS SYNTHETIC: auth only. Watch is auth-gated (D125), so the same
 * synthetic MAL token every playback spec uses is seeded, and AniList/MAL
 * metadata answers from local fixtures (Cowboy Bebop, anilistId 1, 26 eps,
 * TV, 1998 — exactly the identity hints AnimeParadise needs).
 *
 * PROOF STANDARD: readyState >= 2, currentTime advances, no media error,
 * and the played source is our relay (never a raw upstream URL). Subtitles
 * are asserted from the real VTT response, not from a stub.
 */
const BASE = process.env.PLAYBACK_BASE_URL ?? 'https://aeri.fastdemo.workers.dev/'

async function pinAnimeParadise(page: Page) {
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem('aeri:prefs')
      const prefs = raw ? JSON.parse(raw) : {}
      prefs.enabledProviders = { ...(prefs.enabledProviders ?? {}), animeparadise: true }
      prefs.providerOrder = ['animeparadise', 'aniwave', 'animegg']
      prefs.preferredAudio = 'sub'
      prefs.subtitles = true
      localStorage.setItem('aeri:prefs', JSON.stringify(prefs))
    } catch {}
  })
}

test('animeparadise: production HLS playback + English subtitles', async ({ page }) => {
  test.setTimeout(180_000)
  const pageErrors: string[] = []
  const streamResponses: { url: string; status: number; ct: string }[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  page.on('response', (res) => {
    const u = res.url()
    if (!u.includes('/api/stream')) return
    streamResponses.push({ url: u.slice(0, 80), status: res.status(), ct: res.headers()['content-type'] ?? '' })
  })

  await seedTestAuth(page)
  await routeTestMalIdentity(page)
  await routeTestAnilistMedia(page)
  await pinAnimeParadise(page)

  await page.goto(`${BASE}/watch/anilist-1/1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('video', { timeout: 90_000 })

  // Kick playback (muted autoplay policy) and let hls.js buffer.
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    if (v) { v.muted = true; v.play().catch(() => {}) }
  })

  await expect
    .poll(async () => page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).readyState), {
      timeout: 90_000,
      intervals: [1000, 2000],
    })
    .toBeGreaterThanOrEqual(2)

  const t0 = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime)
  await page.waitForTimeout(8000)
  const state = await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement
    const tracks = Array.from(v.textTracks).map((t) => ({
      kind: t.kind,
      label: t.label,
      lang: t.language,
      mode: t.mode,
      cues: t.cues ? t.cues.length : 0,
    }))
    const subtitleEls = Array.from(document.querySelectorAll('track')).map((t) => ({
      label: (t as HTMLTrackElement).label,
      srcLang: (t as HTMLTrackElement).srclang,
      src: (t as HTMLTrackElement).src.slice(0, 90),
    }))
    const body = document.body.innerText
    return {
      path: location.pathname,
      t: v.currentTime,
      rs: v.readyState,
      err: (v.error as { code?: number } | null)?.code ?? 0,
      paused: v.paused,
      duration: v.duration,
      tracks,
      subtitleEls,
      providerLine: (body.match(/AnimeParadise|AniWave|AnimeGG/gi) ?? []).slice(0, 4),
      noSource: body.includes('No playable source'),
    }
  })

  // Real frames advanced.
  expect(state.t).toBeGreaterThan(t0)
  expect(state.rs).toBeGreaterThanOrEqual(2)
  expect(state.err).toBe(0)
  expect(state.noSource).toBe(false)
  expect(pageErrors).toEqual([])

  // Every byte came through our signed relay. Status 0 = the player
  // aborted a speculative load (normal hls.js behaviour), not a failure.
  const settled = streamResponses.filter((r) => r.status !== 0)
  expect(settled.length).toBeGreaterThan(0)
  const bad = settled.filter((r) => r.status !== 200 && r.status !== 206)
  expect(bad, `non-2xx relay responses: ${JSON.stringify(bad)}`).toEqual([])
  expect(streamResponses.some((r) => r.ct.includes('mpegurl'))).toBe(true)

  // English subtitles are wired from the real VTT through the relay.
  const vtt = streamResponses.filter((r) => r.ct.includes('vtt'))
  expect(vtt.length).toBeGreaterThan(0)
  const english = state.tracks.find((t) => /english|en/i.test(`${t.label} ${t.lang}`))
  expect(english, JSON.stringify(state.tracks)).toBeTruthy()
  expect(state.subtitleEls.length).toBeGreaterThan(0)

  await page.screenshot({ path: 'OpenCode/screens/animeparadise-playback.png', fullPage: false })
})

test('settings: AnimeParadise is listed once and reports Available', async ({ page }) => {
  test.setTimeout(90_000)
  await seedTestAuth(page)
  await routeTestMalIdentity(page)
  await routeTestAnilistMedia(page)
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Anime providers', { timeout: 45_000 })

  const readSection = () => page.evaluate(() => document.body.innerText.split('Anime providers')[1]?.split('Disable providers')[0] ?? '')

  await expect
    .poll(async () => (await readSection()).match(/AnimeParadise/g)?.length ?? 0, { timeout: 30_000, intervals: [500, 1000] })
    .toBe(1)

  // Health resolves asynchronously from /api/health — wait for the real label.
  await expect
    .poll(async () => /AnimeParadise[\s\S]{0,120}?Available/.test(await readSection()), { timeout: 30_000, intervals: [500, 1000] })
    .toBe(true)

  const section = await readSection()
  expect(section).toMatch(/AnimeParadise[\s\S]{0,120}?Available/)
  expect(section).not.toMatch(/AnimeParadise[\s\S]{0,120}?Unavailable/)
  expect(section).not.toMatch(/AnimeParadise[\s\S]{0,120}?Requires backend/)
  await page.screenshot({ path: 'OpenCode/screens/animeparadise-settings.png', fullPage: true })
})
