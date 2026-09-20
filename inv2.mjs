import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => { indexedDB.deleteDatabase('aeri'); try { localStorage.clear(); } catch {} });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('aeri:mal:access_token', 'test-fake-mal-token'); } catch {} });
await page.goto('http://localhost:4173/aeri/#/manga', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(10000);
// open EVERY manga card on first page, record modal title + read href id
const titles = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b=>/^Open /.test(b.getAttribute('aria-label')||'')).slice(0,15).map(b=>b.getAttribute('aria-label')));
for (const t of titles) {
  await page.evaluate((tt) => [...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')===tt)?.click(), t);
  await page.waitForTimeout(12000);
  const r = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { nodlg: 1 };
    return { title: dlg.querySelector('h2')?.textContent?.slice(0,28), href: dlg.querySelector('a[href*="/read/"]')?.getAttribute('href')?.slice(0,42) };
  });
  console.log(t.slice(0,34).padEnd(36), JSON.stringify(r));
  await page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click());
  await page.waitForTimeout(700);
}
await browser.close();
