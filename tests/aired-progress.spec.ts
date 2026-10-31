import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * AIRED-EPISODE PROGRESS + STABLE LIST DIVIDERS.
 *
 * Progress is measured against episodes that HAVE AIRED, not the planned
 * season total — the preview card follows the same rule. The fixture is a
 * 12-episode RELEASING show whose next episode is 4 (so 3 have aired) with 3
 * watched: the old code read 3 of 12 (25%), the new code must read 3 of 3
 * (100%).
 *
 * The episode/chapter row separators are an OPAQUE token, so re-sorting
 * first-last / last-first can never change their colour (an 8%-alpha line
 * composited with whatever background the row had).
 */

const AIRING = { malId: 9001, title: 'Probe Airing Show', numEpisodes: 12, progress: 3 }

async function setup(page: Page): Promise<void> {
  await seedTestAuth(page)
  await routeTestMalIdentity(page, [AIRING])
  await routeTestAnilistMedia(page)
}

test.describe('Aired-episode progress', () => {
  test('Continue Watching bar is full when 3 aired and 3 watched', async ({ page }) => {
    await setup(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // The floating continue pill (D150/D155) — not the old 2px flush bar.
    const track = page.locator('[data-continue-bar]').first()
    await expect(track).toBeVisible({ timeout: 30000 })

    // The card's AniList enrichment lands a moment later (the list copy has
    // no airing schedule) — poll until the bar reaches full width.
    await expect
      .poll(async () => {
        const sizes = await track.evaluate((el) => {
          const fill = el.firstElementChild as HTMLElement | null
          return { track: el.getBoundingClientRect().width, fill: fill?.getBoundingClientRect().width ?? 0 }
        })
        return sizes.track > 0 ? Math.round((sizes.fill / sizes.track) * 100) : -1
      }, { timeout: 30000 })
      .toBe(100)
  })

  test('Preview card reads "3 of 3 • 100% watched"', async ({ page }) => {
    await setup(page)
    await page.goto('/anime/mal-9001', { waitUntil: 'domcontentloaded' })

    const line = page.getByText(/of\s+3\s+•\s+100% watched/).first()
    await expect(line).toBeVisible({ timeout: 45000 })
    await expect(line).not.toContainText('of 12')
  })
})

test.describe('Episode list dividers', () => {
  test('the first row divider keeps its color across both sort orders', async ({ page }) => {
    await setup(page)
    await page.goto('/anime/mal-9001', { waitUntil: 'domcontentloaded' })

    const rows = page.locator('div.overflow-hidden.rounded-lg > a[href^="/watch/"]')
    await expect(rows.first()).toBeVisible({ timeout: 45000 })

    // One snapshot of every divider color in the episode list (the last row
    // has no divider, so it is compared by border style instead).
    const dividers = async () =>
      page.evaluate(() => {
        const list = [...document.querySelectorAll('div')].find(
          (d) =>
            typeof d.className === 'string' &&
            d.className.includes('overflow-hidden') &&
            d.className.includes('rounded-lg') &&
            d.querySelector(':scope > a[href^="/watch/"]'),
        ) as HTMLDivElement | undefined
        if (!list) return null
        const rowEls = [...list.querySelectorAll(':scope > a')]
        return {
          hrefs: rowEls.map((r) => r.getAttribute('href')),
          colors: rowEls.map((r) => getComputedStyle(r).borderBottomColor),
          widths: rowEls.map((r) => getComputedStyle(r).borderBottomWidth),
        }
      })

    const asc = await dividers()
    expect(asc, 'episode list rendered').not.toBeNull()
    const drawnAsc = asc!.widths.flatMap((w, i) => (w === '1px' ? [asc!.colors[i]] : []))
    expect(drawnAsc.length, 'the list has dividers').toBeGreaterThan(1)
    expect(new Set(drawnAsc).size, 'every divider shares one color').toBe(1)

    // Sample the first divider every frame WHILE a real Playwright click
    // lands on the sort control. A real pointer click matters: the modal is
    // a portal, and a synthetic .click() from inside the page does not reach
    // its React handler. The old per-position `border-b` under `transition`
    // started its 0→1px border at currentColor (white) when the last row
    // became first; the fixed row carries the divider colour from frame one.
    const sampling = page.evaluate(
      () =>
        new Promise<Array<{ color: string; width: string; href: string | null }>>((resolve) => {
          const read = () => {
            const list = [...document.querySelectorAll('div')].find(
              (d) =>
                typeof d.className === 'string' &&
                d.className.includes('overflow-hidden') &&
                d.className.includes('rounded-lg') &&
                d.querySelector(':scope > a[href^="/watch/"]'),
            ) as HTMLDivElement | undefined
            const first = list?.querySelector(':scope > a')
            if (!first) return null
            const cs = getComputedStyle(first)
            return { color: cs.borderBottomColor, width: cs.borderBottomWidth, href: first.getAttribute('href') }
          }
          const out: Array<{ color: string; width: string; href: string | null }> = []
          const t0 = performance.now()
          const tick = () => {
            const s = read()
            if (s) out.push(s)
            if (performance.now() - t0 < 1500) requestAnimationFrame(tick)
            else resolve(out)
          }
          requestAnimationFrame(tick)
        }),
    )
    await page.getByRole('button', { name: /Sort episodes/i }).first().click()
    const samples = await sampling
    expect(samples.length, 'sampled the re-sorted list').toBeGreaterThan(0)
    for (const s of samples) {
      expect(s.color, 'first divider never flashes white').toBe(drawnAsc[0])
    }
    expect(samples[samples.length - 1].width, 'first divider is drawn').toBe('1px')
    expect(samples[samples.length - 1].href, 'the sort actually reordered the list').not.toBe(asc!.hrefs[0])

    await page.waitForTimeout(400)

    const desc = await dividers()
    expect(desc, 'episode list rendered after re-sort').not.toBeNull()
    const drawnDesc = desc!.widths.flatMap((w, i) => (w === '1px' ? [desc!.colors[i]] : []))
    expect(new Set(drawnDesc).size, 'every divider shares one color after re-sort').toBe(1)
    expect(drawnDesc[0], 're-sorting must not change the divider color').toBe(drawnAsc[0])

    // Opaque, not alpha: an rgba() line would composite with the row
    // background and read differently over hover/watched rows.
    expect(drawnAsc[0]).not.toContain('rgba')
  })
})
