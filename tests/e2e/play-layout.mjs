#!/usr/bin/env node
/* Layout of the Play landing, the workshop HUD and the Business shell on a 5120x1440 ultrawide and at
 * 1440x900, and the three quality tiers of the workshop.
 *
 *   npm run build:play && npm run build:business && node tests/e2e/play-layout.mjs
 *   node tests/e2e/play-layout.mjs --measure      also frame times per tier at 1920x1080 on the machine's GPU
 *
 * "Not stretched": a picture keeps its aspect (object-fit: cover, a drawing buffer with the ratio of its
 * box). "Not lost": every named control has a size and lies inside the screen. Panels keep their widths
 * instead of growing with the screen. Screenshots: artifacts/play/*-<size>.png, artifacts/business/shell-<size>.png
 */
import { join } from 'node:path';
import { checks, launch, requireBuild, serve, shots } from './lib.mjs';

const play = requireBuild('play');
const business = requireBuild('business');
const c = checks('layout: ultrawide 5120x1440, 1440x900, quality tiers');
const measure = process.argv.includes('--measure');
const { browser } = await launch(measure ? ['--use-angle=d3d11', '--enable-gpu'] : []);
const outPlay = shots('play');
const outBusiness = shots('business');
const SIZES = [
  { w: 5120, h: 1440 },
  { w: 1440, h: 900 },
];

/** the named elements that are missing, empty or (partly) outside the screen */
const lost = (page, selectors) =>
  page.evaluate((sels) => {
    const bad = [];
    for (const s of sels) {
      const els = [...document.querySelectorAll(s)];
      if (!els.length) bad.push(s + ' missing');
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) bad.push(s + ' empty');
        else if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) bad.push(`${s} outside (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    }
    return bad;
  }, selectors);
const box = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }, sel);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.body.scrollWidth <= innerWidth);
/** a canvas whose drawing buffer has the same ratio as its box is not stretched */
const canvasRatio = (frame, sel) => frame.evaluate((s) => { const cv = document.querySelector(s); const r = cv.getBoundingClientRect(); return { buffer: cv.width / cv.height, box: r.width / r.height, w: r.width, h: r.height }; }, sel);
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function context(w, h, init) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (init) await ctx.addInitScript(init.fn, init.arg);
  return ctx;
}

let server = await serve(play);
try {
  for (const { w, h } of SIZES) {
    const size = `${w}x${h}`;
    const ctx = await context(w, h);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    /* ---- landing ---- */
    await page.goto(server.url + '/play');
    await page.waitForSelector('.land-start');
    await page.waitForSelector('.land[data-film="ok"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    let bad = await lost(page, ['.land-badge', '.land-lang .land-ctl', '.land-hero h1 span', '.land-hero p', '.land-start', '.land-cells li', '.land-foot span']);
    c.ok(bad.length === 0 && (await noSideScroll(page)), `${size} landing: every part is on the first screen, no sideways scroll`, bad.join(' | '));
    const frame = await box(page, '.land-frame');
    const start = await box(page, '.land-start');
    const lead = await box(page, '.land-hero p');
    c.ok(frame.w <= 1440 && Math.abs(frame.x - (w - frame.w) / 2) <= 1 && start.w <= 620 && lead.w <= 620, `${size} landing: the frame stays ${Math.round(frame.w)} px wide and centred, START ${Math.round(start.w)} px (not stretched over the screen)`, JSON.stringify({ frame, start, lead }));
    const bg = await page.evaluate(() => {
      const v = document.querySelector('.land-video') ?? document.querySelector('.land-poster');
      const r = v.getBoundingClientRect();
      const f = document.querySelector('.land-frame').getBoundingClientRect();
      const shade = getComputedStyle(document.querySelector('.land-shade'), '::before');
      // where the dark plate behind the headline ends, as a share of the frame's width
      const edge = innerWidth - parseFloat(shade.right);
      return { w: r.width, h: r.height, fit: getComputedStyle(v).objectFit, plateEnds: (edge - f.left) / f.width, h1Right: (document.querySelector('.land-hero h1 span').getBoundingClientRect().right - f.left) / f.width };
    });
    c.ok(bg.w === w && bg.h === h && bg.fit === 'cover', `${size} landing: the film fills the screen and is cropped, not stretched`, JSON.stringify(bg));
    c.ok(bg.plateEnds >= 0.55 && bg.plateEnds <= 0.7, `${size} landing: the dark plate ends inside the frame, right of the lead text (at ${(bg.plateEnds * 100).toFixed(0)} % of the frame)`, JSON.stringify(bg));
    await page.screenshot({ path: join(outPlay, `landing-${size}.png`) });

    /* ---- workshop HUD ---- */
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shop-canvas', { timeout: 30000 });
    await page.waitForSelector('.ob');
    const ob = await box(page, '.ob');
    c.ok(ob.w <= 680 && Math.abs(ob.x + ob.w / 2 - w / 2) <= 1 && (await lost(page, ['.ob', '.ob .hud-btn'])).length === 0, `${size} introduction: ${Math.round(ob.w)} px wide, in the middle`, JSON.stringify(ob));
    await page.screenshot({ path: join(outPlay, `onboarding-${size}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    bad = await lost(page, ['.hud-rail', '.hud-rail .hud-btn', '.hud-status', '.hud-st', '.hud-hand', '.hud-bottom', '.hud-hint', '.shop-canvas', '.shop-cross']);
    c.ok(bad.length === 0 && (await noSideScroll(page)), `${size} workshop: rail, status, hint and canvas are all on screen`, bad.join(' | '));
    const cv = await canvasRatio(page, '.shop-canvas');
    c.ok(cv.w === w && cv.h === h && Math.abs(cv.buffer / cv.box - 1) < 0.01, `${size} workshop: the 3-D picture fills the screen with the right aspect (buffer ${cv.buffer.toFixed(3)}, box ${cv.box.toFixed(3)})`, JSON.stringify(cv));
    const status = await box(page, '.hud-status');
    const bottom = await box(page, '.hud-bottom');
    const cross = await box(page, '.shop-cross');
    c.ok(status.w === 268 && bottom.w <= 560 && Math.abs(bottom.x + bottom.w / 2 - w / 2) <= 1 && Math.abs(cross.x + cross.w / 2 - w / 2) <= 1, `${size} workshop: status ${status.w} px at the right edge, prompt strip ${bottom.w} px in the middle, crosshair in the middle`, JSON.stringify({ status, bottom, cross }));
    await page.screenshot({ path: join(outPlay, `workshop-hud-${size}.png`) });

    await page.locator('.hud-rail .hud-btn').first().click();
    const list = await box(page, '.pp-side .pp');
    c.ok(list.w <= 440 && Math.abs(list.x + list.w - w) <= 1 && list.h === h && (await lost(page, ['.st-list li h3', '.st-list .hud-btn'])).filter((x) => !/outside/.test(x)).length === 0, `${size} station list: a ${Math.round(list.w)} px sheet on the right edge, full height`, JSON.stringify(list));
    await page.screenshot({ path: join(outPlay, `panel-stations-${size}.png`) });
    await page.keyboard.press('Escape');
    await page.locator('.hud-rail .hud-btn').nth(2).click();
    const pc = await box(page, '.pc');
    bad = await lost(page, ['.pc', '.pc .seg', '.pc .seg button', '.pc .sec-list li']);
    c.ok(pc.w <= 680 && Math.abs(pc.x + pc.w / 2 - w / 2) <= 1 && bad.filter((x) => !/outside/.test(x)).length === 0, `${size} computer: ${Math.round(pc.w)} px wide, in the middle`, JSON.stringify(pc) + bad.join(' | '));
    await page.screenshot({ path: join(outPlay, `panel-computer-${size}.png`) });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__tncPlay.visit('boss'));
    await page.waitForSelector('.npc');
    const npc = await box(page, '.npc');
    c.ok(npc.w <= 620 && Math.abs(npc.x + npc.w / 2 - w / 2) <= 1 && (await lost(page, ['.npc', '.npc .hud-btn'])).length === 0, `${size} character caption: ${Math.round(npc.w)} px wide, in the middle`, JSON.stringify(npc));
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(outPlay, `npc-boss-${size}.png`) });
    await page.keyboard.press('Escape');

    /* ---- the machine view and the comparison ---- */
    const sim = await (await page.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
    await sim.waitForFunction(() => window.TNC_UI?.state?.res, null, { timeout: 60000 });
    if (await sim.locator('#setup:not([hidden])').count()) await sim.evaluate(() => document.getElementById('setup-skip').click());
    await page.locator('.shop-canvas').focus();
    await page.keyboard.type('333');
    await page.waitForSelector('.cmp');
    await page.waitForTimeout(700);
    const stage = await page.evaluate(() => { const s = document.querySelector('.cmp-stage').getBoundingClientRect(); const i = document.querySelector('.cmp-after img'); return { w: s.width, h: s.height, fit: getComputedStyle(i).objectFit, natural: i.naturalWidth / i.naturalHeight }; });
    c.ok(stage.fit === 'contain' && stage.w > 0 && stage.h >= 200 && (await lost(page, ['.cmp-tabs [role="tab"]', '.cmp-stage', '.cmp-range', '.cmp-fig figcaption', '.cmp .pp-x'])).length === 0, `${size} 333: tabs, pictures (whole, not stretched), slider and caption are on screen`, JSON.stringify(stage));
    await page.screenshot({ path: join(outPlay, `compare-${size}.png`) });
    await page.keyboard.press('Escape');
    await page.locator('.hud-rail .hud-btn').first().click();
    await page.locator('.st-list li').first().locator('.st-acts .hud-btn').first().click();
    await page.waitForSelector('.shop[data-mode="machine"]', { timeout: 8000 });
    await page.waitForTimeout(900);
    const fr = await box(page, '.shop-sim iframe');
    const inSim = await sim.evaluate(() => ({ scroll: document.documentElement.scrollWidth <= innerWidth, w: innerWidth, h: innerHeight }));
    c.ok(fr.w === w && fr.h === h && inSim.scroll && inSim.w === w, `${size} machine view: the simulator fills the screen, no sideways scroll inside it`, JSON.stringify({ fr, inSim }));
    await page.screenshot({ path: join(outPlay, `machine-${size}.png`) });
    c.ok(errors.length === 0, `${size} Play: no page error`, errors.join(' | '));
    await ctx.close();
  }

  /* ---- the quality tiers: each draws the workshop; low is looked at by eye in the screenshot ---- */
  for (const tier of ['low', 'medium', 'high']) {
    const ctx = await context(1920, 1080, {
      fn: (q) => {
        try {
          const k = 'tnc.settings.v1';
          if (!sessionStorage.getItem('tier-set')) localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), quality: q }));
          sessionStorage.setItem('tier-set', '1');
          localStorage.setItem('tnc.edition.play.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('tnc.edition.play.v1') || '{}'), onboarded: true }));
        } catch {
          /* storage off */
        }
      },
      arg: tier,
    });
    const page = await ctx.newPage();
    await page.goto(server.url + '/play');
    await page.waitForSelector('.land-start');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shop-canvas', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const got = await page.evaluate(() => ({ quality: JSON.parse(localStorage.getItem('tnc.settings.v1')).quality, ob: document.querySelectorAll('.ob').length }));
    const gl = await page.evaluate(() => { const cv = document.querySelector('.shop-canvas'); const g = cv.getContext('webgl2') ?? cv.getContext('webgl'); return { aa: g.getContextAttributes().antialias, w: cv.width, h: cv.height, lost: g.isContextLost() }; });
    c.ok(got.quality === tier && got.ob === 0 && !gl.lost && gl.aa === (tier !== 'low') && gl.w === 1920 && gl.h === 1080, `tier ${tier}: the workshop draws at 1920x1080 (antialias ${gl.aa ? 'on' : 'off'})`, JSON.stringify({ got, gl }));
    // not blank: the picture has light and dark parts (machines, floor marks, labels)
    const spread = await page.evaluate(async (png) => {
      const img = new Image();
      img.src = png;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = 192;
      cv.height = 108;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0, 192, 108);
      const d = g.getImageData(0, 0, 192, 108).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add(Math.round((d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 16));
      return seen.size;
    }, 'data:image/png;base64,' + (await page.locator('.shop-canvas').screenshot()).toString('base64'));
    c.ok(spread >= 8, `tier ${tier}: the picture has ${spread} of 16 brightness steps (not flat, not black)`);
    await page.screenshot({ path: join(outPlay, `tier-${tier}-1920x1080.png`) });
    await page.locator('.hud-rail .hud-btn').first().click();
    await page.locator('.st-list li').first().locator('.hud-quiet').click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: join(outPlay, `tier-${tier}-at-fil15-1920x1080.png`) });

    if (measure) {
      const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
      console.log(`\n  frame times at 1920x1080, quality ${tier}, ${gpu}`);
      for (const [name, i] of [['first person', 0], ['whole workshop', 1], ['machine orbit', 2]]) {
        await page.locator('.hud-rail .hud-btn').nth(1).click();
        await page.locator('.view-list .hud-btn').nth(i).click();
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.__tncPlay.resetStats());
        await page.waitForTimeout(6000);
        const st = await page.evaluate(() => window.__tncPlay.stats());
        console.log(`    ${name.padEnd(15)} ${st.frames} frames  avg ${st.avgMs.toFixed(2)} ms  p95 ${st.p95Ms.toFixed(2)} ms  max ${st.maxMs.toFixed(2)} ms  (${(1000 / st.avgMs).toFixed(1)} fps)`);
        c.ok(st.frames > 30 && st.p95Ms < 50, `tier ${tier}, ${name}: p95 frame time ${st.p95Ms.toFixed(1)} ms is under 50 ms`);
      }
    }
    await ctx.close();
  }
  await server.close();

  /* ---- the Business shell ---- */
  server = await serve(business);
  for (const { w, h } of SIZES) {
    const size = `${w}x${h}`;
    const ctx = await context(w, h);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url + '/work');
    const sim = await (await page.waitForSelector('.work > iframe', { state: 'attached' })).contentFrame();
    await sim.waitForFunction(() => window.TNC_UI?.state?.res, null, { timeout: 60000 });
    if (await sim.locator('#setup:not([hidden])').count()) await sim.evaluate(() => document.getElementById('setup-skip').click());
    await page.waitForTimeout(1200);
    const fr = await box(page, '.work > iframe');
    c.ok(fr.w === w && fr.h === h && (await noSideScroll(page)), `${size} Business: the machine fills the screen, no sideways scroll`, JSON.stringify(fr));
    const bad = await lost(sim, ['#modes', '#modes [data-m]', '#b-start', '#b-pgm', '#b-insp-k', '#spd-chip', '#dlg-in']);
    const inSim = await sim.evaluate(() => ({ scroll: document.documentElement.scrollWidth <= innerWidth, canvases: [...document.querySelectorAll('canvas')].filter((cv) => cv.getBoundingClientRect().width > 300).map((cv) => { const r = cv.getBoundingClientRect(); return { buffer: cv.width / cv.height, box: r.width / r.height, w: Math.round(r.width), h: Math.round(r.height) }; }) }));
    c.ok(bad.length === 0 && inSim.scroll, `${size} Business: modes, run, new program, inspector, speed and the block line are all on screen`, bad.join(' | '));
    c.ok(inSim.canvases.length >= 1 && inSim.canvases.every((k) => Math.abs(k.buffer / k.box - 1) < 0.02), `${size} Business: the 3-D view keeps its aspect (${inSim.canvases.map((k) => `${k.w}x${k.h}`).join(', ')})`, JSON.stringify(inSim.canvases));
    await settle(page);
    await page.screenshot({ path: join(outBusiness, `shell-${size}.png`) });
    c.ok(errors.length === 0, `${size} Business: no page error`, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close().catch(() => {});
}
process.exit(c.done());
