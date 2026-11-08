import { test, expect, type Page } from '@playwright/test'
import { routeTestMalIdentity } from './helpers/test-auth'
import { routeTestAnilistMedia } from './helpers/test-anilist'

/**
 * D149 - the browser's own chrome follows the Aeri theme.
 *
 * Safari 26 derives the window/toolbar tint from the page background and
 * ignores `<meta name="theme-color">` (WebKit bug 301756). Aeri therefore
 * paints the theme's `--bg` onto `<html>` and `<body>` inline on every
 * `applyTheme()` call - the body is the element Safari samples, so switching
 * themes must change that element itself, not just a CSS variable on `:root`.
 * The meta is kept in sync for engines that still honor it (iOS < 26, Chrome
 * Android), and `color-scheme` flips with the palette so native controls and
 * scrollbars match.
 *
 * These assertions pin the contract the tint depends on; the actual tint is
 * Safari UI and cannot be asserted headlessly.
 */

async function seedAuthOnly(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('aeri:mal:access_token', 'aeri-test-token')
      localStorage.removeItem('aeri:anilist:token')
    } catch {}
  })
  await routeTestMalIdentity(page)
  await routeTestAnilistMedia(page)
}

const CASES = [
  { name: 'Aeri Dark', bg: '#000000', rgb: 'rgb(0, 0, 0)', scheme: 'dark', text: 'rgb(255, 255, 255)' },
  { name: 'Aeri Light', bg: '#fafafa', rgb: 'rgb(250, 250, 250)', scheme: 'light', text: 'rgb(26, 26, 26)' },
  { name: 'Catppuccin Mocha', bg: '#1e1e2e', rgb: 'rgb(30, 30, 46)', scheme: 'dark', text: 'rgb(205, 214, 244)' },
]

const readChrome = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    const volume = document.querySelector('input[aria-label="Default volume"]') as HTMLElement | null
    const nav = document.querySelector('[data-nav-solid]') as HTMLElement | null
    return {
      varBg: root.style.getPropertyValue('--bg').trim(),
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
      bodyInline: body.style.backgroundColor,
      bodyComputed: getComputedStyle(body).backgroundColor,
      // iOS 26 installed web apps tint the status bar from the fixed element at
      // the top edge (the navbar), not from `theme-color` - see D168.
      navInline: nav ? nav.style.backgroundColor : null,
      navComputed: nav ? getComputedStyle(nav).backgroundColor : null,
      storedBg: localStorage.getItem('aeri:theme-bg'),
      htmlComputed: getComputedStyle(root).backgroundColor,
      colorScheme: getComputedStyle(root).colorScheme,
      volumeAccent: volume ? getComputedStyle(volume).accentColor : null,
    }
  })

test.describe('theme drives the browser chrome', () => {
  test('switching themes repaints body/html, the meta tag, and color-scheme', async ({ page }) => {
    test.setTimeout(90_000)
    await seedAuthOnly(page)
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('radio', { name: 'Aeri Dark', exact: true })).toBeVisible({ timeout: 30_000 })

    for (const c of CASES) {
      await page.getByRole('radio', { name: c.name, exact: true }).click()
      await page.waitForTimeout(200)
      const chrome = await readChrome(page)
      expect(chrome.varBg, `${c.name}: --bg`).toBe(c.bg)
      expect(chrome.meta, `${c.name}: theme-color meta`).toBe(c.bg)
      expect(chrome.bodyInline, `${c.name}: body inline background (Safari's sample)`).toBe(c.rgb)
      expect(chrome.bodyComputed, `${c.name}: body computed background`).toBe(c.rgb)
      expect(chrome.storedBg, `${c.name}: boot colour persisted for the head script`).toBe(c.bg)
      expect(chrome.htmlComputed, `${c.name}: html computed background`).toBe(c.rgb)
      // The installed-app status-bar source: the navbar is the fixed element
      // iOS samples, so it must carry the new colour INLINE the moment the
      // theme changes (owner 2026-11-06: the bar kept the old theme).
      expect(chrome.navInline, `${c.name}: navbar inline background`).toBe(c.rgb)
      expect(chrome.navComputed, `${c.name}: navbar computed background`).toBe(c.rgb)
      expect(chrome.colorScheme, `${c.name}: color-scheme`).toBe(c.scheme)
      // The volume slider is painted with the SAME ink as the ON switch
      // (--text), never the per-theme accent (owner instruction 2026-10-29).
      expect(chrome.volumeAccent, `${c.name}: volume slider accent = --text`).toBe(c.text)
    }

    // Persistence path: a reload applies the saved theme before first paint,
    // so the boot-time chrome is already the theme color (no black flash on
    // a light palette).
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('radio', { name: 'Catppuccin Mocha', exact: true })).toBeVisible({ timeout: 30_000 })
    const afterReload = await readChrome(page)
    expect(afterReload.meta, 'reload: meta follows the saved theme').toBe('#1e1e2e')
    expect(afterReload.bodyInline, 'reload: body painted before render').toBe('rgb(30, 30, 46)')
    expect(afterReload.bodyComputed, 'reload: body computed background').toBe('rgb(30, 30, 46)')
  })

  test('installed app: the re-sample nudge repaints the bar without moving the page', async ({ page }) => {
    test.setTimeout(90_000)
    await seedAuthOnly(page)
    // iOS installed-app flag. Defining it is how an installed Home Screen app
    // presents itself to the page; `resampleStatusBar()` gates on it.
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true })
      } catch {}
    })
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('radio', { name: 'Aeri Light', exact: true })).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => (navigator as unknown as { standalone?: boolean }).standalone)).toBe(true)

    // Theme picker sits low on the page: switch while scrolled, which is the
    // real path (the nudge used to be skipped unless scrollY was 0).
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }))
    await page.getByRole('radio', { name: 'Aeri Light', exact: true }).click()
    await page.waitForTimeout(150)
    const at = await page.evaluate(() => ({
      y: window.scrollY,
      nav: (document.querySelector('[data-nav-solid]') as HTMLElement | null)?.style.backgroundColor ?? null,
    }))
    expect(at.nav, 'sampled bar repainted inline').toBe('rgb(250, 250, 250)')
    await page.waitForTimeout(400)
    const later = await page.evaluate(() => window.scrollY)
    expect(later, 'the 1px nudge returns to the same offset').toBe(at.y)
  })
})
