#!/usr/bin/env node
/* Captures the "after" pictures of the 333 comparison from the current build (not a test: a tool).
 *
 *   npm run build:play && node tests/e2e/capture-after.mjs
 *
 * Writes web/public/play/after/after-{main,run,new-menu,ai-dialog}.png at 1920x1080, framed like
 * web/public/play/before/: the plain simulator (no edition), English, NAMEPLATE.H loaded; idle, after a
 * finished run, with the New program entry open, and with its AI choice open. Run it again whenever the
 * simulator's look changes, then build:play so dist/play carries the new pictures.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, requireBuild, ROOT, serve } from './lib.mjs';

const dir = requireBuild('play');
const out = join(ROOT, 'web', 'public', 'play', 'after');
mkdirSync(out, { recursive: true });
const server = await serve(dir);
const { browser } = await launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // English like the "before" pictures; the first-run guide is not part of the framing
  await ctx.addInitScript(() => {
    try {
      const k = 'tnc.settings.v1';
      localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), lang: 'en' }));
    } catch {
      /* storage off: the simulator falls back to its default language */
    }
  });
  const page = await ctx.newPage();
  await page.goto(server.url + '/sim/');
  await page.waitForFunction(() => window.TNC_UI?.state?.res, null, { timeout: 45000 });
  if (await page.locator('#setup:not([hidden])').count()) await page.locator('#setup-skip').click();
  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(out, `after-${name}.png`) });
    console.log('  wrote ' + join(out, `after-${name}.png`));
  };
  const state = () => page.evaluate(() => ({ pgm: window.TNC_UI.state.pgm, lang: window.TNC_UI.lang, run: window.TNC_UI.runState() }));

  // the same program as "before": NAMEPLATE.H is the simulator's own first example
  const s0 = await state();
  if (s0.pgm !== 'NAMEPLATE.H') throw new Error(`expected NAMEPLATE.H on screen, found ${s0.pgm}`);
  if (s0.lang !== 'en') throw new Error(`expected English, found ${s0.lang}`);
  await shot('main');

  await page.click('#b-pgm'); await page.click('#b-new');
  await page.waitForSelector('#m-new:not([hidden])', { timeout: 5000 });
  await shot('new-menu');
  await page.click('#new-t-ai');
  await page.waitForSelector('#new-ai:not([hidden])', { timeout: 5000 });
  await shot('ai-dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#m-new', { state: 'hidden', timeout: 5000 });

  // last, so the run's messages are in no other picture
  await page.evaluate(() => window.TNC_UI.setSpeed(0));
  await page.click('#b-start');
  await page.waitForFunction(() => window.TNC_UI.runState().done === true, null, { timeout: 180000 });
  await shot('run');
  await ctx.close();
} catch (e) {
  failed = true;
  console.error('capture failed: ' + e.message);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
