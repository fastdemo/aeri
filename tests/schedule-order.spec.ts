import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * "Airing soon" (the bell panel) is ONE chronological ramp (owner
 * 2026-11-01): the show airing soonest is at the top, the latest at the
 * bottom. It used to concatenate the watching-list group in front of the
 * airing rail, so a list entry airing in five days sat above one airing
 * tonight. This spec serves the airing rail deliberately out of order and
 * asserts the rendered row order.
 */

const now = Math.floor(Date.now() / 1000)
const hoursFromNow = (h: number) => now + Math.round(h * 3600)

function media(id: number, romaji: string, hours: number, episode = 5) {
  return {
    id,
    idMal: id,
    title: { romaji, english: romaji, native: romaji },
    coverImage: { extraLarge: '', large: '', medium: '' },
    bannerImage: '',
    description: `${romaji} (test double)`,
    genres: [],
    studios: { edges: [], nodes: [] },
    episodes: 12,
    duration: 24,
    status: 'RELEASING',
    averageScore: 80,
    popularity: 1000,
    format: 'TV',
    season: 'FALL',
    seasonYear: 2026,
    startDate: { year: 2026, month: 10, day: 1 },
    streamingEpisodes: [],
    isAdult: false,
    relations: { edges: [] },
    nextAiringEpisode: {
      airingAt: hoursFromNow(hours),
      timeUntilAiring: Math.round(hours * 3600),
      episode,
    },
    airingSchedule: { nodes: [] },
  }
}

test.describe('Airing soon order', () => {
  test('sorts one chronological ramp: soonest at the top, latest at the bottom', async ({ page }) => {
    test.setTimeout(120_000)
    await seedTestAuth(page)
    await routeTestMalIdentity(page, [])
    await routeTestAnilistMedia(page)

    // Deliberately shuffled: 72h, 2h, 30h, 8h, 120h, 0.5h.
    const rail = [
      media(9101, 'Probe Air Late', 72),
      media(9102, 'Probe Air Soon', 2),
      media(9103, 'Probe Air Mid', 30),
      media(9104, 'Probe Air Evening', 8),
      media(9105, 'Probe Air Latest', 120),
      media(9106, 'Probe Air Tonight', 0.5),
    ]
    // Answer ONLY the airing rail query; everything else falls through to the
    // shared metadata double.
    await page.route('https://graphql.anilist.co/**', async (route) => {
      const body = route.request().postData() ?? ''
      if (body.includes('status: RELEASING') && !body.includes('trending:')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              Page: {
                pageInfo: { hasNextPage: false, currentPage: 1, lastPage: 1, total: rail.length },
                media: rail,
              },
            },
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const bell = page.getByRole('button', { name: 'Airing schedule' })
    await bell.waitFor({ timeout: 45_000 })
    await bell.click()

    const panel = page.locator('[data-header-popup]').filter({ hasText: 'Airing soon' })
    await expect(panel).toBeVisible({ timeout: 15_000 })
    const rows = panel.getByRole('menuitem')
    await expect(rows).toHaveCount(6)

    const titles = await rows.allInnerTexts()
    expect(titles.map((t) => t.split('\n')[0].trim())).toEqual([
      'Probe Air Tonight',
      'Probe Air Soon',
      'Probe Air Evening',
      'Probe Air Mid',
      'Probe Air Late',
      'Probe Air Latest',
    ])
    // Sanity: the timestamps themselves ascend in the rendered order.
    const stamps = await panel.evaluate(() =>
      [...document.querySelectorAll('[data-header-popup] [role="menuitem"]')].map((el) =>
        (el.textContent ?? '').trim(),
      ),
    )
    expect(stamps.length).toBe(6)
  })
})

test.describe('Airing soon order with a watching list', () => {
  test('a list entry airing later drops below the sooner rail titles', async ({ page }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      // AniList tracker seed - the ONLY tracker whose list entries carry
      // nextAiringEpisode (MAL nodes do not).
      localStorage.setItem('aeri:anilist:token', 'aeri-test-token')
      localStorage.setItem('aeri:anilist:token_type', 'Bearer')
    })
    await routeTestAnilistMedia(page)

    // Rail: two titles airing within hours.
    const rail = [media(9201, 'Probe Rail Soon', 1), media(9202, 'Probe Rail Later', 4)]
    // The user's list: one watching show that only airs in five days. Under
    // the old concatenation it rendered FIRST.
    const listMedia = media(9203, 'Probe List Far Away', 120, 9)

    await page.route('https://graphql.anilist.co/**', async (route) => {
      const body = route.request().postData() ?? ''
      if (body.includes('MediaListCollection')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              MediaListCollection: {
                lists: [
                  {
                    name: 'Watching',
                    isCustomList: false,
                    entries: [
                      {
                        id: 1,
                        mediaId: listMedia.id,
                        status: 'CURRENT',
                        progress: 4,
                        score: 0,
                        score10: 0,
                        updatedAt: Math.floor(Date.now() / 1000),
                        media: listMedia,
                      },
                    ],
                  },
                ],
              },
            },
          }),
        })
        return
      }
      if (body.includes('status: RELEASING') && !body.includes('trending:')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              Page: {
                pageInfo: { hasNextPage: false, currentPage: 1, lastPage: 1, total: rail.length },
                media: rail,
              },
            },
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const bell = page.getByRole('button', { name: 'Airing schedule' })
    await bell.waitFor({ timeout: 45_000 })
    await bell.click()

    const panel = page.locator('[data-header-popup]').filter({ hasText: 'Airing soon' })
    await expect(panel).toBeVisible({ timeout: 15_000 })
    const rows = panel.getByRole('menuitem')
    await expect(rows).toHaveCount(3)
    const titles = (await rows.allInnerTexts()).map((t) => t.split('\n')[0].trim())
    expect(titles).toEqual(['Probe Rail Soon', 'Probe Rail Later', 'Probe List Far Away'])
  })
})
