import { test, expect, type Page } from '@playwright/test'

/**
 * CARD SILHOUETTE + SCROLL-COST REGRESSION.
 *
 * 1. `/manga` used to load with `aspect-[16/9]` anime boxes over a grid that
 *    renders 3:4 portrait covers, so the page visibly morphed. Every skeleton
 *    now reads its shape from `src/components/cards/cardGeometry.ts`, the same
 *    module AnimeCard reads. These tests compare the RENDERED skeleton ratio
 *    to the RENDERED card ratio, so a future card-shape change that forgets a
 *    skeleton fails here instead of shipping.
 *
 * 2. Scrolling used to lag: offscreen cards were gated from loading art, so
 *    their placeholder used to pulse forever (86 infinite animations on Home;
 *    87% of scroll main-thread time). The placeholder now renders only when
 *    the card is near the viewport, and the hover scrim's backdrop blur is
 *    hover-only instead of always mounted. The Home test pins both halves.
 */

/** Hold the AniList response so the loading skeleton stays measurable. */
async function holdAnilist(page: Page, ms = 4000): Promise<void> {
  await page.route(/graphql\.anilist\.co/, async (route) => {
    await new Promise((r) => setTimeout(r, ms))
    await route.continue().catch(() => {})
  })
}

const ratio = (box: { width: number; height: number } | null): number =>
  box && box.height > 0 ? box.width / box.height : -1

test.describe('Loading skeleton matches the card it becomes', () => {
  test('/manga loads portrait covers, not anime boxes', async ({ page }) => {
    await holdAnilist(page)
    await page.goto('/manga', { waitUntil: 'domcontentloaded' })

    const skeleton = page.locator('[data-card-skeleton="manga"]').first()
    await expect(skeleton).toBeVisible({ timeout: 30_000 })
    const skeletonRatio = ratio(await skeleton.boundingBox())

    // The reported bug: a landscape (16:9 ≈ 1.78) block on a portrait grid.
    expect(skeletonRatio, 'manga skeleton is portrait').toBeLessThan(1)

    // …and it must be the SAME shape as the real manga card.
    const card = page.locator('.card-art').first()
    await expect(card).toBeVisible({ timeout: 45_000 })
    const cardRatio = ratio(await card.boundingBox())

    expect(Math.abs(skeletonRatio - cardRatio), 'skeleton silhouette === card silhouette').toBeLessThan(0.02)
  })

  test('/anime loads landscape cards, not manga boxes', async ({ page }) => {
    await holdAnilist(page)
    await page.goto('/anime', { waitUntil: 'domcontentloaded' })

    const skeleton = page.locator('[data-card-skeleton="anime"]').first()
    await expect(skeleton).toBeVisible({ timeout: 30_000 })
    const skeletonRatio = ratio(await skeleton.boundingBox())
    expect(skeletonRatio, 'anime skeleton is landscape').toBeGreaterThan(1)

    const card = page.locator('.card-art').first()
    await expect(card).toBeVisible({ timeout: 45_000 })
    const cardRatio = ratio(await card.boundingBox())

    expect(Math.abs(skeletonRatio - cardRatio), 'skeleton silhouette === card silhouette').toBeLessThan(0.02)
  })
})

test.describe('Scroll cost stays off the offscreen cards', () => {
  test('offscreen cards animate nothing and mount no backdrop blur', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const cards = page.locator('.card-art')
    await expect(cards.first()).toBeVisible({ timeout: 45_000 })
    // Let the first screenful settle; offscreen art stays gated (that is the
    // condition that used to leave 80+ placeholders pulsing forever).
    await page.waitForTimeout(1500)

    const report = await page.evaluate(() => {
      const vh = window.innerHeight
      const offscreenPulsing: string[] = []
      const frostBlurs: string[] = []
      let cards = 0
      for (const art of document.querySelectorAll('.card-art')) {
        cards++
        const top = art.getBoundingClientRect().top
        if (top > vh + 400) {
          const pulsing = [...art.querySelectorAll('.animate-pulse')].some(
            (el) => getComputedStyle(el).animationName !== 'none',
          )
          if (pulsing) offscreenPulsing.push(String(art.className).slice(0, 60))
        }
      }
      for (const frost of document.querySelectorAll('.card-frost')) {
        const blur = getComputedStyle(frost).backdropFilter
        if (blur && blur !== 'none') frostBlurs.push(blur)
      }
      return { cards, offscreenPulsing: offscreenPulsing.length, frostBlurs: frostBlurs.length }
    })

    expect(report.cards, 'Home rendered cards').toBeGreaterThan(20)
    expect(report.offscreenPulsing, 'no offscreen card keeps a pulse animation').toBe(0)
    expect(report.frostBlurs, 'no card mounts a backdrop blur at rest').toBe(0)
  })
})
