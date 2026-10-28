import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * PILL SYSTEM CONTRACT
 *
 * Every white control on the site uses ONE size. Reference: the active
 * "Popular" category pill on /anime — 30px tall, 12px medium text, 14px
 * horizontal padding, 1px hairline, fully rounded.
 *
 * Every standalone white pill (button/link) and every dropdown shell must
 * render at that exact height and type scale. Decorative badges (spans) are
 * intentionally excluded — they are not controls.
 *
 * SEGMENTED TOGGLES ARE THE EXCEPTION: Sub/Dub and the
 * reader fit stay a TRACK + INNER PILL, not a row of standalone pills. The
 * control is the track, so the track must be 30px; the selected inner pill is
 * a 20px thumb by design and is not sampled as a standalone pill.
 */

type Pill = {
  kind: 'button' | 'select' | 'toggle'
  text: string
  height: number
  fontSize: string
  fontWeight: string
  radius: number
}

const PAGES = ['/anime', '/manga', '/docs', '/legal', '/settings', '/profile', '/list']

async function collectPills(page: import('@playwright/test').Page): Promise<Pill[]> {
  return page.evaluate(() => {
    const out: any[] = []
    const controls = [...document.querySelectorAll('button, a, [role="radio"]')]
    for (const el of controls) {
      const node = el as HTMLElement
      const cs = getComputedStyle(node)
      const r = node.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      // White fill = primary pill. Soft pills share the same metrics but are
      // not the reference; the solid ones are what must never drift.
      if (cs.backgroundColor !== 'rgb(255, 255, 255)') continue
      // Inner pill of a segmented toggle: the 30px TRACK is the control.
      if (node.parentElement?.getAttribute('role') === 'radiogroup') continue
      out.push({
        kind: 'button',
        text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
        height: Math.round(r.height * 10) / 10,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        radius: parseFloat(cs.borderTopLeftRadius),
      })
    }
    for (const group of [...document.querySelectorAll('[role="radiogroup"]')]) {
      const node = group as HTMLElement
      const cs = getComputedStyle(node)
      const r = node.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      // Only PILL-SHAPED tracks are toggles; the theme picker is also a
      // radiogroup but it is a grid of cards, not a 30px control.
      if (parseFloat(cs.borderTopLeftRadius) < Math.min(r.width, r.height) / 2 - 1) continue
      out.push({
        kind: 'toggle',
        text: (node.getAttribute('aria-label') || 'toggle').slice(0, 24),
        height: Math.round(r.height * 10) / 10,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        radius: parseFloat(cs.borderTopLeftRadius),
      })
    }
    for (const select of [...document.querySelectorAll('select')]) {
      const shell = select.parentElement as HTMLElement | null
      if (!shell) continue
      const cs = getComputedStyle(shell)
      const r = shell.getBoundingClientRect()
      // The browse/manga pages render the filter lane twice (desktop +
      // mobile scroller); the hidden copy has a zero box and is not a
      // rendered control.
      if (r.width < 4 || r.height < 4) continue
      out.push({
        kind: 'select',
        text: (select.getAttribute('aria-label') || '').slice(0, 24),
        height: Math.round(r.height * 10) / 10,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        radius: parseFloat(cs.borderTopLeftRadius),
      })
    }
    return out
  })
}

test.describe('Pill system — one size everywhere', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestAuth(page)
    await routeTestMalIdentity(page)
    await routeTestAnilistMedia(page)
  })

  for (const path of PAGES) {
    test(`${path} — white pills and dropdowns are 30px / 12px`, async ({ page }) => {
      test.setTimeout(90000)
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      const pills = await collectPills(page)
      expect(pills.length, `expected at least one pill on ${path}`).toBeGreaterThan(0)
      for (const pill of pills) {
        expect.soft(pill.height, `${path} ${pill.kind} "${pill.text}" height`).toBeCloseTo(30, 0)
        if (pill.kind !== 'toggle') {
          expect.soft(pill.fontSize, `${path} ${pill.kind} "${pill.text}" font-size`).toBe('12px')
          expect.soft(pill.fontWeight, `${path} ${pill.kind} "${pill.text}" font-weight`).toBe('500')
        }
        expect.soft(pill.radius, `${path} ${pill.kind} "${pill.text}" radius`).toBeGreaterThanOrEqual(9999)
      }
    })
  }
})

/**
 * Signed-out top bar: the "Sign in" button is the same white pill as the
 * category tabs it sits above. Separate from the signed-in sweep above
 * because seeding auth swaps that button for the avatar.
 */
test('signed-out top bar — Sign in pill matches the category pill', async ({ page }) => {
  await page.goto('/anime', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const pills = await collectPills(page)
  const signIn = pills.find((p) => p.text === 'Sign in')
  expect(signIn, 'signed-out navbar must render the Sign in pill').toBeTruthy()
  expect(signIn!.height).toBeCloseTo(30, 0)
  expect(signIn!.fontSize).toBe('12px')
  expect(signIn!.fontWeight).toBe('500')
})
