#!/usr/bin/env node
/* axe accessibility scan of every Play screen: landing, introduction, workshop HUD, station list, computer
 * panel, character caption, 333 comparison. At 1920x1080 and 390x844. Zero serious or critical violations.
 *
 *   npm run build:play && node tests/e2e/play-axe.mjs
 *
 * The simulator's own frame is left out: it is scanned by the simulator's suite, and on these screens it
 * is hidden and inert. axe checks what a program can check; it does not replace a screen-reader pass.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { checks, launch, requireBuild, serve } from './lib.mjs';

const dir = requireBuild('play');
const c = checks('play: axe scan of every screen');
const server = await serve(dir);
const { browser } = await launch();
let minor = 0;

try {
  for (const [w, h] of [[1920, 1080], [390, 844]]) {
    const size = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const scan = async (name, ready) => {
      await page.waitForSelector(ready, { timeout: 8000 });
      await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).exclude('.shop-sim').analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const rest = r.violations.filter((v) => !bad.includes(v));
      minor += rest.length;
      c.ok(bad.length === 0 && r.passes.length > 5, `${size} ${name}: no serious or critical violation (${r.passes.length} rules passed${rest.length ? `, lesser: ${rest.map((v) => `${v.id} [${v.impact}]`).join(', ')}` : ''})`, bad.map((v) => `${v.id} [${v.impact}] ${v.nodes.length}x ${v.nodes[0].target.join(' ')}: ${v.nodes[0].failureSummary.replace(/\s+/g, ' ').slice(0, 220)}`).join(' || '));
    };

    await page.goto(server.url + '/play');
    await scan('landing', '.land-start');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.shop-canvas', { timeout: 30000 });
    await scan('introduction', '.ob');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await scan('workshop HUD', '.hud-rail');
    await page.locator('.hud-rail .hud-btn').first().click();
    await scan('station list', '.st-list');
    await page.keyboard.press('Escape');
    await page.locator('.hud-rail .hud-btn').nth(2).click();
    await scan('computer panel', '.pc');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__tncPlay.visit('boss'));
    await scan('character caption', '.npc');
    await page.keyboard.press('Escape');
    await page.locator('.shop-canvas').focus();
    await page.keyboard.type('333');
    await scan('333 comparison', '.cmp-range');
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  console.log(`\n  lesser findings (minor or moderate) over all screens: ${minor}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(c.done());
