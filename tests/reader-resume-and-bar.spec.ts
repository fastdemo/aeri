import { test, expect, type Page } from '@playwright/test'
import { routeTestAnilistMedia } from './helpers/test-anilist'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'

/**
 * MANGA READER — guest access, progress-bar glow, and resume placement.
 *
 * 1. A signed-out visitor can read (owner 2026-10-28): no auth seeding.
 * 2. The reader progress fill carries the same 6px neon glow as the Continue
 *    Watching bar, but the glow is not painted at scaleX(0) (the old "boxy
 *    blob").
 * 3. Resume places the viewport ONCE. The old code retried scrollIntoView
 *    every 800ms while pages loaded, which read as the reader scrolling by
 *    itself. With a saved page 1 and page 0's artwork still in flight, the
 *    page must stay at the top until page 0 resolves, then jump once and
 *    stay put.
 */

const PAGE_IMG = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22%3E%3Crect width=%222%22 height=%223%22 fill=%22%23445566%22/%3E%3C/svg%3E'
const PAGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"><rect width="2" height="3" fill="#445566"/></svg>'

const MANGA_MEDIA = {
  id: 30002,
  idMal: 2,
  title: { romaji: 'Berserk', english: 'Berserk', native: 'Berserk' },
  description: 'Reader layout fixture.',
  coverImage: { extraLarge: PAGE_IMG, large: '', medium: '' },
  bannerImage: '',
  startDate: { year: 1989, month: 1, day: 1 },
  season: 'WINTER',
  seasonYear: 1989,
  episodes: null,
  chapters: 392,
  volumes: null,
  duration: null,
  status: 'RELEASING',
  averageScore: 90,
  genres: ['Action'],
  studios: { edges: [], nodes: [] },
  format: 'MANGA',
  popularity: 1000,
  streamingEpisodes: [],
  nextAiringEpisode: null,
  airingSchedule: { nodes: [] },
  isAdult: false,
  relations: { edges: [] },
  trailer: null,
}

async function setupReader(page: Page, pageUrls: string[] = [PAGE_IMG, PAGE_IMG, PAGE_IMG]): Promise<void> {
  await routeTestAnilistMedia(page)
  await page.route('https://graphql.anilist.co/**', async (route) => {
    const req = route.request()
    let parsed: { query?: string; variables?: Record<string, unknown> } = {}
    try {
      parsed = JSON.parse(req.postData() ?? '{}')
    } catch {
      await route.fallback()
      return
    }
    if (/Media\s*\(/.test(parsed.query ?? '') && parsed.variables?.id != null) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { Media: MANGA_MEDIA } }) })
      return
    }
    await route.fallback()
  })
  await page.route('**/api/manga/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.includes('mdx-')) return route.fulfill({ status: 404, body: '{}' })
    if (path.startsWith('/api/manga/match/')) return json({ providerMangaId: 'fixture-series', providerTitle: 'Berserk', verified: true })
    if (path.startsWith('/api/manga/chapters/')) return json({
      chapters: Array.from({ length: 45 }, (_, i) => ({
        providerChapterId: `ch-${i + 1}`,
        label: `Chapter ${i + 1} · Communication ${i + 1}`,
        number: i + 1,
        unitType: 'chapter',
      })),
    })
    if (path.startsWith('/api/manga/pages/')) return json({ pages: pageUrls })
    return route.fulfill({ status: 404, body: '{}' })
  })
}

test.describe('Manga reader', () => {
  test('guest can read; the progress fill glows only once it has length', async ({ page }) => {
    test.setTimeout(180_000)
    await setupReader(page)
    await page.goto('/read/anilist-30002/first', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Berserk' }).first()).toBeVisible({ timeout: 60_000 })
    await page.waitForSelector('[data-page-index="2"] img', { timeout: 60_000 })
    // Wait for the readiness gate: the bar is meaningful only once pages
    // have resolved.
    await expect.poll(
      () => page.evaluate(() => document.documentElement.dataset.readerPagesReady),
      { timeout: 30_000 },
    ).toBe('1')

    const bar = page.getByTestId('navbar-read-progress')
    const atTop = await bar.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { opacity: cs.opacity, shadow: cs.boxShadow, transform: cs.transform }
    })
    expect(atTop.opacity, 'no glow blob at the top').toBe('0')
    expect(atTop.shadow, 'same neon glow as Continue Watching').toContain('6px')

    await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.5)))
    await expect.poll(async () => (await bar.evaluate((el) => getComputedStyle(el).opacity)), { timeout: 10_000 }).toBe('1')
    const moved = await bar.evaluate((el) => getComputedStyle(el).transform)
    expect(moved).not.toBe('matrix(0, 0, 0, 1, 0, 0)')
  })

  test('resume jumps once, after the pages above it resolve', async ({ page }) => {
    test.setTimeout(180_000)
    // Resume is a member feature (guests read fresh — see the guest test).
    await seedTestAuth(page)
    await routeTestMalIdentity(page)
    const urls = ['/fixture-page-0.svg', '/fixture-page-1.svg', '/fixture-page-2.svg']
    await setupReader(page, urls)

    // Hold page 0 open so the target page's position is not final yet.
    let releasePage0: () => void = () => {}
    const page0Gate = new Promise<void>((resolve) => { releasePage0 = resolve })
    await page.route('**/fixture-page-*.svg', async (route) => {
      if (route.request().url().includes('fixture-page-0')) await page0Gate
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PAGE_SVG })
    })

    // Seed a saved position (page 1 of chapter ch-1) through the app's own
    // IndexedDB schema.
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('aeri', 2)
        req.onupgradeneeded = () => {
          const d = req.result
          if (!d.objectStoreNames.contains('watchPos')) d.createObjectStore('watchPos', { keyPath: 'id' })
        }
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
      await new Promise<void>((res) => {
        const tx = db.transaction('watchPos', 'readwrite')
        tx.objectStore('watchPos').put({
          id: 'read:anilist-30002',
          chapterId: 'ch-1',
          chapterLabel: 'Chapter 1',
          provider: 'weebcentral',
          page: 1,
          maxPage: 3,
          updatedAt: Date.now(),
        })
        tx.oncomplete = () => res()
        tx.onerror = () => res()
      })
      db.close()
    })

    await page.goto('/read/anilist-30002/ch-1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-page-index="2"]', { timeout: 60_000 })

    // Page 0 is still in flight: the reader must NOT move yet.
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => window.scrollY), 'no auto-scroll while pages load').toBe(0)

    releasePage0()
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 20_000 }).toBeGreaterThan(300)
    const placed = await page.evaluate(() => window.scrollY)
    // ...and it stays there: one placement, no retry loop.
    await page.waitForTimeout(1600)
    expect(await page.evaluate(() => window.scrollY), 'no repeated scrolling').toBe(placed)
  })
})
