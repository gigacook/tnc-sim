// Captures the pre-redesign simulator (the committed index.html of the starting commit) for the
// before/after comparison. Usage: node scripts/shots-before.mjs <path to index.html> <out dir>
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [page_, out_] = process.argv.slice(2);
if (!page_ || !out_) { console.error('usage: node scripts/shots-before.mjs <index.html> <out dir>'); process.exit(2); }
const out = resolve(out_); mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.goto(pathToFileURL(resolve(page_)).href);
await page.waitForFunction(() => window.TNC_UI && document.querySelector('#plist')?.children.length > 0, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.keyboard.press('Escape');   // leave the boot screen
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, 'before-main.png') });
await page.keyboard.press('4');            // FULL-RUN
await page.evaluate(() => document.querySelector('#spd button[data-s="0"]')?.click());
await page.keyboard.press('Space');
await page.waitForTimeout(9000);
await page.screenshot({ path: join(out, 'before-run.png') });
await page.keyboard.press('Escape');
await page.click('#b-new');
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'before-new-menu.png') });
await page.keyboard.press('Escape');
await page.evaluate(() => { document.querySelector('#m-new').hidden = false; document.querySelector('#new-ai').hidden = false; });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'before-ai-dialog.png') });
await browser.close();
console.log('before shots in ' + out);
