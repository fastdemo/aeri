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

/**
 * D151 (2026-10-30) — navbar repaint hardening.
 *
 * Owner reports: (1) on a hard refresh the desktop search field showed a
 * spinner-like ghost inside the pill until the page finished painting;
 * (2) on mobile, exiting the video player's native fullscreen left a
 * "weird transparency gradient" over the bar.
 *
 * Root causes: the input carried `backdrop-blur` + `transition-all` (Safari
 * re-blurs the area behind the field every frame, and a half-painted reload
 * leaves a stale sample), and the scrolled bar was `bg/95 + backdrop-blur-md`
 * (iOS re-composites that backdrop layer from the fullscreen frame). Both
 * backdrop filters are gone; the scrolled bar is opaque.
 */
test.describe('navbar repaint hardening (D151)', () => {
  test('search field has no backdrop filter and the scrolled bar is opaque', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const input = page.locator('header input[aria-label="Search anime"]')
    await input.waitFor({ timeout: 30_000 })
    const field = await input.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        backdrop: cs.backdropFilter,
        webkitBackdrop: (cs as any).webkitBackdropFilter ?? 'none',
        transition: cs.transitionProperty,
        autoComplete: el.getAttribute('autocomplete'),
      }
    })
    expect(field.backdrop, 'search field paints no backdrop filter').toBe('none')
    expect(field.webkitBackdrop, 'no -webkit backdrop filter either').toBe('none')
    expect(field.transition, 'transition never animates backdrop-filter').not.toContain('backdrop')
    expect(field.autoComplete, 'browser autofill cannot ghost the search value').toBe('off')

    // At the top the solid layer is hidden (the gradient carries the bar).
    const top = await page.evaluate(() => {
      const header = document.querySelector('header') as HTMLElement
      const solid = header.querySelectorAll(':scope > div')[1] as HTMLElement
      return { opacity: getComputedStyle(solid).opacity, isolation: getComputedStyle(header).isolation }
    })
    expect(top.opacity, 'solid layer hidden at scrollTop 0').toBe('0')
    expect(top.isolation, 'header owns its stacking context').toBe('isolate')

    await page.evaluate(() => window.scrollTo(0, 600))
    await expect
      .poll(() => page.evaluate(() => {
        const solid = document.querySelectorAll('header > div')[1] as HTMLElement
        return getComputedStyle(solid).opacity
      }), { timeout: 5_000 })
      .toBe('1')

    const scrolled = await page.evaluate(() => {
      const header = document.querySelector('header') as HTMLElement
      const solid = header.querySelectorAll(':scope > div')[1] as HTMLElement
      const cs = getComputedStyle(solid)
      return { bg: cs.backgroundColor, backdrop: cs.backdropFilter, htmlBackdrop: (cs as any).webkitBackdropFilter ?? 'none' }
    })
    // Opaque `--bg` (Aeri Dark = rgb(0, 0, 0)) — no 95% translucency, no blur.
    expect(scrolled.bg, 'scrolled bar is a flat opaque theme background').toMatch(/^rgb\(/)
    expect(scrolled.bg).not.toContain('/')
    expect(scrolled.backdrop, 'scrolled bar paints no backdrop filter').toBe('none')
    expect(scrolled.htmlBackdrop, 'no -webkit backdrop filter on the bar').toBe('none')
  })
})

/**
 * GitHub is NOT in the navbar (owner 2026-10-31: "remove github from the
 * navbar"). The top bar carries only the four routes at every width, and the
 * mobile menu has no GitHub row. The repo link survives in the page footer
 * and in Settings — those are NOT nav, so they stay.
 */
test.describe('GitHub is not a navbar item', () => {
  const REPO = 'https://github.com/fastdemo/aeri'

  test('desktop bar carries only the four routes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator(`header a[href="${REPO}"]`)).toHaveCount(0)
    const labels = await page.evaluate(() => {
      const nav = document.querySelector('header nav[aria-label="Sections"]') as HTMLElement
      return [...nav.querySelectorAll('a')].map((x) => (x.textContent ?? '').trim())
    })
    expect(labels).toEqual(['Home', 'Anime', 'Manga', 'My List'])
  })

  test('mobile menu has no GitHub row', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Menu' }).click()
    const menu = page.locator('nav[aria-label="Mobile sections"]')
    await expect(menu).toBeVisible()
    await expect(menu.locator(`a[href="${REPO}"]`)).toHaveCount(0)
    await expect(menu.getByText('GitHub')).toHaveCount(0)
  })
})

/**
 * ⌘K / Ctrl+K / Alt+K focuses the search field (owner 2026-10-31, D157). A
 * keybind only — no badge, no new element. Desktop focuses the inline input;
 * the compact bar opens its search dropdown with the input focused.
 */
test.describe('search keybind', () => {
  test('Cmd/Ctrl+K focuses the desktop search input', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const input = page.locator('header input[aria-label="Search anime"]')
    await expect(input).toHaveCount(1)

    // Nothing focused yet, and the URL must not change.
    const before = page.url()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(input).toBeFocused()
    expect(page.url()).toBe(before)

    // Typing goes straight into the field; the suggestion popup is armed
    // (its rows need live data, so the test pins the aria state instead).
    await page.keyboard.type('nar')
    await expect(input).toHaveValue('nar')
    await expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  test('Ctrl+K opens the compact search panel and focuses it', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('header input[aria-label="Search anime"]')).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+k')
    const input = page.locator('header input[placeholder="Search anime"]')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
    await page.keyboard.type('one')
    await expect(input).toHaveValue('one')
  })

  test('Alt+K also focuses the search input', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const input = page.locator('header input[aria-label="Search anime"]')
    await page.keyboard.press('Alt+k')
    await expect(input).toBeFocused()
    await page.keyboard.type('bebop')
    await expect(input).toHaveValue('bebop')
  })

  test('Shift variants are left to the browser', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const input = page.locator('header input[aria-label="Search anime"]')
    await page.keyboard.press('ControlOrMeta+Shift+k')
    await expect(input).not.toBeFocused()
    await page.keyboard.press('Alt+Shift+k')
    await expect(input).not.toBeFocused()
  })
})
