import { test, expect } from '@playwright/test'

/**
 * D154 — hero copy legibility.
 *
 * Owner report (2026-10-30): the hero text is sometimes hard to read. The
 * old left scrim was 560px wide and hit transparent at 70% of that width,
 * while a long title / the description still sat on the artwork — bright
 * backdrops washed the copy out.
 *
 * Contract:
 * D157 (2026-10-31): the owner asked for NO text shadow on hero copy — the
 * contrast is bought from the scrim instead, which is denser than D156.
 *
 * Contract:
 *  - the left scrim runs 720px at desktop (past the 560px text column);
 *  - it starts at >= 95% of the theme background (D156 was 92%);
 *  - NO copy node carries a text shadow (`.hero-copy` paints nothing);
 *  - the preview card's banner title also has no shadow, and its scrim starts
 *    at >= 74% so the type reads on bright artwork;
 *  - the wider scrim never causes horizontal overflow at 1440/768/375.
 */

test.describe('hero copy legibility (D154, shadow removed D157)', () => {
  test('left scrim runs 720px, is denser, and the copy carries no shadow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const hero = page.locator('section[aria-roledescription="carousel"]')
    const hasHero = await hero
      .waitFor({ timeout: 45_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!hasHero, 'hero not rendered (no trending data)')

    const scrim = page.locator('[data-hero-scrim="left"]').first()
    await expect(scrim).toHaveCount(1)
    const geom = await scrim.evaluate((el) => ({
      width: Math.round(el.getBoundingClientRect().width),
      bg: getComputedStyle(el).backgroundImage,
    }))
    expect(geom.width, 'scrim extends past the 560px text column').toBe(720)
    expect(geom.bg, 'scrim paints a gradient').toContain('linear-gradient')

    // The text column mounts only once its backdrop image is ready (by
    // design — the title can never sit over another slide's picture).
    await page.locator('.hero-copy').first().waitFor({ timeout: 45_000 })
    const copy = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.hero-copy')] as HTMLElement[]
      const title = nodes.find((n) => n.tagName === 'H1') as HTMLElement | undefined
      const desc = nodes.find((n) => n.classList.contains('hero-desc')) as HTMLElement | undefined
      const scrim = document.querySelector('[data-hero-scrim="left"]') as HTMLElement
      // First stop's alpha: how opaque the scrim is right under the title.
      const alphaOf = (value: string) => {
        const slash = value.match(/\/\s*([\d.]+)\)/)
        return slash ? Number(slash[1]) : 1
      }
      const first = getComputedStyle(scrim).backgroundImage.match(
        /(?:rgba?\([^)]*\)|color\([^)]*\))/,
      )?.[0] ?? ''
      return {
        count: nodes.length,
        titleShadow: title ? getComputedStyle(title).textShadow : 'none',
        descShadow: desc ? getComputedStyle(desc).textShadow : 'none',
        metaShadow: nodes
          .filter((n) => n !== title && n !== desc)
          .map((n) => getComputedStyle(n).textShadow),
        scrimLeadAlpha: alphaOf(first),
      }
    })
    expect(copy.count, 'title + meta + description carry the hook').toBeGreaterThanOrEqual(3)
    // D157: no text shadow anywhere on the hero copy — the scrim carries it.
    expect(copy.titleShadow, 'hero title has no text shadow').toBe('none')
    expect(copy.descShadow, 'hero description has no text shadow').toBe('none')
    for (const [i, shadow] of copy.metaShadow.entries()) {
      expect(shadow, `hero meta line ${i} has no text shadow`).toBe('none')
    }
    // D157: the scrim behind the type is denser than D156's 92%.
    expect(copy.scrimLeadAlpha, 'left scrim is >= 95% theme bg under the copy').toBeGreaterThanOrEqual(0.95)
    // D156: a smooth ramp, not a 5-stop panel — 9 tapering stops, no shelf.
    expect(geom.bg.match(/%/g)?.length ?? 0, 'deeply eased ramp (9 tapering stops)').toBeGreaterThanOrEqual(8)
  })

  test('the preview card banner title has no shadow and a denser scrim', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/anime/20', { waitUntil: 'domcontentloaded' })
    const dialog = page.locator('[role="dialog"]').first()
    const hasDialog = await dialog
      .waitFor({ timeout: 45_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!hasDialog, 'detail overlay did not open')

    const banner = await page.evaluate(() => {
      const h2 = document.querySelector('[role="dialog"] h2') as HTMLElement | null
      const nodes = [...(document.querySelectorAll('[role="dialog"] .hero-copy') as any)] as HTMLElement[]
      const alphaOf = (value: string) => {
        const slash = value.match(/\/\s*([\d.]+)\)/)
        return slash ? Number(slash[1]) : 1
      }
      const el = document.querySelector('[role="dialog"] .detail-banner-scrim')
      const bg = el ? getComputedStyle(el).backgroundImage : ''
      const first = bg.match(/(?:rgba?\([^)]*\)|color\([^)]*\))/)?.[0] ?? ''
      return {
        bannerShadow: h2 ? getComputedStyle(h2).textShadow : null,
        bannerNodes: nodes.length,
        nodeShadows: nodes.map((n) => getComputedStyle(n).textShadow),
        scrim: bg,
        scrimLeadAlpha: alphaOf(first),
      }
    })
    expect(banner.scrim, 'banner scrim is one continuous eased gradient').toContain('linear-gradient')
    expect(banner.scrim.match(/%/g)?.length ?? 0, 'banner ramp has >= 12 stops').toBeGreaterThanOrEqual(12)
    // D157: the shadow is gone from the banner title and its two sub-lines.
    expect(banner.bannerShadow, 'banner title has no text shadow').toBe('none')
    expect(banner.bannerNodes, 'title + both title lines carry the hook').toBeGreaterThanOrEqual(2)
    for (const [i, shadow] of banner.nodeShadows.entries()) {
      expect(shadow, `banner line ${i} has no text shadow`).toBe('none')
    }
    // D157: the scrim under the title is denser than D156's 62%.
    expect(banner.scrimLeadAlpha, 'banner scrim is >= 74% theme bg under the title').toBeGreaterThanOrEqual(0.74)
  })

  for (const width of [1440, 768, 375]) {
    test(`wider scrim does not overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      const hero = page.locator('section[aria-roledescription="carousel"]')
      const hasHero = await hero
        .waitFor({ timeout: 45_000 })
        .then(() => true)
        .catch(() => false)
      test.skip(!hasHero, 'hero not rendered (no trending data)')

      const state = await page.evaluate(() => {
        const scrim = document.querySelector('[data-hero-scrim="left"]') as HTMLElement
        return {
          scrimWidth: scrim.getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        }
      })
      expect(state.scrimWidth, 'scrim is capped by the viewport').toBeLessThanOrEqual(width)
      expect(state.overflow, 'no horizontal overflow').toBe(false)
    })
  }
})
