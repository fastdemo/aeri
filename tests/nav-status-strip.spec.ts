import { test, expect } from '@playwright/test'

/**
 * INSTALLED-APP STATUS STRIP (D173).
 *
 * In an installed iOS/iPadOS web app the clock sits over the page and WebKit
 * samples the top edge's colour from a fixed element. The navbar is skipped
 * because it is a transformed layer (translateZ(0), the rubber-band fix), so
 * the strip showed blurred page content above the bar. The fix is a real,
 * untransformed fixed strip at the very top, painted opaque `--bg`.
 *
 * A browser tab cannot reproduce the iOS strip, but it can pin the pieces the
 * fix depends on:
 *   - the strip exists, is fixed, full width, opaque and above the navbar,
 *   - it takes no pointer events,
 *   - in a normal tab it has zero height, so it cannot clip the navbar's
 *     ambient wash on desktop,
 *   - the strip height and the header's top padding come from the SAME token,
 *     so the standalone minimum shifts the bar's row instead of covering it,
 *   - that standalone minimum is declared on `--safe-top` itself.
 */

test.describe('Navbar - installed-app status strip', () => {
  test('opaque fixed strip sits above the navbar and stays out of the way in a tab', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    const m = await page.evaluate(() => {
      const el = document.querySelector('[data-nav-status-strip]') as HTMLElement | null
      const nav = document.querySelector('[data-nav-solid]') as HTMLElement | null
      if (!el || !nav) return null
      const cs = getComputedStyle(el)
      const navCs = getComputedStyle(nav)
      const r = el.getBoundingClientRect()
      return {
        position: cs.position,
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height * 10) / 10,
        viewportWidth: document.documentElement.clientWidth,
        background: cs.backgroundColor,
        pointerEvents: cs.pointerEvents,
        zIndex: Number(cs.zIndex),
        navZIndex: Number(getComputedStyle(nav).zIndex),
        navBg: navCs.backgroundColor,
        safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
        navPadTop: Math.round(parseFloat(navCs.paddingTop)),
        navHeight: Math.round(nav.getBoundingClientRect().height),
      }
    })

    expect(m, 'the status strip must render').not.toBeNull()
    expect(m!.position).toBe('fixed')
    expect(m!.top).toBe(0)
    expect(m!.left).toBe(0)
    expect(m!.width, 'the strip spans the whole viewport').toBe(m!.viewportWidth)
    expect(m!.pointerEvents, 'the strip never eats taps').toBe('none')
    expect(m!.zIndex, 'the strip sits above the navbar').toBeGreaterThan(m!.navZIndex)
    // Same opaque colour as the bar it covers: no page content can show.
    expect(m!.background).toBe(m!.navBg)
    expect(m!.background).toMatch(/^rgb\(/)
    // In a browser tab (no top inset) it must not clip the navbar's ambient.
    expect(m!.safeTop).toBe('0px')
    expect(m!.height, 'no status strip in a normal tab').toBe(0)
    // The strip and the bar's top padding are the same band: whatever the
    // safe-area is, the bar's 56px row always starts where the strip ends.
    expect(m!.navPadTop).toBe(m!.height)
    expect(m!.navHeight).toBe(56 + m!.height)
  })

  test('the app opts into black-translucent so iOS stops painting the blur', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)

    const bar = await page.evaluate(
      () => document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? null,
    )
    // `default` keeps iOS 26's translucent bar and its blurred page slice;
    // only `black-translucent` hands the strip to the page so the opaque
    // `[data-nav-status-strip]` can cover it.
    expect(bar).toBe('black-translucent')
  })
})
