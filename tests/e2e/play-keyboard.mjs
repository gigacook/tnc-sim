#!/usr/bin/env node
/* Play with the keyboard only: no mouse, no touch, no scripted focus.
 *
 *   npm run build:play && node tests/e2e/play-keyboard.mjs
 *
 * START -> station list -> open fil15's control -> back to the workshop -> computer -> change a setting ->
 * close. Every step is Tab, Shift+Tab, Enter, Space or Esc; the script only reads where the focus is.
 * At every stop the focused control shows a focus ring.
 */
import { join } from 'node:path';
import { checks, launch, requireBuild, serve, shots } from './lib.mjs';

const dir = requireBuild('play');
const c = checks('play: a full pass with the keyboard only');
const server = await serve(dir);
const { browser } = await launch();
const out = shots('play');

try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const keys = [];
  const press = async (k) => {
    keys.push(k);
    await page.keyboard.press(k);
  };
  /** what has the focus in a frame: its text, where it sits, and whether it shows a ring */
  const focused = (frame) =>
    frame.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'BODY', text: '', id: '', ring: false, group: '', pressed: null, inList: '' };
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        id: el.id,
        cls: el.className,
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' '),
        ring: el.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
        group: el.closest('fieldset')?.querySelector('legend')?.textContent.trim() ?? '',
        pressed: el.getAttribute('aria-pressed'),
        inList: el.closest('li')?.querySelector('h3')?.textContent.trim() ?? '',
      };
    });
  /** Tab until `want` says yes; the number of presses, or -1 */
  async function tabTo(frame, want, max = 60) {
    for (let i = 1; i <= max; i++) {
      await press('Tab');
      if (want(await focused(frame))) return i;
    }
    return -1;
  }

  /* ---- START ---- */
  await page.goto(server.url + '/play');
  await page.waitForSelector('.land-start');
  let f = await focused(page);
  c.ok(f.cls === 'land-start', 'landing: START has the focus without a key pressed', JSON.stringify(f));
  await press('Tab');
  await press('Shift+Tab');
  f = await focused(page);
  c.ok(f.cls === 'land-start' && f.ring, 'landing: Tab and Shift+Tab come back to START, which shows a focus ring', JSON.stringify(f));
  await press('Enter');
  await page.waitForSelector('.shop-canvas', { timeout: 30000 });
  await page.waitForSelector('.ob');
  f = await focused(page);
  c.ok(/hud-primary/.test(f.cls) && f.ring, 'Enter starts; the introduction opens with the focus on its next button', JSON.stringify(f));
  await press('Enter');
  await press('Enter');
  c.ok(/3\/3/.test(await page.locator('.ob h3').innerText()), 'Enter twice steps the introduction to 3/3');
  await press('Escape');
  c.ok((await page.locator('.ob').count()) === 0, 'Esc closes the introduction');

  /* ---- station list -> fil15 ---- */
  let n = await tabTo(page, (x) => x.text === 'Stationer');
  f = await focused(page);
  c.ok(n > 0 && n <= 4 && f.ring, `Tab reaches "Stationer" (${n} presses), with a focus ring`, JSON.stringify(f));
  await press('Enter');
  await page.waitForSelector('.st-list');
  f = await focused(page);
  c.ok((await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))) && f.ring, 'Enter opens the station list and the focus moves into it', JSON.stringify(f));
  n = await tabTo(page, (x) => x.inList.startsWith('fil15') && x.text === 'Öppna styrningen');
  f = await focused(page);
  c.ok(n > 0 && f.ring, `Tab reaches "Öppna styrningen" of fil15 (${n} presses), with a focus ring`, JSON.stringify(f));
  // the focus stays inside the dialog: Shift+Tab from its first control wraps to its last
  const sim = await (await page.waitForSelector('.shop-sim iframe', { state: 'attached' })).contentFrame();
  await sim.waitForFunction(() => window.TNC_UI?.state?.res, null, { timeout: 60000 });
  await press('Enter');
  c.ok(await page.waitForSelector('.shop[data-mode="machine"]', { timeout: 8000 }).then(() => true, () => false), 'Enter opens the control of fil15');
  await sim.waitForFunction(() => window.TNC_UI.state.machine === '426', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  f = await focused(page);
  c.ok(f.tag === 'IFRAME' && (await sim.evaluate(() => window.TNC_UI.state.machine)) === '426', 'the focus is in the simulator (machine 426)', JSON.stringify(f));
  await page.screenshot({ path: join(out, 'keyboard-fil15-control.png') });

  /* ---- back to the workshop ---- */
  if (await sim.locator('#setup:not([hidden])').count()) {
    n = await tabTo(sim, (x) => x.id === 'setup-skip', 80);
    c.ok(n > 0, `the simulator's first-run guide is skipped by keyboard (Tab x ${n}, Enter)`);
    await press('Enter');
  }
  n = await tabTo(sim, (x) => x.id === 'b-exit', 80);
  f = await focused(sim);
  c.ok(n > 0, `Tab inside the simulator reaches its "to the workshop" control (${n} presses)`, JSON.stringify(f));
  await press('Enter');
  c.ok(await page.waitForSelector('.shop[data-mode="floor"]', { timeout: 8000 }).then(() => true, () => false), 'Enter returns to the workshop');
  await page.waitForTimeout(1300);
  f = await focused(page);
  c.ok(/shop-canvas/.test(f.cls ?? ''), 'back on the floor the focus is on the workshop itself', JSON.stringify(f));
  const p0 = await page.evaluate(() => window.__tncPlay.pose());
  keys.push('KeyS (held)');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyS');
  const p1 = await page.evaluate(() => window.__tncPlay.pose());
  c.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.5, 'and the walking keys work at once (S steps back)', JSON.stringify([p0, p1]));

  /* ---- computer -> a setting -> close ---- */
  n = await tabTo(page, (x) => x.text === 'Dator');
  f = await focused(page);
  c.ok(n > 0 && n <= 6 && f.ring, `Tab reaches "Dator" (${n} presses), with a focus ring`, JSON.stringify(f));
  await press('Enter');
  await page.waitForSelector('.pc');
  const motionLegend = await page.evaluate(() => document.querySelectorAll('.pc .seg')[2].querySelector('legend').textContent.trim());
  n = await tabTo(page, (x) => x.group === motionLegend && x.pressed === 'false');
  f = await focused(page);
  c.ok(n > 0 && f.ring, `Tab reaches the setting "${motionLegend}: ${f.text}" (${n} presses), with a focus ring`, JSON.stringify(f));
  await press('Space');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem('tnc.settings.v1')).motion, shown: document.querySelector('.play').dataset.motion, pressed: document.activeElement.getAttribute('aria-pressed') }));
  c.ok(after.stored === 'reduced' && after.shown === 'reduced' && after.pressed === 'true', 'Space sets it: reduced motion is stored, applied and shown as pressed', JSON.stringify(after));
  await page.screenshot({ path: join(out, 'keyboard-computer-setting.png') });
  // the dialog keeps the focus: a full round of Tab never leaves it
  let stayed = true;
  for (let i = 0; i < 45; i++) {
    await press('Tab');
    if (!(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')))) stayed = false;
  }
  c.ok(stayed, 'Tab goes round inside the computer panel and never leaves it (45 presses)');
  await press('Escape');
  f = await focused(page);
  c.ok((await page.locator('.pc').count()) === 0 && f.text === 'Dator' && f.ring, 'Esc closes the panel and the focus is back on "Dator"', JSON.stringify(f));
  c.ok(errors.length === 0, 'no page error', errors.join(' | '));
  console.log(`\n  ${keys.length} key presses, no pointer event`);
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
process.exit(c.done());
