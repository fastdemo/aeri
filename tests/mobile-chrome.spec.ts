import { test, expect, type Page } from '@playwright/test'

/**
 * Mobile browser chrome (owner 2026-11-05).
 *
 * Two separate defects at the top of the screen on a phone / iPad:
 *
 * 1. "a faint gradient in the top bar sometimes" - the resting navbar used to
 *    paint `.nav-top-fade`, a 56px `--bg` gradient. Over a flat page
 *    background it was invisible, but it read as a band whenever content slid
 *    under the bar (the first few px of scroll, or a stale `scrolled` flag
 *    after iOS restored a scroll offset). The bar is now transparent at rest
 *    and flat `--bg` once scrolled - never a gradient.
 *
 * 2. "there is a black bar behind the clock and date ... which i also want to
 *    change to the color of the theme" - an iOS Home Screen app draws its
 *    status bar from `<meta name="theme-color">`, which iOS reads at launch
 *    BEFORE the React bundle runs. The static value was the brand black, so
 *    the bar stayed black on every theme. The head now restores the last
 *    applied theme colour from `aeri:theme-bg` (written by applyTheme) during
 *    head parse, and the app keeps the meta in sync afterwards.
 *
 * The real iOS status bar cannot be asserted headlessly; these tests pin the
 * HTML/CSS contract it depends on.
 */

const headerState = (page: Page) =>
  page.evaluate(() => {
    // The fixed element that owns the status-bar strip must carry the plain
    // colour itself (iOS 26 reads that element, not an absolute child).
    const header = document.querySelector('header[data-nav-solid]') as HTMLElement
    const cs = getComputedStyle(header)
    return {
      scrollY: window.scrollY,
      position: cs.position,
      top: cs.top,
      gradientLayers: document.querySelectorAll('.nav-top-fade').length,
      backgroundImage: cs.backgroundImage,
      backgroundColor: cs.backgroundColor,
      bodyBackgroundColor: getComputedStyle(document.body).backgroundColor,
      backdropFilter: cs.backdropFilter,
      webkitBackdropFilter: (cs as any).webkitBackdropFilter ?? 'none',
    }
  })

test.describe('mobile top bar', () => {
  test('paints a plain opaque --bg on the fixed bar itself - no gradient, no blur', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/docs', { waitUntil: 'domcontentloaded' })
    await page.locator('header').waitFor({ timeout: 30_000 })

    // WebKit can restore a scroll offset for a moment and the app then
    // scrolls to the top; let that settle before reading the resting state.
    await expect.poll(async () => (await headerState(page)).scrollY, {
      timeout: 5_000,
      message: 'the page settles at the top',
    }).toBe(0)

    // WebKit can read computed styles before the stylesheet is applied; wait
    // for the bar's own contract to settle before asserting it.
    await expect.poll(async () => (await headerState(page)).position, {
      timeout: 10_000,
      message: 'the stylesheet is applied to the bar',
    }).toBe('fixed')

    const rest = await headerState(page)
    expect(rest.position, 'the bar is the fixed element iOS reads').toBe('fixed')
    expect(rest.top).toBe('0px')
    expect(rest.gradientLayers, 'the old nav-top-fade layer is gone').toBe(0)
    expect(rest.backgroundImage, 'the header paints no gradient').toBe('none')
    // iOS 26 paints the status bar from the FIXED element's plain
    // background-color; an absolute child is ignored and a transparent
    // element is sampled once and frozen (the stale blurred band the owner
    // saw). It must be the theme background, fully opaque, with no blur.
    expect(rest.backgroundColor, 'plain --bg on the fixed header itself').toBe(rest.bodyBackgroundColor)
    expect(rest.backgroundColor, 'opaque, never translucent').not.toContain('/')
    expect(rest.backdropFilter, 'no backdrop blur').toBe('none')
    expect(rest.webkitBackdropFilter, 'no -webkit backdrop blur').toBe('none')

    await page.evaluate(() => window.scrollTo(0, 240))
    await expect.poll(async () => (await headerState(page)).scrollY, {
      timeout: 5_000,
      message: 'the page scrolls',
    }).toBeGreaterThan(0)

    const scrolled = await headerState(page)
    expect(scrolled.backgroundColor, 'the bar keeps the same flat --bg').toBe(rest.backgroundColor)
    expect(scrolled.backgroundImage).toBe('none')
    expect(scrolled.gradientLayers).toBe(0)
  })
})

test.describe('installed-app safe area (D170, owner 2026-11-07)', () => {
  test('the fixed bar grows over the status strip and stays opaque there', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/docs', { waitUntil: 'domcontentloaded' })
    await page.locator('header').waitFor({ timeout: 30_000 })

    // The page opts into full-bleed layout so the app itself can paint the
    // strip behind the clock/battery instead of showing page content there.
    const viewport = await page.getAttribute('meta[name="viewport"]', 'content')
    expect(viewport, 'the viewport opts into safe-area coverage').toContain('viewport-fit=cover')

    // Headless engines report 0 for env(safe-area-inset-top). Drive the same
    // token the real device supplies and assert the whole contract it feeds.
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '47px'))
    await expect.poll(
      () => page.evaluate(() => Math.round(
        (document.querySelector('header[data-nav-solid]') as HTMLElement).getBoundingClientRect().height,
      )),
      { timeout: 5_000, message: 'the bar grows by the status-strip inset' },
    ).toBe(103) // 56px nav row + 47px strip

    const s = await page.evaluate(() => {
      const header = document.querySelector('header[data-nav-solid]') as HTMLElement
      const cs = getComputedStyle(header)
      const bar = document.querySelector('[data-navbar-bar]') as HTMLElement
      const main = document.querySelector('main') as HTMLElement
      return {
        top: header.getBoundingClientRect().top,
        height: Math.round(header.getBoundingClientRect().height),
        paddingTop: cs.paddingTop,
        backgroundColor: cs.backgroundColor,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        barHeight: Math.round(bar.getBoundingClientRect().height),
        mainPaddingTop: getComputedStyle(main).paddingTop,
      }
    })
    expect(s.top, 'the strip is covered from the very top of the screen').toBe(0)
    expect(s.height).toBe(103)
    expect(s.paddingTop, 'the nav row sits below the strip').toBe('47px')
    expect(s.barHeight, 'the tappable row keeps its 56px height').toBe(56)
    expect(s.mainPaddingTop, 'page content starts below the bar').toBe('103px')
    expect(s.backgroundColor, 'the strip is the theme colour, not page content').toBe(s.bodyBackground)
  })
})

test.describe('bottom overscroll keeps the navbar painted (owner 2026-11-08)', () => {
  test('bounce is contained at the document and the bar keeps its own layer', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 })
    await page.goto('/docs', { waitUntil: 'domcontentloaded' })
    await page.locator('header').waitFor({ timeout: 30_000 })

    await expect.poll(async () => (await headerState(page)).position, {
      timeout: 10_000,
      message: 'the stylesheet is applied to the bar',
    }).toBe('fixed')

    const state = await page.evaluate(() => {
      const header = document.querySelector('header[data-nav-solid]') as HTMLElement
      const cs = getComputedStyle(header)
      const html = getComputedStyle(document.documentElement)
      const body = getComputedStyle(document.body)
      return {
        position: cs.position,
        top: cs.top,
        transform: cs.transform,
        zIndex: cs.zIndex,
        overscrollHtmlY: html.overscrollBehaviorY,
        overscrollBodyY: body.overscrollBehaviorY,
      }
    })

    // The owner asked for the natural rubber-band (never `none`) BUT the bar
    // must stay on its line during a mobile overscroll (2026-11-08), so the
    // document's own bounce is contained instead of chaining.
    expect(state.overscrollHtmlY, 'document overscroll is contained').toBe('contain')
    expect(state.overscrollBodyY, 'body overscroll is contained').toBe('contain')

    // iOS can drop a plain fixed layer while the scroll view bounces; the
    // bar is promoted to its own GPU layer so it keeps painting.
    expect(state.position, 'the bar is the fixed element iOS reads').toBe('fixed')
    expect(state.top).toBe('0px')
    expect(state.transform, 'own composited layer (translateZ(0))')
      .toMatch(/matrix3d|matrix\(1, 0, 0, 1, 0, 0\)/)
    expect(Number(state.zIndex)).toBeGreaterThanOrEqual(50)
  })
})

test.describe('iOS Home Screen status bar', () => {
  test('opts into black-translucent so the page owns the strip (D173)', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' })
    const meta = (name: string) =>
      page.locator(`meta[name="${name}"]`).getAttribute('content')

    expect(await meta('apple-mobile-web-app-capable'), 'standalone mode').toBe('yes')
    expect(await meta('mobile-web-app-capable'), 'standalone mode (standard name)').toBe('yes')
    expect(await meta('apple-mobile-web-app-title')).toBe('Aeri')
    // `black-translucent` is the only mode where iOS stops drawing the
    // translucent "Liquid Glass" bar and lets the app paint the strip with
    // its own opaque --bg (the fixed [data-nav-status-strip]). The boot
    // script downgrades to `default` on light themes, where the forced white
    // clock would be unreadable (asserted in the next test).
    expect(await meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent')
    expect(await meta('theme-color')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test('a light saved theme downgrades the status bar to default', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('aeri:theme-bg', '#f5f5f5'))
    await page.route('**/assets/*.js', (route) => route.abort())
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    expect(
      await page
        .locator('meta[name="apple-mobile-web-app-status-bar-style"]')
        .getAttribute('content'),
      'white icons stay off light themes',
    ).toBe('default')
  })

  test('the head restores the saved theme colour before the app bundle runs', async ({ page }) => {
    // Seed what applyTheme persists, then block the module bundle: only the
    // inline head script can run - the same window iOS reads the meta in.
    await page.addInitScript(() => localStorage.setItem('aeri:theme-bg', '#1e1e2e'))
    await page.route('**/assets/*.js', (route) => route.abort())
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#1e1e2e')
    const htmlBg = await page.evaluate(() => document.documentElement.style.backgroundColor)
    expect(htmlBg, 'the boot script paints the saved colour too').toBe('rgb(30, 30, 46)')
  })
})
