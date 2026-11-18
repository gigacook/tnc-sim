#!/usr/bin/env node
/* Business must not contain, import or request anything of Play.
 *
 *   npm run build:business && npm run build:play && node tests/e2e/business-isolation.mjs
 *
 * 1. Source: no file outside web/src/play imports from it.
 * 2. Bundle: dist/business has no Play file, no Play chunk name and none of Play's own strings.
 * 3. Browser: /work, served from a plain static host with every other host blocked, requests no Play
 *    asset and the simulator still boots. /play does not exist in Business and lands on /work.
 * Screenshots: artifacts/business/shell-*.png
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checks, launch, requireBuild, ROOT, serve, shots, walk, DIST } from './lib.mjs';

const dir = requireBuild('business');
const c = checks('business isolation');

/* ---- 1. source ---- */
const SRC = join(ROOT, 'web', 'src');
const importers = walk(SRC)
  .filter((f) => !f.startsWith('play/') && /\.(tsx?|css)$/.test(f))
  .filter((f) => /(from\s+|import\s*\(?\s*|@import\s+)['"][^'"]*\/play(\/|['"])/.test(readFileSync(join(SRC, f), 'utf8')));
c.ok(importers.length === 0, 'no source file outside web/src/play imports Play code', importers.join(', '));

/* ---- 2. bundle ---- */
const files = walk(dir);
const playFiles = files.filter((f) => f.startsWith('play/'));
c.ok(playFiles.length === 0, 'dist/business has no play/ folder', playFiles.slice(0, 5).join(', '));

// chunk and asset names that only the Play build has (hash removed)
const stem = (f) => f.replace(/-[\w-]{8}\.(js|css)$/, '.$1');
const playOnly = new Set();
if (existsSync(join(DIST, 'play', 'assets'))) {
  const business = new Set(readdirSync(join(dir, 'assets')).map(stem));
  for (const f of readdirSync(join(DIST, 'play', 'assets')).map(stem)) if (!business.has(f)) playOnly.add(f);
  c.ok(playOnly.size > 0, `the Play build has chunks of its own (${[...playOnly].join(', ')})`);
} else c.ok(false, 'dist/play exists to compare chunk names with', 'run npm run build:play');
const clash = readdirSync(join(dir, 'assets')).map(stem).filter((f) => playOnly.has(f));
c.ok(clash.length === 0, 'no Play chunk name in dist/business/assets', clash.join(', '));

// strings that exist only in Play code: storage keys, routes, media, scene and game words, the 3-D library
const MARKERS = [
  'tnc.play.save.v1',
  'tnc.edition.play.v1',
  'edition=play',
  '/play/pack',
  'hero-poster',
  'hero.mp4',
  'before-main',
  'fil15',
  'dmc125',
  'PORTAL 9',
  'norsk',
  'personell',
  'land-start',
  'shop-canvas',
  'hud-rail',
  'WebGLRenderer',
  'requestPointerLock',
  'ENTER_CONTROL',
];
const shell = files.filter((f) => !f.startsWith('sim/') && /\.(js|css|html|json|svg)$/.test(f)); // sim/index.html is the simulator itself
const hits = [];
for (const f of shell) {
  const text = readFileSync(join(dir, f), 'utf8');
  for (const m of MARKERS) if (text.includes(m)) hits.push(`${m} in ${f}`);
}
c.ok(hits.length === 0, `none of ${MARKERS.length} Play strings in ${shell.length} Business shell files`, hits.slice(0, 6).join('; '));
// the same markers must be findable in Play, or this check proves nothing
if (existsSync(join(DIST, 'play'))) {
  const playText = walk(join(DIST, 'play')).filter((f) => !f.startsWith('sim/') && /\.(js|css|html)$/.test(f)).map((f) => readFileSync(join(DIST, 'play', f), 'utf8')).join('\n');
  const missing = MARKERS.filter((m) => !playText.includes(m) && m !== 'hero.mp4' && m !== 'before-main');
  c.ok(missing.length === 0, 'every marker is really present in the Play bundle', missing.join(', '));
}

/* ---- 3. browser ---- */
const server = await serve(dir);
const { browser, exe } = await launch();
console.log('  browser: ' + exe);
const out = shots('business');
try {
  for (const [w, h] of [[1920, 1080], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const blocked = [];
    const seen = [];
    // networking to every other host is off
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === server.url || u.protocol === 'data:' || u.protocol === 'blob:') {
        seen.push(u.pathname);
        return route.continue();
      }
      blocked.push(u.host);
      return route.abort();
    });
    await ctx.addInitScript(() => {
      try {
        sessionStorage.setItem('tnc426.boot', '1');
      } catch {}
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url + '/work');
    const frame = page.frameLocator('main.work > iframe');
    const handle = await page.waitForSelector('main.work > iframe', { timeout: 15000 });
    const sim = await handle.contentFrame();
    const booted = await sim.waitForFunction(() => window.TNC_UI && window.TNC_UI.state && window.TNC_UI.state.res, null, { timeout: 45000 }).then(() => true, () => false);
    c.ok(booted, `${w}x${h}: /work opens straight into the simulator with other hosts blocked (${[...new Set(blocked)].join(', ') || 'none asked for'})`);
    c.ok(new URL(sim.url()).search === '?edition=business', `${w}x${h}: the simulator is asked for the business edition`, sim.url());
    const box = await handle.boundingBox();
    c.ok(box && Math.abs(box.width - w) < 2 && Math.abs(box.height - h) < 2 && box.x === 0 && box.y === 0, `${w}x${h}: the simulator fills the window`, JSON.stringify(box));
    c.ok((await page.locator('.work-menu').count()) === 0, `${w}x${h}: no shell chrome without a server (no menu, no landing)`);
    const play = seen.filter((p) => p.startsWith('/play') || [...playOnly].some((n) => p.includes(n.replace(/\.(js|css)$/, '-'))));
    c.ok(play.length === 0, `${w}x${h}: no Play asset requested (${seen.length} requests)`, play.join(', '));
    c.ok(errors.length === 0, `${w}x${h}: no page error in the shell`, errors.join(' | '));
    void frame;
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `shell-${w}x${h}.png`) });
    if (w === 1920) {
      seen.length = 0;
      await page.goto(server.url + '/play');
      await page.waitForURL('**/work', { timeout: 15000 }).catch(() => {});
      c.ok(new URL(page.url()).pathname === '/work', 'Business has no /play: it lands on /work', page.url());
      c.ok(!seen.some((p) => p.startsWith('/play/')), 'and asks for nothing under /play/', seen.filter((p) => p.startsWith('/play/')).join(', '));
    }
    await ctx.close();
  }

  /* ---- with a server: one compact menu reaches the signed-in pages. The API is MOCKED here (two answers);
         the pages themselves are covered by tests/ui/run.mjs against the real server. ---- */
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route('**/api/v1/info', (r) => r.fulfill({ json: { name: 'tnc-server', version: '0', api: 1, interpreter: null, machines: ['426', '430'], needs_setup: false, signup: false, ai: { enabled: false, provider: '', default_model: '', models: [], max_tokens: 0, monthly_budget_usd: 0 } } }));
  await ctx.route('**/api/v1/me', (r) => r.fulfill({ json: { id: 'u1', email: 'operator@example.invalid', name: 'Operator', role: 'admin', created_at: '2026-01-01T00:00:00Z' } }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(server.url + '/work');
  const toggle = page.locator('.work-menu-toggle');
  await toggle.waitFor({ timeout: 15000 }).catch(() => {});
  const tb = await toggle.boundingBox();
  c.ok(tb && tb.width >= 44 && tb.height >= 44, 'mocked server: the menu control appears, 44 x 44 px', JSON.stringify(tb));
  await toggle.focus();
  await page.keyboard.press('Enter');
  const links = await page.locator('#work-menu a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  c.ok(['/library', '/tools', '/account', '/admin'].every((h) => links.includes(h)), 'mocked server: it reaches Library, Tools, Account and Admin', links.join(', '));
  c.ok((await page.locator('#work-menu button.primary').count()) === 1, 'mocked server: it offers to save the program on screen to the library');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, 'shell-menu-1920x1080.png') });
  await page.keyboard.press('Escape');
  c.ok((await page.locator('#work-menu').count()) === 0 && (await page.evaluate(() => document.activeElement?.className)) === 'work-menu-toggle', 'Esc closes the menu and returns the focus');
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
process.exit(c.done());
