#!/usr/bin/env node
/* The settings panel behind the gear (sim/setpanel.js): outcomes, not markup.
 *
 *   python3 build.py && node tests/ui/setpanel.mjs
 *
 * The gear opens a side panel (not the old modal), Esc closes it with the focus back on the gear; groups start collapsed and
 * expand to their controls; no key letters inside; a group mode sets its toggles and survives a reload; a flipped toggle makes
 * the group Custom; every toggle changes the simulator (chips, coolant, smoke, labels, vice, flow view, axis vectors, pick,
 * speed); the theme swatch sets html[data-theme] and persists; open('view') expands View; every setting of the old modal and
 * of the old Effects and view menu is reachable; phones get a full-width panel with 44 px targets; no page errors.
 * Chromium: Playwright's, /opt/pw-browsers, or PW_CHROMIUM. Exit 1 on any failure.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIM = join(ROOT, 'index.html');
if (!existsSync(SIM)) { console.error('index.html missing: run python3 build.py'); process.exit(1); }
const URL = pathToFileURL(SIM).href;

let pass = 0, fail = 0; const failures = [];
function ok(c, name, detail = '') { if (c) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  (' + JSON.stringify(detail) + ')' : '')); } }

async function launch() {
  const args = ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const cands = [process.env.PW_CHROMIUM, ''];
  try { for (const d of readdirSync('/opt/pw-browsers')) if (/^chromium-\d+$/.test(d)) for (const sub of ['chrome-linux64', 'chrome-linux']) cands.push(`/opt/pw-browsers/${d}/${sub}/chrome`); } catch {}
  for (const exe of cands) {
    if (exe && !existsSync(exe)) continue;
    try { const br = await chromium.launch(exe ? { executablePath: exe, args } : { args }); return br; } catch (e) { if (exe === '') continue; }
  }
  console.error('no Chromium'); process.exit(1);
}

async function page(browser, { width = 1440, height = 900, lang = 'en' } = {}) {
  const mobile = width <= 900;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  await ctx.addInitScript(([lang]) => { try { if (localStorage.getItem('tnc.settings.v1') == null) localStorage.setItem('tnc.settings.v1', JSON.stringify({ v: 1, lang, setup: 1 })); } catch {} }, [lang]);
  const errors = [];
  const p = await fresh(ctx, errors);
  return { ctx, p, errors };
}
/* a new page in the same context (same storage): a reload without keeping a software-WebGL page's memory around */
async function fresh(ctx, errors, old) {
  if (old) await old.close();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); p.on('crash', () => { console.log('  !! page crashed'); errors.push('page crashed'); });
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.|ERR_FAILED|net::|GL Driver/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await load(p);
  return p;
}
async function load(p, reload) {
  if (reload) await p.reload(); else await p.goto(URL);
  await p.waitForFunction(() => document.querySelectorAll('#plist .blk').length > 5 && window.TNC_SETPANEL && TNC_SETPANEL.ready, null, { timeout: 60000 });
  if (await p.evaluate(() => !document.getElementById('setup').hidden)) await p.click('#setup-skip');
  await p.waitForTimeout(200);
}
const st = (p, k) => p.evaluate((k) => window.TNC_UI.state[k], k);
const isOpen = (p) => p.evaluate(() => { const s = document.getElementById('setpanel'); return !!s && !s.hidden && s.classList.contains('on'); });
const expanded = (p, g) => p.evaluate((g) => document.querySelector(`#setpanel [data-g="${g}"] .sp-hb`).getAttribute('aria-expanded') === 'true', g);
const sum = (p, g) => p.textContent(`#setpanel [data-sum="${g}"]`);
async function openGroup(p, g) { if (!(await expanded(p, g))) await p.click(`#setpanel [data-g="${g}"] .sp-hb`); await p.waitForTimeout(120); }
async function openPanel(p) { if (!(await isOpen(p))) { await p.click('#b-gear'); await p.waitForTimeout(150); } }

const browser = await launch();
try {
  /* ---------- desktop ---------- */
  console.log('desktop 1440 × 900');
  let { ctx, p, errors } = await page(browser);
  await p.click('#b-gear'); await p.waitForTimeout(200);
  const geo = await p.evaluate(() => { const s = document.getElementById('setpanel'), r = s.getBoundingClientRect();
    return { role: s.getAttribute('role'), modal: s.getAttribute('aria-modal'), left: Math.round(r.left), top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), old: !document.getElementById('m-set').hidden }; });
  ok(await isOpen(p) && geo.role === 'dialog' && geo.modal === 'true', 'the gear opens the settings panel (a modal dialog)', geo);
  ok(!geo.old, 'the old settings modal stays closed');
  ok(geo.left === 0 && geo.top === 0 && geo.h === 900 && geo.w <= 440, 'it is a full-height side panel on the left, not a centred modal', geo);
  ok(await p.evaluate(() => document.querySelector('.app').inert), 'the page behind it is inert');
  const groups = await p.$$eval('#setpanel .sp-hb', (b) => b.map((x) => x.closest('[data-g]').dataset.g + ':' + x.getAttribute('aria-expanded')));
  ok(groups.length >= 7 && groups.every((g) => g.endsWith(':false')), 'every group starts collapsed', groups);
  ok(await p.evaluate(() => [...document.querySelectorAll('#setpanel .sp-d')].every((d) => d.inert && d.getBoundingClientRect().height < 1)), 'collapsed groups show no detail and cannot be focused');
  ok(await p.evaluate(() => [...document.querySelectorAll('#setpanel .sp-hs')].filter((s) => s.textContent.trim()).length >= 6), 'the group rows show the current mode at a glance');
  ok(await p.evaluate(() => document.getElementById('fxmenu').hidden), 'the old Effects and view menu is gone from the 3-D view');

  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok(!(await isOpen(p)) && await p.evaluate(() => document.activeElement && document.activeElement.id === 'b-gear'), 'Esc closes it and the focus is back on the gear');
  ok(await p.evaluate(() => document.getElementById('setpanel').hidden && !document.querySelector('.app').inert), 'closed: hidden, the page live again');

  /* the ',' shortcut, keyboard expansion */
  await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press(','); await p.waitForTimeout(200);
  ok(await isOpen(p) && await p.evaluate(() => document.getElementById('m-set').hidden), "',' opens the panel");
  await p.focus('#setpanel [data-g="effects"] .sp-hb'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  ok(await expanded(p, 'effects'), 'Enter on a group row expands it');
  ok(await p.evaluate(() => { const t = document.querySelector('#setpanel [data-g="effects"] .sp-tile'); return !!t && t.getBoundingClientRect().height > 30 && t.getAttribute('role') === 'switch'; }), 'an expanded group shows its controls (switch tiles)');
  await p.keyboard.press(' '); await p.waitForTimeout(150);
  ok(!(await expanded(p, 'effects')), 'Space collapses it again');
  await p.keyboard.press(' '); await p.waitForTimeout(100);
  /* Tab stays inside */
  for (let i = 0; i < 40; i++) await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.getElementById('setpanel').contains(document.activeElement)), 'Tab stays inside the panel (focus trap)');

  /* no key letters */
  for (const g of ['look', 'camera', 'view', 'effects', 'machine', 'run', 'input', 'help', 'about']) await openGroup(p, g);
  const keys = await p.evaluate(() => { const s = document.getElementById('setpanel');
    const bad = [...s.querySelectorAll('kbd,small')].filter((e) => /^[A-Z]$/.test(e.textContent.trim())).map((e) => e.outerHTML);
    s.querySelectorAll('*').forEach((e) => { if (e.children.length === 0 && /^(P|K|B|L|V|G|X)$/.test(e.textContent.trim())) bad.push(e.outerHTML); });
    return { kbd: s.querySelectorAll('kbd').length, bad }; });
  ok(keys.kbd === 0 && keys.bad.length === 0, 'no key letters or shortcut hints inside the panel', keys);

  /* every setting of the old modal and the old menu is reachable */
  const reach = await p.evaluate(() => { const q = (s) => !!document.querySelector('#setpanel ' + s);
    return { lang: q('[data-k="lang"] [data-v="sr"]'), decimal: q('[data-k="decimal"] [data-v="comma"]'), skin: q('[data-k="skin"] [data-v="430"]'), env: q('[data-k="env"] [data-v="workshop-night"]'),
      quality: q('[data-k="quality"] [data-v="low"]'), motion: q('[data-k="motion"] [data-v="reduced"]'), sound: q('[data-t="sound"]'), tips: q('[data-t="tips"]'),
      profile: q('[data-act="profile"]'), lessons: q('[data-act="lessons"]'), keys: q('[data-act="keys"]'), intro: q('[data-act="intro"]'), resetHelp: q('[data-act="reset"]'),
      devlog: q('[data-act="dev"]'), diagnostics: q('[data-act="diag"]'), aboutGitHub: q('#sp-gh'), aboutText: /HEIDENHAIN/.test(document.querySelector('#setpanel [data-g="about"]').textContent),
      theme: q('[data-k="theme"] [role=radio]'), chips: q('[data-t="chips"]'), coolant: q('[data-t="cool"]'), smoke: q('[data-t="smoke"]'), labels: q('[data-t="labels"]'), vice: q('[data-t="vice"]'),
      flow: q('[data-t="flow"]'), vectors: q('[data-t="vectors"]'), pick: q('[data-t="pick"]'), material: q('[data-k="material"] [data-v="brass"]'), speed: q('[data-k="speed"] [data-v="64"]'),
      camera: q('[data-k="dir"] [data-v="FRONT"]'), replay: q('[data-t="replay"]'), keepgoing: q('[data-t="keepgoing"]'), fskey: q('[data-act="fskey"]') }; });
  const missing = Object.entries(reach).filter(([, v]) => !v).map(([k]) => k);
  ok(missing.length === 0, `every old setting is reachable (${Object.keys(reach).length}: ${Object.keys(reach).join(', ')})`, missing);
  const radios = await p.evaluate(() => [...document.querySelectorAll('#setpanel [role=radiogroup]')].every((g) => g.querySelectorAll('[role=radio]').length > 1 && g.querySelector('[aria-checked="true"]') !== null || g.dataset.k === 'dir'));
  ok(radios, 'modes and choices are radio groups with one choice checked');

  /* effects mode -> toggles, reload */
  await p.click('#setpanel [data-k="mode:effects"] [data-v="off"]'); await p.waitForTimeout(150);
  let s = await p.evaluate(() => ({ fx: TNC_UI.state.fx, cool: TNC_UI.state.fxCool, fire: TNC_UI.state.fxFire, sound: TNC_SETTINGS.get('sound') }));
  ok(!s.fx && !s.cool && !s.fire && !s.sound, 'Effects mode Off switches chips, coolant, smoke and sound off', s);
  await p.click('#setpanel [data-k="mode:effects"] [data-v="full"]'); await p.waitForTimeout(150);
  s = await p.evaluate(() => ({ fx: TNC_UI.state.fx, cool: TNC_UI.state.fxCool, fire: TNC_UI.state.fxFire, sound: TNC_SETTINGS.get('sound') }));
  ok(s.fx && s.cool && s.fire && s.sound, 'Effects mode Full switches them all on', s);
  ok(await p.evaluate(() => [...document.querySelectorAll('#setpanel [data-g="effects"] .sp-tile')].every((t) => t.getAttribute('aria-checked') === 'true')), 'the tiles light up with the mode');
  await p.click('#setpanel [data-k="mode:effects"] [data-v="calm"]'); await p.waitForTimeout(150);
  p = await fresh(ctx, errors, p);
  s = await p.evaluate(() => ({ fx: TNC_UI.state.fx, cool: TNC_UI.state.fxCool, fire: TNC_UI.state.fxFire, store: JSON.parse(localStorage.getItem('tnc.setpanel.v1') || '{}').groups || TNC_SETTINGS.get('groups') }));
  await openPanel(p);
  ok(s.fx && s.cool && !s.fire && (await sum(p, 'effects')) === 'Calm' && s.store && s.store.effects === 'calm', 'the Calm mode and its toggles survive a reload', { s, sum: await sum(p, 'effects') });
  await openGroup(p, 'effects');
  await p.click('#setpanel [data-t="chips"]'); await p.waitForTimeout(150);
  ok((await sum(p, 'effects')) === 'Custom' && await p.evaluate(() => document.querySelector('#setpanel [data-k="mode:effects"] [data-v="custom"]').getAttribute('aria-checked') === 'true'), 'flipping a toggle switches the group to Custom');
  await openGroup(p, 'view');
  await p.click('#setpanel [data-k="mode:view"] [data-v="clean"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !TNC_UI.state.labels && document.getElementById('b-vec').getAttribute('aria-pressed') === 'false' && document.getElementById('b-pick').getAttribute('aria-pressed') === 'false'), 'View mode Clean switches labels, axis vectors and pick off');
  await p.click('#setpanel [data-k="mode:view"] [data-v="standard"]'); await p.waitForTimeout(150);

  /* each toggle changes the simulator */
  for (const [t, read, grp] of [['chips', 'fx', 'effects'], ['cool', 'fxCool', 'effects'], ['smoke', 'fxFire', 'effects'], ['labels', 'labels', 'view'], ['flow', 'flowView', 'view'], ['vice', 'vice', 'machine']]) {
    await openGroup(p, grp);
    const a = await st(p, read); await p.click(`#setpanel [data-t="${t}"]`); await p.waitForTimeout(150); const b = await st(p, read);
    const aria = await p.getAttribute(`#setpanel [data-t="${t}"]`, 'aria-checked');
    ok(a !== b && aria === String(b), `toggle ${t} changes the simulator (${read}: ${a} → ${b})`);
    await p.click(`#setpanel [data-t="${t}"]`); await p.waitForTimeout(120);
  }
  for (const [t, id] of [['vectors', 'b-vec'], ['pick', 'b-pick']]) {
    const a = await p.getAttribute('#' + id, 'aria-pressed'); await p.click(`#setpanel [data-t="${t}"]`); await p.waitForTimeout(120); const b = await p.getAttribute('#' + id, 'aria-pressed');
    ok(a !== b, `toggle ${t} changes the view aid (${a} → ${b})`); await p.click(`#setpanel [data-t="${t}"]`); await p.waitForTimeout(100);
  }
  await openGroup(p, 'run');
  { const a = await p.getAttribute('#setpanel [data-t="keepgoing"]', 'aria-checked'); await p.click('#setpanel [data-t="keepgoing"]'); await p.waitForTimeout(120);
    const b = await p.getAttribute('#setpanel [data-t="keepgoing"]', 'aria-checked');
    const kv = await p.evaluate(() => ('keepgoing' in TNC_SETTINGS.DEF) ? TNC_SETTINGS.get('keepgoing') : JSON.parse(localStorage.getItem('tnc.setpanel.v1') || '{}').keepgoing);
    ok(a !== b && String(kv) === b, 'Continue after errors flips the keepgoing setting', { a, b, kv }); await p.click('#setpanel [data-t="keepgoing"]'); await p.waitForTimeout(100); }
  await p.click('#setpanel [data-k="speed"] [data-v="64"]'); await p.waitForTimeout(120);
  ok((await st(p, 'speed')) === 64 && (await sum(p, 'run')).startsWith('64×'), 'the speed segment sets the run speed');
  await openGroup(p, 'machine');
  await p.click('#setpanel [data-k="material"] [data-v="brass"]'); await p.waitForTimeout(120);
  ok(await p.evaluate(() => TNC_MATERIALS.current.id === 'brass'), 'a material tile selects the stock material');
  await p.click('#setpanel [data-k="quality"] [data-v="medium"]'); await p.waitForTimeout(120);
  ok(await p.evaluate(() => TNC_SETTINGS.get('quality') === 'medium' && document.documentElement.dataset.quality === 'medium'), 'graphics quality is set');
  await openGroup(p, 'camera');
  await p.click('#setpanel [data-k="dir"] [data-v="FRONT"]'); await p.waitForTimeout(150);
  ok((await st(p, 'view')) === 'FRONT', 'the camera direction segment turns the view (FRONT)');
  await p.click('#setpanel [data-k="mode:camera"] [data-v="follow"]'); await p.waitForTimeout(150);
  ok((await st(p, 'cam')) === 'tool' && (await sum(p, 'camera')).startsWith('Follow'), 'camera mode Follow follows the tool');
  await p.click('#setpanel [data-k="mode:camera"] [data-v="still"]'); await p.waitForTimeout(150);
  ok(!(await st(p, 'cam')), 'camera mode Still stops following');
  /* arrow keys in a radio group */
  await p.focus('#setpanel [data-k="speed"] [aria-checked="true"]'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(120);
  ok((await st(p, 'speed')) === 16, 'arrow keys move and choose in a radio group');

  /* appearance */
  await openGroup(p, 'look');
  await p.click('#setpanel [data-k="theme"] [data-v="cream"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.documentElement.dataset.theme === 'cream'), 'a theme swatch sets html[data-theme]');
  await p.click('#setpanel [data-k="skin"] [data-v="430"]'); await p.waitForTimeout(120);
  await p.click('#setpanel [data-k="decimal"] [data-v="point"]'); await p.waitForTimeout(120);
  await openGroup(p, 'effects');
  await p.click('#setpanel [data-k="motion"] [data-v="full"]'); await p.waitForTimeout(120);
  await openGroup(p, 'input');
  await p.click('#setpanel [data-t="tips"]'); await p.waitForTimeout(120);
  ok(await p.evaluate(() => TNC_SETTINGS.get('skin') === '430' && TNC_SETTINGS.get('decimal') === 'point' && TNC_SETTINGS.get('motion') === 'full' && TNC_SETTINGS.get('tips') === false), 'controller, decimal character, motion and hints are set');
  await p.click('#setpanel [data-act="fskey"]'); await p.keyboard.press('F9'); await p.waitForTimeout(120);
  ok((await p.textContent('#setpanel .sp-capv')) === 'F9' && (await isOpen(p)), 'the full-screen key is captured by pressing it');
  await p.click('#setpanel [data-k="lang"] [data-v="sv"]'); await p.waitForTimeout(200);
  ok((await p.textContent('#setpanel .sp-title')) === 'Inställningar' && (await sum(p, 'effects')) === 'Egen' && await p.evaluate(() => document.activeElement.dataset.v === 'sv'), 'the language changes the panel live and keeps the focus');
  await p.click('#setpanel [data-k="lang"] [data-v="en"]'); await p.waitForTimeout(150);
  p = await fresh(ctx, errors, p);
  ok(await p.evaluate(() => document.documentElement.dataset.theme === 'cream' && TNC_SETTINGS.get('skin') === '430' && (JSON.parse(localStorage.getItem('tnc.setpanel.v1') || '{}').fskey || TNC_SETTINGS.get('fskey')) === 'F9'), 'the theme, the controller and the full-screen key persist across a reload');

  /* open('view') */
  await p.evaluate(() => TNC_SETPANEL.open('view')); await p.waitForTimeout(200);
  ok(await isOpen(p) && await expanded(p, 'view') && await p.evaluate(() => document.activeElement === document.querySelector('#setpanel [data-g="view"] .sp-hb')), "open('view') opens with View expanded and focused");
  /* the old dialogs behind the help rows */
  await openGroup(p, 'help');
  await p.click('#setpanel [data-act="keys"]'); await p.waitForTimeout(250);
  ok(!(await isOpen(p)) && await p.evaluate(() => !document.getElementById('m-help').hidden && document.querySelector('#help-tabs [data-tab="keys"]').getAttribute('aria-selected') === 'true'), 'Shortcuts opens the help with the key list');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await openPanel(p); await openGroup(p, 'help');
  await p.click('#setpanel [data-act="dev"]'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => !document.getElementById('m-dev').hidden && document.getElementById('m-set').hidden), 'Developer log opens the log (not the old settings)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await openPanel(p); await openGroup(p, 'help');
  await p.click('#setpanel [data-act="profile"]'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => !document.getElementById('m-prof').hidden), 'Profile opens the profile');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await openPanel(p); await openGroup(p, 'help');
  await p.click('#setpanel [data-act="intro"]'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => !document.getElementById('setup').hidden), 'Show the introduction replays the first-run setup');
  await p.click('#setup-skip'); await p.waitForTimeout(150);
  await openPanel(p); await openGroup(p, 'help');
  await p.click('#setpanel [data-act="reset"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => TNC_SETTINGS.get('setup') === 0), 'Reset help clears the setup flag');
  ok(errors.length === 0, 'no page errors (desktop)', errors.slice(0, 5));
  await ctx.close();

  /* ---------- phone ---------- */
  console.log('phone 390 × 844');
  const ph = await page(browser, { width: 390, height: 844 });
  await ph.p.click('#b-menu'); await ph.p.waitForTimeout(250); await ph.p.click('#b-gear'); await ph.p.waitForTimeout(250);
  const pg = await ph.p.evaluate(() => { const r = document.getElementById('setpanel').getBoundingClientRect(); return { l: r.left, w: r.width, sw: document.documentElement.scrollWidth }; });
  ok(await isOpen(ph.p) && pg.l === 0 && pg.w === 390 && pg.sw <= 390, 'phone: the gear in the drawer opens a full-width panel, no sideways scroll', pg);
  for (const g of ['look', 'view', 'effects', 'machine', 'run', 'input', 'help']) await openGroup(ph.p, g);
  const small = await ph.p.evaluate(() => [...document.querySelectorAll('#setpanel button')].filter((b) => !b.closest('[inert]') && b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.h < 44 || r.w < 44));
  ok(small.length === 0, 'phone: every control is at least 44 px', small.slice(0, 6));
  await ph.p.keyboard.press('Escape'); await ph.p.waitForTimeout(400);
  ok(!(await isOpen(ph.p)) && await ph.p.evaluate(() => ['b-menu', 'b-gear'].includes(document.activeElement && document.activeElement.id)), 'phone: Esc closes it, the focus goes back to the menu button');
  ok(ph.errors.length === 0, 'no page errors (phone)', ph.errors.slice(0, 5));
  await ph.ctx.close();
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
