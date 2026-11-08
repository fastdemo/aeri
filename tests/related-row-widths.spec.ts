import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * RELATED ROW WIDTHS - one card size across Related Anime and Related Manga.
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
    // Count slot on the header's right (owner 2026-11-06): same line as the
    // title, e.g. "25 mangas".
    const header = section?.querySelector('h2')?.parentElement as HTMLElement | null
    const subtitle = header ? (header.querySelector('span')?.textContent || '').trim() : ''
    return {
      card: first ? Math.round(first.getBoundingClientRect().width) : null,
      rail: scroller ? Math.round(scroller.getBoundingClientRect().width) : null,
      subtitle,
    }
  }
  return { anime: row('Related Anime'), manga: row('Related Manga'), expected }
}

async function expectStandardWidths(page: Page, counts?: { anime: number; manga: number }): Promise<void> {
  const widths = await page.evaluate(readWidths)
  expect(widths.anime.card, 'Related Anime uses the Home card width').toBe(widths.expected)
  expect(widths.manga.card, 'Related Manga uses the Home card width').toBe(widths.expected)
  expect(widths.anime.card, 'both related rows share one card width').toBe(widths.manga.card)
  expect(widths.anime.rail, 'both related rows share the page rail width').toBe(widths.manga.rail)
  if (counts) {
    expect(widths.anime.subtitle, 'Related Anime carries its count').toBe(`${counts.anime} anime${counts.anime === 1 ? '' : 's'}`)
    expect(widths.manga.subtitle, 'Related Manga carries its count').toBe(`${counts.manga} manga${counts.manga === 1 ? '' : 's'}`)
  }
}

/**
 * D170 (owner 2026-11-07): on the media player only, at desktop widths the
 * related rails must use the EPISODE CARD width and 8px spacing. With the
 * five-column episode grid, a rail card is `(rail - 4*8) / 5`.
 */
const watchGridWidths = () => {
  const grid = [...document.querySelectorAll('div.grid')].find((d) =>
    d.className.includes('grid-cols-5'),
  ) as HTMLElement | null
  const ep = grid?.querySelector('a') as HTMLElement | null
  const row = (title: string) => {
    const section = [...document.querySelectorAll('section')].find(
      (s) => s.querySelector('h2')?.textContent?.trim() === title,
    )
    const scroller = section?.querySelector('.no-scrollbar') as HTMLElement | null
    const first = scroller?.firstElementChild as HTMLElement | null
    // Measure the painted ARTWORK box, not just the outer button: a nested
    // percentage width once left the outer cell correct while the art inside
    // collapsed to 42px (D170).
    const art = first?.querySelector('.card-art') as HTMLElement | null
    return {
      card: art ? Math.round(art.getBoundingClientRect().width) : null,
      gap: scroller ? getComputedStyle(scroller).columnGap : null,
      rail: scroller ? Math.round(scroller.getBoundingClientRect().width) : null,
      subtitle: section
        ? ((section.querySelector('h2')?.parentElement?.querySelector('span')?.textContent) || '').trim()
        : '',
    }
  }
  return {
    ep: ep ? Math.round(ep.getBoundingClientRect().width) : null,
    gridGap: grid ? getComputedStyle(grid).columnGap : null,
    anime: row('Related Anime'),
    manga: row('Related Manga'),
  }
}

async function expectRelatedMatchesEpisodes(
  page: Page,
  counts: { anime: number; manga: number },
): Promise<void> {
  const w = await page.evaluate(watchGridWidths)
  expect(w.ep, 'the episode grid is rendered').toBeGreaterThan(0)
  expect(w.anime.card, 'Related Anime card width equals an episode card').toBe(w.ep)
  expect(w.manga.card, 'Related Manga card width equals an episode card').toBe(w.ep)
  expect(w.anime.gap, 'Related Anime uses the episode grid gap').toBe(w.gridGap)
  expect(w.manga.gap, 'Related Manga uses the episode grid gap').toBe(w.gridGap)
  expect(w.anime.card, 'both related rows share one card width').toBe(w.manga.card)
  expect(w.anime.subtitle, 'Related Anime carries its count').toBe(`${counts.anime} anime${counts.anime === 1 ? '' : 's'}`)
  expect(w.manga.subtitle, 'Related Manga carries its count').toBe(`${counts.manga} manga${counts.manga === 1 ? '' : 's'}`)
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
    await expectStandardWidths(page, { anime: 2, manga: 3 })

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
    // Related rows are deferred until near the viewport (D165), so bring them
    // in before measuring the painted art box.
    await page.evaluate(() => {
      const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.trim() === 'Related Anime')
      h2?.scrollIntoView({ block: 'center' })
    })
    await page.waitForSelector('section:has(h2) .card-art', { timeout: 30000 })
    // Parity is a desktop rule: below `lg` the rail keeps the Home width and
    // the two-column phone episode grid is wider than that.
    if (await page.evaluate(() => window.innerWidth >= 1024)) {
      await expectRelatedMatchesEpisodes(page, { anime: 3, manga: 2 })
    } else {
      await expectStandardWidths(page, { anime: 3, manga: 2 })
    }

    // The source picker names the provider the way the provider names itself
    // (owner 2026-11-06: "aniwave - __" must read "AniWave"). The stream's
    // `provider` field is the lowercase id; the label must not be.
    // quality is "auto" here, so the label is the provider name alone. Poll:
    // the source list resolves a tick behind the first video paint on a
    // throttled mobile profile.
    await expect.poll(
      () => page.evaluate(() => {
        const sel = document.querySelector('select[aria-label="Select video source"]') as HTMLSelectElement | null
        return sel?.selectedOptions[0]?.textContent?.trim() ?? ''
      }),
      { timeout: 15_000, message: 'source option is exactly the display name' },
    ).toBe('AniWave')

    await page.setViewportSize({ width: 375, height: 800 })
    await page.waitForTimeout(400)
    await expectStandardWidths(page, { anime: 3, manga: 2 })
  })

  test('preview card: related headers carry their counts', async ({ page }) => {
    test.setTimeout(180000)
    await seedTestAuth(page)
    await routeTestMalIdentity(page)
    await routeTestAnilistMedia(page)
    await routeMedia(page, READ_MEDIA)

    // Detail overlay route: the floating preview card over the page it was
    // opened from (D097). Related grids live in the card's sidebar. The card
    // paints its desktop and mobile arrangements in the same DOM (one of each
    // is hidden), so wait for the VISIBLE header and read that one.
    await page.goto('/anime/anilist-30002', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h3:has-text("Related Manga"):visible', { timeout: 90000 })

    const counts = await page.evaluate(() => {
      const grab = (title: string) => {
        const h3 = [...document.querySelectorAll('h3')]
          .filter(h => h.textContent?.trim() === title)
          .find(h => h.getBoundingClientRect().height > 0)
        const header = h3?.parentElement as HTMLElement | null
        return header ? (header.querySelector('span')?.textContent || '').trim() : ''
      }
      return { anime: grab('Related Anime'), manga: grab('Related Manga') }
    })
    expect(counts.anime, 'Related Anime header count').toBe('2 animes')
    expect(counts.manga, 'Related Manga header count').toBe('3 mangas')
  })
})
