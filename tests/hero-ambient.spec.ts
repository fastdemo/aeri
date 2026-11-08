import { test, expect, type Page } from '@playwright/test'

/**
 * D162 - Netflix-style ambient behind the home hero (owner 2026-11-04,
 * rewritten as a page wash 2026-11-05).
 *
 * "i want to add an ambient behind the hero like netflix. basically the color
 * of the image being shown roughly." The first pass was a halo hugging the
 * card; the owner then asked for a natural look, and picked the page wash:
 * the artwork tints the PAGE, fading into --bg below the first row, so the
 * card sits on a tinted page instead of inside a coloured ring.
 *
 * The wash is the SAME backdrop image, painted full-bleed, blurred hard and
 * masked vertically into --bg. No canvas sampling, so it can never disagree
 * with the artwork or hit a CORS wall.
 *
 * Contract:
 *  - one [data-hero-ambient] layer, aria-hidden, pointer-events: none;
 *  - it is blurred + saturated + vertically masked (never a visible edge);
 *  - it spans the full viewport width and reaches below the first row;
 *  - it fades to the page background at its bottom edge (no shelf);
 *  - it paints the ACTIVE slide's backdrop and follows the carousel;
 *  - it never makes the page scrollable sideways at 375/768/1440;
 *  - prefers-reduced-motion drops the crossfade but keeps the wash.
 */

const hero = (page: Page) => page.locator('section[aria-roledescription="carousel"]')
const ambient = (page: Page) => page.locator('[data-hero-ambient]')

async function openHero(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await hero(page).waitFor({ timeout: 60_000 })
  await page.locator('.hero-copy').first().waitFor({ timeout: 60_000 })
  await expect(ambient(page)).toHaveCount(1)
}

/** src of the hero's incoming (active) backdrop image. */
const activeBackdrop = (page: Page) =>
  hero(page).locator('img').last().evaluate((el) => (el as HTMLImageElement).src)
/** src of the image the halo is currently painting. */
const ambientBackdrop = (page: Page) =>
  ambient(page).locator('img').last().evaluate((el) => (el as HTMLImageElement).src)

test.describe('hero ambient (D162)', () => {
  test('paints a blurred, masked page wash of the active backdrop', async ({ page }) => {
    test.setTimeout(120_000)
    await openHero(page)

    const state = await ambient(page).evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        ariaHidden: el.getAttribute('aria-hidden'),
        pointerEvents: cs.pointerEvents,
        position: cs.position,
        filter: cs.filter,
        opacity: Number(cs.opacity),
        mask: cs.maskImage || cs.webkitMaskImage,
        zIndex: cs.zIndex,
      }
    })

    expect(state.ariaHidden, 'ambient is decorative').toBe('true')
    expect(state.pointerEvents, 'ambient never eats clicks').toBe('none')
    expect(state.position).toBe('absolute')
    // The ORIGINAL D162 look (owner 2026-11-05: the cheap-raster revision
    // changed how it looked and was reverted): one full-size blurred image.
    expect(state.filter, 'blurred and saturated').toMatch(/blur\(.+\)/)
    expect(state.filter).toMatch(/saturate\(/)
    expect(state.mask, 'masked into the page background').toContain('gradient')
    expect(state.opacity, 'visible as a tint, not a glow').toBeGreaterThanOrEqual(0.05)
    expect(Number(state.zIndex)).toBeLessThanOrEqual(0)

    // Page wash: full viewport width, starting above the card and running
    // well past its bottom (over the first row). The card covers the middle,
    // so anything narrower than the viewport would read as a halo again.
    const box = await ambient(page).boundingBox()
    const card = await hero(page).boundingBox()
    const contentWidth = await page.evaluate(() => document.body.getBoundingClientRect().width)
    expect(box && card).toBeTruthy()
    if (!box || !card) return
    expect(box.x, 'reaches the left edge of the page').toBeLessThanOrEqual(0)
    expect(box.x + box.width, 'reaches the right edge of the page')
      .toBeGreaterThanOrEqual(contentWidth)
    expect(box.y, 'bleeds above the card').toBeLessThan(card.y)
    expect(box.y + box.height, 'runs at least a row below the card')
      .toBeGreaterThan(card.y + card.height + 200)

    // Roughly the artwork's colour: the halo paints the same file the hero
    // shows, not a second asset that could drift.
    expect(await ambientBackdrop(page)).toBe(await activeBackdrop(page))
  })

  test('fades into the page background below the first row - no shelf', async ({ page }) => {
    test.setTimeout(120_000)
    // Tall enough to see the wash's bottom edge without scrolling.
    await page.setViewportSize({ width: 1440, height: 1500 })
    await openHero(page)
    await page.waitForTimeout(300)

    const box = await ambient(page).boundingBox()
    const card = await hero(page).boundingBox()
    expect(box && card).toBeTruthy()
    if (!box || !card) return

    // A vertical strip at the card's horizontal middle, straddling the
    // layer's bottom edge: 60px inside, 60px outside.
    const edge = Math.round(box.y + box.height)
    const x = Math.round(card.x + card.width / 2)
    const clip = { x: x - 2, y: edge - 60, width: 4, height: 120 }
    const shot = await page.screenshot({ clip })
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1)
    const samples = await page.evaluate(async ({ b64, dpr, inside, outside, below }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const read = (cssY: number) => {
        const y = Math.min(bitmap.height - 1, Math.max(0, Math.round(cssY * dpr)))
        const d = ctx.getImageData(0, y, bitmap.width, 1).data
        let r = 0, g = 0, b = 0
        const n = bitmap.width
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
      }
      return { inside: read(inside), outside: read(outside), below: read(below) }
    }, { b64: shot.toString('base64'), dpr, inside: 58, outside: 62, below: 110 })

    const delta = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
    // The mask must reach ZERO at the layer's bottom edge. A radial/partial
    // mask left a hard shelf (25+ RGB in one pixel) where the layer ended.
    expect(delta(samples.inside, samples.outside), 'no step at the wash edge')
      .toBeLessThanOrEqual(6)
    expect(delta(samples.outside, samples.below), 'below the wash is the page background')
      .toBeLessThanOrEqual(6)
  })

  test('follows the carousel to the next slide', async ({ page }) => {
    test.setTimeout(120_000)
    await openHero(page)

    const dots = page.getByRole('button', { name: /^Go to / })
    test.skip((await dots.count()) < 2, 'hero has a single slide')
    const firstSrc = await ambientBackdrop(page)
    const firstTitle = await page.locator('h1.hero-copy').first().textContent()

    await dots.nth(1).click()
    await expect.poll(
      async () => page.locator('h1.hero-copy').first().textContent(),
      { timeout: 30_000, message: 'the hero moved to the next slide' },
    ).not.toBe(firstTitle)

    // The halo is keyed by the active id: it remounts on the incoming
    // backdrop (old image underneath while the new one loads) instead of
    // keeping the previous show's colour.
    await expect.poll(() => ambientBackdrop(page), { timeout: 30_000 })
      .not.toBe(firstSrc)
    expect(await ambientBackdrop(page)).toBe(await activeBackdrop(page))

    // The outgoing layer is a crossfade aid only - once the fade finishes it
    // is unmounted, so exactly one filtered raster is left alive (scroll cost,
    // owner report 2026-11-05).
    await expect.poll(
      () => ambient(page).locator('img').count(),
      { timeout: 10_000, message: 'the outgoing wash layer is dropped after the crossfade' },
    ).toBe(1)
  })

  test('never widens the page - the wash is clipped, not scrollable', async ({ page }) => {
    test.setTimeout(120_000)
    await openHero(page)

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      await page.waitForTimeout(150)
      const m = await page.evaluate(() => {
        const el = document.querySelector('[data-hero-ambient]') as HTMLElement
        const r = el.getBoundingClientRect()
        return {
          innerWidth: window.innerWidth,
          contentWidth: document.body.getBoundingClientRect().width,
          scrollWidth: document.documentElement.scrollWidth,
          left: Math.round(r.left),
          right: Math.round(r.right),
        }
      })
      expect(m.scrollWidth, `${width}px: the wash must not add horizontal scroll`)
        .toBeLessThanOrEqual(m.innerWidth)
      // The layer deliberately overshoots the viewport (100vw + 40px) and is
      // clipped by body's overflow-x: clip - that is what makes it full-bleed
      // with no visible side edge. It must cover the viewport, not sit inside.
      expect(m.left, `${width}px: wash reaches the left edge`).toBeLessThanOrEqual(0)
      expect(m.right, `${width}px: wash covers the content viewport`)
        .toBeGreaterThanOrEqual(m.contentWidth)
    }
  })
})

test.describe('hero ambient with reduced motion (D162)', () => {
  // The fade is the only motion; CSS media queries are engine-independent,
  // so one browser is enough to pin the contract.
  test.skip(({ browserName }) => browserName !== 'chromium', 'CSS-only contract, checked once')

  test('keeps the wash but drops the crossfade', async ({ page }) => {
    test.setTimeout(120_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openHero(page)
    const state = await ambient(page).locator('img').last().evaluate((el) => ({
      duration: getComputedStyle(el).transitionDuration,
      inline: el.getAttribute('style') ?? '',
      reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }))
    expect(state.reduce, 'reduced motion is emulated').toBe(true)
    // Chromium reports `transition: none` as 1e-05s, so compare against zero
    // with a tolerance instead of parsing for an exact '0s'.
    expect(parseFloat(state.duration), 'no crossfade under reduced motion').toBeLessThan(0.001)
    expect(state.inline).toContain('transition: none')
    await expect(ambient(page)).toHaveCount(1)
  })
})

/**
 * D166 - the wash continues into the navbar (owner 2026-11-05: "before that
 * the top bar was also a part of the ambient now its not").
 *
 * The wash used to show through the bar because the bar painted nothing of its
 * own. D163 had to give the bar an opaque `--bg` (iOS 26 paints the status
 * strip from the fixed element's plain colour), which cut the wash off at
 * y=56. The bar now paints its own copy of the wash, inside the bar, from the
 * SAME image and the SAME box as the page wash - the box matters, because
 * `cover` scales by the short axis, so any other height would crop/zoom
 * differently and put a colour step at the seam.
 *
 * Contract:
 *  - `[data-nav-ambient]` exists inside the header, aria-hidden, no pointer
 *    events, masked, and visible at rest;
 *  - its art paints the active backdrop with the wash's blur/opacity;
 *  - its box equals the page wash's box (same top + height + width);
 *  - the header keeps its own opaque `--bg` (the iOS strip contract);
 *  - it fades out once the page scrolls (the old solid-bar behaviour);
 *  - it CROSSFADES on the wash's own trigger and duration, so a slide change
 *    lands in both bands at the same time (owner report 2026-11-05);
 *  - pages without a hero paint nothing (var unset → background-image none).
 */
test.describe('the wash continues into the bar (D166)', () => {
  const barAmbient = (page: Page) =>
    page.evaluate(() => {
      const header = document.querySelector('header[data-nav-solid]') as HTMLElement
      const layer = document.querySelector('[data-nav-ambient]') as HTMLElement | null
      // The incoming artwork. The outgoing layer shares `.nav-ambient-art`
      // (same box/filter/strength) and is only mounted during a crossfade.
      const art = document.querySelector('.nav-ambient-art:not(.nav-ambient-art-prev)') as HTMLElement | null
      const prevArt = document.querySelector('.nav-ambient-art-prev') as HTMLElement | null
      const wash = document.querySelector('[data-hero-ambient]') as HTMLElement | null
      // The page wash's incoming layer: the thing the bar must move in step
      // with. `.hero-wash-img` is the per-slide <img>; the last one is the
      // active/entering artwork.
      const washImgs = Array.from(document.querySelectorAll('[data-hero-ambient] img')) as HTMLImageElement[]
      const washIncoming = washImgs[washImgs.length - 1]
      const ls = layer ? getComputedStyle(layer) : null
      const as = art ? getComputedStyle(art) : null
      const ps = prevArt ? getComputedStyle(prevArt) : null
      const ws = washIncoming ? getComputedStyle(washIncoming) : null
      const wr = wash?.getBoundingClientRect()
      const ar = art?.getBoundingClientRect()
      return {
        headerBackground: getComputedStyle(header).backgroundColor,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        ready: document.documentElement.hasAttribute('data-hero-wash-ready'),
        layer: ls ? {
          ariaHidden: layer!.getAttribute('aria-hidden'),
          pointerEvents: ls.pointerEvents,
          mask: ls.maskImage || ls.webkitMaskImage,
          overflow: ls.overflow,
          opacity: Number(ls.opacity),
        } : null,
        art: as ? {
          backgroundImage: as.backgroundImage,
          filter: as.filter,
          opacity: Number(as.opacity),
          transitionDuration: as.transitionDuration,
        } : null,
        prevArt: ps ? {
          backgroundImage: ps.backgroundImage,
          opacity: Number(ps.opacity),
          transitionDuration: ps.transitionDuration,
        } : null,
        washOpacity: ws ? Number(ws.opacity) : null,
        washTransitionDuration: ws?.transitionDuration ?? null,
        artBox: ar ? { top: ar.top, height: ar.height, width: ar.width } : null,
        washBox: wr ? { top: wr.top, height: wr.height, width: wr.width } : null,
      }
    })

  /**
   * The wash's `loaded` flag lives on <html> as `data-hero-wash-ready`. While
   * it is absent the bar's layers swap instantly (that is the frame the
   * artwork changes); while present both fade over CROSSFADE_MS. So "settled"
   * means the attribute is present and the incoming layer is fully in.
   */
  const waitWashReady = (page: Page) =>
    page.waitForFunction(
      () => document.documentElement.hasAttribute('data-hero-wash-ready'),
      undefined,
      { timeout: 60_000 },
    )

  test('paints the wash inside the bar, on the wash\'s own box', async ({ page }) => {
    test.setTimeout(120_000)
    await openHero(page)
    await waitWashReady(page)
    await expect(page.locator('[data-nav-ambient]')).toHaveCount(1)
    // Two layers exist (incoming + outgoing) so a slide change can crossfade;
    // on a cold load the outgoing one paints nothing.
    await expect(page.locator('[data-nav-ambient] .nav-ambient-art:not(.nav-ambient-art-prev)')).toHaveCount(1)
    await expect(page.locator('[data-nav-ambient] .nav-ambient-art-prev')).toHaveCSS('background-image', 'none')
    const s = await barAmbient(page)
    expect(s.layer, 'the bar carries an ambient layer').toBeTruthy()
    expect(s.layer!.ariaHidden, 'decorative').toBe('true')
    expect(s.layer!.pointerEvents, 'never eats clicks').toBe('none')
    expect(s.layer!.mask, 'dimmed into the bar, never a hard band').toContain('gradient')
    expect(s.layer!.overflow, 'clipped to the bar').toBe('hidden')
    expect(s.layer!.opacity, 'visible at rest').toBe(1)

    // Same artwork, same treatment as the page wash.
    expect(s.art!.backgroundImage).toContain(await activeBackdrop(page))
    expect(s.art!.filter, 'blurred like the wash').toMatch(/blur\(.+\)/)
    expect(s.art!.filter).toMatch(/saturate\(/)
    // Only once the wash reports `loaded` does the bar carry the tint; before
    // that it holds the outgoing artwork (or nothing on a cold load).
    await expect.poll(async () => (await barAmbient(page)).art!.opacity, {
      timeout: 10_000,
      message: 'the wash\'s own strength once the artwork has loaded',
    }).toBeGreaterThanOrEqual(0.1)

    // Identical box => identical `cover` crop => no colour step at the seam.
    expect(s.artBox!.top).toBeCloseTo(s.washBox!.top, 0)
    expect(s.artBox!.height).toBeCloseTo(s.washBox!.height, 0)
    expect(s.artBox!.width).toBeCloseTo(s.washBox!.width, 0)

    // The iOS status-strip contract is untouched: the fixed header still owns
    // a plain, opaque theme colour.
    expect(s.headerBackground).toBe(s.bodyBackground)
    expect(s.headerBackground, 'opaque, never translucent').not.toContain('/')
  })

  test('fades out once the page scrolls, like the old solid bar', async ({ page }) => {
    test.setTimeout(120_000)
    await openHero(page)
    await expect(page.locator('[data-nav-ambient]')).toHaveCSS('opacity', '1')
    await page.evaluate(() => window.scrollTo(0, 600))
    // The layer fades out over 300ms, then is UNMOUNTED: the bar keeps no
    // blurred/filtered composited layer at all while the page is scrolled
    // (D170 - iOS smeared that empty layer after fullscreen).
    await expect.poll(
      () => page.locator('[data-nav-ambient]').count(),
      { timeout: 5_000, message: 'the filtered layer is dropped after the fade' },
    ).toBe(0)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(async () => (await barAmbient(page)).layer!.opacity, {
      timeout: 5_000,
      message: 'back at the top the wash returns',
    }).toBe(1)
  })

  test('crossfades in step with the page wash', async ({ page }) => {
    test.setTimeout(180_000)
    await openHero(page)
    await waitWashReady(page)
    const dots = page.getByRole('button', { name: /^Go to / })
    if ((await dots.count()) < 2) test.skip(true, 'single slide')

    // Strength the bar paints at this viewport (globals.css: 0.15 / 0.16 /
    // 0.17 at base / 640 / 1024).
    const { strength, width } = await page.evaluate(() => {
      const el = document.querySelector('.nav-ambient-art') as HTMLElement
      return {
        strength: Number(getComputedStyle(el).getPropertyValue('--nav-ambient-strength')),
        width: window.innerWidth,
      }
    })
    const expectedStrength = width >= 1024 ? 0.17 : width >= 640 ? 0.16 : 0.15
    expect(strength, `strength at ${width}px`).toBeCloseTo(expectedStrength, 2)

    // Both bands ease over the wash's own crossfade duration (CROSSFADE_MS).
    const rest = await barAmbient(page)
    expect(parseFloat(rest.art!.transitionDuration), 'bar fades like the wash').toBeCloseTo(0.7, 1)
    expect(parseFloat(rest.washTransitionDuration ?? '0'), 'wash fades over 700ms').toBeCloseTo(0.7, 1)

    // Switch slides and catch the fade mid-flight.
    await dots.nth(1).click()
    const mid = await page.evaluate(async () => {
      const read = () => {
        const imgs = Array.from(document.querySelectorAll('[data-hero-ambient] img')) as HTMLImageElement[]
        const incoming = imgs[imgs.length - 1]
        const bar = document.querySelector('.nav-ambient-art:not(.nav-ambient-art-prev)') as HTMLElement
        const prev = document.querySelector('.nav-ambient-art-prev') as HTMLElement
        return {
          ready: document.documentElement.hasAttribute('data-hero-wash-ready'),
          wash: incoming ? Number(getComputedStyle(incoming).opacity) : 0,
          bar: Number(getComputedStyle(bar).opacity),
          prevPainted: getComputedStyle(prev).backgroundImage.includes('url('),
        }
      }
      const start = performance.now()
      while (performance.now() - start < 5_000) {
        const s = read()
        // Catch both layers genuinely part-way through the fade.
        if (s.ready && s.wash > 0.25 && s.wash < 0.75 && s.prevPainted) return s
        await new Promise((r) => setTimeout(r, 16))
      }
      return read()
    })

    expect(mid.ready, 'fading means the wash reported loaded').toBe(true)
    expect(mid.prevPainted, 'the outgoing artwork holds while the new one loads').toBe(true)
    // Same trigger + same duration + same easing ⇒ the bar is a pure scalar
    // of the wash at every frame; a bar that ran later would not be.
    expect(mid.bar, 'bar is mid-fade too').toBeGreaterThan(0.01)
    expect(mid.bar / mid.wash, 'bar tracks the wash exactly').toBeCloseTo(strength, 1)

    // Once the fade ends the outgoing layer stops painting: no stale artwork
    // survives behind the bar (that was the old full-session scroll cost).
    await expect.poll(async () => (await barAmbient(page)).prevArt!.backgroundImage, {
      timeout: 5_000,
      message: 'the outgoing artwork is released when the fade ends',
    }).toBe('none')
    const settled = await barAmbient(page)
    expect(settled.art!.opacity).toBeCloseTo(strength, 1)
    expect(settled.art!.backgroundImage).toContain(await activeBackdrop(page))
  })

  test('drops the bar crossfade under reduced motion', async ({ page }) => {
    // CSS media query - engine-independent, so one browser pins it.
    test.skip(test.info().project.name !== 'chromium', 'CSS-only contract, checked once')
    test.setTimeout(120_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openHero(page)
    await waitWashReady(page)
    const s = await barAmbient(page)
    expect(parseFloat(s.art!.transitionDuration), 'no fade under reduced motion').toBeLessThan(0.001)
    expect(parseFloat(s.prevArt!.transitionDuration)).toBeLessThan(0.001)
  })

  test('paints nothing on a page without a hero wash', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/docs', { waitUntil: 'domcontentloaded' })
    await page.locator('header').waitFor({ timeout: 30_000 })
    // D170: the layer is not merely transparent, it is not mounted at all -
    // an empty blurred + masked composited layer is what iOS smeared after
    // leaving fullscreen.
    await expect.poll(
      () => page.locator('[data-nav-ambient]').count(),
      { timeout: 10_000, message: 'no hero, no ambient layer in the bar' },
    ).toBe(0)
    const s = await barAmbient(page)
    expect(s.headerBackground).toBe(s.bodyBackground)
  })
})
