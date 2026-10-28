import { test, expect } from '@playwright/test'

/**
 * NO-COPY SURFACE.
 *
 * The whole document is non-selectable, including links and artwork, and
 * links/images are not drag sources. Form controls are the deliberate
 * exception — a search box you cannot select text in is a broken search box.
 */
test.describe('No-copy surface', () => {
  test('page text and artwork cannot be selected; form controls still can', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const styles = await page.evaluate(async () => {
      const body = getComputedStyle(document.body)
      const main = document.querySelector('main')
      const mainStyle = main ? getComputedStyle(main) : null
      const link = document.querySelector('a')
      const img = document.querySelector('img')
      const probe = document.createElement('input')
      probe.type = 'text'
      probe.value = 'selectable'
      document.body.appendChild(probe)
      const input = getComputedStyle(probe)
      // -webkit-touch-callout is Safari-only; Chromium drops it from
      // computed style, so the shipped CSS text is inspected instead (the dev
      // server injects a <style>, production links a same-origin bundle).
      let cssText = [...document.querySelectorAll('style')].map((tag) => tag.textContent || '').join('\n')
      for (const link of [...document.querySelectorAll('link[rel="stylesheet"]')] as HTMLLinkElement[]) {
        if (!link.href.startsWith(location.origin)) continue
        try {
          cssText += await (await fetch(link.href)).text()
        } catch {}
      }
      const hasCalloutRule = cssText.includes('-webkit-touch-callout')
      const result = {
        bodySelect: body.userSelect,
        bodyWebkitSelect: body.webkitUserSelect,
        bodyCallout: body.getPropertyValue('-webkit-touch-callout'),
        hasCalloutRule,
        mainSelect: mainStyle?.userSelect ?? 'no-main',
        linkDrag: link ? getComputedStyle(link).webkitUserDrag : 'no-link',
        imgDrag: img ? getComputedStyle(img).webkitUserDrag : 'no-img',
        inputSelect: input.userSelect,
        inputWebkitSelect: input.webkitUserSelect,
      }
      probe.remove()
      return result
    })

    expect(styles.bodySelect, 'body is not selectable').toBe('none')
    expect(styles.bodyWebkitSelect, 'Safari/WebKit also gets none').toBe('none')
    expect(styles.hasCalloutRule, 'iOS long-press callout rule is shipped').toBe(true)
    if (styles.bodyCallout) expect(styles.bodyCallout, 'iOS long-press callout is off').toBe('none')
    if (styles.mainSelect !== 'no-main') expect(styles.mainSelect).toBe('none')
    if (styles.linkDrag !== 'no-link') expect(styles.linkDrag).toBe('none')
    if (styles.imgDrag !== 'no-img') expect(styles.imgDrag).toBe('none')
    expect(styles.inputSelect, 'text inputs stay selectable').toBe('text')
    expect(styles.inputWebkitSelect).toBe('text')

    // Real user behavior: drag across a heading. The browser must not
    // produce a selection at all.
    const heading = page.locator('h1, h2').first()
    const box = (await heading.count()) ? await heading.boundingBox() : null
    if (box) {
      await page.mouse.move(box.x + 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
      const dragged = await page.evaluate(() => window.getSelection()?.toString() ?? '')
      expect(dragged, 'dragging across page text selects nothing').toBe('')
    }

    // A real text field (search) must accept a selection, otherwise the
    // no-copy rule would have broken the app.
    const search = page.locator('input[type="search"], input[type="text"]').first()
    if (await search.count()) {
      await search.fill('attack on titan')
      await search.evaluate((el: HTMLInputElement) => el.select())
      const selected = await search.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)
      expect(selected).toBeGreaterThan(0)
    }
  })

  test('reader and watch pages are covered too', async ({ page }) => {
    for (const path of ['/anime', '/manga']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      const select = await page.evaluate(() => getComputedStyle(document.body).userSelect)
      expect(select, `${path} body is not selectable`).toBe('none')
    }
  })
})
