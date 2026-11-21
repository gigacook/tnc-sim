/* The operator's TNC 430 head (answers 11-21, the program MOTORRAM-X.H kept in private/): the head is turned by the
   machine builder's cycles CYCL DEF 303 (Q1 = A head) and CYCL DEF 304 (Q2 = B head), written as
   "CYCL DEF 304 ~" + "Q2=-90 ;"; cycle 19 only tilts the working plane (c19pos false); "continue after errors"
   (keepGoing) runs past the simulator's own stops. Placeholder H1 (sim/machines.js, exec.rs).   Run: node tests/head430.js */
'use strict';
const path = require('path');
const eng = require(path.join(__dirname, 'golden', 'engine-rust.js'))();
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log('FAIL ' + m + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };
const run = (lines, machine = '430', o = {}) => {
  const text = ['BEGIN PGM H MM', ...lines, 'END PGM H MM'].map((l, i) => /^\s/.test(l) ? l : i + ' ' + l).join('\n');
  return eng.run(text, Object.assign({ tools: eng.TOOLS, machine: eng.MACHINES[machine] || undefined, autoTools: true }, o));
};
const heads = (r) => { let prev = null; const out = []; r.moves.forEach((m) => { const k = m.rot1 ? `A${m.rot1.a} B${m.rot1.b}` : 'A0 B0'; if (k !== prev) { out.push(r.blocks[m.block].n + ':' + k); prev = k; } }); return out; };

/* 1. the parameter line after "CYCL DEF 30x ~" belongs to the cycle (it is not Q1 = 180), block numbers stay */
let r = run(['L X-100 R0 FMAX', 'TOOL CALL 0 Z', 'CYCL DEF 303  ~', '    Q1=180    ;', 'TOOL CALL 0 Z S1000']);
ok(r.blocks.some((b) => b.raw.trim().startsWith('Q1=180') && b.kind === 'CYCLPARM'), 'Q1=180 after "CYCL DEF 303 ~" is a cycle parameter');
ok(r.blocks.find((b) => b.raw === 'TOOL CALL 0 Z S1000').n === 4, 'the block after the cycle keeps its number (4)', r.blocks.map((b) => b.n + ' ' + b.raw));
ok(!r.errors.length, 'no error', r.errors);

/* 2. 303 turns A, 304 turns B, at the cycle's own block; the active machining cycle is kept */
r = run(['TOOL CALL 4 Z S2000', 'L Z+100 R0 FMAX', 'CYCL DEF 304 ~', '    Q2=-90 ;', 'CYCL DEF 303 ~', '    Q1=-90 ;', 'L X+10 FMAX', 'CYCL DEF 304 ~', '    Q2=+0 ;', 'L X+20 FMAX']);
ok(JSON.stringify(heads(r)) === JSON.stringify(['2:A0 B0', '3:A0 B-90', '4:A-90 B-90', '6:A-90 B0']),
  '304 Q2=-90 -> B-90 at block 3, 303 Q1=-90 -> A-90 at block 4, 304 Q2=+0 -> B0 at block 6', heads(r));
ok(!r.errors.length, 'no error', r.errors);
/* 303 Q1=180 is outside A -195..15: taken modulo 360 (A-180), not a limit switch (placeholder H1) */
r = run(['TOOL CALL 0 Z', 'CYCL DEF 303 ~', '    Q1=180 ;', 'L X+10 FMAX']);
ok(heads(r).includes('2:A-180 B0') && !r.errors.length, '303 Q1=180 -> A-180, no LIMIT SWITCH', [heads(r), r.errors]);
/* a head turn alone survives the radius-compensation pass (programs with RL / RR) */
r = run(['TOOL CALL 4 Z S2000', 'L Z+100 R0 FMAX', 'CYCL DEF 304 ~', '    Q2=-90 ;', 'L X+0 Y+0 R0 FMAX', 'L X+10 RL F500', 'L Y+10 RL', 'L X+0 R0']);
ok(heads(r).includes('3:A0 B-90'), 'the turn stays on its block (3) in a program with RL', heads(r));
/* the 426 has no head cycles: 303 is still not a 426/430 cycle */
r = run(['TOOL CALL 4 Z S2000', 'CYCL DEF 303 ~', '    Q1=0 ;'], '426');
ok(r.errors.some((e) => /CYCLE 303 NOT ON TNC 426\/430/.test(e.msg)), '426: CYCLE 303 NOT ON TNC 426/430', r.errors);

/* 3. cycle 19 on the 430 tilts the plane but does not turn the head */
r = run(['TOOL CALL 4 Z S2000', 'L Z+100 R0 FMAX', 'CYCL DEF 19.0 BEARBETNINGSPLAN', 'CYCL DEF 19.1 A-90 B+0 C+0', 'L X+10 FMAX']);
ok(heads(r).every((h) => h.endsWith('A0 B0')), 'cycle 19 alone: the head stays at A0 B0', heads(r));
r = run(['TOOL CALL 4 Z S2000', 'L Z+100 R0 FMAX', 'CYCL DEF 304 ~', '    Q2=-90 ;', 'CYCL DEF 19.0 BEARBETNINGSPLAN', 'CYCL DEF 19.1 A+0 B-90 C+0', 'L Z+11 R0 FMAX', 'L X+20 F800']);
const mz = r.moves.filter((m) => r.blocks[m.block].n === 6)[0], mx = r.moves.filter((m) => r.blocks[m.block].n === 7)[0];
ok(mz && Math.abs(mz.to.x - 11) < 1e-6 && mx && Math.abs(mx.to.z + 20) < 1e-6, 'B-90 plane: Z+11 -> machine X+11, X+20 -> machine Z-20 (tool along X)', [mz && mz.to, mx && mx.to]);
/* 426 keeps its behaviour (no head) */

/* 4. continue after errors: TOOL CALL n Y stops the run, keepGoing runs on with the error listed */
const yProg = ['TOOL CALL 45 Y S100', 'CYCL DEF 19.0 BEARBETNINGSPLAN', 'CYCL DEF 19.1 A-90 B+0', 'TOOL CALL 45 Z S960', 'L Z+100 R0 FMAX', 'L X+10 Y+10 R0 FMAX', 'Z+100 R0 F MAX M5', 'L X+50 FMAX'];
r = run(yProg);
ok(r.errors.some((e) => e.msg === 'TOOL AXIS Y NOT SIMULATED') && !r.moves.some((m) => r.blocks[m.block].n === 8), 'default: TOOL CALL 45 Y stops the run (as before)', r.errors);
r = run(yProg, '430', { keepGoing: true });
ok(r.errors.some((e) => e.msg === 'TOOL AXIS Y NOT SIMULATED') && r.errors.some((e) => e.msg === 'BLOCK FORMAT INCORRECT'), 'keepGoing: both errors are listed', r.errors);
ok(r.moves.some((m) => r.blocks[m.block].n === 8), 'keepGoing: the run reaches the last block', r.moves.map((m) => r.blocks[m.block].n));

/* 5. the operator's own program, when it is there (private/, gitignored) */
for (const f of [path.join(__dirname, '..', 'private', 'MOTORRAM-X.H'), path.join(__dirname, '..', 'local', 'MOTORRAM-X.H')]) {
  if (!require('fs').existsSync(f)) continue;
  r = eng.run(require('fs').readFileSync(f, 'latin1'), { tools: eng.TOOLS, machine: eng.MACHINES['430'], autoTools: true, keepGoing: true });
  const h = heads(r).map((x) => x.split(':')[0]).slice(1).join(' ');
  ok(h === '12 121 122 173 175 193 195 231 233 271 273 288 291 304 307 324', 'MOTORRAM-X.H: the head turns at blocks 12 121 122 173 175 … 324 (the 303 / 304 blocks)', h);
  ok(r.blocks[r.moves[r.moves.length - 1].block].n >= 322, 'MOTORRAM-X.H: runs to the end with keepGoing', r.blocks[r.moves[r.moves.length - 1].block].n);
  ok(r.errors.length === 4, 'MOTORRAM-X.H: 4 errors left (2 × TOOL CALL Y, 2 × block without L)', r.errors.map((e) => r.blocks[e.block].n + ' ' + e.msg));
  break;
}
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL ${pass} HEAD-430 CHECKS PASS`);
process.exit(fail ? 1 : 0);
