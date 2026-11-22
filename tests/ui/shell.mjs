#!/usr/bin/env node
/* The simulator shell as the operator asked for it (2026-11): what he sees and touches, nothing else.
 *
 *   python3 build.py && node tests/ui/shell.mjs          (PW_CHROMIUM=<chrome> when Playwright's own is missing)
 *
 * Dark by default; each of the six themes applies and the program screen follows it (a dark theme = a dark screen with light
 * text), text contrast WCAG AA; the inspector is a rail, collapsed by default, opened by hover / F / a tap and closed again,
 * as an overlay that does not move the columns; no inspector, new-program or help button in the top bar; the Program menu holds
 * New program and the text editor and is keyboard-driven; the machine dropdown switches 426 / 430; the modes 1–4 sit in the
 * bottom bar; the speed chip answers the wheel, the arrows and a click; the full-screen button and key call requestFullscreen;
 * touch: a pinch zooms and a two-finger drag pans the 3-D view (CDP touch events at 1280 × 800 and 1920 × 1080);
 * no horizontal overflow or clipped bar at the listed screen sizes. Exit code 1 on any failure. Screenshots: local/ui-shots/shell-*.png */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIM = join(ROOT, 'index.html');
const SHOTS = join(ROOT, 'local', 'ui-shots');
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(SIM)) { console.error('index.html missing: run python3 build.py'); process.exit(1); }
const URL_ = pathToFileURL(SIM).href;

let pass = 0, fail = 0; const failures = [];
const ok = (c, name, detail = '') => { if (c) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); } };

async function launch() {
  for (const exe of [undefined, process.env.PW_CHROMIUM, '/opt/pw-browsers/chromium']) {
    if (exe !== undefined && !(exe && existsSync(exe))) continue;
    try { return await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); }
    catch (e) { if (!/Executable doesn't exist|browserType.launch/.test(String(e))) throw e; }
  }
  console.error('no Chromium'); process.exit(1);
}

/* a page as an operator who has been here before: setup done, Swedish, the stored settings as given */
async function open(browser, { width = 1440, height = 900, touch = false, settings = {}, init = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch && width <= 900, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(([s, init]) => {
    try { if (localStorage.getItem('tnc.settings.v1') == null) localStorage.setItem('tnc.settings.v1', JSON.stringify(Object.assign({ v: 1, lang: 'sv', setup: 1 }, s))); } catch {}
    document.addEventListener('DOMContentLoaded', () => { window.__themeAtDCL = document.documentElement.getAttribute('data-theme'); });
    if (init) (0, eval)(init);
  }, [settings, init]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(URL_);
  await page.waitForFunction(() => document.querySelectorAll('#plist .blk').length > 5 && window.TNC_UI, null, { timeout: 120000 });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

/* WCAG relative luminance and contrast of two CSS colours, computed in the page */
const COLOR_FN = `
  window.__lum = (c) => { const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = '#000'; cv.fillStyle = c; const h = cv.fillStyle;
    let r, g, b; if (h[0] === '#') { r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16); }
    else { [r, g, b] = h.match(/[\\d.]+/g).map(Number); }
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  window.__cr = (a, b) => { const x = __lum(a), y = __lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  window.__tok = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();`;

/* TNC_SHELL_ONLY=3,5 runs only those sections (development); unset = everything */
const want = (n) => !process.env.TNC_SHELL_ONLY || process.env.TNC_SHELL_ONLY.split(',').includes(String(n));
const browser = await launch();
console.log('shell: ' + URL_);

/* ---------- 1. themes ---------- */
if (want(1)) {
  const { ctx, page, errors } = await open(browser);
  await page.addScriptTag({ content: COLOR_FN });
  const def = await page.evaluate(() => ({ t: document.documentElement.dataset.theme, dcl: window.__themeAtDCL, bg: __lum(getComputedStyle(document.body).backgroundColor),
    crt: __lum(getComputedStyle(document.getElementById('crt')).backgroundColor), ink: __lum(getComputedStyle(document.querySelector('#plist .bt')).color) }));
  ok(def.t === 'night' && def.dcl === 'night', 'dark is the default: data-theme="night", set before the page finished parsing', JSON.stringify(def));
  ok(def.bg < 0.05 && def.crt < 0.05 && def.ink > 0.6, 'default: dark page and a dark program screen with light text (no white island)', JSON.stringify(def));
  const themes = await page.evaluate(() => window.TNC_THEMES);
  ok(Array.isArray(themes) && themes.map((t) => t.id).join() === 'night,graphite,mocha,acid,oled,cream' && themes.every((t) => t.name.sv && t.name.en && t.name.sr && t.swatch.length === 4 && typeof t.dark === 'boolean'),
    'window.TNC_THEMES lists the six themes with sv / en / sr names, dark flag and a 4-colour swatch');
  for (const th of themes) {
    await page.evaluate((id) => TNC_SETTINGS.set('theme', id), th.id);
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => {
      const crt = getComputedStyle(document.getElementById('crt')).backgroundColor, bt = getComputedStyle(document.querySelector('#plist .bt')).color;
      const pairs = [['--gc-ink', '--gc-canvas'], ['--gc-ink', '--gc-surface'], ['--gc-ink', '--gc-elevated'], ['--gc-ink-2', '--gc-surface'], ['--gc-muted', '--gc-surface'], ['--gc-muted', '--gc-canvas'],
        ['--gc-muted', '--gc-elevated'], ['--gc-on-accent', '--gc-accent-fill'], ['--scr-ink', '--scr'], ['--scr-ink-2', '--scr'], ['--scr-muted', '--scr'], ['--scr-accent', '--scr']];
      const low = pairs.map(([a, b]) => [a + '/' + b, __cr(__tok(a), __tok(b))]).filter(([, c]) => c < 4.5).map(([n, c]) => n + ' ' + c.toFixed(2));
      const sb = window.TNC_UI.scene.background, sc = '#' + sb.getHexString();
      return { theme: document.documentElement.dataset.theme, crtL: __lum(crt), inkL: __lum(bt), textCR: __cr(bt, crt), low, sceneL: __lum(sc), sceneVar: __lum(__tok('--scene-bg')) };
    });
    ok(r.theme === th.id, `${th.id}: applies (data-theme)`);
    ok(th.dark ? (r.crtL < 0.08 && r.inkL > 0.5) : (r.crtL > 0.7 && r.inkL < 0.1), `${th.id}: the program screen follows — ${th.dark ? 'dark screen, light text' : 'light screen, dark text'}`, JSON.stringify({ crtL: r.crtL.toFixed(3), inkL: r.inkL.toFixed(3) }));
    ok(r.textCR >= 4.5 && r.low.length === 0, `${th.id}: text contrast WCAG AA (program text ${r.textCR.toFixed(1)}:1)`, r.low.join(', '));
    ok(Math.abs(r.sceneL - r.sceneVar) < 0.02, `${th.id}: the 3-D scene background follows the theme`, JSON.stringify(r));
    await page.screenshot({ path: join(SHOTS, `shell-theme-${th.id}.png`) });
  }
  await page.evaluate(() => TNC_SETTINGS.set('theme', 'cream'));
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#plist .blk').length > 5, null, { timeout: 120000 });
  ok(await page.evaluate(() => window.__themeAtDCL === 'cream' && document.documentElement.dataset.theme === 'cream'), 'a stored theme is on <html> before the first paint after a reload');
  ok(errors.length === 0, 'themes: no page errors', errors.join(' | '));
  await ctx.close();
}

/* ---------- 2. top bar, Program menu, machine, modes ---------- */
if (want(2)) {
  const { ctx, page, errors } = await open(browser, {});
  /* the menu entry is checked against a stand-in: the real editor (editor.js) would open over the page */
  await page.evaluate(() => { window.TNC_EDITOR = window.TNC_EDITOR || {}; window.TNC_EDITOR.open = function () { window.__ed = (window.__ed || 0) + 1; }; });
  const bar = await page.evaluate(() => {
    const vis = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
    const inBar = (sel) => [...document.querySelectorAll('.bar ' + sel)].filter(vis).length;
    const txt = [...document.querySelectorAll('.bar button, .bar select')].filter(vis).map((b) => b.textContent.trim().replace(/\s+/g, ' '));
    return { insp: !!document.getElementById('b-insp') || inBar('[aria-controls="ws-side"]'), help: inBar('#b-help'), newVis: vis(document.getElementById('b-new')), seg: !!document.getElementById('mach-seg'), txt };
  });
  ok(!bar.insp && !bar.help && !bar.newVis && !bar.seg, 'top bar: no inspector, help or New program button, no 426/430 toggle', JSON.stringify(bar));
  ok(bar.txt.some((t) => /^Program/.test(t)) && bar.txt.some((t) => /Profil/.test(t)), 'top bar: Program ▾ and Profil are there', bar.txt.join(' | '));
  await page.click('#b-pgm');
  const menu = await page.evaluate(() => ({ open: !document.getElementById('pgm-menu').hidden, exp: document.getElementById('b-pgm').getAttribute('aria-expanded'),
    items: [...document.querySelectorAll('#pgm-menu [role=menuitem]')].map((b) => b.id || b.className), text: document.getElementById('pgm-menu').innerText, focus: document.activeElement.id }));
  ok(menu.open && menu.exp === 'true' && menu.items.includes('b-new') && menu.items.includes('pm-edit') && /Nytt program/.test(menu.text) && /texteditor/.test(menu.text),
    'Program menu: opens, holds Nytt program… and Öppna i texteditor', JSON.stringify(menu));
  ok(/Senaste/i.test(menu.text) && /Alla program/.test(menu.text) && /Spara \.H/.test(menu.text) && /Öppna fil från datorn/.test(menu.text), 'Program menu: open file, save .H, recent programs and all programs', menu.text.replace(/\n/g, ' | '));
  ok(menu.focus === 'b-new', 'Program menu: the focus lands on the first item', menu.focus);
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement.id) === 'pm-edit', 'Program menu: ↓ moves to the next item');
  await page.keyboard.press('End');
  ok(await page.evaluate(() => document.activeElement.id) === 'pm-all', 'Program menu: End goes to the last item');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.getElementById('pgm-menu').hidden && document.activeElement.id === 'b-pgm'), 'Program menu: Esc closes it and the focus goes back to the button');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  ok(await page.evaluate(() => window.__ed === 1 && document.getElementById('pgm-menu').hidden), 'Program menu: ↓ opens it from the button, Enter on Öppna i texteditor calls TNC_EDITOR.open()');
  await page.click('#b-pgm'); await page.click('#b-new');
  ok(await page.evaluate(() => !document.getElementById('m-new').hidden), 'Program menu: Nytt program… opens the New program dialog');
  await page.keyboard.press('Escape');
  await page.click('#b-pgm'); await page.mouse.click(700, 500);
  ok(await page.evaluate(() => document.getElementById('pgm-menu').hidden), 'Program menu: a click outside closes it');
  /* machine */
  await page.selectOption('#mach-sel', '430'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => TNC_UI.state.machine === '430' && document.querySelector('.ttl').textContent === 'TNC 430'), 'machine dropdown: TNC 430 selected');
  await page.selectOption('#mach-sel', '426'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => TNC_UI.state.machine === '426' && document.getElementById('mach-sel').value === '426'), 'machine dropdown: back to TNC 426');
  /* modes */
  const modes = await page.evaluate(() => { const m = document.getElementById('modes'); return { inSbar: !!m.closest('#sbar'), n: m.querySelectorAll('.mode').length, txt: m.innerText.replace(/\s+/g, ' ') }; });
  ok(modes.inSbar && modes.n === 4, 'modes 1–4 sit in the bottom bar', JSON.stringify(modes));
  await page.locator('#plist').click({ position: { x: 60, y: 20 } }); await page.evaluate(() => document.activeElement.blur());
  const bad = [];
  for (const [k, m] of [['1', 'edit'], ['3', 'single'], ['4', 'full'], ['2', 'test']]) { await page.keyboard.press(k); await page.waitForTimeout(60);
    if (await page.evaluate((m) => TNC_UI.state.mode !== m || document.querySelector(`#modes [data-m="${m}"]`).getAttribute('aria-pressed') !== 'true', m)) bad.push(k); }
  ok(!bad.length, 'modes: keys 1–4 switch, aria-pressed follows', bad.join());
  await page.click('#modes [data-m="single"]');
  ok(await page.evaluate(() => TNC_UI.state.mode === 'single'), 'modes: a click in the bottom bar switches');
  await page.click('#modes [data-m="test"]');
  const sb = await page.evaluate(() => [...document.querySelectorAll('#sbar button, #sbar a')].filter((e) => !e.hidden).map((e) => e.id).join(','));
  ok(/b-gear/.test(sb) && /b-insp-k/.test(sb) && /b-viewk/.test(sb) && /b-help/.test(sb) && /b-fs/.test(sb) && /b-helppage/.test(sb), 'bottom bar: gear, F inspektör, V vy, H hjälp, full screen and the quiet ?', sb);
  ok(errors.length === 0, 'top bar: no page errors', errors.join(' | '));
  await page.screenshot({ path: join(SHOTS, 'shell-top.png') });
  await ctx.close();
}

/* ---------- 3. inspector rail ---------- */
if (want(3)) {
  const { ctx, page, errors } = await open(browser);
  const st = () => page.evaluate(() => { const f = document.getElementById('insp-fly'), r = f.getBoundingClientRect();
    return { open: f.classList.contains('open'), vis: getComputedStyle(f).visibility === 'visible' && +getComputedStyle(f).opacity > 0.5 && r.width > 200, gfx: document.querySelector('.col-gfx').getBoundingClientRect().width,
      rail: document.getElementById('insp-rail').getBoundingClientRect().width, dot: document.getElementById('insp-dot').className }; });
  /* the page can be slow (software WebGL on a loaded box): wait for the state, never a fixed time, before reading it */
  const waitFly = (pg, w) => pg.waitForFunction((w) => document.getElementById('insp-fly').classList.contains('open') === w, w, { timeout: 10000 }).catch(() => {});
  const s0 = await st();
  ok(!s0.open && !s0.vis && s0.rail >= 38 && s0.rail <= 41, 'inspector: a 40 px rail, collapsed by default', JSON.stringify(s0));
  ok(/^dot( warn| bad)?$/.test(s0.dot), 'inspector rail: a status dot for the checks', s0.dot);
  const rb = await page.locator('#insp-rail').boundingBox();
  await page.mouse.move(rb.x + 20, rb.y + 200); await waitFly(page, true);
  const s1 = await st();
  ok(s1.open && s1.vis, 'inspector: opens when the pointer rests on the rail', JSON.stringify(s1));
  ok(Math.abs(s1.gfx - s0.gfx) < 1, 'inspector: opens over the view — the columns do not move', s0.gfx + ' → ' + s1.gfx);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#stabs [role=tab]')].map((t) => t.textContent.trim()).join(','));
  ok(tabs === 'Körning,Manual', 'inspector tabs: Körning and Manual (no programs, no projects)', tabs);
  ok(await page.evaluate(() => !document.querySelector('#proj, #pj-box, #proj-name, #b-proj-add, #sp-progs, #uplist') && !/Ett projekt är/.test(document.body.innerHTML)), 'no project UI or project explanation left');
  await page.mouse.move(500, 400); await waitFly(page, false);
  ok(!(await st()).open, 'inspector: closes when the pointer leaves');
  await page.locator('#plist').click({ position: { x: 60, y: 20 } }); await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('f'); await waitFly(page, true);
  ok((await st()).vis, 'inspector: F opens it');
  await page.mouse.move(500, 400); await page.waitForTimeout(1500);
  ok((await st()).open, 'inspector: opened with F it stays (pinned) when the pointer is elsewhere');
  await page.keyboard.press('f'); await waitFly(page, false);
  ok(!(await st()).open, 'inspector: F closes it');
  await page.click('#b-insp-k'); await waitFly(page, true);
  ok((await st()).open, 'bottom bar: F inspektör opens it');
  await page.click('#insp-x'); await waitFly(page, false);
  ok(!(await st()).open, 'inspector: × closes it');
  await page.focus('#insp-rail'); await page.keyboard.press('ArrowLeft'); await waitFly(page, true);
  await page.waitForFunction(() => document.getElementById('insp-fly').contains(document.activeElement), null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => document.getElementById('insp-fly').classList.contains('open') && document.getElementById('insp-fly').contains(document.activeElement)), 'inspector: an arrow key on the focused rail opens it and moves the focus in');
  await page.keyboard.press('Escape'); await waitFly(page, false);
  ok(await page.evaluate(() => !document.getElementById('insp-fly').classList.contains('open') && document.activeElement.id === 'insp-rail'), 'inspector: Esc closes it, the focus goes back to the rail');
  ok(errors.length === 0, 'inspector: no page errors', errors.join(' | '));
  await ctx.close();
  /* a tap (touch screen laptop) */
  const t = await open(browser, { width: 1280, height: 800, touch: true });
  const rb2 = await t.page.locator('#insp-rail').boundingBox();
  await t.page.touchscreen.tap(rb2.x + 20, rb2.y + 150); await waitFly(t.page, true);
  ok(await t.page.evaluate(() => document.getElementById('insp-fly').classList.contains('open')), 'inspector: a tap on the rail opens it');
  await t.page.screenshot({ path: join(SHOTS, 'shell-inspector.png') });
  await t.page.touchscreen.tap(rb2.x + 20, rb2.y + 150); await waitFly(t.page, false);
  ok(await t.page.evaluate(() => !document.getElementById('insp-fly').classList.contains('open')), 'inspector: a second tap closes it');
  await t.ctx.close();
}

/* ---------- 4. speed chip, replay, full screen, help page ---------- */
if (want(4)) {
  const { ctx, page, errors } = await open(browser, { init: `window.TNC_CINE={open:function(){window.__cine=(window.__cine||0)+1;}};
    Element.prototype.requestFullscreen=function(){ window.__fs=(window.__fs||0)+1; return Promise.resolve(); };
    (function(){ var o=window.open; window.open=function(){ var w=o.apply(window,arguments); window.__hpw=w; return w; }; })();` });
  const sp = () => page.evaluate(() => TNC_UI.state.speed);
  ok(await page.evaluate(() => !document.querySelector('#spd button[data-s]') && !!document.getElementById('spd-chip')), 'speed: one chip instead of five buttons');
  await page.evaluate(() => TNC_UI.setSpeed(4));
  const cb = await page.locator('#spd-chip').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(0, -100); await page.waitForTimeout(150);
  ok(await sp() === 16, 'speed chip: the wheel up makes it faster (4× → 16×)', String(await sp()));
  await page.mouse.wheel(0, 100); await page.waitForTimeout(150);
  ok(await sp() === 4, 'speed chip: the wheel down makes it slower (16× → 4×)', String(await sp()));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80);
  ok(await sp() === 16, 'speed chip: → while the pointer rests on it (4× → 16×)', String(await sp()));
  const t0 = await page.evaluate(() => TNC_UI.state.t);
  ok(t0 === 0, 'speed chip: that arrow did not scrub the run');
  await page.mouse.move(400, 300);
  await page.focus('#spd-chip'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(80);
  ok(await sp() === 4, 'speed chip: ← with the keyboard focus on it (16× → 4×)', String(await sp()));
  await page.click('#spd-chip'); await page.waitForTimeout(80);
  ok(await sp() === 16 && await page.textContent('#spd-v') === '16×', 'speed chip: a click steps (4× → 16×) and shows it', String(await sp()));
  await page.evaluate(() => TNC_UI.setSpeed(0));
  await page.click('#spd-chip');
  ok(await sp() === 1, 'speed chip: a click after MAX wraps to 1×');
  /* kept as before: the prefs cookie (http) and the profile's prefs (IndexedDB, autosaved 300 ms after a change); a file:// page has no cookie */
  await page.waitForTimeout(1500);
  const stored = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('keyval-store'); q.onsuccess = () => { const t = q.result.transaction('keyval').objectStore('keyval').get('tnc.profile.v2');
    t.onsuccess = () => r(t.result && t.result.prefs ? t.result.prefs.speed : null); t.onerror = () => r(null); }; q.onerror = () => r(null); }));
  ok(stored === 1, 'speed: stored with the profile prefs as before', String(stored));
  /* replay */
  ok(await page.evaluate(() => !document.getElementById('b-replay').hidden), 'Replay button shown when TNC_CINE is there');
  /* the built page has the real cine.js, whose `var TNC_CINE` replaces the init-script stub: stub its open() after load (as the editor is) */
  await page.evaluate(() => { TNC_CINE.open = function () { window.__cine = (window.__cine || 0) + 1; }; });
  await page.click('#b-replay');
  ok(await page.evaluate(() => window.__cine === 1), 'Replay button calls TNC_CINE.open()');
  await page.evaluate(() => { TNC_UI.setSpeed(0); TNC_UI.exec('start'); });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.getElementById('replay-offer').hidden), 'after a full run the Replay offer shows in the view');
  /* full screen */
  await page.click('#b-fs');
  ok(await page.evaluate(() => window.__fs === 1), 'full screen button calls requestFullscreen');
  await page.locator('#plist').click({ position: { x: 60, y: 20 } }); await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('F11');
  ok(await page.evaluate(() => window.__fs === 2), 'F11 (the default key) calls requestFullscreen');
  await page.evaluate(() => TNC_SETTINGS.set('fskey', 'F10')); await page.waitForTimeout(80);
  await page.keyboard.press('F10');
  ok(await page.evaluate(() => window.__fs === 3 && document.getElementById('b-fs-k').textContent === 'F10'), 'the full-screen key comes from Settings (fskey = F10)');
  ok(await page.evaluate(() => typeof TNC_UI.fullscreen === 'function' && typeof TNC_UI.view.get === 'function' && typeof TNC_UI.view.set === 'function' && typeof TNC_UI.setTheme === 'function'),
    'UIAPI: fullscreen, view.get / view.set, setSpeed, setTheme for the settings panel');
  const v0 = await page.evaluate(() => TNC_UI.view.get().labels);
  await page.keyboard.press('l');
  ok(await page.evaluate((v0) => TNC_UI.view.get().labels === !v0, v0), 'view toggles: the L key still works (read through UIAPI.view)');
  await page.evaluate((v0) => TNC_UI.view.set('labels', v0), v0);
  ok(await page.evaluate((v0) => TNC_UI.view.get().labels === v0 && !document.getElementById('fxmenu').offsetParent, v0), 'view toggles: UIAPI.view.set works; the old Effects menu is not shown');
  /* help as its own page */
  /* headless Chromium does not report a popup written by its opener as a page: read it through the window the opener got back */
  await page.click('#b-helppage');
  await page.waitForFunction(() => { try { return window.__hpw && /Kortkommandon/.test(window.__hpw.document.body.innerText); } catch { return false; } }, null, { timeout: 10000 }).catch(() => {});
  const ptxt = await page.evaluate(() => { try { return window.__hpw.document.title + ' | ' + window.__hpw.document.body.innerText; } catch (e) { return 'no window: ' + e.message; } });
  ok(/hjälp/.test(ptxt) && /Kortkommandon/.test(ptxt) && /Handbok/.test(ptxt), 'the quiet ? opens help as its own page (a new window: shortcuts, manual, lessons)', ptxt.slice(0, 120));
  ok(errors.length === 0, 'speed / replay / full screen: no page errors', errors.join(' | '));
  await ctx.close();
}

/* ---------- 5. touch: pinch zooms, two fingers pan (CDP touch, touchscreen laptops) ---------- */
if (want(5)) for (const [w, h] of [[1280, 800], [1920, 1080]]) {
  const { ctx, page, errors } = await open(browser, { width: w, height: h, touch: true });
  const cdp = await ctx.newCDPSession(page);
  const g = await page.locator('#gl').boundingBox();
  const cx = g.x + g.width / 2, cy = g.y + g.height / 2;
  const cam = () => page.evaluate(() => { const c = TNC_UI.camera, t = TNC_UI.controls.target, v = c.position.clone().sub(t).normalize(); return { d: c.position.distanceTo(t), t: [t.x, t.y, t.z], dir: [v.x, v.y, v.z] }; });
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 2, radiusY: 2, force: 1 })) });
  const settle = () => page.waitForTimeout(500);
  await settle(); const c0 = await cam();
  /* pinch out: the fingers move apart → closer */
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 40 - i * 15, cy], [cx + 40 + i * 15, cy]]);
  await touch('touchEnd', []); await settle();
  const c1 = await cam();
  ok(c1.d < c0.d * 0.9, `${w}×${h} touch: a pinch zooms the 3-D view (distance ${c0.d.toFixed(0)} → ${c1.d.toFixed(0)})`);
  /* two fingers together → pan */
  await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 30 + i * 12, cy + i * 8], [cx + 30 + i * 12, cy + i * 8]]);
  await touch('touchEnd', []); await settle();
  const c2 = await cam();
  const moved = Math.hypot(c2.t[0] - c1.t[0], c2.t[1] - c1.t[1], c2.t[2] - c1.t[2]);
  ok(moved > 1, `${w}×${h} touch: a two-finger drag pans (target moved ${moved.toFixed(1)} mm)`);
  /* one finger → orbit (the camera moves, the target stays) */
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx + i * 15, cy]]);
  await touch('touchEnd', []); await settle();
  const c3 = await cam();
  const turned = Math.acos(Math.min(1, c3.dir[0] * c2.dir[0] + c3.dir[1] * c2.dir[1] + c3.dir[2] * c2.dir[2])) * 180 / Math.PI;
  ok(turned > 5 && Math.abs(c3.d - c2.d) < c2.d * 0.05 && await page.evaluate(() => getComputedStyle(document.getElementById('gl')).touchAction) === 'none',
    `${w}×${h} touch: one finger orbits (turned ${turned.toFixed(0)}°, same distance); the view keeps touch-action:none`);
  ok(errors.length === 0, `${w}×${h} touch: no page errors`, errors.join(' | '));
  await ctx.close();
}

/* ---------- 6. screen sizes: no horizontal overflow, nothing clipped ---------- */
if (want(6)) for (const [w, h] of [[1280, 720], [1366, 768], [1536, 864], [1920, 1080], [2560, 1440], [390, 844]]) {
  const phone = w <= 900;
  const { ctx, page, errors } = await open(browser, { width: w, height: h, touch: phone });
  const r = await page.evaluate((phone) => {
    const de = document.documentElement, out = [];
    const vis = (e) => { const s = getComputedStyle(e); return e.offsetParent !== null && s.visibility !== 'hidden' && e.getBoundingClientRect().width > 0; };
    const check = (sel, box) => [...document.querySelectorAll(sel)].filter(vis).forEach((e) => { const r = e.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (r.right > Math.min(innerWidth, b.right) + 1 || r.left < b.left - 1 || r.bottom > b.bottom + 1) out.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right)); });
    const bar = document.querySelector('.bar'); check('.bar > *:not(.hmore), .bar .hmore > *', bar);
    if (!phone) check('#sbar > *', document.getElementById('sbar'));
    const tp = document.querySelector('.tp'); if (!phone) check('.tp-row > *', tp);
    return { sw: de.scrollWidth, cw: de.clientWidth, clipped: out.filter((x) => !/hmore|dhead|gear-row/.test(x)), barH: bar.offsetHeight,
      sbarOver: phone ? 0 : document.getElementById('sbar').scrollWidth - document.getElementById('sbar').clientWidth };
  }, phone);
  ok(r.sw <= r.cw, `${w}×${h}: no horizontal page overflow`, `${r.sw} > ${r.cw}`);
  ok(r.clipped.length === 0 && r.sbarOver <= 1, `${w}×${h}: nothing clipped in the top bar, bottom bar or run row`, r.clipped.join(', ') + (r.sbarOver > 1 ? ' sbar+' + r.sbarOver : ''));
  if (!phone) ok(r.barH <= 52, `${w}×${h}: the top bar stays one row (${r.barH} px)`);
  await page.screenshot({ path: join(SHOTS, `shell-${w}x${h}.png`) });
  ok(errors.length === 0, `${w}×${h}: no page errors`, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\nshell: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
