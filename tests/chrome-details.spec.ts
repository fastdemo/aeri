import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'

/**
 * CHROME DETAILS (D174).
 *
 * Owner batch, 2026-11-08:
 *  - Settings About entries (GitHub / Analytics / Design) drop their
 *    underlines and hover with the footer's quiet colour fade.
 *  - The footer's GitHub / Docs / Legal links gain icons and the same faint
 *    middot separation as the Settings row, so both surfaces read as one
 *    system.
 *  - The preview card's banner gradient ends in the dialog's own base colour
 *    (`--bg-soft`), not a different dark tone.
 *  - Home paints its rows from the synchronous session cache on a return
 *    visit: no skeleton rows to scroll into.
 */

test.describe('D174 chrome details', () => {
  test('Settings About: no underlines, footer-style hover', async ({ page }) => {
    // /settings redirects signed-out visitors home, so seed the test session
    // AND answer the MAL identity calls - an unanswered fake token would 401,
    // clear the token and sign the page out mid-test.
    await seedTestAuth(page)
    await routeTestMalIdentity(page)
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    const github = page.getByRole('main').getByRole('link', { name: 'GitHub' })
    await expect(github).toBeVisible({ timeout: 30_000 })

    const read = () =>
      github.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { deco: cs.textDecorationLine, color: cs.color }
      })
    // The production stylesheet can land a frame after the link is visible,
    // so wait for the resolved (not the UA-default) value.
    await expect.poll(async () => (await read()).deco, { timeout: 15_000 }).toBe('none')
    const before = await read()

    // Touch layouts never fire :hover, so the fade is asserted where the
    // pointer actually hovers.
    if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
      await github.hover()
      await page.waitForTimeout(350)
      const after = await github.evaluate((el) => getComputedStyle(el).color)
      expect(after, 'hover fades the colour like the footer links').not.toBe(before.color)
    }

    const row = github.locator('xpath=..')
    for (const label of ['Analytics', 'Design']) {
      const el = row.getByText(label, { exact: true })
      await expect
        .poll(async () => el.evaluate((n) => getComputedStyle(n).textDecorationLine), {
          timeout: 15_000,
        })
        .toBe('none')
      // Placeholders: they read as entries but are deliberately not links.
      expect(await el.evaluate((n) => n.tagName)).toBe('SPAN')
    }
  })

  test('footer links carry icons and middot separation', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 640, 'footer is hidden below the sm boundary')
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const footer = page.locator('footer')
    await footer.scrollIntoViewIfNeeded()
    await expect(footer).toBeVisible()

    const info = await footer.evaluate((el) => ({
      links: [...el.querySelectorAll('a')].map((a) => ({
        text: (a.textContent || '').trim(),
        svg: a.querySelectorAll('svg').length,
      })),
      dots: (el.textContent || '').split('•').length - 1,
    }))

    expect(info.links.map((l) => l.text)).toEqual(
      expect.arrayContaining(['GitHub', 'Docs', 'Legal']),
    )
    for (const name of ['GitHub', 'Docs', 'Legal']) {
      expect(info.links.find((l) => l.text === name)?.svg, `${name} has an icon`).toBe(1)
    }
    expect(info.dots, 'two middots separate the three links').toBe(2)
  })

  test('preview banner bottom matches the card base', async ({ page }) => {
    await page.goto('/anime', { waitUntil: 'domcontentloaded' })
    const card = page.locator('.card-art').nth(8)
    await expect(card).toBeVisible({ timeout: 45_000 })
    await card.click({ position: { x: 18, y: 18 } })

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(500)

    const m = await dialog.evaluate((el) => {
      const scrim = el.querySelector('.detail-banner-scrim') as HTMLElement | null
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--bg-soft)'
      document.body.appendChild(probe)
      const base = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        base,
        dialogBg: getComputedStyle(el).backgroundColor,
        scrim: scrim ? getComputedStyle(scrim).backgroundImage : null,
      }
    })
    expect(m.dialogBg, 'dialog sits on --bg-soft').toBe(m.base)
    expect(m.scrim, 'the banner gradient ends in the card base').toContain(m.base)
  })
})

test.describe('D174 home session cache', () => {
  test('returning to Home paints real rows immediately (no skeleton)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect
      .poll(async () => page.locator('section.content-row').count(), { timeout: 60_000 })
      .toBeGreaterThan(0)

    // Leave Home through the navbar, then come back - same JS module, so the
    // synchronous session cache still holds the feed.
    const menu = page.getByRole('button', { name: 'Menu' })
    if (await menu.isVisible().catch(() => false)) await menu.click()
    await page.getByRole('link', { name: 'Anime' }).first().click()
    await expect(page).toHaveURL(/\/anime/)
    await page.getByRole('link', { name: /aeri home/i }).first().click()

    await page.waitForFunction(
      () => document.querySelectorAll('section.content-row').length > 0,
      undefined,
      { timeout: 20_000 },
    )
    const skeletons = await page.locator('[data-card-skeleton]').count()
    expect(skeletons, 'cached rows, not skeleton rows').toBe(0)
  })
})
