#!/usr/bin/env node
/* Browser regression suite for the simulator shell (phones + desktop) and the web app.
 *
 *   npm ci && python3 build.py && node tests/ui/run.mjs
 *
 * What it covers: page-level horizontal overflow at 320–1440 px and a short landscape; touch-target sizes;
 * the phone header drawer (modal dialog: focus, inert background, Esc, focus return); workspace tabs (keyboard,
 * ARIA state, roving tabindex); swipes (navigate, but never from the 3-D view or on a vertical drag); state kept
 * across workspaces (block cursor, WebGL canvas); soft-key paging; run controls; editing a block from the dock;
 * dialogs (focus trap, Esc, focus return); global shortcuts vs. typing and keyboard-focused buttons; Swedish;
 * AI generation against a MOCKED OpenRouter (never a real key); axe-core scans; and — when the Rust server is
 * built — the simulator and web app served with the desktop shell's CSP. Ported from the old untracked .tools/qa/qa.mjs:
 * profile name in IndexedDB, undo / redo and I / E edit keys, Ctrl+S listing, project and profile zips, uploads
 * (Windows-1252, CRLF, lower case, drag-drop, zip, _2 rename, TOOL.T), the tool table, single block in execution order,
 * profile import Merge / Replace, new profile; the current AI flow (plan → repair round → modify → Ctrl+Z) and the model
 * picker. Regressions (3-D framing, callouts, coordinate overlay, "undefined", Swedish leftovers, header name, Status
 * swipe, SL cycles) are spec-driven: they fail until the app meets them. Fixtures: tests/ui/fx/ (synthetic programs).
 *
 * Browsers: Chromium always (Playwright's, /opt/pw-browsers, or PW_CHROMIUM=<chrome executable>); WebKit when Playwright
 * has it installed (CI: `npx playwright install --with-deps chromium webkit`). No Chromium = FAIL, exit 1
 * (TNC_UI_ALLOW_NO_BROWSER=1 makes it a skip); a missing WebKit is SKIPPED, never passed. TNC_UI_ONLY=io,ai,… runs
 * only those sections; TNC_WEB_DIST points the server at a web build elsewhere. Emulation is not a device test: WebKit here is not iOS Safari + VoiceOver, and
 * Chromium mobile emulation is not Android Chrome + TalkBack.
 *
 * Screenshots go to local/ui-shots/ (gitignored). Exit code 1 on any failure.
 */
import { chromium, webkit } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIM = join(ROOT, 'index.html');
const SHOTS = join(ROOT, 'local', 'ui-shots');
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(SIM)) { console.error('index.html missing: run python3 build.py'); process.exit(1); }
const SIM_URL = pathToFileURL(SIM).href;

let pass = 0, fail = 0, skip = 0;
const failures = [];
function ok(cond, name, detail = '') {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function skipped(name, why) { skip++; console.log('  SKIP  ' + name + '  (' + why + ')'); }

/* ---------- browsers ---------- */
async function launch(type) {
  const tries = type === chromium
    ? [{}, { executablePath: process.env.PW_CHROMIUM || '' }, { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }]   // PW_CHROMIUM: an already-installed chrome when the pinned one is missing
    : [{}];
  for (const t of tries) {
    if ('executablePath' in t && !(t.executablePath && existsSync(t.executablePath))) continue;
    try { const b = await type.launch({ ...t, args: type === chromium ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [] }); return { b, exe: t.executablePath || type.executablePath() }; }
    catch (e) { if (!/Executable doesn't exist|browserType.launch/.test(String(e))) throw e; }
  }
  return null;
}

/* ---------- a fresh simulator page: boot screen and name prompt out of the way, fonts offline ---------- */
async function simPage(browser, { width, height, mobile = width <= 900, lang = 'en', url = SIM_URL, storage = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile && browser.browserType() === chromium ? true : undefined,
    hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(([lang, storage]) => {
    try {
      sessionStorage.setItem('tnc426.boot', '1');
      localStorage.setItem('tnc.lang', lang);
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    } catch (e) {}
  }, [lang, storage]);
  const page = await ctx.newPage();
  page.on('filechooser', () => {});   // keeps file-chooser interception on from the start: the first Ctrl+O must not race it
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)\.com|openrouter\.ai/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#plist .blk').length > 5, null, { timeout: 30000 });
  // the first visit asks for a name: close it like an operator would
  if (await page.locator('#m-prof:not([hidden])').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return { ctx, page, errors };
}

const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const box = (page, sel) => page.locator(sel).first().boundingBox();
/* after a gesture: wait until the workspace settles on the expected value (slow CI boxes), then report what it is */
async function paneAfter(page, want) {
  await page.waitForFunction((w) => document.querySelector('.main').dataset.pane === w, want, { timeout: 3000 }).catch(() => {});
  return page.evaluate(() => document.querySelector('.main').dataset.pane);
}
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; });

/* swipe: real TouchEvents dispatched on the element under the finger, ~150 ms apart in total. Deterministic: the CDP
   pipeline below waits for a rendered frame per event, and with software WebGL on a loaded CI box a swipe can take
   seconds — longer than a real one. */
async function swipe(page, x0, y0, x1, y1, steps = 3) {
  await page.evaluate(async ([x0, y0, x1, y1, steps]) => {
    const target = document.elementFromPoint(x0, y0);
    const mk = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x + scrollX, pageY: y + scrollY, radiusX: 4, radiusY: 4, force: 1 });
    const fire = (type, t, list) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: [t] }));
    let t = mk(x0, y0); fire('touchstart', t, [t]);
    for (let i = 1; i <= steps; i++) { await new Promise((r) => setTimeout(r, 40)); t = mk(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); fire('touchmove', t, [t]); }
    fire('touchend', t, []);
  }, [x0, y0, x1, y1, steps]);
  await page.waitForTimeout(60);
}
/* the browser's own touch pipeline (CDP), Chromium only: used where the browser's default action matters */
async function cdpSwipe(page, x0, y0, x1, y1, steps = 3) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(120);
}

const VIEWPORTS = [
  { name: '320 portrait', width: 320, height: 640 },
  { name: '360 portrait', width: 360, height: 740 },
  { name: '390 portrait', width: 390, height: 844 },
  { name: '430 portrait', width: 430, height: 932 },
  { name: '768 tablet', width: 768, height: 1024 },
  { name: '844x390 landscape', width: 844, height: 390 },
  { name: '1440 desktop', width: 1440, height: 900, mobile: false },
];

async function layoutChecks(browser, tag) {
  for (const vp of VIEWPORTS) {
    for (const lang of ['en', 'sv']) {
      if (lang === 'sv' && ![320, 390, 1440].includes(vp.width)) continue;
      const { ctx, page, errors } = await simPage(browser, { ...vp, lang });
      const label = `[${tag}] ${vp.name} ${lang}`;
      const o = await overflow(page);
      ok(o.sw <= o.cw, `${label}: no page-level horizontal overflow`, `${o.sw} > ${o.cw}`);
      const phone = vp.width <= 900;
      const seen = [];                       // visible text of every screenshotted screen
      const text = () => page.evaluate(() => document.body.innerText);
      if (phone) {
        for (const p of ['pgm', 'gfx', 'side']) {
          await page.click(`#mt-${p}`);
          const o2 = await overflow(page);
          ok(o2.sw <= o2.cw, `${label}: no overflow in workspace ${p}`, `${o2.sw} > ${o2.cw}`);
          await page.screenshot({ path: join(SHOTS, `${tag}-${vp.width}x${vp.height}-${lang}-${p}.png`) });
          seen.push([p, await text()]);
        }
        await page.click('#mt-gfx');
        // primary touch targets
        const small = await page.evaluate(() => {
          const sel = '.mode, .mtabs [role=tab], #b-menu, #hdr-err, .dock .sk:not([hidden]), .skpager:not([hidden]) button';
          return [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)
            .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) }; })
            .filter((r) => r.w < 44 || r.h < 40);
        });
        ok(small.length === 0, `${label}: primary touch targets ≥ 44 px wide / ≥ 40 px tall`, JSON.stringify(small.slice(0, 4)));
        // essential controls on screen without scrolling: modes, tabs, START, menu, checks
        const vis = await page.evaluate(() => ['#modes', '#mtabs', '#b-menu', '#hdr-err', '.dock .sk.go'].map((s) => {
          const e = document.querySelector(s); if (!e) return s + ' missing'; const r = e.getBoundingClientRect();
          return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 ? null : s + ' off screen'; }).filter(Boolean));
        ok(vis.length === 0, `${label}: modes, workspace tabs, MENU, checks and NC START visible`, vis.join(', '));
        const canvas = await box(page, '#gl');
        ok(canvas && canvas.height >= 150 && canvas.width >= vp.width - 20, `${label}: graphics canvas has a usable size`, JSON.stringify(canvas));
      } else {
        await page.screenshot({ path: join(SHOTS, `${tag}-${vp.width}x${vp.height}-${lang}.png`) });
        seen.push(['desktop', await text()]);
        const inl = await page.evaluate(() => ['b-dev', 'b-new', 'b-lessons', 'b-ai', 'b-help', 'b-focus', 'b-prof'].filter((id) => { const e = document.getElementById(id); return !e || e.offsetParent === null; }));
        ok(inl.length === 0, `${label}: header buttons stay inline on wide screens`, inl.join(','));
        ok(await page.evaluate(() => !document.getElementById('hmore').hasAttribute('role')), `${label}: no drawer dialog role on wide screens`);
        ok(await page.evaluate(() => document.getElementById('sks').closest('.col-pgm') !== null), `${label}: soft keys under the program column`);
      }
      const undef = seen.filter(([, t]) => /\bundefined\b/.test(t)).map(([p, t]) => p + ': …' + t.slice(Math.max(0, t.search(/\bundefined\b/) - 30), t.search(/\bundefined\b/) + 9).replace(/\s+/g, ' '));
      ok(undef.length === 0, `${label}: no visible "undefined" on any screen`, undef.join(' | '));
      if (lang === 'sv') {
        const en = ['Elapsed / total', 'MY PROGRAMS', 'START SINGLE', 'all clear'].filter((w) => seen.some(([, t]) => t.includes(w)));
        ok(en.length === 0, `${label}: no English left in Swedish (Elapsed / total, MY PROGRAMS, START SINGLE, all clear)`, en.join(', '));
      }
      ok(errors.length === 0, `${label}: no page errors, console errors or failed requests`, errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
}

async function phoneFlows(browser, tag) {
  const { ctx, page, errors } = await simPage(browser, { width: 390, height: 844 });
  const L = `[${tag}] phone`;
  // ---- drawer
  await page.click('#b-menu');
  ok(await page.evaluate(() => { const h = document.getElementById('hmore'); return h.getAttribute('role') === 'dialog' && h.getAttribute('aria-modal') === 'true' && h.classList.contains('open'); }), `${L}: MENU opens a modal drawer`);
  ok((await active(page)) === 'hmore-x', `${L}: focus moves into the drawer`, await active(page));
  ok(await page.evaluate(() => document.querySelector('.main').inert && document.getElementById('dock').inert), `${L}: workspace and dock are inert behind the drawer`);
  ok(await page.getAttribute('#b-menu', 'aria-expanded') === 'true', `${L}: MENU aria-expanded=true`);
  const inDrawer = await page.evaluate(() => ['b-dev', 'b-new', 'b-lessons', 'b-ai', 'b-help', 'b-focus', 'b-prof'].filter((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return !(e.closest('#hmore') && r.width > 0 && r.right <= innerWidth + 1); }));
  ok(inDrawer.length === 0, `${L}: profile, AI, help, lessons, DEV, new, focus are in the drawer`, inDrawer.join(','));
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.getElementById('hmore').contains(document.activeElement)), `${L}: Tab stays inside the drawer`, await active(page));
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.getElementById('hmore').classList.contains('open')), `${L}: Esc closes the drawer`);
  ok((await active(page)) === 'b-menu', `${L}: focus returns to MENU`, await active(page));
  ok(await page.evaluate(() => !document.querySelector('.main').inert), `${L}: workspace usable again`);
  await page.click('#b-menu');
  const hm = await box(page, '#hmore');
  await swipe(page, hm.x + 40, hm.y + 300, hm.x + 260, hm.y + 310);
  await page.waitForFunction(() => !document.getElementById('hmore').classList.contains('open'), null, { timeout: 3000 }).catch(() => {});
  ok(await page.evaluate(() => !document.getElementById('hmore').classList.contains('open')), `${L}: swipe right closes the drawer`);

  // a real sideways swipe through the browser pipeline must never be the browser's "back" gesture
  const url0 = page.url();
  await page.click('#mt-side');
  await cdpSwipe(page, 80, 500, 330, 505);
  await page.waitForTimeout(400);
  ok(page.url() === url0 && await page.evaluate(() => !!document.getElementById('hmore')), `${L}: a real swipe never navigates the page away (history back)`, page.url());
  await page.click('#mt-gfx');

  // ---- dialog from the drawer: focus trap, Esc, focus return
  await page.click('#b-menu'); await page.click('#b-help');
  ok(await page.evaluate(() => !document.getElementById('m-help').hidden && !document.getElementById('hmore').classList.contains('open')), `${L}: HELP opens the dialog and closes the drawer`);
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.querySelector('#m-help .mcard').contains(document.activeElement)), `${L}: Tab is trapped in the dialog`, await active(page));
  ok(await page.evaluate(() => document.querySelector('.app').inert), `${L}: page behind the dialog is inert`);
  const mc = await box(page, '#m-help .mcard');
  ok(mc && mc.height >= 800 && mc.width >= 380, `${L}: dialog is a full-height sheet`, JSON.stringify(mc));
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.getElementById('m-help').hidden), `${L}: Esc closes the dialog`);
  ok((await active(page)) === 'b-menu', `${L}: focus returns to MENU after the dialog`, await active(page));

  // ---- workspace tabs: keyboard + ARIA
  await page.focus('#mt-gfx');
  await page.keyboard.press('ArrowLeft');
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane === 'pgm' && document.activeElement.id === 'mt-pgm'), `${L}: ArrowLeft on the tabs selects Program`);
  ok(await page.evaluate(() => [...document.querySelectorAll('#mtabs [role=tab]')].map((t) => t.tabIndex + ':' + t.getAttribute('aria-selected')).join() === '0:true,-1:false,-1:false'), `${L}: roving tabindex + aria-selected`);
  ok(await page.evaluate(() => document.getElementById('ws-pgm').getAttribute('role') === 'tabpanel' && document.getElementById('ws-pgm').getAttribute('aria-labelledby') === 'mt-pgm'), `${L}: workspace is a labelled tabpanel`);
  await page.keyboard.press('End');
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane === 'side'), `${L}: End selects Status`);

  // ---- state kept across workspaces
  await page.click('#mt-pgm');
  await page.evaluate(() => { window.__gl = document.getElementById('gl'); window.__ctx = window.__gl.getContext('webgl2') || window.__gl.getContext('webgl'); });
  await page.click('#plist .blk[data-i="12"]');
  const curBefore = await page.evaluate(() => document.querySelector('#plist .blk.cur').dataset.i);
  await page.evaluate(() => scrollTo(0, 400)); await page.waitForTimeout(50);
  const y0 = await page.evaluate(() => scrollY);
  await page.click('#mt-gfx'); await page.waitForTimeout(80); await page.click('#mt-pgm'); await page.waitForTimeout(80);
  ok(await page.evaluate(() => document.querySelector('#plist .blk.cur').dataset.i) === curBefore, `${L}: block cursor kept across workspaces`);
  const y1 = await page.evaluate(() => scrollY);
  ok(Math.abs(y1 - y0) < 4, `${L}: Program scroll position restored`, `${y0} → ${y1}`);
  ok(await page.evaluate(() => document.getElementById('gl') === window.__gl && !window.__ctx.isContextLost()), `${L}: same canvas, WebGL context not recreated`);
  await page.click('#mt-gfx'); await page.waitForTimeout(150);
  const cb = await box(page, '#gl');
  const rs = await page.evaluate(() => { const c = document.getElementById('gl'); return { w: c.width, h: c.height }; });
  ok(rs.w > 0 && Math.abs(rs.w / rs.h - cb.width / cb.height) < 0.05, `${L}: canvas resized to its box after the switch`, JSON.stringify({ rs, cb }));

  // ---- swipes
  await page.click('#mt-side');
  // a point inside the workspace, below the sticky tab bar and above the dock
  // a swipe that starts on something scrolling sideways is ignored on purpose, so pick a row that is not one
  const swipeY = () => page.evaluate(() => {
    const t = document.getElementById('mtabs').getBoundingClientRect().bottom + 10, d = document.getElementById('dock').getBoundingClientRect().top - 10;
    const sideways = (n) => { for (; n && !n.matches('.main'); n = n.parentElement) { const ox = getComputedStyle(n).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true; } return false; };
    for (let y = Math.round((t + d) / 2), k = 0; k < 40; k++, y += (k % 2 ? 1 : -1) * k * 6) {
      if (y <= t || y >= d) continue;
      const ok = [60, 330].every((x) => { const e = document.elementFromPoint(x, y); return e && e.closest('.main') && !sideways(e) && !e.closest('canvas,input,textarea,select'); });
      if (ok) return y; }
    return -1; });
  let mid = await swipeY();
  ok(mid > 0, `${L}: a swipe point on the workspace (not a sideways scroller)`, mid);
  await swipe(page, 330, mid, 60, mid + 10);   // leftward = next; Status is last: stays
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'side', `${L}: swipe past the last workspace does nothing`);
  await page.evaluate(() => { window.__t = []; const m = document.querySelector('.main');
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((ty) => m.addEventListener(ty, (e) => { const t = e.changedTouches[0] || {};
      window.__t.push(ty[5] + ':' + Math.round(t.clientX) + ',' + Math.round(t.clientY) + '@' + Math.round(e.timeStamp) + (ty === 'touchstart' ? ':' + (e.target.id || e.target.className || e.target.tagName) : '')); }, { passive: true })); });
  mid = await swipeY();
  await swipe(page, 60, mid, 330, mid + 5);   // rightward = previous
  const prevOk = (await paneAfter(page, 'gfx')) === 'gfx';
  ok(prevOk, `${L}: swipe right goes to the previous workspace`, prevOk ? '' : JSON.stringify({ mid, pane: await page.evaluate(() => document.querySelector('.main').dataset.pane), touches: await page.evaluate(() => window.__t), scrollY: await page.evaluate(() => scrollY) }));
  const g = await box(page, '#gl');
  if (g) await swipe(page, g.x + 300, g.y + g.height / 2, g.x + 40, g.y + g.height / 2);
  ok(g && await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'gfx', `${L}: a swipe on the 3-D view orbits, never switches`, g ? '' : '3-D view not on screen');
  await page.click('#mt-pgm');
  mid = await swipeY();
  await swipe(page, 200, mid - 150, 210, mid + 150);
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'pgm', `${L}: a vertical drag does not switch`);
  mid = await swipeY();
  await swipe(page, 360, mid, 80, mid + 10);
  ok((await paneAfter(page, 'gfx')) === 'gfx', `${L}: swipe left goes to the next workspace`);

  // ---- run controls from the dock (TEST mode)
  await page.click('.mode[data-m="test"]');
  await page.click('.dock .sk[data-a="start"]');
  await page.waitForTimeout(400);
  const rt = await page.evaluate(() => document.getElementById('run-state').textContent);
  ok(!/^READY$/.test(rt), `${L}: NC START from the dock runs the program`, rt);
  ok(await page.evaluate(() => document.getElementById('hdr-stat').textContent.includes('NAMEPLATE')), `${L}: header shows the program`);
  await page.click('.dock .sk[data-a="stop"]');
  await page.click('.dock .sk[data-a="reset"]');
  await page.waitForFunction(() => (document.getElementById('sr-live').textContent || '').length > 0, null, { timeout: 3000 }).catch(() => {});
  ok(await page.evaluate(() => (document.getElementById('sr-live').textContent || '').length > 0), `${L}: run state announced in the polite live region (debounced)`);

  // ---- PRG EDIT: soft-key rows page, a block is edited from the dock
  await page.click('.mode[data-m="edit"]');
  ok(await page.evaluate(() => !document.getElementById('skpager').hidden && document.querySelectorAll('#sks .sk:not([hidden])').length === 8), `${L}: PRG EDIT shows 8 soft keys and a row switch`);
  ok(/1 \/ 3/.test(await page.textContent('#sk-page')), `${L}: soft-key row 1 / 3`, await page.textContent('#sk-page'));
  await page.click('#sk-next'); await page.click('#sk-next');
  ok(await page.evaluate(() => !!document.querySelector('#sks .sk[data-a="ed"]:not([hidden])')), `${L}: row 3 holds EDIT / INSERT / DELETE`);
  await page.click('#mt-pgm');
  await page.click('#plist .blk[data-i="10"]');
  await page.click('.dock .sk[data-a="ed"]');
  const dlg = page.locator('#dlg-in');
  ok(await dlg.isEnabled(), `${L}: EDIT opens the block line in the dock`);
  const before = await page.evaluate(() => document.querySelector('#plist .blk[data-i="10"] .bt').textContent);
  await dlg.fill('L Z+60 R0 FMAX M3');
  await dlg.press('Enter');
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => document.querySelector('#plist .blk[data-i="10"] .bt').textContent);
  ok(after.includes('Z+60') && after !== before, `${L}: block edited from the phone`, `${before} → ${after}`);
  const dlgBox = await box(page, '#dlg-in');
  ok(dlgBox && dlgBox.y + dlgBox.height <= 844, `${L}: block line visible in the dock`, JSON.stringify(dlgBox));

  // ---- header check count → Status
  await page.click('#hdr-err');
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane === 'side' && !document.getElementById('sp-diag').hidden), `${L}: the check count opens the checks`);
  ok(await page.evaluate(() => !!document.getElementById('hdr-err').getAttribute('aria-label')), `${L}: check count has a text name (not colour only)`);
  ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function desktopFlows(browser, tag) {
  const { ctx, page, errors } = await simPage(browser, { width: 1440, height: 900, mobile: false });
  const L = `[${tag}] desktop`;
  await page.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => {});
  await page.keyboard.press('2');
  ok(await page.getAttribute('.mode[data-m="test"]', 'aria-pressed') === 'true', `${L}: key 2 = TEST`);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.querySelector('#plist .blk.cur').dataset.i) === '2', `${L}: ↑↓ move the block cursor`);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.getElementById('run-state').textContent !== 'READY'), `${L}: SPACE = NC START`);
  await page.keyboard.press('Escape');
  // Tab to a header button, Enter activates it (not NC START)
  await page.focus('#b-help');
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => !document.getElementById('m-help').hidden), `${L}: Enter on a keyboard-focused button activates it`);
  await page.keyboard.press('Escape');
  ok((await active(page)) === 'b-help', `${L}: focus returns to the opener`, await active(page));
  // typing does not trigger shortcuts
  await page.keyboard.press('Tab'); // raw editor toggles only when focus is not on a control; use the TAB key path explicitly
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Tab');
  const rawOpen = await page.evaluate(() => !document.getElementById('raw').hidden);
  if (rawOpen) {
    await page.keyboard.type('1');
    ok(await page.getAttribute('.mode[data-m="test"]', 'aria-pressed') === 'true', `${L}: typing "1" in the raw editor does not switch to PRG EDIT`);
    await page.keyboard.press('Backspace'); await page.keyboard.press('Tab');
  } else skipped(`${L}: raw editor typing`, 'TAB did not open the raw editor from this focus');
  // status tabs: arrow keys
  await page.focus('#stabs [aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => document.querySelector('#stabs [aria-selected="true"]').dataset.tab === 'ref' && !document.getElementById('sp-ref').hidden), `${L}: ArrowRight in the status tabs selects Reference`);
  await page.keyboard.press('ArrowLeft');
  ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

/* AI against a mocked OpenRouter: the route answers, nothing leaves the machine, no key is spent */
async function aiMocked(browser, tag) {
  const { ctx, page, errors } = await simPage(browser, { width: 390, height: 844, storage: { 'tnc426.orkey': 'test-key-not-real' } });
  const L = `[${tag}] AI (mocked)`;
  const PROGRAM = ['BEGIN PGM MOCK MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+80 Z+0', 'TOOL CALL 4 Z S3000',
    'L Z+50 R0 FMAX M3', 'L X+10 Y+10 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-1 R0 F150', 'L X+90 R0 F500', 'L Z+50 R0 FMAX M5', 'M30', 'END PGM MOCK MM'].join('\n');
  const SPEC = { blank: { x: [0, 100], y: [0, 80], z: [-20, 0] }, features: [{ id: 'S1', type: 'slot', from: [10, 10], to: [90, 10], w: 6, z: -1 }] };
  let calls = 0, sawKey = false;
  await page.route('https://openrouter.ai/**', async (route) => {
    const u = route.request().url();
    if (u.endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', created: 1, pricing: { prompt: '0.000000035', completion: '0.00000029' }, context_length: 128000 }] } });
    if (u.endsWith('/chat/completions')) {
      calls++; sawKey = (route.request().headers().authorization || '') === 'Bearer test-key-not-real';
      const req = JSON.parse(route.request().postData() || '{}'), planStep = /STEP 1 of 2/.test(JSON.stringify(req.messages || []));
      const chunk = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
      const content = planStep ? '```partspec\n' + JSON.stringify(SPEC) + '\n```' : '```klartext\n' + PROGRAM + '\n```';
      const body = chunk({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0 } }) + 'data: [DONE]\n\n';
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.click('#b-menu'); await page.click('#b-ai');
  await page.click('.hmenu button:has-text("New program from a description")');
  ok(await page.evaluate(() => !document.getElementById('m-new').hidden && !document.getElementById('new-ai').hidden), `${L}: AI dialog opens from the drawer`);
  await page.fill('#ai-prompt', 'A 100 x 80 plate, one facing pass 1 mm deep.');
  const pb = await box(page, '#ai-go');
  ok(pb && pb.y >= 0 && pb.y + pb.height <= 844, `${L}: Generate button on screen without scrolling`, JSON.stringify(pb));
  await page.click('#ai-go');
  await page.waitForFunction(() => /MOCK/.test(document.getElementById('hdr-stat').textContent), null, { timeout: 15000 }).catch(() => {});
  ok(calls === 2 && sawKey, `${L}: plan + program = two requests to the mocked endpoint with the BYOK header`, `calls=${calls} key=${sawKey}`);
  ok(await page.evaluate(() => /Measured against the spec: 1\d\d|Measured against the spec: 9\d/.test(document.getElementById('ailive') ? document.getElementById('ailive').textContent : '')),
    `${L}: the program is measured against the planned part (high match)`, await page.evaluate(() => (document.getElementById('ailive') || {}).textContent));
  ok(await page.evaluate(() => /MOCK/.test(document.getElementById('hdr-stat').textContent)), `${L}: generated program opened`);
  ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

/* the repair loop: a failing round asks Continue / Stop, Enter continues; the Auto checkbox and any max-tokens number stick */
async function aiRepairMocked(browser, tag) {
  const { ctx, page, errors } = await simPage(browser, { width: 390, height: 844, storage: { 'tnc426.orkey': 'test-key-not-real' } });
  const L = `[${tag}] AI repair (mocked)`;
  const prog = (cut) => ['BEGIN PGM MOCK MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+80 Z+0', 'TOOL CALL 4 Z S3000',
    'L Z+50 R0 FMAX M3', 'L X+10 Y+10 R0 FMAX', 'L Z+2 R0 FMAX', cut, 'L X+90 R0 F500', 'L Z+50 R0 FMAX M5', 'M30', 'END PGM MOCK MM'].join('\n');
  const SPEC = { blank: { x: [0, 100], y: [0, 80], z: [-20, 0] }, features: [{ id: 'S1', type: 'slot', from: [10, 10], to: [90, 10], w: 6, z: -1 }] };
  const progs = [prog('L Z-1 R0 FMAX'), prog('L Z-1 R0 F150')];          // round 1 rapids into the blank, round 2 is clean
  let calls = 0;
  await page.route('https://openrouter.ai/**', async (route) => {
    const u = route.request().url();
    if (u.endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', created: 1, pricing: { prompt: '0.000000035', completion: '0.00000029' }, context_length: 128000 }] } });
    if (u.endsWith('/chat/completions')) {
      calls++;
      const req = JSON.parse(route.request().postData() || '{}'), planStep = /STEP 1 of 2/.test(JSON.stringify(req.messages || []));
      const chunk = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
      const content = planStep ? '```partspec\n' + JSON.stringify(SPEC) + '\n```' : '```klartext\n' + progs.shift() + '\n```';
      const body = chunk({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0 } }) + 'data: [DONE]\n\n';
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.click('#b-menu'); await page.click('#b-ai');
  await page.click('.hmenu button:has-text("New program from a description")');
  await page.fill('#ai-maxtok', '500000'); await page.dispatchEvent('#ai-maxtok', 'change');
  ok(await page.evaluate(() => localStorage.getItem('tnc426.aimaxtok') === '500000' && document.getElementById('ai-maxtok').value === '500000'),
    `${L}: max tokens keeps 500000`, await page.evaluate(() => localStorage.getItem('tnc426.aimaxtok')));
  await page.check('#ai-auto'); const autoOn = await page.evaluate(() => localStorage.getItem('tnc426.aiauto'));
  await page.uncheck('#ai-auto'); const autoOff = await page.evaluate(() => localStorage.getItem('tnc426.aiauto'));
  ok(autoOn === '1' && autoOff === '0', `${L}: the Auto checkbox is stored`, `${autoOn}/${autoOff}`);
  await page.fill('#ai-prompt', 'A 100 x 80 plate with one slot 1 mm deep.');
  await page.click('#ai-go');
  await page.waitForSelector('#ai-more', { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => !!document.getElementById('ai-more') && !!document.getElementById('ai-stop')), `${L}: a failing round asks Continue / Stop`,
    await page.evaluate(() => (document.getElementById('ailive') || {}).textContent));
  ok(calls === 2, `${L}: nothing is sent while the question is open`, `calls=${calls}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /MOCK/.test(document.getElementById('hdr-stat').textContent), null, { timeout: 15000 }).catch(() => {});
  ok(calls === 3, `${L}: Enter continues with round 2`, `calls=${calls}`);
  ok(await page.evaluate(() => /MOCK/.test(document.getElementById('hdr-stat').textContent)), `${L}: the repaired program opened`);
  ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

/* axe-core: reported per state; serious/critical in the shell's new parts fail the run */
async function axeScan(browser, tag) {
  let AxeBuilder;
  try { ({ default: AxeBuilder } = await import('@axe-core/playwright')); } catch { skipped(`[${tag}] axe`, '@axe-core/playwright not installed'); return; }
  const states = [
    { name: 'phone', vp: { width: 390, height: 844 }, run: async () => {} },
    { name: 'phone drawer', vp: { width: 390, height: 844 }, run: async (p) => p.click('#b-menu') },
    { name: 'phone help dialog', vp: { width: 390, height: 844 }, run: async (p) => { await p.click('#b-menu'); await p.click('#b-help'); } },
    { name: 'desktop', vp: { width: 1440, height: 900, mobile: false }, run: async () => {} },
  ];
  for (const s of states) {
    const { ctx, page } = await simPage(browser, s.vp);
    await s.run(page);
    await page.waitForTimeout(250);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const mine = bad.filter((v) => v.nodes.some((n) => n.target.join(' ').match(/#(b-menu|hmore|hmore-x|mtabs|mt-|hdr-|dock|sk-|skpager|sr-live|scrim|ws-)/)));
    console.log(`  axe   [${tag}] ${s.name}: ${r.violations.length} violation types (${bad.length} serious/critical): ` +
      r.violations.map((v) => `${v.id}×${v.nodes.length}`).join(', '));
    ok(mine.length === 0, `[${tag}] axe ${s.name}: no serious/critical violation in the new shell controls`, mine.map((v) => v.id + ' ' + v.nodes[0].target).join('; '));
    ok(bad.length === 0, `[${tag}] axe ${s.name}: no serious/critical violation anywhere`, bad.map((v) => v.id + ' ' + v.nodes[0].target).join('; '));
    await ctx.close();
  }
}

/* the Rust server, when built: the simulator and the web app under the desktop shell's CSP */
async function serverChecks(browser, tag) {
  const bin = join(process.env.CARGO_TARGET_DIR || join(ROOT, 'server', 'target'), process.platform === 'win32' ? 'debug/tnc-server.exe' : 'debug/tnc-server');
  if (!existsSync(bin)) { skipped(`[${tag}] server + CSP`, 'server/target/debug/tnc-server not built (cd server && cargo build)'); return; }
  const webDir = process.env.TNC_WEB_DIST || join(ROOT, 'web', 'dist');     // TNC_WEB_DIST: a web build elsewhere (e.g. a worktree without one)
  const web = join(webDir, 'index.html');
  const lib = readFileSync(join(ROOT, 'desktop', 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const m = lib.match(/const CSP: &str = "([\s\S]*?)";/);
  const csp = m[1].replace(/\\\r?\n\s*/g, '');   // \r: a Windows checkout has CRLF
  const data = mkdtempSync(join(tmpdir(), 'tnc-ui-'));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn(bin, [], { env: { ...process.env, TNC_BIND: `127.0.0.1:${port}`, TNC_DATA_DIR: data, TNC_SIM_FILE: SIM, TNC_WEB_DIR: webDir,
    TNC_CSP: csp, TNC_ALLOWED_HOSTS: `127.0.0.1:${port}`, OPENROUTER_API_KEY: '', RUST_LOG: 'warn' }, stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const L = `[${tag}] server`;
    // simulator, served with the CSP
    const csps = [];
    const { ctx, page, errors } = await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      await ctx.addInitScript(() => { try { sessionStorage.setItem('tnc426.boot', '1'); } catch (e) {} });
      const page = await ctx.newPage(); const errors = [];
      page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) csps.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      return { ctx, page, errors };
    })();
    const res = await page.goto(base + '/sim/');
    ok(res.headers()['content-security-policy'] === csp, `${L}: /sim/ carries the desktop CSP`);
    await page.waitForFunction(() => document.querySelectorAll('#plist .blk').length > 5, null, { timeout: 30000 });
    ok(await page.evaluate(() => !!window.TNC_BACKEND), `${L}: simulator sees the server (bridge)`);
    const nonFont = csps.filter((c) => !/fonts\.(googleapis|gstatic)/.test(c));
    ok(nonFont.length === 0, `${L}: simulator runs under the CSP (fonts aside)`, nonFont.slice(0, 2).join(' | '));
    ok(errors.length === 0, `${L}: simulator page errors`, errors.slice(0, 2).join(' | '));
    // fetch() will not send a custom Host header; a raw request does (this is what a DNS-rebinding page looks like)
    const status = await new Promise((res) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: `evil.example:${port}` } }, (x) => { x.resume(); res(x.statusCode); }); r.on('error', () => res(0)); r.end(); });
    ok(status === 421, `${L}: foreign Host header refused (421)`, status);
    await ctx.close();
    if (!existsSync(web)) { skipped(`${L}: web app`, 'web/dist not built (cd web && npm run build)'); return; }
    // web app on a phone: sign up the first account, every page fits, the simulator page shows the iframe
    const c2 = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: browser.browserType() === chromium || undefined });
    const p2 = await c2.newPage(); const e2 = [];
    p2.on('pageerror', (e) => e2.push(e.message));
    p2.on('console', (m) => { if (/Refused to/.test(m.text()) && !/fonts/.test(m.text())) e2.push(m.text()); });
    await p2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await p2.goto(base + '/');
    await p2.fill('input[type=email]', 'op@shop.test');
    const name = p2.locator('input[autocomplete=name], input[name=name]');
    if (await name.count()) await name.first().fill('Operator');
    await p2.fill('input[type=password]', 'correct horse');
    await p2.click('button[type=submit]');
    await p2.waitForSelector('.topbar', { timeout: 10000 });
    for (const path of ['/', '/tools', '/account', '/simulator']) {
      await p2.goto(base + path); await p2.waitForTimeout(400);
      const o = await overflow(p2);
      ok(o.sw <= o.cw, `${L}: web ${path} has no horizontal overflow at 360 px`, `${o.sw} > ${o.cw}`);
      await p2.screenshot({ path: join(SHOTS, `${tag}-web-360${path.replace(/\//g, '_') || '_'}.png`) });
    }
    const nav = await p2.evaluate(() => { const b = document.querySelector('.nav-toggle'); return b ? b.getBoundingClientRect().height : 0; });
    ok(nav >= 44, `${L}: web menu button ≥ 44 px`, nav);
    const fr = await box(p2, '.simframe iframe');
    ok(fr && fr.height >= 400, `${L}: simulator iframe fills the phone`, JSON.stringify(fr));
    // every soft-key row of the simulator inside /simulator is fully on screen (page viewport and iframe)
    const sf = p2.frames().find((f) => /\/sim\//.test(f.url()));
    if (sf) await sf.waitForFunction(() => [...document.querySelectorAll('.sk:not([hidden])')].some((e) => e.offsetParent !== null), null, { timeout: 15000 }).catch(() => {});
    // retake the shot now that the simulator has loaded (the loop above shoots 400 ms after navigation)
    await p2.screenshot({ path: join(SHOTS, `${tag}-web-360_simulator.png`) });
    const keys = sf ? await sf.evaluate(() => [...document.querySelectorAll('.sk:not([hidden])')].filter((e) => e.offsetParent !== null).map((e) => {
      const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 12), top: r.top, bottom: r.bottom, ih: innerHeight }; })) : [];
    ok(keys.length > 0, `${L}: web /simulator shows the simulator's soft keys`, sf ? 'no visible soft key' : 'simulator frame not found');
    const cutKeys = keys.filter((k) => k.top < 0 || k.bottom > k.ih + 0.5 || (fr ? fr.y : 0) + k.bottom > 740 + 0.5).map((k) => k.t + '@' + Math.round(k.bottom));
    ok(keys.length > 0 && cutKeys.length === 0, `${L}: web /simulator at 360×740 shows every soft-key row in full`, cutKeys.slice(0, 6).join(', '));
    ok(e2.length === 0, `${L}: web app errors`, e2.slice(0, 2).join(' | '));
    await c2.close();
  } finally { proc.kill(); try { rmSync(data, { recursive: true, force: true }); } catch {} }
}

/* ---------- shared by the profile / file / AI sections (ported from the old .tools/qa/qa.mjs) ---------- */
const FX = join(dirname(fileURLToPath(import.meta.url)), 'fx');
const DL = 'TNC-SIMULATOR_';             // no folder handle in a test browser → downloads are named TNC-SIMULATOR_<KIND>_<name>
const NAME = 'QA Tester';
const S = (p) => p.evaluate(() => { const s = TNC_UI.state; return { pgm: s.pgm, text: s.text, names: Object.keys(s.pgms[s.machine]), tools: s.tools[s.machine] || [],
  errors: s.res.errors.map((e) => e.msg), editing: s.editing, mode: s.mode, tt: !!s.tt, mgt: !!s.mgt }; });
const ready = (p) => p.waitForFunction(() => window.TNC_UI && TNC_UI.state.res, null, { timeout: 30000 });
async function reload(p) { await p.waitForTimeout(700); await p.reload(); await ready(p); await p.waitForTimeout(500); }
async function dl(p, dir, fn, timeout = 8000) { const [d] = await Promise.all([p.waitForEvent('download', { timeout }), fn()]); const f = join(dir, d.suggestedFilename()); await d.saveAs(f); return f; }
async function upload(p, files) {
  const fcP = p.waitForEvent('filechooser', { timeout: 8000 });
  await p.keyboard.press('Control+o');
  const fc = await fcP.catch(async (e) => { throw new Error('no file chooser on Ctrl+O; open: ' + await p.evaluate(() => [...document.querySelectorAll('.modal:not([hidden]),[role=dialog]:not([hidden])')].map((m) => m.id || m.className).join(',') + ' focus=' + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)))); });
  await fc.setFiles(files); await p.waitForTimeout(700);
}
async function menu(p, btn, label) { await p.click(btn); await p.locator('.hmenu button', { hasText: label }).first().click(); }
/* zip entry names, read with the page's own JSZip (inlined by build.py): no unzip binary, no extra package */
const zipNames = (p, file) => p.evaluate(async (b64) => Object.keys((await JSZip.loadAsync(b64, { base64: true })).files), readFileSync(file).toString('base64'));
const fileName = (f) => f.split(/[\\/]/).pop();
/* a section that throws records one failure and lets the rest run */
async function step(p, name, fn) { try { await fn(); } catch (e) { ok(false, `${name} threw`, String(e.message || e).split('\n')[0]); await p.keyboard.press('Escape').catch(() => {}); } }

/* profile, programs, save / export, uploads, tool table, single block, import, new profile: one page at desktop size, sections
   build on each other like an operator's session (qa.mjs 1–5, 7–10) */
async function ioFlows(browser, tag) {
  const L = `[${tag}] io`;
  const out = mkdtempSync(join(tmpdir(), 'tnc-ui-dl-'));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('tnc.lang', 'en'); } catch (e) {} });
  const p = await ctx.newPage();
  p.on('filechooser', () => {});      // interception on before the first Ctrl+O
  const errs = [], external = [], dialogs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED|net::/.test(m.text())) errs.push('console: ' + m.text()); });
  p.on('request', (r) => { const u = r.url(); if (!/^(file:|data:|blob:)/.test(u)) external.push(u); });
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route('https://openrouter.ai/**', (r) => r.fulfill({ status: 599, body: 'blocked by the UI suite' }));
  try {
    await p.goto(SIM_URL); await ready(p); await p.waitForTimeout(800);
    const prof = () => p.locator('#m-prof');

    /* 1 profile: first visit asks for a name; it is stored in IndexedDB and survives a reload */
    await step(p, `${L} 1 profile`, async () => {
      ok(await p.locator('#boot').isVisible(), `${L} 1: boot splash on the first visit`);
      await p.keyboard.press('x'); await p.waitForTimeout(300);
      ok(await prof().isVisible() && (await prof().textContent()).includes("What's your name"), `${L} 1: profile dialog asks for a name after the splash`);
      ok(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'prof-name', `${L} 1: name field focused`);
      await p.keyboard.type(NAME); await p.keyboard.press('Enter');
      ok((await p.textContent('#b-prof')) === NAME, `${L} 1: header button shows the name`, await p.textContent('#b-prof'));
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      ok(!(await prof().isVisible()), `${L} 1: Esc closes the profile dialog`);
      ok(/autosaved/.test(await p.getAttribute('#b-prof', 'title') || ''), `${L} 1: header chip says autosaved`, await p.getAttribute('#b-prof', 'title'));
      await reload(p);
      ok((await p.textContent('#b-prof')) === NAME, `${L} 1: name persists after reload`);
      ok(!(await prof().isVisible()) && !(await p.locator('#boot').isVisible()), `${L} 1: no splash or name prompt after reload`);
      ok(await p.evaluate((n) => new Promise((r) => { const q = indexedDB.open('keyval-store'); q.onsuccess = () => { const t = q.result.transaction('keyval').objectStore('keyval').get('tnc.profile.v2');
        t.onsuccess = () => r(!!(t.result && t.result.name === n)); t.onerror = () => r(false); }; q.onerror = () => r(false); }), NAME), `${L} 1: profile stored in IndexedDB (keyval-store / tnc.profile.v2)`);
      const modes = await p.$$eval('#modes .mode', (bs) => bs.map((b) => b.querySelector('b').textContent + ' ' + b.querySelector('.lg').textContent));
      ok(modes.join('|') === '1 PRG EDIT|2 TEST|3 SINGLE-BLOCK|4 FULL-RUN', `${L} 1: header modes`, modes.join(' | '));
      const bad = [];
      for (const [k, m] of [['1', 'edit'], ['3', 'single'], ['4', 'full'], ['2', 'test']]) { await p.keyboard.press(k); await p.waitForTimeout(80); if ((await S(p)).mode !== m) bad.push(k + '→' + m); }
      ok(!bad.length && await p.getAttribute('#modes [data-m=test]', 'aria-pressed') === 'true', `${L} 1: keys 1–4 switch modes, aria-pressed follows`, bad.join());
      const tabs = await p.$$eval('#stabs [data-tab]', (bs) => bs.map((b) => b.textContent));
      ok(tabs[2] === NAME + "'s programs", `${L} 1: programs tab carries the profile name`, tabs.join(' | '));
    });

    /* 2 create + edit: undo / redo, I inserts, E edits, autosave */
    await step(p, `${L} 2 edit`, async () => {
      await menu(p, '#b-new', 'NEW PRG — MANUAL');
      await p.fill('#ns-name', 'qa part'); await p.click('#ns-go'); await p.waitForTimeout(300);
      let s = await S(p);
      ok(s.pgm === 'QA_PART.H' && s.editing && s.mode === 'edit', `${L} 2: NEW PRG — MANUAL creates QA_PART.H in PRG EDIT with the block line open`, JSON.stringify({ pgm: s.pgm, ed: s.editing, mode: s.mode }));
      ok(s.text.split('\n').filter((l) => l.trim()).join('|') === 'BEGIN PGM QA_PART MM|END PGM QA_PART MM', `${L} 2: new program = BEGIN / END only`, JSON.stringify(s.text));
      const before = s.text;
      await p.fill('#dlg-in', 'L X+10 Y+20 R0 FMAX'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
      s = await S(p); ok(s.text.split('\n')[1] === 'L X+10 Y+20 R0 FMAX' && s.text.split('\n').length === 3 && !s.editing, `${L} 2: typed block stored with Enter`, JSON.stringify(s.text));
      await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
      ok((await S(p)).text === before, `${L} 2: Ctrl+Z undoes the edit`);
      await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(200);
      ok((await S(p)).text.includes('L X+10 Y+20 R0 FMAX'), `${L} 2: Ctrl+Shift+Z redoes`);
      await p.keyboard.press('i'); await p.waitForTimeout(150);
      ok((await S(p)).editing, `${L} 2: I inserts a line and opens the block line`);
      await p.keyboard.type('L X+30 Y+30 R0 FMAX'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
      ok((await S(p)).text.split('\n')[2] === 'L X+30 Y+30 R0 FMAX', `${L} 2: I / type / Enter adds the next block`);
      await p.keyboard.press('ArrowUp'); await p.keyboard.press('e'); await p.waitForTimeout(100);
      await p.fill('#dlg-in', 'L X+15 Y+20 R0 FMAX'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
      ok((await S(p)).text.split('\n')[1] === 'L X+15 Y+20 R0 FMAX', `${L} 2: E edits an existing block (X+10 → X+15)`);
      await reload(p);
      s = await S(p); ok(s.pgm === 'QA_PART.H' && s.text.includes('L X+30 Y+30 R0 FMAX') && s.text.includes('L X+15 Y+20'), `${L} 2: program and edits survive a reload (autosave)`);
    });

    /* 3 save / download / export */
    let profileZip = null;
    await step(p, `${L} 3 save`, async () => {
      const f = await dl(p, out, () => p.keyboard.press('Control+s'));
      const t = readFileSync(f, 'utf8');
      ok(fileName(f) === DL + 'USER-GEN_QA_PART.H', `${L} 3: Ctrl+S downloads ${DL}USER-GEN_QA_PART.H`, fileName(f));
      ok(/^0 BEGIN PGM QA_PART MM\r\n1 L X\+15/.test(t) && /\r\n\d+ END PGM QA_PART MM\r\n$/.test(t) && !/[^\r]\n/.test(t), `${L} 3: numbered TNC listing with CRLF`, JSON.stringify(t.slice(0, 60)));
      const f2 = await dl(p, out, () => p.click('#b-save'));
      ok(fileName(f2) === DL + 'USER-GEN_QA_PART.H', `${L} 3: the Save .H button downloads too`, fileName(f2));
      await p.click('#b-prof'); await p.waitForTimeout(200);
      profileZip = await dl(p, out, () => p.click('#prof-export'));
      const ls = await zipNames(p, profileZip);
      ok(fileName(profileZip).startsWith(DL + 'SETTINGS_TNC_PROFILE_') && ls.includes('profile.json') && ls.some((n) => /^programs\/TNC426\/QA_PART\.H$/.test(n)),
        `${L} 3: profile export holds profile.json + programs/TNC426/QA_PART.H`, fileName(profileZip) + ': ' + ls.join(','));
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      await p.click('#stabs [data-tab=progs]'); await p.evaluate(() => { document.getElementById('pj-box').open = true; }); await p.waitForTimeout(100);
      await p.fill('#proj-name', 'QA PROJ'); await p.press('#proj-name', 'Enter');
      await p.click('#b-proj-add');
      const pz = await dl(p, out, () => p.click('#proj [data-zip]'));
      const pls = await zipNames(p, pz);
      ok(pls.some((n) => /QA_PART\.H$/.test(n)) && pls.some((n) => /README\.txt$/.test(n)), `${L} 3: project zip holds QA_PART.H + README.txt`, fileName(pz) + ': ' + pls.join(','));
    });

    /* 4 uploads */
    await step(p, `${L} 4 upload`, async () => {
      await upload(p, [join(FX, 'PLAIN1.H'), join(FX, 'UMLAUT.H')]);
      let s = await S(p); ok(s.names.includes('PLAIN1.H') && s.names.includes('UMLAUT.H'), `${L} 4: Ctrl+O loads two .H files`);
      const um = await p.evaluate(() => TNC_UI.state.pgms[TNC_UI.state.machine]['UMLAUT.H'] || '');
      ok(um.includes('Fräsen für Größe') && !um.includes('�'), `${L} 4: Windows-1252 comment decoded`, um.split('\n').find((l) => l.includes(';')));
      ok(!um.includes('\r'), `${L} 4: CRLF line ends normalised`);
      ok(s.pgm === 'UMLAUT.H' && !s.errors.length, `${L} 4: numbered CRLF listing loads without errors`, s.errors.join('|'));
      await upload(p, join(FX, 'lower.h'));
      s = await S(p); ok(s.names.includes('LOWER.H') && s.pgm === 'LOWER.H' && !s.errors.length, `${L} 4: lower.h loads as LOWER.H`, s.pgm);
      const b64 = readFileSync(join(FX, 'DROPME.H')).toString('base64');
      await p.evaluate(async (b64) => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'DROPME.H'));
        const el = document.querySelector('.col-pgm'); el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, b64);
      await p.waitForTimeout(500);
      ok((await S(p)).names.includes('DROPME.H'), `${L} 4: drag-drop on the program column loads DROPME.H`);
      // three .H in one zip, built with the page's JSZip (no binary fixture in git)
      const zb64 = await p.evaluate(async () => { const z = new JSZip();
        for (const n of ['ZIPA', 'ZIPB', 'ZIPC']) z.file(n + '.H', `BEGIN PGM ${n} MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+80 Z+0
TOOL CALL 4 Z S3000
L Z+50 R0 FMAX M3
L X+10 Y+10 R0 FMAX
L Z+100 R0 FMAX M5
END PGM ${n} MM
`);
        return z.generateAsync({ type: 'base64' }); });
      writeFileSync(join(out, 'multi.zip'), Buffer.from(zb64, 'base64'));
      await upload(p, join(out, 'multi.zip'));
      s = await S(p); ok(['ZIPA.H', 'ZIPB.H', 'ZIPC.H'].every((n) => s.names.includes(n)), `${L} 4: a zip of three .H loads all three`);
      await upload(p, join(FX, 'PLAIN1.H'));
      s = await S(p); ok(s.names.includes('PLAIN1_2.H') && s.names.includes('PLAIN1.H'), `${L} 4: the same name again → PLAIN1_2.H (no overwrite)`);
      await upload(p, join(FX, 'TOOL.T'));
      s = await S(p); const t42 = s.tools.find((t) => t.t === 42);
      ok(t42 && t42.r === 6.25 && t42.l === 75.5 && t42.name === 'QA_MILL_42' && s.tools.some((t) => t.t === 43), `${L} 4: TOOL.T merged into the tool table (T42 L75.5 R6.25, T43)`, JSON.stringify(t42));
    });

    /* 5 tool table */
    await step(p, `${L} 5 tools`, async () => {
      await upload(p, join(FX, 'T27.H'));
      let s = await S(p); const a27 = s.tools.find((t) => t.t === 27);
      ok(s.pgm === 'T27.H' && !s.errors.length && a27 && a27.r === 7 && a27.l === 0, `${L} 5: T27.H auto-adds T27 R7 (from ;T27 D=+14) with L=0, no error`, JSON.stringify(a27));
      await p.keyboard.press('t'); await p.waitForTimeout(300);
      s = await S(p); ok(s.tt && (await p.textContent('#mgt')).includes('TOOL LIST') && (await p.textContent('#pgm-path')).includes('TOOL.T'), `${L} 5: T opens the TOOL LIST`);
      ok(await p.inputValue('#tt-ht') === 'ISO50' && (await p.textContent('#tt-ht option[value=ISO50]')).includes('A = 100'), `${L} 5: holder defaults to ISO 50, A = 100 mm`);
      ok(await p.inputValue('#mgt tr[data-t="42"] input[data-k=r]') === '6.250' && await p.inputValue('#mgt tr[data-t="27"] input[data-k=l]') === '0.000', `${L} 5: list shows T42 R6.250 and T27 L0.000`);
      const segR = () => p.evaluate(() => { const g = TNC_UI.state.segs.find((x) => x.toolR != null); return g && g.toolR; });
      const r0 = await segR();
      const inp = p.locator('#mgt tr[data-t="27"] input[data-k=r]');
      await inp.fill('9.5'); await inp.press('Enter'); await p.waitForTimeout(300);
      s = await S(p); const r1 = await segR();
      ok((s.tools.find((t) => t.t === 27) || {}).r === 9.5 && r1 === 9.5 && r0 !== r1, `${L} 5: editing the radius recompiles the program`, `toolR ${r0} → ${r1}`);
      await p.fill('#mgt [data-tt=new]', '88'); await p.click('#mgt [data-tt=add]'); await p.waitForTimeout(200);
      ok((await S(p)).tools.some((t) => t.t === 88) && await p.locator('#mgt tr[data-t="88"]').count() === 1, `${L} 5: add tool T88`);
      await p.click('#mgt [data-del="88"]'); await p.waitForTimeout(200);
      ok(!(await S(p)).tools.some((t) => t.t === 88), `${L} 5: remove T88`);
      const tf = await dl(p, out, () => p.click('#mgt [data-tt=export]'));
      const tt = readFileSync(tf, 'utf8');
      ok(fileName(tf) === DL + 'TOOL-TABLES_TOOL_TNC426.T' && /^27\s+\S+\s+\+?0(\.0+)?\s+\+9\.5/m.test(tt), `${L} 5: export TOOL.T: name and T27 R+9.5`, fileName(tf));
      await p.keyboard.press('Escape'); await p.waitForTimeout(150);
      ok(!(await S(p)).tt, `${L} 5: Esc closes the TOOL LIST`);
      await p.keyboard.press('1'); await p.keyboard.press('Home'); for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowDown');
      await p.keyboard.press('i'); await p.keyboard.type('TOOL CALL 77 Z S1000'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      s = await S(p); ok(s.errors.some((e) => /TOOL 77 NOT DEFINED/.test(e)), `${L} 5: hand-typed TOOL CALL 77 → TOOL 77 NOT DEFINED`, s.errors.join('|'));
      await p.keyboard.press('t'); await p.waitForTimeout(200); await p.click('#mgt [data-tt=missing]'); await p.waitForTimeout(300);
      s = await S(p); ok(s.tools.some((t) => t.t === 77) && !s.errors.length, `${L} 5: "Add tools this program calls" adds T77, the error goes`, s.errors.join('|'));
      await p.keyboard.press('Escape'); await p.keyboard.press('Control+z'); await p.keyboard.press('2'); await p.waitForTimeout(200);
      await reload(p);
      s = await S(p); ok((s.tools.find((t) => t.t === 27) || {}).r === 9.5 && (s.tools.find((t) => t.t === 42) || {}).r === 6.25, `${L} 5: tool table survives a reload`);
    });

    /* 7 single block on HOLES.H (synthetic: rigid tapping below the blank, LP … M99 in a label repeated 10×):
       one NC START = one NC block in execution order, one hole per LP … M99 */
    await step(p, `${L} 7 single`, async () => {
      await upload(p, join(FX, 'HOLES.H'));
      let s = await S(p); const t50 = s.tools.find((t) => t.t === 50);
      ok(s.pgm === 'HOLES.H' && !s.errors.length && t50 && t50.l === 0, `${L} 7: HOLES.H loads without errors, T50 auto-added with L=0`, JSON.stringify(t50) + ' ' + s.errors.join('|'));
      const info = await p.evaluate(() => { const s = TNC_UI.state, E = s.res.exec, bl = s.res.blocks;
        const lp = bl.findIndex((b) => /^LP\b.*M99/.test(b.raw)), cc = bl.findIndex((b) => /^CYCL CALL/.test(b.raw));
        return { E, lp, cc, nb: bl.length, ev: s.events.map((e) => e.sev + ':' + (e.code || '')) }; });
      ok(info.ev.includes('info:THROUGH_CUT') && !info.ev.some((e) => e.startsWith('crash')), `${L} 7: depth below the blank = THROUGH_CUT note, no crash`, info.ev.join(','));
      const nLP = info.E.filter((i) => i === info.lp).length;
      ok(nLP === 11, `${L} 7: execution order runs the LP … M99 block 11× (label once + REP 10)`, nLP);
      await p.keyboard.press('3'); await p.keyboard.press('r'); await p.waitForTimeout(150);
      ok((await S(p)).mode === 'single', `${L} 7: key 3 → SINGLE-BLOCK`);
      const snap = () => p.evaluate(() => { const s = TNC_UI.state, rows = document.getElementById('plist').children;
        const holes = s.segs.filter((g) => g.t1 <= s.t + 1e-9 && g.kind === 'feed' && g.b.z <= -29.9).length;
        return { k: s.k, cur: s.cursor, holes, state: document.getElementById('run-state').textContent, rowCur: !!(rows[s.cursor] && rows[s.cursor].classList.contains('cur')) }; });
      let prev = await snap(); const bad = [];
      ok(prev.k === 0 && prev.cur === info.E[0] && prev.holes === 0, `${L} 7: reset: step 0, cursor on the first executed block`, JSON.stringify(prev));
      let lpPresses = 0, lpOneHole = 0;
      for (let i = 0; i < info.E.length; i++) {
        if (i === 0) await p.click('#sks [data-a=step]'); else await p.keyboard.press('Space');
        const now = await snap(), ran = info.E[prev.k];
        const expCur = now.k < info.E.length ? info.E[now.k] : info.nb - 1;
        const expHoles = (ran === info.lp || ran === info.cc) ? 1 : 0;
        if (now.k !== prev.k + 1) bad.push(`press ${i + 1}: k ${prev.k}→${now.k}`);
        if (now.cur !== expCur) bad.push(`press ${i + 1}: cursor ${now.cur}, expected ${expCur}`);
        if (!now.rowCur) bad.push(`press ${i + 1}: row ${now.cur} not highlighted`);
        if (now.holes - prev.holes !== expHoles) bad.push(`press ${i + 1} (block ${ran}): ${now.holes - prev.holes} holes, expected ${expHoles}`);
        if (/CRASH/.test(now.state)) bad.push(`press ${i + 1}: ${now.state}`);
        if (ran === info.lp) { lpPresses++; if (now.holes - prev.holes === 1) lpOneHole++; }
        prev = now; if (bad.length > 8) break;
      }
      ok(!bad.length, `${L} 7: ${info.E.length} NC START presses: each advances one execution step, cursor and highlight follow`, bad.slice(0, 6).join('; '));
      ok(lpPresses === 11 && lpOneHole === 11, `${L} 7: every LP … M99 press taps exactly one hole`, `${lpOneHole}/${lpPresses}`);
      ok(prev.holes === 12 && /PROGRAM END/.test(prev.state), `${L} 7: end: 12 holes (CYCL CALL + 11), PROGRAM END`, `${prev.holes} "${prev.state}"`);
      await p.keyboard.press('Space'); const after = await snap();
      ok(after.k === prev.k && /PROGRAM END/.test(after.state), `${L} 7: NC START after the end does nothing`);
      await p.keyboard.press('4'); await p.keyboard.press('r'); await p.keyboard.press('9'); await p.keyboard.press('Space');
      await p.waitForFunction(() => /PROGRAM END/.test(document.getElementById('run-state').textContent), null, { timeout: 10000 }).catch(() => {});
      ok(/PROGRAM END/.test(await p.textContent('#run-state')), `${L} 7: FULL-RUN at MAX runs to the end`, await p.textContent('#run-state'));
      await p.keyboard.press('5'); await p.keyboard.press('2');
    });

    /* 8 import the profile exported in 3: Merge keeps what came later, Replace restores the export */
    await step(p, `${L} 8 import`, async () => {
      if (!profileZip) throw new Error('no profile export from section 3');
      let nav = p.waitForEvent('load', { timeout: 8000 }).catch(() => null);
      await upload(p, profileZip);
      ok(await prof().isVisible() && await p.locator('#imp-merge').count() === 1 && await p.locator('#imp-replace').count() === 1, `${L} 8: a profile zip offers Merge / Replace`);
      await p.click('#imp-merge'); await nav; await ready(p); await p.waitForTimeout(600);
      let s = await S(p);
      ok(s.names.includes('HOLES.H') && s.names.includes('T27.H') && s.names.includes('QA_PART.H') && (await p.textContent('#b-prof')) === NAME, `${L} 8: Merge reloads, keeps mine (HOLES, T27) + the imported`, s.names.join(','));
      nav = p.waitForEvent('load', { timeout: 8000 }).catch(() => null);
      await upload(p, profileZip);
      await p.click('#imp-replace'); await nav; await ready(p); await p.waitForTimeout(600);
      s = await S(p);
      ok(!s.names.includes('HOLES.H') && s.names.includes('QA_PART.H') && !s.names.includes('ZIPA.H') && !s.tools.some((t) => t.t === 42) && dialogs.some((d) => /Replace your whole profile/.test(d)),
        `${L} 8: Replace asks, reloads, profile = the export (no HOLES / ZIPA / T42)`, s.names.join(','));
    });

    /* 9 new profile */
    await step(p, `${L} 9 new profile`, async () => {
      await p.click('#b-prof'); await p.waitForTimeout(200);
      const nav = p.waitForEvent('load', { timeout: 8000 }).catch(() => null);
      await p.click('#prof-new'); await nav; await ready(p); await p.waitForTimeout(600);
      const s = await S(p);
      ok(dialogs.some((d) => /Start a new, empty profile/.test(d)), `${L} 9: asks before wiping`);
      ok(!s.names.includes('QA_PART.H') && !s.tools.length && (await p.textContent('#b-prof')) !== NAME, `${L} 9: programs, tools and name are gone`);
      ok(await prof().isVisible(), `${L} 9: the profile dialog asks for a name again`);
    });

    /* 10 */
    ok(!errs.length, `${L} 10: no page or console errors`, errs.slice(0, 4).join(' | '));
    const ext = external.filter((u) => !/^https:\/\/(openrouter\.ai|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(u));
    ok(!ext.length, `${L} 10: no network requests besides Google Fonts and the (blocked) OpenRouter`, [...new Set(ext)].slice(0, 4).join(', '));
  } finally { await ctx.close(); rmSync(out, { recursive: true, force: true }); }
}

/* AI, current flow, against a mocked OpenRouter: plan → program with an error → repair round → saved; then a modify request
   that Ctrl+Z undoes. Plus the model picker. */
async function aiFlow(browser, tag) {
  const L = `[${tag}] AI flow (mocked)`;
  const { ctx, page: p, errors } = await simPage(browser, { width: 1440, height: 900, mobile: false, storage: { 'tnc426.orkey': 'test-key-not-real' } });
  const prog = (t, x) => ['BEGIN PGM AITEST MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+80 Z+0', `TOOL CALL ${t} Z S3000`,
    'L Z+50 R0 FMAX M3', 'L X+10 Y+10 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-1 R0 F150', `L X+${x} R0 F500`, 'L Z+50 R0 FMAX M5', 'M30', 'END PGM AITEST MM'].join('\n');
  const SPEC = { blank: { x: [0, 100], y: [0, 80], z: [-20, 0] }, features: [{ id: 'S1', type: 'slot', from: [10, 10], to: [90, 10], w: 6, z: -1 }] };
  const answers = [prog(99, 90), prog(4, 90), prog(4, 80)];        // round 1: tool not defined; round 2: clean; modify: shorter slot
  const chats = [], other = [];
  await p.route('https://openrouter.ai/**', async (route) => {
    const u = route.request().url();
    if (u.endsWith('/api/v1/models')) return route.fulfill({ status: 200, contentType: 'application/json', body: readFileSync(join(FX, 'openrouter-models.json'), 'utf8') });
    if (u.endsWith('/chat/completions')) {
      const req = JSON.parse(route.request().postData() || '{}'); chats.push(req);
      const planStep = /STEP 1 of 2/.test(JSON.stringify(req.messages || []));
      const content = planStep ? '```partspec\n' + JSON.stringify(SPEC) + '\n```' : '```klartext\n' + (answers.shift() || prog(4, 90)) + '\n```';
      const chunk = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' },
        body: chunk({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0 } }) + 'data: [DONE]\n\n' });
    }
    other.push(u); return route.fulfill({ status: 404, body: '{}' });
  });
  try {
    await menu(p, '#b-ai', 'New program from a description');
    ok(await p.isVisible('#m-new') && await p.isVisible('#ai-mp'), `${L}: AI dialog with the model picker`);
    /* model picker */
    await p.waitForSelector('#ai-mp .mp-chip', { timeout: 5000 }).catch(() => {});
    const chips = await p.$$eval('#ai-mp .mp-chip', (bs) => bs.map((b) => b.dataset.pick));
    ok(chips.length >= 4 && chips.every((c) => /^[\w.-]+\/[\w.:-]+$/.test(c)), `${L}: frontier chips computed from the live list`, chips.join(' '));
    if (chips.length) {
      await p.click(`#ai-mp .mp-chip[data-pick="${chips[0]}"]`);
      ok(await p.evaluate(() => localStorage.getItem('tnc426.ormodel')) === chips[0] && await p.locator(`#ai-mp .mp-chip.sel[data-pick="${chips[0]}"]`).count() === 1, `${L}: a chip click picks and highlights the model`);
    }
    await p.click('#ai-mp .mp-all');
    ok(await p.isVisible('#ai-mp .mp-pal') && await p.evaluate(() => document.activeElement.classList.contains('mp-q')), `${L}: All models opens the table, filter focused`);
    await p.click('#ai-mp th[data-s=pout] button');
    const nums = (await p.$$eval('#ai-mp tbody tr[data-i] td:nth-child(5)', (t) => t.map((x) => x.textContent))).map((x) => parseFloat(x.replace(/[^\d.]/g, ''))).filter(isFinite);
    ok(nums.length > 20 && nums.every((v, i) => !i || nums[i - 1] <= v), `${L}: click $/M out sorts ascending`, nums.slice(0, 6).join(','));
    await p.focus('#ai-mp .mp-q');
    await p.keyboard.type('qwen3.8 flash'); await p.keyboard.press('Escape');
    ok(await p.inputValue('#ai-mp .mp-q') === '' && await p.isVisible('#ai-mp .mp-pal') && await p.isVisible('#m-new'), `${L}: Esc in the filter clears it first; table and dialog stay`);
    await p.keyboard.type('qwn flsh'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter');
    ok(await p.evaluate(() => localStorage.getItem('tnc426.ormodel')) === 'qwen/qwen3.8-flash' && !(await p.isVisible('#ai-mp .mp-pal')), `${L}: fuzzy "qwn flsh" + arrows + Enter picks qwen/qwen3.8-flash and closes the table`,
      await p.evaluate(() => localStorage.getItem('tnc426.ormodel')));
    await p.click('#ai-mp .mp-all'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    if (await p.inputValue('#ai-mp .mp-q') === '' && await p.isVisible('#ai-mp .mp-pal')) await p.keyboard.press('Escape');
    ok(!(await p.isVisible('#ai-mp .mp-pal')) && await p.isVisible('#m-new'), `${L}: Esc closes the table, not the dialog`);

    /* new program: plan, round 1 with an error, repair round 2, saved */
    await p.fill('#ai-prompt', 'A 100 x 80 plate with one slot 1 mm deep.');
    await p.click('#ai-go');
    for (let i = 0; i < 3; i++) {                       // answer "Continue" if a round asks (Auto off)
      await p.waitForFunction(() => (TNC_UI.state.aiLive && TNC_UI.state.aiLive.done) || document.getElementById('ai-more'), null, { timeout: 15000 }).catch(() => {});
      if (await p.locator('#ai-more').count()) await p.click('#ai-more'); else break;
    }
    await p.waitForFunction(() => TNC_UI.state.aiLive && TNC_UI.state.aiLive.done, null, { timeout: 15000 }).catch(() => {});
    const progReqs = chats.filter((c) => !/STEP 1 of 2/.test(JSON.stringify(c.messages)));
    ok(chats.length === 3 && progReqs.length === 2, `${L}: plan + two program rounds = three requests`, `chats=${chats.length} program=${progReqs.length}`);
    ok(chats[0] && /STEP 1 of 2/.test(JSON.stringify(chats[0].messages)), `${L}: the first request is the planning step`);
    const last2 = progReqs[1] && JSON.stringify(progReqs[1].messages.slice(-2));
    ok(last2 && /TOOL 99 NOT DEFINED/.test(last2), `${L}: the second program request carries the simulator error`, last2 && last2.slice(-200));
    ok(chats.every((c) => c.model === 'qwen/qwen3.8-flash' && c.stream === true), `${L}: requests use the picked model, streamed`, chats.map((c) => c.model).join());
    const log = await p.evaluate(() => (document.getElementById('ailive') || {}).textContent || '');
    ok(/Round 2/.test(log) && /Saved as AITEST\.H/.test(log), `${L}: live panel shows Round 2 and "Saved as AITEST.H"`, log.slice(-240));
    let s = await S(p);
    ok(s.pgm === 'AITEST.H' && s.text.includes('TOOL CALL 4') && !s.errors.length, `${L}: AITEST.H open and valid`, s.pgm + ' ' + s.errors.join('|'));
    if (await p.locator('#ai-close').count()) await p.click('#ai-close');
    ok(!(await S(p)).names.includes('AI_LIVE.H'), `${L}: Close removes the live scratch program`);

    /* modify: current program + wish go out, the change lands, Ctrl+Z undoes it */
    const before = (await S(p)).text;
    await menu(p, '#b-ai', 'Change this program');
    await p.fill('#ai-prompt', 'Make the slot end at X+80.');
    await p.click('#ai-go');
    await p.waitForFunction(() => TNC_UI.state.aiLive && TNC_UI.state.aiLive.done, null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(400);
    const m = chats[3], mu = m ? JSON.stringify(m.messages) : '';
    ok(m && mu.includes('TOOL CALL 4') && mu.includes('L X+90 R0 F500') && mu.includes('Make the slot end at X+80'), `${L}: modify request carries the current program and the wish`, `chats=${chats.length}`);
    s = await S(p);
    ok(s.pgm === 'AITEST.H' && s.text.includes('L X+80 R0 F500') && s.text !== before, `${L}: the AI change is applied to AITEST.H`);
    if (await p.locator('#ai-close').count()) await p.click('#ai-close');
    await p.waitForTimeout(150);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press('Control+z'); await p.waitForTimeout(250);
    s = await S(p);
    ok(s.text === before, `${L}: Ctrl+Z undoes the AI change`, s.text.includes('X+80') ? 'still X+80' : 'differs otherwise');
    ok(!other.length, `${L}: only /models and /chat/completions requested`, other.join(','));
    ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  } finally { await ctx.close(); }
}

/* ---------- regressions (spec-driven): checks that wait for app fixes are named after the defect ---------- */
/* a test-side probe, no app hook: a TNC_UI plugin (the documented plugin bus) remembers the tool group */
const PROBE = () => { (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push((ui) => { ui.on('tool', (e) => { window.__qaTool = e.group; }); }); };
/* NDC extent of the blank (BLK FORM box) and the drawn tool (cutter + holder) in the current camera; inside = within ±1 */
const framing = (p) => p.evaluate(() => {
  const ui = TNC_UI, T = ui.THREE, st = ui.state.res.stock, cam = ui.camera;
  ui.scene.updateMatrixWorld(true); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const ext = (b) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9, behind = false;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const v = new T.Vector3(x, y, z).project(cam); if (v.z > 1 || v.z < -1) behind = true;
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    const r = (n) => Math.round(n * 100) / 100;
    return { inside: !behind && x0 >= -1 && x1 <= 1 && y0 >= -1 && y1 <= 1, ndc: [r(x0), r(x1), r(y0), r(y1)] }; };
  const blank = ext(new T.Box3(new T.Vector3(st.x0, st.y0, st.z0), new T.Vector3(st.x1, st.y1, st.z1)));
  const tool = window.__qaTool ? ext(new T.Box3().setFromObject(window.__qaTool)) : { inside: false, ndc: 'tool not seen' };
  return { blank, tool };
});
async function regressionChecks(browser, tag) {
  const vps = VIEWPORTS.some((v) => v.width === 1440 && v.height === 900) ? VIEWPORTS : [...VIEWPORTS, { name: '1440x900', width: 1440, height: 900, mobile: false }];
  for (const vp of vps) {
    const { ctx, page, errors } = await simPage(browser, vp);
    await page.addInitScript(PROBE); await page.reload(); await ready(page);
    if (await page.locator('#m-prof:not([hidden])').count()) await page.keyboard.press('Escape');
    const label = `[${tag}] ${vp.name}`, phone = vp.width <= 900;
    if (phone) await page.click('#mt-gfx');
    await page.waitForTimeout(400);
    let f = await framing(page);
    ok(f.blank.inside && f.tool.inside, `${label}: 3-D default view frames tool and blank fully inside the canvas`, JSON.stringify(f));
    // orbit away, then the 3-D VIEW soft key resets the framing
    await page.evaluate(() => { const c = TNC_UI.camera; c.position.multiplyScalar(0.3); });
    await page.evaluate(() => { const b = [...document.querySelectorAll('.sk[data-a="v3"]')].find((e) => e.offsetParent !== null); if (b) b.click(); else TNC_UI.state.view = '3D'; });
    await page.waitForTimeout(400);
    f = await framing(page);
    ok(f.blank.inside && f.tool.inside, `${label}: 3-D VIEW (reset) frames tool and blank fully inside the canvas`, JSON.stringify(f));
    const geo = await page.evaluate(() => {
      const R = (e) => e.getBoundingClientRect(), gl = R(document.getElementById('gl'));
      const shown = (e) => { const r = R(e), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0; };
      const keys = [...document.querySelectorAll('.sk:not([hidden])')].filter(shown).map(R);
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const labels = [...document.querySelectorAll('.tnc-callouts > div')].filter(shown).map((e) => ({ t: e.textContent.slice(0, 20), r: R(e) }));
      const outside = labels.filter((l) => l.r.left < gl.left - 0.5 || l.r.right > gl.right + 0.5 || l.r.top < gl.top - 0.5 || l.r.bottom > gl.bottom + 0.5).map((l) => l.t);
      const onKeys = labels.filter((l) => keys.some((k) => hit(l.r, k))).map((l) => l.t);
      const d = R(document.getElementById('dro')), ix = Math.max(0, Math.min(d.right, gl.right) - Math.max(d.left, gl.left)), iy = Math.max(0, Math.min(d.bottom, gl.bottom) - Math.max(d.top, gl.top));
      const hs = document.getElementById('hdr-stat'), hb = hs && hs.querySelector('b');
      return { n: labels.length, outside, onKeys, dro: (ix * iy) / Math.max(1, gl.width * gl.height),
        hdr: hb ? { name: hb.textContent, cut: R(hb).right > R(hs).right + 0.5 || R(hb).left < R(hs).left - 0.5 || !shown(hs) } : null };
    });
    ok(geo.outside.length === 0, `${label}: callout labels fully inside the 3-D view`, geo.outside.join(' | '));
    ok(geo.onKeys.length === 0, `${label}: callout labels clear of the soft keys`, geo.onKeys.join(' | '));
    if (phone) ok(geo.dro <= 0.2, `${label}: coordinate overlay covers ≤ 20 % of the 3-D view`, Math.round(geo.dro * 100) + ' %');
    if (vp.width === 320) ok(geo.hdr && !geo.hdr.cut, `${label}: header shows the full program file name`, JSON.stringify(geo.hdr));
    ok(errors.length === 0, `${label}: no page errors (regression pass)`, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* phone swipe (CONTINUE.md #17): a swipe that starts on the Status run list (#runkv) switches workspace */
  {
    const { ctx, page } = await simPage(browser, { width: 390, height: 844 });
    const L = `[${tag}] phone`;
    await page.click('#mt-side'); await page.waitForTimeout(150);
    const pt = await page.evaluate(() => { const kv = document.getElementById('runkv'); kv.scrollIntoView({ block: 'center' });
      const r = kv.getBoundingClientRect(), y = Math.round(r.top + Math.min(r.height / 2, 60));
      const e = document.elementFromPoint(330, y); return { y, on: !!(e && e.closest('#runkv')) }; });
    await page.waitForTimeout(100);
    await swipe(page, 60, pt.y, 330, pt.y + 5, 8);   // ~320 ms, like a real thumb: longer than the 250 ms Status refresh
    const pane = await paneAfter(page, 'gfx');
    ok(pt.on && pane === 'gfx', `${L}: a swipe right starting on the Status run list goes to Graphics`, JSON.stringify({ ...pt, pane }));
    await ctx.close();
  }

  /* SL cycles smoke: 14 / 20 / 22, a pocket with an island, TEST to the end */
  {
    const { ctx, page, errors } = await simPage(browser, { width: 1440, height: 900, mobile: false });
    const L = `[${tag}] SL cycles`;
    await upload(page, join(FX, 'SLPOCKET.H'));
    let s = await S(page);
    ok(s.pgm === 'SLPOCKET.H' && !s.errors.length, `${L}: SLPOCKET.H (CYCL DEF 14 / 20 / 22, pocket + island) loads without errors`, s.pgm + ' ' + s.errors.join('|'));
    await page.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => {});
    await page.keyboard.press('2'); await page.keyboard.press('r'); await page.keyboard.press('9'); await page.keyboard.press('Space');
    await page.waitForFunction(() => /PROGRAM END/.test(document.getElementById('run-state').textContent), null, { timeout: 30000 }).catch(() => {});
    const st = await page.textContent('#run-state');
    const ev = await page.evaluate(() => TNC_UI.state.events.filter((e) => e.sev === 'crash' || e.sev === 'error').map((e) => e.code || e.msg));
    ok(/PROGRAM END/.test(st) && !ev.length, `${L}: TEST runs to the end without an error or crash`, st + ' ' + ev.join(','));
    const removed = await page.evaluate(() => { const dt = [...document.querySelectorAll('#runkv dt')].find((d) => /Removed/i.test(d.textContent)); return dt ? parseFloat(dt.nextElementSibling.textContent) : NaN; });
    // the 3-D view's height field: the pocket floor reaches Q1 = -6 somewhere, the island (Ø20 at X50 Y40) and the blank outside stay at Z 0
    const hf = await page.evaluate(() => { let lo = 0; for (let x = 22; x <= 78; x += 2) for (let y = 22; y <= 58; y += 2) lo = Math.min(lo, TNC_UI.surfaceAt(x, y));
      return { lo, island: TNC_UI.surfaceAt(50, 40), outside: TNC_UI.surfaceAt(10, 10) }; });
    ok(removed > 0 && hf.lo <= -5.9 && hf.island >= -0.01 && hf.outside >= -0.01, `${L}: the 3-D view shows the pocket cut to Z-6 around an uncut island`, `removed ${removed} cm³, ${JSON.stringify(hf)}`);
    await page.locator('#gfx').screenshot({ path: join(SHOTS, `${tag}-sl-pocket.png`) });
    ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

/* ---------- run ---------- */
/* TNC_UI_ONLY=io,regress,… runs only those sections (development); unset = everything */
const want = (n) => !process.env.TNC_UI_ONLY || process.env.TNC_UI_ONLY.split(',').includes(n);
/* no browser is a failure, not "0 failed": TNC_UI_ALLOW_NO_BROWSER=1 turns a missing Chromium into a skip (WebKit is optional) */
for (const [type, tag] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const got = await launch(type);
  if (!got) {
    if (type === chromium && process.env.TNC_UI_ALLOW_NO_BROWSER !== '1') { fail++; failures.push('[chromium] not found: install Playwright\'s Chromium or set PW_CHROMIUM to a chrome executable (TNC_UI_ALLOW_NO_BROWSER=1 to skip)'); console.log('  FAIL  [chromium] browser not found'); }
    else skipped(`[${tag}] all checks`, `${tag} not installed for Playwright`);
    continue;
  }
  const { b, exe } = got;
  console.log(`\n== ${tag} ${b.version()} — ${exe} ==`);
  try {
    if (want('layout')) await layoutChecks(b, tag);
    if (want('phone')) { if (type === chromium) await phoneFlows(b, tag); else skipped(`[${tag}] phone flows`, 'swipe tests drive the CDP touch pipeline (Chromium only)'); }
    if (want('desktop')) await desktopFlows(b, tag);
    if (want('ai')) { await aiMocked(b, tag); await aiRepairMocked(b, tag); await aiFlow(b, tag); }
    if (want('io')) await ioFlows(b, tag);
    if (want('regress')) await regressionChecks(b, tag);
    if (want('axe')) await axeScan(b, tag);
    if (want('server')) await serverChecks(b, tag);
  } catch (e) { fail++; failures.push(`[${tag}] crashed: ${e.stack || e}`); console.log(e); }
  await b.close();
}
if (pass === 0 && fail === 0 && process.env.TNC_UI_ALLOW_NO_BROWSER !== '1') { fail++; failures.push('no check ran'); }
console.log(`\n${pass} passed · ${fail} failed · ${skip} skipped   (screenshots: local/ui-shots/)`);
if (fail) { console.log('\nFAILURES\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
