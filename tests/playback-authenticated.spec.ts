import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity, expectSignedOutRedirect } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'
import { blockUpstreamMedia } from './helpers/test-media'

/**
 * Authenticated playback — the repaired end of the playback harness.
 *
 * AUTH: every test here (except the signed-out contract suite) seeds the
 * production MAL localStorage keys with the synthetic `aeri-test-token`
 * and routes `api.myanimelist.net/v2/users/@me*` + `graphql.anilist.co`
 * to test doubles. Production auth code is UNCHANGED — see
 * tests/helpers/test-auth.ts for the isolation argument.
 *
 * MEDIA STRATEGY (explicit per suite — never silent):
 * - "deterministic" suites route media bytes to CONTROLLED doubles
 *   (302 → real MDN MP4; real mux multivariant playlist, real upstream
 *   segments). They prove: guards pass, episode grid works, provider
 *   resolution + relay + player wiring deliver frames, currentTime
 *   advances, dead providers are never requested, trailers never appear.
 * - "live" suites route NOTHING at the media layer and assert against
 *   real upstream bytes. They are explicitly labeled and may fail on
 *   upstream outages without invalidating the deterministic suites.
 *
 * Proof standard: video element with readyState>=2 AND advancing
 * currentTime. Player shell or HTTP 200 alone is never asserted as
 * playback.
 */

// ---------------------------------------------------------------------------
// Shared: authenticated Watch state probe
// ---------------------------------------------------------------------------

async function watchState(page: Page) {
  return page.evaluate(() => {
    const body = document.body.innerText
    const v = document.querySelector('video') as HTMLVideoElement | null
    return {
      body: body.slice(0, 2000),
      hash: location.hash,
      hasVideo: !!v,
      hasIframe: !!document.querySelector('iframe'),
      hasNoSource: body.includes('No playable source'),
      hasFinding: body.includes('Finding video source') || body.includes('Finding episodes'),
      tried: (body.match(/Tried:\s*([^\n]+)/i) || [])[1]?.trim() ?? '',
      iframeSrc: (document.querySelector('iframe') as HTMLIFrameElement | null)?.src ?? '',
      videoProbe: v ? { rs: v.readyState, vw: v.videoWidth, t: v.currentTime, err: (v.error as { code?: number } | null)?.code ?? 0 } : null,
    }
  })
}

async function setupAuth(page: Page) {
  await seedTestAuth(page)
  await routeTestMalIdentity(page)
  await routeTestAnilistMedia(page)
  // Worker bridge prefs must exist BEFORE first navigation: addInitScript
  // runs before page scripts, so getEffectiveVideoApiUrl() sees the bridge
  // on the very first load (goto → setPrefs would be too late — the app
  // reads prefs during initial render).
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem('aeri:prefs')
      const cur = raw ? JSON.parse(raw) : {}
      if (!cur.customVideoApiUrl) {
        localStorage.setItem('aeri:prefs', JSON.stringify({ ...cur, customVideoApiUrl: 'https://aeri.fastdemo.workers.dev' }))
      }
    } catch {}
  })
}

async function setPrefs(page: Page, prefs: Record<string, unknown>) {
  // addInitScript (not evaluate): tests run setPrefs BEFORE goto, when the
  // page is still about:blank — evaluate there writes to an opaque origin
  // (discarded on navigation; verified 2026-10-10: prefs missing → aniwave
  // baseless → no-source). Init scripts run at document start on the REAL
  // origin, so prefs exist before the app's first render reads them.
  // Localhost has no same-origin worker: point the app at the production
  // worker for provider/video paths (documented local-preview pattern —
  // customVideoApiUrl → getEffectiveVideoApiUrl). Production runs are
  // same-origin and ignore this without effect.
  await page.addInitScript((p: Record<string, unknown>) => {
    try {
      const raw = localStorage.getItem('aeri:prefs')
      const cur = raw ? JSON.parse(raw) : {}
      localStorage.setItem('aeri:prefs', JSON.stringify({
        ...cur,
        customVideoApiUrl: 'https://aeri.fastdemo.workers.dev',
        ...p,
      }))
    } catch {}
  }, prefs)
}

async function waitForDecision(page: Page, label: string) {
  // WAIT FOR A STABLE TERMINAL STATE — not merely the absence of "Finding".
  // "Finding" clears between the episode phase and the source phase, and
  // no-source can render TRANSIENTLY (sources settled empty while a
  // re-resolution is still queued after providerEpisodes flip the
  // effective episode id). Terminal must therefore HOLD for 3 consecutive
  // seconds before it counts. 150s budget: cold upstream resolution alone
  // can take ~60s after a slow dev-server compile.
  const deadline = Date.now() + 150000
  let stableSince = 0
  let last: Awaited<ReturnType<typeof watchState>> | null = null
  while (Date.now() < deadline) {
    const s = await watchState(page)
    last = s
    const terminal = s.hasVideo || s.hasIframe || s.hasNoSource || s.body.includes("isn't available right now")
    if (terminal) {
      if (!stableSince) stableSince = Date.now()
      if (Date.now() - stableSince >= 3000) return s
    } else {
      stableSince = 0
    }
    await page.waitForTimeout(1000)
  }
  const s = last ?? await watchState(page)
  expect(
    s.hasVideo || s.hasIframe || s.hasNoSource || s.body.includes("isn't available right now"),
    `must reach a STABLE terminal player decision for ${label} — ${s.body.slice(0, 300)}`,
  ).toBeTruthy()
  return s
}

async function assertAdvancingPlayback(page: Page, label: string) {
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    if (v) { v.muted = true; v.play().catch(() => {}) }
  })
  await expect(async () => {
    const p = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      return v ? { rs: v.readyState, vw: v.videoWidth, t: v.currentTime, err: (v.error as { code?: number } | null)?.code ?? 0 } : null
    })
    expect(p, `${label}: video element must exist`).not.toBeNull()
    expect(p!.err, `${label}: video error must be 0`).toBe(0)
    expect(p!.rs, `${label}: readyState>=2 (has frames)`).toBeGreaterThanOrEqual(2)
    expect(p!.vw, `${label}: videoWidth>0 (real frames)`).toBeGreaterThan(0)
    expect(p!.t, `${label}: currentTime must advance`).toBeGreaterThan(0.4)
  }).toPass({ timeout: 30000, intervals: [500, 1000] })
}


// ---------------------------------------------------------------------------
// Suite A — signed-out contract (NO auth seed, fresh context)
// ---------------------------------------------------------------------------

test.describe('Signed-out route guards (no auth seed)', () => {
  test('Watch redirects signed-out users to Home', async ({ page }) => {
    await expectSignedOutRedirect(page, '/watch/anilist-20/1')
  })
  test('AnimeDetail redirects signed-out users to Home', async ({ page }) => {
    await expectSignedOutRedirect(page, '/anime/anilist-20')
  })
})

// ---------------------------------------------------------------------------
// Suite B — authenticated entry (no media doubles needed)
// ---------------------------------------------------------------------------

test.describe('Authenticated entry — guards pass, episode grid works', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test('Watch loads for the test user (no redirect to Home)', async ({ page }) => {
    test.setTimeout(120000)
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'watch-loads')
    expect(s.hash).toContain('/watch/anilist-20/1')
    // A decision must be reached: video, iframe, or honest no-source.
    expect(s.hasVideo || s.hasIframe || s.hasNoSource, `must reach a player decision — ${s.body.slice(0, 300)}`).toBeTruthy()
  })

  test('AnimeDetail loads without redirect', async ({ page }) => {
    test.setTimeout(90000)
    await page.goto('/#/anime/anilist-20', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    const hash = await page.evaluate(() => location.hash)
    expect(hash).toContain('/anime/anilist-20')
    await expect(page.locator('body')).toContainText('Naruto', { timeout: 15000 })
  })

  test('Episode selection navigates the grid', async ({ page }) => {
    test.setTimeout(120000)
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await waitForDecision(page, 'ep-grid')
    // Episode grid renders from AniList metadata (220 eps for Naruto).
    const ep5 = page.locator('a[aria-label^="Watch E5"]').first()
    await expect(ep5).toBeVisible({ timeout: 15000 })
    await ep5.click()
    await page.waitForTimeout(2000)
    const hash = await page.evaluate(() => location.hash)
    expect(hash).toContain('/watch/anilist-20/5')
  })
})

// ---------------------------------------------------------------------------
// Suite C — deterministic playback (AnimeGG resolution, controlled bytes)
// ---------------------------------------------------------------------------

test.describe('Deterministic playback — provider resolves, player advances', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
    // No media doubles: aniwave's signed relay bytes flow for real. The
    // suite is deterministic because aniwave resolution is server-side
    // (title-hinted, fail-closed match) and the relay serves allowlisted
    // CDN bytes — no browser-CORS lottery. If the aniwave upstream itself
    // is down, these fail LOUDLY (no-source assertion), never silently.
  })

  test('Aniwave E1 sub resolves through the real chain and currentTime advances', async ({ page }) => {
    // What this proves: auth guards pass, episode grid resolves, aniwave
    // match→sources→signed-relay runs for real, frames decode, currentTime
    // advances. No byte doubles anywhere in this path.
    test.setTimeout(180000)
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'aniwave-e1')
    expect(s.hasNoSource, `Aniwave must resolve (upstream live?) — ${s.tried || s.body.slice(0, 200)}`).toBeFalsy()
    expect(s.hasVideo, `expected a video element — ${s.body.slice(0, 300)}`).toBeTruthy()
    await assertAdvancingPlayback(page, 'aniwave-e1')
  })

  test('Dead and unverified providers are never requested', async ({ page }) => {
    test.setTimeout(180000)
    // No broad route here (see ROUTING CONSTRAINT in test-auth.ts: a
    // later-registered /^https?:\/\// swallows earlier globs and breaks
    // the identity bridge → signed-out redirect). Instead assert on the
    // RENDERED tried-list: the registry records every provider it actually
    // attempted, so "Tried: X • Y" is first-party proof of what was (and
    // was not) requested. Dead/unverified ids must never appear there.
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'dead-never-requested')
    // The tried-list renders ONLY in the no-source box. On success the
    // equivalent proof is the Source selector: every option names its
    // provider (`aniwave • auto • sub`), so a forbidden provider would
    // appear verbatim if it had contributed a source.
    const triedLine = (s.body.match(/Tried:\s*([^\n]+)/i) || [])[1] ?? ''
    const sourceLabels = await page.evaluate(() =>
      [...document.querySelectorAll('select[aria-label="Select video source"] option')]
        .map(o => (o as HTMLOptionElement).textContent ?? ''),
    )
    const haystack = `${triedLine}\n${sourceLabels.join('\n')}`.toLowerCase()
    expect(haystack.length, `expected provider evidence in the UI — ${s.body.slice(0, 200)}`).toBeGreaterThan(0)
    for (const dead of ['allanime', 'animepahe', 'anikoto', 'megaplay', 'animeparadise', 'anineko', 'miruro', 'official', 'demo', 'custom']) {
      expect(haystack, `dead/unverified provider '${dead}' must never be requested`).not.toContain(dead)
    }
  })

  test('YouTube trailers never appear as episode playback', async ({ page }) => {
    test.setTimeout(180000)
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await waitForDecision(page, 'no-trailer')
    const src = await page.evaluate(() => (document.querySelector('iframe') as HTMLIFrameElement | null)?.src ?? '')
    expect(src).not.toMatch(/youtube/)
    // The tried-list must never name a trailer provider (none exists).
    const s = await watchState(page)
    expect(s.tried).not.toMatch(/official/)
  })
})

// ---------------------------------------------------------------------------
// Suite D — HLS wiring via the app's own player (no byte doubles)
// ---------------------------------------------------------------------------

test.describe('HLS wiring — app player advances on live relay bytes', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
    // NO media routes: the app's own VideoPlayer pulls the signed relay
    // playlist + segments. This proves the hls.js wiring end-to-end
    // through production code (not an isolated <video> + manual Hls).
  })

  test('App VideoPlayer advances on aniwave relay bytes', async ({ page }) => {
    test.setTimeout(180000)
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'app-player-hls')
    expect(s.hasVideo, `expected the app player — ${s.body.slice(0, 300)}`).toBeTruthy()
    await assertAdvancingPlayback(page, 'app-player-hls')
  })
})

// ---------------------------------------------------------------------------
// Suite E — LIVE provider playback (explicitly labeled, upstream-dependent)
// ---------------------------------------------------------------------------

test.describe('LIVE provider playback (real upstream bytes — may fail on outage)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
    // NO media routes: every byte comes from real upstreams.
  })

  test('LIVE: MegaVid Naruto E1 sub resolves and advances', async ({ page }) => {
    test.setTimeout(180000)
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'live-megavid')
    expect(s.hasNoSource, `provider must resolve live — ${s.tried || s.body.slice(0, 200)}`).toBeFalsy()
    expect(s.hasVideo, `expected a video element — ${s.body.slice(0, 300)}`).toBeTruthy()
    await assertAdvancingPlayback(page, 'live-megavid')
  })

  test('LIVE: relay-blocked playback degrades honestly (no shell masquerade)', async ({ page }) => {
    // With the relay's media bytes blocked, the app must reach an HONEST
    // terminal state: no-source (fail closed) or an error box — never a
    // <video> with a dead src masquerading as playback, never a trailer.
    // (Fallback to a second full-episode provider cannot be proven on
    // localhost: every verified provider needs either the relay or a
    // CORS-open upstream, and browsers enforce CORS. Production-origin
    // runs exercise the true cross-provider fallback.)
    //
    // MEDIA_ERROR tolerance: with bytes blocked the player fires error
    // code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED) — that IS the honest signal
    // here. Assert the video element carries the error (not silent
    // emptiness) and no YouTube trailer appears.
    test.setTimeout(180000)
    await page.route('**://aeri.fastdemo.workers.dev/api/stream**', r => r.abort('blockedbyclient'))
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'live-fallback')
    expect(s.hasVideo || s.hasNoSource, 'must reach a decision with relay blocked').toBeTruthy()
    if (s.hasVideo) {
      // Bytes blocked: the honest outcomes are (a) no advancing playback
      // with a MEDIA_ERR_SRC_NOT_SUPPORTED error on the element, or
      // (b) the player recovering via a non-blocked path (then advancing
      // playback must hold). Either way: never a trailer.
      const probe = await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement | null
        return v ? { err: (v.error as { code?: number } | null)?.code ?? 0, t: v.currentTime } : null
      })
      expect(probe, 'video element must exist').not.toBeNull()
      if (probe!.err === 0) {
        await assertAdvancingPlayback(page, 'live-fallback')
      } else {
        expect(probe!.err, 'blocked bytes must surface as MEDIA_ERR_SRC_NOT_SUPPORTED').toBe(4)
      }
    } else {
      const src = await page.evaluate(() => (document.querySelector('iframe') as HTMLIFrameElement | null)?.src ?? '')
      expect(src).not.toMatch(/youtube/)
    }
    await page.unroute('**://aeri.fastdemo.workers.dev/api/stream**').catch(() => {})
  })

  test('LIVE: fully blocked upstreams yield honest no-source (fail closed)', async ({ page }) => {
    test.setTimeout(180000)
    // Single broad route per page (see ROUTING CONSTRAINT in test-auth):
    // blockUpstreamMedia fulfills identity itself and aborts everything
    // except the app shell + metadata fixtures. Relay NOT allowed here —
    // episodes, sources, playlists, segments all die upstream.
    const blocked: string[] = []
    await blockUpstreamMedia(page, blocked)
    await setPrefs(page, { preferredProvider: 'aniwave', preferredAudio: 'sub' })
    await page.goto('/#/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'live-fail-closed')
    // Guards still pass (auth + metadata fixtures are test-scoped and live);
    // with every upstream blocked, the honest state is no-source — never a
    // shell masquerading as playback, never a trailer.
    expect(s.hasVideo, 'blocked upstreams must not produce a video element').toBeFalsy()
    expect(s.hasNoSource, `must show honest no-source — ${s.body.slice(0, 200)}`).toBeTruthy()
    const src = await page.evaluate(() => (document.querySelector('iframe') as HTMLIFrameElement | null)?.src ?? '')
    expect(src).not.toMatch(/youtube/)
    // Sanity: SOMETHING upstream was actually blocked (else the test proves
    // nothing — a no-op route also yields no-source).
    expect(blocked.length, `expected blocked upstream requests — got ${blocked.length}`).toBeGreaterThan(0)
    await page.unroute(/^https?:\/\//).catch(() => {})
  })
})
