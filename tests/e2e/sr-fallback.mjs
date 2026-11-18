#!/usr/bin/env node
/* Srpski next to a simulator that does not know it. The simulator here is a MOCK (tests/e2e/old-sim.html): it
 * speaks bridge v2 but knows only "sv" and "en", falls back to Swedish, drops a tnc:present it cannot read and
 * writes its own language into tnc.settings.v1 whenever it saves. The shells are the real builds.
 *
 *   npm run build:business && npm run build:play && node tests/e2e/sr-fallback.mjs
 *
 * The shell must keep Serbian on screen and in the store, START must still enter the workshop, the rest of
 * tnc:present must still arrive, and a language the user picks inside the simulator must still be followed.
 * (Against the real simulator the same path is covered by play.mjs and business-isolation.mjs.)
 */
import { join } from 'node:path';
import { checks, launch, requireBuild, ROOT, serve } from './lib.mjs';

const OLD = join(ROOT, 'tests', 'e2e', 'old-sim.html');
const mock = { '/sim/': OLD, '/sim/index.html': OLD };
const c = checks('Srpski with a simulator that falls back (mock simulator)');
const play = await serve(requireBuild('play'), mock);
const { browser } = await launch();
const view = (page) => page.evaluate(() => ({ html: document.documentElement.lang, stored: JSON.parse(localStorage.getItem('tnc.settings.v1') || '{}').lang }));
const settle = (page) => page.waitForTimeout(500);

try {
  /* ---- Play ---- */
  let ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  let page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(play.url + '/play');
  await page.waitForSelector('.land-start', { timeout: 15000 });
  await page.locator('.land-lang .land-ctl[lang="sr-Latn"]').click();
  await page.locator('.land-start').click();
  const entered = await page.waitForSelector('.shop-canvas', { timeout: 30000 }).then(() => true, () => false);
  c.ok(entered, 'play: START enters the workshop in Serbian');
  await page.keyboard.press('Escape');
  let sim = await (await page.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
  await sim.waitForFunction(() => window.OLD_SIM?.got.some((m) => m.type === 'tnc:present'), null, { timeout: 15000 });
  await settle(page);
  const got = await sim.evaluate(() => window.OLD_SIM.got);
  c.ok((await sim.evaluate(() => window.OLD_SIM.lang())) === 'sv', 'play: the mock simulator fell back to Swedish');
  c.ok(got.some((m) => m.type === 'tnc:present' && m.lang === 'sr' && Object.keys(m).length === 2), 'play: the language is sent to the simulator alone ({type, lang:"sr"})');
  c.ok(got.some((m) => m.type === 'tnc:present' && m.lang === undefined && m.quality === 'medium' && m.env === 'cold-steel'), 'play: the other presentation fields still arrive, in a message of their own');
  const hellos = got.filter((m) => m.type === 'tnc:hello').length;
  await settle(page);
  const later = await sim.evaluate(() => window.OLD_SIM.got.filter((m) => m.type === 'tnc:hello').length);
  c.ok(hellos >= 1 && hellos <= 3 && later === hellos, `play: the simulator is asked for its language once, not in a loop (${hellos} hello)`);
  const rail = async () => (await page.locator('.hud-rail > .hud-btn').first().innerText()).trim();
  let v = await view(page);
  c.ok((await rail()) === 'Stanice' && v.html === 'sr-Latn' && v.stored === 'sr', 'play: Serbian on screen and in the store once the simulator has answered', JSON.stringify(v));

  // the shell applied "quality: medium" above, so the simulator saved the key with its own "sv" in it. Again, by the user:
  c.ok(await sim.evaluate(() => window.OLD_SIM.userSet('sound', false)), 'play: the user flips a switch in the simulator (it saves every field, language "sv")');
  await settle(page);
  v = await view(page);
  c.ok((await rail()) === 'Stanice' && v.html === 'sr-Latn', 'play: the labels stay Serbian', JSON.stringify(v));
  c.ok(v.stored === 'sr', 'play: tnc.settings.v1 holds "sr" again', JSON.stringify(v));
  c.ok((await page.locator('.hud-rail > .hud-btn[aria-pressed]').innerText()).trim() === 'Upali zvuk', 'play: the switch itself (sound off) was taken over');

  await page.reload();
  await page.waitForSelector('.land-start', { timeout: 15000 });
  c.ok((await page.locator('.land-hero h1').innerText()).includes('ŠPON') && (await view(page)).html === 'sr-Latn', 'play: Serbian survives a reload');
  await page.keyboard.press('Enter');
  c.ok(await page.waitForSelector('.shop-canvas', { timeout: 30000 }).then(() => true, () => false), 'play: START enters the workshop again');
  sim = await (await page.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
  await sim.waitForFunction(() => window.OLD_SIM?.got.some((m) => m.type === 'tnc:present'), null, { timeout: 15000 });
  await settle(page);
  c.ok((await rail()) === 'Stanice' && (await view(page)).stored === 'sr', 'play: still Serbian after the simulator booted a second time');

  // a language the user picks inside the simulator is a choice, and is followed
  await sim.evaluate(() => window.OLD_SIM.userSet('lang', 'en'));
  await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 3000 }).catch(() => {});
  v = await view(page);
  c.ok((await rail()) === 'Stations' && v.html === 'en' && v.stored === 'en', 'play: English picked inside the simulator is followed', JSON.stringify(v));
  // and Serbian picked in the shell again holds, although the simulator stays English
  await page.locator('.hud-lang .hud-btn[lang="sr-Latn"]').click();
  await settle(page);
  await sim.evaluate(() => window.OLD_SIM.userSet('sound', true));
  await settle(page);
  v = await view(page);
  c.ok((await rail()) === 'Stanice' && v.stored === 'sr' && (await sim.evaluate(() => window.OLD_SIM.lang())) === 'en', 'play: Serbian picked on the rail holds while the simulator stays English', JSON.stringify(v));
  c.ok(errors.length === 0, 'play: no page error', errors.join(' | '));
  await ctx.close();
  await play.close();

  /* ---- Business ---- */
  const business = await serve(requireBuild('business'), mock);
  try {
    ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(() => {
      // the choice was made earlier (in Play, or in a simulator that knows Serbian)
      if (window === window.top && !sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('tnc.settings.v1', JSON.stringify({ lang: 'sr' }));
      }
    });
    page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(business.url + '/work');
    sim = await (await page.waitForSelector('main.work > iframe', { timeout: 15000 })).contentFrame();
    await sim.waitForFunction(() => window.OLD_SIM?.got.some((m) => m.type === 'tnc:hello'), null, { timeout: 15000 });
    await settle(page);
    v = await view(page);
    c.ok(v.html === 'sr-Latn' && v.stored === 'sr', 'business: /work opens in Serbian from the stored choice', JSON.stringify(v));
    await sim.evaluate(() => window.OLD_SIM.userSet('quality', 'low'));
    await settle(page);
    v = await view(page);
    c.ok(v.html === 'sr-Latn' && v.stored === 'sr', 'business: still Serbian, on screen and in the store, after the simulator saved its own "sv"', JSON.stringify(v));
    await page.reload();
    await page.waitForSelector('main.work > iframe', { timeout: 15000 });
    await settle(page);
    v = await view(page);
    c.ok(v.html === 'sr-Latn' && v.stored === 'sr', 'business: Serbian survives a reload', JSON.stringify(v));
    c.ok(errs.length === 0, 'business: no page error', errs.join(' | '));
    await ctx.close();
  } finally {
    await business.close();
  }
} finally {
  await browser.close();
  await play.close().catch(() => {});
}
process.exit(c.done());
