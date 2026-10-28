import { test, expect } from '@playwright/test'

/**
 * HERO RADIUS (D133): the hero uses the same corner radius as the media
 * player. The player's stock Video.js radius is 28px, so
 * the hero's three clip layers and its .frame-glass rim must compute 28px at
 * every viewport — not the old 12px / 14px pair.
 */
test.describe('Hero radius matches the media player', () => {
  for (const width of [1440, 768, 375]) {
    test(`28px at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('section[aria-roledescription="carousel"]', { timeout: 45000 })
      await page.waitForTimeout(2500)

      const hero = await page.evaluate(() => {
        const section = document.querySelector('section[aria-roledescription="carousel"]') as HTMLElement
        const shell = section.parentElement as HTMLElement
        const frame = shell.querySelector('.frame-glass') as HTMLElement | null
        return {
          section: getComputedStyle(section).borderTopLeftRadius,
          shell: getComputedStyle(shell).borderTopLeftRadius,
          frame: frame ? getComputedStyle(frame).borderTopLeftRadius : '',
          hasFrame: !!frame,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        }
      })

      expect(hero.section, 'hero section radius').toBe('28px')
      expect(hero.shell, 'carousel shell radius').toBe('28px')
      expect(hero.hasFrame, 'hero keeps the frosted frame').toBe(true)
      expect(hero.frame, 'frame follows the hero radius').toBe('28px')
      expect(hero.overflow, 'no horizontal overflow').toBe(false)
    })
  }
})
