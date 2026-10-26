import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * MANGA READER — MAL-BACKED IDS (regression, owner 2026-10-26)
 *
 * "the chapters did exist and shows it was fetched from weebcentral but when
 * i click on the chapter it says manga not found… happened to like most
 * mangas."
 *
 * Root cause: MAL tracker entries carry `internalId: mal-<malId>` (the list
 * mapper) and every Read/Continue link is built from `internalId`, but
 * `anilistMetadata.getManga()` only understood numeric/`anilist-` ids —
 * `Number('mal-23390')` is NaN, so the reader answered NOT_FOUND for nearly
 * every signed-in MAL manga even though the detail page had just listed its
 * chapters. `getManga` now mirrors `getAnime` and resolves `mal-` ids through
 * `idMal`.
 *
 * This spec pins the contract at the route level: `/read/mal-<id>/first`
 * must render the title (metadata resolved), never the "Manga not found"
 * wall, and the `anilist-` path must keep working.
 */

test.describe('Manga reader — MAL-backed ids', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestAuth(page)
    await routeTestMalIdentity(page)
    await routeTestAnilistMedia(page)
  })

  test('mal-<id> resolves the manga instead of showing "Manga not found"', async ({ page }) => {
    test.setTimeout(120000)
    await page.goto('/read/mal-2/first', { waitUntil: 'domcontentloaded' })

    // The title heading only renders after getManga() resolves the record.
    await expect(page.getByRole('heading', { name: 'Berserk' }).first()).toBeVisible({ timeout: 45000 })
    await expect(page.getByText('Manga not found')).toHaveCount(0)
    // The reader stays on the requested route (no redirect to /manga).
    expect(new URL(page.url()).pathname).toBe('/read/mal-2/first')
  })

  test('subtitle carries chapter + provider, dropdown stays chapter-only', async ({ page }) => {
    test.setTimeout(120000)
    // Deterministic provider: MangaDex misses (404), WeebCentral serves a
    // two-chapter list. No live provider is touched.
    await page.route('**/api/manga/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const json = (body: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (path.includes('mdx-')) return route.fulfill({ status: 404, body: '{}' })
      if (path.startsWith('/api/manga/match/')) return json({ providerMangaId: 'fixture-series', providerTitle: 'Berserk', verified: true })
      // The resolver's completeness guard rejects a "sliver" of a long series
      // (Berserk: 392 chapters → needs ≥40 units), so the fixture serves 45.
      if (path.startsWith('/api/manga/chapters/')) return json({
        chapters: Array.from({ length: 45 }, (_, i) => ({
          providerChapterId: `ch-${i + 1}`,
          label: `Chapter ${i + 1}`,
          number: i + 1,
          unitType: 'chapter',
        })),
      })
      if (path.startsWith('/api/manga/pages/')) return json({ pages: [] })
      return route.fulfill({ status: 404, body: '{}' })
    })
    await page.goto('/read/mal-2/first', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Berserk' }).first()).toBeVisible({ timeout: 45000 })
    await page.waitForSelector('select[aria-label="Select chapter"]', { timeout: 45000 })

    // Owner 2026-10-26: "remove the source:weeb central line … its not the
    // dropdown my bad its the top left one that says 'chapter 1' under attack
    // on titan". So the SUBTITLE under the title reads `Chapter 1 · WeebCentral`
    // (middle dot) and the dropdown pill stays exactly as it was.
    const header = await page.evaluate(() => {
      const h1 = document.querySelector('h1') as HTMLElement | null
      const subtitle = h1?.parentElement?.querySelector('p') as HTMLElement | null
      const sel = document.querySelector('select[aria-label="Select chapter"]') as HTMLSelectElement | null
      const shell = sel?.parentElement as HTMLElement | null
      const pill = shell ? (shell.querySelector('span[aria-hidden]')?.textContent || '').trim() : ''
      return {
        sourceLine: document.body.innerText.includes('pages load from this provider'),
        subtitle: (subtitle?.textContent || '').replace(/\s+/g, ' ').trim(),
        pill: pill.replace(/\s+/g, ' '),
        options: [...(sel?.options ?? [])].slice(0, 2).map((o) => o.textContent),
      }
    })
    expect(header.sourceLine, 'the standalone Source line is gone').toBe(false)
    expect(header.subtitle, 'subtitle reads "<chapter> · <provider>"').toBe('Chapter 1 · WeebCentral')
    expect(header.subtitle).not.toContain(' - ')
    // The dropdown pill is untouched: chapter only, no provider suffix.
    expect(header.pill, 'dropdown pill stays chapter-only').toBe('Chapter 1')
    expect(header.pill).not.toContain(' · ')
    // The dropdown list stays chapter-only — the provider is not repeated on
    // every row.
    for (const option of header.options) expect(option).not.toContain(' · ')
  })

  test('anilist-<id> keeps working (no regression on the native path)', async ({ page }) => {
    test.setTimeout(120000)
    await page.goto('/read/anilist-30002/first', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: 'Berserk' }).first()).toBeVisible({ timeout: 45000 })
    await expect(page.getByText('Manga not found')).toHaveCount(0)
  })
})
