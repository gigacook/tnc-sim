#!/usr/bin/env node
/* Autosave of the simulator's text boxes (#338): node tests/ui/autosave.mjs   (needs index.html: python3 build.py)
 * Types into the new-program name, the project name and the tool table, reloads, the text is back (the AI prompt is a
 * server-only view now: its draft is checked in tests/ai/dialog-e2e.mjs);
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
  const load = async () => { await page.goto(URL_); await page.waitForSelector('#b-new'); await page.waitForFunction(() => window.TNC_UI && TNC_UI.state.res, null, { timeout: 20000 }); await page.waitForTimeout(300); if (await page.locator('#setup:not([hidden])').count()) await page.click('#setup-skip'); };
  const openManual = async () => { await page.click('#b-new'); await page.click('#new-t-scratch'); await page.waitForSelector('#ns-name', { state: 'visible' }); };
  const openProj = async () => { if (await page.getAttribute('#b-insp', 'aria-pressed') === 'false') await page.click('#b-insp'); await page.click('#tab-progs'); await page.evaluate(() => { document.getElementById('pj-box').open = true; }); await page.waitForSelector('#proj-name', { state: 'visible' }); };
  await load(); await page.evaluate(() => localStorage.clear()); await load();

  await openManual(); await page.fill('#ns-name', 'DRAFT_PART');
  await load(); await openManual();
  check(await page.inputValue('#ns-name') === 'DRAFT_PART', `${bt}: new program name survives a reload`);
  await page.click('#ns-go');
  check((await drafts()).every(k => !k.endsWith(':ns-name')), `${bt}: Create & edit clears the name draft`);
  await load(); await openManual();
  check(await page.inputValue('#ns-name') === 'MY_PART', `${bt}: new program name is back to the default after Create`);
  await page.keyboard.press('Escape');

  await load(); await openProj(); await page.fill('#proj-name', 'Vice jobs');
  await load(); await openProj();
  check(await page.inputValue('#proj-name') === 'Vice jobs', `${bt}: project name survives a reload`);
  await page.click('#b-proj-new');
  check(await page.inputValue('#proj-name') === '' && (await drafts()).every(k => !k.endsWith(':proj-name')), `${bt}: Create project clears it`);
  await load(); await openProj();
  check(await page.inputValue('#proj-name') === '', `${bt}: project name empty after Create and reload`);

  // D338-2: boxes the app saves on "change" must survive a reload before the box loses focus (typed, no blur, reload)
  const openTool = async () => { await page.click('#b-tools'); await page.waitForSelector('.ttab input[data-k=name]'); };
  await load(); await openTool(); await page.locator('.ttab input[data-k=name]').first().fill('DRAFTNAME');
  await load(); await page.waitForTimeout(700); await openTool();
  check(await page.locator('.ttab input[data-k=name]').first().inputValue() === 'DRAFTNAME', `${bt}: tool name typed and not blurred survives a reload`);
  await load(); await page.waitForTimeout(700); await openTool();
  const toolNow = await page.locator('.ttab input[data-k=name]').first().inputValue(), toolDrafts = (await drafts()).filter(k => k.includes('tool-'));
  check(toolNow === 'DRAFTNAME' && toolDrafts.length === 0, `${bt}: ...and it was committed to the tool table (still there on the next load, draft gone)${toolNow === 'DRAFTNAME' && !toolDrafts.length ? '' : `  [name "${toolNow}", drafts ${toolDrafts.join(' ') || 'none'}]`}`);
  // D338-3 key carries the site; D338-4 quota note
  await load(); await openManual(); await page.fill('#ns-name', 'ABC_DEF');
  check((await drafts()).some(k => k.includes(':ns-name') && !k.startsWith('gc:draft:index.html:')), `${bt}: key carries host and path`);
  await page.evaluate(() => { Object.getPrototypeOf(window.localStorage).setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.fill('#ns-name', 'ABC_DEF_GHI');
  check(await page.inputValue('#ns-name') === 'ABC_DEF_GHI' && /storage is full or off/.test(await page.locator('#ns-name + .gc-draft-note[role=status]').innerText().catch(() => '')), `${bt}: storage full keeps the text and shows a note`);

  // D338-7: writes start failing after the first keystroke, then Create: the first-keystroke text must not come back
  await load(); await openProj(); await page.fill('#proj-name', 'a');
  await page.evaluate(() => { const pr = Object.getPrototypeOf(window.localStorage); window.__origSet = pr.setItem; pr.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.fill('#proj-name', 'abcdef'); await page.click('#b-proj-new');
  await page.evaluate(() => { Object.getPrototypeOf(window.localStorage).setItem = window.__origSet; });
  await load(); await openProj();
  check(await page.inputValue('#proj-name') === '' && (await drafts()).every(k => !k.endsWith(':proj-name')), `${bt}: after Create the first-keystroke project name does not come back`);
  await browser.close();
}
const { lintPaths } = await import(pathToFileURL(join(ROOT, 'scripts', 'autosave-lint.mjs')).href);
for (const f of ['index.html', 'docs/index.html', 'sim']) { const bad = lintPaths([join(ROOT, f)]); check(bad.length === 0, `lint ${f}: every writable text box has autosave (${bad.length} without)`); }
if (errors.length) { failures++; console.log('FAIL errors:\n  ' + errors.slice(0, 10).join('\n  ')); }
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
