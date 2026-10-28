import { test, expect, type Page } from '@playwright/test'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * GUEST MODE (owner 2026-10-28).
 *
 * Signed-out visitors can open any anime/manga card, watch anime and read
 * manga. My List / Profile / Settings stay members-only, and a guest session
 * is fully fresh: no Continue Watching row, no tracker controls in the card,
 * no saved local progress. These specs run WITHOUT seedTestAuth on purpose.
 */

const ANIME_ID = 'anilist-20'

test.describe('Guest browsing', () => {
  test('opens the floating detail card with no tracker controls', async ({ page }) => {
    await routeTestAnilistMedia(page)
    await page.goto(`/anime/${ANIME_ID}`, { waitUntil: 'domcontentloaded' })

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    await expect(dialog.getByRole('heading', { name: /Naruto/i }).first()).toBeVisible()

    // Play (not Resume) — a guest has no progress to resume.
    const play = dialog.getByRole('link', { name: /^Play$/ })
    await expect(play).toBeVisible()
    await expect(play).toHaveAttribute('href', `/watch/${ANIME_ID}/1`)

    // Tracker controls do not exist for guests.
    await expect(dialog.getByRole('button', { name: /Add to My List|Remove from My List/ })).toHaveCount(0)
    await expect(dialog.getByText('Watching', { exact: true })).toHaveCount(0)
  })

  test('home hides Continue Watching and My List for guests', async ({ page }) => {
    await routeTestAnilistMedia(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await expect(page.getByText('Continue Watching', { exact: true })).toHaveCount(0)
    await expect(page.locator('h2', { hasText: 'My List' })).toHaveCount(0)
    await expect(page.getByText('Your list is empty. Add titles from Trending or Search.')).toHaveCount(0)
  })

  test('members-only pages still redirect home', async ({ page }) => {
    await routeTestAnilistMedia(page)
    for (const path of ['/list', '/profile', '/settings']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
    }
  })

  test('watch route renders for a guest instead of redirecting', async ({ page }) => {
    await routeTestAnilistMedia(page)
    await page.goto(`/watch/${ANIME_ID}/1`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    expect(new URL(page.url()).pathname).toBe(`/watch/${ANIME_ID}/1`)
    await expect(page.getByTestId('episode-nav')).toBeVisible({ timeout: 60_000 })
  })
})

/**
 * SCROLL-QUIET (owner 2026-10-28): the card hover frost (8px backdrop blur)
 * must never toggle while a scroller is moving — that was the flicker.
 */
test.describe('Scroll-quiet gate', () => {
  const readState = (page: Page) => page.evaluate(() => {
    const frost = document.querySelector('.card-frost') as HTMLElement | null
    return {
      flag: document.documentElement.dataset.scrolling ?? null,
      frostOpacity: frost ? getComputedStyle(frost).opacity : null,
      frostBlur: frost ? getComputedStyle(frost).backdropFilter : null,
    }
  })

  test('scrolling marks the document and suppresses card hover chrome', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the hover treatment only exists on pointer devices')
    // A populated /anime grid: 30 cards make the window itself scrollable.
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: 9000 + i,
      idMal: 9000 + i,
      title: { romaji: `Scroll Probe ${i + 1}`, english: `Scroll Probe ${i + 1}`, native: '' },
      description: 'scroll-quiet fixture',
      coverImage: { extraLarge: '', large: '', medium: '' },
      bannerImage: '',
      startDate: { year: 2020, month: 1, day: 1 },
      season: 'WINTER',
      seasonYear: 2020,
      episodes: 12,
      chapters: null,
      volumes: null,
      duration: 24,
      status: 'FINISHED',
      averageScore: 70,
      genres: ['Action'],
      studios: { edges: [], nodes: [] },
      format: 'TV',
      popularity: 100,
      streamingEpisodes: [],
      nextAiringEpisode: null,
      airingSchedule: { nodes: [] },
      isAdult: false,
      relations: { edges: [] },
      trailer: null,
    }))
    await routeTestAnilistMedia(page)
    await page.route('https://graphql.anilist.co/**', async (route) => {
      const req = route.request()
      let body: { query?: string } = {}
      try { body = JSON.parse(req.postData() ?? '{}') } catch { body = {} }
      if (/Page\s*\(/.test(body.query ?? '')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false, total: items.length }, media: items } } }),
        })
        return
      }
      await route.fallback()
    })

    await page.goto('/anime', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.card-frost')).toHaveCount(30, { timeout: 60_000 })

    const art = page.locator('.card-art').first()
    await art.hover()
    await page.waitForTimeout(400)
    const before = await readState(page)
    expect(before.flag, 'idle before scrolling').toBeNull()
    expect(before.frostOpacity, 'hover frost is on while idle').toBe('1')
    expect(before.frostBlur, 'hover blur is mounted while idle').toBe('blur(8px)')

    // The pointer stays on the artwork; only the page scrolls.
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(80)
    const during = await readState(page)
    expect(during.flag, 'scroll flag set while scrolling').toBe('1')
    expect(during.frostOpacity, 'frost hidden while scrolling').toBe('0')
    expect(during.frostBlur, 'blur removed while scrolling').toBe('none')

    await expect.poll(async () => (await readState(page)).flag, { timeout: 3000 }).toBeNull()
    expect(await page.evaluate(() => window.scrollY), 'the page actually scrolled').toBeGreaterThan(0)
  })
})
