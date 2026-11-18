/* The single-file simulator works with no network at all: the built index.html is opened from disk (file://), the
   browser context is offline and every request that is not file:, data: or blob: is refused and counted. A showcase
   program is opened and run to its end with the keys of docs/MANUAL.md: 4 (FULL-RUN), 9 (speed MAX), SPACE (NC START).

   Build first:  python build.py
   Run:          node tests/e2e/offline.mjs [--page <file.html>]
   Chromium: PW_CHROMIUM=<chrome executable>, else Playwright's own. One headless browser, closed at the end. */
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = process.argv.indexOf('--page');
const PAGE = resolve(at > 0 ? process.argv[at + 1] : join(ROOT, 'index.html'));
const PROGRAM = '02_STEPPED_POCKET.H';
let failures = 0;
const check = (c, m, d) => { if (!c) failures++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}${c || d === undefined ? '' : `  (${typeof d === 'string' ? d : JSON.stringify(d)})`}`); };

if (!existsSync(PAGE)) { console.error(`offline: ${PAGE} is missing: run python build.py`); process.exit(1); }
const exe = process.env.PW_CHROMIUM;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(exe && existsSync(exe) ? { executablePath: exe } : {}) });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true });
  const refused = [], errors = [];
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (/^(file|data|blob):/.test(u)) return route.continue();
    refused.push(u.slice(0, 120));
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(pathToFileURL(PAGE).href);
  await page.waitForFunction(() => typeof window.TNC_UI?.open === 'function' && window.TNC_UI.state?.res, null, { timeout: 60000 });
  check(true, `the page from disk started with the network off (${PAGE})`);
  await page.waitForTimeout(800);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(120); }      // first-visit dialogs

  const manifest = JSON.parse(readFileSync(join(ROOT, 'examples', 'showcase', 'manifest.json'), 'utf8'));
  const p = manifest.programs.find((x) => x.file === PROGRAM);
  const text = readFileSync(join(ROOT, 'examples', 'showcase', p.file), 'utf8');
  await page.evaluate(({ name, text, machine, tools }) => window.TNC_UI.open(name, text, { machine, tools }), { name: p.file, text, machine: p.machine, tools: p.tools });
  await page.waitForFunction((t) => window.TNC_UI.state.text === t && window.TNC_UI.state.total > 0, text, { timeout: 30000 });
  const engineErrors = await page.evaluate(() => (window.TNC_UI.state.res?.errors || []).map((e) => `block ${e.block}: ${e.msg}`));
  check(engineErrors.length === 0, `${PROGRAM} is open on the ${p.machine} and the engine (WebAssembly, inlined) reports no error`, engineErrors.slice(0, 3));

  const done = () => page.evaluate(() => { const s = window.TNC_UI.state; return s.total > 0 && s.t >= s.total - 1e-6; });
  for (let attempt = 0; attempt < 3 && !(await done()); attempt++) {
    await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
    await page.keyboard.press('Escape'); await page.keyboard.press('4'); await page.keyboard.press('9'); await page.keyboard.press('Space');
    await page.waitForFunction(() => { const s = window.TNC_UI.state; return s.total > 0 && s.t >= s.total - 1e-6; }, null, { timeout: 60000 }).catch(() => {});
  }
  const end = await page.evaluate(() => { const s = window.TNC_UI.state; return { t: s.t, total: s.total, crashes: (s.events || []).filter((e) => e.sev === 'crash').length }; });
  check(await done(), 'the program ran to its end (run position = total)', end);
  check(end.crashes === 0, 'no crash event during the run', end.crashes);
  check(errors.length === 0, 'no script error in the page', errors.slice(0, 3));
  check(await page.evaluate(() => !window.TNC_BACKEND), 'no server is assumed (window.TNC_BACKEND is not set)');
  console.log(`     requests refused because the network is off: ${refused.length}${refused.length ? ' (' + [...new Set(refused)].slice(0, 5).join(', ') + ')' : ''}`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `\noffline: ${failures} FAILED` : '\noffline: all passed');
process.exit(failures ? 1 : 0);
