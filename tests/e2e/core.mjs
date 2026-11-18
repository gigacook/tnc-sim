#!/usr/bin/env node
/* Core end-to-end test of the Business edition, with the real engine (WebAssembly) and the real persistence
 * (the simulator's own profile store in the browser). No server, no mock.
 *
 *   npm run build:business && node tests/e2e/core.mjs
 *
 * A user: opens /work -> creates a program -> edits it block by block -> runs it -> saves it as .H ->
 * reloads the page -> reopens it from the program manager -> runs it again.
 * The simulator is driven through its own controls (the ids tests/ui/run.mjs uses); its state is read
 * through window.TNC_UI, the simulator's documented plugin API.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checks, launch, requireBuild, serve, shots } from './lib.mjs';

const dir = requireBuild('business');
const c = checks('business core: create, edit, run, save, reload, reopen, rerun');
const NAME = 'E2E_CORE';
const BLOCKS = [
  'BLK FORM 0.1 Z X+0 Y+0 Z-20',
  'BLK FORM 0.2 X+100 Y+100 Z+0',
  'TOOL CALL 9 Z S2500',
  'L Z+50 R0 FMAX M3',
  'L X+20 Y+20 R0 FMAX',
  'L Z-2 R0 F200',
  'L X+80 Y+20 R0 F400',
  'L Z+50 R0 FMAX M5',
  'L Z+100 R0 FMAX M2',
];
/** the same block however the control spells rapid feed and spacing */
const norm = (l) => l.replace(/F\s*MAX/g, 'FMAX').replace(/\s+/g, ' ').trim();
const want = [`BEGIN PGM ${NAME} MM`, ...BLOCKS, `END PGM ${NAME} MM`].map(norm);

const server = await serve(dir);
const { browser } = await launch();
const downloads = mkdtempSync(join(tmpdir(), 'tnc-core-'));
const out = shots('business');
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /** the simulator frame, booted, with the first-run overlay out of the way */
  async function simulator() {
    const sim = await (await page.waitForSelector('main.work > iframe', { timeout: 15000 })).contentFrame();
    await sim.waitForFunction(() => window.TNC_UI && window.TNC_UI.state && window.TNC_UI.state.res, null, { timeout: 45000 });
    await sim.waitForTimeout(300);
    if (await sim.locator('#setup:not([hidden])').count()) await sim.click('#setup-skip');
    return sim;
  }
  const state = (sim) =>
    sim.evaluate(() => {
      const s = window.TNC_UI.state;
      return { pgm: s.pgm, mode: s.mode, editing: !!s.editing, text: s.text, names: Object.keys(s.pgms[s.machine]), errors: s.res.errors.map((e) => e.msg), run: window.TNC_UI.runState() };
    });
  const lines = (text) => text.split('\n').map(norm).filter(Boolean);
  /** select a run mode, start, wait for the end; returns the final state and the depth milled at the middle of the slot */
  async function run(sim) {
    await sim.click('#modes [data-m="full"]');
    const fast = sim.locator('#spd [data-s="16"]');
    if (await fast.count()) await fast.first().click().catch(() => {});
    await sim.evaluate(() => window.TNC_UI.exec('reset'));
    const before = await sim.evaluate(() => window.TNC_UI.surfaceAt(50, 20));
    await sim.click('#b-start');
    const started = await sim.waitForFunction(() => window.TNC_UI.runState().running || window.TNC_UI.runState().done, null, { timeout: 5000 }).then(() => true, () => false);
    const finished = await sim.waitForFunction(() => { const r = window.TNC_UI.runState(); return r.done && !r.running; }, null, { timeout: 180000 }).then(() => true, () => false);
    const s = await state(sim);
    const depth = await sim.evaluate(() => window.TNC_UI.surfaceAt(50, 20));
    return { started, finished, s, before, depth, untouched: await sim.evaluate(() => window.TNC_UI.surfaceAt(50, 70)) };
  }

  /* ---- open ---- */
  await page.goto(server.url + '/work');
  let sim = await simulator();
  c.ok(true, 'Business opens in the machine workspace');

  /* ---- create ---- */
  await sim.click('#b-new');
  await sim.fill('#ns-name', NAME);
  await sim.click('#ns-go');
  await sim.waitForFunction((n) => window.TNC_UI.state.pgm === n, NAME + '.H', { timeout: 5000 }).catch(() => {});
  let s = await state(sim);
  c.ok(s.pgm === NAME + '.H', 'create: New program -> Manual makes ' + NAME + '.H', s.pgm);
  c.ok(lines(s.text).join('|') === `BEGIN PGM ${NAME} MM|END PGM ${NAME} MM`, 'create: it holds BEGIN PGM and END PGM only', JSON.stringify(s.text));

  /* ---- edit: one block at a time through the block line ---- */
  for (const b of BLOCKS) {
    if (!(await state(sim)).editing) {
      await sim.locator('body').press('i');
      await sim.waitForFunction(() => !document.getElementById('dlg-in').disabled, null, { timeout: 3000 }).catch(() => {});
    }
    await sim.fill('#dlg-in', b);
    await sim.press('#dlg-in', 'Enter');
    await sim.waitForTimeout(120);
  }
  s = await state(sim);
  c.ok(lines(s.text).join('|') === want.join('|'), `edit: ${BLOCKS.length} typed blocks are stored in order`, JSON.stringify(lines(s.text)));
  c.ok(s.errors.length === 0, 'edit: the control reports no error for the program', s.errors.join(' | '));

  /* ---- run ---- */
  let r = await run(sim);
  c.ok(r.started, 'run: NC start starts the program');
  c.ok(r.finished, 'run: it runs to the end', JSON.stringify(r.s.run));
  c.ok(r.s.run.errors === 0, 'run: no error and no crash', String(r.s.run.errors));
  c.ok(r.before === 0 && Math.abs(r.depth + 2) < 0.05 && r.untouched === 0, 'run: the engine milled the slot 2 mm deep and nothing else', JSON.stringify({ before: r.before, depth: r.depth, untouched: r.untouched }));
  await page.screenshot({ path: join(out, 'core-after-run.png') });

  /* ---- save ---- */
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), sim.click('#b-save')]);
  if (c.ok(!!dl, 'save: Save .H hands over a file')) {
    const file = join(downloads, dl.suggestedFilename());
    await dl.saveAs(file);
    // the exported file carries block numbers, as a file from the control does
    const saved = lines(readFileSync(file, 'latin1').replace(/\r/g, '').replace(/^\d+\s+/gm, ''));
    c.ok(/E2E_CORE\.H$/i.test(dl.suggestedFilename()), 'save: the file is named after the program', dl.suggestedFilename());
    c.ok(saved.join('|') === want.join('|'), 'save: the file holds the program', JSON.stringify(saved));
  }
  const textBefore = (await state(sim)).text;
  await sim.waitForTimeout(900); // the profile store writes 300 ms after the last change

  /* ---- reload ---- */
  await page.reload();
  sim = await simulator();
  s = await state(sim);
  c.ok(s.names.includes(NAME + '.H'), 'reload: the program is still on the control', s.names.join(', '));

  /* ---- reopen from the program manager ---- */
  if (s.pgm === NAME + '.H') {
    // it came back as the open program; open another first so that reopening is a real step
    const other = s.names.find((n) => n !== NAME + '.H');
    await sim.click('#b-mgt');
    await sim.locator('#mgt .mrow', { hasText: other }).first().click();
    await sim.locator('#mgt .mrow.sel', { hasText: other }).first().click();
    await sim.waitForFunction((n) => window.TNC_UI.state.pgm === n, other, { timeout: 5000 }).catch(() => {});
    c.ok((await state(sim)).pgm === other, `reopen: another program (${other}) is opened first`);
  }
  await sim.click('#b-mgt');
  const row = sim.locator('#mgt .mrow', { hasText: NAME + '.H' }).first();
  await row.click();
  if (!(await sim.evaluate((n) => window.TNC_UI.state.pgm === n, NAME + '.H'))) await sim.locator('#mgt .mrow.sel', { hasText: NAME + '.H' }).first().click();
  await sim.waitForFunction((n) => window.TNC_UI.state.pgm === n, NAME + '.H', { timeout: 5000 }).catch(() => {});
  s = await state(sim);
  c.ok(s.pgm === NAME + '.H', 'reopen: the program manager opens ' + NAME + '.H', s.pgm);
  c.ok(s.text === textBefore, 'reopen: the text is what was written before the reload', JSON.stringify(lines(s.text)));

  /* ---- rerun ---- */
  r = await run(sim);
  c.ok(r.started && r.finished, 'rerun: it runs to the end again', JSON.stringify(r.s.run));
  c.ok(r.s.run.errors === 0 && r.before === 0 && Math.abs(r.depth + 2) < 0.05, 'rerun: same cut, no error', JSON.stringify({ errors: r.s.run.errors, before: r.before, depth: r.depth }));
  c.ok(errors.length === 0, 'no page error in the shell', errors.join(' | '));
  await page.screenshot({ path: join(out, 'core-after-rerun.png') });
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
  rmSync(downloads, { recursive: true, force: true });
}
process.exit(c.done());
