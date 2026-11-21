#!/usr/bin/env node
/* Machining replay (sim/cine.js): node tests/ui/cine.mjs   (needs index.html: python3 build.py)
 * Outcomes, not internals: the film of a program is the same every time and differs between programs; every showcase
 * program gets at least four kinds of shot and ends on the hero orbit; the camera is never inside the blank or the vice
 * jaws (rig poses sampled over the whole film, and the live camera while it plays); close() gives back the camera,
 * the orbit target, the speed and the run exactly; Esc closes; reduced motion has no whip pans and no dolly zoom;
 * no AudioContext is made while the sound is off; no page errors.
 * Playwright: `playwright` from node_modules, or PLAYWRIGHT_MODULE=<path>; PW_CHROMIUM=<chrome> for another browser. */
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL_ = pathToFileURL(join(ROOT, 'index.html')).href;
let failures = 0, passes = 0; const errors = [];
const check = (c, m, d) => { if (c) passes++; else failures++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}${!c && d ? '  (' + d + ')' : ''}`); };

const args = ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
async function launch() {
  const tries = [process.env.PW_CHROMIUM, undefined];
  try { for (const d of readdirSync('/opt/pw-browsers')) if (/^chromium-\d+$/.test(d)) tries.push(`/opt/pw-browsers/${d}/chrome-linux64/chrome`, `/opt/pw-browsers/${d}/chrome-linux/chrome`); } catch {}
  for (const exe of tries) {
    if (exe && !existsSync(exe)) continue;
    try { return await pw.chromium.launch(exe ? { executablePath: exe, args } : { args }); } catch {}
  }
  throw new Error('no Chromium for Playwright');
}
const browser = await launch();

async function page(settings) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000);
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (/cine render|plugin (tick|scene|resize)/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });   // a rig that throws falls back silently: count it
  await p.addInitScript((st) => {
    try { localStorage.setItem('tnc.settings.v1', JSON.stringify(Object.assign({ v: 1, setup: 1, lang: 'en', sound: false }, st))); } catch (e) {}
    window.__ac = 0;                                        // count every AudioContext the page makes
    const A = window.AudioContext;
    if (A) window.AudioContext = class extends A { constructor(...a) { super(...a); window.__ac++; } };
    (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(ui => ui.on('ready', () => { window.__ready = true; }));
  }, settings || {});
  await p.goto(URL_);
  await p.waitForFunction(() => window.__ready && window.TNC_UI && TNC_UI.state.res && window.TNC_CINE, null, { timeout: 30000 });
  await p.waitForTimeout(300);
  if (await p.locator('#setup:not([hidden])').count()) await p.click('#setup-skip');
  return p;
}
const openPgm = (p, file) => p.evaluate((f) => { const m = TNC_SHOWCASE.manifest.find(x => x.file === f) || {};
  TNC_UI.open(f, TNC_SHOWCASE.sources[f], { machine: m.machine }); return TNC_UI.state.segs.length; }, file);
const frames = (p, n = 3) => p.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

/* ---------- 1. the film of every showcase program ---------- */
{
  const p = await page();
  const files = await p.evaluate(() => TNC_SHOWCASE.manifest.map(m => m.file));
  check(files.length >= 16, `showcase has ${files.length} programs`);
  const seen = new Map();
  for (const f of files) {
    await openPgm(p, f);
    const a = await p.evaluate(() => TNC_CINE.film()), b = await p.evaluate(() => TNC_CINE.film());
    await openPgm(p, f);                                     // re-open: compiled again, the film must not change
    const c = await p.evaluate(() => TNC_CINE.film());
    const ja = JSON.stringify(a.shots);
    check(ja === JSON.stringify(b.shots) && ja === JSON.stringify(c.shots), `${f}: same shot list every time (${a.shots.length} shots, ${a.len.toFixed(1)} s)`);
    const types = new Set(a.shots.map(s => s.type));
    check(types.size >= 4, `${f}: ${types.size} kinds of shot (${[...types].join(' ')})`);
    check(a.shots[a.shots.length - 1].type === 'hero' && a.shots[0].type === 'establish', `${f}: opens on the establishing shot, ends on the hero orbit`);
    check(a.shots.every((s, i) => i === 0 || s.f0 >= a.shots[i - 1].f1 - 1e-6) && a.shots.every(s => s.f1 > s.f0), `${f}: shots in order, none empty`);
    seen.set(f, ja);
    /* the camera rig never inside the blank or a vice jaw, sampled over the whole film */
    const bad = await p.evaluate(() => {
      const film = TNC_CINE.film(), out = [];
      for (let i = 0; i <= 160; i++) {
        const f = film.len * i / 160, s = TNC_CINE.sample(f), q = s.p;
        for (const b of s.boxes) if (q.x > b.x0 && q.x < b.x1 && q.y > b.y0 && q.y < b.y1 && q.z > b.z0 && q.z < b.z1) out.push(s.type + '@' + f.toFixed(2));
        if (!(s.fov >= 14 && s.fov <= 65)) out.push('fov ' + s.fov);
      }
      return out;
    });
    check(!bad.length, `${f}: camera outside the blank and the vice at 161 sampled times, fov in 14–65°`, bad.slice(0, 5).join(', '));
  }
  check(new Set(seen.values()).size === seen.size, 'every program gets its own film');
  await p.context().close();
}

/* ---------- 2. playing, closing, giving everything back ---------- */
{
  const p = await page();
  await openPgm(p, '07_HELIX_BORE.H');
  /* a state that is not the default: half-way through the run, the view turned, speed 16x */
  const before = await p.evaluate(() => {
    const ui = TNC_UI, S = ui.state, sc = document.getElementById('scrub');
    sc.value = '437'; sc.dispatchEvent(new Event('input', { bubbles: true }));
    S.speed = 16; ui.camera.position.set(140.25, -201.5, 166.75); ui.controls.target.set(31, 44.5, -7); ui.camera.lookAt(ui.controls.target);
    return { t: S.t, speed: S.speed, ovr: S.ovr, running: S.running, mode: S.mode };
  });
  await frames(p, 3);
  const cam0 = await p.evaluate(() => ({ p: TNC_UI.camera.position.toArray(), q: TNC_UI.camera.quaternion.toArray(), t: TNC_UI.controls.target.toArray(), fov: TNC_UI.camera.fov }));
  check(await p.evaluate(() => TNC_CINE.available()), 'available() with a program loaded');
  check(await p.evaluate(() => TNC_CINE.open({ speed: 8 })), 'open() takes over the view');
  check(await p.locator('.cine[role=dialog]').count() === 1, 'the letterboxed player is shown');
  await p.waitForTimeout(2500);
  const mid = await p.evaluate(() => ({ playing: TNC_CINE.playing, d: TNC_CINE.debug(), running: TNC_UI.state.running }));
  check(mid.playing && mid.d.f > 0.5, `the film plays (film ${mid.d.f.toFixed(1)} s, program ${mid.d.progT.toFixed(1)} s)`);
  check(mid.d.progT < before.t || mid.d.f < 4.4, 'the program re-runs from the start');
  /* the live camera stays out of the blank and the vice while it plays */
  const live = await p.evaluate(async () => {
    const out = []; const film = TNC_CINE.film(); const boxes = TNC_CINE.sample(0).boxes;
    for (let k = 0; k < 25; k++) {
      await new Promise(r => setTimeout(r, 120));
      const c = TNC_UI.camera.position;
      for (const b of boxes) if (c.x > b.x0 && c.x < b.x1 && c.y > b.y0 && c.y < b.y1 && c.z > b.z0 && c.z < b.z1) out.push(TNC_CINE.debug().f.toFixed(2));
    }
    return { out, len: film.len };
  });
  check(!live.out.length, 'live camera outside the blank and the vice while playing', live.out.join(','));
  check(await p.evaluate(() => window.__ac) === 0, 'sound off: no AudioContext is made');
  /* skip to the hero orbit: the program has run to its end */
  await p.evaluate(() => { const f = TNC_CINE.film(); TNC_CINE.seek(f.shots[f.shots.length - 1].f0 + 0.5); });
  await p.waitForTimeout(600);
  const hero = await p.evaluate(() => ({ d: TNC_CINE.debug(), t: TNC_UI.state.t, total: TNC_UI.state.total, n: TNC_CINE.film().shots.length }));
  check(hero.d.shot === hero.n - 1 && Math.abs(hero.t - hero.total) < 1e-9, 'the hero orbit shows the finished part (program at its end)');
  await p.evaluate(() => TNC_CINE.close());
  await frames(p, 4);
  const after = await p.evaluate(() => { const S = TNC_UI.state; return { t: S.t, speed: S.speed, ovr: S.ovr, running: S.running, mode: S.mode,
    p: TNC_UI.camera.position.toArray(), q: TNC_UI.camera.quaternion.toArray(), tg: TNC_UI.controls.target.toArray(), fov: TNC_UI.camera.fov, open: !!document.querySelector('.cine') }; });
  check(!after.open, 'close() removes the player');
  const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= e * Math.max(1, Math.abs(b[i])));
  check(near(after.p, cam0.p) && near(after.q, cam0.q) && near(after.tg, cam0.t) && after.fov === cam0.fov, 'close() restores the camera position, rotation, target and fov exactly',
    JSON.stringify({ after: [after.p, after.tg], before: [cam0.p, cam0.t] }));
  check(after.speed === before.speed && after.ovr === before.ovr && after.mode === before.mode && after.running === before.running, 'close() restores speed, override, mode and run/hold');
  check(Math.abs(after.t - before.t) <= 1e-9 * Math.max(1, before.t), `close() restores the run position (${before.t.toFixed(6)} -> ${after.t.toFixed(6)})`);

  /* Esc closes; a running machine is running again afterwards */
  await p.evaluate(() => { TNC_UI.state.mode = 'test'; const sc = document.getElementById('scrub'); sc.value = '100'; sc.dispatchEvent(new Event('input', { bubbles: true })); TNC_UI.exec('start'); });
  await p.evaluate(() => TNC_CINE.open({ speed: 4 }));
  await p.waitForTimeout(800);
  await p.keyboard.press('Space');
  check(await p.evaluate(() => !TNC_CINE.playing), 'Space pauses the film');
  await p.keyboard.press('Space');
  check(await p.evaluate(() => TNC_CINE.playing), 'Space plays it again');
  await p.keyboard.press('Escape');
  await frames(p, 2);
  check(await p.evaluate(() => !document.querySelector('.cine') && !TNC_CINE.playing), 'Esc closes the replay');
  check(await p.evaluate(() => TNC_UI.state.running), 'a run that was going is going again after close');
  await p.evaluate(() => TNC_UI.exec('stop'));
  await p.context().close();
}

/* ---------- 3. sound on: the graph exists; reduced motion: gentle film ---------- */
{
  const p = await page({ sound: true, motion: 'reduced' });
  await openPgm(p, '14_MULTI_TOOL.H');
  const film = await p.evaluate(() => TNC_CINE.film());
  check(film.shots.every(s => s.trans !== 'whip' && s.type !== 'vertigo'), 'reduced motion: no whip pans, no dolly zoom');
  check(film.shots.slice(1).every(s => s.trans === 'dip'), 'reduced motion: every cut dips through black');
  await p.evaluate(() => TNC_CINE.open({ speed: 6 }));
  await p.waitForTimeout(1200);
  check(await p.evaluate(() => window.__ac >= 1 && TNC_CINE.debug().audio), 'sound on: the synthesised sound graph is made');
  await p.click('.cine [data-a=close]');
  check(await p.evaluate(() => !document.querySelector('.cine')), 'the close control closes the replay');
  await p.context().close();
}

await browser.close();
check(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
