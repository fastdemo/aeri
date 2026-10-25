import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

// Production playback: real <video>, currentTime must advance, no fatal errors.
// Run against the LIVE worker (same-origin, no CORS gap):
//   npx playwright test tests/streaming-production.spec.ts --project=chromium
//
// Watch is auth-gated (D125 era): seed the same synthetic MAL token the other
// playback specs use, then route only metadata/MAL to fixtures. Provider
// resolution and /api/stream remain REAL production requests.
const BASE = process.env.PLAYBACK_BASE_URL ?? 'https://aeri.fastdemo.workers.dev/'

const CASES = [
  { id: '16498', ep: '1', name: 'AoT' },
  { id: '1', ep: '1', name: 'Bebop' },
  { id: '154587', ep: '1', name: 'Frieren' },
  { id: '20', ep: '1', name: 'Naruto' },
]

for (const c of CASES) {
  test(`production playback: ${c.name} E${c.ep}`, async ({ page }) => {
    test.setTimeout(120000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
    await seedTestAuth(page)
    await routeTestMalIdentity(page)
    await routeTestAnilistMedia(page)
    await page.goto(`${BASE}/watch/anilist-${c.id}/${c.ep}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.video-skin', { timeout: 60000 })
    await page.waitForSelector('video', { timeout: 60000 })
    await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      if (v) { v.muted = true; v.play().catch(() => {}) }
    })
    const t0 = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime)
    await page.waitForTimeout(8000)
    const s = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      const skin = document.querySelector('.video-skin') as HTMLElement | null
      return {
        t: v.currentTime,
        rs: v.readyState,
        err: (v.error as any)?.code ?? 0,
        controls: v.controls,
        skinCount: document.querySelectorAll('.video-skin').length,
        theme: skin?.getAttribute('data-theme') ?? null,
        iframes: document.querySelectorAll('iframe').length,
      }
    })
    expect(s.t).toBeGreaterThan(t0)
    expect(s.rs).toBeGreaterThanOrEqual(2)
    expect(s.err).toBe(0)
    expect(s.controls).toBe(false)
    expect(s.skinCount).toBe(1)
    expect(s.theme).toBe('default')
    expect(s.iframes).toBe(0)
    expect(errors).toEqual([])
  })
}
