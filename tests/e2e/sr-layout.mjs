#!/usr/bin/env node
/* Serbian words are longer than the Swedish ones: this looks at every Play screen in Srpski at 1920x1080 and
 * 390x844 and fails on text that is cut off, runs out of the window or lies under another part of the HUD.
 *
 *   npm run build:play && node tests/e2e/sr-layout.mjs
 *
 * Screens: landing, workshop HUD, station list, computer panel, onboarding, a character caption.
 * Screenshots: artifacts/play/sr-<screen>-<width>x<height>.png
 */
import { join } from 'node:path';
import { checks, launch, requireBuild, serve, shots } from './lib.mjs';

const dir = requireBuild('play');
const c = checks('play in Serbian: nothing cut off, nothing out of the window');
const server = await serve(dir);
const { browser } = await launch();
const out = shots('play');

/** text boxes whose content is wider than the box, or that leave the window; [] when the screen is clean */
const cut = (page) =>
  page.evaluate(() => {
    const boxes = 'button, h1 span, h2, h3, legend, kbd, .land-badge, .land-hero p, .land-cells b, .land-cells span, .land-foot span, .hud-st b, .hud-state, .hud-pct, .hud-hand, .hud-hint, .hud-toast, .npc b, .npc p, .pp-body p, .sec-list b, .sec-list small, .sec-list em';
    const bad = [];
    for (const el of document.querySelectorAll(boxes)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[inert], [aria-hidden="true"]')) continue;
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!text) continue;
      if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1) bad.push(`wider than its box (${el.scrollWidth} > ${el.clientWidth}): ${text}`);
      // a scrolling panel may hold boxes below the fold, never beside the window
      if (r.left < -1 || r.right > innerWidth + 1) bad.push(`outside the window (${Math.round(r.left)}..${Math.round(r.right)} of ${innerWidth}): ${text}`);
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) bad.push('the page scrolls sideways');
    return bad;
  });
/** true when two elements share any pixel */
const overlap = (page, a, b) =>
  page.evaluate(([a, b]) => {
    const x = document.querySelector(a)?.getBoundingClientRect();
    const y = document.querySelector(b)?.getBoundingClientRect();
    return !!x && !!y && x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom;
  }, [a, b]);

try {
  for (const [w, h] of [[1920, 1080], [390, 844]]) {
    const size = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 500 });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const look = async (name) => {
      await page.waitForTimeout(500);
      const bad = await cut(page);
      c.ok(bad.length === 0, `${size} ${name}: no text cut off or out of the window`, bad.join(' | '));
      await page.screenshot({ path: join(out, `sr-${name}-${size}.png`) });
    };

    await page.goto(server.url + '/play');
    await page.waitForSelector('.land-start', { timeout: 15000 });
    await page.locator('.land-lang .land-ctl[lang="sr-Latn"]').click();
    c.ok((await page.locator('.land-hero h1').innerText()).includes('ŠPON'), `${size} landing: Srpski is chosen with the switch`);
    const langs = await page.locator('.land-lang .land-ctl').evaluateAll((bs) => bs.map((b) => b.innerText.trim()));
    c.ok(langs.join(' ') === (w > 760 ? 'Svenska English Srpski' : 'SV EN SR'), `${size} landing: the switch offers the three languages (${langs.join(' / ')})`);
    const start = await page.locator('.land-start').boundingBox();
    c.ok(start && start.y + start.height <= h, `${size} landing: START is on the first screen`, JSON.stringify(start));
    await look('landing');

    await page.locator('.land-start').click();
    await page.waitForSelector('.shop-canvas', { timeout: 30000 });
    await page.waitForSelector('.ob', { timeout: 5000 });
    c.ok((await page.locator('.ob h2').innerText()).toLowerCase().includes('dobro došli'), `${size} onboarding: in Serbian`);
    await page.waitForTimeout(1500); // the floor behind the dialog has drawn
    await look('onboarding');
    for (let i = 0; i < 2; i++) {
      await page.locator('.ob .hud-primary').click();
      const bad = await cut(page);
      c.ok(bad.length === 0, `${size} onboarding step ${i + 2}: no text cut off`, bad.join(' | '));
    }
    await page.keyboard.press('Escape');

    c.ok((await page.locator('.hud-rail .hud-btn').first().innerText()) === 'Stanice', `${size} HUD: the rail is in Serbian`);
    c.ok(!(await overlap(page, '.hud-rail', '.hud-status')), `${size} HUD: the rail does not lie over the status panel`);
    c.ok(!(await overlap(page, '.hud-status', '.hud-bottom')), `${size} HUD: the status panel does not lie over the hint`);
    await look('hud');

    await page.locator('.hud-rail .hud-btn').first().click();
    await page.waitForSelector('.st-list');
    await look('stations');
    await page.keyboard.press('Escape');

    await page.locator('.hud-rail .hud-btn', { hasText: 'Računar' }).click();
    await page.waitForSelector('.pc');
    c.ok((await page.locator('.pc .seg').first().locator('button').allInnerTexts()).join(' ') === 'Svenska English Srpski', `${size} computer: the language setting offers Svenska / English / Srpski`);
    await look('computer');
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__tncPlay.visit('office'));
    await page.waitForSelector('.npc', { timeout: 3000 });
    c.ok(/personal/.test(await page.locator('.npc p').innerText()), `${size} caption: the office character complains about "personal"`);
    c.ok(!(await overlap(page, '.npc', '.hud-status')), `${size} caption: it does not lie over the status panel`);
    await look('caption');
    // the longest line of each character
    for (const who of ['office', 'boss']) {
      await page.evaluate((n) => window.__tncPlay.visit(n), who);
      await page.locator('.npc .hud-primary').click();
      const bad = await cut(page);
      c.ok(bad.length === 0 && !(await overlap(page, '.npc', '.hud-status')), `${size} caption (${who}, second line): fits`, bad.join(' | '));
    }
    await page.keyboard.press('Escape');
    c.ok(errors.length === 0, `${size}: no page error`, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(c.done());
