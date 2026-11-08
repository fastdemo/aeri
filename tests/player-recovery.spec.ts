import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * D159 - a dead picture must recover WITHOUT reloading the tab.
 *
 * Owner (2026-11-01): "sometimes during anime streaming the episode turns
 * black completely, and it stays like that forever that could only be
 * resolved with a tab refresh. fix that."
 *
 * hls.js surfaces fatal errors through the adapter's `error` event but never
 * recovers on its own. The player now runs a watchdog and escalates:
 * soft engine recovery -> codec swap -> a targeted remount of the player
 * subtree at the failure position. This spec drives the remount path with a
 * controlled MP4 (no hls.js engine): a synthetic media error must replace
 * the <video> element and restore the interrupted currentTime.
 *
 * Deterministic setup reuses the Watch-layout harness: synthetic MAL auth,
 * routed identity + AniList metadata, and the worker source route answered
 * with a public MP4. Provider resolution still runs unmodified.
 */

const FLOWER_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

async function setupAuth(page: Page): Promise<void> {
  await seedTestAuth(page)
  await routeTestMalIdentity(page, [{ malId: 20, title: 'Naruto', numEpisodes: 220, progress: 0 }])
  await routeTestAnilistMedia(page)
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem('aeri:prefs')
      const cur = raw ? JSON.parse(raw) : {}
      localStorage.setItem('aeri:prefs', JSON.stringify({
        ...cur,
        customVideoApiUrl: 'https://aeri.fastdemo.workers.dev',
        preferredAudio: 'sub',
        autoplay: false,
      }))
    } catch {}
  })
}

async function routeDirectMp4(page: Page): Promise<void> {
  await page.route('**/api/sources/aniwave-*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sources: [{
          url: FLOWER_MP4,
          type: 'mp4',
          quality: 'auto',
          provider: 'aniwave',
          language: 'sub',
          embed: false,
        }],
      }),
    })
  })
}

test('a dead picture remounts the player and resumes at the same position', async ({ page }) => {
  test.setTimeout(120_000)
  await setupAuth(page)
  await routeDirectMp4(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('video', { timeout: 90_000 })

  // The provider chain may surface several sources; switch to the aniwave
  // one, whose worker route this spec answers with the controlled MP4.
  const picker = page.locator('select[aria-label="Select video source"]')
  await picker.waitFor({ state: 'attached', timeout: 60_000 })
  await expect
    .poll(async () => picker.locator('option', { hasText: 'aniwave' }).count(), { timeout: 60_000 })
    .toBeGreaterThan(0)
  await picker.selectOption({ label: 'aniwave' })

  // Real playback: muted so Chromium's autoplay policy cannot block it.
  await page.waitForFunction(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    return !!v && v.readyState >= 2
  }, undefined, { timeout: 60_000 })
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement
    v.muted = true
    void v.play().catch(() => {})
  })
  await page.waitForFunction(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    return !!v && v.currentTime > 1.5
  }, undefined, { timeout: 30_000 })

  const before = await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement & { dataset: DOMStringMap }
    v.dataset.recoveryProbe = 'pre-failure'
    return { t: v.currentTime, paused: v.paused }
  })
  expect(before.paused).toBe(false)

  // Synthetic fatal error: the adapter has no hls.js engine for MP4, so the
  // watchdog escalates straight to the targeted remount.
  await page.evaluate(() => {
    document.querySelector('video')?.dispatchEvent(new Event('error'))
  })

  // A NEW element must appear (the old one carried the probe).
  await expect.poll(
    () => page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement & { dataset: DOMStringMap }
      if (!v) return 'none'
      return v.dataset.recoveryProbe === 'pre-failure' ? 'old' : 'new'
    }),
    { timeout: 15_000 },
  ).toBe('new')

  // The remount must resume at the interrupted position, not restart at 0.
  await expect.poll(
    () => page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      return v?.currentTime ?? 0
    }),
    { timeout: 20_000 },
  ).toBeGreaterThan(before.t - 1)

  // And the picture is alive again (frames, not a black element). The
  // remounted element re-fetches, so allow it to reach HAVE_CURRENT_DATA.
  await expect.poll(
    () => page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      return v?.readyState ?? 0
    }),
    { timeout: 20_000 },
  ).toBeGreaterThanOrEqual(2)

  const alive = await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement
    return { videoWidth: v.videoWidth, error: v.error?.code ?? 0 }
  })
  expect(alive.error).toBe(0)
  expect(alive.videoWidth).toBeGreaterThan(0)
})
