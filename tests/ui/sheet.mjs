#!/usr/bin/env node
/* The profile sheet (sim/sheet.js): node tests/ui/sheet.mjs   (needs index.html: python3 build.py)
 * It swipes up from the bottom and closes with Esc, the scrim, or a drag down on the handle; the left side is flat lines
 * (namn / program / verktyg / maskiner / mapp / språk / tema / sparad) with no tip, heading or project text; the folder line
 * shows ✓ / ▲ / ✕ in the success / warning / danger colours; the right side holds the programs as cards, sorted by last use,
 * with sort and size controls, click = open, + Nytt program, rename, delete that asks first, arrow keys + Enter; on a phone it
 * fills the screen with the cards in one column. No page errors.
 * Playwright: `playwright` from node_modules, or PLAYWRIGHT_MODULE=<path>; PW_CHROMIUM=<chrome>. file:// only, no server. */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL_ = pathToFileURL(join(ROOT, 'index.html')).href;
let failures = 0, passes = 0; const errors = [];
const check = (c, m, d) => { if (c) passes++; else failures++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}${!c && d !== undefined ? '  [' + (typeof d === 'string' ? d : JSON.stringify(d)) + ']' : ''}`); };
const browser = await pw.chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

async function page({ width = 1440, height = 900, motion = 'reduce', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, isMobile: mobile || undefined, hasTouch: mobile });
  await ctx.addInitScript(() => { try { if (localStorage.getItem('tnc.settings.v1') == null) localStorage.setItem('tnc.settings.v1', JSON.stringify({ v: 1, lang: 'sv', setup: 1 })); } catch {} });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000);
  p.on('pageerror', e => errors.push(`pageerror ${width}: ${e.message}`));
  p.on('dialog', d => d.accept());
  const load = async () => { await p.goto(URL_); await p.waitForFunction(() => window.TNC_UI && TNC_UI.state.res && window.TNC_SHEET, null, { timeout: 90000 }); await p.waitForTimeout(300);
    if (await p.locator('#setup:not([hidden])').count()) await p.click('#setup-skip'); };
  return { ctx, p, load };
}
const names = (p) => p.$$eval('#tsh-cards .tsh-card[data-m]', els => els.map(e => e.dataset.n));
const isOpen = (p) => p.evaluate(() => TNC_SHEET.isOpen && !document.getElementById('tsh').hidden);
const waitClosed = (p) => p.waitForFunction(() => !TNC_SHEET.isOpen && document.getElementById('tsh').hidden, null, { timeout: 20000 }).then(() => true, () => false);

/* ---------- desktop ---------- */
{
  const { ctx, p, load } = await page({ motion: 'no-preference' });
  await load(); await p.evaluate(() => { localStorage.clear(); return window.idbKeyval && idbKeyval.clear && idbKeyval.clear(); }); await load();
  // three own programs, made in order A B C (each one opens: last used), then A again
  await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
    for (const n of ['ALPHA', 'BRAVO', 'CHARLIE']) { TNC_UI.addProgram(n, `BEGIN PGM ${n} MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nEND PGM ${n} MM`); await w(15); }
    TNC_UI.library.open(TNC_UI.state.machine, 'ALPHA.H'); });

  // opens from the bottom, animated
  await p.evaluate(() => TNC_SHEET.open());
  const t0 = await p.evaluate(() => { const m = new DOMMatrix(getComputedStyle(document.getElementById('tsh')).transform); return m.m42; });
  await p.waitForFunction(() => new DOMMatrix(getComputedStyle(document.getElementById('tsh')).transform).m42 === 0, null, { timeout: 30000 }).catch(() => {});
  const geo = await p.evaluate(() => { const r = document.getElementById('tsh').getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(document.getElementById('tsh')).transform);
    return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, ty: m.m42, vw: innerWidth, vh: innerHeight }; });
  check(t0 > 0 && geo.ty === 0, 'sheet slides up from below (translateY > 0 at the start, 0 when open)', { t0, ty: geo.ty });
  check(Math.abs(geo.bottom - geo.vh) < 1 && geo.left === 0 && Math.abs(geo.width - geo.vw) < 1 && geo.top > geo.vh * 0.15, 'it is a bottom sheet: full width, anchored to the bottom edge, not a centred popup', geo);
  check(await p.evaluate(() => document.activeElement && document.getElementById('tsh').contains(document.activeElement)), 'focus moves into the sheet');

  // flat lines, nothing else
  const labels = await p.$$eval('#tsh-lines .tsh-ln > .a', els => els.map(e => e.textContent));
  check(JSON.stringify(labels) === JSON.stringify(['namn', 'program', 'verktyg', 'maskiner', 'mapp', 'språk', 'tema', 'sparad']), 'the left side is the flat lines namn / program / verktyg / maskiner / mapp / språk / tema / sparad', labels);
  const prose = await p.evaluate(() => { const s = document.getElementById('tsh'); const txt = s.innerText;
    return { tips: s.querySelectorAll('[data-tip],[title]').length, heads: s.querySelectorAll('h1,h2,h3,h4,h5,h6,p,.note,.prose').length,
      project: /projekt|project|projekat/i.test(txt), name: /ditt namn|your name/i.test(txt), profilHeading: txt.split('\n').some(l => /^\s*profil\s*$/i.test(l)) }; });
  check(prose.tips === 0 && prose.heads === 0 && !prose.project && !prose.name && !prose.profilHeading, 'no tip text, no headings or explanations, no project text', prose);
  check(await p.$eval('#tsh-lines .ln-pgm .v', e => /1 egna/.test(e.textContent) === false && /\d+ egna · \d+ exempel/.test(e.textContent)), 'program line counts own programs and examples');
  check(await p.$eval('#tsh-name', e => e.tagName === 'INPUT'), 'namn is an input on its line');
  await p.fill('#tsh-name', 'Testare'); await p.waitForTimeout(500);
  check(await p.evaluate(() => TNC_UI.profile.name) === 'Testare', 'typing a name saves it into the profile');

  // folder status glyphs in their colours
  const colours = await p.evaluate(async () => {
    const out = {}, cs = getComputedStyle(document.getElementById('tsh'));
    const want = { ok: cs.getPropertyValue('--scr-success').trim(), warn: cs.getPropertyValue('--scr-warning').trim(), bad: cs.getPropertyValue('--scr-danger').trim() };
    const real = TNC_UI.profile.folder;
    const tmp = document.createElement('i'); document.body.appendChild(tmp); const rgb = c => { tmp.style.color = c; return getComputedStyle(tmp).color; };
    for (const st of ['ok', 'warn', 'bad']) {
      TNC_UI.profile.folder = async () => ({ state: st, path: st === 'ok' ? 'default' : 'Downloads/TNC-SIMULATOR' });
      TNC_SHEET.close(); TNC_SHEET.open(); await new Promise(r => setTimeout(r, 80));
      const g = document.querySelector('#tsh-lines .ln-folder [data-glyph]');
      out[st] = { glyph: g && g.textContent, kind: g && g.dataset.glyph, colour: g && getComputedStyle(g).color, want: rgb(want[st]), path: document.querySelector('#tsh-lines .ln-folder .v').textContent };
    }
    TNC_UI.profile.folder = real; tmp.remove(); return out;
  });
  check(colours.ok.glyph === '✓' && colours.ok.colour === colours.ok.want && /default/.test(colours.ok.path), 'folder ok: green ✓ default', colours.ok);
  check(colours.warn.glyph === '▲' && colours.warn.colour === colours.warn.want && /Downloads\/TNC-SIMULATOR/.test(colours.warn.path), 'folder uncertain: yellow ▲ with the path', colours.warn);
  check(colours.bad.glyph === '✕' && colours.bad.colour === colours.bad.want, 'folder broken: red ✕', colours.bad);
  check(new Set([colours.ok.colour, colours.warn.colour, colours.bad.colour]).size === 3, 'the three states have three different colours');

  // cards: last used first
  await p.evaluate(() => TNC_SHEET.close()); await waitClosed(p);
  await p.evaluate(() => TNC_SHEET.open()); await p.waitForTimeout(400);
  let n = await names(p);
  check(n[0] === 'ALPHA.H' && n[1] === 'CHARLIE.H' && n[2] === 'BRAVO.H', 'cards are sorted by last used by default (ALPHA opened last, then CHARLIE, BRAVO)', n.slice(0, 4));
  check(await p.evaluate(() => document.querySelector('#tsh-sort [aria-checked=true]').dataset.sort) === 'recent', 'sort control shows "senast använd" chosen');
  const card0 = await p.$eval('#tsh-cards .tsh-card[data-m]', c => ({ nm: c.querySelector('.tsh-nm').textContent, l1: c.querySelector('.l1').textContent, l3: c.querySelector('.l3').textContent }));
  check(card0.nm === 'ALPHA.H' && /i dag \d\d:\d\d/.test(card0.l1) && /^(426|430) · /.test(card0.l3) && / B$| kB$/.test(card0.l3), 'a card shows the name big, last used, machine, check and size', card0);
  await p.waitForFunction(() => { const c = document.querySelector('#tsh-cards .tsh-card[data-m]'); return c && c.querySelector('[data-glyph]') && !/…/.test(c.querySelector('.l2').textContent); }, null, { timeout: 60000 }).catch(() => {});
  check(await p.$eval('#tsh-cards .tsh-card[data-m]', c => /\d+ block · \d\d:\d\d/.test(c.querySelector('.l2').textContent) && !!c.querySelector('.st [data-glyph]')), 'blocks, run time and the check glyph fill in');

  // sort by name, size controls
  await p.click('#tsh-sort [data-sort=name]'); n = await names(p);
  check(n.join() === [...n].sort().join(), 'sort by namn orders the cards by name', n.slice(0, 5));
  await p.click('#tsh-sort [data-sort=size]'); const sz = await p.$$eval('#tsh-cards .tsh-card[data-m] .l3', els => els.map(e => e.textContent));
  check(sz.length > 3, 'sort by storlek redraws the cards');
  const wM = await p.$eval('#tsh-cards .tsh-card[data-m]', c => c.getBoundingClientRect().width);
  await p.click('#tsh-size [data-size=L]'); const wL = await p.$eval('#tsh-cards .tsh-card[data-m]', c => c.getBoundingClientRect().width);
  await p.click('#tsh-size [data-size=S]'); const wS = await p.$eval('#tsh-cards .tsh-card[data-m]', c => c.getBoundingClientRect().width);
  check(wL > wM && wM > wS, 'card size S / M / L changes the card width', { wS, wM, wL });
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('tnc.sheet.v1')).size) === 'S', 'the chosen size is remembered');
  await p.click('#tsh-sort [data-sort=recent]'); await p.click('#tsh-size [data-size=M]');

  // keyboard: arrows move through cards, Enter opens
  await p.focus('#tsh-cards .tsh-card[data-n="ALPHA.H"] .tsh-open');
  await p.keyboard.press('ArrowRight');
  check(await p.evaluate(() => document.activeElement.closest('.tsh-card').dataset.n) === 'CHARLIE.H', 'ArrowRight moves to the next card');
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  check(await p.evaluate(() => !!document.activeElement.closest('.tsh-new')), 'ArrowLeft reaches the + Nytt program card');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter');
  check(await waitClosed(p) && await p.evaluate(() => TNC_UI.program.name) === 'CHARLIE.H', 'Enter on a card opens that program and closes the sheet');

  // click opens
  await p.evaluate(() => TNC_SHEET.open()); await p.waitForTimeout(400);
  await p.click('#tsh-cards .tsh-card[data-n="BRAVO.H"] .tsh-open');
  check(await waitClosed(p) && await p.evaluate(() => TNC_UI.program.name) === 'BRAVO.H', 'clicking a card opens the program');
  await p.evaluate(() => TNC_SHEET.open()); await p.waitForTimeout(400);
  check((await names(p))[0] === 'BRAVO.H', '…and it moves to the front (last used)');

  // + Nytt program
  await p.click('#tsh-cards .tsh-new .tsh-open'); await p.fill('#tsh-nn', 'delta'); await p.keyboard.press('Enter');
  check(await waitClosed(p) && await p.evaluate(() => TNC_UI.program.name === 'DELTA.H' && /BEGIN PGM DELTA MM/.test(TNC_UI.program.text)), '+ Nytt program creates DELTA.H and opens it');

  // rename
  await p.evaluate(() => TNC_SHEET.open()); await p.waitForTimeout(400);
  await p.click('#tsh-cards .tsh-card[data-n="CHARLIE.H"] .tsh-more');
  check(await p.isVisible('#tsh-cards .tsh-card[data-n="CHARLIE.H"] .tsh-menu [data-a=text]') && await p.isVisible('#tsh-cards .tsh-card[data-n="CHARLIE.H"] .tsh-menu [data-a=dl]'), 'the ⋯ menu offers öppna i texteditor and ladda ner .H');
  await p.click('#tsh-cards .tsh-card[data-n="CHARLIE.H"] [data-a=rename]'); await p.fill('#tsh-rn', 'BRAVO'); await p.keyboard.press('Enter');
  check(/finns redan/.test(await p.textContent('#tsh-rn-msg')), 'renaming to a taken name says so');
  await p.fill('#tsh-rn', 'ECHO'); await p.keyboard.press('Enter');
  check((await names(p)).includes('ECHO.H') && !(await names(p)).includes('CHARLIE.H') && await p.evaluate(() => TNC_UI.library.text(TNC_UI.state.machine, 'ECHO.H') != null), 'rename moves CHARLIE.H to ECHO.H');

  // delete asks first
  await p.click('#tsh-cards .tsh-card[data-n="ECHO.H"] .tsh-more'); await p.click('#tsh-cards .tsh-card[data-n="ECHO.H"] [data-a=del]');
  const q = await p.textContent('#tsh-cards .tsh-card[data-n="ECHO.H"] .tsh-menu .q').catch(() => '');
  check(/Radera ECHO\.H\?/.test(q) && await p.evaluate(() => TNC_UI.library.text(TNC_UI.state.machine, 'ECHO.H') != null), 'radera asks first and nothing is deleted yet', q);
  await p.keyboard.press('Escape');
  check(await isOpen(p) && await p.evaluate(() => TNC_UI.library.text(TNC_UI.state.machine, 'ECHO.H') != null), 'Esc cancels the question, the sheet stays open');
  await p.click('#tsh-cards .tsh-card[data-n="ECHO.H"] .tsh-more'); await p.click('#tsh-cards .tsh-card[data-n="ECHO.H"] [data-a=del]');
  await p.click('#tsh-cards .tsh-card[data-n="ECHO.H"] [data-a=del-yes]');
  check(!(await names(p)).includes('ECHO.H') && await p.evaluate(() => TNC_UI.library.text(TNC_UI.state.machine, 'ECHO.H') == null), 'confirming deletes ECHO.H');
  const ex = await p.$eval('#tsh-cards .tsh-card[data-n="NAMEPLATE.H"]', c => c.dataset.n).catch(() => null);
  if (ex) { await p.click('#tsh-cards .tsh-card[data-n="NAMEPLATE.H"] .tsh-more');
    check(!(await p.$('#tsh-cards .tsh-card[data-n="NAMEPLATE.H"] [data-a=del]')) && !(await p.$('#tsh-cards .tsh-card[data-n="NAMEPLATE.H"] [data-a=rename]')), 'an unchanged example cannot be deleted or renamed'); await p.keyboard.press('Escape'); }

  // Esc closes, focus trap
  for (let i = 0; i < 60; i++) await p.keyboard.press('Tab');
  check(await p.evaluate(() => document.getElementById('tsh').contains(document.activeElement)), 'Tab keeps the focus inside the sheet');
  check(await p.evaluate(() => TNC_UI.state.mode) !== 'edit', 'keys typed in the sheet do not reach the simulator');
  await p.keyboard.press('Escape');
  check(await waitClosed(p), 'Esc closes the sheet');

  // swipe / drag down on the handle closes; a small drag snaps back
  await p.evaluate(() => TNC_SHEET.open()); await p.waitForTimeout(450);
  let g = await p.$eval('#tsh-grab', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x, g.y + 20, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
  check(await isOpen(p), 'a short drag on the handle snaps back');
  await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x, g.y + 260, { steps: 8 }); await p.mouse.up();
  check(await waitClosed(p), 'dragging the handle down closes the sheet');
  await p.evaluate(() => TNC_SHEET.open()); await p.waitForTimeout(450);
  await p.mouse.click(700, 40);
  check(await waitClosed(p), 'a click on the dimmed workspace above closes it');

  // stored projects of an older profile stay readable (never lost), and are not shown
  const kept = await p.evaluate(() => Array.isArray(TNC_UI.state.projects));
  check(kept, 'older project data stays in the profile state');
  await p.screenshot({ path: join(ROOT, 'local', 'sheet-desktop.png') });
  await ctx.close();
}

/* ---------- phone ---------- */
{
  const { ctx, p, load } = await page({ width: 390, height: 844, mobile: true });
  await load();
  await p.evaluate(() => TNC_SHEET.open()); await p.waitForTimeout(300);
  const ph = await p.evaluate(() => { const r = document.getElementById('tsh').getBoundingClientRect(); const lefts = [...document.querySelectorAll('#tsh-cards .tsh-card')].map(c => Math.round(c.getBoundingClientRect().left));
    return { top: r.top, h: r.height, vh: innerHeight, cols: new Set(lefts).size, n: lefts.length, over: document.documentElement.scrollWidth - innerWidth }; });
  check(ph.top <= 1 && Math.abs(ph.h - ph.vh) < 2, 'phone: the sheet fills the screen', ph);
  check(ph.cols === 1 && ph.n > 3, 'phone: the cards are one column', ph);
  check(ph.over <= 0, 'phone: no horizontal page scroll', ph);
  await p.keyboard.press('Escape');
  check(await waitClosed(p), 'phone: Esc closes');
  await ctx.close();
}

check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${passes} passed · ${failures} failed`);
process.exit(failures ? 1 : 0);
