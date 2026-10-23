import type { Page } from '@playwright/test'
import { mediaFixtureByVariables, mediaBatchFixtureByResponse } from '../fixtures/anilist-media'

/**
 * Route the app's AniList metadata fetch to local fixtures (metadata
 * doubles, NOT playback doubles). Intercepts ONLY
 * `POST https://graphql.anilist.co` — the metadata backbone. Every other
 * host (providers, worker relay, CDNs) passes through untouched unless a
 * test adds its own route.
 *
 * Request shape handling: the app POSTs `{ query, variables }`. When the
 * query is a Media detail query the fixture answers from variables.id /
 * variables.idMal. Page/search/list queries (Viewer, MediaListCollection,
 * Page media) get a minimal empty-but-valid shape so contexts that DO
 * touch them (signed-in Home rails) render empty rows instead of hanging
 * — playback specs navigate directly to Watch/AnimeDetail and never
 * depend on rails content.
 */

export async function routeTestAnilistMedia(page: Page): Promise<void> {
  await page.route('https://graphql.anilist.co/**', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    let parsed: { query?: string; variables?: Record<string, unknown> } = {}
    try {
      parsed = JSON.parse(req.postData() ?? '{}')
    } catch {
      await route.continue()
      return
    }
    const q = parsed.query ?? ''
    const vars = parsed.variables ?? {}
    // Batched by-MAL list resolution (enrichment D111): one query per ≤50
    // ids, answer from the anime fixtures (unmapped-specific ids compose
    // their responses in their own spec doubles).
    if (/idMal_in/.test(q) && Array.isArray(vars.ids)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mediaBatchFixtureByResponse(vars.ids as number[], String(vars.type ?? 'ANIME'))),
      })
      return
    }
    // Detail Media query (anime or manga): answer from fixtures.
    if (/Media\s*\(/.test(q) && (vars.id != null || vars.idMal != null || vars.malId != null)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mediaFixtureByVariables(vars)),
      })
      return
    }
    // Viewer / list / page queries: valid empty shapes (never AUTH errors —
    // auth state comes from the MAL seed, and these tests never assert on
    // list contents).
    if (q.includes('Viewer')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { Viewer: { id: 424242, name: 'aeri-test-user' } } }),
      })
      return
    }
    if (q.includes('MediaListCollection')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { MediaListCollection: { lists: [] } } }),
      })
      return
    }
    if (q.includes('Page(') || q.includes('Page (')) {
      // Rails + browse: valid empty shape. pageInfo included — the browse
      // paginator reads hasNextPage off it; omitting it would crash the
      // parser (not merely empty rows).
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false, currentPage: 1, lastPage: 1, total: 0 }, media: [] } } }),
      })
      return
    }
    // Unknown query shape: answer with a failing GraphQL envelope — LOUD
    // (suites depending on it get dead rows, not silently swallowed data)
    // and hermetic. It used to route.continue() to the REAL upstream,
    // which leaks test traffic and (during an AniList outage, 2026-10-21)
    // lets the app's own service-down telemetry fire mid-test. The
    // GraphQL-errors envelope maps to UNKNOWN — a per-caller failure, NOT
    // a counted service-down hard fail.
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'test-double: unhandled query shape' }] }) })
  })
}

/** One-call setup for an authenticated playback page: seed + identity + media. */
export async function setupAuthenticatedPlayback(
  page: Page,
  opts: { seedAuth: (p: Page) => Promise<void>; routeIdentity: (p: Page, entries?: never[]) => Promise<void> },
): Promise<void> {
  await opts.seedAuth(page)
  await opts.routeIdentity(page)
  await routeTestAnilistMedia(page)
}
