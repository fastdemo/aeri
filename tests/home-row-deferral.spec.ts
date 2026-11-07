import { test, expect, type Page } from '@playwright/test'

/**
 * D165 — Home must not mount every card on first paint.
 *
 * Owner report (2026-11-05, third time): "it still feels laggy as hell as
 * cards are loaded in". Home mounts nine rows at once; only the first row or
 * two are on screen. Each AnimeCard carries hooks, effects, its own
 * proximity observer and an image gate, so committing ~108 of them is the
 * load-phase freeze (measured at 4x CPU: 133ms of blocking time and a
 * ~400ms style/layout frame).
 *
 * A row now mounts its cards only when it comes near the viewport, painting
 * static same-geometry placeholders until then (no shimmer, no pulse). These
 * tests pin the contract that matters to the user:
 *
 *  1. offscreen rows are deferred (placeholders, no card elements),
 *  2. the deferred placeholders reserve the same height as the real row —
 *     the page must not jump when a row mounts,
 *  3. scrolling the feed mounts every row (nothing stays blank forever),
 *  4. the placeholders animate nothing (an infinite pulse on an offscreen
 *     row is pure main-thread cost).
 */

async function loadHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect
    .poll(async () => page.locator('section.content-row').count(), { timeout: 45_000 })
    .toBeGreaterThan(0)
  // Let the feed settle so every row that is going to exist has mounted.
  await expect
    .poll(async () => page.locator('section.content-row .card-art').count(), { timeout: 45_000 })
    .toBeGreaterThan(0)
  await page.waitForTimeout(1500)
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('section.content-row'))
    return {
      rows: rows.length,
      cards: rows.reduce((n, r) => n + r.querySelectorAll('.card-art').length, 0),
      perRow: rows.map((r) => r.querySelectorAll('.card-art').length),
      // A deferred row's scroller holds static placeholder boxes (aria-hidden,
      // card-shaped) instead of card buttons. Mounted rows carry a 1px
      // trailing spacer that is also aria-hidden, so count only the
      // card-shaped boxes.
      placeholders: rows.map((r) => {
        const scroller = r.querySelector('.no-scrollbar')
        if (!scroller) return 0
        return Array.from(scroller.children).filter(
          (c) => c.getAttribute('aria-hidden') === 'true' && /aspect-\[/.test(c.className.toString()),
        ).length
      }),
      animated: rows.map(
        (r) =>
          Array.from(r.querySelectorAll<HTMLElement>('*')).filter(
            (el) => getComputedStyle(el).animationName !== 'none',
          ).length,
      ),
      height: document.documentElement.scrollHeight,
    }
  })
}

test('offscreen rows are deferred, then mount on scroll without a jump', async ({ page }) => {
  test.setTimeout(180_000)
  await loadHome(page)

  const before = await measure(page)
  const total = before.rows * 12
  const deferredRows = before.perRow.map((n, i) => (n === 0 ? i : -1)).filter((i) => i >= 0)

  expect(before.rows, 'the feed renders rows').toBeGreaterThan(1)
  // Something is deferred — otherwise the gate is not doing anything.
  expect(before.cards, 'not every card is mounted on first paint').toBeLessThan(total)
  expect(deferredRows.length, 'rows below the fold are deferred').toBeGreaterThan(0)
  // Deferred rows paint same-geometry placeholders (so the page keeps its
  // height) and run no animation at all.
  for (const i of deferredRows) {
    expect(before.placeholders[i], `row ${i} paints placeholders`).toBeGreaterThanOrEqual(6)
    expect(before.animated[i], `row ${i} animates nothing`).toBe(0)
  }

  // Scroll the whole feed: every row must mount its real cards.
  await page.evaluate(async () => {
    const step = Math.ceil((document.documentElement.scrollHeight - window.innerHeight) / 24)
    for (let i = 0; i < 24; i++) {
      window.scrollBy(0, step)
      await new Promise((r) => setTimeout(r, 70))
    }
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise((r) => setTimeout(r, 1500))
  })

  const after = await measure(page)
  expect(after.cards, 'scrolling mounts the rest of the feed').toBeGreaterThan(before.cards)
  expect(Math.min(...after.perRow), 'no row stays empty').toBeGreaterThanOrEqual(10)
  expect(after.placeholders.every((n) => n === 0), 'placeholders are gone').toBe(true)
  // Same-height placeholders: mounting must not move the page under the
  // user's thumb (the scrollbar may shift a hair from the title line).
  expect(Math.abs(after.height - before.height), 'no page-height jump').toBeLessThanOrEqual(80)
})
