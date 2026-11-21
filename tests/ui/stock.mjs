#!/usr/bin/env node
/* How the stock is drawn (sim/stockview.js): node tests/ui/stock.mjs   (needs index.html: python3 build.py)
 *
 * Runs tests/ui/fx/STOCK45.H (300 x 200 plate: a 45 deg engraved N, a pocket, a ball groove) at MAX speed and measures:
 *   1. no staircase: a top-down close-up of the N's 45 deg diagonal; per pixel row the sub-pixel position of the
 *      strongest luminance edge near the projected wall, a fitted line, the RMS of the residuals (px). The old drawing
 *      (the engine grid painted with vertex colours) measured 4.00 px RMS / 7.65 px peak here (this drawing: 0.86 / 1.5); the bound is 1.2 px.
 *   2. the cut floor is not the old cyan: HSV saturation < 0.18 (old: 0.36; now 0.04), and it differs from the raw top face.
 *   3. cost: the stock's triangles at high quality stay under 600k (238k here; the full grid at x3 would be 1.9M), low < medium
 *      < high in display resolution, and a frame (1280 x 800, swiftshader) stays under STOCK_FRAME_MS (default 6000:
 *      a loaded box; here 0.5-2.2 s depending on load, the same as the old drawing measured interleaved in one browser).
 *   4. no page errors.
 * STOCK_SIM=<path to an index.html> measures another build (prints the numbers; to record the old values).
 * Playwright: `playwright` from node_modules, or PLAYWRIGHT_MODULE=<path>; PW_CHROMIUM=<chrome>. Shots: local/stock-shots/. */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const SIM = process.env.STOCK_SIM || join(ROOT, 'index.html');
const SHOTS = join(ROOT, 'local', 'stock-shots'); mkdirSync(SHOTS, { recursive: true });
const PROG = readFileSync(join(ROOT, 'tests', 'ui', 'fx', 'STOCK45.H'), 'utf8');
const FRAME_MS = +(process.env.STOCK_FRAME_MS || 6000);
let failures = 0; const errors = [];
const check = (c, m) => { if (!c) failures++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); };

const browser = await pw.chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(quality) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', e => errors.push(`${quality} pageerror: ${e.message}`));
  await page.addInitScript(q => { try { const s = JSON.parse(localStorage.getItem('tnc.settings.v1') || '{}'); s.v = 1; s.quality = q; s.setup = 1; localStorage.setItem('tnc.settings.v1', JSON.stringify(s)); } catch {} }, quality);
  await page.goto(pathToFileURL(SIM).href);
  await page.waitForFunction(() => window.TNC_UI && TNC_UI.state && TNC_UI.state.res, null, { timeout: 30000 });
  if (await page.locator('#setup:not([hidden])').count()) await page.click('#setup-skip');
  await page.evaluate(t => TNC_UI.open('STOCK45.H', t), PROG);
  await page.waitForFunction(() => TNC_UI.state.res && TNC_UI.state.res.stock && TNC_UI.state.res.stock.x1 === 300);
  await page.evaluate(() => { TNC_UI.state.speed = 0; TNC_UI.exec('start'); });   // MAX: the whole program at once
  await page.waitForFunction(() => TNC_UI.runState().done);
  await page.waitForTimeout(600);                                                     // the throttled repaint
  return page;
}
/* a still frame without toolpath lines, comet, labels: only surfaces */
async function frame(page, cam, tgt) {
  return page.evaluate(([cam, tgt]) => {
    TNC_UI.scene.traverse(o => { if (o.isLine || o.isLineSegments || o.isPoints || o.isSprite) o.visible = false; });
    document.querySelectorAll('.co, [class*="callout"], .vlab').forEach(e => { e.style.visibility = 'hidden'; });
    const C = TNC_UI.camera, T = TNC_UI.controls.target; C.position.set(...cam); T.set(...tgt); TNC_UI.controls.update(); C.updateMatrixWorld();
    const r = TNC_UI.renderer.domElement.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, [cam, tgt]);
}
const project = (page, pts) => page.evaluate(pts => { const THREE = TNC_UI.THREE, C = TNC_UI.camera, r = TNC_UI.renderer.domElement.getBoundingClientRect();
  return pts.map(p => { const v = new THREE.Vector3(...p).project(C); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; }); }, pts);
/* the screenshot's pixels (RGBA) through a canvas in the page itself */
async function pixels(page, rect, name) {
  const png = await page.screenshot({ clip: rect, path: join(SHOTS, name) });
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
  }, png.toString('base64'));
}
const lum = (P, x, y) => { const k = (y * P.w + x) * 4; return .2126 * P.d[k] + .7152 * P.d[k + 1] + .0722 * P.d[k + 2]; };
function hsv(P, x, y, r = 3) {                    // mean colour of a small patch -> saturation, value
  let R = 0, G = 0, B = 0, n = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const k = ((y + j) * P.w + x + i) * 4; R += P.d[k]; G += P.d[k + 1]; B += P.d[k + 2]; n++; }
  R /= n; G /= n; B /= n; const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  return { s: mx > 0 ? (mx - mn) / mx : 0, v: mx / 255, rgb: [R, G, B].map(Math.round) };
}

/* ---------- 1 + 2 + 4 at high ---------- */
const page = await open('high');
const rect = await frame(page, [125, 104.95, 38], [125, 105, -1]);
const P = await pixels(page, rect, (process.env.STOCK_SIM ? 'other-' : '') + 'test-diagonal-top.png');
/* the N's diagonal runs (100,130) -> (150,80), tool R 1.5: its upper-right wall is the centre line + 1.5 along (1,1)/sqrt2 */
const s2 = Math.SQRT1_2, wall = [], N = 40;
for (let k = 0; k <= N; k++) { const t = 0.3 + 0.4 * k / N; wall.push([100 + 50 * t + 1.5 * s2, 130 - 50 * t + 1.5 * s2, -0.5]); }
const W = await project(page, wall);
const rows = [];
for (let k = 0; k < W.length - 1; k++) {
  const [xa, ya] = W[k], [xb, yb] = W[k + 1];
  for (let y = Math.ceil(Math.min(ya, yb)); y < Math.max(ya, yb); y++) {
    if (y < 2 || y >= P.h - 2) continue;
    const xe = xa + (xb - xa) * (y - ya) / (yb - ya), x0 = Math.max(2, Math.round(xe - 7)), x1 = Math.min(P.w - 3, Math.round(xe + 7));
    let best = -1, bx = -1;
    for (let x = x0; x <= x1; x++) { const g = Math.abs(lum(P, x + 1, y) - lum(P, x - 1, y)); if (g > best) { best = g; bx = x; } }
    if (bx <= x0 || bx >= x1) continue;
    const gm = Math.abs(lum(P, bx, y) - lum(P, bx - 2, y)), gp = Math.abs(lum(P, bx + 2, y) - lum(P, bx, y)), den = gm - 2 * best + gp;
    rows.push([y, bx + (den ? 0.5 * (gm - gp) / den : 0)]);
  }
}
let rms = Infinity, peak = Infinity;
if (rows.length > 20) {
  const n = rows.length, sy = rows.reduce((a, r) => a + r[0], 0), sx = rows.reduce((a, r) => a + r[1], 0);
  const syy = rows.reduce((a, r) => a + r[0] * r[0], 0), sxy = rows.reduce((a, r) => a + r[0] * r[1], 0);
  const a = (n * sxy - sy * sx) / (n * syy - sy * sy), b = (sx - a * sy) / n, res = rows.map(r => r[1] - (a * r[0] + b));
  rms = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / n); peak = Math.max(...res.map(Math.abs));
}
console.log(`     diagonal wall: ${rows.length} rows, RMS ${rms.toFixed(2)} px, peak ${peak.toFixed(2)} px (old drawing: 4.00 / 7.65)`);
check(rows.length > 60, `diagonal wall found in ${rows.length} pixel rows`);
check(rms < 1.2, `45 deg engraved wall is straight: RMS deviation ${rms.toFixed(2)} px < 1.2 (no staircase)`);

const [cFloor, cTop] = await project(page, [[125, 105, -1], [125, 118, 0]]);
const fl = hsv(P, Math.round(cFloor[0]), Math.round(cFloor[1])), tp = hsv(P, Math.round(cTop[0]), Math.round(cTop[1]));
console.log(`     floor rgb ${fl.rgb} s=${fl.s.toFixed(3)} v=${fl.v.toFixed(3)} · top rgb ${tp.rgb} s=${tp.s.toFixed(3)} v=${tp.v.toFixed(3)}`);
check(fl.s < 0.18, `cut floor is metal, not cyan: saturation ${fl.s.toFixed(3)} < 0.18`);
check(Math.abs(fl.v - tp.v) > 0.02 || Math.abs(fl.s - tp.s) > 0.02, `cut floor differs from the raw top face (value ${fl.v.toFixed(3)} vs ${tp.v.toFixed(3)})`);

/* ---------- 3: cost ---------- */
const cost = await page.evaluate(async () => {
  const R = TNC_UI.renderer, gl = R.getContext(), px = new Uint8Array(4);
  const f = () => { if (TNC_UI.render) TNC_UI.render(); else R.render(TNC_UI.scene, TNC_UI.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  TNC_UI.cameraPreset('part'); await new Promise(r => setTimeout(r, 200));
  f(); const ts = []; for (let i = 0; i < 5; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b);
  const V = window.TNC_STOCKVIEW && TNC_STOCKVIEW.current;
  return { ms: ts[2], tris: V ? V.triangles : null, factor: V ? V.factor : null };
});
console.log(`     high: display factor ${cost.factor}, ${cost.tris} stock triangles, frame ${cost.ms.toFixed(0)} ms`);
check(cost.tris != null && cost.tris < 600000, `stock triangles at high ${cost.tris} < 600000`);
check(cost.ms < FRAME_MS, `frame ${cost.ms.toFixed(0)} ms < ${FRAME_MS} ms (1280 x 800, swiftshader)`);
await page.context().close();

const fac = {};
for (const q of ['medium', 'low']) {
  const p = await open(q);
  fac[q] = await p.evaluate(() => { const V = window.TNC_STOCKVIEW && TNC_STOCKVIEW.current; return V ? { f: V.factor, n: V.grid.NX * V.grid.NY } : null; });
  await p.context().close();
}
console.log(`     display nodes: low ${fac.low && fac.low.n}, medium ${fac.medium && fac.medium.n}, high factor ${cost.factor}`);
check(fac.low && fac.medium && fac.low.f < fac.medium.f && fac.medium.f < cost.factor, `quality scales the display field: low x${fac.low && fac.low.f} < medium x${fac.medium && fac.medium.f} < high x${cost.factor}`);

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
