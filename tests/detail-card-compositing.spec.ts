import { test, expect, type Page } from '@playwright/test'

/**
 * DETAIL OVERLAY COMPOSITING REGRESSION (fast-scroll flicker).
 *
 * The floating preview card used to flicker while fast-scrolling its content.
 * Root cause was NOT hover frost (D143) — it was compositing:
 *
 *  - `.anim-pop-in-center` used `animation-fill-mode: both`, so the entrance
 *    animation kept `transform: matrix(1,0,0,1,0,0)` on the card forever.
 *    A retained transform promotes the element to its own composited layer,
 *    and the card is as tall as the whole detail body: CDP LayerTree measured
 *    2344 x 173,954 px on /anime/21 and 2344 x 38,643 px on /manga/30002.
 *    Re-rastering that layer during a scroll is the visible flicker.
 *
 *  - The scroll container itself carried the veil's `backdrop-blur-[2px]`.
 *    `backdrop-filter` on a scroller promotes the ENTIRE scrollable content
 *    height (2880 x 173,794 px measured) into one layer, and it also makes the
 *    scroller a containing block for fixed descendants (the D109 trap).
 *
 * The fix: entrance animations use `backwards` (identity transform is released
 * once they finish), and the veil's tint + blur live on a static, fixed,
 * pointer-events-none sibling instead of the scroller.
 *
 * These tests pin the COMPUTED values, not the class names, so any future
 * "just animate it" change that reintroduces a retained transform or a
 * filtered scroller fails here.
 */

async function openPreview(page: Page, path = '/anime', index = 8) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  const card = page.locator('.card-art').nth(index)
  await expect(card).toBeVisible({ timeout: 45_000 })
  // Click a CORNER of the art: the centred play/read glyph appears on hover
  // and would swallow a default centre click (it navigates to watch/read).
  await card.click({ position: { x: 18, y: 18 } })
  const dialog = page.locator('[role="dialog"]')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  // Let the 200ms entrance animation finish — the assertions are about the
  // SETTLED state, which is where the old retained transform lived.
  await page.waitForTimeout(500)
  return dialog
}

test.describe('Detail preview card is not a giant composited layer', () => {
  test('settled card releases its transform (no retained layer)', async ({ page }) => {
    const dialog = await openPreview(page)
    const style = await dialog.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { transform: cs.transform, fill: cs.animationFillMode, willChange: cs.willChange }
    })

    // `both` retains the final keyframe -> matrix(1,0,0,1,0,0) forever.
    expect(style.transform, 'settled card has no transform').toBe('none')
    expect(style.fill, 'entrance animation does not fill forwards').not.toBe('both')
    expect(style.fill, 'entrance animation keeps its from-state before start').toBe('backwards')
    expect(style.willChange, 'card does not ask for permanent promotion').toBe('auto')
  })

  test('manga card gets the identical shell', async ({ page }) => {
    const dialog = await openPreview(page, '/manga', 7)
    const style = await dialog.evaluate((el) => {
      const scroller = el.parentElement as HTMLElement
      const veil = scroller.previousElementSibling as HTMLElement
      return {
        transform: getComputedStyle(el).transform,
        scrollerBackdrop: getComputedStyle(scroller).backdropFilter,
        veilBackdrop: getComputedStyle(veil).backdropFilter,
        veilPosition: getComputedStyle(veil).position,
      }
    })
    expect(style.transform).toBe('none')
    expect(style.scrollerBackdrop).toBe('none')
    expect(style.veilBackdrop).toContain('blur(2px)')
    expect(style.veilPosition).toBe('fixed')
  })

  test('the card is genuinely taller than the GPU-friendly range', async ({ page }) => {
    // One Piece: 1180 episodes — the exact fixture that measured a
    // 2344 x 173,954 px card layer before the fix.
    await page.goto('/anime/21', { waitUntil: 'domcontentloaded' })
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 45_000 })
    await page.waitForTimeout(1500)
    const heights = await dialog.evaluate((el) => {
      const scroller = el.parentElement as HTMLElement
      return { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, card: el.getBoundingClientRect().height }
    })
    // Sanity: this fixture is why a retained layer was pathological.
    expect(heights.scrollHeight).toBeGreaterThan(heights.clientHeight * 10)
    expect(heights.card).toBeGreaterThan(heights.clientHeight)
  })

  test('veil tint + blur sit on a static layer, never on the scroller', async ({ page }) => {
    const dialog = await openPreview(page)
    const shell = await dialog.evaluate((el) => {
      const scroller = el.parentElement as HTMLElement
      const veil = scroller.previousElementSibling as HTMLElement
      const ss = getComputedStyle(scroller)
      const vs = getComputedStyle(veil)
      return {
        scrollerBackdrop: ss.backdropFilter,
        scrollerBg: ss.backgroundColor,
        veilPosition: vs.position,
        veilBackdrop: vs.backdropFilter,
        veilBg: vs.backgroundColor,
        veilPointerEvents: vs.pointerEvents,
        veilAriaHidden: veil.getAttribute('aria-hidden'),
        scrollerZ: ss.zIndex,
        veilZ: vs.zIndex,
      }
    })

    // A filtered scroller = full-content-height layer + fixed-containing-block.
    expect(shell.scrollerBackdrop, 'scroller has no backdrop-filter').toBe('none')
    expect(shell.scrollerBg, 'scroller is paint-transparent').toBe('rgba(0, 0, 0, 0)')

    // The veil is the static layer: fixed, viewport-sized, inert to pointers,
    // and still painting the same tint + 2px blur behind the card.
    expect(shell.veilPosition).toBe('fixed')
    expect(shell.veilBackdrop).toContain('blur(2px)')
    expect(shell.veilBg).not.toBe('rgba(0, 0, 0, 0)')
    expect(shell.veilPointerEvents).toBe('none')
    expect(shell.veilAriaHidden).toBe('true')
    // Same stacking level, veil first in DOM so the card paints above it.
    expect(shell.veilZ).toBe(shell.scrollerZ)
  })

  test('the veil stays put while the card scrolls under it', async ({ page }) => {
    const dialog = await openPreview(page)
    const before = await dialog.evaluate((el) => {
      const scroller = el.parentElement as HTMLElement
      const veil = scroller.previousElementSibling as HTMLElement
      scroller.scrollTop = 1200
      return veil.getBoundingClientRect().toJSON()
    })
    await page.waitForTimeout(200)
    const after = await dialog.evaluate((el) => {
      const scroller = el.parentElement as HTMLElement
      const veil = scroller.previousElementSibling as HTMLElement
      return { veil: veil.getBoundingClientRect().toJSON(), scrolled: scroller.scrollTop }
    })

    expect(after.scrolled, 'the scroller actually moved').toBeGreaterThan(1000)
    expect(after.veil.y).toBe(before.y)
    expect(after.veil.height).toBe(before.height)
  })

  test('clicking the veil still dismisses from a scrolled position', async ({ page }) => {
    const dialog = await openPreview(page)
    await dialog.evaluate((el) => {
      const scroller = el.parentElement as HTMLElement
      scroller.scrollTop = 1500
    })
    await page.waitForTimeout(250)
    // Click the band above the card, in the scroller's own coordinates.
    await page.mouse.click(40, 300)
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 })
  })
})
