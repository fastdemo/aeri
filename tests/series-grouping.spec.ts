import { test, expect } from '@playwright/test'

// Series grouping: any member entry resolves to the same unified selector,
// selection follows the route id, switching navigates to the canonical entry.
// Run against LIVE (needs real AniList; cold walks take several seconds):
//   npx playwright test tests/series-grouping.spec.ts --project=chromium
const BASE = process.env.PLAYBACK_BASE_URL ?? 'https://aeri.fastdemo.workers.dev/'

async function seasonState(page: any) {
  return page.evaluate(() => ({
    opts: document.querySelectorAll('select[aria-label="Select season"] option').length,
    selected: (document.querySelector('select[aria-label="Select season"]') as HTMLSelectElement | null)?.value ?? 'none',
    skel: !!document.querySelector('[aria-label="Loading seasons"]'),
  }))
}

async function waitSeason(page: any, min = 2, timeoutMs = 30000) {
  const t0 = Date.now()
  for (;;) {
    const s = await seasonState(page)
    if (s.opts >= min && !s.skel) return s
    if (Date.now() - t0 > timeoutMs) return s
    await page.waitForTimeout(500)
  }
}

test('AoT S1/S2/S3 resolve to the same 6-season group', async ({ page }) => {
  test.setTimeout(240000)
  const seen: string[] = []
  for (const [id, wantSel] of [['16498', '0'], ['20958', '1'], ['99147', '2']] as const) {
    await page.goto(`${BASE}#/anime/anilist-${id}`, { waitUntil: 'domcontentloaded' })
    const s = await waitSeason(page)
    expect(s.opts).toBe(6)
    expect(s.selected).toBe(wantSel)
    seen.push(`${id}->${s.opts}/${s.selected}`)
  }
  // Switch via selector: S1 page, pick index 1 -> route becomes S2, selection sticks
  await page.goto(`${BASE}#/anime/anilist-16498`, { waitUntil: 'domcontentloaded' })
  await waitSeason(page)
  await page.selectOption('select[aria-label="Select season"]', '1')
  await page.waitForTimeout(4000)
  const hash = await page.evaluate(() => location.hash)
  expect(hash).toContain('anilist-20958')
  const after = await seasonState(page)
  expect(after.selected).toBe('1')
  expect(after.opts).toBe(6)
})

test('Naruto has a multi-season group; Bebop standalone has none', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto(`${BASE}#/anime/anilist-20`, { waitUntil: 'domcontentloaded' })
  const n = await waitSeason(page)
  expect(n.opts).toBeGreaterThanOrEqual(2)
  await page.goto(`${BASE}#/anime/anilist-1`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  const b = await seasonState(page)
  expect(b.opts).toBeLessThanOrEqual(1)
})
