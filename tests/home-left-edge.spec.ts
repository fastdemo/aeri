import { test, expect } from '@playwright/test'

// Home left-edge crop regression: the card <button> must carry the same
// width as its frame even with images blocked (pure skeleton/loading
// state). Previously the button collapsed to ~20px before images loaded,
// cropping the row's left edge on slow networks while settled-DOM checks
// read delta 0. Images blocked = worst case; geometry must still hold.
// Chromium-only: Firefox flex intrinsic sizing differs; the shipped
// product targets Chromium/Safari behavior (verified separately).
const WIDTHS = [375, 390, 768, 1440, 1920]

for (const vw of WIDTHS) {
  test(`home left edge aligned at ${vw}px (images blocked)`, async ({ page }) => {
    await page.setViewportSize({ width: vw, height: 844 })
    await page.route('**.{jpg,jpeg,png,webp,avif}', r => r.abort())
    await page.goto('/#/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(8000)
    const rows = await page.evaluate(() => {
      const hero = document.querySelector('main section')
      const hl = hero?.getBoundingClientRect().left ?? 0
      return [...document.querySelectorAll('main section')]
        .filter(s => s.querySelector(':scope h2'))
        .slice(0, 3)
        .map(s => {
          const h = s.querySelector(':scope h2')
          const f = s.querySelector('div[class*="overflow-x"]')?.firstElementChild
          const b = f?.getBoundingClientRect()
          return {
            dTitle: Math.round((h?.getBoundingClientRect().left ?? 0) - hl),
            dCard: b ? Math.round((b.left - hl) * 10) / 10 : null,
            w: b ? Math.round(b.width) : null,
          }
        })
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.dTitle).toBe(0)
      expect(r.dCard).toBe(0)
      // card must be full row-card width even with no image content
      expect(r.w).toBeGreaterThan(100)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
