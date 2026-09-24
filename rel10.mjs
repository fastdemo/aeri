import { chromium } from 'playwright-core';
const B = 'http://localhost:4173/aeri';
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox', '--force-device-scale-factor=1'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { indexedDB.deleteDatabase('aeri'); } catch {} try { localStorage.clear(); } catch {} });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('aeri:mal:access_token', 'test-fake-mal-token'); } catch {} });
await page.goto(`${B}/#/anime/anilist-16498`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(25000);
console.log(JSON.stringify(await page.evaluate(() => {
  const sec = document.querySelector('section[aria-label="Related Anime"]');
  const cards = sec ? [...sec.querySelectorAll(':scope div.grid > div')].map(d => (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44)) : [];
  return cards.filter(c => /Season|Final|Part 3|Part 4/i.test(c));
})));
await browser.close();
