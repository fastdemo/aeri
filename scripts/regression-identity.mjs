// Regression: manga/anime identity separation + manga priority + relations.
// Runs against vite preview (local) or production via AERI_BASE_URL.
// Proves ARCHITECTURAL invariants (no title-specific exceptions):
//  1. manga cards resolve as manga (mediaType MANGA, read route, chapters)
//  2. anime cards resolve as anime (watch route, episodes)
//  3. HxH manga (30026) and HxH anime (11061) stay distinct
//  4. default manga priority = weebcentral first (zero mangadex/mangapill reqs)
//  5. custom mangaProviderOrder is honored (mangapill first when configured)
//  6. disabled providers receive zero requests
//  7. related entries render for AOT S1/S2/S3 + manga titles
//  8. bogus manga id fails closed ("Manga not found", never anime)
// Usage: AERI_BASE_URL=http://localhost:4173/aeri node scripts/regression-identity.mjs
// Exit non-zero on any failure.

import { chromium } from 'playwright-core'

const BASE = process.env.AERI_BASE_URL ?? 'http://localhost:4173/aeri'
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.addInitScript(() => { indexedDB.deleteDatabase('aeri'); try { localStorage.clear(); } catch {} })
const page = await ctx.newPage()
const nav = (url) => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).then(() => page.waitForTimeout(1000))
page.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
// Stub auth (MAL token shape; user/list fetches fail silently, gate passes)
await page.addInitScript(() => { try { localStorage.setItem('aeri:mal:access_token', 'test-fake-mal-token'); } catch {} })

async function openMangaCard(title) {
  await nav(`${BASE}/#/manga`)
  await page.waitForTimeout(10000)
  await page.evaluate((t) => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === `Open ${t}`)?.click(), title)
  await page.waitForTimeout(15000)
}
async function closeModal() {
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click())
  await page.waitForTimeout(700)
}
const modalInfo = () => page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  if (!dlg) return null
  const rows = [...dlg.querySelectorAll('a[href*="/read/"]')].filter(a => !a.textContent?.match(/^Read$/))
  // NOTE: no getBoundingClientRect here — layoutinear reads inside evaluate
  // can hang when the modal overlay is mid-animation. Visibility filtering
  // happens in the dedicated related tests instead.
  const m = [...dlg.querySelectorAll('section[aria-label="Related Manga"]')]
  const s = [...dlg.querySelectorAll('section[aria-label="Related Anime"]')]
  return {
    title: dlg.querySelector('h2')?.textContent?.slice(0, 24),
    rows: rows.length,
    relM: m.length ? m[0].querySelectorAll(':scope div.grid > div').length : 0,
    relS: s.length ? s[0].querySelectorAll(':scope div.grid > div').length : 0,
    href: dlg.querySelector('a[href*="/read/"]')?.getAttribute('href') ?? '',
  }
})

// 1-3. HxH manga stays manga; HxH anime stays anime
await openMangaCard('Hunter x Hunter')
let info = await modalInfo()
check('hxh manga modal (rows>300, read route, related both)', !!info && info.rows > 300 && info.href.startsWith('#/read/anilist-30026/') && info.relM > 0 && info.relS > 0, JSON.stringify(info))
await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] a[href*="/read/"]')].filter(a => !a.textContent?.match(/^Read$/))[0]?.click())
await page.waitForTimeout(18000)
let rd = { url: await page.evaluate(() => location.hash.slice(0, 60)), loaded: 0 }
try {
  const imgs = await page.evaluate(() => [...document.querySelectorAll('img[alt^="Page"]')].map(i => i.naturalWidth))
  rd.loaded = imgs.filter(w => w > 10).length
} catch { /* reader images not ready — hash still proves routing */ }
check('hxh manga reader (manga route, pages render)', rd.url.includes('/read/anilist-30026/') && rd.loaded > 0, JSON.stringify(rd))
await closeModal().catch(() => {})

await nav(`${BASE}/#/search?q=Hunter+x+Hunter`)
await page.waitForTimeout(8000)
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Open Hunter x Hunter (2011)')?.click())
await page.waitForTimeout(12000)
let ad = null
try {
  const found = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find(d => /Episodes/i.test(d.innerText))
    if (!dlg) return null
    const links = [...dlg.querySelectorAll('a[href*="/watch/"]')]
    return { eps: links.length, href: links[0]?.getAttribute('href') ?? '' }
  })
  ad = found
} catch { ad = null }
check('hxh anime modal (watch route, episodes)', !!ad && ad.eps > 100 && ad.href.startsWith('#/watch/anilist-11061/'), JSON.stringify(ad))

// 4. Default priority: weebcentral first, zero mdx/mp requests
// (fresh page load: clearing IDB mid-session leaves in-memory caches warm,
// so navigate to a title not yet resolved this session)
await page.evaluate(() => { localStorage.removeItem('aeri:prefs') })
await nav(`${BASE}/#/manga`)
await page.waitForTimeout(10000)
const seenDefault = []
page.on('request', r => { if (/api\/manga\//.test(r.url())) seenDefault.push(r.url().match(/manga\/([^?]+)/)[1]) })
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Open Berserk')?.click())
await page.waitForTimeout(18000)
const firstReq = seenDefault[0] ?? 'none'
check('default priority weebcentral-first', firstReq.startsWith('match/'), JSON.stringify(seenDefault.slice(0, 3)))
check('default priority zero mdx/mp reqs', !seenDefault.some(u => u.startsWith('mdx-') || u.startsWith('mp-')), JSON.stringify(seenDefault.slice(0, 4)))
await closeModal()

// 5. Custom order honored: mangapill first
page.removeAllListeners('request')
const seenCustom = []
page.on('request', r => { if (/api\/manga\//.test(r.url())) seenCustom.push(r.url().match(/manga\/([^?]+)/)[1]) })
await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('aeri:prefs') || '{}')
  p.enabledMangaProviders = { mangadex: true, weebcentral: true, mangapill: true }
  p.mangaProviderOrder = ['mangapill', 'mangadex', 'weebcentral']
  localStorage.setItem('aeri:prefs', JSON.stringify(p))
})
await page.waitForTimeout(500)
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Open Chainsaw Man')?.click())
await page.waitForTimeout(18000)
check('custom order mangapill-first', (seenCustom[0] ?? '').startsWith('mp-match/'), JSON.stringify(seenCustom.slice(0, 3)))
await closeModal()

// 6. Disabled providers get zero requests
page.removeAllListeners('request')
const seenDisabled = []
page.on('request', r => { if (/api\/manga\//.test(r.url())) seenDisabled.push(r.url().match(/manga\/([^?]+)/)[1]) })
await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('aeri:prefs') || '{}')
  p.enabledMangaProviders = { mangadex: false, weebcentral: true, mangapill: false }
  p.mangaProviderOrder = null
  localStorage.setItem('aeri:prefs', JSON.stringify(p))
})
await page.waitForTimeout(500)
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Open Uzumaki: Spiral into Horror')?.click())
await page.waitForTimeout(18000)
check('disabled providers zero reqs', !seenDisabled.some(u => u.startsWith('mdx-') || u.startsWith('mp-')), JSON.stringify(seenDisabled.slice(0, 4)))
await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('aeri:prefs') || '{}'); p.enabledMangaProviders = null; p.mangaProviderOrder = null; localStorage.setItem('aeri:prefs', JSON.stringify(p)) })
await closeModal()

// 7. Related entries: AOT seasons + manga
for (const id of [16498, 20958, 99147]) {
  await nav(`${BASE}/#/anime/anilist-${id}`)
  await page.waitForTimeout(12000)
  const r = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('section[aria-label="Related Anime"]')]
    return secs.length ? secs[0].querySelectorAll(':scope div.grid > div').length : 0
  })
  check(`aot ${id} related entries`, r >= 3, `${r} cards`)
}
await openMangaCard('Berserk')
info = await modalInfo()
check('berserk manga related both', !!info && info.relM > 0 && info.relS > 0, JSON.stringify({ relM: info?.relM, relS: info?.relS }))
await closeModal()

// 8. Bogus manga id fails closed (never anime)
await nav(`${BASE}/#/read/anilist-999999999/first`)
await page.waitForTimeout(12000)
const bogus = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n+/g, '|'))
check('bogus manga fails closed', /Manga not found/i.test(bogus) && !/Episodes/i.test(bogus), bogus.slice(0, 80))

await browser.close()
if (failures.length) { console.log(`\n${failures.length} FAILURES`); process.exit(1) }
console.log('\nall regression checks passed')
