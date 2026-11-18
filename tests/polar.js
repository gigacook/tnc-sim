/* Polar blocks: the LP dialog (sim/dialogs.js) and the real engine (sim/engine.js, the WebAssembly build of
   server/crates/tnc-core) must agree: answers -> block text -> screen form -> stored text -> the dialog again -> the move.
   Fixture (Swedish screen): LP, PR 57, PA 157.5, R0, F MAX -> "LP PR+57 PA+157,5 R0 F MAX", end point
   X-52.661133 Y+21.812956 with the pole at X+0 Y+0 in the XY plane.            Run:  node tests/polar.js */
const path = require('path');
const eng = require(path.join(__dirname, 'golden', 'engine-rust.js'))();
const D = require('../sim/dialogs.js'), SET = require('../sim/settings.js');
/* a block as the screen shows it: language + decimal character (MP 7280: 'auto' follows the language, 'comma', 'point') */
const scr = (t, lang, decimal = 'auto') => { SET.set({ lang, decimal }); return D.show(t, SET.decimalComma()); };
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FAIL ' + msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/* the dialog as ui.js drives it: one answer per question, ENT on each */
function dialog(spec, answers, opts) {
  const v = {};
  for (let i = 0; i < spec.steps.length; i++) {
    const r = D.answer(spec.steps[i], answers[i], opts);
    if (r.err) return { err: r.err, at: spec.steps[i].k, entry: !!r.entry };
    v[spec.steps[i].k] = r.v;
  }
  return { v, text: spec.build(v) };
}
/* the end point of `block` after CC X+0 Y+0, tool at Z+50, on one machine profile */
const HEAD = ['BEGIN PGM POLAR MM', 'BLK FORM 0.1 Z X-100 Y-100 Z-20', 'BLK FORM 0.2 X+100 Y+100 Z+0', 'TOOL CALL 4 Z S2000', 'L Z+50 R0 FMAX M3', 'CC X+0 Y+0'];
function run(block, machine, pre = []) {
  const text = HEAD.concat(pre, [block, 'END PGM POLAR MM']).join('\n'), at = HEAD.length + pre.length;
  const r = eng.run(text, { tools: eng.TOOLS, machine: eng.MACHINES[machine] || undefined });
  const mv = r.moves.filter(m => m.block === at);
  return { errors: r.errors.map(e => e.msg), block: r.blocks[at], end: mv.length ? mv[mv.length - 1].to : null, kind: mv.length ? mv[mv.length - 1].kind : null, text };
}
const LP = D.PATH.LP, MACH = ['426', '430'];

/* ---- 1. the fixture: guided input -> text -> screen -> reopen -> execution, on both machines ---- */
{
  const d = dialog(LP, ['57', '157.5', 'R0', 'MAX', '']);
  ok(!d.err && d.text === 'LP PR+57 PA+157.5 R0 FMAX', `fixture: the dialog stores "LP PR+57 PA+157.5 R0 FMAX" (got ${JSON.stringify(d.text || d.err)})`);
  ok(scr(d.text, 'sv') === 'LP PR+57 PA+157,5 R0 F MAX', `fixture: Swedish screen form "LP PR+57 PA+157,5 R0 F MAX" (got "${scr(d.text, 'sv')}")`);
  ok(scr(d.text, 'en') === 'LP PR+57 PA+157.5 R0 F MAX', `fixture: English screen form keeps the decimal point (got "${scr(d.text, 'en')}")`);
  const re = D.parseBlock(d.text);
  ok(re && re.id === 'LP' && re.v.pr === '57' && re.v.pa === '157.5' && re.v.rc === 'R0' && re.v.f === 'FMAX' && re.v.m === '',
    `fixture: reopening gives LP, PR 57, PA 157.5, R0, FMAX (got ${JSON.stringify(re)})`);
  ok(D.isPolar(LP) && !D.isPolar(D.PATH.L), 'LP is a polar dialog, L is not');
  for (const m of MACH) {
    const r = run(d.text, m);
    ok(!r.errors.length, `${m}: the fixture runs without an interpreter error (${r.errors})`);
    ok(r.end && near(r.end.x, -52.661133) && near(r.end.y, 21.812956) && near(r.end.z, 50), `${m}: end point X-52.661133 Y+21.812956 within 0.000001 (got ${r.end && r.end.x} ${r.end && r.end.y})`);
    ok(r.kind === 'rapid', `${m}: F MAX moves in rapid (got ${r.kind})`);
    ok(r.block.kind === 'LP' && r.block.args.pr === 57 && r.block.args.pa === 157.5 && r.block.args.rc === 'R0' && r.block.args.fmax === true, `${m}: the engine reads PR 57, PA 157.5, R0, FMAX`);
  }
}

/* ---- 2. comma and point: the same block from either; the comma is only read as a decimal sign in a number ---- */
{
  const a = dialog(LP, ['57', '157,5', 'R0', 'MAX', '']), b = dialog(LP, ['57', '157.5', 'R0', 'FMAX', '']), c = dialog(LP, ['57,0', '+157,50', 'r0', 'f max', '']);
  ok(a.text === b.text && a.text === 'LP PR+57 PA+157.5 R0 FMAX', `"157,5" and "157.5" give the same block (${a.text} / ${b.text})`);
  ok(c.text === 'LP PR+57 PA+157.5 R0 FMAX', `"57,0", "+157,50", "r0", "f max" give the same block (${c.text})`);
  ok(D.decPoint('X10,5 Y-2,25') === 'X10.5 Y-2.25' && D.decPoint(',5') === '.5' && D.decPoint('5,') === '5.', 'decPoint: commas inside numbers only');
  const q = D.answer(D.PATH.Q.steps[1], 'Q1 * 2 ; A, B');
  ok(q.v === 'Q1 * 2 ; A, B', `a text answer keeps its commas (got ${JSON.stringify(q)})`);
  const mm = D.answer(LP.steps[4], '3, 8');
  ok(mm.v && D.PATH.L.build({ xyz: 'X+1', rc: 'R0', f: '', m: mm.v }) === 'L X+1 R0 M3 M8', `M functions "3, 8" stay two functions (got ${JSON.stringify(mm)})`);
  // what the operator types as text is stored as typed; the engine reads both spellings alike
  for (const m of MACH) {
    const ends = ['LP PR+57 PA+157.5 R0 FMAX', 'LP PR+57 PA+157,5 R0 F MAX', 'LP PR+57 PA+157,5 R0 FMAX', 'LP PR+57 PA+157.5 R0 F MAX'].map(t => run(t, m));
    ok(ends.every(r => !r.errors.length && r.end && near(r.end.x, -52.661133) && near(r.end.y, 21.812956) && r.kind === 'rapid'), `${m}: FMAX / F MAX and comma / point run to the same end point`);
  }
  const cm = 'LP PR+57 PA+157.5 R0 FMAX ; RADIE 57.5, VINKEL 1.5';
  ok(scr(cm, 'sv') === 'LP PR+57 PA+157,5 R0 F MAX ; RADIE 57.5, VINKEL 1.5', `a comment is shown exactly as written (got "${scr(cm, 'sv')}")`);
  ok(scr('BLK FORM 0.1 Z X+0.5 Y+0 Z-20', 'sv') === 'BLK FORM 0.1 Z X+0,5 Y+0 Z-20' && scr('CYCL DEF 7.1 X+10.5', 'sv') === 'CYCL DEF 7.1 X+10,5' && scr('TCH PROBE 0.0 REF. PLANE Q5 Z-', 'sv') === 'TCH PROBE 0.0 REF. PLANE Q5 Z-',
    'block numbers of BLK FORM, CYCL DEF and TCH PROBE keep their point on the Swedish screen');
  ok(scr('L Z+2.5 R0 FAUTO', 'en') === 'L Z+2.5 R0 F AUTO', 'F AUTO is shown with a space');
}

/* ---- 2b. the decimal character is its own setting (MP 7280), not the language ---- */
{
  const t = 'LP PR+57 PA+157.5 R0 FMAX';
  ok(scr(t, 'sv', 'comma') === 'LP PR+57 PA+157,5 R0 F MAX' && scr(t, 'en', 'comma') === 'LP PR+57 PA+157,5 R0 F MAX' && scr(t, 'sr', 'comma') === 'LP PR+57 PA+157,5 R0 F MAX', 'decimal = comma: "LP PR+57 PA+157,5 R0 F MAX" in every language');
  ok(scr(t, 'sv', 'point') === 'LP PR+57 PA+157.5 R0 F MAX' && scr(t, 'en', 'point') === 'LP PR+57 PA+157.5 R0 F MAX' && scr(t, 'sr', 'point') === 'LP PR+57 PA+157.5 R0 F MAX', 'decimal = point: "LP PR+57 PA+157.5 R0 F MAX" in every language');
  ok(scr(t, 'sv') === 'LP PR+57 PA+157,5 R0 F MAX' && scr(t, 'sr') === 'LP PR+57 PA+157,5 R0 F MAX' && scr(t, 'en') === 'LP PR+57 PA+157.5 R0 F MAX', 'decimal = follow language: comma in Swedish and Serbian, point in English');
  ok(SET.set('decimal', 'semicolon').length === 0 && SET.get('decimal') === 'auto', 'an unknown decimal setting is refused');
  // reopen round trip under both characters: what the screen shows reads back to the same answers and the same stored text
  for (const dec of ['comma', 'point']) {
    const seen = scr(t, 'sv', dec), p = D.parseBlock(seen);
    ok(p && p.id === 'LP' && p.v.pr === '57' && p.v.pa === '157.5' && p.v.rc === 'R0' && p.v.f === 'FMAX', `${dec}: "${seen}" reopens as PR 57, PA 157.5, R0, FMAX`);
    ok(p && D.PATH.LP.build(p.v) === t, `${dec}: storing the reopened block gives the canonical text`);
    const spec = D.reopenSpec(p.id, p.v), shownDefaults = spec.steps.map((st) => st.dflt == null ? '' : D.show(String(st.dflt), SET.decimalComma()));
    ok(shownDefaults.join('|') === (dec === 'comma' ? '57|157,5|R0|F MAX|' : '57|157.5|R0|F MAX|'), `${dec}: the reopened dialog shows ${shownDefaults.join(' | ')}`);
    const kept = dialog(spec, ['', dec === 'comma' ? '157.5' : '157,5', '', '', '']);       // the other character typed: accepted either way
    ok(kept.text === t, `${dec}: input takes the other decimal character too (got ${JSON.stringify(kept.text || kept.err)})`);
  }
  SET.set({ lang: 'sv', decimal: 'auto' });
}

/* ---- 3. signs, zero, negatives ---- */
{
  const cases = [
    [['57', '-202.5', 'R0', 'MAX', ''], 'LP PR+57 PA-202.5 R0 FMAX', -52.661133, 21.812956],       // the same point, negative angle
    [['+57', '+0', 'R0', '300', ''], 'LP PR+57 PA+0 R0 F300', 57, 0],
    [['57', '0', 'RL', '300', '3'], 'LP PR+57 PA+0 RL F300 M3', null, null],
    [['57', '-0', '', '', ''], 'LP PR+57 PA-0 R0', 57, 0],
    [['57', '90', '', '', ''], 'LP PR+57 PA+90 R0', 0, 57],
    [['57', '-90', '', '', ''], 'LP PR+57 PA-90 R0', 0, -57],
    [['57', '360', '', '', ''], 'LP PR+57 PA+360 R0', 57, 0],
    [['-5', '0', '', '', ''], 'LP PR-5 PA+0 R0', -5, 0],                                           // the engine takes a negative radius as the opposite direction
    [['PR57', 'PA157,5', '', 'MAX', ''], 'LP PR+57 PA+157.5 R0 FMAX', -52.661133, 21.812956],      // whole words typed
    [['57', 'I-22,5', '', '', ''], 'LP PR+57 IPA-22.5 R0', null, null],
    [['Q1', 'Q2', '', 'AUTO', ''], 'LP PR+Q1 PA+Q2 R0 FAUTO', null, null]
  ];
  for (const [ans, text, x, y] of cases) {
    const d = dialog(LP, ans);
    ok(d.text === text, `answers ${JSON.stringify(ans)} -> "${text}" (got ${JSON.stringify(d.text || d.err)})`);
    if (x == null) continue;
    for (const m of MACH) { const r = run(text, m);
      ok(!r.errors.length && r.end && near(r.end.x, x) && near(r.end.y, y), `${m}: "${text}" ends at X${x} Y${y} (got ${r.end && r.end.x} ${r.end && r.end.y}; ${r.errors})`); }
  }
  // incremental angle from a first polar block: 157.5 = 180 - 22.5
  for (const m of MACH) { const r = run('LP PR+57 IPA-22.5 R0 FMAX', m, ['LP PR+57 PA+180 R0 FMAX']);
    ok(!r.errors.length && r.end && near(r.end.x, -52.661133) && near(r.end.y, 21.812956), `${m}: PA+180 then IPA-22.5 ends at the fixture point (got ${r.end && r.end.x} ${r.end && r.end.y})`); }
  // zero radius = the pole itself
  ok(dialog(LP, ['0', '0', '', '', '']).text === 'LP PR+0 PA+0 R0', 'PR 0, PA 0 -> "LP PR+0 PA+0 R0"');
  for (const m of MACH) { const r = run('LP PR+0 PA+0 R0', m, ['L X+10 Y+10 R0 FMAX']);
    ok(!r.errors.length && r.end && near(r.end.x, 0) && near(r.end.y, 0), `${m}: PR+0 moves to the pole (got ${r.end && r.end.x} ${r.end && r.end.y})`); }
  // PR alone keeps the angle, PA alone keeps the radius (both questions may be skipped with NO ENT)
  const onlyPa = dialog(LP, ['', '90', '', '', '']);
  ok(onlyPa.text === 'LP PA+90 R0', `PR skipped: "LP PA+90 R0" (got ${JSON.stringify(onlyPa.text)})`);
  for (const m of MACH) { const r = run(onlyPa.text, m, ['LP PR+57 PA+0 R0 FMAX']);
    ok(!r.errors.length && r.end && near(r.end.x, 0) && near(r.end.y, 57), `${m}: PA alone keeps the last radius (got ${r.end && r.end.x} ${r.end && r.end.y})`); }
}

/* ---- 4. malformed numbers and empty required fields are refused with a message, nothing is built ---- */
{
  const bad = ['1,2,3', '1.2.3', '5..', '--5', '+-5', '5-', 'abc', '57mm', '1e3', ',', '.', 'PA', 'I', 'Q', 'Q1.5', '57;'];
  for (const b of bad) { const r = D.answer(LP.steps[0], b); ok(!!r.err && r.v === undefined, `PR "${b}" is refused (got ${JSON.stringify(r)})`); }
  ok(/PR/.test(D.answer(LP.steps[0], 'PA57').err || ''), 'a PA word on the PR question is refused by name');
  ok(/PA/.test(D.answer(LP.steps[1], 'PR57').err || ''), 'a PR word on the PA question is refused by name');
  for (const b of ['abc', '12x', '1,2,3', 'F', 'FF100', '-']) { const r = D.answer(LP.steps[3], b); ok(!!r.err, `feed "${b}" is refused (got ${JSON.stringify(r)})`); }
  for (const b of ['x', '3.5', 'M', '3;8']) { const r = D.answer(LP.steps[4], b); ok(!!r.err, `M "${b}" is refused (got ${JSON.stringify(r)})`); }
  // required: CTP and DEP PLCT cannot do without PR / PA; ENT and NO ENT on the empty line both stop
  const CTP = D.PATH.CTP;
  for (const i of [0, 1]) for (const skip of [false, true]) { const r = D.answer(CTP.steps[i], '', { skip });
    ok(!!r.err && r.entry === true && /ENTRY REQUIRED/.test(r.err), `CTP ${CTP.steps[i].k.toUpperCase()} empty (${skip ? 'NO ENT' : 'ENT'}) is refused as ENTRY REQUIRED (got ${JSON.stringify(r)})`); }
  ok(dialog(CTP, ['', '10', '', '', '']).at === 'pr' && dialog(CTP, ['30', '  ', '', '', '']).at === 'pa', 'CTP: the dialog stops at the empty PR, then at the empty PA');
  ok(!!D.answer(D.PATH.DEPP.steps[3], '').err, 'DEP PLCT: the radius R is required');
  ok(!!D.answer(D.PATH.CR.steps[1], '').err && !!D.answer(D.PATH.L.steps[0], '').err, 'CR radius and L coordinates are required');
  ok(D.answer(LP.steps[2], '').v === 'R0' && D.answer(LP.steps[3], '').v === '' && D.answer(LP.steps[4], '').v === '', 'LP: radius compensation defaults to R0; feed and M may stay empty');
  // Cartesian editing as before
  const l = dialog(D.PATH.L, ['x10,5 y-5', 'RL', '300', '3']);
  ok(l.text === 'L X+10.5 Y-5 RL F300 M3', `L "x10,5 y-5" -> "L X+10.5 Y-5 RL F300 M3" (got ${JSON.stringify(l.text || l.err)})`);
  ok(!!D.answer(D.PATH.L.steps[0], 'X1,2,3').err && !!D.answer(D.PATH.L.steps[0], 'X5 W5').err && !!D.answer(D.PATH.L.steps[0], 'X1.2.3').err, 'L: malformed coordinates are refused');
}

/* ---- 5. reopen / edit round trips ---- */
{
  const blocks = ['LP PR+57 PA+157.5 R0 FMAX', 'LP PR+57 PA-202.5 R0 F300 M3', 'LP PR+0 PA+0 R0', 'LP IPA-22.5 RL F200', 'LP PR+Q1 PA+Q2 R0 FAUTO', 'LP PA+90 R0', 'LP PR-5 PA+0 R0',
    'CTP PR+30 PA+10 RL F200', 'CP PA+180 DR+ R0', 'CP IPA+360 IZ-2 DR- RL F100 M8', 'L X+10 Y-5.5 RL F300 M3 M8', 'L Z+50 R0 FMAX M3', 'C X+1 Y+2 DR+ RL F100', 'CR X+50 Y+50 R+20 DR- R0',
    'CT X+5 Y+5 R0', 'CC X+50 Y+50', 'CC', 'RND R5', 'RND R5 F100', 'CHF 5'];
  for (const t of blocks) {
    const p = D.parseBlock(t);
    ok(!!p, `"${t}" opens in its dialog`); if (!p) continue;
    ok(D.PATH[p.id].build(p.v) === t, `"${t}" -> dialog -> the same text (got "${D.PATH[p.id].build(p.v)}")`);
    // ENT on every question of the reopened dialog keeps the block
    const kept = dialog(D.reopenSpec(p.id, p.v), D.PATH[p.id].steps.map(() => ''));
    ok(kept.text === t, `"${t}": ENT on every question keeps it (got ${JSON.stringify(kept.text || kept.err)})`);
  }
  // screen spellings and block numbers read back to the same answers
  const forms = ['LP PR+57 PA+157,5 R0 F MAX', '12 LP PR+57 PA+157.5 R0 FMAX', '  lp pr+57 pa+157,5 r0 f max  ', 'LP PR+57 PA+157.5 R0 FMAX ; COMMENT, 1.5', 'LP PR57 PA157.50 R0 FMAX'];
  for (const t of forms) { const p = D.parseBlock(t);
    ok(p && p.id === 'LP' && p.v.pr === '57' && +p.v.pa === 157.5 && p.v.rc === 'R0' && p.v.f === 'FMAX', `"${t}" reopens as PR 57, PA 157.5, R0, FMAX (got ${JSON.stringify(p)})`); }
  // edit: reopen the fixture, change the angle with a decimal comma, keep the rest
  const p = D.parseBlock('LP PR+57 PA+157.5 R0 FMAX'), ed = dialog(D.reopenSpec(p.id, p.v), ['', '22,5', '', '', '8']);
  ok(ed.text === 'LP PR+57 PA+22.5 R0 FMAX M8', `edit PA to 22,5 and add M8 -> "LP PR+57 PA+22.5 R0 FMAX M8" (got ${JSON.stringify(ed.text || ed.err)})`);
  const again = D.parseBlock(ed.text);
  ok(again && again.v.pa === '22.5' && again.v.m === '8' && again.v.pr === '57', 'the edited block reopens with the edited values');
  for (const m of MACH) { const r = run(ed.text, m);
    ok(!r.errors.length && r.end && near(r.end.x, 57 * Math.cos(22.5 * Math.PI / 180)) && near(r.end.y, 57 * Math.sin(22.5 * Math.PI / 180)), `${m}: the edited block runs to PR 57, PA 22.5`); }
  // NO ENT on a reopened question clears an optional word; a malformed edit is refused and the block is not built
  const spec = D.reopenSpec(p.id, p.v), cleared = D.answer(spec.steps[3], '', { skip: true });
  ok(cleared.v === '', `NO ENT on the reopened feed clears it (got ${JSON.stringify(cleared)})`);
  ok(!!dialog(spec, ['', '1,2,3', '', '', '']).err, 'a malformed edit is refused');
  // not a path block, or a word the dialog cannot hold: no dialog, the block stays text
  for (const t of ['LBL 1', 'CYCL DEF 200 DRILLING', 'TOOL CALL 4 Z S2000', 'CALL LBL 1 REP 3/3', 'LP PR+57 PA+157.5 R0 FMAX X+5', 'LP PR+57 PR+58', 'L X+1 Y+2 LEN5', '', 'Q1 = 5'])
    ok(D.parseBlock(t) === null, `"${t}" has no path dialog`);
  // the preview line while the dialog runs
  ok(D.preview(LP, { pr: '57' }) === 'LP PR+57' && D.preview(LP, { pr: '57', pa: '157.5', rc: 'R0', f: 'FMAX' }) === 'LP PR+57 PA+157.5 R0 FMAX' && D.preview(D.PATH.CTP, {}) === 'CTP',
    `the preview shows the block as far as it is answered (got "${D.preview(LP, { pr: '57' })}", "${D.preview(D.PATH.CTP, {})}")`);
}

/* ---- 6. save / reload / export: the stored text is the engine's own, and the numbered listing reads back the same ---- */
for (const m of MACH) {
  const r = run('LP PR+57 PA+157.5 R0 FMAX', m);
  const listing = eng.run(r.text, { tools: eng.TOOLS, machine: eng.MACHINES[m] || undefined }).blocks.map(b => b.n + ' ' + b.raw).join('\r\n') + '\r\n';   // what Save .H writes
  ok(/\r\n6 LP PR\+57 PA\+157\.5 R0 FMAX\r\n/.test(listing), `${m}: the exported listing holds "6 LP PR+57 PA+157.5 R0 FMAX"`);
  const back = listing.replace(/\r/g, '').trim(), r2 = eng.run(back, { tools: eng.TOOLS, machine: eng.MACHINES[m] || undefined });
  const mv = r2.moves.filter(x => x.block === 6).pop();
  ok(!r2.errors.length && mv && near(mv.to.x, -52.661133) && near(mv.to.y, 21.812956), `${m}: the exported listing loads and runs to the same end point`);
  const p = D.parseBlock(r2.blocks[6].raw);
  ok(p && p.id === 'LP' && p.v.pr === '57' && p.v.pa === '157.5' && p.v.rc === 'R0' && p.v.f === 'FMAX', `${m}: the reloaded block reopens with PR 57, PA 157.5, R0, FMAX`);
}

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL ${n} POLAR CHECKS PASS`);
process.exit(fails ? 1 : 0);
