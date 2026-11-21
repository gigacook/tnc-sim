#!/usr/bin/env node
/* The text editor (sim/editor.js): node tests/ui/editor.mjs   (needs index.html: python3 build.py)
 * Opens the current program; typing says "ändrad, inte sparad"; Ctrl S saves (green "✓ sparad hh:mm"), the simulator runs the
 * new text and it survives a reload; Ångra ändringar reverts; Esc with unsaved changes asks Spara / Släng / Avbryt; an unsaved
 * draft survives a reload and is shown as a draft, not as saved; the live check finds an error and its line is clickable; a .H
 * file loaded through the file input opens, saves into the profile as the active program and is offered back as a download;
 * a plain text file saves by download. No page errors.
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
await ctx.addInitScript(() => { try { if (localStorage.getItem('tnc.settings.v1') == null) localStorage.setItem('tnc.settings.v1', JSON.stringify({ v: 1, lang: 'sv', setup: 1 })); } catch {} });
const p = await ctx.newPage(); p.setDefaultTimeout(30000);
p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
p.on('filechooser', () => {});   // file-chooser interception on from the start: the first Ctrl+O must not race it
const load = async () => { await p.goto(URL_); await p.waitForFunction(() => window.TNC_UI && TNC_UI.state.res && window.TNC_EDITOR, null, { timeout: 90000 }); await p.waitForTimeout(300);
  if (await p.locator('#setup:not([hidden])').count()) await p.click('#setup-skip'); };
const badge = () => p.evaluate(() => { const s = document.getElementById('ted-st'); return { state: s.dataset.state, text: s.textContent, colour: getComputedStyle(s).color }; });
const rgbOf = (v) => p.evaluate(v => { const i = document.createElement('i'); document.body.appendChild(i); i.style.color = getComputedStyle(document.documentElement).getPropertyValue(v); const c = getComputedStyle(i).color; i.remove(); return c; }, v);
const ta = () => p.inputValue('#ted-ta');
const persisted = () => p.waitForFunction(() => TNC_UI.profile.savedAt && Date.now() - TNC_UI.profile.savedAt.getTime() < 60000, null, { timeout: 20000 }).catch(() => {});

await load(); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('tnc.settings.v1', JSON.stringify({ v: 1, lang: 'sv', setup: 1 })); return window.idbKeyval && idbKeyval.clear && idbKeyval.clear(); }); await load();
await p.evaluate(() => TNC_UI.addProgram('EDTEST', 'BEGIN PGM EDTEST MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+80 Z+0\nTOOL CALL 1 Z S2000\nL Z+50 R0 FMAX M3\nEND PGM EDTEST MM'));
await p.waitForTimeout(400);

// opens the current program
await p.evaluate(() => TNC_EDITOR.open());
await p.waitForSelector('#ted:not([hidden])');
check(await p.textContent('#ted-fn') === 'EDTEST.H' && /^BEGIN PGM EDTEST MM\n/.test(await ta()), 'opens the current program (name and text)');
check(await p.evaluate(() => document.activeElement.id) === 'ted-ta', 'the text has the focus');
let b = await badge(); check(b.state === 'saved' && /^✓ sparad/.test(b.text), 'a program from the profile shows "✓ sparad"', b);
check(/inga fel/.test(await p.textContent('#ted-ck')), 'live check: ✓ inga fel');
const gut = await p.evaluate(() => document.getElementById('ted-gpre').textContent.split('\n').slice(0, 3).join(','));
check(gut === '0,1,2', 'line numbers count like blocks (0, 1, 2 …)', gut);

// typing -> amber "ändrad, inte sparad"
await p.keyboard.press('Control+End'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('End');
await p.keyboard.type('\nL X+50 Y+40 R0 FMAX');
b = await badge(); const amber = await rgbOf('--gc-warning'), green = await rgbOf('--gc-success');
check(b.state === 'dirty' && b.text === '● ändrad, inte sparad' && b.colour === amber, 'typing shows "● ändrad, inte sparad" in amber', b);
check(await p.evaluate(() => TNC_UI.program.text.includes('L X+50 Y+40')) === false, '…and the simulator still has the saved text');
check(await p.evaluate(() => TNC_UI.state.mode) !== 'edit' && !(await p.evaluate(() => TNC_UI.state.editing)), 'letters typed in the editor do not reach the simulator shortcuts');

// Tab indents with spaces, Shift+Tab takes them back
await p.keyboard.press('Home'); await p.keyboard.press('Tab');
check((await ta()).includes('\n  L X+50 Y+40 R0 FMAX'), 'Tab indents the line with two spaces');
await p.keyboard.press('Shift+Tab');
check((await ta()).includes('\nL X+50 Y+40 R0 FMAX'), 'Shift+Tab takes the indent back');

// Ctrl S saves: green, the simulator runs the new text
await p.keyboard.press('Control+s'); await p.waitForTimeout(300);
b = await badge();
check(b.state === 'saved' && /^✓ sparad \d\d:\d\d$/.test(b.text) && b.colour === green, 'Ctrl S: "✓ sparad hh:mm" in green', b);
const sim = await p.evaluate(() => ({ name: TNC_UI.program.name, has: TNC_UI.program.text.includes('L X+50 Y+40 R0 FMAX'), blocks: TNC_UI.state.res.blocks.length, raw: TNC_UI.state.res.blocks.some(x => x.raw === 'L X+50 Y+40 R0 FMAX') }));
check(sim.name === 'EDTEST.H' && sim.has && sim.raw, 'the simulator runs the saved text (the new block is in its run)', sim);
check(await p.evaluate(() => localStorage.getItem('tnc.editor.draft.v1')) === null, 'no draft is left once it is saved');
await persisted(); await p.waitForTimeout(500);

// survives a reload
await load();
check(await p.evaluate(() => (TNC_UI.library.text(TNC_UI.state.machine, 'EDTEST.H') || '').includes('L X+50 Y+40 R0 FMAX')), 'the saved text survives a reload');
check(await p.evaluate(() => !TNC_EDITOR.isOpen), 'a saved file does not reopen the editor after a reload');

// revert
await p.evaluate(() => TNC_EDITOR.open('EDTEST.H')); await p.waitForSelector('#ted:not([hidden])');
await p.click('#ted-ta'); await p.keyboard.press('Control+End'); await p.keyboard.type('\n; JUNK');
check((await badge()).state === 'dirty' && await p.isEnabled('#ted-revert'), 'a change enables Ångra ändringar');
await p.click('#ted-revert');
check(!(await ta()).includes('; JUNK') && (await badge()).state === 'saved' && !(await p.isEnabled('#ted-revert')), 'Ångra ändringar puts the saved text back');

// Esc with unsaved changes asks; Avbryt keeps; Släng drops
await p.click('#ted-ta'); await p.keyboard.press('Control+End'); await p.keyboard.type('\n; MAYBE');
await p.keyboard.press('Escape');
check(await p.isVisible('#ted-ask') && /Spara ändringar i EDTEST\.H\?/.test(await p.textContent('#ted-ask')), 'Esc with unsaved changes asks "Spara ändringar i EDTEST.H?"');
const btns = await p.$$eval('#ted-ask button', bs => bs.map(x => x.textContent));
check(btns.join('|') === 'Spara|Släng|Avbryt', 'the choices are Spara / Släng / Avbryt', btns);
await p.click('#ted-ask [data-r=cancel]');
check(await p.evaluate(() => TNC_EDITOR.isOpen) && (await ta()).includes('; MAYBE'), 'Avbryt keeps the editor and the text');
await p.keyboard.press('Escape'); await p.click('#ted-ask [data-r=discard]');
check(await p.evaluate(() => !TNC_EDITOR.isOpen) && !(await p.evaluate(() => TNC_UI.program.text.includes('; MAYBE'))), 'Släng closes without saving');

// a draft survives a reload, and says it is a draft
await p.evaluate(() => TNC_EDITOR.open('EDTEST.H')); await p.waitForSelector('#ted:not([hidden])');
await p.click('#ted-ta'); await p.keyboard.press('Control+End'); await p.keyboard.type('\n; DRAFT LINE');
await p.waitForFunction(() => (localStorage.getItem('tnc.editor.draft.v1') || '').includes('DRAFT LINE'), null, { timeout: 10000 }).catch(() => {});
await load();
await p.waitForFunction(() => window.TNC_EDITOR && TNC_EDITOR.isOpen, null, { timeout: 10000 }).catch(() => {});
b = await badge();
check(await p.evaluate(() => TNC_EDITOR.isOpen) && (await ta()).includes('; DRAFT LINE'), 'after a reload the editor is back with the unsaved text');
check(b.state === 'draft' && b.text === '● utkast återställt, inte sparat' && b.colour === amber, 'the badge says draft, not saved', b);
check(!(await p.evaluate(() => TNC_UI.program.text.includes('DRAFT LINE'))), 'the draft is not in the saved program');
await p.keyboard.press('Escape'); await p.click('#ted-ask [data-r=save]');
check(await p.evaluate(() => !TNC_EDITOR.isOpen && TNC_UI.program.text.includes('; DRAFT LINE')), 'Spara in the question saves and closes');

// live check: an error, its line clickable
await p.evaluate(() => TNC_EDITOR.open('EDTEST.H')); await p.waitForSelector('#ted:not([hidden])');
await p.click('#ted-ta'); await p.keyboard.press('Control+Home'); await p.keyboard.press('End'); await p.keyboard.type('\nL X+10 FOOO');
await p.waitForFunction(() => /fel/.test(document.getElementById('ted-ck').textContent) && !/inga fel/.test(document.getElementById('ted-ck').textContent), null, { timeout: 10000 }).catch(() => {});
const ck = await p.textContent('#ted-ck');
check(/✕ 1 fel/.test(ck) && /rad 1:/.test(ck), 'live check: "✕ 1 fel" with the line of the first error', ck);
await p.keyboard.press('Control+End');
await p.click('#ted-ck [data-line]');
check(/rad 1, kol/.test(await p.textContent('#ted-pos')), 'clicking the error moves the caret to its line', await p.textContent('#ted-pos'));
await p.click('#ted-revert');

// find
await p.keyboard.press('Control+f'); await p.fill('#ted-q', 'tool call'); await p.keyboard.press('Enter');
check(await p.evaluate(() => { const t = document.getElementById('ted-ta'); return t.value.slice(t.selectionStart, t.selectionEnd); }) === 'TOOL CALL', 'Ctrl F finds text (case-insensitive) and selects it');
await p.keyboard.press('Escape');
check(await p.evaluate(() => TNC_EDITOR.isOpen), 'Esc in the find box closes the box only');

// a .H file from disk through the file input
await p.evaluate(() => { window.__tedNoFSA = true; });
const pick = p.waitForEvent('filechooser');
await p.keyboard.press('Control+o');
const fc = await pick;
await fc.setFiles({ name: 'disk_part.h', mimeType: 'text/plain', buffer: Buffer.from('BEGIN PGM DISK_PART MM\r\nBLK FORM 0.1 Z X+0 Y+0 Z-10\r\nBLK FORM 0.2 X+50 Y+50 Z+0\r\nEND PGM DISK_PART MM\r\n') });
await p.waitForFunction(() => document.getElementById('ted-fn').textContent === 'disk_part.h', null, { timeout: 10000 }).catch(() => {});
b = await badge();
check(await p.textContent('#ted-fn') === 'disk_part.h' && /^BEGIN PGM DISK_PART MM\nBLK/.test(await ta()), 'Öppna fil (Ctrl O) opens a .H from disk', await p.textContent('#ted-fn'));
check(b.state === 'disk' && /från disk/.test(b.text), 'a file from disk is marked "från disk, inte sparad i profilen"', b);
check(/CRLF/.test(await p.textContent('#ted-enc')), 'its CRLF line ends are noted');
await p.click('#ted-ta'); await p.keyboard.press('Control+End'); await p.keyboard.type('\n; EDITED');
await p.keyboard.press('Control+s'); await p.waitForTimeout(300);
const disk = await p.evaluate(() => ({ cur: TNC_UI.program.name, text: TNC_UI.program.text }));
check(disk.cur === 'DISK_PART.H' && disk.text.includes('; EDITED') && !disk.text.includes('\r'), 'Ctrl S puts it into the profile as DISK_PART.H and makes it the active program', disk.cur);
check((await badge()).state === 'saved' && await p.isVisible('#ted-dl'), 'saved, and Ladda ner offers it back to disk');
const dl = p.waitForEvent('download'); await p.click('#ted-dl'); const d = await dl;
const body = await (async () => { const s = await d.createReadStream(); const ch = []; for await (const c of s) ch.push(c); return Buffer.concat(ch).toString('latin1'); })();
check(d.suggestedFilename() === 'disk_part.h' && body.includes('; EDITED') && body.includes('\r\n'), 'the download keeps the file name and its CRLF line ends', d.suggestedFilename());

// a plain text file: saved by download
await p.evaluate(() => TNC_EDITOR.close());
await p.evaluate(() => TNC_EDITOR.openFile());
const fc2 = await p.waitForEvent('filechooser');
await fc2.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain notes\nsecond line\n') });
await p.waitForFunction(() => document.getElementById('ted-fn').textContent === 'notes.txt', null, { timeout: 10000 }).catch(() => {});
check(await p.textContent('#ted-ck') === '' && (await p.evaluate(() => document.getElementById('ted-gpre').textContent.split('\n')[0])) === '1', 'a text file: no program check, lines count from 1');
await p.click('#ted-ta'); await p.keyboard.type('x');
const dl2 = p.waitForEvent('download'); await p.keyboard.press('Control+s'); const d2 = await dl2;
check(d2.suggestedFilename() === 'notes.txt' && (await badge()).state === 'saved', 'Ctrl S on a text file downloads it and shows saved');
check(await p.evaluate(() => TNC_UI.library.text(TNC_UI.state.machine, 'NOTES.H')) === null, '…and does not turn it into a program');
await p.keyboard.press('Escape');
check(await p.evaluate(() => !TNC_EDITOR.isOpen), 'Esc closes a saved file without asking');

check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${passes} passed · ${failures} failed`);
process.exit(failures ? 1 : 0);
