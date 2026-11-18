#!/usr/bin/env node
/* Text contrast of the Play landing, measured against the pixels that are really behind the text.
 *
 *   npm run build:play && node tests/e2e/landing-contrast.mjs
 *
 * For each background (the film at eight moments of its loop, the poster when the film files answer 404,
 * the drawn grid when the poster is missing too) and each size (1920x1080, 390x844): the text is made
 * transparent, the page is photographed, and every pixel inside every line box of text is compared with
 * that text's own colour (WCAG 2 contrast ratio). Reported per element: the lowest ratio of any pixel and
 * the ratio the worst 1 % of pixels stay above; the check is on the worst 1 %, so one stray pixel of a
 * ruled line does not decide it. Needed: 3 for large text (24 px, or 18.66 px bold), 4.5 for the rest.
 * Screenshots (with text): artifacts/play/landing-*.png
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { checks, launch, requireBuild, serve, shots } from './lib.mjs';

const dir = requireBuild('play');
const c = checks('play landing: text contrast against the film, the poster and the grid');
const server = await serve(dir);
const { browser } = await launch();
const out = shots('play');
const MOMENTS = [0.04, 0.17, 0.3, 0.43, 0.56, 0.69, 0.82, 0.95];
const SIZES = [
  { w: 1920, h: 1080 },
  { w: 390, h: 844 },
];
const HIDE = '.land-frame, .land-frame * { color: transparent !important; -webkit-text-stroke-color: transparent !important; text-decoration-color: transparent !important; caret-color: transparent !important; }';

/** every run of text on the landing that is on screen now: its line boxes, its colour, whether it counts as large */
const collect = () => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    return [...g.getImageData(0, 0, 1, 1).data];
  };
  const items = [];
  const walker = document.createTreeWalker(document.querySelector('.land-frame'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const el = n.parentElement;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth).map((r) => [Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)]);
    if (!rects.length) continue;
    // outlined letters (transparent fill, a stroke) are read by their stroke
    const fill = rgba(cs.color);
    const colour = fill[3] === 0 ? rgba(cs.webkitTextStrokeColor) : fill;
    const px = parseFloat(cs.fontSize);
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    items.push({ what: `${el.closest('[class]')?.className.split(' ')[0] ?? el.tagName} "${n.data.trim().slice(0, 22)}"`, rects, colour, large: px >= 24 || (px >= 18.66 && bold), px });
  }
  return items;
};

/** runs in a blank page: the photograph as a data URL, the items from collect() */
const measureIn = async ({ png, items }) => {
  const img = new Image();
  img.src = png;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const lin = (v8) => {
    const v = v8 / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  return items.map((it) => {
    const ratios = [];
    const [tr, tg, tb, ta] = it.colour;
    const a = ta / 255;
    for (const [x, y, w, h] of it.rects) {
      const d = g.getImageData(x, y, Math.min(w, cv.width - x), Math.min(h, cv.height - y)).data;
      for (let i = 0; i < d.length; i += 4) {
        const bg = lum(d[i], d[i + 1], d[i + 2]);
        // a half-transparent text colour is seen mixed with what is behind it
        const fg = lum(tr * a + d[i] * (1 - a), tg * a + d[i + 1] * (1 - a), tb * a + d[i + 2] * (1 - a));
        ratios.push((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05));
      }
    }
    ratios.sort((p, q) => p - q);
    return { what: it.what, large: it.large, px: it.px, min: ratios[0], p01: ratios[Math.floor(ratios.length * 0.01)], n: ratios.length };
  });
};

/** photograph the landing without its text at every scroll position and measure all text on it */
async function measure(page, lab) {
  const worst = new Map();
  const steps = await page.evaluate(() => { const l = document.querySelector('.land'); return Math.max(1, Math.ceil((l.scrollHeight - l.clientHeight) / (l.clientHeight * 0.7)) + 1); });
  for (let i = 0; i < steps; i++) {
    await page.evaluate((k) => { const l = document.querySelector('.land'); l.scrollTop = k * l.clientHeight * 0.7; }, i);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const items = await page.evaluate(collect);
    const style = await page.addStyleTag({ content: HIDE });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const png = 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
    await style.evaluate((s) => s.remove());
    for (const r of await lab.evaluate(measureIn, { png, items })) {
      const old = worst.get(r.what);
      if (!old || r.p01 < old.p01) worst.set(r.what, r);
    }
  }
  await page.evaluate(() => (document.querySelector('.land').scrollTop = 0));
  return [...worst.values()];
}

const table = [];
function judge(name, results) {
  const body = results.filter((r) => !r.large);
  const large = results.filter((r) => r.large);
  const low = (list) => list.reduce((m, r) => (r.p01 < m.p01 ? r : m), { p01: Infinity, min: Infinity, what: 'none' });
  const b = low(body);
  const l = low(large);
  const bad = results.filter((r) => r.p01 < (r.large ? 3 : 4.5));
  table.push({ name, body: b, large: l });
  c.ok(bad.length === 0 && results.length >= 12, `${name}: body text >= 4.5 (lowest ${b.p01.toFixed(2)}, ${b.what}), large text >= 3 (lowest ${l.p01.toFixed(2)}, ${l.what})`, bad.map((r) => `${r.what} ${r.p01.toFixed(2)} (min ${r.min.toFixed(2)}, ${r.px}px${r.large ? ' large' : ''})`).join(' | '));
}

try {
  const labCtx = await browser.newContext();
  const lab = await labCtx.newPage();
  for (const { w, h } of SIZES) {
    const size = `${w}x${h}`;
    /* ---- the film ---- */
    {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      const page = await ctx.newPage();
      await page.goto(server.url + '/play');
      await page.waitForSelector('.land-start');
      const film = await page.waitForSelector('.land[data-film="ok"]', { timeout: 15000 }).then(() => true, () => false);
      c.ok(film, `${size}: the film plays (data-film="ok")`);
      if (film) {
        await page.waitForTimeout(900); // the fade to the film has ended
        const info = await page.evaluate(() => { const v = document.querySelector('.land-video'); return { dur: v.duration, src: v.currentSrc.split('/').pop(), video: getComputedStyle(v).opacity, poster: getComputedStyle(document.querySelector('.land-poster')).opacity }; });
        c.ok(info.video === '0.72' && info.poster === '0', `${size}: the film is at 0.72, the poster hidden behind it (${info.src}, ${info.dur.toFixed(1)} s)`, JSON.stringify(info));
        const frames = new Set();
        const times = [];
        for (const m of MOMENTS) {
          // the film is played up to the moment and held there (the test server has no byte ranges, so no seeking)
          const at = await page.evaluate(async (t) => {
            const v = document.querySelector('.land-video');
            if (v.currentTime > t) v.currentTime = 0;
            await v.play();
            await new Promise((ok) => { const tick = () => (v.currentTime >= t ? ok() : requestAnimationFrame(tick)); tick(); });
            v.pause();
            return v.currentTime;
          }, m * info.dur);
          await page.waitForTimeout(120);
          times.push(at);
          // the film's own frame (not the page: the grid under it moves too)
          frames.add(createHash('sha1').update(await page.evaluate(() => { const v = document.querySelector('.land-video'); const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90; const g = cv.getContext('2d'); g.drawImage(v, 0, 0, 160, 90); return Array.from(g.getImageData(0, 0, 160, 90).data).join(','); })).digest('hex'));
          judge(`${size} film at ${at.toFixed(1)} s`, await measure(page, lab));
          if (m === MOMENTS[3]) await page.screenshot({ path: join(out, `landing-film-${size}.png`) });
        }
        c.ok(frames.size === MOMENTS.length && times.every((t, i) => Math.abs(t - MOMENTS[i] * info.dur) < 0.5), `${size}: the ${MOMENTS.length} moments are ${frames.size} different film frames, spread over the loop`, times.map((t) => t.toFixed(2)).join(" "));
      }
      await ctx.close();
    }
    /* ---- no film: the poster; no poster either: the drawn grid ---- */
    for (const [name, block] of [['poster', /\/play\/hero\.(mp4|webm)$/], ['grid', /\/play\/hero[.-]/]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await ctx.route(block, (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(server.url + '/play');
      await page.waitForSelector('.land-start');
      await page.waitForSelector('.land[data-film="none"]', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      const st = await page.evaluate(() => ({ film: document.querySelector('.land').dataset.film, video: document.querySelectorAll('video').length, poster: (() => { const i = document.querySelector('.land-poster'); return i ? i.naturalWidth : 0; })(), pause: document.querySelectorAll('.land-tools > .land-ctl').length, grid: document.querySelector('.land-grid').getBoundingClientRect().width }));
      c.ok(st.film === 'none' && st.video === 0 && st.pause === 0 && errors.length === 0, `${size} film files 404: no film element, no pause control, no page error`, JSON.stringify(st) + errors.join(' | '));
      c.ok(name === 'poster' ? st.poster > 0 : st.poster === 0 && st.grid >= w, `${size} ${name === 'poster' ? 'the poster is the background' : 'poster missing too: the drawn grid is the background'}`, JSON.stringify(st));
      const box = await page.locator('.land-start').boundingBox();
      c.ok(box && box.y + box.height <= h && (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)), `${size} ${name}: START on the first screen, no sideways scroll`);
      judge(`${size} ${name} (no film)`, await measure(page, lab));
      await page.screenshot({ path: join(out, `landing-${name}-fallback-${size}.png`) });
      await ctx.close();
    }
  }
  await labCtx.close();
  console.log('\n  lowest contrast ratio of the worst 1 % of pixels behind the text (and the single lowest pixel)');
  for (const t of table) console.log(`    ${t.name.padEnd(30)} body ${t.body.p01.toFixed(2)} (${t.body.min.toFixed(2)})  large ${t.large.p01.toFixed(2)} (${t.large.min.toFixed(2)})`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(c.done());
