#!/usr/bin/env node
/* End-to-end test of the Play edition against the real simulator (real engine, real bridge). No mock.
 *
 *   npm run build:play && node tests/e2e/play.mjs            the checks
 *   node tests/e2e/play.mjs --measure                         also measures workshop frame times at 1920x1080
 *
 * START enters the workshop -> each station opens the one simulator with its machine -> leaving and
 * returning keeps an edited program (the frame is never reloaded) -> the interlock, the tool change and the
 * oil can reach the simulator through the bridge -> 333, a character, the secret programs, reduced motion.
 * Everything is done through the keyboard/list paths (the text station list), which are the alternatives to
 * the 3-D interactions. Screenshots: artifacts/play/e2e-*.png
 */
import { join } from 'node:path';
import { checks, launch, requireBuild, serve, shots } from './lib.mjs';
import { SECRETS } from '../../web/src/play/secrets.ts';

const dir = requireBuild('play');
const c = checks('play: start, stations, state kept, interlocks');
const measure = process.argv.includes('--measure');
const server = await serve(dir);
// the measured run uses the machine's GPU; the checks run the same either way
const { browser } = await launch(measure ? ['--use-angle=d3d11', '--enable-gpu'] : []);
const out = shots('play');
const NAME = 'PLAY_E2E';

try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /* ---- landing and START ---- */
  await page.goto(server.url + '/play');
  await page.waitForSelector('.land-start', { timeout: 15000 });
  c.ok((await page.evaluate(() => document.activeElement?.className)) === 'land-start', 'landing: START has the focus as soon as the page is there');
  c.ok((await page.evaluate(() => document.documentElement.lang)) === 'sv', 'landing: Swedish by default');
  c.ok((await page.locator('iframe').count()) === 0, 'landing: the simulator is not loaded before START');
  await page.locator('.land-lang .land-ctl', { hasText: 'EN' }).click();
  c.ok((await page.locator('.land-hero h1').innerText()).includes('CHIPS'), 'landing: the language switch changes the copy');
  c.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.settings.v1'))).lang === 'en', 'landing: the language is stored in tnc.settings.v1');
  await page.locator('.land-lang .land-ctl', { hasText: 'SV' }).click();
  await page.locator('.land-start').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shop-canvas', { timeout: 30000 });
  c.ok(true, 'START (Enter) enters the workshop');
  c.ok((await page.locator('.ob').count()) === 1, 'first visit: the introduction is shown');
  await page.keyboard.press('Escape');
  c.ok((await page.locator('.ob').count()) === 0 && JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.edition.play.v1'))).onboarded === true, 'the introduction can be skipped with Esc and stays away');

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
    return page.waitForSelector('.shop[data-mode="machine"]', { timeout: 8000 }).then(() => true, () => false);
  }
  async function leave() {
    // the simulator's own "to the workshop" control (it answers with tnc:exit); the shell's button when the simulator has none
    const own = sim.locator('#b-exit');
    if ((await own.count()) && (await own.isVisible())) await own.click();
    else if (await page.locator('.shop-simbar .hud-btn').count()) await page.locator('.shop-simbar .hud-btn').click();
    else await sim.evaluate(() => document.getElementById('b-exit').click());
    return page.waitForSelector('.shop[data-mode="floor"]', { timeout: 8000 }).then(() => true, () => false);
  }

  /* ---- walking: WASD moves, machines and walls stop the player ---- */
  await page.locator('.shop-canvas').focus();
  const p0 = await page.evaluate(() => window.__tncPlay.pose());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => window.__tncPlay.pose());
  c.ok(p0.z - p1.z > 0.8, 'W walks down the shop floor', JSON.stringify([p0, p1]));
  await page.locator('.hud-rail .hud-btn').first().click();
  await page.locator('.st-list li', { has: page.locator('h3', { hasText: 'fil15' }) }).locator('.hud-quiet').click();
  await page.waitForTimeout(1300);
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
  await page.locator('.st-list').count();
  await page.locator('.hud-rail .hud-btn').first().click();
  await page.locator('.st-list li', { has: page.locator('h3', { hasText: 'fil15' }) }).locator('.hud-quiet').click();
  await page.waitForTimeout(1300);
  await page.locator('.shop-canvas').focus();
  const t0 = Date.now();
  await page.keyboard.press('KeyE');
  const in1 = await page.waitForSelector('.shop[data-mode="machine"]', { timeout: 8000 }).then(() => true, () => false);
  const sweep = Date.now() - t0;
  c.ok(in1, 'E at fil15 opens its control');
  c.ok(sweep >= 800 && sweep <= 1900, `the sweep into the machine view takes about a second (${sweep} ms, bound 0.8 to 1.5 s plus the fade)`);
  await sim.waitForFunction(() => window.TNC_UI.state.machine === '426', null, { timeout: 5000 }).catch(() => {});
  let s = await simState();
  c.ok(s.machine === '426', 'fil15 selects machine 426 in the simulator', s.machine);
  c.ok(s.run.locked === false, 'fil15 is ready: the simulator is not locked');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'e2e-fil15-control.png') });

  /* ---- edit a program at fil15, leave, come back ---- */
  await sim.evaluate((n) => window.TNC_UI.open(n, `BEGIN PGM ${n} MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nEND PGM ${n} MM`), NAME);
  await sim.click('#modes [data-m="edit"]');
  await sim.locator('body').press('i');
  await sim.waitForFunction(() => !document.getElementById('dlg-in').disabled, null, { timeout: 3000 }).catch(() => {});
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
  await sim.waitForFunction(() => window.TNC_UI.state.machine === '430', null, { timeout: 5000 }).catch(() => {});
  s = await simState();
  c.ok(s.machine === '430', 'dmc125 selects machine 430 in the simulator', s.machine);
  c.ok(s.same, 'it is the same simulator frame, not a second one');
  c.ok((await page.locator('iframe').count()) === 1, 'there is exactly one simulator on the page');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'e2e-dmc125-control.png') });
  await leave();
  await page.waitForTimeout(1300);

  await enter('fil15');
  await sim.waitForFunction(() => window.TNC_UI.state.machine === '426', null, { timeout: 5000 }).catch(() => {});
  s = await simState();
  c.ok(s.machine === '426' && s.pgm === NAME + '.H' && s.text === edited && s.same, 'back at fil15 the edited program is still there, unchanged', JSON.stringify({ m: s.machine, pgm: s.pgm, same: s.same }));
  await leave();
  await page.waitForTimeout(1300);

  /* ---- interlock: a door open in the workshop locks NC start in the simulator, and only as tnc:lock ---- */
  await list('fil15', 'Öppna luckan');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === true, null, { timeout: 3000 }).catch(() => {});
  c.ok((await simState()).run.locked === true, 'door open on fil15: the simulator reports locked');
  c.ok((await page.locator('.st-list li', { has: page.locator('h3', { hasText: 'fil15' }) }).locator('.st-acts .hud-btn', { hasText: 'Öppna styrningen' }).count()) === 0, 'door open: the control cannot be opened');

  /* ---- the whole tool change, by list ---- */
  await list('fil15', 'Stoppa och lås');
  await list('fil15', 'Lossa verktyget');
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
    .waitForFunction(() => { const t = window.TNC_UI.tools.get().find((x) => x.name === 'PLANFRAES_D40'); return t ? { t: t.t, l: +t.l, r: +t.r } : null; }, null, { timeout: 5000 })
    .then((h) => h.jsonValue(), () => null);
  c.ok(row && row.l === 45 && row.r === 20, 'clamping writes the tool into the simulator tool table (tnc:tools:get / tnc:tools:set)', JSON.stringify(row));
  await list('fil15', 'Lås upp maskinen');
  await list('fil15', 'Stäng luckan');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === false, null, { timeout: 3000 }).catch(() => {});
  g = await game();
  c.ok(g.stations.fil15.phase === 'floor' && g.stations.fil15.equipped === 'face40' && (await simState()).run.locked === false, 'door closed again: unlocked, new tool equipped');

  /* ---- power and oil ---- */
  await list('fil15', 'Slå av strömmen');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === true, null, { timeout: 3000 }).catch(() => {});
  c.ok((await simState()).run.locked === true, 'power off on fil15 locks the simulator');
  await list('fil15', 'Slå på strömmen');
  await sim.waitForFunction(() => window.TNC_UI.runState().locked === false, null, { timeout: 3000 }).catch(() => {});
  c.ok((await simState()).run.locked === false, 'power on unlocks it');
  await list('Oljekannan', 'Ta upp');
  await list('fil15', 'Fyll på olja');
  const save = JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.play.save.v1')));
  c.ok(save && save.v === 1 && save.stations.fil15.oil === 100 && save.stations.fil15.equipped === 'face40' && save.held === 'oil', 'the game is saved in tnc.play.save.v1', JSON.stringify(save && save.stations.fil15));
  c.ok((await page.evaluate(() => localStorage.getItem('tnc.edition.business.v1'))) === null, 'nothing of the game is written to the Business edition key');
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
  c.ok((await game()).stations.fil15.phase === 'floor' && /Maskinen går/.test(await page.locator('.pp-live').innerText()), 'the door is refused while the simulator runs');
  await closeList();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'e2e-floor-while-running.png') });
  await sim.evaluate(() => window.TNC_UI.exec('stop'));
  await page.waitForFunction(() => window.__tncPlay.game().sim.running === false, null, { timeout: 5000 }).catch(() => {});

  /* ---- 333 ---- */
  await page.locator('.shop-canvas').focus();
  await page.keyboard.type('333');
  await page.waitForSelector('.cmp', { timeout: 3000 }).catch(() => {});
  c.ok((await page.locator('.cmp').count()) === 1, 'typing 333 opens the before / after comparison');
  await page.waitForTimeout(800);
  const beforeOk = await page.evaluate(() => { const i = document.querySelector('.cmp-before img'); return !!i && i.naturalWidth > 0; });
  c.ok(beforeOk, 'the "before" screenshot is shown');
  const liveMode = await page.evaluate(() => document.querySelector('.shop-sim').dataset.show);
  const hasSlider = (await page.locator('.cmp-range').count()) === 1;
  c.ok(liveMode === 'compare' || hasSlider, `"after": ${hasSlider ? 'a slider over the after screenshot' : 'the live simulator beside it (no after screenshot in this build)'}`);
  await page.screenshot({ path: join(out, 'e2e-333.png') });
  await page.keyboard.press('Escape');
  c.ok((await page.locator('.cmp').count()) === 0, 'Esc closes it');
  await page.locator('.hud-rail .hud-btn', { hasText: 'Dator' }).click();
  await page.locator('.sec-list li', { hasText: 'Före och efter' }).locator('.hud-btn').click();
  c.ok((await page.locator('.cmp').count()) === 1, 'the comparison is also reachable from the computer\'s secrets list');
  await page.keyboard.press('Escape');

  /* ---- a character: captioned, skippable, can be switched off ---- */
  await page.evaluate(() => window.__tncPlay.visit('office'));
  await page.waitForSelector('.npc', { timeout: 3000 }).catch(() => {});
  c.ok(/personell/.test(await page.locator('.npc p').innerText().catch(() => '')), 'the office character complains about "personell", with a caption');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'e2e-npc.png') });
  await page.keyboard.press('Escape');
  c.ok((await page.locator('.npc').count()) === 0, 'Esc skips the interruption');
  await page.evaluate(() => window.__tncPlay.visit('boss'));
  await page.locator('.npc .hud-btn', { hasText: 'Avbryt mig inte igen' }).click();
  c.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('tnc.edition.play.v1'))).npc.boss === false, 'a character can be switched off for good');

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
  const p = await calm.newPage();
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
  const t1 = Date.now();
  await p.locator('.st-list li').first().locator('.st-acts .hud-btn').first().click();
  await p.waitForSelector('.shop[data-mode="machine"]', { timeout: 5000 }).catch(() => {});
  const instant = Date.now() - t1;
  c.ok(instant < 500, `reduced motion: the machine view opens at once (${instant} ms)`);
  await calm.close();
} finally {
  await browser.close();
  await server.close();
}
process.exit(c.done());
