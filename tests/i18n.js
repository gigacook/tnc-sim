/* Interface languages: every text that exists in Swedish must exist in Serbian and in English, and the other way round.
   Fails on a missing key, an empty translation, a lost {placeholder}, Cyrillic in the Serbian (Latin script) tables,
   a translated CNC word, and a shell key (data-i18n…) without an entry.            Run:  node tests/i18n.js */
const fs = require('fs'), path = require('path');
const I = require('../sim/i18n.js'), SET = require('../sim/settings.js');
const { SHELL, TR, TX, PATTERNS } = I.tables;
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FAIL ' + msg); } };
const miss = (a, b) => Object.keys(a).filter((k) => !(k in b));
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();

ok(Object.keys(SET.LOCALES).join() === 'sv,en,sr' && SET.DEF.lang === 'sv', 'languages: sv (default), en, sr');
ok(SET.LOCALES.sr.html === 'sr-Latn' && SET.LOCALES.sr.name === 'Srpski' && SET.LOCALES.sr.comma === true && SET.LOCALES.sv.comma === true && SET.LOCALES.en.comma === false, 'locale table: Srpski = sr-Latn; sv and sr follow with a comma, en with a point');

/* (a) shell keys */
for (const l of ['sr', 'en']) {
  ok(miss(SHELL.sv, SHELL[l]).length === 0, `shell: every sv key exists in ${l} (missing: ${miss(SHELL.sv, SHELL[l]).join(', ')})`);
  ok(miss(SHELL[l], SHELL.sv).length === 0, `shell: every ${l} key exists in sv (missing: ${miss(SHELL[l], SHELL.sv).join(', ')})`);
}
for (const l of ['sv', 'en', 'sr']) {
  const empty = Object.keys(SHELL[l]).filter((k) => typeof SHELL[l][k] !== 'string' || !SHELL[l][k].trim());
  ok(empty.length === 0, `shell ${l}: no empty text (${empty.join(', ')})`);
  const lost = Object.keys(SHELL.en).filter((k) => SHELL[l][k] != null && holes(SHELL[l][k]) !== holes(SHELL.en[k]));
  ok(lost.length === 0, `shell ${l}: {placeholders} kept (${lost.join(', ')})`);
}
/* (b) control text and (c) script text, keyed by the English wording */
ok(miss(TR.sv, TR.sr).length === 0 && miss(TR.sr, TR.sv).length === 0, `control text: sv and sr hold the same entries (${miss(TR.sv, TR.sr).concat(miss(TR.sr, TR.sv)).join(' | ')})`);
ok(miss(TX.sv, TX.sr).length === 0 && miss(TX.sr, TX.sv).length === 0, `script text: sv and sr hold the same entries (${miss(TX.sv, TX.sr).concat(miss(TX.sr, TX.sv)).join(' | ')})`);
for (const l of ['sv', 'sr']) {
  const lost = Object.keys(TX[l]).filter((k) => holes(TX[l][k]) !== holes(k));
  ok(lost.length === 0, `script text ${l}: {placeholders} kept (${lost.join(' | ')})`);
  ok(Object.values(TR[l]).concat(Object.values(TX[l])).every((v) => typeof v === 'string' && v.trim()), `${l}: no empty control or script text`);
}
const half = PATTERNS.filter((p) => !p[1].sv || !p[1].sr);
ok(half.length === 0, `message patterns: each has sv and sr (${half.map((p) => p[0]).join(' ')})`);
const groups = PATTERNS.filter((p) => ['sv', 'sr'].some((l) => (p[1][l].match(/\$(\d)/g) || []).sort().join() !== (p[1].sv.match(/\$(\d)/g) || []).sort().join()));
ok(groups.length === 0, `message patterns: sv and sr use the same captured parts (${groups.map((p) => p[0]).join(' ')})`);

/* Serbian: Latin script only, with its own letters in use */
const allSr = Object.values(SHELL.sr).concat(Object.values(TR.sr), Object.values(TX.sr), PATTERNS.map((p) => p[1].sr)).join('\n');
ok(!/[Ѐ-ӿ]/.test(allSr), 'Serbian is in Latin script (no Cyrillic letter)');
ok(['č', 'ć', 'š', 'ž', 'đ'].every((c) => allSr.toLowerCase().includes(c)), 'Serbian uses č ć š ž đ');
const same = Object.keys(SHELL.sr).filter((k) => SHELL.sr[k] === SHELL.en[k] && /[a-z]{4,}/.test(SHELL.en[k]) && !/^(about\.gh|skin\.4|env\.|new\.ai|ws\.(program|status)|panel\.program|title\.profile|set\.profile|tip\.prof|prof\.who|kv\.(minz|ovr)|cmp\.aref|mode\.test)/.test(k));
ok(same.length === 0, `Serbian shell text is not left in English (${same.join(', ')})`);

/* CNC words stay as the control writes them, in every language */
for (const l of ['sv', 'sr']) {
  const cnc = ['CYCL DEF', 'CYCL CALL', 'TOOL DEF', 'TOOL CALL', 'PGM MGT', 'LBL SET', 'LBL CALL', 'APPR DEP', 'CP POLAR', 'RND', 'CHF', 'Q', 'L', 'CC', 'F MAX', 'F AUTO', 'NO ENT', 'ENT'];
  I.set(l);
  const changed = cnc.filter((w) => I.tr(w) !== w);
  ok(changed.length === 0, `${l}: CNC words are not translated (${changed.join(', ')})`);
}
/* the three lookups */
I.set('sr');
ok(I.t('run.start') === 'Pokreni' && I.t('run.stop') === 'Zaustavi' && I.t('btn.tools') === 'Alat' && I.t('set.title') === 'Podešavanja' && I.t('sys.polar') === 'Polarne koordinate', 'sr: Pokreni, Zaustavi, Alat, Podešavanja, Polarne koordinate');
ok(I.tr('TOOL 5 NOT DEFINED') === 'ALAT 5 NIJE DEFINISAN' && I.toast('UNDO · 3 LEFT') === 'PONIŠTENO · JOŠ 3' && I.toast('COOLANT OFF') === 'EMULZIJA ISKLJ.' && I.x('Delete {n}? This cannot be undone.', { n: 'A.H' }) === 'Obrisati A.H? Ovo ne može da se poništi.', 'sr: patterns, toasts and {placeholders} resolve');
ok(I.tr('SOMETHING UNKNOWN') === 'SOMETHING UNKNOWN' && I.x('not in the table') === 'not in the table', 'unknown text falls back to itself');
I.set('en');
ok(I.t('run.start') === 'Run' && I.tr('READY') === 'READY' && I.toast('UNDO · 3 LEFT') === 'UNDO · 3 LEFT', 'en: nothing is translated');
I.set('xx');
ok(I.lang === 'en', 'an unknown language is refused');

/* the shell: every data-i18n… key has an entry, and every T('key') the UI asks for exists */
const shell = fs.readFileSync(path.join(__dirname, '..', 'sim', 'sim-shell.html'), 'utf8'), ui = fs.readFileSync(path.join(__dirname, '..', 'sim', 'ui.js'), 'utf8');
const used = new Set([...shell.matchAll(/data-i18n(?:-label|-tip|-ph)?="([^"]+)"/g)].map((m) => m[1]).concat([...ui.matchAll(/\bT\('([a-z0-9.-]+)'\)/g)].map((m) => m[1])));
const noEntry = [...used].filter((k) => !(k in SHELL.sv));
ok(noEntry.length === 0, `every key the shell and ui.js ask for has an entry (${noEntry.join(', ')})`);
/* every English toast / label ui.js writes through X('…') has a Swedish and a Serbian entry */
const xs = [...ui.matchAll(/\bX\('((?:[^'\\]|\\.)+)'/g)].map((m) => m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n'));
const noX = xs.filter((k) => !(k in TX.sv));
ok(xs.length > 30 && noX.length === 0, `every X('…') text of ui.js is translated (${noX.join(' | ')})`);

/* the AI view (sim/aigen.js) keeps its own table: the same three languages, the same keys, nothing empty */
const AG = require('../sim/aigen.js').STR;
const flatAG = (o, p = '') => Object.keys(o).flatMap((k) => (o[k] && typeof o[k] === 'object' ? flatAG(o[k], p + k + '.') : [[p + k, o[k]]]));
const ag = { sv: new Map(flatAG(AG.sv)), en: new Map(flatAG(AG.en)), sr: new Map(flatAG(AG.sr)) };
ok(Object.keys(AG).join() === 'sv,en,sr', 'AI view: sv, en, sr');
for (const l of ['en', 'sr']) {
  const gone = [...ag.sv.keys()].filter((k) => !ag[l].has(k)).concat([...ag[l].keys()].filter((k) => !ag.sv.has(k)));
  ok(gone.length === 0, `AI view: sv and ${l} hold the same keys (${gone.join(', ')})`);
}
for (const l of ['sv', 'en', 'sr']) {
  const bad = [...ag[l]].filter(([k, v]) => typeof v !== 'string' || !v.trim() || holes(v) !== holes(ag.en.get(k)));
  ok(bad.length === 0, `AI view ${l}: no empty text, {placeholders} kept (${bad.map((b) => b[0]).join(', ')})`);
}
const agSr = [...ag.sr.values()].join('\n');
ok(!/[Ѐ-ӿ]/.test(agSr) && ['č', 'ć', 'š', 'ž'].every((c) => agSr.toLowerCase().includes(c)), 'AI view: Serbian is Latin script with its letters');
const agSame = [...ag.sr].filter(([k, v]) => v === ag.en.get(k) && /[a-z]{4,}/.test(v) && !/^(model|serverSays)$/.test(k));
ok(agSame.length === 0, `AI view: Serbian text is not left in English (${agSame.map((b) => b[0]).join(', ')})`);

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL ${n} LANGUAGE CHECKS PASS  (shell keys ${Object.keys(SHELL.sr).length}, control text ${Object.keys(TR.sr).length}, script text ${Object.keys(TX.sr).length}, patterns ${PATTERNS.length})`);
process.exit(fails ? 1 : 0);
