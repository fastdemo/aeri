import { test, expect } from '@playwright/test'

// Production playback: real <video>, currentTime must advance, no fatal errors.
// Run against the LIVE worker (same-origin, no CORS gap):
//   npx playwright test tests/streaming-production.spec.ts --project=chromium
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
    await page.goto(`${BASE}#/watch/anilist-${c.id}/${c.ep}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('video', { timeout: 60000 })
    await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      if (v) { v.muted = true; v.play().catch(() => {}) }
    })
    const t0 = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime)
    await page.waitForTimeout(8000)
    const s = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return { t: v.currentTime, rs: v.readyState, err: (v.error as any)?.code ?? 0 }
    })
    expect(s.t).toBeGreaterThan(t0)
    expect(s.rs).toBeGreaterThanOrEqual(2)
    expect(s.err).toBe(0)
    expect(errors).toEqual([])
  })
}
