import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * Watch page layout contract (owner requests, 2026-10-25).
 *
 * Everything asserted here is a LAYOUT rule, not playback: the layout is what
 * broke in the owner's screenshots. Playback itself is covered by
 * playback-authenticated.spec.ts (deterministic suites), which this file
 * reuses for auth + media doubles:
 *   - AUTH: synthetic MAL token + routed identity (production auth untouched)
 *   - MEDIA: the worker's aniwave source route is answered with a direct
 *     public MP4, so the player mounts deterministically.
 *
 * Rules under test:
 *   1. The h1 carries the SHOW NAME only — no "— Episode N" suffix.
 *   2. Synopsis sits ABOVE Episodes.
 *   3. The Episodes header shows a right-aligned "N episodes" count.
 *   4. With video mounted the player is a full-bleed band: top/bottom
 *      hairlines, no rounding (the placeholder keeps its framed card).
 *   5. The resume prompt reads the saved position and dismissing it works.
 *
 * The watched-tile tick overlay is NOT asserted here: the test harness seeds
 * tracker identity but its list never feeds `trackingEntry`, so progress is
 * always 0. That overlay is the preview card's own markup (verified there);
 * it needs a real tracker account to appear.
 */

const FLOWER_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

async function setupAuth(page: Page, progress = 0): Promise<void> {
  await seedTestAuth(page)
  await routeTestMalIdentity(page, [{ malId: 20, title: 'Naruto', numEpisodes: 220, progress }])
  await routeTestAnilistMedia(page)
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem('aeri:prefs')
      const cur = raw ? JSON.parse(raw) : {}
      localStorage.setItem('aeri:prefs', JSON.stringify({
        ...cur,
        customVideoApiUrl: 'https://aeri.fastdemo.workers.dev',
        preferredProvider: 'aniwave',
        preferredAudio: 'sub',
        autoplay: false,
      }))
    } catch {}
  })
}

async function routeDirectMp4(page: Page): Promise<void> {
  await page.route('**/api/sources/aniwave-*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sources: [{
          url: FLOWER_MP4,
          type: 'mp4',
          quality: 'auto',
          provider: 'aniwave',
          language: 'sub',
          embed: false,
        }],
      }),
    })
  })
}

async function openWatch(page: Page, episode = 1): Promise<void> {
  await page.goto(`/watch/anilist-20/${episode}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('video', { timeout: 90000 })
  // Let the episode grid + header settle after the player decision.
  await page.waitForSelector('h2:has-text("Episodes")', { timeout: 30000 })
}

test.describe('Watch layout contract', () => {
  test('show name, section order, episode count, full-bleed player', async ({ page }) => {
    test.setTimeout(180000)
    await setupAuth(page)
    await routeDirectMp4(page)
    await openWatch(page)

    // 1. h1 = show name only.
    const h1 = (await page.locator('h1').first().textContent())?.trim() ?? ''
    expect(h1).toBe('Naruto')
    expect(h1).not.toMatch(/episode/i)

    // 2. Synopsis ABOVE Episodes (DOM order, not visual guesswork).
    const h2s = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h2')).map((h) => h.textContent?.trim() ?? ''),
    )
    const synopsis = h2s.indexOf('Synopsis')
    const episodes = h2s.indexOf('Episodes')
    expect(synopsis, `Synopsis heading must exist — ${JSON.stringify(h2s)}`).toBeGreaterThanOrEqual(0)
    expect(episodes).toBeGreaterThan(synopsis)

    // 3. "N episodes" count, right-aligned against the Episodes header.
    const header = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h2')).find((e) => e.textContent?.trim() === 'Episodes')
      const row = h?.parentElement
      if (!h || !row) return null
      const span = Array.from(row.querySelectorAll('span')).find((s) => /episodes?$/.test(s.textContent?.trim() ?? ''))
      if (!span) return null
      return {
        text: span.textContent?.trim() ?? '',
        spanRight: Math.round(span.getBoundingClientRect().right),
        rowRight: Math.round(row.getBoundingClientRect().right),
        headingLeft: Math.round(h.getBoundingClientRect().left),
        spanLeft: Math.round(span.getBoundingClientRect().left),
      }
    })
    expect(header, 'episode count span must exist next to the Episodes heading').not.toBeNull()
    expect(header!.text).toMatch(/^\d+ episodes?$/)
    expect(header!.spanRight).toBeGreaterThanOrEqual(header!.rowRight - 2)
    expect(header!.spanLeft).toBeGreaterThan(header!.headingLeft)

    // 4. Player surface (owner 2026-10-26, revised same day): the page
    // background with the video on top — no wrapper fill, no wrapper border,
    // no artwork poster. The Video.js skin keeps its STOCK 28px corner radius,
    // and the player wears the hero's frosted frame (.frame-glass) instead of
    // the skin's own 1px line (which .aeri-player keeps transparent).
    const player = await page.evaluate(() => {
      const v = document.querySelector('video')
      const wrap = v?.closest('div[class*="aspect-video"]') as HTMLElement | null
      const box = v?.closest('.media-container') as HTMLElement | null
      if (!wrap || !v || !box) return null
      const cs = getComputedStyle(wrap)
      const vcs = getComputedStyle(v)
      const bcs = getComputedStyle(box)
      const frame = wrap.querySelector('.frame-glass') as HTMLElement | null
      const imgs = [...document.querySelectorAll('img')].filter((img) => {
        const r = img.getBoundingClientRect()
        const wr = wrap.getBoundingClientRect()
        return r.width > wr.width * 0.5 && r.height > wr.height * 0.5
      }).length
      return {
        top: cs.borderTopWidth,
        bottom: cs.borderBottomWidth,
        left: cs.borderLeftWidth,
        right: cs.borderRightWidth,
        radius: cs.borderTopLeftRadius,
        bg: cs.backgroundColor,
        videoRadius: vcs.borderTopLeftRadius,
        boxRadius: bcs.borderTopLeftRadius,
        boxBorder: bcs.borderTopWidth,
        frame: !!frame,
        frameRadius: frame ? getComputedStyle(frame).borderTopLeftRadius : '',
        frameShadow: frame ? getComputedStyle(frame).boxShadow : '',
        framePointer: frame ? getComputedStyle(frame).pointerEvents : '',
        posterImgs: imgs,
      }
    })
    expect(player, 'player wrapper must exist').not.toBeNull()
    expect(player!.top).toBe('0px')
    expect(player!.bottom).toBe('0px')
    expect(player!.left).toBe('0px')
    expect(player!.right).toBe('0px')
    // Stock Video.js radius — not the old 0px rectangle, not a custom value.
    expect(player!.radius).toBe('28px')
    expect(player!.videoRadius).toBe('28px')
    expect(player!.boxRadius).toBe('28px')
    expect(player!.boxBorder).toBe('0px')
    expect(player!.bg).toBe('rgba(0, 0, 0, 0)')
    // Hero frame: 1px inset hairline, same radius as the player, never
    // intercepts a click (it sits above the controls).
    expect(player!.frame, 'player must wear the hero .frame-glass rim').toBe(true)
    expect(player!.frameRadius).toBe('28px')
    expect(player!.frameShadow).toContain('inset')
    expect(player!.framePointer).toBe('none')
    expect(player!.posterImgs, 'no artwork may sit behind the video').toBe(0)

    await page.screenshot({ path: 'OpenCode/screens/watch-layout-1440.png', fullPage: false })
  })

  test('resume prompt reads the saved position and closes on Resume', async ({ page }) => {
    test.setTimeout(180000)
    await setupAuth(page)
    await routeDirectMp4(page)
    await openWatch(page, 1)
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
          currentTime: 540,
          duration: 1440,
          updatedAt: Date.now(),
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Resume from 9:00?', { timeout: 90000 })

    const pill = await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.includes('Resume from 9:00?'))
      const wrap = span?.parentElement as HTMLElement | null
      if (!wrap) return null
      const cs = getComputedStyle(wrap)
      const inner = wrap.parentElement as HTMLElement | null
      return {
        radius: cs.borderTopLeftRadius,
        backdrop: cs.backdropFilter,
        zIndex: inner ? getComputedStyle(inner).zIndex : '',
      }
    })
    expect(pill, 'resume pill must render').not.toBeNull()
    // Tailwind's rounded-full computes to a huge pixel value, not "50%".
    expect(Number.parseFloat(pill!.radius)).toBeGreaterThanOrEqual(9999)
    expect(pill!.backdrop).toContain('blur')
    expect(Number(pill!.zIndex)).toBeGreaterThanOrEqual(30)

    await page.screenshot({ path: 'OpenCode/screens/watch-resume-1440.png', fullPage: false })
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(page.locator('text=Resume from 9:00?')).toHaveCount(0)
  })
})
