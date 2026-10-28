import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { FIXTURE_COVER } from './fixtures/anilist-media'

/**
 * EPISODE ROW IS ATOMIC (owner 2026-10-28).
 *
 * While the whole-entry Kitsu fallback resolves, an episode row must not
 * show one real field next to a skeleton for the other. The row stays a
 * skeleton until BOTH the name and the thumbnail are ready, then reveals
 * them in the same frame.
 */

const R2_ANILIST_ID = 2904
const R2_MAL_ID = 1575
const KITSU_ID = '26'
const KITSU_NAME_5 = 'The R2 Name for Five'
const S1_NAME_5 = 'Stage 5.0'

function r2Media() {
  return {
    id: R2_ANILIST_ID,
    idMal: R2_MAL_ID,
    type: 'ANIME',
    title: { romaji: 'Code Geass: Hangyaku no Lelouch R2', english: 'Code Geass: Lelouch of the Rebellion R2', native: 'コードギアス 反逆のルルーシュR2' },
    description: 'Code Geass R2 (test fixture)',
    coverImage: { extraLarge: FIXTURE_COVER, large: '', medium: '' },
    bannerImage: '',
    startDate: { year: 2008, month: 4, day: 6 },
    season: 'SPRING',
    seasonYear: 2008,
    episodes: 25,
    chapters: null,
    volumes: null,
    duration: 24,
    status: 'FINISHED',
    averageScore: 87,
    genres: ['Action', 'Drama'],
    studios: { edges: [], nodes: [] },
    format: 'TV',
    popularity: 500000,
    // Season-1 pollution: discarded by the display guards, so the Kitsu
    // fallback is the only source for names/thumbnails on this entry.
    streamingEpisodes: Array.from({ length: 25 }, (_, i) => ({
      title: `S1 Episode ${i + 1} - Stage ${i + 1}.0`,
      thumbnail: '',
      url: `https://crunchyroll.com/s1/ep${i + 1}`,
      site: 'Crunchyroll',
    })),
    nextAiringEpisode: null,
    airingSchedule: { nodes: [] },
    isAdult: false,
    // The PREQUEL relation is what marks the 25-row streaming list as
    // season-1 pollution (a 25-episode sequel cannot own S1's rows).
    relations: {
      edges: [{
        relationType: 'PREQUEL',
        node: {
          id: 1575,
          title: { romaji: 'Code Geass: Hangyaku no Lelouch', english: 'Code Geass: Lelouch of the Rebellion', native: 'コードギアス 反逆のルルーシュ' },
          format: 'TV', status: 'FINISHED', episodes: 25, chapters: null, volumes: null,
          coverImage: { extraLarge: FIXTURE_COVER, large: '', medium: '' },
          bannerImage: '',
        },
      }],
    },
    trailer: null,
  }
}

test('episode rows reveal name + thumbnail together after the Kitsu fallback', async ({ page }) => {
  test.setTimeout(180_000)
  await seedTestAuth(page)
  await routeTestMalIdentity(page)
  await page.route('https://graphql.anilist.co/**', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    let body: { query?: string; variables?: Record<string, unknown> } = {}
    try { body = JSON.parse(req.postData() ?? '{}') } catch { body = {} }
    const q = body.query ?? ''
    const v = body.variables ?? {}
    let data: unknown
    if (/Viewer/.test(q)) data = { Viewer: { id: 1, name: 'aeri-test-user' } }
    else if (/MediaListCollection/.test(q)) data = { MediaListCollection: { lists: [] } }
    else if (/Media\s*\(/.test(q) && (Number(v.id) === R2_ANILIST_ID || Number(v.idMal ?? v.malId) === R2_MAL_ID)) data = { Media: r2Media() }
    else data = { Page: { media: [] }, Media: null }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) })
  })
  await page.route('https://kitsu.io/api/edge/mappings**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/vnd.api+json',
      body: JSON.stringify({ data: [{ id: 'map-1', relationships: { item: { data: { type: 'anime', id: KITSU_ID } } } }] }),
    })
  })

  // Hold the Kitsu episode list open so the loading state is observable.
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('https://kitsu.io/api/edge/anime/*/episodes**', async (route) => {
    await gate
    const rows = Array.from({ length: 25 }, (_, i) => {
      const n = i + 1
      return {
        id: `kep-${n}`,
        type: 'episodes',
        attributes: { number: n, canonicalTitle: n === 5 ? KITSU_NAME_5 : `R2 Episode ${n} Name`, thumbnail: null },
      }
    })
    return route.fulfill({
      status: 200,
      contentType: 'application/vnd.api+json',
      body: JSON.stringify({ data: rows, meta: { count: rows.length } }),
    })
  })

  await page.goto(`/anime/anilist-${R2_ANILIST_ID}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('h3:has-text("Episodes")')).toBeVisible({ timeout: 60_000 })

  // LOADING: every row is a skeleton — no real name, no real artwork, and
  // the two skeletons are present together.
  const thumbSkeletons = page.locator('[aria-label="Loading episode thumbnail"]')
  const titleSkeletons = page.locator('[aria-label="Loading episode details"]')
  await expect(thumbSkeletons).toHaveCount(25, { timeout: 60_000 })
  await expect(titleSkeletons).toHaveCount(25)
  await expect(page.getByText(KITSU_NAME_5)).toHaveCount(0)
  await expect(page.getByText(S1_NAME_5)).toHaveCount(0)
  // The row for episode 5 carries no visible name while it is a skeleton.
  await expect(page.locator('a[href$="/watch/anilist-2904/5"]').first()).toBeVisible()
  expect((await page.locator('a[href$="/watch/anilist-2904/5"]').first().textContent())?.trim()).not.toContain('R2 Episode')

  // RELEASED: the real name and the real thumbnail appear together, and no
  // row is left half-loaded.
  release()
  await expect(page.getByText(KITSU_NAME_5)).toBeVisible({ timeout: 30_000 })
  await expect(thumbSkeletons).toHaveCount(0)
  await expect(titleSkeletons).toHaveCount(0)
  await expect(page.locator('a[href$="/watch/anilist-2904/5"]').first().locator('img')).toBeVisible()
  expect(await page.getByText(KITSU_NAME_5).count()).toBe(1)
})
