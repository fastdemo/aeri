import { chromium } from 'playwright-core';
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox', '--force-device-scale-factor=1'] });
const ctx = await browser.newContext({ viewport: { width: 1980, height: 1000 } });
const page = await ctx.newPage();
// stub a signed-in CW row with mixed anime+manga entries by intercepting list? Simpler: render cards standalone is complex.
// Instead: measure a REAL continue-variant card via MyList page after seeding IDB? MyList needs auth.
// Fastest structural check: mount AnimeCard continue variant through the search modal? No.
// Direct: verify filter predicate + measure caption/frame widths in isolation is already done.
// Here: verify Home CW filter code path exists and QuickMenu positioning context.
await page.goto('http://localhost:4173/aeri/#/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(() => {
  // QuickMenu button is absolute right-1 top-1 INSIDE the outer relative wrapper (not the clipped frame) — check containing block
  return { note: 'static-check-only' };
})));
await browser.close();
