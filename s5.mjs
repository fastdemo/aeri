import { chromium } from 'playwright-core';
const B = 'https://aeri.fastdemo.workers.dev';
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox', '--host-resolver-rules=MAP aeri.fastdemo.workers.dev 172.67.128.215', '--force-device-scale-factor=1'] });
// width sweep: record content-left at each breakpoint
for (const vw of [375, 390, 430, 768, 900, 1024, 1280, 1440, 1512, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 844 } });
  await ctx.addInitScript(() => { try { indexedDB.deleteDatabase('aeri'); } catch {} try { localStorage.clear(); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${B}/#/`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(12000);
  console.log(`vw=${vw}:`, JSON.stringify(await page.evaluate(() => {
    const hero = document.querySelector('main section');
    const row = [...document.querySelectorAll('main section')].find(s => s.querySelector(':scope h2'));
    const first = row?.querySelector('div[class*="overflow-x"]')?.firstElementChild;
    const f = (n) => n === null || n === undefined ? null : Math.round(n * 100) / 100;
    return { heroL: f(hero?.getBoundingClientRect().left), titleL: f(row?.querySelector(':scope h2')?.getBoundingClientRect().left), cardL: f(first?.getBoundingClientRect().left), ov: document.documentElement.scrollWidth - window.innerWidth };
  })));
  await ctx.close();
}
await browser.close();
