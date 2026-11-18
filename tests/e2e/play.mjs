#!/usr/bin/env node
/* End-to-end test of the Play edition against the real simulator (real engine, real bridge). No mock.
 *
 *   npm run build:play && node tests/e2e/play.mjs            the checks
 *   node tests/e2e/play.mjs --measure                         also measures workshop frame times at 1920x1080
 *
 * START enters the workshop -> each station opens the one simulator with its machine -> leaving and
 * returning keeps an edited program (the frame is never reloaded) -> the interlock, the tool change and the
 * oil can reach the simulator through the bridge -> 333, a character, the secret programs, reduced motion.
 * First of all the third language: Srpski changes the labels, survives a reload and a simulator that does not
 * know it, and START still enters the workshop.
 * Everything is done through the keyboard/list paths (the text station list), which are the alternatives to
 * the 3-D interactions. Last a phone-sized touch context: the thumb pad walks, a drag looks around. That is
 * Chromium's touch emulation, not a test on a real phone. Screenshots: artifacts/play/e2e-*.png
 */
import { join } from 'node:path';
import { checks, launch, requireBuild, serve, shots } from './lib.mjs';
import { SECRETS } from '../../web/src/play/secrets.ts';

const dir = requireBuild('play');
const c = checks('play: start, stations, state kept, interlocks');
const measure = process.argv.includes('--measure');
// --slow or --slow=6: a machine without a GPU and with a slow processor (a CI runner): software rendering and the
// page's main thread slowed down by that factor. Every check has to pass there too: none may depend on frame rate.
const slowArg = process.argv.find((a) => a === '--slow' || a.startsWith('--slow='));
const slow = slowArg ? Number(slowArg.split('=')[1] || 4) : 0;
const server = await serve(dir);
// the measured run uses the machine's GPU; the checks run the same either way
const { browser } = await launch(measure ? ['--use-angle=d3d11', '--enable-gpu'] : slow ? ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'] : []);
/** a page of this run; under --slow its main thread (the simulator frame included) runs `slow` times slower */
async function open(ctx) {
  const pg = await ctx.newPage();
  if (slow) await (await ctx.newCDPSession(pg)).send('Emulation.setCPUThrottlingRate', { rate: slow });
  return pg;
}
const out = shots('play');
const NAME = 'PLAY_E2E';
// How long a state may take to show on the slowest machine (CI draws a frame in two seconds, and every step of the
// page waits for one). These waits are for something to happen; how fast it happens is checked where it matters.
const WAIT = 30000;

/** In-page stopwatch from the page receiving the next `trigger` event to the machine view being on screen. Read with
 *  `window.__sw`. The page's own clock leaves out how long this script and the browser take to deliver the input. */
const stopwatch = (pg, trigger) =>
  pg.evaluate((type) => {
    const sw = { t0: 0, t1: 0 };
    window.__sw = sw;
    const shop = document.querySelector('.shop');
    window.addEventListener(
      type,
      () => {
        sw.t0 = performance.now();
      },
      { capture: true, once: true },
    );
    new MutationObserver((_, o) => {
      if (shop.dataset.mode !== 'machine') return;
      sw.t1 = performance.now();
      o.disconnect();
    }).observe(shop, { attributes: true, attributeFilter: ['data-mode'] });
  }, trigger);
/** Type 333 the way a hand does: three keys within a moment. (`keyboard.type` waits for the page after every key; on
 *  a machine that needs two seconds for a frame that puts the keys further apart than the two seconds they may be.) */
async function type333(ctx, pg) {
  const cdp = await ctx.newCDPSession(pg);
  const key = (type) => cdp.send('Input.dispatchKeyEvent', { type, key: '3', code: 'Digit3', windowsVirtualKeyCode: 51, nativeVirtualKeyCode: 51 });
  await Promise.all(['keyDown', 'keyUp', 'keyDown', 'keyUp', 'keyDown', 'keyUp'].map(key));
  await cdp.detach();
}
/** what the shell says is put on screen a moment after the action (an empty beat first): wait for the sentence */
const said = (pg, words) => pg.waitForFunction((w) => (document.querySelector('.pp-live')?.textContent ?? '').toLowerCase().includes(w), words.toLowerCase(), { timeout: WAIT }).catch(() => {});
/** the list's "go there" has arrived when the prompt names the station (the walk there is a camera move) */
const promptNames = (pg, station) => pg.waitForFunction((n) => (document.querySelector('.hud-prompt')?.textContent ?? '').includes(n), station, { timeout: WAIT }).then(() => true, () => false);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tnc.settings.v1') || '{}').lang);
const htmlLang = (page) => page.evaluate(() => document.documentElement.lang);

try {
  /* ---- Srpski: the labels change, the choice survives a reload, START still enters the workshop ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await open(ctx);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url + '/play');
    await page.waitForSelector('.land-start', { timeout: WAIT });
    const offered = await page.locator('.land-lang .land-ctl').allInnerTexts();
    c.ok(offered.map((x) => x.trim()).join(' / ') === 'Svenska / English / Srpski', 'landing: the switch offers Svenska / English / Srpski', offered.join(' / '));
    const before = await page.locator('.land-hero').innerText();
    await page.locator('.land-lang .land-ctl[lang="sr-Latn"]').click();
    const hero = await page.locator('.land-hero').innerText();
    c.ok(hero !== before && hero.includes('ŠPON') && hero.includes('EMULZIJA') && /Dve mašine/.test(hero), 'Srpski: the landing copy changes to Serbian', hero.replace(/\s+/g, ' '));
    c.ok((await page.locator('.land-cells').innerText()).includes('Stara glodalica u ćošku') && (await page.locator('.land-foot').innerText()).includes('Simulator za obuku'), 'Srpski: the cells and the note change too');
    c.ok((await htmlLang(page)) === 'sr-Latn' && (await stored(page)) === 'sr', 'Srpski: <html lang="sr-Latn">, stored as "sr" in tnc.settings.v1', `${await htmlLang(page)} ${await stored(page)}`);
    c.ok((await page.locator('.land-start').innerText()).startsWith('START'), 'Srpski: START stays START');

    await page.reload();
    await page.waitForSelector('.land-start', { timeout: WAIT });
    c.ok((await page.locator('.land-hero h1').innerText()).includes('ŠPON') && (await page.locator('.land-lang .land-ctl[aria-pressed="true"]').getAttribute('lang')) === 'sr-Latn' && (await htmlLang(page)) === 'sr-Latn', 'Srpski survives a reload of the landing');
    c.ok((await page.evaluate(() => document.activeElement?.className)) === 'land-start', 'Srpski: START has the focus after the reload');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shop-canvas', { timeout: 30000 });
    c.ok(true, 'Srpski: START (Enter) enters the workshop');
    c.ok(/dobro došli u 5511/i.test(await page.locator('.ob h2').innerText().catch(() => '')), 'Srpski: the introduction is in Serbian');
    await page.keyboard.press('Escape');
    const rail = async () => (await page.locator('.hud-rail > .hud-btn').allInnerTexts()).map((x) => x.trim()).join(' | ');
    c.ok((await rail()) === 'Stanice | Pogled | Računar | Pomoć | Ugasi zvuk', 'Srpski: the workshop rail is in Serbian', await rail());
    c.ok((await page.locator('.hud-lang .hud-btn').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')).join(' / '))) === 'Svenska / English / Srpski', 'workshop: the rail switch offers Svenska / English / Srpski');
    c.ok((await page.locator('.hud-state').first().innerText()) === 'SPREMNA', 'Srpski: the machine state in the HUD is in Serbian');

    // the simulator: whether it speaks Serbian yet or falls back, the shell keeps the language the user chose
    const sim = await (await page.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
    await sim.waitForFunction(() => window.TNC_UI?.state?.res, null, { timeout: 45000 });
    await page.waitForTimeout(500);
    // end to end: the shell sent tnc:present {lang:'sr'}; the simulator's own labels are Serbian (sim/i18n.js: btn.insp, btn.new)
    const simLabels = () => sim.evaluate(() => ({ lang: window.TNC_UI.lang, insp: document.querySelector('#b-insp [data-i18n="btn.insp"]')?.textContent.trim(), neu: document.querySelector('#b-new [data-i18n="btn.new"]')?.textContent.trim() }));
    await sim.waitForFunction(() => window.TNC_UI.lang === 'sr', null, { timeout: WAIT }).catch(() => {});
    let labels = await simLabels();
    c.ok(labels.lang === 'sr' && labels.insp === 'Inspektor' && labels.neu === 'Novi program', 'Srpski end to end: the simulator shows "sr", its own controls read "Inspektor" and "Novi program"', JSON.stringify(labels));
    // a save of the shared key by the simulator itself (the user flips a switch in its settings panel, twice)
    await sim.evaluate(() => { window.TNC_SETTINGS.set('sound', false); window.TNC_SETTINGS.set('sound', true); });
    await page.waitForTimeout(600);
    c.ok((await rail()) === 'Stanice | Pogled | Računar | Pomoć | Ugasi zvuk' && (await htmlLang(page)) === 'sr-Latn', 'Srpski stays on screen after the simulator booted and saved the shared settings', await rail());
    c.ok((await stored(page)) === 'sr', 'Srpski is still what tnc.settings.v1 holds after the simulator saved it', await stored(page));

    // the game works in Serbian: the list, an interlock (its reason goes to the simulator as text) and a refusal
    await page.locator('.hud-rail .hud-btn').first().click();
    const fil15 = page.locator('.st-list li', { has: page.locator('h3', { hasText: 'fil15' }) });
    c.ok(/vrata zatvorena, spremna · Ulje 100 %/.test(await fil15.locator('p').innerText()), 'Srpski: the station list states are in Serbian', await fil15.locator('p').innerText());
    // the interlock follows the station whose control was opened last: go to fil15's control and come back
    await fil15.locator('.st-acts .hud-btn', { hasText: 'Otvori upravljanje' }).click();
    c.ok(await page.waitForSelector('.shop[data-mode="machine"]', { timeout: WAIT }).then(() => true, () => false), 'Srpski: "Otvori upravljanje" opens the control of fil15');
    await sim.evaluate(() => document.getElementById('b-exit').click());
    await page.waitForSelector('.shop[data-mode="floor"]', { timeout: WAIT }).catch(() => {});
    await page.waitForTimeout(1300);
    await page.locator('.hud-rail .hud-btn').first().click();
    await fil15.locator('.st-acts .hud-btn', { hasText: 'Otvori vrata' }).click();
    await sim.waitForFunction(() => window.TNC_UI.runState().locked === true, null, { timeout: WAIT }).catch(() => {});
    c.ok((await sim.evaluate(() => window.TNC_UI.runState().locked)) === true, 'Srpski: "Otvori vrata" locks NC start in the simulator');
    await fil15.locator('.st-acts .hud-btn', { hasText: 'Zaustavi i zaključaj' }).click();
    await fil15.locator('.st-acts .hud-btn', { hasText: 'Otpusti alat' }).click();
    await said(page, 'Treba ti ključ');
    c.ok(/Treba ti ključ/.test(await page.locator('.pp-live').innerText()), 'Srpski: a refusal gives its reason in Serbian', await page.locator('.pp-live').innerText());
    await page.keyboard.press('Escape');
    await page.locator('.hud-rail .hud-btn', { hasText: 'Računar' }).click();
    c.ok((await page.locator('.pc .seg').first().locator('button').allInnerTexts()).join(' / ') === 'Svenska / English / Srpski' && (await page.locator('.pc .seg').first().locator('[aria-pressed="true"]').innerText()) === 'Srpski', 'computer: the language setting offers Svenska / English / Srpski, Srpski chosen');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__tncPlay.visit('office'));
    await page.waitForSelector('.npc', { timeout: WAIT }).catch(() => {});
    c.ok(/personal(?!l)/.test(await page.locator('.npc p').innerText().catch(() => '')) && /^kancelarija$/i.test(await page.locator('.npc b').innerText()), 'Srpski: the office character complains about "personal", captioned');
    await page.keyboard.press('Escape');

    await page.reload();
    await page.waitForSelector('.land-start', { timeout: WAIT });
    c.ok((await page.locator('.land-hero h1').innerText()).includes('ŠPON') && (await stored(page)) === 'sr', 'Srpski survives a reload after the workshop and the simulator ran');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shop-canvas', { timeout: 30000 });
    c.ok((await page.locator('.ob').count()) === 0 && (await rail()).startsWith('Stanice'), 'Srpski: START enters the workshop again, straight to the floor');
    await page.locator('.hud-lang .hud-btn[lang="sv"]').click();
    c.ok((await rail()).startsWith('Stationer') && (await htmlLang(page)) === 'sv' && (await stored(page)) === 'sv', 'and back to Svenska from the workshop rail', await rail());
    const sim2 = await (await page.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
    await sim2.waitForFunction(() => window.TNC_UI?.lang === 'sv' && document.querySelector('#b-insp [data-i18n="btn.insp"]')?.textContent.trim() === 'Inspektör', null, { timeout: 45000 }).catch(() => {});
    labels = await sim2.evaluate(() => ({ lang: window.TNC_UI?.lang, insp: document.querySelector('#b-insp [data-i18n="btn.insp"]')?.textContent.trim() }));
    c.ok(labels.lang === 'sv' && labels.insp === 'Inspektör', 'and the simulator follows back to Swedish ("Inspektör")', JSON.stringify(labels));
    c.ok(errors.length === 0, 'Srpski: no page error in the shell', errors.join(' | '));
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await open(ctx);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /* ---- landing and START ---- */
  await page.goto(server.url + '/play');
  await page.waitForSelector('.land-start', { timeout: WAIT });
  c.ok((await page.evaluate(() => document.activeElement?.className)) === 'land-start', 'landing: START has the focus as soon as the page is there');
  c.ok((await page.evaluate(() => document.documentElement.lang)) === 'sv', 'landing: Swedish by default');
  c.ok((await page.locator('iframe').count()) === 0, 'landing: the simulator is not loaded before START');
  await page.locator('.land-lang .land-ctl[lang="en"]').click();
  c.ok((await page.locator('.land-hero h1').innerText()).includes('CHIPS'), 'landing: the language switch changes the copy');
  c.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.settings.v1'))).lang === 'en', 'landing: the language is stored in tnc.settings.v1');
  await page.locator('.land-lang .land-ctl[lang="sv"]').click();
  await page.locator('.land-start').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shop-canvas', { timeout: 30000 });
  c.ok(true, 'START (Enter) enters the workshop');
  c.ok((await page.locator('.ob').count()) === 1, 'first visit: the introduction is shown');
  await page.keyboard.press('Escape');
  c.ok((await page.locator('.ob').count()) === 0 && JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.edition.play.v1'))).onboarded === true, 'the introduction can be skipped with Esc and stays away');

  // The boss and the office each drop in on their own, at most once in five minutes of play. On a machine without a
  // graphics card this script plays for much longer than that (CI run 44344286816: the boss stood on the floor when 333
  // was typed), so it does what a player who wants to work in peace does: it switches both off at the computer. Further
  // down the characters are called by hand, and the boss is switched on again before he is told not to come back.
  const playPrefs = async () => JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.edition.play.v1')));
  async function mayInterrupt(who, on) {
    if (!(await page.locator('.pc').count())) await page.locator('.hud-rail .hud-btn', { hasText: 'Dator' }).click();
    await page.locator('.pc .seg', { has: page.locator('legend', { hasText: who }) }).locator('button', { hasText: on ? /^På$/ : /^Av$/ }).click();
  }
  await mayInterrupt('Chefen får avbryta', false);
  await mayInterrupt('Kontoret får avbryta', false);
  await page.keyboard.press('Escape');
  const quiet = (await playPrefs()).npc;
  c.ok(quiet.boss === false && quiet.office === false && (await page.locator('.pc').count()) === 0, 'the computer switches both characters off: nobody interrupts on their own from here', JSON.stringify(quiet));

  const sim = await (await page.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
  await sim.waitForFunction(() => window.TNC_UI && window.TNC_UI.state && window.TNC_UI.state.res, null, { timeout: 45000 });
  c.ok(new URL(sim.url()).search === '?edition=play', 'the simulator is asked for the play edition');
  await sim.evaluate(() => (window.__sameFrame = 1));
  if (await sim.locator('#setup:not([hidden])').count()) await sim.evaluate(() => document.getElementById('setup-skip').click());
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.shop-sim')).visibility);
  c.ok(hidden === 'hidden', 'on the floor the simulator is mounted but not shown', hidden);

  const game = () => page.evaluate(() => window.__tncPlay.game());
  const simState = () => sim.evaluate(() => ({ machine: window.TNC_UI.state.machine, pgm: window.TNC_UI.state.pgm, text: window.TNC_UI.state.text, run: window.TNC_UI.runState(), same: window.__sameFrame === 1 }));
  /** the text station list: the keyboard alternative to every 3-D interaction */
  async function list(target, action) {
    if (!(await page.locator('.st-list').count())) await page.locator('.hud-rail .hud-btn').first().click();
    const item = page.locator('.st-list li', { has: page.locator('h3', { hasText: target }) });
    await item.locator('.st-acts .hud-btn', { hasText: action }).first().click();
    await page.waitForTimeout(150);
  }
  const closeList = async () => {
    if (await page.locator('.st-list').count()) await page.keyboard.press('Escape');
  };
  async function enter(station) {
    await list(station, 'Öppna styrningen');
    return page.waitForSelector('.shop[data-mode="machine"]', { timeout: WAIT }).then(() => true, () => false);
  }
  async function leave() {
    // the simulator's own "to the workshop" control (it answers with tnc:exit); the shell's button when the simulator has none
    const own = sim.locator('#b-exit');
    if ((await own.count()) && (await own.isVisible())) await own.click();
    else if (await page.locator('.shop-simbar .hud-btn').count()) await page.locator('.shop-simbar .hud-btn').click();
    else await sim.evaluate(() => document.getElementById('b-exit').click());
    return page.waitForSelector('.shop[data-mode="floor"]', { timeout: WAIT }).then(() => true, () => false);
  }

  /* ---- walking: WASD moves, machines and walls stop the player ---- */
  const padShown = await page.evaluate(() => ({ fine: matchMedia('(pointer: fine)').matches, n: document.querySelectorAll('.pad').length, display: getComputedStyle(document.querySelector('.pad')).display }));
  c.ok(padShown.fine && padShown.n === 1 && padShown.display === 'none', 'with a mouse (pointer: fine) the thumb pad is not shown', JSON.stringify(padShown));
  await page.locator('.shop-canvas').focus();
  const p0 = await page.evaluate(() => window.__tncPlay.pose());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => window.__tncPlay.pose());
  c.ok(p0.z - p1.z > 0.8, 'W walks down the shop floor', JSON.stringify([p0, p1]));
  await page.locator('.hud-rail .hud-btn').first().click();
  await page.locator('.st-list li', { has: page.locator('h3', { hasText: 'fil15' }) }).locator('.hud-quiet').click();
  await promptNames(page, 'fil15');
  await page.locator('.shop-canvas').focus();
  const prompt = await page.locator('.hud-prompt').innerText().catch(() => '');
  c.ok(/Öppna styrningen/.test(prompt) && /fil15/.test(prompt), 'at fil15 the prompt names the action and the station', prompt.replace(/\s+/g, ' '));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const p2 = await page.evaluate(() => window.__tncPlay.pose());
  // fil15's footprint (web/src/play/scene: centre -6.3, -9.65, 2.3 x 2.0) plus the player's radius
  const insideMachine = p2.x > -7.45 - 0.38 && p2.x < -5.15 + 0.38 && p2.z > -10.65 - 0.38 && p2.z < -8.65 + 0.38;
  c.ok(!insideMachine && p2.x > -9 && p2.z > -12, 'walking into the machine stops at it (no clipping through machine or wall)', JSON.stringify(p2));

  /* ---- E opens the station in front of the player; the sweep takes 0.8 to 1.5 s ---- */
  // The sweep runs on the clock, not on frames, so it is over after its time on any machine. What a slow machine adds
  // is waiting for a frame that is being drawn: one when the time is up, one before the view is put on screen. The
  // bound allows for two of this machine's slowest frames: 0.03 s with a graphics card, seconds without one (CI).
  await page.locator('.hud-rail .hud-btn').first().click();
  await page.evaluate(() => window.__tncPlay.resetStats());
  await page.locator('.st-list li', { has: page.locator('h3', { hasText: 'fil15' }) }).locator('.hud-quiet').click();
  await promptNames(page, 'fil15');
  await page.locator('.shop-canvas').focus();
  await stopwatch(page, 'keydown');
  await page.keyboard.press('KeyE');
  const in1 = await page.waitForSelector('.shop[data-mode="machine"]', { timeout: WAIT }).then(() => true, () => false);
  const sw = await page.evaluate(() => ({ ...window.__sw, frame: window.__tncPlay.stats().maxMs }));
  const sweep = Math.round(sw.t1 - sw.t0);
  const most = Math.round(1900 + 2 * sw.frame);
  c.ok(in1, 'E at fil15 opens its control');
  c.ok(in1 && sweep >= 800 && sweep <= most, `the sweep into the machine view takes about a second (${sweep} ms from the key to the view; bound 0.8 to 1.5 s plus the fade plus two frames of ${Math.round(sw.frame)} ms = ${most} ms)`, JSON.stringify(sw));
  await sim.waitForFunction(() => window.TNC_UI.state.machine === '426', null, { timeout: WAIT }).catch(() => {});
  let s = await simState();
  c.ok(s.machine === '426', 'fil15 selects machine 426 in the simulator', s.machine);
  c.ok(s.run.locked === false, 'fil15 is ready: the simulator is not locked');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'e2e-fil15-control.png') });

  /* ---- edit a program at fil15, leave, come back ---- */
  await sim.evaluate((n) => window.TNC_UI.open(n, `BEGIN PGM ${n} MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nEND PGM ${n} MM`), NAME);
  await sim.click('#modes [data-m="edit"]');
  await sim.locator('body').press('i');
  await sim.waitForFunction(() => !document.getElementById('dlg-in').disabled, null, { timeout: WAIT }).catch(() => {});
  await sim.fill('#dlg-in', 'L X+12 Y+34 R0 FMAX');
  await sim.press('#dlg-in', 'Enter');
  await sim.waitForTimeout(300);
  s = await simState();
  c.ok(s.pgm === NAME + '.H' && /L X\+12 Y\+34/.test(s.text), 'a program is edited at fil15', s.text);
  const edited = s.text;
  c.ok(await leave(), 'the exit control returns to the workshop');
  c.ok((await game()).stations.fil15.phase === 'floor', 'the game is back on the floor at fil15');
  await page.waitForTimeout(1300);

  c.ok(await enter('dmc125'), 'the station list opens dmc125');
  await sim.waitForFunction(() => window.TNC_UI.state.machine === '430', null, { timeout: WAIT }).catch(() => {});
  s = await simState();
  c.ok(s.machine === '430', 'dmc125 selects machine 430 in the simulator', s.machine);
  c.ok(s.same, 'it is the same simulator frame, not a second one');
  c.ok((await page.locator('iframe').count()) === 1, 'there is exactly one simulator on the page');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'e2e-dmc125-control.png') });
  await leave();
  await page.waitForTimeout(1300);

  await enter('fil15');
  await sim.waitForFunction(() => window.TNC_UI.state.machine === '426', null, { timeout: WAIT }).catch(() => {});
  s = await simState();
  c.ok(s.machine === '426' && s.pgm === NAME + '.H' && s.text === edited && s.same, 'back at fil15 the edited program is still there, unchanged', JSON.stringify({ m: s.machine, pgm: s.pgm, same: s.same }));
  await leave();
  await page.waitForTimeout(1300);

  /* ---- interlock: a door open in the workshop locks NC start in the simulator, and only as tnc:lock ---- */
  await list('fil15', 'Öppna luckan');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === true, null, { timeout: WAIT }).catch(() => {});
  c.ok((await simState()).run.locked === true, 'door open on fil15: the simulator reports locked');
  c.ok((await page.locator('.st-list li', { has: page.locator('h3', { hasText: 'fil15' }) }).locator('.st-acts .hud-btn', { hasText: 'Öppna styrningen' }).count()) === 0, 'door open: the control cannot be opened');

  /* ---- the whole tool change, by list ---- */
  await list('fil15', 'Stoppa och lås');
  await list('fil15', 'Lossa verktyget');
  await said(page, 'nyckeln');
  c.ok((await game()).stations.fil15.phase === 'isolated' && /nyckeln/i.test(await page.locator('.pp-live').innerText()), 'loosening without the wrench is refused, with the reason');
  await list('Nyckeln', 'Ta upp');
  await list('fil15', 'Lossa verktyget');
  await list('fil15', 'Ta ur verktyget');
  let g = await game();
  c.ok(g.stations.fil15.phase === 'spindleEmpty' && g.carrying === 'em10', 'the tool is out of the spindle and in the hand', JSON.stringify({ phase: g.stations.fil15.phase, carrying: g.carrying }));
  await list('Verktygsstället', 'PLANFRAES_D40');
  await list('fil15', 'Sätt i verktyget');
  await list('fil15', 'Dra åt verktyget');
  const row = await sim
    .waitForFunction(() => { const t = window.TNC_UI.tools.get().find((x) => x.name === 'PLANFRAES_D40'); return t ? { t: t.t, l: +t.l, r: +t.r } : null; }, null, { timeout: WAIT })
    .then((h) => h.jsonValue(), () => null);
  c.ok(row && row.l === 45 && row.r === 20, 'clamping writes the tool into the simulator tool table (tnc:tools:get / tnc:tools:set)', JSON.stringify(row));
  await list('fil15', 'Lås upp maskinen');
  await list('fil15', 'Stäng luckan');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === false, null, { timeout: WAIT }).catch(() => {});
  g = await game();
  c.ok(g.stations.fil15.phase === 'floor' && g.stations.fil15.equipped === 'face40' && (await simState()).run.locked === false, 'door closed again: unlocked, new tool equipped');

  /* ---- power and oil ---- */
  await list('fil15', 'Slå av strömmen');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === true, null, { timeout: WAIT }).catch(() => {});
  c.ok((await simState()).run.locked === true, 'power off on fil15 locks the simulator');
  await list('fil15', 'Slå på strömmen');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === false, null, { timeout: WAIT }).catch(() => {});
  c.ok((await simState()).run.locked === false, 'power on unlocks it');
  await list('Oljekannan', 'Ta upp');
  await list('fil15', 'Fyll på olja');
  const save = JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.play.save.v1')));
  c.ok(save && save.v === 1 && save.stations.fil15.oil === 100 && save.stations.fil15.equipped === 'face40' && save.held === 'oil', 'the game is saved in tnc.play.save.v1', JSON.stringify(save && save.stations.fil15));
  c.ok((await page.evaluate(() => localStorage.getItem('tnc.edition.business.v1'))) === null, 'nothing of the game is written to the Business edition key');

  /* ---- the measuring tool: into the control, then tnc:inspect compare opens the simulator's comparison ---- */
  const inspector = () => sim.evaluate(() => ({ open: !document.body.classList.contains('focus'), pressed: document.getElementById('b-insp').getAttribute('aria-pressed'), tab: document.querySelector('#stabs [aria-selected="true"]')?.dataset.tab }));
  const closedBefore = await inspector();
  await list('Skjutmåttet', 'Ta upp');
  await list('fil15', 'Mät detaljen');
  c.ok(await page.waitForSelector('.shop[data-mode="machine"]', { timeout: WAIT }).then(() => true, () => false), 'the measuring tool ("Mät detaljen") enters the control of fil15');
  await sim.waitForFunction(() => !document.body.classList.contains('focus'), null, { timeout: WAIT }).catch(() => {});
  const openAfter = await inspector();
  c.ok(closedBefore.open === false && openAfter.open === true && openAfter.pressed === 'true', 'the inspector was closed and is open after the measuring tool', JSON.stringify([closedBefore, openAfter]));
  c.ok(openAfter.tab === 'diag' && (await sim.locator('#st-diag').isVisible()) && (await sim.locator('#sp-diag .card-compare').isVisible()) && (await sim.locator('#cmp').isVisible()), 'the inspector shows the compare tab: Diagnostics selected, the comparison card visible', JSON.stringify(openAfter));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, 'e2e-measure-compare.png') });
  await leave();
  await page.waitForTimeout(1300);
  await closeList();

  /* ---- a running program: the oil drops with cutting time, the door stays shut ---- */
  await enter('fil15');
  await sim.evaluate(() => window.TNC_UI.open('PLAY_RUN', 'BEGIN PGM PLAY_RUN MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 9 Z S2500\nL Z+50 R0 FMAX M3\nL X+10 Y+50 R0 FMAX\nL Z-2 R0 F100\nL X+90 Y+50 R0 F100\nL Z+50 R0 FMAX M5\nL Z+100 R0 FMAX M2\nEND PGM PLAY_RUN MM'));
  await sim.click('#modes [data-m="full"]');
  await sim.click('#b-start');
  const cutting = await sim.waitForFunction(() => window.TNC_UI.runState().cutting, null, { timeout: 60000 }).then(() => true, () => false);
  c.ok(cutting, 'a program runs and reports cutting');
  await leave();
  await page.waitForTimeout(3500);
  g = await game();
  c.ok(g.sim.running === true, 'the simulation keeps running while the player is on the floor');
  c.ok(g.stations.fil15.oil < 100 && g.stations.fil15.oil > 99, `simulated cutting drained the oil a little (${g.stations.fil15.oil.toFixed(3)} %)`);
  c.ok(g.stations.dmc125.oil === 100, 'the idle machine lost none');
  await list('fil15', 'Öppna luckan');
  await said(page, 'Maskinen går');
  c.ok((await game()).stations.fil15.phase === 'floor' && /Maskinen går/.test(await page.locator('.pp-live').innerText()), 'the door is refused while the simulator runs');
  await closeList();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'e2e-floor-while-running.png') });
  await sim.evaluate(() => window.TNC_UI.exec('stop'));
  await page.waitForFunction(() => window.__tncPlay.game().sim.running === false, null, { timeout: WAIT }).catch(() => {});

  /* ---- 333 ---- */
  await page.locator('.shop-canvas').focus();
  await type333(ctx, page);
  await page.waitForSelector('.cmp', { timeout: WAIT }).catch(() => {});
  c.ok((await page.locator('.cmp').count()) === 1, 'typing 333 opens the before / after comparison');
  await page.waitForFunction(() => [...document.querySelectorAll('.cmp-pane img')].length === 2 && [...document.querySelectorAll('.cmp-pane img')].every((im) => im.complete && im.naturalWidth > 0), null, { timeout: WAIT }).catch(() => {});
  const beforeOk = await page.evaluate(() => { const i = document.querySelector('.cmp-before img'); return !!i && i.naturalWidth > 0; });
  c.ok(beforeOk, 'the "before" screenshot is shown');
  // slider mode: this build carries the "after" pictures (tests/e2e/capture-after.mjs), so no live simulator beside it
  const liveMode = await page.evaluate(() => document.querySelector('.shop-sim').dataset.show);
  const hasSlider = (await page.locator('.cmp-range').count()) === 1;
  const afterOk = await page.evaluate(() => { const i = document.querySelector('.cmp-after img'); return !!i && i.naturalWidth === 1920 && i.naturalHeight === 1080; });
  c.ok(hasSlider && afterOk && liveMode !== 'compare', '333 is in slider mode: the "after" screenshot (1920x1080) under a slider, no live simulator', JSON.stringify({ hasSlider, afterOk, liveMode }));
  const split = () => page.evaluate(() => {
    const stage = document.querySelector('.cmp-stage').getBoundingClientRect();
    const bar = document.querySelector('.cmp-bar').getBoundingClientRect();
    return { value: +document.querySelector('.cmp-range').value, bar: Math.round(((bar.left + bar.width / 2 - stage.left) / stage.width) * 100), clip: getComputedStyle(document.querySelector('.cmp-after')).clipPath };
  });
  const sp0 = await split();
  await page.locator('.cmp-range').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  // the divider is drawn from the slider's value: wait for it to be drawn, then read
  const drawn = (want) => page.waitForFunction((v) => {
    const stage = document.querySelector('.cmp-stage')?.getBoundingClientRect();
    const bar = document.querySelector('.cmp-bar')?.getBoundingClientRect();
    return !!stage && !!bar && Math.abs(((bar.left + bar.width / 2 - stage.left) / stage.width) * 100 - (v ?? +document.querySelector('.cmp-range').value)) <= 0.5;
  }, want, { timeout: WAIT }).catch(() => {});
  await drawn(60);
  const sp1 = await split();
  c.ok(sp0.value === 50 && sp1.value === 60 && sp1.bar === 60 && sp1.clip !== sp0.clip, 'the slider moves by keyboard: 50 -> 60, the divider and the cut follow', JSON.stringify([sp0, sp1]));
  const rb = await page.locator('.cmp-range').boundingBox();
  await page.mouse.click(rb.x + rb.width * 0.25, rb.y + rb.height / 2);
  await page.waitForFunction(() => +document.querySelector('.cmp-range').value < 60, null, { timeout: WAIT }).catch(() => {});
  await drawn(null);
  const sp2 = await split();
  c.ok(Math.abs(sp2.value - 25) <= 3 && Math.abs(sp2.bar - sp2.value) <= 1, 'the slider moves by pointer: a click at a quarter of the track', JSON.stringify(sp2));
  await page.screenshot({ path: join(out, 'e2e-333.png') });
  const pairs = [];
  for (let i = 0; i < 4; i++) {
    await page.locator('.cmp-tabs [role="tab"]').nth(i).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.cmp-pane img')].every((im) => im.complete), null, { timeout: WAIT }).catch(() => {});
    pairs.push(await page.evaluate(() => [...document.querySelectorAll('.cmp-pane img')].map((im) => im.naturalWidth).join('+') + (document.querySelector('.cmp-range') ? '' : ' no slider')));
  }
  c.ok(pairs.every((x) => x === '1920+1920'), 'all four comparisons have their before and their after picture', pairs.join(' | '));
  await page.keyboard.press('Escape');
  c.ok((await page.locator('.cmp').count()) === 0, 'Esc closes it');
  // typed into the simulator's editor, 333 is program text, not the Easter egg
  await enter('fil15');
  await sim.click('#modes [data-m="edit"]');
  await sim.locator('body').press('i');
  await sim.waitForFunction(() => !document.getElementById('dlg-in').disabled, null, { timeout: WAIT }).catch(() => {});
  await sim.locator('#dlg-in').pressSequentially('333', { delay: 40 });
  await page.waitForTimeout(400);
  const typedInSim = await sim.evaluate(() => document.getElementById('dlg-in').value);
  c.ok(typedInSim.includes('333') && (await page.locator('.cmp').count()) === 0, '333 typed in the simulator\'s editor stays in the editor and opens nothing', typedInSim);
  await sim.press('#dlg-in', 'Escape');
  await leave();
  await page.waitForTimeout(1300);
  await page.locator('.hud-rail .hud-btn', { hasText: 'Dator' }).click();
  await page.locator('.sec-list li', { hasText: 'Före och efter' }).locator('.hud-btn').click();
  c.ok((await page.locator('.cmp').count()) === 1, 'the comparison is also reachable from the computer\'s secrets list');
  await page.keyboard.press('Escape');

  /* ---- a character: captioned, skippable, can be switched off ---- */
  await page.evaluate(() => window.__tncPlay.visit('office'));
  await page.waitForSelector('.npc', { timeout: WAIT }).catch(() => {});
  c.ok(/personell/.test(await page.locator('.npc p').innerText().catch(() => '')), 'the office character complains about "personell", with a caption');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'e2e-npc.png') });
  await page.keyboard.press('Escape');
  c.ok((await page.locator('.npc').count()) === 0, 'Esc skips the interruption');
  await mayInterrupt('Chefen får avbryta', true);
  await page.keyboard.press('Escape');
  const bossOn = (await playPrefs()).npc.boss;
  await page.evaluate(() => window.__tncPlay.visit('boss'));
  await page.locator('.npc .hud-btn', { hasText: 'Avbryt mig inte igen' }).click();
  c.ok(bossOn === true && (await playPrefs()).npc.boss === false, 'a character can be switched off for good', JSON.stringify({ before: bossOn }));

  /* ---- the secret programs are real programs: the engine takes each without an error ---- */
  for (const sec of SECRETS.filter((x) => x.program)) {
    const errs = await sim.evaluate(async (p) => { window.TNC_UI.open(p.name, p.text); await new Promise((r) => setTimeout(r, 400)); return window.TNC_UI.state.res.errors.map((e) => e.msg); }, sec.program);
    c.ok(errs.length === 0, `secret ${sec.program.name} compiles in the engine without errors`, errs.join(' | '));
  }
  c.ok(errors.length === 0, 'no page error in the shell', errors.join(' | '));

  /* ---- measured frame times (only with --measure) ---- */
  if (measure) {
    await closeList();
    const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
    console.log(`\n  frame times at 1920x1080, quality medium, ${gpu}`);
    for (const [name, i] of [['first person', 0], ['whole workshop', 1], ['machine orbit', 2]]) {
      await page.locator('.hud-rail .hud-btn', { hasText: 'Vy' }).click();
      await page.locator('.view-list .hud-btn').nth(i).click();
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.__tncPlay.resetStats());
      await page.waitForTimeout(6000);
      const st = await page.evaluate(() => window.__tncPlay.stats());
      console.log(`    ${name.padEnd(15)} ${st.frames} frames  avg ${st.avgMs.toFixed(2)} ms  p95 ${st.p95Ms.toFixed(2)} ms  max ${st.maxMs.toFixed(2)} ms  (${(1000 / st.avgMs).toFixed(1)} fps)`);
    }
  }
  await ctx.close();

  /* ---- reduced motion: poster or grid only, no film; the machine view switches at once ---- */
  const calm = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: true });
  await calm.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await open(calm);
  await p.goto(server.url + '/play');
  await p.waitForSelector('.land-start');
  c.ok((await p.locator('video').count()) === 0, 'reduced motion: the landing has no film element');
  const box = await p.locator('.land-start').boundingBox();
  c.ok(box && box.height >= 44 && box.width >= 44 && box.y + box.height <= 844, '390x844: START is on the first screen and big enough to hit', JSON.stringify(box));
  c.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '390x844: no sideways scroll on the landing');
  await p.locator('.land-start').click();
  await p.waitForSelector('.shop-canvas', { timeout: 30000 });
  await p.keyboard.press('Escape');
  const small = await p.evaluate(() => [...document.querySelectorAll('.hud-rail .hud-btn')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
  c.ok(small === 0, '390x844: every rail control is at least 44 x 44 px');
  await p.locator('.hud-rail .hud-btn').first().click();
  await stopwatch(p, 'click');
  await p.locator('.st-list li').first().locator('.st-acts .hud-btn').first().click();
  const calmIn = await p.waitForSelector('.shop[data-mode="machine"]', { timeout: WAIT }).then(() => true, () => false);
  const calmSw = await p.evaluate(() => window.__sw);
  const instant = Math.round(calmSw.t1 - calmSw.t0);
  c.ok(calmIn && instant >= 0 && instant < 500, `reduced motion: the machine view opens at once (${instant} ms from the click to the view, in the same turn as the click)`, JSON.stringify(calmSw));
  await calm.close();

  /* ---- a phone: the thumb pad walks, a drag looks around. Chromium touch emulation, not a real phone. ---- */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await phone.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // this context has no "after" pictures, which keeps the live-simulator mode of 333 under test
  await phone.route('**/play/after/**', (r) => r.fulfill({ status: 404, body: 'not found' }));
  const ph = await open(phone);
  const phErrors = [];
  ph.on('pageerror', (e) => phErrors.push(e.message));
  await ph.goto(server.url + '/play');
  await ph.waitForSelector('.land-start');
  await ph.tap('.land-start');
  await ph.waitForSelector('.shop-canvas', { timeout: 30000 });
  c.ok((await ph.locator('.pad').count()) === 0, 'touch: no thumb pad under the introduction');
  await ph.tap('.ob .hud-quiet');
  await ph.waitForSelector('.pad', { timeout: WAIT }).catch(() => {});
  const lay = await ph.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const pad = document.querySelector('.pad');
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      display: pad ? getComputedStyle(pad).display : 'missing',
      pad: pad ? box(pad) : null,
      knob: pad ? box(pad.querySelector('.pad-knob')) : null,
      others: [...document.querySelectorAll('.hud-rail .hud-btn, .hud-status, .hud-bottom > *')].map((el) => ({ what: el.className + ' ' + el.textContent.trim().slice(0, 14), ...box(el) })),
    };
  });
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  c.ok(lay.coarse && lay.display !== 'none' && lay.pad && lay.pad.w >= 44 && lay.pad.h >= 44 && lay.knob.w >= 44 && lay.knob.h >= 44, 'touch (pointer: coarse): the thumb pad is shown, pad and knob at least 44 x 44 px', JSON.stringify({ coarse: lay.coarse, pad: lay.pad, knob: lay.knob }));
  c.ok(lay.pad && lay.pad.x >= 0 && lay.pad.y >= 0 && lay.pad.x + lay.pad.w <= 390 && lay.pad.y + lay.pad.h <= 844, 'touch: the pad is inside the 390 x 844 screen');
  const covered = lay.pad ? lay.others.filter((o) => hits(lay.pad, o)).map((o) => o.what) : ['no pad'];
  c.ok(covered.length === 0 && lay.others.length >= 8, 'touch: the pad covers neither the station list button nor any other HUD control', covered.join(' | '));
  const stationBtn = await ph.evaluate(() => { const b = document.querySelector('.hud-rail .hud-btn'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; });
  c.ok(stationBtn, 'touch: the station list button is the topmost thing where it is drawn');

  const cdp = await phone.newCDPSession(ph);
  const finger = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const pose = () => ph.evaluate(() => window.__tncPlay.pose());
  const cx = lay.pad.x + lay.pad.w / 2;
  const cy = lay.pad.y + lay.pad.h / 2;
  // the knob is put where the thumb is in the same step that tells the scene to walk: wait for it, then measure
  const knobAt = (where) => ph.waitForFunction((w) => document.querySelector('.pad-knob')?.style.transform === w, where, { timeout: WAIT }).catch(() => {});
  await finger('touchStart', [[cx, cy]]);
  await finger('touchMove', [[cx, cy - 20]]);
  await finger('touchMove', [[cx, cy - 60]]);
  await knobAt('translate(0px, -38px)');
  const w0 = await pose();
  await ph.waitForTimeout(900);
  const knobUp = await ph.evaluate(() => document.querySelector('.pad-knob').style.transform);
  const w1 = await pose();
  await finger('touchEnd', []);
  await knobAt('translate(0px, 0px)');
  const w2 = await pose();
  await ph.waitForTimeout(400);
  const w3 = await pose();
  c.ok(w0.z - w1.z > 0.8 && Math.abs(w1.x - w0.x) < 0.2, `touch: pushing the pad forward walks down the floor (${(w0.z - w1.z).toFixed(2)} m in 0.9 s)`, JSON.stringify([w0, w1]));
  c.ok(/translate\(0px, -38px\)/.test(knobUp), 'touch: the knob follows the thumb and stops at its travel', knobUp);
  c.ok(w2.z === w3.z && w2.x === w3.x && (await ph.evaluate(() => document.querySelector('.pad-knob').style.transform)) === 'translate(0px, 0px)', 'touch: letting go stops the player and centres the knob', JSON.stringify([w2, w3]));
  await finger('touchStart', [[cx, cy]]);
  await finger('touchMove', [[cx + 60, cy]]);
  await knobAt('translate(38px, 0px)');
  await ph.waitForTimeout(600);
  const w4 = await pose();
  await finger('touchEnd', []);
  c.ok(w4.x - w3.x > 0.5, `touch: pushing the pad right steps to the right (${(w4.x - w3.x).toFixed(2)} m)`, JSON.stringify([w3, w4]));
  // a drag on the floor looks around, also while the other thumb holds the pad
  await finger('touchStart', [[cx, cy]]);
  await finger('touchStart', [[cx, cy], [300, 420]]);
  // one frame between the moves: the browser hands a page the moves of one frame as a single event, and the view
  // turns by the distance between two events, so on a slow machine four quick moves could arrive as fewer
  for (const x of [280, 250, 220, 190]) {
    await finger('touchMove', [[cx, cy], [x, 420]]);
    await ph.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  await ph.waitForFunction((yaw) => Math.abs(window.__tncPlay.pose().yaw - yaw) > 0.3, w4.yaw, { timeout: WAIT }).catch(() => {});
  const w5 = await pose();
  // the finger rests before it lifts: lifted at speed it is a flick, and the browser uses up the next tap to stop the
  // flick (no click on the station list button below)
  await ph.waitForTimeout(200);
  await finger('touchMove', [[cx, cy], [190, 420]]);
  await finger('touchEnd', []);
  c.ok(Math.abs(w5.yaw - w4.yaw) > 0.3, `touch: a drag on the floor turns the view (${(w5.yaw - w4.yaw).toFixed(2)} rad) with the pad held`, JSON.stringify([w4.yaw, w5.yaw]));
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: join(out, 'touch-pad-390x844.png') });

  await ph.tap('.hud-rail .hud-btn');
  await ph.waitForSelector('.st-list', { timeout: WAIT }).catch(() => {});
  c.ok((await ph.locator('.st-list').count()) === 1 && (await ph.locator('.pad').count()) === 0, 'touch: a tap on the station list button opens the list; the pad is away while a panel is open');
  await ph.keyboard.press('Escape');

  // 333 without "after" pictures: the live simulator beside the old picture
  const phSim = await (await ph.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
  await phSim.waitForFunction(() => window.TNC_UI?.state?.res, null, { timeout: 45000 }).catch(() => {});
  await ph.locator('.shop-canvas').focus();
  await type333(phone, ph);
  await ph.waitForSelector('.cmp-live', { timeout: WAIT }).catch(() => {});
  await ph.waitForTimeout(500);
  const liveShown = await ph.evaluate(() => ({ show: document.querySelector('.shop-sim').dataset.show, slider: document.querySelectorAll('.cmp-range').length, live: document.querySelectorAll('.cmp-live').length }));
  c.ok(liveShown.show === 'compare' && liveShown.slider === 0 && liveShown.live === 1, '333 without "after" pictures: the live simulator beside the old picture, no slider', JSON.stringify(liveShown));
  await ph.keyboard.press('Escape');
  c.ok((await ph.locator('.cmp').count()) === 0 && (await ph.evaluate(() => document.querySelector('.shop-sim').dataset.show)) === 'no', 'Esc closes that one too and hides the simulator again');
  c.ok(phErrors.length === 0, 'touch: no page error in the shell', phErrors.join(' | '));
  await phone.close();
} finally {
  await browser.close();
  await server.close();
}
process.exit(c.done());
