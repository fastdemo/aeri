import { test, expect } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { FIXTURE_COVER } from './fixtures/anilist-media'

/**
 * Continue-card episode NAME contract (D128).
 *
 * Real shape (verified against AniList, D127): AniList 2904 (Code Geass R2)
 * carries SEASON ONE's 25 Crunchyroll rows while the entry itself has 25
 * episodes. The display guards discard that list, so the card's "next
 * episode" line must come from the gated Kitsu fallback — never S1's row and
 * never a bare placeholder.
 *
 * This suite seeds a MAL tracker entry (progress 4 → next episode 5) and
 * answers AniList + Kitsu with deterministic doubles:
 *   AniList 2904: 25 S1 rows ("S1 Episode N - Stage N.0") + PREQUEL 25 eps
 *   Kitsu mapping anilist/anime/2904 → 26, episodes 1..25 named
 * Expected caption: "The R2 Name for Five" (Kitsu), NOT "Stage 5.0" (S1).
 *
 * HARNESS NOTE (why the batch is answered too): the MAL enrichment resolves
 * list entries through the batched `idMal_in` query and CACHES an absence for
 * every id the batch does not return (`anilist:bymal:anime:<id>` = null,
 * anilistMetadata.ts). A double that leaves 1575 out of the batch makes the
 * card read that cached null and render the placeholder — the card would then
 * look broken for a fixture reason, not a product reason.
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
    title: {
      romaji: 'Code Geass: Hangyaku no Lelouch R2',
      english: 'Code Geass: Lelouch of the Rebellion R2',
      native: 'コードギアス 反逆のルルーシュR2',
    },
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
    // Season-1 pollution: 25 rows on a 25-episode entry.
    streamingEpisodes: Array.from({ length: 25 }, (_, i) => ({
      title: `S1 Episode ${i + 1} - Stage ${i + 1}.0`,
      thumbnail: '',
      url: `https://crunchyroll.com/s1/ep${i + 1}`,
      site: 'Crunchyroll',
    })),
    nextAiringEpisode: null,
    airingSchedule: { nodes: [] },
    isAdult: false,
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

test('continue card shows the Kitsu name, not the polluted S1 row (CG R2)', async ({ page }) => {
  await seedTestAuth(page)
  await routeTestMalIdentity(page, [
    { malId: R2_MAL_ID, title: 'Code Geass R2', numEpisodes: 25, progress: 4, picture: FIXTURE_COVER },
  ])
  // ONE AniList double for every query shape Home sends.
  await page.route('https://graphql.anilist.co/**', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    let body: { query?: string; variables?: Record<string, unknown> } = {}
    try { body = JSON.parse(req.postData() ?? '{}') } catch { body = {} }
    const q = body.query ?? ''
    const v = body.variables ?? {}
    const wantsR2 = /Media\s*\(/.test(q)
      && (Number(v.id) === R2_ANILIST_ID || Number(v.idMal ?? v.malId) === R2_MAL_ID)
    let data: unknown
    if (/Viewer/.test(q)) data = { Viewer: { id: 1, name: 'aeri-test-user' } }
    else if (/MediaListCollection/.test(q)) data = { MediaListCollection: { lists: [] } }
    else if (/idMal_in/.test(q)) {
      data = { Page: { media: ((v.ids as number[] | undefined) ?? []).includes(R2_MAL_ID) ? [r2Media()] : [] } }
    } else if (wantsR2) data = { Media: r2Media() }
    else {
      data = {
        trending: { media: [] }, popular: { media: [] }, airing: { media: [] }, newReleases: { media: [] },
        Page: { media: [] }, Media: null,
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) })
  })
  // Kitsu: mapping anilist 2904 → 26, then 25 named episodes.
  await page.route('https://kitsu.io/api/edge/mappings**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/vnd.api+json',
      body: JSON.stringify({ data: [{ id: 'map-1', relationships: { item: { data: { type: 'anime', id: KITSU_ID } } } }] }),
    })
  })
  await page.route('https://kitsu.io/api/edge/anime/*/episodes**', async (route) => {
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

  await page.goto('/')
  await expect(page.getByText('Continue Watching', { exact: true }).first()).toBeVisible()
  const card = page.locator('button[aria-label^="Open Code Geass"]').first()
  await expect(card).toBeVisible()
  await expect.poll(
    async () => ((await card.textContent()) ?? '').replace(/\s+/g, ' '),
    { timeout: 20_000 },
  ).toContain(KITSU_NAME_5)
  const caption = ((await card.textContent()) ?? '').replace(/\s+/g, ' ')
  expect(caption).not.toContain(S1_NAME_5)
})
