import { test, expect, type Page } from '@playwright/test'
import { seedTestAuth, routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * WATCH PAGE CONTROLS — shape, not just size.
 *
 *   - Prev / Next are solid white pills at the shared 30px geometry.
 *   - The middle control is the episode picker (the same dropdown as the
 *     source picker), so the row both reports and changes position.
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
  test('episode nav: white prev/next pills and a 30px episode picker', async ({ page }) => {
    test.setTimeout(180000)
    await setup(page)
    await page.goto('/watch/anilist-20/1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('video', { timeout: 90000 })

    const pills = await page.evaluate(() => {
      const find = (label: string) =>
        [...document.querySelectorAll('a,button,span')].find(
          (n) => (n.textContent || '').trim() === label,
        ) as HTMLElement | undefined
      return ['← Previous', 'Next →'].map((label) => {
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

    // Middle control: a real <select> over the episode list, on the same
    // 30px pill geometry as its neighbours.
    const picker = page.locator('[data-testid="episode-nav"] select')
    await expect(picker).toHaveAttribute('aria-label', 'Select episode')
    await expect(picker).toHaveValue('1')
    const optionCount = await picker.locator('option').count()
    expect(optionCount, 'every episode is offered').toBeGreaterThan(1)

    const pickerHeight = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="episode-nav"] select')
      const pill = select?.parentElement
      return pill ? Math.round(pill.getBoundingClientRect().height * 10) / 10 : -1
    })
    expect(pickerHeight, 'picker pill height').toBeCloseTo(30, 0)

    // Tone exception: the episode picker is a white button (white fill,
    // --on-text label AND chevron, no visible border or focus ring). Every
    // other dropdown — here the source picker — keeps the dark filter
    // treatment. Focus the picker first: the ring used to appear on click
    // and read as a dark border around the white pill.
    await picker.focus()
    const tones = await page.evaluate(() => {
      const read = (selector: string) => {
        const select = document.querySelector(selector) as HTMLSelectElement | null
        const pill = select?.parentElement as HTMLElement | null
        if (!pill) return null
        const cs = getComputedStyle(pill)
        const label = pill.querySelector('span[aria-hidden]') as HTMLElement | null
        const chevron = pill.querySelector('svg') as SVGElement | null
        return {
          bg: cs.backgroundColor,
          borderColor: cs.borderTopColor,
          shadow: cs.boxShadow,
          text: label ? getComputedStyle(label).color : null,
          chevron: chevron ? getComputedStyle(chevron).color : null,
          chevronStroke: chevron ? getComputedStyle(chevron).strokeWidth : null,
        }
      }
      return {
        episode: read('[data-testid="episode-nav"] select'),
        source: read('select[aria-label="Select video source"]'),
      }
    })
    expect(tones.episode, 'episode picker exists').not.toBeNull()
    expect(tones.episode!.bg, 'episode picker is white').toBe('rgb(255, 255, 255)')
    expect(tones.episode!.text, 'episode picker label uses --on-text').toBe('rgb(0, 0, 0)')
    expect(tones.episode!.chevron, 'episode picker chevron matches the label').toBe('rgb(0, 0, 0)')
    expect(tones.episode!.borderColor, 'episode picker has no visible border').toBe('rgba(0, 0, 0, 0)')
    expect(tones.episode!.shadow, 'episode picker paints no focus ring').toBe('none')
    expect(tones.episode!.chevronStroke, 'episode picker chevron matches the arrow weight').toBe('2.5px')
    expect(tones.source, 'source picker still renders').not.toBeNull()
    expect(tones.source!.bg, 'source picker stays dark').toBe('rgb(10, 10, 10)')
    expect(tones.source!.text, 'source picker keeps --text').toBe('rgb(255, 255, 255)')
    expect(tones.source!.chevron, 'source picker keeps the faint chevron').toBe('rgb(110, 110, 110)')
    expect(tones.source!.chevronStroke, 'source picker keeps the standard 2 stroke').toBe('2px')

    await picker.selectOption('2')
    await expect(page).toHaveURL(/\/watch\/anilist-20\/2$/)
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
        trackBg: tcs.backgroundColor,
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
    // Track colour must be the SAME token as Settings' Sub/Dub toggle
    // (--bg-soft #0a0a0a), not a 4%-white wash that composites differently
    // over the player card.
    expect(toggle!.trackBg, 'track matches Settings bg-[var(--bg-soft)]').toBe('rgb(10, 10, 10)')
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
