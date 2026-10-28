import type { Page } from '@playwright/test'

/**
 * Deterministic test-only auth fixture for playback specs.
 *
 * PRODUCTION AUTH IS UNTOUCHED. The app's real path (AniList OAuth code →
 * Worker exchange → Bearer Viewer query, or MAL PKCE) is never modified,
 * bypassed, or weakened by this file. These helpers run ONLY inside the
 * Playwright browser context and do two test-scoped things:
 *
 * 1. Seed the SAME localStorage keys the production storage layer reads
 *    (`aeri:mal:access_token`, no expiry key) with a SYNTHETIC token value
 *    (`aeri-test-token`, never a real credential). The app then considers
 *    itself signed in through its UNCHANGED code path:
 *    getMalToken() → non-null → isAuthenticated → MALContext loads.
 * 2. Route the app's own network calls to test doubles via
 *    `page.route` (Playwright request interception — invisible to
 *    production, dies with the test page):
 *    - `api.myanimelist.net/v2/users/@me*` → synthetic Viewer + list
 *    - `graphql.anilist.co` → per-title Media records from
 *      tests/fixtures/anilist-media.json (metadata only, no playback bytes)
 *    - provider/video hosts → configurable (block, controlled MP4, or
 *      controlled HLS) so each suite asserts exactly what it proves.
 *
 * Why MAL and not AniList for the auth seed? MALContext validates auth
 * purely from localStorage (`getMalToken()` + `isMalTokenExpired()` — no
 * expiry key means not expired). It THEN calls loadUser → malProvider
 * .getUser → malFetch('/users/@me') which we intercept. AniListContext
 * instead immediately fires a REAL `Viewer` query on mount; intercepting
 * that too is possible, but MAL needs exactly ONE routed endpoint for the
 * whole auth surface (Viewer + list), keeping the fixture minimal and the
 * failure modes obvious.
 *
 * UNPROTECTED-ROUTE CONTRACT: tests that assert signed-out redirects must
 * NOT call signInTestUser — a fresh browser context has empty localStorage,
 * so isAuthenticated is false through the same unchanged code path.
 */

export const TEST_TOKEN = 'aeri-test-token'

export interface TestListEntry {
  malId: number
  title: string
  numEpisodes: number
  status?: string
  mediaType?: string
  /**
   * Seeded tracker progress. Anime entries read num_episodes_watched;
   * manga entries read num_chapters_read (the MAL mapper's manga
   * progress source). Omitted → zero progress.
   */
  progress?: number
  /** Seeded user score (0–10 as MAL carries it). Omitted → 0 (unscored). */
  score?: number
  /**
   * MAL-side cover URL (node main_picture.large). Seeded so display tests
   * can discriminate art SOURCES: after the AniList-metadata rule
   * a MAL-tracker card must carry AniList art, never this URL.
   */
  picture?: string
}

function malNode(e: TestListEntry) {
  const isManga = e.mediaType === 'manga'
  return {
    id: e.malId,
    title: e.title,
    main_picture: { large: e.picture ?? '', medium: '' },
    alternative_titles: { en: e.title, ja: e.title },
    start_date: '2000-01-01',
    synopsis: `${e.title} (test fixture)`,
    mean: 8,
    // MAL nodes are kind-scoped: anime nodes carry num_episodes; manga
    // nodes carry num_chapters (+ num_volumes). Never both.
    ...(isManga
      ? { num_chapters: e.numEpisodes, num_volumes: Math.ceil(e.numEpisodes / 12) }
      : { num_episodes: e.numEpisodes }),
    status: 'finished_airing',
    genres: [],
    studios: [],
    media_type: e.mediaType ?? 'tv',
    nsfw: 'white',
  }
}

function malEntry(e: TestListEntry) {
  const isManga = e.mediaType === 'manga'
  return {
    node: malNode(e),
    list_status: {
      status: e.status ?? (isManga ? 'reading' : 'watching'),
      score: e.score ?? 0,
      // One progress field per kind (MAL splits them). The mapper reads
      // `num_chapters_read ?? num_episodes_watched` — and `??` does NOT
      // skip 0 — so the cross-kind field must be OMITTED (undefined, which
      // JSON drops) exactly like the real MAL API does. Zeroing it made
      // anime progress always read 0 and broke every anime-seeded probe.
      num_episodes_watched: isManga ? undefined : (e.progress ?? 0),
      num_chapters_read: isManga ? (e.progress ?? 0) : undefined,
      updated_at: new Date().toISOString(),
    },
  }
}

/**
 * Seed test auth into the page's localStorage. Call BEFORE navigating to
 * an authenticated route. Uses the production storage keys with a
 * synthetic token — the app reads them through its normal
 * getMalToken()/isMalTokenExpired() path.
 */
export async function seedTestAuth(page: Page): Promise<void> {
  // Localhost runs (vite preview) have no same-origin worker: point the
  // MAL bridge at the production worker so routeTestMalIdentity's
  // worker-shaped doubles own the /api/mal/* calls (as other localhost
  // probes do), never letting the fake token reach the real upstream.
  await page.addInitScript(() => {
    try { localStorage.setItem('aeri:prefs', JSON.stringify({ customVideoApiUrl: 'https://aeri.fastdemo.workers.dev' })) } catch {}
  })
  await page.addInitScript((token: string) => {
    try {
      localStorage.setItem('aeri:mal:access_token', token)
      localStorage.removeItem('aeri:mal:token_expiry')
      localStorage.removeItem('aeri:mal:refresh_token')
      // AniList must stay signed OUT so the MAL tracker is the active one
      // through the unchanged getTrackingProvider() rule.
      localStorage.removeItem('aeri:anilist:token')
      localStorage.removeItem('aeri:anilist:token_expiry')
      localStorage.removeItem('aeri:anilist:token_type')
    } catch {}
  }, TEST_TOKEN)
}

/**
 * Route MAL identity endpoints to test doubles. `entries` becomes the
 * synthetic user's anime list (used for Continue Watching / My List state;
 * Watch/AnimeDetail do not require membership).
 *
 * DEFAULT COVERAGE: the six playback titles (Bebop/Naruto/One Piece/Death
 * Note/AoT/Frieren) are ALWAYS seeded into the by-id map, even when the
 * caller passes no list entries. Rationale: the app's MAL enrichment and
 * detail paths fetch `/anime/{malId}` for ANY watched title (not just
 * list members) — an empty map would let those requests escape to the
 * real upstream, making tests network-dependent. Seeded titles carry
 * zero progress (not in list); explicit `entries` override them.
 *
 * WORKER-BRIDGE ROUTES: on localhost the app has no same-origin worker,
 * so specs set customVideoApiUrl to the production worker for provider
 * paths — which ALSO reroutes MAL fetches to `/api/mal/*` FIRST (before
 * the direct api.myanimelist.net fallback). The `/api/mal/*` branch below
 * answers those worker-shaped requests with the SAME test doubles, so the
 * fake token NEVER reaches the real upstream (it would 401 → the app
 * would clear tokens and sign the test user OUT mid-test). The direct
 * api.myanimelist.net routes stay as the second layer (production
 * same-origin runs use them directly).
 *
 * ROUTING CONSTRAINT (verified 2026-10-10): Playwright does NOT chain a
 * later-registered `/^https?:\/\//` handler into an earlier glob via
 * route.continue() — the broad handler swallows the request and the
 * earlier route NEVER fires (real upstream → 401). Therefore the
 * fail-closed test MUST NOT install its own broad regex; it reuses the
 * scoped `blockUpstreamMedia()` helper (the only place that registers the
 * broad pattern, registered LAST, allowlists worker/metadata/app URLs and
 * aborts only provider/media hosts). One broad route per page, ever.
 */
export async function routeTestMalIdentity(page: Page, entries: TestListEntry[] = []): Promise<void> {
  await page.route('**/api.myanimelist.net/v2/users/@me**', async (route) => {
    const url = route.request().url()
    if (url.includes('/animelist') || url.includes('/mangalist')) {
      // Kind-faithful like the real MAL API: each list endpoint returns ONLY
      // entries of its own kind — serving everything on both endpoints made
      // the combined list contain kindless duplicates.
      const kind = url.includes('/mangalist') ? 'manga' : 'anime'
      const scoped = entries.filter((e) => (e.mediaType === 'manga' ? kind === 'manga' : kind === 'anime'))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: scoped.map(malEntry), paging: {} }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 424242, name: 'aeri-test-user' }),
    })
  })
  // Detail-by-id endpoints (enrichment fallback / direct MAL detail):
  // answer from the seeded list so no real upstream is ever touched.
  // NOTE: registered BEFORE the my_list_status routes — Playwright
  // matches routes in reverse registration order, so the more specific
  // write routes below must win over this broad GET-shape route.
  const DEFAULT_ENTRIES: TestListEntry[] = [
    { malId: 1, title: 'Cowboy Bebop', numEpisodes: 26 },
    { malId: 20, title: 'Naruto', numEpisodes: 220 },
    { malId: 21, title: 'One Piece', numEpisodes: 69 },
    { malId: 1535, title: 'Death Note', numEpisodes: 37 },
    { malId: 16498, title: 'Attack on Titan', numEpisodes: 25 },
    { malId: 52991, title: 'Frieren', numEpisodes: 28 },
  ]
  const byId = new Map<number, TestListEntry>()
  for (const d of DEFAULT_ENTRIES) byId.set(d.malId, d)
  for (const e of entries) byId.set(e.malId, e)
  await page.route('**/api.myanimelist.net/v2/anime/*', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    const m = route.request().url().match(/\/anime\/(\d+)/)
    const e = m ? byId.get(Number(m[1])) : undefined
    if (!e) { await route.continue(); return }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...malNode(e), my_list_status: { status: 'watching', score: 0, num_episodes_watched: 0 } }),
    })
  })
  await page.route('**/api.myanimelist.net/v2/manga/*', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    const m = route.request().url().match(/\/manga\/(\d+)/)
    const e = m ? byId.get(Number(m[1])) : undefined
    if (!e) { await route.continue(); return }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...malNode(e), my_list_status: { status: 'reading', score: 0, num_chapters_read: 0 } }),
    })
  })
  // Writes (PUT/POST/DELETE my_list_status) are accepted — the app's write
  // path (updateProgress/Status/Rating/Remove) is exercised for real; only
  // the upstream persistence is doubled. Registered AFTER the broad
  // detail routes so they win (Playwright matches in reverse order).
  await page.route('**/api.myanimelist.net/v2/anime/*/my_list_status**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api.myanimelist.net/v2/manga/*/my_list_status**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  // Worker-bridge doubles (localhost only): same payloads, worker-shaped
  // paths. The app tries these FIRST when customVideoApiUrl is set; the
  // fake token must never reach the real upstream (it would 401 → the app
  // would clear tokens and sign the test user OUT mid-test).
  // Kind-faithful like the real MAL API: each list endpoint returns ONLY
  // entries of its own kind, on BOTH the worker-bridge path and the direct
  // path. Everything else made the combined list carry kindless duplicates.
  const scopedListBody = (url: string) => {
    const kind = url.includes('/mangalist') ? 'manga' : 'anime'
    const scoped = entries.filter((e) => (e.mediaType === 'manga' ? kind === 'manga' : kind === 'anime'))
    return JSON.stringify({ data: scoped.map(malEntry), paging: {} })
  }
  const malListBody = () => JSON.stringify({ data: entries.map(malEntry), paging: {} })
  await page.route('https://aeri.fastdemo.workers.dev/api/mal/users/@me**', async (route) => {
    const url = route.request().url()
    if (url.includes('/animelist') || url.includes('/mangalist')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: scopedListBody(url) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 424242, name: 'aeri-test-user' }) })
  })
  await page.route('https://aeri.fastdemo.workers.dev/api/mal/anime/**', async (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/my_list_status')) {
      const m = route.request().url().match(/\/anime\/(\d+)/)
      const e = m ? byId.get(Number(m[1])) : undefined
      if (e) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...malNode(e), my_list_status: { status: 'watching', score: 0, num_episodes_watched: 0 } }) })
        return
      }
      await route.continue()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('https://aeri.fastdemo.workers.dev/api/mal/manga/**', async (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/my_list_status')) {
      const m = route.request().url().match(/\/manga\/(\d+)/)
      const e = m ? byId.get(Number(m[1])) : undefined
      if (e) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...malNode(e), my_list_status: { status: 'reading', score: 0, num_chapters_read: 0 } }) })
        return
      }
      await route.continue()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  // Provider/video calls addressed to the production origin are REAL
  // cross-origin fetches (no route — the localhost bridge pattern is
  // customVideoApiUrl → production worker, documented in setPrefs).
}
/** Remove ALL test routes (auth + anilist + media). Call in afterEach. */
export async function unrouteTestDoubles(page: Page): Promise<void> {
  await page.unroute('**/api.myanimelist.net/v2/users/@me**').catch(() => {})
  await page.unroute('**/api.myanimelist.net/v2/anime/*/my_list_status**').catch(() => {})
  await page.unroute('**/api.myanimelist.net/v2/manga/*/my_list_status**').catch(() => {})
  await page.unroute('**/api.myanimelist.net/v2/anime/*').catch(() => {})
  await page.unroute('**/api.myanimelist.net/v2/manga/*').catch(() => {})
  await page.unroute('https://aeri.fastdemo.workers.dev/api/mal/users/@me**').catch(() => {})
  await page.unroute('https://aeri.fastdemo.workers.dev/api/mal/anime/**').catch(() => {})
  await page.unroute('https://aeri.fastdemo.workers.dev/api/mal/manga/**').catch(() => {})
  await page.unroute('https://graphql.anilist.co/**').catch(() => {})
}

/**
 * Assert the signed-out redirect contract IN the app: visiting a protected
 * route with an empty context must land back on `/` (Home). Path-based
 * URLs (BrowserRouter): Home is pathname `/` — transiently `/?signin=1`
 * while the sign-in popup hint is being stripped; either is a pass. The
 * caller must use a FRESH context (no seedTestAuth, no routed identity).
 */
export async function expectSignedOutRedirect(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const landed = await page.evaluate(() => ({ path: location.pathname, search: location.search }))
  const backHome = landed.path === '/' && (landed.search === '' || landed.search.startsWith('?'))
  if (!backHome) {
    throw new Error(`expected signed-out redirect to Home for ${path}, stayed at ${landed.path}${landed.search}`)
  }
}
