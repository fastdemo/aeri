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
 *  - the left scrim runs 720px at desktop (past the 560px text column);
 *  - every hero copy node carries the theme-aware `.hero-copy-shadow`
 *    (two layers, 8px blur);
 *  - the wider scrim never causes horizontal overflow at 1440/768/375.
 */

test.describe('hero copy legibility (D154)', () => {
  test('left scrim runs 720px and the copy carries a theme-aware shadow', async ({ page }) => {
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
    await page.locator('.hero-copy-shadow').first().waitFor({ timeout: 45_000 })
    const copy = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.hero-copy-shadow')] as HTMLElement[]
      const title = nodes.find((n) => n.tagName === 'H1') as HTMLElement | undefined
      const desc = nodes.find((n) => n.classList.contains('hero-desc')) as HTMLElement | undefined
      // Resolve the theme shadow so "half intensity" can be checked numerically.
      const probe = document.createElement('span')
      probe.style.color = 'var(--shadow)'
      document.body.appendChild(probe)
      const themeShadow = getComputedStyle(probe).color
      probe.remove()
      const alphaOf = (value: string) => {
        const slash = value.match(/\/\s*([\d.]+)\)/)
        if (slash) return Number(slash[1])
        const rgba = value.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/)
        return rgba ? Number(rgba[1]) : 1
      }
      return {
        count: nodes.length,
        titleShadow: title ? getComputedStyle(title).textShadow : 'none',
        descShadow: desc ? getComputedStyle(desc).textShadow : 'none',
        themeAlpha: alphaOf(themeShadow),
        titleLayers: title
          ? getComputedStyle(title)
              .textShadow.split(/,(?![^(]*\))/)
              .map(alphaOf)
          : [],
      }
    })
    expect(copy.count, 'title + meta + description carry the shadow').toBeGreaterThanOrEqual(3)
    for (const [label, shadow] of [
      ['title', copy.titleShadow],
      ['description', copy.descShadow],
    ] as const) {
      expect(shadow, `${label} carries a text shadow`).not.toBe('none')
      expect(shadow, `${label} uses the soft 8px layer`).toContain('8px')
    }
    // D156: "half the intensity" — every layer is the theme shadow at 50%.
    expect(copy.titleLayers.length, 'two shadow layers').toBe(2)
    for (const a of copy.titleLayers) {
      expect(a, 'each layer is half the theme shadow alpha').toBeCloseTo(copy.themeAlpha / 2, 2)
    }
    // D156: a smooth ramp, not a 5-stop panel — the left scrim is built from
    // 9 tapering stops so its falloff has no visible shelf.
    expect(geom.bg.match(/%/g)?.length ?? 0, 'deeply eased ramp (9 tapering stops)').toBeGreaterThanOrEqual(8)
  })

  test('the preview card banner title carries the same halved shadow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/anime/20', { waitUntil: 'domcontentloaded' })
    const dialog = page.locator('[role="dialog"]').first()
    const hasDialog = await dialog
      .waitFor({ timeout: 45_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!hasDialog, 'detail overlay did not open')

    const shadows = await page.evaluate(() => {
      const hero = document.querySelector('.hero-copy-shadow') as HTMLElement | null
      const h2 = document.querySelector('[role="dialog"] h2') as HTMLElement | null
      const paras = [...(document.querySelectorAll('[role="dialog"] .hero-copy-shadow') as any)]
      return {
        heroShadow: hero ? getComputedStyle(hero).textShadow : null,
        bannerShadow: h2 ? getComputedStyle(h2).textShadow : null,
        bannerNodes: paras.length,
        scrim: (() => {
          const el = document.querySelector('[role="dialog"] .detail-banner-scrim')
          return el ? getComputedStyle(el).backgroundImage : null
        })(),
      }
    })
    expect(shadows.scrim, 'banner scrim is one continuous eased gradient').toContain('linear-gradient')
    expect(shadows.scrim!.match(/%/g)?.length ?? 0, 'banner ramp has >= 12 stops').toBeGreaterThanOrEqual(12)
    expect(shadows.bannerShadow, 'banner title carries the hero copy shadow').not.toBe('none')
    expect(shadows.bannerNodes, 'title + both title lines carry it').toBeGreaterThanOrEqual(2)
    if (shadows.heroShadow) {
      expect(shadows.bannerShadow, 'identical treatment to the hero title').toBe(shadows.heroShadow)
    }
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
