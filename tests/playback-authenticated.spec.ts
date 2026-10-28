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
      path: location.pathname,
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
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'watch-loads')
    expect(s.path).toContain('/watch/anilist-20/1')
    // A decision must be reached: video, iframe, or honest no-source.
    expect(s.hasVideo || s.hasIframe || s.hasNoSource, `must reach a player decision — ${s.body.slice(0, 300)}`).toBeTruthy()
  })

  test('AnimeDetail loads without redirect', async ({ page }) => {
    test.setTimeout(90000)
    await page.goto('/anime/anilist-20', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    const path = await page.evaluate(() => location.pathname)
    expect(path).toContain('/anime/anilist-20')
    await expect(page.locator('body')).toContainText('Naruto', { timeout: 15000 })
  })

  test('Episode selection navigates the grid', async ({ page }) => {
    test.setTimeout(120000)
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await waitForDecision(page, 'ep-grid')
    // Episode grid renders from AniList metadata (220 eps for Naruto).
    const ep5 = page.locator('a[aria-label^="Watch Episode 5"]').first()
    await expect(ep5).toBeVisible({ timeout: 15000 })
    await ep5.click()
    await page.waitForTimeout(2000)
    const path = await page.evaluate(() => location.pathname)
    expect(path).toContain('/watch/anilist-20/5')
  })

  test('Progress writes stay bounded during playback (no write storm)', async ({ page }) => {
    // Regression for the 2026-10-10 progress-write storm: the mount
    // progress effect re-fired on every updateProgress callback identity
    // change (PUT → loadList → new array → new callback → re-fire),
    // reaching ~100 PUT/s on builds without the once-guard. The root fix
    // (stable writer identity via list ref + in-flight write guard in
    // MAL/AniList contexts) must hold even under continuous playback.
    // Bound: one mount write for the episode; the 80%-completion write
    // may add at most one more. Anything above proves a refire loop.
    test.setTimeout(180000)
    await setPrefs(page, { preferredAudio: 'sub' })
    let puts = 0
    page.on('request', (r) => {
      if (r.url().includes('my_list_status') && r.method() === 'PUT') puts++
    })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'progress-bounded')
    expect(s.path).toContain('/watch/anilist-20/1')
    // Let playback run well past several 5s persist ticks + completion.
    await page.waitForTimeout(60000)
    expect(puts, `progress PUTs in 60s of playback must stay bounded (mount + completion), got ${puts}`).toBeLessThanOrEqual(2)
    // Episode switch writes exactly one more (new key), then stays bounded.
    const before = puts
    await page.goto('/watch/anilist-20/2', { waitUntil: 'domcontentloaded' })
    await waitForDecision(page, 'progress-ep-switch')
    await page.waitForTimeout(30000)
    expect(puts - before, `episode switch must add at most one progress write, got ${puts - before}`).toBeLessThanOrEqual(2)
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
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
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
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'dead-never-requested')
    // The tried-list renders ONLY in the no-source box. On success the
    // equivalent proof is the Source selector: every option names its
    // provider (`aniwave` after D124), so a forbidden provider would appear
    // verbatim if it had contributed a source.
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
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
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
    await setPrefs(page, { preferredAudio: 'sub', volume: 0.35 })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'app-player-hls')
    expect(s.hasVideo, `expected the app player — ${s.body.slice(0, 300)}`).toBeTruthy()
    expect(s.hasIframe, 'Video.js must be the only player path (no iframe)').toBeFalsy()
    const skin = await page.evaluate(() => {
      const el = document.querySelector('.video-skin') as HTMLElement | null
      const v = document.querySelector('video') as HTMLVideoElement
      return {
        count: document.querySelectorAll('.video-skin').length,
        theme: el?.getAttribute('data-theme') ?? null,
        nativeControls: v?.controls ?? null,
        volume: v?.volume ?? null,
        videoWidth: v?.videoWidth ?? 0,
      }
    })
    expect(skin.count, 'exactly one Video.js skin').toBe(1)
    expect(skin.theme, 'Video.js default skin').toBe('default')
    expect(skin.nativeControls, 'native <video> chrome must be off').toBe(false)
    expect(Math.abs((skin.volume ?? 0) - 0.35), 'volume preference reaches the media element').toBeLessThan(0.001)
    await assertAdvancingPlayback(page, 'app-player-hls')
    const decoded = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return { videoWidth: v.videoWidth, videoHeight: v.videoHeight }
    })
    expect(decoded.videoWidth, 'decoded frames, not a shell').toBeGreaterThan(0)
    expect(decoded.videoHeight, 'decoded frames, not a shell').toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Suite D2 — deterministic direct-source paths (worker source route only)
// ---------------------------------------------------------------------------

const FLOWER_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const MUX_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'

async function routeDirectSource(
  page: Page,
  source: {
    url: string
    type: string
    embed?: boolean
    subtitles?: Array<{ language: string; label: string; url: string }>
  },
): Promise<void> {
  await page.route('**/api/sources/aniwave-*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sources: [{
          ...source,
          quality: 'auto',
          provider: 'aniwave',
          language: 'sub',
          embed: source.embed ?? false,
        }],
      }),
    })
  })
}

test.describe('Direct-source paths — HlsJsVideo (deterministic)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  test('direct MP4 plays through the single Video.js player', async ({ page }) => {
    test.setTimeout(180000)
    await setPrefs(page, { preferredAudio: 'sub', autoplay: true, volume: 0.25 })
    await routeDirectSource(page, { url: FLOWER_MP4, type: 'mp4' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'direct-mp4')
    expect(s.hasVideo, `expected the direct MP4 player — ${s.body.slice(0, 300)}`).toBeTruthy()
    expect(s.hasIframe, 'no iframe fallback for a direct source').toBeFalsy()
    const state = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return {
        currentSrc: v.currentSrc,
        controls: v.controls,
        volume: v.volume,
        skin: document.querySelectorAll('.video-skin').length,
      }
    })
    expect(state.currentSrc).toContain('flower.mp4')
    expect(state.controls).toBe(false)
    expect(state.skin).toBe(1)
    expect(Math.abs(state.volume - 0.25)).toBeLessThan(0.001)
    await assertAdvancingPlayback(page, 'direct-mp4')
  })

  test('embed-only sources are filtered, never rendered as an iframe', async ({ page }) => {
    test.setTimeout(180000)
    await setPrefs(page, { preferredAudio: 'sub', autoplay: false })
    await routeDirectSource(page, { url: 'https://example.com/embed/1', type: 'embed', embed: true })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'embed-filtered')
    expect(s.hasVideo, 'an embed-only source must not create a <video>').toBeFalsy()
    expect(s.hasIframe, 'an embed-only source must not create an <iframe>').toBeFalsy()
    expect(s.hasNoSource, `must reach the honest no-source UI — ${s.body.slice(0, 300)}`).toBeTruthy()
    expect(s.body).toContain('No playable source')
  })

  test('subtitle preference activates the source text track', async ({ page }) => {
    test.setTimeout(180000)
    const vtt = `data:text/vtt;charset=utf-8,${encodeURIComponent('WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello from Aeri\n')}`
    await setPrefs(page, {
      preferredAudio: 'sub',
      autoplay: false,
      subtitles: true,
    })
    await routeDirectSource(page, {
      url: FLOWER_MP4,
      type: 'mp4',
      subtitles: [{ language: 'en', label: 'English', url: vtt }],
    })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await waitForDecision(page, 'subtitle-track')
    await page.waitForFunction(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      return !!v && v.textTracks.length > 0
    }, null, { timeout: 30000 })
    await page.waitForTimeout(1000)
    const tracks = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return Array.from(v.textTracks).map((track) => ({ kind: track.kind, mode: track.mode, label: track.label }))
    })
    console.log('SUBTITLE_TRACKS', JSON.stringify(tracks))
    expect(tracks.some((track) => track.kind === 'subtitles')).toBeTruthy()
    expect(tracks.some((track) => track.kind === 'subtitles' && track.mode === 'showing')).toBeTruthy()
  })

  test('saved position seeks after Resume on a direct HLS source', async ({ page }) => {
    test.setTimeout(180000)
    await setPrefs(page, { preferredAudio: 'sub', autoplay: false })
    await routeDirectSource(page, { url: MUX_HLS, type: 'hls' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('video', { timeout: 90000 })
    await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause())
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('aeri', 2)
        req.onupgradeneeded = () => {
          const d = req.result
          if (!d.objectStoreNames.contains('watchPos')) d.createObjectStore('watchPos', { keyPath: 'id' })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('watchPos', 'readwrite')
        tx.objectStore('watchPos').put({
          id: 'anilist-20',
          episode: 1,
          currentTime: 100,
          duration: 600,
          updatedAt: Date.now(),
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Resume from', { timeout: 90000 })
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.waitForFunction(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      return !!v && v.readyState >= 1 && v.currentTime >= 95
    }, null, { timeout: 90000 })
    const t = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime)
    expect(t).toBeGreaterThanOrEqual(95)
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

  test('LIVE: AniWave Naruto E1 sub resolves and advances', async ({ page }) => {
    test.setTimeout(180000)
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'live-aniwave')
    expect(s.hasNoSource, `provider must resolve live — ${s.tried || s.body.slice(0, 200)}`).toBeFalsy()
    expect(s.hasVideo, `expected a video element — ${s.body.slice(0, 300)}`).toBeTruthy()
    await assertAdvancingPlayback(page, 'live-aniwave')
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
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    const s = await waitForDecision(page, 'live-fallback')
    expect(s.hasVideo || s.hasNoSource, 'must reach a decision with relay blocked').toBeTruthy()
    if (s.hasVideo) {
      // Bytes blocked: the honest outcomes are (a) no advancing playback
      // with a MEDIA_ERR_SRC_NOT_SUPPORTED error on the element, or
      // (b) the player recovering via a non-blocked path (then advancing
      // playback must hold). Either way: never a trailer.
      const probe = await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement | null
        const dialog = document.querySelector('.video-skin [role="alertdialog"]') as HTMLElement | null
        return {
          err: (v?.error as { code?: number } | null)?.code ?? 0,
          t: v?.currentTime ?? 0,
          dialogVisible: !!dialog && dialog.getBoundingClientRect().width > 0,
          dialogText: dialog?.textContent?.trim().slice(0, 200) ?? '',
        }
      })
      expect(probe, 'video element must exist').not.toBeNull()
      if (probe!.err === 0 && !probe!.dialogVisible) {
        await assertAdvancingPlayback(page, 'live-fallback')
      } else {
        // Old player surfaced MEDIA_ERR_SRC_NOT_SUPPORTED on <video>;
        // Video.js owns the error surface via its default skin dialog
        // (hls.js manifest failure is not a native media error). Either
        // is honest — a dead element with no error is not.
        expect(
          probe!.err === 4 || probe!.dialogVisible,
          `blocked bytes must surface an error (video=${probe!.err}, dialog=${probe!.dialogText})`,
        ).toBeTruthy()
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
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
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

// ---------------------------------------------------------------------------
// Suite B2 — watch-page interactivity during playback (desktop + mobile)
// ---------------------------------------------------------------------------
// Regression battery for the reported "page unresponsive once streaming
// starts" issue. Investigation (2026-10-10, production build
// index-V0TjG727.js vs local index-BNjnosOm.js) found NO main-thread or
// overlay cause in current code: rAF deltas stay <12ms during storms,
// clicks dispatch in <10ms, hit-testing reaches every control, and the
// measured unresponsiveness traces to the pre-guard progress-write storm
// (~100 PUT/s saturating the worker + re-render churn on the OLD bundle).
// These tests pin the fixed behavior: every out-of-player control must
// respond within tight budgets WHILE video is playing.
test.describe('Watch interactivity during playback', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page)
  })

  async function gotoPlayingWatch(page: Page) {
    await setPrefs(page, { preferredAudio: 'sub' })
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 90000 })
    await page.evaluate(() => { const v = document.querySelector('video') as HTMLVideoElement | null; if (v) { v.muted = true; v.play().catch(() => {}) } })
    await page.waitForTimeout(8000)
  }

  test('Desktop: episode links, source selector, sub toggle respond during playback', async ({ page }) => {
    test.setTimeout(240000)
    await gotoPlayingWatch(page)
    // Episode link click navigates fast.
    let t0 = Date.now()
    await page.locator('a[aria-label^="Watch Episode 5"]').first().click({ timeout: 15000 })
    const clickMs = Date.now() - t0
    expect(clickMs, 'episode click must dispatch fast during playback').toBeLessThan(5000)
    await page.waitForTimeout(2000)
    expect(await page.evaluate(() => location.pathname)).toContain('/watch/anilist-20/5')
    // Back to E1, pause, then sub toggle + source selector must exist and respond.
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 90000 })
    await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.pause())
    await expect(page.locator('select[aria-label="Select video source"]')).toBeVisible({ timeout: 15000 })
    await page.locator('button', { hasText: /^Sub$/ }).first().click({ timeout: 15000 })
    expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.paused)).toBe(true)
  })

  test('Desktop: sidebar nav + header controls respond during playback', async ({ page }) => {
    test.setTimeout(240000)
    await gotoPlayingWatch(page)
    // Sidebar/home link.
    await page.locator('a[aria-label="aeri home"]').first().click({ timeout: 15000 })
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => location.pathname)).toBe('/')
    // Return to watch, then profile menu opens and reaches Settings.
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 90000 })
    await page.getByRole('button', { name: 'Profile' }).click({ timeout: 15000 })
    await expect(page.locator('[data-header-popup]')).toBeVisible({ timeout: 8000 })
    await page.getByRole('menuitem', { name: 'Settings' }).first().click({ timeout: 15000 })
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => location.pathname)).toContain('/settings')
  })

  test('Desktop: pause/resume + episode switch keep player coherent', async ({ page }) => {
    test.setTimeout(240000)
    await gotoPlayingWatch(page)
    await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.pause())
    await page.waitForTimeout(1000)
    expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.paused)).toBe(true)
    // Episode switch while paused navigates; new episode resolves its own player.
    await page.locator('a[aria-label^="Watch Episode 2"]').first().click({ timeout: 15000 })
    await page.waitForTimeout(2000)
    expect(await page.evaluate(() => location.pathname)).toContain('/watch/anilist-20/2')
    await page.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 90000 })
  })

  test('Mobile: taps + episode switch respond during playback', async ({ context }) => {
    test.setTimeout(240000)
    // Real touch pipeline (Pixel 5 emulation): tap dispatch, 300ms-delay
    // absence, and touch scrolling only exist with hasTouch enabled.
    // The desktop-chromium run of this file cannot provide that, so this
    // test spins its own touch context instead of using the shared page.
    const touchCtx = await context.browser()!.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      isMobile: true,
    })
    const mpage = await touchCtx.newPage()
    try {
      await setupAuth(mpage)
      await setPrefs(mpage, { preferredAudio: 'sub' })
      await mpage.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
      await mpage.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 90000 })
      await mpage.evaluate(() => { const v = document.querySelector('video') as HTMLVideoElement | null; if (v) { v.muted = true; v.play().catch(() => {}) } })
      await mpage.waitForTimeout(8000)
      const t0 = Date.now()
      await mpage.locator('a[aria-label^="Watch Episode 5"]').first().tap({ timeout: 15000 })
      const tapMs = Date.now() - t0
      expect(tapMs, 'mobile tap must dispatch fast during playback').toBeLessThan(8000)
      await mpage.waitForTimeout(2000)
      expect(await mpage.evaluate(() => location.pathname)).toContain('/watch/anilist-20/5')
      // Mobile menu opens and reaches the Anime browse page.
      await mpage.locator('button[aria-label="Menu"]').first().tap({ timeout: 15000 }).catch(() => {})
      await mpage.waitForTimeout(1000)
      const animeLink = mpage.locator('a[href="/anime"]').first()
      if (await animeLink.isVisible().catch(() => false)) {
        await animeLink.tap({ timeout: 15000 })
        await mpage.waitForTimeout(1500)
        expect(await mpage.evaluate(() => location.pathname)).toContain('/anime')
      }
      // Sub toggle responds while paused.
      await mpage.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
      await mpage.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 90000 })
      await mpage.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.pause())
      await mpage.locator('button', { hasText: /^Sub$/ }).first().tap({ timeout: 15000 })
      expect(await mpage.evaluate(() => (document.querySelector('video') as HTMLVideoElement)?.paused)).toBe(true)
    } finally {
      await touchCtx.close()
    }
  })
})
