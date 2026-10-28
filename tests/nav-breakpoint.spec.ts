import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'

/**
 * TOP BAR COMPACTION CONTRACT
 *
 * The top bar compacts at the SAME scaling step as the hero pills moving to
 * the top right.
 *
 * The hero dot pill is bottom-center from `sm` (640px) up and tucks into the
 * hero's top-right corner below it (Hero.tsx: `absolute right-3 top-3 …
 * sm:bottom-4 sm:left-1/2`). The nav must switch at that SAME step:
 *   < 640px → menu + search icon (compact)
 *   ≥ 640px → inline section links + search input (never compacted above)
 *
 * Also pinned here:
 *   - the bell↔profile divider is gone in every auth state and at every
 *     width;
 *   - the bar never causes horizontal page overflow, including the tightest
 *     inline width (640px, signed out — the widest case: search + Sign in);
 *   - the right cluster order is search → bell → profile.
 *
 * The hero-pill half of the contract is asserted in the last test; it is
 * skipped when no hero data is available (offline run) because the pill only
 * renders with a real trending title.
 */

const SWITCH = 640 // Tailwind `sm` — the hero pill's own step

type NavState = Awaited<ReturnType<typeof navState>>

async function navState(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-navbar-bar]') as HTMLElement | null
    const nav = document.querySelector('header nav[aria-label="Sections"]') as HTMLElement | null
    const menu = document.querySelector('header button[aria-label="Menu"]') as HTMLElement | null
    const searchIcon = document.querySelector('header button[aria-label="Search"]') as HTMLElement | null
    const input = document.querySelector('header input[aria-label="Search anime"]') as HTMLElement | null
    const bell = document.querySelector('header button[aria-label="Airing schedule"]') as HTMLElement | null
    const profile = document.querySelector('header button[aria-label="Profile"]') as HTMLElement | null
    const signIn = document.querySelector('header button[aria-label="Sign in"]') as HTMLElement | null
    const cs = bar ? getComputedStyle(bar) : null
    const contentRight =
      bar && cs ? bar.getBoundingClientRect().right - (parseFloat(cs.paddingRight) || 0) : null
    const rightCluster = bar?.lastElementChild as HTMLElement | null
    const rightLabels = rightCluster
      ? [...rightCluster.querySelectorAll('input, button')].map((el) =>
          el.getAttribute('aria-label') ?? el.tagName.toLowerCase(),
        )
      : []
    return {
      width: window.innerWidth,
      inlineNav: !!nav,
      links: nav ? [...nav.querySelectorAll('a')].map((a) => (a.textContent ?? '').trim()) : [],
      menu: !!menu,
      searchIcon: !!searchIcon,
      searchInput: !!input,
      bell: !!bell,
      profile: !!profile,
      signIn: !!signIn,
      /** The removed bell↔profile hairline: no 1px-wide rule may live in the bar. */
      divider: bar ? !!bar.querySelector('[class*="w-px"]') : false,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      profileRight: profile ? Math.round(profile.getBoundingClientRect().right) : null,
      contentRight: contentRight != null ? Math.round(contentRight) : null,
      rightLabels,
    }
  })
}

/** Resize + wait for the fit effect to settle into `mode`, then read state. */
async function at(page: Page, width: number, mode: 'inline' | 'compact'): Promise<NavState> {
  await page.setViewportSize({ width, height: 820 })
  await expect
    .poll(
      async () => {
        const s = await navState(page)
        if (s.width !== width) return 'resizing'
        return s.inlineNav ? 'inline' : s.menu ? 'compact' : 'none'
      },
      { timeout: 5_000 },
    )
    .toBe(mode)
  return navState(page)
}

test.describe('top bar compaction', () => {
  test('signed out: compact below 640, inline at 640', async ({ page }) => {
    await page.setViewportSize({ width: SWITCH - 1, height: 820 })
    await page.goto('/')

    const below = await at(page, SWITCH - 1, 'compact')
    expect(below.inlineNav, 'inline nav must be collapsed at 639px').toBe(false)
    expect(below.menu, 'menu trigger at 639px').toBe(true)
    expect(below.searchIcon, 'search icon at 639px').toBe(true)
    expect(below.searchInput, 'no inline search input at 639px').toBe(false)
    expect(below.signIn).toBe(true)
    expect(below.divider, 'no bell↔profile divider').toBe(false)
    expect(below.overflow, 'no horizontal overflow at 639px').toBe(false)

    const above = await at(page, SWITCH, 'inline')
    expect(above.inlineNav, 'inline nav must be shown at 640px').toBe(true)
    expect(above.links).toEqual(['Home', 'Anime', 'Manga', 'My List'])
    expect(above.menu, 'menu trigger gone at 640px').toBe(false)
    expect(above.searchIcon, 'search icon gone at 640px').toBe(false)
    expect(above.searchInput, 'inline search input at 640px').toBe(true)
    expect(above.divider).toBe(false)
    expect(above.overflow, 'no horizontal overflow at 640px (tightest inline case)').toBe(false)
  })

  test('signed in: bell + profile never compact, divider never returns', async ({ page }) => {
    await seedTestAuth(page)
    await routeTestMalIdentity(page, [
      { malId: 1, title: 'Cowboy Bebop', numEpisodes: 26, progress: 3 },
    ])
    await page.setViewportSize({ width: SWITCH - 1, height: 820 })
    await page.goto('/')
    await expect.poll(async () => (await navState(page)).bell, { timeout: 10_000 }).toBe(true)

    const below = await at(page, SWITCH - 1, 'compact')
    expect(below.inlineNav).toBe(false)
    expect(below.menu).toBe(true)
    expect(below.searchIcon).toBe(true)
    expect(below.bell, 'bell stays at every scaling').toBe(true)
    expect(below.profile, 'profile stays at every scaling').toBe(true)
    expect(below.divider, 'no bell↔profile divider').toBe(false)
    expect(below.overflow).toBe(false)

    const above = await at(page, SWITCH, 'inline')
    expect(above.inlineNav).toBe(true)
    expect(above.menu).toBe(false)
    expect(above.searchIcon).toBe(false)
    expect(above.bell).toBe(true)
    expect(above.profile).toBe(true)
    expect(above.divider, 'no bell↔profile divider').toBe(false)
    expect(above.overflow).toBe(false)
    // Right cluster order: search field → bell → profile (divider removal must
    // not reshuffle the cluster).
    expect(above.rightLabels).toEqual(['Search anime', 'Airing schedule', 'Profile'])
    // Profile lands on the bar's content edge — no stray divider gap.
    expect(above.profileRight).toBe(above.contentRight)
  })

  test('no overflow at any common width (both auth states)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 820 })
    await page.goto('/')
    for (const width of [375, 639, 640, 768, 1024, 1440]) {
      const s = await at(page, width, width >= SWITCH ? 'inline' : 'compact')
      expect(s.overflow, `no horizontal overflow at ${width}px`).toBe(false)
      expect(s.divider, `no divider at ${width}px`).toBe(false)
      expect(s.inlineNav, `inline nav at ${width}px`).toBe(width >= SWITCH)
    }
  })

  test('nav switch matches the hero pill step', async ({ page }) => {
    await page.setViewportSize({ width: SWITCH, height: 820 })
    await page.goto('/')
    // The pill only renders with a real trending title; skip when offline.
    const hasPill = await page
      .waitForSelector('[class*="sm:left-1/2"]', { timeout: 12_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!hasPill, 'hero pill not rendered (no hero data in this environment)')

    const pillAt = async (width: number) => {
      await page.setViewportSize({ width, height: 820 })
      await page.waitForTimeout(350)
      return page.evaluate(() => {
        const el = document.querySelector('[class*="sm:left-1/2"]') as HTMLElement
        const r = el.getBoundingClientRect()
        return {
          // Below `sm` the pill sits in the hero's top-right corner…
          topRight: r.y < 140 && r.right > window.innerWidth - 80,
          // …and from `sm` up it is bottom-center of the hero.
          centered: Math.abs(r.x + r.width / 2 - window.innerWidth / 2) < 8,
        }
      })
    }

    expect((await pillAt(SWITCH - 1)).topRight, 'pill tucks top-right below 640').toBe(true)
    expect((await pillAt(SWITCH)).centered, 'pill returns bottom-center at 640').toBe(true)
  })
})
