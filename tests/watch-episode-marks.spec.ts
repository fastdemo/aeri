import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * WATCH PAGE CONTROLS — the owner's components, restored (2026-10-26).
 *
 * "what the fuck did you do to the previous, episode 1 button. it should look
 * like the old one but with the same size as the other component. and the
 * sub/dub to. REVERT THAT TO THE OLD TOGGLE!! i just meant the same size, not
 * CHANGE COMPONENTS!"
 *
 * So this file pins the SHAPE, not just the size:
 *   - Prev / current / Next are three SOLID WHITE pills, semibold, the middle
 *     one a non-interactive span — exactly as before the size pass.
 *   - Sub/Dub is a TRACK + INNER PILL (the old segmented toggle), 30px tall
 *     overall.
 *   - The current episode tile no longer wears a "Now playing" chip: it wears
 *     the watched-tile overlay (40% scrim + glyph) with `audio-lines`.
 *   - Hovering a marked tile fades that overlay out so the play glyph is
 *     never drawn on top of it.
 */

const FLOWER_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

async function setup(page: Page): Promise<void> {
  await seedTestAuth(page)
  await routeTestMalIdentity(page)
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
  await page.route('**/api/sources/aniwave-*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sources: [
          { url: FLOWER_MP4, type: 'mp4', quality: 'auto', provider: 'aniwave', language: 'sub', embed: false },
          { url: FLOWER_MP4 + '?dub', type: 'mp4', quality: 'auto', provider: 'aniwave', language: 'dub', embed: false },
        ],
      }),
    })
  })
}

test.describe('Watch controls — old components, unified size', () => {
  test('episode nav is the original white pill row at 30px', async ({ page }) => {
    test.setTimeout(180000)
    await setup(page)
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('video', { timeout: 90000 })

    const pills = await page.evaluate(() => {
      const find = (label: string) =>
        [...document.querySelectorAll('a,button,span')].find(
          (n) => (n.textContent || '').trim() === label,
        ) as HTMLElement | undefined
      return ['← Previous', 'Episode 1', 'Next →'].map((label) => {
        const el = find(label)
        if (!el) return { label, missing: true }
        const cs = getComputedStyle(el)
        return {
          label,
          h: Math.round(el.getBoundingClientRect().height * 10) / 10,
          bg: cs.backgroundColor,
          weight: cs.fontWeight,
          size: cs.fontSize,
          padLeft: cs.paddingLeft,
        }
      })
    })

    for (const pill of pills) {
      expect(pill.missing, `${pill.label} must render`).toBeFalsy()
      expect(pill.h, `${pill.label} height`).toBeCloseTo(30, 0)
      expect(pill.bg, `${pill.label} is a solid white pill`).toBe('rgb(255, 255, 255)')
      expect(pill.weight, `${pill.label} keeps the original semibold weight`).toBe('600')
      expect(pill.size, `${pill.label} size`).toBe('12px')
      expect(pill.padLeft, `${pill.label} keeps the original px-4`).toBe('16px')
    }
  })

  test('Sub/Dub is the original track + inner pill, 30px overall', async ({ page }) => {
    test.setTimeout(180000)
    await setup(page)
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('video', { timeout: 90000 })

    const toggle = await page.evaluate(() => {
      const sub = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent || '').trim() === 'Sub',
      ) as HTMLElement | undefined
      const track = sub?.parentElement as HTMLElement | undefined
      if (!sub || !track) return null
      const tcs = getComputedStyle(track)
      const scs = getComputedStyle(sub)
      return {
        trackH: Math.round(track.getBoundingClientRect().height * 10) / 10,
        trackRadius: parseFloat(tcs.borderTopLeftRadius),
        trackBorder: tcs.borderTopWidth,
        trackPad: tcs.paddingTop,
        innerH: Math.round(sub.getBoundingClientRect().height * 10) / 10,
        innerBg: scs.backgroundColor,
        innerRadius: parseFloat(scs.borderTopLeftRadius),
      }
    })
    expect(toggle, 'Sub/Dub toggle must render').not.toBeNull()
    expect(toggle!.trackH, 'the CONTROL (track) is 30px').toBeCloseTo(30, 0)
    expect(toggle!.trackRadius).toBeGreaterThanOrEqual(9999)
    expect(toggle!.trackBorder).toBe('1px')
    expect(toggle!.trackPad).toBe('4px')
    // The selected side is the inner white pill, not a standalone pill.
    expect(toggle!.innerH).toBeCloseTo(20, 0)
    expect(toggle!.innerBg).toBe('rgb(255, 255, 255)')
    expect(toggle!.innerRadius).toBeGreaterThanOrEqual(9999)
  })

  test('current tile: audio-lines marker, no "Now playing" chip, hidden on hover', async ({ page }) => {
    test.setTimeout(180000)
    await setup(page)
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h2:has-text("Episodes")', { timeout: 30000 })

    const before = await page.evaluate(() => {
      const tile = document.querySelector('a[aria-label^="Watch Episode"]') as HTMLElement
      const overlay = tile?.querySelector('span.absolute.inset-0.z-10') as HTMLElement | null
      return {
        chip: document.body.innerText.includes('Now playing'),
        audioLines: !!tile?.querySelector('svg.lucide-audio-lines'),
        tick: !!tile?.querySelector('svg.lucide-check'),
        overlayOpacity: overlay ? getComputedStyle(overlay).opacity : 'none',
      }
    })
    expect(before.chip, 'the white "Now playing" chip is gone').toBe(false)
    expect(before.audioLines, 'the current tile carries the audio-lines glyph').toBe(true)
    expect(before.tick, 'the current tile is not marked with the watched tick').toBe(false)
    expect(before.overlayOpacity, 'marker visible at rest').toBe('1')

    await page.locator('a[aria-label^="Watch Episode"]').first().hover()
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => {
      const tile = document.querySelector('a[aria-label^="Watch Episode"]') as HTMLElement
      const overlay = tile?.querySelector('span.absolute.inset-0.z-10') as HTMLElement | null
      const play = tile?.querySelector('.absolute.left-1\\/2.top-1\\/2') as HTMLElement | null
      return {
        overlayOpacity: overlay ? getComputedStyle(overlay).opacity : 'none',
        playOpacity: play ? getComputedStyle(play).opacity : 'none',
      }
    })
    expect(after.overlayOpacity, 'marker fades out under the play glyph').toBe('0')
    expect(after.playOpacity, 'play glyph is the only thing left').toBe('1')
  })
})
