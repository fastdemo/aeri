import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * D150 — Continue Watching is a NORMAL AnimeCard plus a floating progress
 * pill, not a card with its own caption block.
 *
 * Owner (2026-10-29): "i want the continue watching cards to look the same
 * as normal anime cards, but then it will have a floating progress bar a few
 * pixels up from the bottom, as well as left/right margins, preferably with
 * some kind of shadow behind (still neon). on hover, the progress bar will
 * hide to show the show name/genre like normal anime cards ... the 3 dots on
 * hover will still be there."
 *
 * Owner (2026-10-31, D155): "for the continue watching progress bar, return
 * to the old floating progress bar, and put a gradient behind it like what
 * you did on the media player page episodes."
 *
 * Contract:
 *  - no caption block under the art (card height == artwork height);
 *  - bar inset 8px from left/right/bottom, 3px tall, rounded;
 *  - THEME-INK NEON: 15% `--text` track + `--text` fill with a 6px `--text`
 *    glow (the D154 fixed-neutral palette and its 8px track frost are gone);
 *  - a bottom `--bg` scrim behind the bar (the Watch page episode gradient),
 *    spanning the card width and reaching the bottom edge;
 *  - bar visible at rest, opacity 0 on art hover;
 *  - hover caption = show name + NEXT episode (name, or honest "Episode N");
 *  - the ⋮ trigger still reveals on art hover.
 */

test('continue card = normal card + floating neon bar; hover swaps to caption', async ({ page }) => {
  test.setTimeout(90_000)
  await seedTestAuth(page)
  await routeTestMalIdentity(page, [
    { malId: 20, title: 'Naruto', numEpisodes: 220, progress: 20 },
  ])
  await routeTestAnilistMedia(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const section = page.locator('section', { hasText: 'Continue Watching' }).first()
  await section.waitFor({ timeout: 30_000 })
  const card = section.locator('button[aria-label^="Open Naruto"]').first()
  await card.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)

  const geom = await card.evaluate((el) => {
    const art = el.querySelector('.card-art') as HTMLElement
    const wrap = el.querySelector('.continue-progress') as HTMLElement
    const bar = el.querySelector('[data-continue-bar]') as HTMLElement
    const scrim = el.querySelector('[data-continue-scrim]') as HTMLElement
    const fill = bar?.firstElementChild as HTMLElement | null
    // Resolve the theme ink the card actually paints with.
    const probe = document.createElement('span')
    probe.style.color = 'var(--text)'
    art.appendChild(probe)
    const ink = getComputedStyle(probe).color
    probe.remove()
    const r = el.getBoundingClientRect()
    const a = art.getBoundingClientRect()
    const b = bar.getBoundingClientRect()
    const s = scrim.getBoundingClientRect()
    return {
      cardH: Math.round(r.height),
      artH: Math.round(a.height),
      ink,
      bar: {
        left: Math.round(b.left - a.left),
        right: Math.round(a.right - b.right),
        bottom: Math.round(a.bottom - b.bottom),
        height: Math.round(b.height),
        opacity: getComputedStyle(wrap).opacity,
        shadow: fill ? getComputedStyle(fill).boxShadow : null,
        // D155: no track frost any more — the scrim does the contrast work.
        backdrop: getComputedStyle(wrap).backdropFilter,
        trackBg: getComputedStyle(bar).backgroundColor,
        trackRing: getComputedStyle(bar).boxShadow,
        fillBg: fill ? getComputedStyle(fill).backgroundColor : null,
      },
      scrim: {
        gradient: getComputedStyle(scrim).backgroundImage,
        width: Math.round(s.width),
        artWidth: Math.round(a.width),
        left: Math.round(s.left - a.left),
        height: Math.round(s.height),
        bottom: Math.round(a.bottom - s.bottom),
      },
    }
  })
  expect(geom.cardH, 'card height == artwork height (no caption block)').toBe(geom.artH)
  expect(geom.bar.left, 'bar inset left').toBe(8)
  expect(geom.bar.right, 'bar inset right').toBe(8)
  expect(geom.bar.bottom, 'bar floats 8px above the bottom').toBe(8)
  expect(geom.bar.height, 'bar height').toBe(3)
  expect(geom.bar.opacity, 'bar visible at rest').toBe('1')
  expect(geom.bar.shadow, 'neon glow kept').toContain('6px')
  expect(geom.bar.backdrop, 'the D154 track frost is gone').toBe('none')
  // D155: back to theme ink for BOTH the 15% track and the fill.
  expect(geom.bar.fillBg, 'fill is the theme ink').toBe(geom.ink)
  expect(geom.bar.trackBg, 'track is 15% of the theme ink').toContain('0.15')
  expect(geom.bar.trackRing, 'capsule has no ring any more').toBe('none')
  // D155: the bottom scrim (Watch episode-thumbnail gradient) backs the bar.
  expect(geom.scrim.gradient, 'scrim paints a gradient').toContain('linear-gradient')
  expect(geom.scrim.gradient, 'scrim is the theme background, not a black wash').toContain('rgb(')
  expect(geom.scrim.width, 'scrim spans the full card width').toBe(geom.scrim.artWidth)
  expect(geom.scrim.left, 'scrim starts at the card edge').toBe(0)
  expect(geom.scrim.height, 'scrim is a short bottom band').toBeGreaterThanOrEqual(32)
  expect(geom.scrim.bottom, 'scrim reaches the card bottom edge').toBe(0)

  // Hover the ARTWORK (the hover trigger), not the card's caption area.
  await card.locator('.card-art').hover()
  await page.waitForTimeout(350)

  const hovered = await card.evaluate((el) => {
    const bar = el.querySelector('.continue-progress') as HTMLElement
    const caption = el.querySelector('.card-hover-caption') as HTMLElement
    const dots = el.querySelector('.card-dots-trigger') as HTMLElement
    return {
      barOpacity: getComputedStyle(bar).opacity,
      captionOpacity: getComputedStyle(caption).opacity,
      captionText: (caption.textContent ?? '').replace(/\s+/g, ' ').trim(),
      dotsOpacity: dots ? getComputedStyle(dots).opacity : null,
      dotsVisible: dots ? dots.getBoundingClientRect().width > 0 : null,
    }
  })
  expect(hovered.barOpacity, 'bar hides on hover').toBe('0')
  expect(hovered.captionOpacity, 'hover caption shows').toBe('1')
  expect(hovered.captionText, 'caption carries the show name').toContain('Naruto')
  expect(hovered.captionText, 'caption carries the next episode (name or honest number)').toMatch(/Wind Whistle at Dusk|Episode 21/)
  expect(hovered.dotsOpacity, '3 dots still reveal on hover').toBe('1')
  expect(hovered.dotsVisible, '3 dots have a hitbox').toBe(true)
})
