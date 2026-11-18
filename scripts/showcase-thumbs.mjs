#!/usr/bin/env node
// showcase-thumbs.mjs - real thumbnails of the showcase programs: each one is opened in the built simulator, run to
// its end at MAX speed and the 3-D view of the machined result is saved as examples/showcase/thumbs/<name in kebab-case>.png (640 x 400).
//   node scripts/showcase-thumbs.mjs                     all sixteen, from index.html (run python build.py first)
//   node scripts/showcase-thumbs.mjs --only 05,16        only the programs whose name starts with 05 or 16
//   node scripts/showcase-thumbs.mjs --page <file.html>  another build of the simulator
// It depends only on window.TNC_UI (open, state, renderer, scene, camera, render) and on keys from docs/MANUAL.md:
// ESC (close a dialog), 4 (FULL-RUN), 9 (speed MAX), SPACE (NC START). No toolbar or layout selectors, so it keeps
// working while the interface is redesigned. The picture is the WebGL canvas itself (no HTML overlays), with the
// simulator's own camera moved to frame the blank, drawn centred onto 640 x 400. Browser: Playwright's pinned Chromium, else PW_CHROMIUM=<chrome executable>, else any
// complete Chromium under PLAYWRIGHT_BROWSERS_PATH. Exit code 1 when a program does not finish or a picture is blank.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'examples', 'showcase');
const W = 640, H = 400;
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PAGE = resolve(arg('--page') || join(ROOT, 'index.html'));
const only = (arg('--only') || '').split(',').filter(Boolean);
if (!existsSync(PAGE)) { console.error('showcase-thumbs: ' + PAGE + ' is missing: run python build.py'); process.exit(1); }

async function launch() {
  const args = ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const tries = [undefined, process.env.PW_CHROMIUM];
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (cache && existsSync(cache)) for (const d of readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse())
    for (const sub of ['chrome-win64', 'chrome-win', 'chrome-linux', 'chrome-mac/Chromium.app/Contents/MacOS']) for (const exe of ['chrome.exe', 'chrome', 'Chromium'])
      if (existsSync(join(cache, d, 'INSTALLATION_COMPLETE')) && existsSync(join(cache, d, sub, exe))) tries.push(join(cache, d, sub, exe));
  let lastErr;
  for (const executablePath of tries) {
    if (executablePath !== undefined && !(executablePath && existsSync(executablePath))) continue;
    try { return { browser: await chromium.launch({ args, ...(executablePath ? { executablePath } : {}) }), exe: executablePath || chromium.executablePath() }; }
    catch (e) { lastErr = e; }
  }
  throw new Error('no Chromium could be started (set PW_CHROMIUM=<chrome executable>): ' + String(lastErr?.message).split('\n')[0]);
}

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const list = manifest.programs.filter((p) => !only.length || only.some((o) => p.id.startsWith(o)));
mkdirSync(join(DIR, 'thumbs'), { recursive: true });
const { browser, exe } = await launch();
console.log('showcase-thumbs: ' + PAGE + '\n  browser ' + exe);
let bad = 0;
for (const p of list) {
  // a fresh context per program: no profile, no stored programs, the same start for every picture
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = []; page.on('pageerror', (e) => logs.push(String(e.message)));
  try {
    await page.goto(pathToFileURL(PAGE).href);
    await page.waitForFunction(() => typeof window.TNC_UI?.open === 'function' && window.TNC_UI.state?.res, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(120); }      // first-visit dialogs
    const text = readFileSync(join(DIR, p.file), 'utf8');
    const opened = await page.evaluate(({ name, text, machine, tools }) => window.TNC_UI.open(name, text, { machine, tools }), { name: p.file, text, machine: p.machine, tools: p.tools });
    await page.waitForFunction((t) => window.TNC_UI.state.text === t && window.TNC_UI.state.total > 0, text, { timeout: 30000 });
    const errors = await page.evaluate(() => (window.TNC_UI.state.res?.errors || []).map((e) => 'block ' + e.block + ': ' + e.msg));
    if (errors.length) throw new Error('the simulator reports errors: ' + errors.slice(0, 3).join('; '));
    const done = () => page.evaluate(() => { const s = window.TNC_UI.state; return s.total > 0 && s.t >= s.total - 1e-6; });
    for (let attempt = 0; attempt < 3 && !(await done()); attempt++) {
      await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
      await page.keyboard.press('Escape'); await page.keyboard.press('4'); await page.keyboard.press('9'); await page.keyboard.press('Space');
      await page.waitForFunction(() => { const s = window.TNC_UI.state; return s.total > 0 && s.t >= s.total - 1e-6; }, null, { timeout: 60000 }).catch(() => {});
    }
    if (!(await done())) throw new Error('the run did not reach the end (t ' + (await page.evaluate(() => window.TNC_UI.state.t)) + ')');
    await page.waitForTimeout(1200);                         // the height field is repainted on the next frames
    const shot = await page.evaluate(({ W, H, st, view }) => {
      const ui = window.TNC_UI, src = ui.renderer.domElement, cam = ui.camera;
      const k = Math.max(W / src.width, H / src.height), w = src.width * k, h = src.height * k;        // cover, centred
      /* frame the blank: its bounding sphere must fit the part of the view that survives the crop to W x H */
      const cx = (st.x[0] + st.x[1]) / 2, cy = (st.y[0] + st.y[1]) / 2, cz = (st.z[0] + st.z[1]) / 2;
      const R = Math.hypot(st.x[1] - st.x[0], st.y[1] - st.y[0], st.z[1] - st.z[0]) / 2;
      const tv = Math.tan((cam.fov * Math.PI / 180) / 2), aspect = src.width / src.height;
      const half = Math.min(Math.atan(tv * (H / k) / src.height), Math.atan(tv * aspect * (W / k) / src.width));
      const d = 1.06 * R / Math.sin(half), dir = view || [-0.5, -0.72, 0.62], n = Math.hypot(...dir);   // from the front left, above; manifest thumbnailView overrides
      cam.position.set(cx + d * dir[0] / n, cy + d * dir[1] / n, cz + d * dir[2] / n);
      if (ui.controls?.target) { ui.controls.target.set(cx, cy, cz); ui.controls.update(); }
      cam.position.set(cx + d * dir[0] / n, cy + d * dir[1] / n, cz + d * dir[2] / n); cam.lookAt(cx, cy, cz); cam.updateMatrixWorld();
      if (ui.render) ui.render(ui.scene, cam); else ui.renderer.render(ui.scene, cam);                 // same task as the copy below: the buffer is still there
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      x.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
      const px = x.getImageData(0, 0, W, H).data; const seen = new Set();
      for (let i = 0; i < px.length; i += 4 * 97) seen.add((px[i] >> 3) + ',' + (px[i + 1] >> 3) + ',' + (px[i + 2] >> 3));
      const s = ui.state;
      return { png: c.toDataURL('image/png'), colours: seen.size, canvas: [src.width, src.height], events: (s.events || []).filter((e) => e.sev === 'crash').length, machine: s.machine, pgm: s.pgm };
    }, { W, H, st: p.stock, view: p.thumbnailView || null });
    if (shot.colours < 12) throw new Error('the picture is blank (' + shot.colours + ' colours)');
    if (shot.events) throw new Error('the simulator shows ' + shot.events + ' crash event(s)');
    if (shot.machine !== p.machine) throw new Error('machine is ' + shot.machine + ', wanted ' + p.machine);
    writeFileSync(join(DIR, p.thumbnail), Buffer.from(shot.png.split(',')[1], 'base64'));
    console.log('  ok    ' + p.thumbnail + '  (' + opened + ' on ' + shot.machine + ', canvas ' + shot.canvas.join(' x ') + ', ' + shot.colours + ' colours)');
  } catch (e) { bad++; console.log('  FAIL  ' + p.file + ': ' + String(e.message).split('\n')[0] + (logs.length ? ' | page errors: ' + logs.slice(0, 2).join(' | ') : '')); }
  await ctx.close();
}
await browser.close();
console.log(bad ? `showcase-thumbs: ${bad} of ${list.length} FAILED` : `showcase-thumbs: ${list.length} thumbnails in ${join(DIR, 'thumbs')}`);
process.exit(bad ? 1 : 0);
