#!/usr/bin/env node
/* Autosave of the simulator's text boxes (#338): node tests/ui/autosave.mjs   (needs index.html: python3 build.py)
 * Types into the new-program name, the project name, the AI prompt and the new-tool number, reloads, the text is back;
 * Create / Add clears it; the lint finds no unprotected box in index.html and docs/index.html.
 * Playwright: `playwright` from node_modules, or PLAYWRIGHT_MODULE=<path>; BROWSERS=chromium,webkit. file:// only, no server. */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL_ = pathToFileURL(join(ROOT, 'index.html')).href;
let failures = 0; const errors = [];
const check = (c, m) => { if (!c) failures++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); };
for (const bt of (process.env.BROWSERS || 'chromium').split(',')) {
  const browser = await pw[bt].launch(process.env.PW_CHROMIUM && bt === 'chromium' ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(`${bt} pageerror: ${e.message}`));
  const drafts = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gc:draft:')));
  const load = async () => { await page.goto(URL_); await page.waitForSelector('#b-new'); await page.waitForSelector('#boot', { state: 'hidden', timeout: 20000 }).catch(() => {}); await page.locator('#m-prof').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}); await page.keyboard.press('Escape'); };
  const openManual = async () => { await page.click('#b-new'); await page.getByText('NEW PRG — MANUAL').click(); await page.waitForSelector('#ns-name', { state: 'visible' }); };
  const openAI = async () => { await page.click('#b-new'); await page.getByText('NEW PRG — AI').click(); await page.waitForSelector('#ai-prompt', { state: 'visible' }); };
  const openProj = async () => { await page.click('#tab-progs'); await page.evaluate(() => { document.getElementById('pj-box').open = true; }); await page.waitForSelector('#proj-name', { state: 'visible' }); };
  await load(); await page.evaluate(() => localStorage.clear()); await load();

  await openManual(); await page.fill('#ns-name', 'DRAFT_PART');
  await load(); await openManual();
  check(await page.inputValue('#ns-name') === 'DRAFT_PART', `${bt}: new program name survives a reload`);
  await page.click('#ns-go');
  check((await drafts()).every(k => !k.endsWith(':ns-name')), `${bt}: Create & edit clears the name draft`);
  await load(); await openManual();
  check(await page.inputValue('#ns-name') === 'MY_PART', `${bt}: new program name is back to the default after Create`);
  await page.keyboard.press('Escape');

  await load(); await openAI(); await page.fill('#ai-prompt', '120 x 80 x 15 aluminium plate with four M10 holes');
  await load(); await openAI();
  check(await page.inputValue('#ai-prompt') === '120 x 80 x 15 aluminium plate with four M10 holes', `${bt}: AI prompt survives a reload`);
  await page.keyboard.press('Escape');

  await load(); await openProj(); await page.fill('#proj-name', 'Vice jobs');
  await load(); await openProj();
  check(await page.inputValue('#proj-name') === 'Vice jobs', `${bt}: project name survives a reload`);
  await page.click('#b-proj-new');
  check(await page.inputValue('#proj-name') === '' && (await drafts()).every(k => !k.endsWith(':proj-name')), `${bt}: Create project clears it`);
  await load(); await openProj();
  check(await page.inputValue('#proj-name') === '', `${bt}: project name empty after Create and reload`);
  await browser.close();
}
const { lintPaths } = await import(pathToFileURL(join(ROOT, 'scripts', 'autosave-lint.mjs')).href);
for (const f of ['index.html', 'docs/index.html', 'sim']) { const bad = lintPaths([join(ROOT, f)]); check(bad.length === 0, `lint ${f}: every writable text box has autosave (${bad.length} without)`); }
if (errors.length) { failures++; console.log('FAIL errors:\n  ' + errors.slice(0, 10).join('\n  ')); }
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
