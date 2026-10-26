import { test, expect } from '@playwright/test'

/**
 * BRAND ICON (owner 2026-10-26, D133): the supplied white mark on a
 * TRANSPARENT background is the one icon everywhere. "no BACKGROUND please i
 * want it transparent like that" — so the SVG must carry the glyph only (no
 * <rect> backing) and every raster app icon must have transparent corners.
 */
test.describe('Aeri brand icon', () => {
  test('favicon.svg is the supplied mark with no background', async ({ request }) => {
    const res = await request.get('/favicon.svg')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/svg+xml')
    const svg = await res.text()
    expect(svg, 'glyph path present').toContain('<path')
    expect(svg, 'white fill').toContain('fill="#ffffff"')
    expect(svg, 'no background rect').not.toContain('<rect')
  })

  test('app icons are transparent and the right sizes', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const icons = await page.evaluate(async () => {
      const dims = async (url: string) => {
        const res = await fetch(url)
        const blob = await res.blob()
        const bmp = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = bmp.width
        canvas.height = bmp.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bmp, 0, 0)
        const cornerAlpha = ctx.getImageData(0, 0, 1, 1).data[3]
        return { status: res.status, w: bmp.width, h: bmp.height, cornerAlpha }
      }
      return {
        favicon: await dims('/favicon.png'),
        apple: await dims('/apple-touch-icon.png'),
        icon192: await dims('/icon-192.png'),
        icon512: await dims('/icon-512.png'),
      }
    })
    expect(icons.favicon).toMatchObject({ status: 200, w: 32, h: 32, cornerAlpha: 0 })
    expect(icons.apple).toMatchObject({ status: 200, w: 180, h: 180, cornerAlpha: 0 })
    expect(icons.icon192).toMatchObject({ status: 200, w: 192, h: 192, cornerAlpha: 0 })
    expect(icons.icon512).toMatchObject({ status: 200, w: 512, h: 512, cornerAlpha: 0 })
  })
})
