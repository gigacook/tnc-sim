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
// the page is a local file and stays local: the old AI dialog would otherwise fetch OpenRouter's public model list,
// and the picture would change with the day it was taken. Without it the dialog shows its built-in short list.
await ctx.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
const page = await ctx.newPage();
await page.goto(pathToFileURL(resolve(page_)).href);
await page.waitForFunction(() => window.TNC_UI && document.querySelector('#plist')?.children.length > 0, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.keyboard.press('Escape');   // leave the boot screen
await page.waitForTimeout(1200);
// the old build then forces its profile prompt. Close it the page's own way (Escape, else its Close button): hiding
// the element behind the page's back left the page thinking a dialog was open, so no key or soft key started a run.
const openDialog = () => page.evaluate(() => [...document.querySelectorAll('.modal')].some((m) => !m.hidden));
for (let i = 0; i < 3 && (await openDialog()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
if (await openDialog()) await page.evaluate(() => { for (const m of document.querySelectorAll('.modal:not([hidden]) [data-close]')) m.click(); });
if (await openDialog()) throw new Error('the old build still shows a dialog over the workspace');
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'before-main.png') });

// the "+ New" menu and its AI entry, opened the page's own way and over the idle workspace, the same order as the
// "after" pictures (tests/e2e/capture-after.mjs): main, new menu, AI dialog, and the finished run last
await page.click('#b-new');
await page.waitForSelector('.hmenu', { state: 'visible', timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'before-new-menu.png') });
const aiEntry = page.locator('.hmenu [role="menuitem"], .hmenu button', { hasText: /AI/ }).first();
if (!(await aiEntry.count())) throw new Error('the "+ New" menu of the old build has no AI entry');
await aiEntry.click();
await page.waitForFunction(() => { const m = document.querySelector('#m-new'), a = document.querySelector('#new-ai'); return m && !m.hidden && a && !a.hidden; }, null, { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'before-ai-dialog.png') });
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelector('#m-new').hidden, null, { timeout: 5000 });

// run NAMEPLATE.H to the end, the way a user of the old build does: mode key 4 (FULL-RUN), speed MAX, the START soft key
const run = () => page.evaluate(() => {
  const s = document.querySelector('#scrub');
  return { mode: document.body.dataset.mode, state: (document.querySelector('#run-state')?.textContent || '').trim(), pgm: (document.querySelector('#pgm-path')?.textContent || '').trim(),
    at: s ? +s.value : -1, max: s ? +s.max : 0 };
});
// a key's text is its label and the PC key printed on it, run together ("NCSTARTSPACE"); START SINGLE and
// NC START NEXT BLOCK are other keys
const softKey = () => page.evaluate(() => {
  const keys = [...document.querySelectorAll('#sks button, #sks .sk')].map((e) => ({ e, t: e.textContent.replace(/\s+/g, '').toUpperCase() }));
  const k = keys.find((x) => /^(NC)?START(?!SINGLE|NEXT)/.test(x.t));
  if (k) k.e.click();
  return k ? k.t : keys.map((x) => x.t).join(' | ');
});
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('4');
await page.waitForTimeout(300);
if ((await run()).mode !== 'full') await page.evaluate(() => document.querySelector('#modes .mode[data-m="full"]')?.click());
await page.waitForFunction(() => document.body.dataset.mode === 'full', null, { timeout: 5000 });
await page.evaluate(() => document.querySelector('#spd button[data-s="0"]')?.click());
const pressed = await softKey();
if (/\|/.test(pressed) || !/START/.test(pressed)) throw new Error('the START soft key was not found in #sks: ' + pressed);
const ended = () => page.waitForFunction(() => { const s = document.querySelector('#scrub'); return /PROGRAM END/.test(document.querySelector('#run-state')?.textContent || '') && s && +s.value >= +s.max; }, null, { timeout: 60000 }).then(() => true, () => false);
let how = 'the START soft key at speed MAX';
if (!(await ended())) {
  // the old page shows a finished run when its run-position slider is at the end: move it there as a drag would
  how = 'the run-position slider moved to its end';
  await page.evaluate(() => { const s = document.querySelector('#scrub'); s.value = s.max; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(1500);
}
const r = await run();
if (!/NAMEPLATE\.H/.test(r.pgm) || r.at < r.max) throw new Error('the run of NAMEPLATE.H did not reach its end: ' + JSON.stringify(r));
console.log(`run finished by ${how}: ${JSON.stringify(r)}`);
await page.waitForTimeout(2600);   // the end-of-run message has left the soft keys
await page.screenshot({ path: join(out, 'before-run.png') });
await browser.close();
console.log('before shots in ' + out);
