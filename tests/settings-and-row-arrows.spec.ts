import { test, expect, type Page } from '@playwright/test'
import { routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * D141 — row arrows + Settings functional audit.
 *
 * ARROWS: the row scroller paints AFTER the arrow buttons in DOM order, and
 * the card's hover play glyph is z-10. The arrow must sit at z-30 so the
 * scrim + chevron win hit-testing over any card content beneath them; a
 * click on the strip must scroll the row, never open the anime.
 *
 * SETTINGS: every control must persist through a reload and actually apply.
 * "Preferred source" is removed — provider order is the only mechanism.
 * Reset must re-apply the default theme in place (the theme lives on <html>,
 * so deleting `aeri:prefs` alone left the old theme painted).
 */

async function seedAuthOnly(page: Page) {
  // Minimal auth seed (NOT seedTestAuth): that helper rewrites `aeri:prefs`
  // on every document load, which would erase the values under test across
  // the reload assertions.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('aeri:mal:access_token', 'aeri-test-token')
      localStorage.removeItem('aeri:anilist:token')
    } catch {}
  })
  await routeTestMalIdentity(page)
  await routeTestAnilistMedia(page)
}

const prefsOf = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('aeri:prefs') ?? '{}'))

test.describe('row navigation arrows', () => {
  test('sit above cards, carry no circle, and scroll instead of navigating', async ({ page }) => {
    const vw = page.viewportSize()?.width ?? 0
    test.skip(vw < 768, 'row arrows are desktop-only (md:flex)')
    test.setTimeout(60_000)
    await page.route('**.{jpg,jpeg,png,webp,avif}', r => r.abort())
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const right = page.locator('[aria-label="Scroll right"]').first()
    await right.waitFor({ state: 'attached', timeout: 30_000 })

    // Structure: one chevron glyph, no inner circle chrome.
    await expect(right.locator('svg')).toHaveCount(1)
    await expect(right.locator('span')).toHaveCount(0)

    const style = await right.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { z: cs.zIndex, bg: cs.backgroundImage }
    })
    expect(style.z, 'arrow must paint above the card glyph (z-30)').toBe('30')
    expect(style.bg, 'scrim is 75% of the theme background').toContain('0.75')

    // Hit-test: a point inside the strip that is over a card must resolve to
    // the arrow, not the card link underneath it.
    const box = await right.boundingBox()
    expect(box, 'arrow has a box').toBeTruthy()
    const x = box!.x + box!.width - 8
    const y = box!.y + box!.height / 2
    await page.mouse.move(x, y)
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return {
        isArrow: !!el?.closest('button[aria-label="Scroll right"]'),
        tag: el?.tagName ?? null,
      }
    }, { x, y })
    expect(hit.isArrow, `elementFromPoint hit ${hit.tag}, expected the arrow`).toBe(true)

    // Clicking it scrolls; it must never open the card beneath.
    await page.mouse.click(x, y)
    await expect
      .poll(async () => page.evaluate(() => {
        const row = document.querySelector('[aria-label="Scroll right"]')?.parentElement?.querySelector('div.no-scrollbar')
        return (row as HTMLElement | null)?.scrollLeft ?? 0
      }), { timeout: 8_000 })
      .toBeGreaterThan(0)
    expect(new URL(page.url()).pathname).toBe('/')

    // The left arrow appears after scrolling and mirrors the treatment.
    const left = page.locator('[aria-label="Scroll left"]').first()
    await left.waitFor({ state: 'attached', timeout: 8_000 })
    await expect(left.locator('svg')).toHaveCount(1)
    expect(await left.evaluate((el) => getComputedStyle(el).zIndex)).toBe('30')
  })
})

test.describe('settings controls', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthOnly(page)
  })

  test('preferred source is gone; playback, reader, provider order, theme and reset all work', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Anime providers', { timeout: 45_000 })

    // Removed setting.
    await expect(page.getByText('Preferred source', { exact: true })).toHaveCount(0)

    // Subtitles: toggles persist through reload.
    const subs = page.getByRole('switch', { name: 'Subtitles on' })
    await expect(subs).toHaveAttribute('aria-checked', 'true')
    await subs.click()
    await expect(subs).toHaveAttribute('aria-checked', 'false')
    expect((await prefsOf(page)).subtitles).toBe(false)

    // Reader fit: applies to the reader pref and persists.
    const height = page.getByRole('radio', { name: 'Height', exact: true })
    await height.click()
    await expect(height).toHaveAttribute('aria-checked', 'true')
    expect((await prefsOf(page)).readerFit).toBe('height')

    // Provider order: the grip is the only reorder control. Keyboard ↑/↓ on
    // the focused grip rewrites the real resolution order (WCAG 2.5.7
    // alternative to dragging).
    const animeSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Anime', exact: true }) })
    const names = () => animeSection.locator('button[aria-label^="Reorder "]').evaluateAll((btns) =>
      btns.map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Reorder /, '')))
    const before = await names()
    expect(before.length).toBeGreaterThan(1)
    // Default priority (D144): AniWave → AnimeParadise → AnimeGG.
    expect(before).toEqual(['AniWave', 'AnimeParadise', 'AnimeGG'])

    // Manga default priority (D144): Weeb Central → MangaHere → MangaPill →
    // MangaDex. The Settings list derives from the registry array, so this
    // pins the same order resolution uses.
    const mangaSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Manga', exact: true }) })
    const mangaNames = await mangaSection.locator('button[aria-label^="Reorder "]').evaluateAll((btns) =>
      btns.map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Reorder /, '')))
    expect(mangaNames).toEqual(['Weeb Central', 'MangaHere', 'MangaPill', 'MangaDex'])

    await animeSection.getByRole('button', { name: `Reorder ${before[0]}` }).focus()
    await page.keyboard.press('ArrowDown')
    const after = await names()
    expect(after[0]).toBe(before[1])
    const order = (await prefsOf(page)).providerOrder
    expect(Array.isArray(order) && order.length >= 2).toBe(true)

    // Theme: instant paint + persistence.
    await page.getByRole('radio', { name: 'Aeri Light', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'aeri-light')

    // Reload: every change above survives.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Anime providers', { timeout: 45_000 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'aeri-light')
    await expect(page.getByRole('switch', { name: 'Subtitles on' })).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByRole('radio', { name: 'Height', exact: true })).toHaveAttribute('aria-checked', 'true')
    const afterReload = await names()
    expect(afterReload[0]).toBe(before[1])

    // Reset: defaults restored AND the theme repainted without a reload.
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Reset local data' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'aeri-dark')
    await expect(page.getByRole('switch', { name: 'Subtitles on' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Width', exact: true })).toHaveAttribute('aria-checked', 'true')
    const reset = await prefsOf(page)
    expect(reset.theme).toBe('aeri-dark')
    expect(reset.readerFit).toBe('width')
    expect(reset.providerOrder ?? null).toBeNull()
  })

  test('provider rows reorder by dragging the grip; the arrow buttons are gone', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Anime providers', { timeout: 45_000 })

    const animeSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Anime', exact: true }) })
    // The ↑/↓ buttons were replaced by the drag grip — nothing may remain.
    await expect(animeSection.locator('button[aria-label^="Move "]')).toHaveCount(0)

    const rows = animeSection.locator('[data-provider-row]')
    const first = rows.nth(0)
    const grip = first.getByRole('button', { name: 'Reorder AniWave' })
    await grip.scrollIntoViewIfNeeded()
    const gripBox = await grip.boundingBox()
    const rowBox = await first.boundingBox()
    expect(gripBox && rowBox).toBeTruthy()
    if (!gripBox || !rowBox) return

    // Drag AniWave past AnimeParadise's midpoint.
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      gripBox.x + gripBox.width / 2,
      gripBox.y + gripBox.height / 2 + rowBox.height + 12,
      { steps: 10 },
    )
    await page.mouse.up()

    const order = await rows.evaluateAll((els) =>
      els.map((el) => (el.querySelector('button[aria-label^="Reorder "]')?.getAttribute('aria-label') ?? '').replace(/^Reorder /, '')))
    expect(order).toEqual(['AnimeParadise', 'AniWave', 'AnimeGG'])
    expect((await prefsOf(page)).providerOrder?.slice(0, 3)).toEqual(['animeparadise', 'aniwave', 'animegg'])
  })
})
