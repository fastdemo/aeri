import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * D159 - the ⋮ on a Continue Watching card must survive the pointer handoff
 * from thumbnail to trigger, and the card must keep its hover treatment
 * while the pointer is on the dots.
 *
 * Owner (2026-11-01): "when i hover continue watching i cannot click on
 * 3dots because i am not touching the thumbnail anymore so the menu stop
 * hovering so fix that too."
 * Owner (2026-11-04): "when i hover over 3 dots it shall still have the
 * hover blur and the play button and such as it belongs to that component."
 *
 * The trigger overlaps the artwork but is NOT a descendant of the art div
 * (it has to stay outside the frame's overflow-hidden so its dropdown is
 * never clipped). The reveal rule used to match only `:has(art:hover)`, so
 * the instant the pointer landed on the dots the art lost hover and the
 * control faded to opacity 0 under the cursor. The rule now also matches
 * `.card-dots-trigger:hover`, and the same trigger-hover state mirrors the
 * art's hover treatment (frost/blur, play glyph, caption, progress swap).
 */

test('⋮ stays visible, clickable and keeps the card hover treatment', async ({ page }) => {
  test.setTimeout(90_000)
  await seedTestAuth(page)
  await routeTestMalIdentity(page, [
    { malId: 20, title: 'Naruto', numEpisodes: 220, progress: 20 },
  ])
  await routeTestAnilistMedia(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const section = page.locator('section', { hasText: 'Continue Watching' }).first()
  await section.waitFor({ timeout: 30_000 })
  const card = section.locator('button[aria-label^="Open Naruto"], a[aria-label^="Open Naruto"]').first()
  await card.waitFor({ timeout: 30_000 })
  const art = card.locator('.card-art').first()
  const trigger = card.locator('.card-dots-trigger').first()
  await trigger.waitFor({ state: 'attached', timeout: 15_000 })

  const opacity = () => trigger.evaluate((el) => getComputedStyle(el).opacity)

  // Everything the art-hover state paints: the dark scrim + 8px blur, the
  // centre play glyph, the title/episode caption, and the continue-progress
  // pill hidden underneath the caption.
  const treatment = () =>
    card.evaluate((el) => {
      const css = (sel: string) => {
        const node = el.querySelector(sel) as HTMLElement | null
        return node ? getComputedStyle(node) : null
      }
      const frost = css('.card-frost')
      const glyph = css('button[aria-label^="Play episode"]')
      const caption = css('.card-hover-caption')
      const progress = css('.continue-progress')
      return {
        frost: frost?.opacity ?? null,
        blur: frost?.backdropFilter ?? null,
        glyph: glyph?.opacity ?? null,
        caption: caption?.opacity ?? null,
        captionShift: caption?.translate ?? null,
        progress: progress?.opacity ?? null,
      }
    })

  // The fixture carries no cover art, so the image brighten has no node to
  // assert here; the rule is still part of the treatment (globals.css).
  const hovered = {
    frost: '1',
    blur: 'blur(8px)',
    glyph: '1',
    caption: '1',
    captionShift: '0px',
    progress: '0',
  }

  // Resting state: the trigger is invisible until the thumbnail is hovered.
  expect(await opacity()).toBe('0')

  // Thumbnail hover reveals it (the pre-existing contract).
  await art.hover()
  await expect.poll(opacity, { timeout: 5_000 }).toBe('1')
  await expect.poll(treatment, { timeout: 5_000 }).toEqual(hovered)

  // THE REGRESSION: move the pointer onto the ⋮ itself. The art is no
  // longer hovered here - only the trigger's own :hover branch keeps the
  // control visible, and the treatment must not collapse.
  await trigger.hover()
  await expect.poll(opacity, { timeout: 5_000 }).toBe('1')
  await expect.poll(treatment, { timeout: 5_000 }).toEqual(hovered)

  await trigger.click()
  const menu = card.locator('[role="menu"]')
  await expect(menu).toBeVisible({ timeout: 5_000 })
  await expect(menu.getByRole('menuitem', { name: 'Mark as watched' })).toBeVisible()
})
