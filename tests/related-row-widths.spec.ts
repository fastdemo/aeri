import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * RELATED ROW WIDTHS — one card size across Related Anime and Related Manga.
 *
 * The old per-row edge-fit sizing measured each rail independently, so the
 * two rows on the same page could land on different card widths (236px anime
 * vs 245px manga in the reader). Both rails must now use the site-standard
 * Home rail width at every breakpoint. Item counts still differ, so the rows
 * may end at different x positions; the cards themselves must not resize.
 */

const IMG = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22%3E%3Crect width=%222%22 height=%223%22 fill=%22%23445566%22/%3E%3C/svg%3E'
const FLOWER_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

function relNode(id: number, format: string, title: string) {
  return {
    id,
    title: { romaji: title, english: title, native: title },
    format,
    status: 'FINISHED',
    episodes: format === 'MANGA' ? null : 12,
    chapters: format === 'MANGA' ? 50 : null,
    volumes: null,
    coverImage: { extraLarge: IMG, large: '', medium: '' },
    bannerImage: '',
  }
}

function media(
  id: number,
  format: string,
  title: string,
  relations: Array<{ relationType: string; node: ReturnType<typeof relNode> }>,
) {
  return {
    id,
    idMal: 2,
    title: { romaji: title, english: title, native: title },
    description: 'related-widths fixture',
    coverImage: { extraLarge: IMG, large: '', medium: '' },
    bannerImage: '',
    startDate: { year: 1989, month: 1, day: 1 },
    season: 'WINTER',
    seasonYear: 1989,
    episodes: format === 'MANGA' ? null : 220,
    chapters: format === 'MANGA' ? 392 : null,
    volumes: null,
    duration: null,
    status: 'RELEASING',
    averageScore: 90,
    genres: ['Action'],
    studios: { edges: [], nodes: [] },
    format,
    popularity: 1000,
    streamingEpisodes: [],
    nextAiringEpisode: null,
    airingSchedule: { nodes: [] },
    isAdult: false,
    relations: { edges: relations },
    trailer: null,
  }
}

// Mismatch scenario: 2 anime + 3 manga. The old fit logic gave the anime row
// 236px cards and the manga row 245px cards in the reader.
const READ_MEDIA = media(30002, 'MANGA', 'Berserk', [
  { relationType: 'ADAPTATION', node: relNode(30003, 'TV', 'Berserk Anime') },
  { relationType: 'SIDE_STORY', node: relNode(30004, 'MOVIE', 'Berserk Movie') },
  { relationType: 'SEQUEL', node: relNode(30151, 'MANGA', 'Berserk Fragments') },
  { relationType: 'SPIN_OFF', node: relNode(30152, 'MANGA', 'Berserk Gaiden') },
  { relationType: 'ALTERNATIVE', node: relNode(30153, 'ONE_SHOT', 'Berserk Prototype') },
])

// Watch mismatch scenario: 3 anime + 2 manga.
const WATCH_MEDIA = media(20, 'TV', 'Naruto', [
  { relationType: 'SEQUEL', node: relNode(2001, 'TV', 'Naruto Shippuden') },
  { relationType: 'SIDE_STORY', node: relNode(2002, 'MOVIE', 'Naruto Movie') },
  { relationType: 'SPIN_OFF', node: relNode(2003, 'TV', 'Boruto') },
  { relationType: 'ADAPTATION', node: relNode(2004, 'MANGA', 'Naruto Manga') },
  { relationType: 'SPIN_OFF', node: relNode(2005, 'MANGA', 'Naruto Gaiden') },
])

async function routeMedia(page: Page, body: unknown): Promise<void> {
  await page.route('https://graphql.anilist.co/**', async (route) => {
    let parsed: { query?: string; variables?: Record<string, unknown> } = {}
    try {
      parsed = JSON.parse(route.request().postData() ?? '{}')
    } catch {
      await route.fallback()
      return
    }
    if (/Media\s*\(/.test(parsed.query ?? '') && parsed.variables?.id != null) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { Media: body } }) })
      return
    }
    await route.fallback()
  })
}

const readWidths = () => {
  const expected = window.innerWidth >= 1024 ? 236 : window.innerWidth >= 640 ? 200 : 168
  const row = (title: string) => {
    const section = [...document.querySelectorAll('section')].find(
      (s) => s.querySelector('h2')?.textContent?.trim() === title,
    )
    const scroller = section?.querySelector('.no-scrollbar') as HTMLElement | null
    const first = scroller?.firstElementChild as HTMLElement | null
    return {
      card: first ? Math.round(first.getBoundingClientRect().width) : null,
      rail: scroller ? Math.round(scroller.getBoundingClientRect().width) : null,
    }
  }
  return { anime: row('Related Anime'), manga: row('Related Manga'), expected }
}

async function expectStandardWidths(page: Page): Promise<void> {
  const widths = await page.evaluate(readWidths)
  expect(widths.anime.card, 'Related Anime uses the Home card width').toBe(widths.expected)
  expect(widths.manga.card, 'Related Manga uses the Home card width').toBe(widths.expected)
  expect(widths.anime.card, 'both related rows share one card width').toBe(widths.manga.card)
  expect(widths.anime.rail, 'both related rows share the page rail width').toBe(widths.manga.rail)
}

test.describe('Related row widths', () => {
  test('reader: anime and manga rails share the Home card width', async ({ page }) => {
    test.setTimeout(180000)
    await seedTestAuth(page)
    await routeTestMalIdentity(page)
    await routeTestAnilistMedia(page)
    await routeMedia(page, READ_MEDIA)
    await page.route('**/api/manga/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const json = (body: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (path.includes('mdx-')) return route.fulfill({ status: 404, body: '{}' })
      if (path.startsWith('/api/manga/match/')) return json({ providerMangaId: 'fixture-series', providerTitle: 'Berserk', verified: true })
      if (path.startsWith('/api/manga/chapters/')) {
        return json({
          chapters: Array.from({ length: 45 }, (_, i) => ({
            providerChapterId: `ch-${i + 1}`,
            label: `Chapter ${i + 1}`,
            number: i + 1,
            unitType: 'chapter',
          })),
        })
      }
      if (path.startsWith('/api/manga/pages/')) return json({ pages: [IMG] })
      return route.fulfill({ status: 404, body: '{}' })
    })

    await page.goto('/read/anilist-30002/first', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h2:has-text("Related Manga")', { timeout: 60000 })
    await page.waitForSelector('[data-testid="chapter-nav-top"]', { timeout: 60000 })
    await expectStandardWidths(page)

    await page.setViewportSize({ width: 375, height: 800 })
    await page.waitForTimeout(400)
    await expectStandardWidths(page)
  })

  test('watch: anime and manga rails share the Home card width', async ({ page }) => {
    test.setTimeout(180000)
    await seedTestAuth(page)
    await routeTestMalIdentity(page, [{ malId: 20, title: 'Naruto', numEpisodes: 220, progress: 0 }])
    await routeTestAnilistMedia(page)
    await routeMedia(page, WATCH_MEDIA)
    await page.route('**/api/sources/aniwave-*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sources: [{ url: FLOWER_MP4, type: 'mp4', quality: 'auto', provider: 'aniwave', language: 'sub', embed: false }],
        }),
      })
    })

    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('video', { timeout: 90000 })
    await page.waitForSelector('h2:has-text("Related Manga")', { timeout: 90000 })
    await expectStandardWidths(page)

    await page.setViewportSize({ width: 375, height: 800 })
    await page.waitForTimeout(400)
    await expectStandardWidths(page)
  })
})
