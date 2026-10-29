import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * MANGA READER — nav layout.
 *
 * Pins the shape of the reader's chapter controls:
 *   - the chapter picker sits on the prev/next row (top AND bottom), dead
 *     centre; the header row carries no picker,
 *   - the gap above the first page and the gap below the last page are the
 *     same 16px,
 *   - the bottom of the reader lists Related Anime as well as Related Manga,
 *   - on /read only, the navbar's divider is a scroll progress bar.
 */

const PAGE_IMG = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22%3E%3Crect width=%222%22 height=%223%22 fill=%22%23445566%22/%3E%3C/svg%3E'

// Same artwork, served over HTTP so a route handler can hold it open and
// prove the progress bar stays gated while pages are in flight.
const PAGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"><rect width="2" height="3" fill="#445566"/></svg>'

// Manga detail with BOTH a manga and an anime relation, so the two related
// rails are exercised in one pass.
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
  relations: {
    edges: [
      {
        relationType: 'ADAPTATION',
        node: {
          id: 30003,
          title: { romaji: 'Berserk Anime', english: 'Berserk Anime', native: 'Berserk Anime' },
          format: 'TV', status: 'FINISHED', episodes: 25, chapters: null, volumes: null,
          coverImage: { extraLarge: PAGE_IMG, large: '', medium: '' },
          bannerImage: '',
        },
      },
      {
        relationType: 'SEQUEL',
        node: {
          id: 30151,
          title: { romaji: 'Berserk Fragments', english: 'Berserk Fragments', native: 'Berserk Fragments' },
          format: 'MANGA', status: 'FINISHED', episodes: null, chapters: 3, volumes: null,
          coverImage: { extraLarge: PAGE_IMG, large: '', medium: '' },
          bannerImage: '',
        },
      },
    ],
  },
  trailer: null,
}

async function setupReader(page: Page, pageUrls: string[] = [PAGE_IMG, PAGE_IMG, PAGE_IMG]): Promise<void> {
  await seedTestAuth(page)
  await routeTestMalIdentity(page)
  await routeTestAnilistMedia(page)
  // Override only the detail Media query; everything else falls back to the
  // shared AniList fixture handler.
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
  // Deterministic manga providers: MangaDex misses, WeebCentral serves.
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

const metrics = () => {
  const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null)
  const topNav = document.querySelector('[data-testid="chapter-nav-top"]')
  const bottomNav = document.querySelector('[data-testid="chapter-nav-bottom"]')
  const pages = [...document.querySelectorAll('[data-page-index]')]
  const first = pages[0] ?? null
  const last = pages[pages.length - 1] ?? null
  const selects = [...document.querySelectorAll('select[aria-label="Select chapter"]')]
  const centerOf = (el: Element | null) => {
    const r = rect(el)
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  }
  const navRowCenter = (nav: Element | null) => centerOf(nav)
  const pillCenter = (nav: Element | null) => {
    const sel = nav?.querySelector('select[aria-label="Select chapter"]')
    return centerOf(sel?.parentElement ?? null)
  }
  return {
    topGap: topNav && first ? Math.round(rect(first)!.top - rect(topNav)!.bottom) : null,
    bottomGap: bottomNav && last ? Math.round(rect(bottomNav)!.top - rect(last)!.bottom) : null,
    topCenterDelta: (() => {
      const a = navRowCenter(topNav)
      const b = pillCenter(topNav)
      return a && b ? Math.round(Math.abs(a.x - b.x) * 10) / 10 : null
    })(),
    bottomCenterDelta: (() => {
      const a = navRowCenter(bottomNav)
      const b = pillCenter(bottomNav)
      return a && b ? Math.round(Math.abs(a.x - b.x) * 10) / 10 : null
    })(),
    selectCount: selects.length,
    headerSelects: document.querySelectorAll('[data-testid="reader-header"] select').length,
    pageCount: pages.length,
    navOverflow: topNav ? topNav.scrollWidth - topNav.clientWidth : null,
  }
}

test.describe('Manga reader — nav layout', () => {
  test('centred picker, equal page gaps, related anime, reader progress bar', async ({ page }) => {
    test.setTimeout(180000)
    await setupReader(page)
    await page.goto('/read/anilist-30002/first', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Berserk' }).first()).toBeVisible({ timeout: 60000 })
    await page.waitForSelector('[data-testid="chapter-nav-bottom"]', { timeout: 60000 })
    await page.waitForSelector('[data-page-index="2"] img', { timeout: 60000 })
    await page.waitForTimeout(800)

    const wide = await page.evaluate(metrics)
    expect(wide.pageCount, 'three pages rendered').toBe(3)
    expect(wide.selectCount, 'one picker per nav row').toBe(2)
    expect(wide.headerSelects, 'header carries no picker').toBe(0)
    expect(wide.topGap, 'nav → first page').toBe(16)
    expect(wide.bottomGap, 'last page → nav').toBe(16)
    expect(wide.topCenterDelta, 'top picker is centred').toBeLessThanOrEqual(1)
    expect(wide.bottomCenterDelta, 'bottom picker is centred').toBeLessThanOrEqual(1)

    // Chapter picker = white-button exception: white fill, --on-text label
    // and chevron, no visible border OR focus ring, still the shared 30px
    // pill. Focus it first — the ring used to appear on click and read as a
    // dark border around the white pill.
    await page.locator('select[aria-label="Select chapter"]').first().focus()
    const pickerTone = await page.evaluate(() => {
      const read = (nav: Element | null) => {
        const select = nav?.querySelector('select[aria-label="Select chapter"]')
        const pill = select?.parentElement as HTMLElement | null
        if (!pill) return null
        const cs = getComputedStyle(pill)
        const label = pill.querySelector('span[aria-hidden]') as HTMLElement | null
        const chevron = pill.querySelector('svg') as SVGElement | null
        return {
          bg: cs.backgroundColor,
          borderColor: cs.borderTopColor,
          shadow: cs.boxShadow,
          text: label ? getComputedStyle(label).color : null,
          chevron: chevron ? getComputedStyle(chevron).color : null,
          chevronStroke: chevron ? getComputedStyle(chevron).strokeWidth : null,
          height: Math.round(pill.getBoundingClientRect().height * 10) / 10,
        }
      }
      return {
        top: read(document.querySelector('[data-testid="chapter-nav-top"]')),
        bottom: read(document.querySelector('[data-testid="chapter-nav-bottom"]')),
      }
    })
    for (const [where, tone] of Object.entries(pickerTone)) {
      expect(tone, `${where} chapter picker exists`).not.toBeNull()
      expect(tone!.bg, `${where} picker is white`).toBe('rgb(255, 255, 255)')
      expect(tone!.text, `${where} picker label uses --on-text`).toBe('rgb(0, 0, 0)')
      expect(tone!.chevron, `${where} picker chevron matches the label`).toBe('rgb(0, 0, 0)')
      expect(tone!.borderColor, `${where} picker has no visible border`).toBe('rgba(0, 0, 0, 0)')
      expect(tone!.shadow, `${where} picker paints no focus ring`).toBe('none')
      // 12px icon in a 24-unit viewBox: 2.5 renders at the same optical
      // weight as the 12px text arrows on the Prev/Next pills.
      expect(tone!.chevronStroke, `${where} picker chevron matches the arrow weight`).toBe('2.5px')
      expect(tone!.height, `${where} picker keeps the 30px pill`).toBeCloseTo(30, 0)
    }

    // Related rails: anime adaptation first, manga sequel second. Both use
    // the site-standard Home card width — no per-row edge-fit stretching.
    await expect(page.getByRole('heading', { name: 'Related Anime' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Related Manga' })).toBeVisible()
    const relatedWidths = await page.evaluate(() => {
      const row = (title: string) => {
        const section = [...document.querySelectorAll('section')].find(
          (s) => s.querySelector('h2')?.textContent?.trim() === title,
        )
        const first = section?.querySelector('.no-scrollbar')?.firstElementChild as HTMLElement | null
        return first ? Math.round(first.getBoundingClientRect().width) : null
      }
      return {
        anime: row('Related Anime'),
        manga: row('Related Manga'),
        expected: window.innerWidth >= 1024 ? 236 : window.innerWidth >= 640 ? 200 : 168,
      }
    })
    expect(relatedWidths.anime, 'Related Anime cards use the Home rail width').toBe(relatedWidths.expected)
    expect(relatedWidths.manga, 'Related Manga cards use the Home rail width').toBe(relatedWidths.expected)
    expect(relatedWidths.anime, 'both related rails share one card width').toBe(relatedWidths.manga)

    // Reader-only navbar divider: a scroll progress bar that fills.
    const fill = page.locator('[data-testid="navbar-read-progress"]')
    await expect(fill).toHaveCount(1)
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.4)))
    await page.waitForTimeout(300)
    const bar = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="navbar-read-progress"]') as HTMLElement | null
      if (!el) return null
      const track = el.parentElement as HTMLElement
      return {
        transform: getComputedStyle(el).transform,
        fillShadow: getComputedStyle(el).boxShadow,
        fillOpacity: getComputedStyle(el).opacity,
        trackHeight: Math.round(track.getBoundingClientRect().height * 10) / 10,
        trackOpacity: getComputedStyle(track).opacity,
      }
    })
    expect(bar, 'progress bar exists').not.toBeNull()
    expect(bar!.trackHeight, '2px track').toBe(2)
    expect(bar!.trackOpacity, 'visible once scrolled').toBe('1')
    // Flat fill: the 6px neon glow was removed on the owner's instruction
    // (2026-10-29). The fill is still hidden at zero length.
    expect(bar!.fillShadow, 'reader progress fill is flat — no neon glow').toBe('none')
    expect(bar!.fillOpacity, 'fill visible once it has length').toBe('1')
    const scaleX = Number(/matrix\(([^,]+)/.exec(bar!.transform)?.[1] ?? '0')
    expect(scaleX, 'fill tracks scroll position').toBeGreaterThan(0.2)

    // At the very top the fill has no length, so it is hidden entirely.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    const topBar = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="navbar-read-progress"]') as HTMLElement | null
      return el ? { opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform } : null
    })
    expect(topBar!.opacity, 'fill hidden at the top').toBe('0')
    expect(Number(/matrix\(([^,]+)/.exec(topBar!.transform)?.[1] ?? '1'), 'fill at zero').toBe(0)

    // Narrow: the three cells still fit, picker still centred, gaps unchanged.
    await page.setViewportSize({ width: 375, height: 800 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    const narrow = await page.evaluate(metrics)
    expect(narrow.navOverflow, 'nav row does not overflow at 375').toBeLessThanOrEqual(1)
    expect(narrow.topGap, 'narrow: nav → first page').toBe(16)
    expect(narrow.bottomGap, 'narrow: last page → nav').toBe(16)
    expect(narrow.topCenterDelta, 'narrow: top picker centred').toBeLessThanOrEqual(1)
    expect(narrow.bottomCenterDelta, 'narrow: bottom picker centred').toBeLessThanOrEqual(1)
  })

  test('progress bar waits until every page image has loaded', async ({ page }) => {
    test.setTimeout(180000)
    const slowPages = [1, 2, 3].map((n) => `/slow-reader-page-${n}.svg`)
    await setupReader(page, slowPages)
    // Hold every page image open until the test releases them: the bar must
    // stay at zero until the LAST one resolves, not start crawling while the
    // document is still growing. A fixed timer is not enough — fixture
    // navigation can outlast it, which would make the gate look open.
    let releasePages = () => {}
    const pagesHeld = new Promise<void>((resolve) => { releasePages = resolve })
    await page.route('**/slow-reader-page-*.svg', async (route) => {
      await pagesHeld
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PAGE_SVG })
    })

    await page.goto('/read/anilist-30002/first', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Berserk' }).first()).toBeVisible({ timeout: 60000 })
    // ATTACHED, not visible: a pending image has no intrinsic size yet.
    await page.waitForSelector('[data-page-index="2"] img', { state: 'attached', timeout: 60000 })

    // Scroll while the images are still in flight.
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.4)))
    await page.waitForTimeout(300)

    const gated = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="navbar-read-progress"]') as HTMLElement | null
      return {
        ready: document.documentElement.dataset.readerPagesReady,
        transform: el ? getComputedStyle(el).transform : null,
        eager: [...document.querySelectorAll('[data-page-index] img')].every(
          (img) => (img as HTMLImageElement).loading === 'eager',
        ),
      }
    })
    expect(gated.ready, 'readiness is false while pages are loading').toBe('0')
    const gatedScale = Number(/matrix\(([^,]+)/.exec(gated.transform ?? '')?.[1] ?? '1')
    expect(gatedScale, 'bar stays at zero while pages are loading').toBe(0)
    // Lazy images below the fold would never resolve, leaving the gate shut
    // for the whole chapter.
    expect(gated.eager, 'every reader image is eager').toBe(true)

    // All three images resolve → the gate opens and the bar tracks scroll.
    releasePages()
    await page.waitForFunction(() => document.documentElement.dataset.readerPagesReady === '1', { timeout: 30000 })
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.5)))
    await page.waitForTimeout(300)
    const opened = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="navbar-read-progress"]') as HTMLElement | null
      return el ? getComputedStyle(el).transform : null
    })
    const openedScale = Number(/matrix\(([^,]+)/.exec(opened ?? '')?.[1] ?? '0')
    expect(openedScale, 'bar tracks scroll once every page has loaded').toBeGreaterThan(0.3)
  })

  test('chapter dividers never flash white on re-sort', async ({ page }) => {
    test.setTimeout(180000)
    await setupReader(page)
    await page.goto('/manga/anilist-30002', { waitUntil: 'domcontentloaded' })
    const rows = page.locator('a[href^="/read/anilist-30002/ch-"]')
    await expect(rows.first()).toBeVisible({ timeout: 60000 })

    // The chapter name owns the row's free width: the old fixed 96px column
    // clipped "Chapter 1 · Communication 1" while the rest of the row sat
    // empty. It must render in full at desktop width.
    const labelProbe = await page.evaluate(() => {
      const row = document.querySelector('a[href^="/read/anilist-30002/ch-"]') as HTMLElement | null
      const label = row?.querySelector('[data-testid="chapter-label"]') as HTMLElement | null
      if (!row || !label) return null
      return {
        text: (label.textContent || '').trim(),
        width: Math.round(label.getBoundingClientRect().width),
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
      }
    })
    expect(labelProbe, 'chapter row label rendered').not.toBeNull()
    expect(labelProbe!.text, 'full chapter name, not an ellipsis prefix').toMatch(/^Chapter \d+ · Communication \d+$/)
    expect(labelProbe!.width, 'label uses the free row width').toBeGreaterThan(200)
    expect(labelProbe!.scrollWidth, 'label is not truncated').toBeLessThanOrEqual(labelProbe!.clientWidth + 1)

    // Same frame-accurate probe as the episode list: click the sort control
    // inside the page and sample the first row's divider every frame. The
    // old per-position `border-b` under `transition` started its 0→1px
    // border at currentColor (white) when the last row became first.
    const probe = await page.evaluate(async () => {
      const findFirst = () => {
        const first = document.querySelector('a[href^="/read/anilist-30002/ch-"]')
        if (!first) return null
        const cs = getComputedStyle(first)
        return { color: cs.borderBottomColor, width: cs.borderBottomWidth, href: first.getAttribute('href') }
      }
      const before = findFirst()
      const btn = [...document.querySelectorAll('button')].find(
        (b) => /Sort chapters/i.test(b.getAttribute('aria-label') ?? ''),
      ) as HTMLButtonElement | undefined
      btn?.click()
      const samples: Array<{ color: string; width: string; href: string | null }> = []
      for (let i = 0; i < 12; i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        const s = findFirst()
        if (s) samples.push(s)
      }
      return { before, samples }
    })
    expect(probe.before, 'chapter list rendered').not.toBeNull()
    expect(probe.before!.width, 'chapter divider is drawn').toBe('1px')
    expect(probe.samples.length, 'sampled the re-sorted list').toBeGreaterThan(0)
    for (const s of probe.samples) {
      expect(s.color, 'chapter divider never flashes white').toBe(probe.before!.color)
    }
    expect(probe.samples[probe.samples.length - 1].width, 'first chapter divider stays drawn').toBe('1px')
    expect(probe.samples[probe.samples.length - 1].href, 'the sort actually reordered the list').not.toBe(probe.before!.href)
    expect(probe.before!.color).not.toContain('rgba')
  })

  test('other pages keep the plain hairline (no reader bar)', async ({ page }) => {
    await setupReader(page)
    await page.goto('/anime', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="navbar-read-progress"]')).toHaveCount(0)
  })
})
