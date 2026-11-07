import { test, expect, type Page } from '@playwright/test'

/**
 * Search empty state (owner 2026-11-05).
 *
 * "when search and theres no results remove the centered description before
 * that was 'No results for ".". and still use the left header like the normal
 * search headers and show: No results for "keyword here" / Fetched from
 * AniList."
 *
 * So the zero-result page must read like every other search page: the same
 * left-aligned 18px title + 12px faint subline, with the query named in the
 * title. No centred sentence floating mid-page, no results grid.
 */

const QUERY = 'zzqqxxvvnonsensequery'

const emptyState = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body
    const h1 = main.querySelector('h1') as HTMLElement | null
    const sub = h1?.nextElementSibling as HTMLElement | null
    const centred = Array.from(main.querySelectorAll('*')).filter((el) => {
      const cs = getComputedStyle(el)
      return cs.textAlign === 'center' && (el.textContent ?? '').trim().length > 0
    })
    return {
      h1Text: (h1?.textContent ?? '').trim(),
      h1Align: h1 ? getComputedStyle(h1).textAlign : null,
      h1Left: h1?.getBoundingClientRect().left ?? null,
      h1FontSize: h1 ? getComputedStyle(h1).fontSize : null,
      subText: (sub?.textContent ?? '').trim(),
      subAlign: sub ? getComputedStyle(sub).textAlign : null,
      subColor: sub ? getComputedStyle(sub).color : null,
      centredCount: centred.length,
      cards: main.querySelectorAll('[data-anime-card], a[href*="/anime/"]').length,
    }
  })

test.describe('search with no results', () => {
  test('uses the normal left-aligned search header', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto(`/search?q=${QUERY}`, { waitUntil: 'domcontentloaded' })
    await page.locator('main h1').first().waitFor({ timeout: 60_000 })

    const s = await emptyState(page)

    expect(s.h1Text, 'the query is named in the title').toBe(`No results for “${QUERY}”`)
    expect(s.h1Align, 'left header, like the results page').toBe('start')
    expect(s.h1Left, 'flush with the page gutter, not centred').toBeLessThan(200)
    expect(s.h1FontSize, 'same title size as the results header').toBe('18px')

    expect(s.subText, 'the usual subline, not a stray sentence').toBe('Fetched from AniList.')
    expect(s.subAlign).toBe('start')

    expect(s.centredCount, 'nothing centred on the empty page').toBe(0)
    expect(s.cards, 'no result cards').toBe(0)
  })
})
