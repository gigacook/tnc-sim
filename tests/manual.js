/* Worked examples from the HEIDENHAIN TNC 426/430 user's manual (NC software 280 476),
   chapter 6 "Programming contours". Expected tool-centre geometry is derived from the
   manual's rules: RL/RR offset by R, transitional arcs at outside corners, APPR/DEP on
   the tool-centre path.   Run:  node tests/manual.js                                  */
const { TNC } = require('../sim/engine.js'), TNC_DIALOGS = require('../sim/dialogs.js');
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  FAIL ' + msg); } };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const P = { LINEAR: `BEGIN PGM LINEAR MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+10
TOOL CALL 1 Z S4000
L Z+250 R0 F MAX
L X-10 Y-10 R0 F MAX
L Z-5 R0 F1000 M3
APPR LT X+5 Y+5 LEN10 RL F300
L Y+95
L X+95
CHF 10
L Y+5
CHF 20
L X+5
DEP LT LEN10 F1000
L Z+250 R0 F MAX M2
END PGM LINEAR MM`,
CIRCULAR: `BEGIN PGM CIRCULAR MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+10
TOOL CALL 1 Z S4000
L Z+250 R0 F MAX
L X-10 Y-10 R0 F MAX
L Z-5 R0 F1000 M3
APPR LCT X+5 Y+5 R5 RL F300
L X+5 Y+85
RND R10 F150
L X+30 Y+85
CR X+70 Y+95 R+30 DR-
L X+95
L X+95 Y+40
CT X+40 Y+5
L X+5
DEP LCT X-20 Y-20 R5 F1000
L Z+250 R0 F MAX M2
END PGM CIRCULAR MM`,
CCC: `BEGIN PGM C-CC MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+12.5
TOOL CALL 1 Z S3150
CC X+50 Y+50
L Z+250 R0 F MAX
L X-40 Y+50 R0 F MAX
L Z-5 R0 F1000 M3
APPR LCT X+0 Y+50 R5 RL F300
C X+0 DR-
DEP LCT X-40 Y+50 R5 F1000
L Z+250 R0 F MAX M2
END PGM C-CC MM`,
LINEARPO: `BEGIN PGM LINEARPO MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+7.5
TOOL CALL 1 Z S4000
CC X+50 Y+50
L Z+250 R0 F MAX
LP PR+60 PA+180 R0 F MAX
L Z-5 R0 F1000 M3
APPR PLCT PR+45 PA+180 R5 RL F250
LP PA+120
LP PA+60
LP PA+0
LP PA-60
LP PA-120
LP PA+180
DEP PLCT PR+60 PA+180 R5 F1000
L Z+250 R0 F MAX M2
END PGM LINEARPO MM`,
HELIX: `BEGIN PGM HELIX MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S1400
L Z+250 R0 F MAX
L X+50 Y+50 R0 F MAX
CC
L Z-12.75 R0 F1000 M3
APPR PCT PR+32 PA-180 CCA180 R+2 RL F100
CP IPA+3240 IZ+13.5 DR+ F200
DEP CT CCA180 R+2
L Z+250 R0 F MAX M2
END PGM HELIX MM`,
HELIXREP: `BEGIN PGM HELIX MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S1400
L Z+250 R0 F MAX
L X+50 Y+50 R0 F MAX
CC
L Z-12.75 R0 F1000 M3
APPR PCT PR+32 PA-180 CCA180 R+2 RL F100
LBL 1
CP IPA+360 IZ+1.5 DR+ F200
CALL LBL 1 REP 8
DEP CT CCA180 R+2
L Z+250 R0 F MAX M2
END PGM HELIX MM` };

function run(name) {
  const r = TNC.run(P[name]);
  const errs = r.errors.map(e => `block ${e.block}: ${e.msg}`);
  ok(!errs.length, name + ' errors: ' + errs.join('; '));
  for (let i = 1; i < r.moves.length; i++) {                 // the tool path must be continuous
    const a = r.moves[i - 1].to, b = r.moves[i].from;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-6) { ok(false, `${name} gap before move ${i} (block ${r.moves[i].block}) ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); break; }
  }
  return r;
}
const pts = r => { const out = []; r.moves.forEach(m => { if (m.kind === 'arc') { const n = Math.ceil(Math.abs(m.sweep) / 0.05) + 1, R = Math.hypot(m.from.x - m.cx, m.from.y - m.cy), a0 = Math.atan2(m.from.y - m.cy, m.from.x - m.cx);
  for (let i = 0; i <= n; i++) out.push({ x: m.cx + R * Math.cos(a0 + m.sweep * i / n), y: m.cy + R * Math.sin(a0 + m.sweep * i / n), z: m.from.z + (m.to.z - m.from.z) * i / n, m }); }
  else for (let i = 0; i <= 20; i++) out.push({ x: m.from.x + (m.to.x - m.from.x) * i / 20, y: m.from.y + (m.to.y - m.from.y) * i / 20, z: m.from.z + (m.to.z - m.from.z) * i / 20, m }); }); return out; };
const atDepth = (r, z) => pts(r).filter(p => near(p.z, z) && p.m.kind !== 'rapid');

console.log('LINEAR — APPR LT, CHF, DEP LT, RL outside a square, R10');
{ const r = run('LINEAR'), c = atDepth(r, -5).filter(p => p.m.block >= 9 && p.m.block <= 14);
  const xs = c.map(p => p.x), ys = c.map(p => p.y);
  ok(near(Math.min(...xs), -5) && near(Math.max(...xs), 105) && near(Math.min(...ys), -5) && near(Math.max(...ys), 105), 'offset square spans -5..105, got ' + [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(v => v.toFixed(3)));
  const appr = r.moves.filter(m => m.block === 8);
  ok(appr.length >= 2 && near(appr[0].to.x, -5) && near(appr[0].to.y, -5), 'APPR LT: PH at (-5,-5) = offset start minus LEN along the tangent, got ' + (appr[0] && JSON.stringify(appr[0].to)));
  ok(appr[0] && appr[0].feed === 1000, 'PS->PH runs at the last programmed feed F1000, got ' + (appr[0] && appr[0].feed));
  ok(appr[1] && appr[1].feed === 300 && near(appr[1].to.x, -5) && near(appr[1].to.y, 5), 'PH->PA at F300 ends at (-5,5)');
  const tr = r.moves.find(m => m.kind === 'arc' && near(m.cx, 5) && near(m.cy, 95));
  ok(tr && near(Math.hypot(tr.from.x - 5, tr.from.y - 95), 10) && tr.sweep < 0, 'outside corner (5,95): transitional arc R10 clockwise');
  const chf = r.moves.find(m => m.block === 11 && m.kind !== 'arc');
  ok(chf && near(Math.abs(chf.to.x - chf.from.x), 10) && near(Math.abs(chf.to.y - chf.from.y), 10), 'CHF 10: chamfer leg 10 x 10 (offset parallel), got ' + (chf && JSON.stringify([chf.from, chf.to])));
  const dep = r.moves.filter(m => m.block === 15);
  ok(dep.length === 1 && near(dep[0].from.x, 5) && near(dep[0].from.y, -5) && near(dep[0].to.x, -5) && near(dep[0].to.y, -5), 'DEP LT LEN10: (5,-5) -> (-5,-5), got ' + (dep[0] && JSON.stringify([dep[0].from, dep[0].to])));
  const last = r.moves[r.moves.length - 1];
  ok(near(last.to.x, -5) && near(last.to.y, -5) && near(last.to.z, 250), 'retract Z+250 stays at the DEP end XY');
}
console.log('CIRCULAR — APPR LCT, RND, CR, CT, DEP LCT, R10');
{ const r = run('CIRCULAR');
  const rnd = r.moves.filter(m => m.block === 10);
  ok(rnd.length >= 1 && rnd.some(m => m.kind === 'arc'), 'RND produced an arc');
  const cr = r.moves.find(m => m.block === 12 && m.kind === 'arc');
  ok(cr && near(Math.hypot(cr.from.x - cr.cx, cr.from.y - cr.cy), 40), 'CR R30 DR- with RL is convex (manual) -> tool outside, radius 30+10 = 40, got ' + (cr && Math.hypot(cr.from.x - cr.cx, cr.from.y - cr.cy)));
  const ct = r.moves.find(m => m.block === 15 && m.kind === 'arc');
  ok(!!ct, 'CT produced an arc');
  const d = r.moves.filter(m => m.block === 17);
  ok(d.length >= 2 && d[0].kind === 'arc' && near(d[d.length - 1].to.x, -20) && near(d[d.length - 1].to.y, -20), 'DEP LCT: arc then line to PN (-20,-20)');
}
console.log('C-CC — full circle C DR-, RL, R12.5');
{ const r = run('CCC');
  const c = r.moves.find(m => m.block === 10 && m.kind === 'arc');
  ok(c && near(c.cx, 50) && near(c.cy, 50) && near(Math.hypot(c.from.x - 50, c.from.y - 50), 62.5) && near(Math.abs(c.sweep), 2 * Math.PI, 1e-6) && c.sweep < 0,
     'full circle: centre (50,50), tool radius 50+12.5, sweep -360deg; got ' + (c && [c.cx, c.cy, Math.hypot(c.from.x - 50, c.from.y - 50), c.sweep].map(v => (+v).toFixed(4))));
}
console.log('LINEARPO — polar LP hexagon, APPR/DEP PLCT, R7.5');
{ const r = run('LINEARPO'), c = atDepth(r, -5).filter(p => p.m.block >= 10 && p.m.block <= 15);
  const minR = Math.min(...c.map(p => Math.hypot(p.x - 50, p.y - 50)));
  ok(near(minR, 45 * Math.cos(Math.PI / 6) + 7.5, 1e-3), 'tool stays 7.5 outside the hexagon flats (min radius ' + minR.toFixed(4) + ')');
  ok(r.moves.some(m => m.block === 9 && m.kind === 'arc'), 'APPR PLCT arc');
}
for (const H of ['HELIX', 'HELIXREP']) {
  console.log(H + ' — CP IPA helix with RL inside, APPR PCT / DEP CT, R5');
  const r = run(H), h = r.moves.filter(m => m.kind === 'arc' && near(m.cx, 50) && near(m.cy, 50) && (H === 'HELIX' ? m.block === 10 : m.block === 11));
  const turns = h.reduce((s, m) => s + m.sweep, 0) / (2 * Math.PI);
  ok(h.length && h.every(m => near(Math.hypot(m.from.x - 50, m.from.y - 50), 27)), 'helix tool radius 32-5 = 27 (RL inside a CCW circle)');
  ok(near(turns, 9, 1e-6), '9 turns (IPA+3240), got ' + turns.toFixed(4));
  const hz = h[h.length - 1]; ok(hz && near(hz.to.z, 0.75), 'helix ends at Z-12.75+13.5 = +0.75');
}

console.log('INSIDE — RL inside a CCW pocket contour: corners are intersections, no arcs');
{ const r = TNC.run(`BEGIN PGM IN MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S3000
L X+50 Y+50 R0 FMAX
L Z-5 F500 M3
L X+10 Y+10 RL F300
L X+90
L Y+90
L X+10
L Y+10
L X+50 Y+50 R0
END PGM IN MM`);
  ok(!r.errors.length, 'no errors ' + JSON.stringify(r.errors));
  const c = r.moves.filter(m => m.block >= 8 && m.block <= 11);
  ok(c.every(m => m.kind !== 'arc'), 'no transitional arcs on inside corners');
  const corners = c.map(m => m.to);
  ok(near(corners[0].x, 85) && near(corners[0].y, 15) && near(corners[1].x, 85) && near(corners[1].y, 85) && near(corners[2].x, 15) && near(corners[2].y, 85),
     'offset corners at 15/85, got ' + JSON.stringify(corners.map(p => [+p.x.toFixed(3), +p.y.toFixed(3)])));
  const act = r.moves.find(m => m.block === 7);
  ok(act && near(act.to.x, 10) && near(act.to.y, 15), 'activation ends perpendicular to the first element: (10,15), got ' + (act && JSON.stringify(act.to)));
}
console.log('ERRORS — radius too large, RL straight to RR');
{ const r = TNC.run(`BEGIN PGM E MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+8
TOOL CALL 1 Z S3000
L X+50 Y+45 R0 FMAX
L Z-5 F500 M3
CC X+50 Y+50
L X+50 Y+45 RL F300
C X+50 Y+45 DR+
L X+50 Y+50 R0
END PGM E MM`);
  ok(r.errors.some(e => /TOOL RADIUS TOO LARGE/.test(e.msg)), 'R8 inside an R5 circle -> TOOL RADIUS TOO LARGE, got ' + JSON.stringify(r.errors));
  const r2 = TNC.run('BEGIN PGM E MM\nTOOL CALL 4 Z S1000\nL X+0 Y+0 RL F100\nL X+10 RR\nEND PGM E MM');
  ok(r2.errors.some(e => /RADIUS COMP/.test(e.msg)), 'RL -> RR without R0 is refused');
}
console.log('CYCLE 203 — Q208=0 retracts at the plunging feed Q206');
{ const r = TNC.run(`BEGIN PGM D MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL CALL 2 Z S2000
L X+50 Y+50 Z+10 R0 FMAX M3
CYCL DEF 203 UNIVERSAL DRILLING
  Q200=2 ;SET-UP CLEARANCE
  Q201=-10 ;DEPTH
  Q206=150 ;FEED RATE FOR PLUNGING
  Q202=10 ;PLUNGING DEPTH
  Q210=0 ;DWELL TIME AT TOP
  Q203=+0 ;SURFACE COORDINATE
  Q204=20 ;2ND SET-UP CLEARANCE
  Q212=0 ;DECREMENT
  Q213=0 ;BREAKS
  Q205=0 ;MIN. PLUNGING DEPTH
  Q211=0 ;DWELL TIME AT DEPTH
  Q208=0 ;RETRACTION FEED RATE
CYCL CALL
END PGM D MM`);
  const up = r.moves.find(m => m.cycle && m.to.z > m.from.z && m.kind === 'feed');
  ok(up && up.feed === 150, 'retract feed = Q206 150, got ' + (up && up.feed));
}

const ELLIPSE = rot => `BEGIN PGM ELLIPSE MM
FN 0: Q1 = +50
FN 0: Q2 = +50
FN 0: Q3 = +50
FN 0: Q4 = +30
FN 0: Q5 = +0
FN 0: Q6 = +360
FN 0: Q7 = +40
FN 0: Q8 = ${rot}
FN 0: Q9 = +5
FN 0: Q10 = +100
FN 0: Q11 = +350
FN 0: Q12 = +2
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+2.5
TOOL CALL 1 Z S4000
L Z+250 R0 F MAX
CALL LBL 10
L Z+100 R0 F MAX M2
LBL 10
CYCL DEF 7.0 DATUM SHIFT
CYCL DEF 7.1 X+Q1
CYCL DEF 7.2 Y+Q2
CYCL DEF 10.0 DREHUNG
CYCL DEF 10.1 ROT+Q8
Q35 = (Q6 - Q5) / Q7
Q36 = Q5
Q37 = 0
Q21 = Q3 * COS Q36
Q22 = Q4 * SIN Q36
L X+Q21 Y+Q22 R0 F MAX M3
L Z+Q12 R0 F MAX
L Z-Q9 R0 FQ10
LBL 1
Q36 = Q36 + Q35
Q37 = Q37 + 1
Q21 = Q3 * COS Q36
Q22 = Q4 * SIN Q36
L X+Q21 Y+Q22 R0 FQ11
FN 12: IF +Q37 LT +Q7 GOTO LBL 1
CYCL DEF 10.0 DREHUNG
CYCL DEF 10.1 ROT+0
CYCL DEF 7.0 DATUM SHIFT
CYCL DEF 7.1 X+0
CYCL DEF 7.2 Y+0
L Z+Q12 R0 F MAX
LBL 0
END PGM ELLIPSE MM`;
for (const rot of [0, 30]) {
  console.log(`ELLIPSE (manual 10.11) — Q formulas, FN 12 loop, cycle 7 shift, cycle 10 ROT+${rot}`);
  const r = TNC.run(ELLIPSE(rot));
  ok(!r.errors.length, 'no errors ' + JSON.stringify(r.errors.slice(0, 3)));
  const cut = r.moves.filter(m => m.feed === 350);
  ok(cut.length === 40, '40 segments (Q7), got ' + cut.length);
  const c = Math.cos(-rot * Math.PI / 180), s = Math.sin(-rot * Math.PI / 180);
  const onE = p => { const x = p.x - 50, y = p.y - 50, u = x * c - y * s, v = x * s + y * c; return Math.abs((u / 50) ** 2 + (v / 30) ** 2 - 1) < 1e-6; };
  ok(cut.every(m => onE(m.to) && near(m.to.z, -5)), 'every point on the ellipse a=50 b=30 about (50,50), rotated ' + rot + ' deg, at Z-5');
  const last = r.moves[r.moves.length - 1];
  ok(near(last.to.z, 100), 'ends at Z+100 after the datum reset');
}
console.log('FORMULAS — precedence, functions, FN 4 DIV, FN 8 LEN, FN 13 ANG, REP Q');
{ const r = TNC.run(`BEGIN PGM F MM
Q1 = 5 * 3 + 2 * 10
Q2 = SQ 10 - 3^3
Q3 = SQRT 25 + ABS -2
FN 4: Q4 = +8 DIV +2
FN 8: Q5 = +5 LEN +4
FN 13: Q6 = +25 ANG +25
Q7 = 2
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL CALL 4 Z S3000
L X+Q1 Y+Q2 Z+10 R0 FMAX
LBL 1
L IX+1 R0 F100
CALL LBL 1 REP Q7
END PGM F MM`);
  ok(!r.errors.length, 'no errors ' + JSON.stringify(r.errors));
  const p = r.moves[0].to; ok(near(p.x, 35) && near(p.y, 73), 'Q1 = 35 and Q2 = 73 (manual 10.9), got ' + p.x + ',' + p.y);
  ok(near(r.moves[r.moves.length - 1].to.x, 38), 'REP Q7 (=2): section runs 3 times, X 35 -> 38');
}
console.log('MIRROR — cycle 8 X mirrors the part and swaps RL to RR, arcs change direction');
{ const base = `TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S3000
L X+10 Y-10 Z-5 R0 FMAX M3
L X+10 Y+10 RL F300
L X+40
CC X+40 Y+30
C X+40 Y+50 DR+
L X+10
L X+10 Y+10
L X+0 Y+0 R0`;
  const a = TNC.run('BEGIN PGM A MM\n' + base + '\nEND PGM A MM'), b = TNC.run('BEGIN PGM B MM\nCYCL DEF 8.0 MIRROR IMAGE\nCYCL DEF 8.1 X\n' + base + '\nEND PGM B MM');
  ok(!a.errors.length && !b.errors.length, 'no errors ' + JSON.stringify(b.errors));
  const A = pts(a).filter(q => q.m.rc), B = pts(b).filter(q => q.m.rc);
  const key = q => Math.round(q.x * 1000) / 1000 + ',' + Math.round(q.y * 1000) / 1000;
  const setA = new Set(A.map(q => key({ x: -q.x, y: q.y })));
  ok(B.length > 10 && B.every(q => setA.has(key(q)) || A.some(z => Math.hypot(-z.x - q.x, z.y - q.y) < 0.05)), 'mirrored tool path is the exact mirror of the original');
}

console.log('CYCLES — 202 205 206 207 208 209 and old 1 / 2 / 17 against the manual\'s parameter rules');
{ const hdr = 'BEGIN PGM C MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+3\nTOOL CALL 1 Z S500\nL Z+50 R0 FMAX M3\n';
  const cyc = (def, call = 'L X+50 Y+50 R0 FMAX M99') => TNC.run(hdr + def + '\n' + call + '\nEND PGM C MM');
  const zmin = r => Math.min(...r.moves.map(m => m.to.z));
  let r = cyc('CYCL DEF 207 RIGID TAPPING NEW\n Q200=2\n Q201=-20\n Q239=+1.5\n Q203=+0\n Q204=50');
  ok(!r.errors.length, '207 no errors ' + JSON.stringify(r.errors));
  const tap = r.moves.filter(m => m.cycle && m.kind === 'feed');
  ok(tap.length === 2 && tap.every(m => m.feed === 750), '207: in and out at F = S x pitch = 500 x 1.5 = 750, got ' + tap.map(m => m.feed));
  ok(tap[1] && tap[1].spindle < 0, '207: spindle reversed for the way out');
  ok(near(zmin(r), -20), '207: thread depth Z-20');
  ok(r.moves[r.moves.length - 1].spindle === 0, '207: spindle stopped at the end (manual)');
  r = cyc('CYCL DEF 209 TAPPING W/ CHIP BRKG\n Q200=2\n Q201=-20\n Q239=+1\n Q203=+0\n Q204=50\n Q257=5\n Q256=0.5\n Q336=0');
  ok(!r.errors.length && near(zmin(r), -20), '209 reaches Z-20');
  ok(r.moves.filter(m => m.cycle && m.spindle < 0).length >= 4, '209: reverses at every Q257 infeed (4 infeeds of 5)');
  r = cyc('CYCL DEF 208 BORE MILLING\n Q200=2\n Q201=-10\n Q206=150\n Q334=2\n Q203=+0\n Q204=50\n Q335=20\n Q342=0');
  const h = r.moves.find(m => m.kind === 'arc');
  ok(!r.errors.length && h && near(Math.hypot(h.from.x - 50, h.from.y - 50), 7), '208: helix radius = D/2 - R = 10 - 3 = 7');
  ok(h && near(Math.abs(h.sweep) / (2 * Math.PI), 6), '208: (10 depth + 2 clearance) / 2 per turn = 6 turns, got ' + (h && (Math.abs(h.sweep) / (2 * Math.PI)).toFixed(3)));
  r = cyc('CYCL DEF 205 UNIVERSAL PECKING\n Q200=2\n Q201=-30\n Q206=150\n Q202=10\n Q203=+0\n Q204=50\n Q212=2\n Q205=4\n Q258=0.5\n Q259=1\n Q257=0\n Q256=0.2\n Q211=0');
  ok(!r.errors.length && near(zmin(r), -30), '205 reaches Z-30');
  const pecks = r.moves.filter(m => m.cycle && m.kind === 'feed' && m.to.z < m.from.z).map(m => +(-m.to.z).toFixed(3));
  ok(pecks.includes(10) && pecks.includes(18) && pecks.includes(24), '205: pecks 10, 8, 6 ... (Q212 decrement), depths ' + pecks.join(','));
  r = cyc('CYCL DEF 202 BORING\n Q200=2\n Q201=-15\n Q206=100\n Q211=0.5\n Q208=250\n Q203=+0\n Q204=100\n Q214=1\n Q336=0');
  const out = r.moves.find(m => m.cycle && m.kind === 'feed' && m.to.z > m.from.z);
  ok(!r.errors.length && out && out.feed === 250 && near(out.from.x, 49.8), '202: disengage 0.2 in -X (Q214=1), retract at Q208 250');
  r = TNC.run(hdr + 'L X+50 Y+50 R0 FMAX\nL Z+2 R0 FMAX\nCYCL DEF 1.0 PECKING\nCYCL DEF 1.1 SET UP 2\nCYCL DEF 1.2 DEPTH -15\nCYCL DEF 1.3 PECKG 5\nCYCL DEF 1.4 DWELL 0\nCYCL DEF 1.5 F80\nCYCL CALL\nEND PGM C MM');
  ok(!r.errors.length && near(zmin(r), -15) && r.moves.filter(m => m.cycle && m.feed === 80).length === 3, 'cycle 1: 3 pecks of 5 to Z-15 at F80');
  r = TNC.run(hdr + 'L X+50 Y+50 R0 FMAX\nL Z+2 R0 FMAX\nCYCL DEF 17.0 RIGID TAPPING\nCYCL DEF 17.1 SET UP 2\nCYCL DEF 17.2 DEPTH -12\nCYCL DEF 17.3 PITCH +1\nCYCL CALL\nEND PGM C MM');
  ok(!r.errors.length && near(zmin(r), -12) && r.moves.some(m => m.cycle && m.feed === 500), 'cycle 17: F = S x pitch = 500');
  /* p. 338 cycle 13 ORIENTATION: accepted, does not replace the active cycle */
  r = TNC.run(hdr + 'L X+50 Y+50 R0 FMAX\nL Z+2 R0 FMAX\nCYCL DEF 17.0 RIGID TAPPING\nCYCL DEF 17.1 SET UP 2\nCYCL DEF 17.2 DEPTH -12\nCYCL DEF 17.3 PITCH +1\nCYCL DEF 13.0 ORIENTATION\nCYCL DEF 13.1 ANGLE 180\nCYCL CALL\nEND PGM C MM');
  ok(!r.errors.length && near(zmin(r), -12), 'cycle 13 ORIENTATION runs, active cycle 17 still called ' + r.errors.map(e => e.msg));
}

console.log('CYCLES — 212/213/214/215 finishing, 210/211 slots, 220/221 patterns, 230/231 surfaces');
{ const hdr = 'BEGIN PGM C MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+3\nTOOL CALL 1 Z S3000\nL Z+50 R0 FMAX M3\n';
  const R = s => TNC.run(hdr + s + '\nEND PGM C MM');
  const P = r => pts(r).filter(q => q.m.cycle && q.m.kind !== 'rapid');
  let r = R('CYCL DEF 212 POCKET FINISHING\n Q200=2\n Q201=-20\n Q206=150\n Q202=5\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q218=80\n Q219=60\n Q220=5\n Q221=0\nCYCL CALL');
  let q = P(r).filter(p => near(p.z, -20));
  ok(!r.errors.length, '212 no errors ' + JSON.stringify(r.errors));
  ok(near(Math.max(...q.map(p => p.x)), 87) && near(Math.min(...q.map(p => p.x)), 13) && near(Math.max(...q.map(p => p.y)), 77) && near(Math.min(...q.map(p => p.y)), 23),
     '212: wall at 80x60 about (50,50) -> tool centre 13..87 / 23..77');
  ok(new Set(P(r).map(p => +p.z.toFixed(3))).size >= 4, '212: 4 levels of Q202=5 down to 20');
  r = R('CYCL DEF 213 STUD FINISHING\n Q200=2\n Q201=-10\n Q206=150\n Q202=10\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q218=40\n Q219=30\n Q220=2\n Q221=0\nCYCL CALL');
  q = P(r).filter(p => near(p.z, -10) && p.m.kind === 'feed' && Math.abs(p.y - 50) < 12);
  ok(!r.errors.length && q.some(p => near(p.x, 73)), '213: stud side X+70 -> tool centre X73 (outside)');
  r = R('CYCL DEF 214 C. POCKET FINISHING\n Q200=2\n Q201=-10\n Q206=150\n Q202=10\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q222=79\n Q223=80\nCYCL CALL');
  const circ = r.moves.find(m => m.kind === 'arc' && near(Math.abs(m.sweep), 2 * Math.PI));
  ok(!r.errors.length && circ && near(Math.hypot(circ.from.x - 50, circ.from.y - 50), 37) && circ.sweep > 0, '214: full circle radius 40-3, counter-clockwise (climb)');
  r = R('CYCL DEF 215 C. STUD FINISHING\n Q200=2\n Q201=-10\n Q206=150\n Q202=10\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q222=81\n Q223=80\nCYCL CALL');
  const c2 = r.moves.find(m => m.kind === 'arc' && near(Math.abs(m.sweep), 2 * Math.PI));
  ok(!r.errors.length && c2 && near(Math.hypot(c2.from.x - 50, c2.from.y - 50), 43) && c2.sweep < 0, '215: full circle radius 40+3, clockwise (climb outside)');
  r = R('CYCL DEF 200 DRILLING\n Q200=2\n Q201=-15\n Q206=250\n Q202=5\n Q210=0\n Q203=+0\n Q204=20\n Q211=0\nCYCL DEF 220 POLAR PATTERN\n Q216=+50\n Q217=+50\n Q244=80\n Q245=+0\n Q246=+360\n Q247=+0\n Q241=8\n Q200=2\n Q203=+0\n Q204=50\n Q301=1');
  const holes = r.moves.filter(m => m.cycle && m.kind === 'feed' && near(m.to.z, -15));
  ok(!r.errors.length && holes.length === 8 && holes.every(m => near(Math.hypot(m.to.x - 50, m.to.y - 50), 40)), '220: 8 holes on a D80 circle, got ' + holes.length);
  ok(holes.length === 8 && near(holes[1].to.x, 50 + 40 * Math.cos(Math.PI / 4)), '220: 45 deg steps (Q247=0, full circle / 8)');
  r = R('CYCL DEF 200 DRILLING\n Q200=2\n Q201=-5\n Q206=250\n Q202=5\n Q210=0\n Q203=+0\n Q204=20\n Q211=0\nCYCL DEF 221 CARTESIAN PATTERN\n Q225=+15\n Q226=+15\n Q237=+10\n Q238=+8\n Q242=6\n Q243=4\n Q224=+0\n Q200=2\n Q203=+0\n Q204=50\n Q301=1');
  const g = r.moves.filter(m => m.cycle && m.kind === 'feed' && near(m.to.z, -5));
  ok(!r.errors.length && g.length === 24 && near(Math.max(...g.map(m => m.to.x)), 65) && near(Math.max(...g.map(m => m.to.y)), 39), '221: 6 x 4 grid from (15,15) step 10/8, got ' + g.length);
  r = R('CYCL DEF 210 SLOT RECIP. PLNG\n Q200=2\n Q201=-10\n Q207=500\n Q202=5\n Q215=0\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q218=80\n Q219=12\n Q224=+0\n Q338=5\nCYCL CALL');
  q = P(r).filter(p => near(p.z, -10));
  ok(!r.errors.length && near(Math.max(...q.map(p => p.x)), 50 + 40 - 3) && near(Math.max(...q.map(p => p.y)), 53), '210: slot 80 x 12 finished to X87 / Y53');
  r = R('CYCL DEF 230 MULTIPASS MILLING\n Q225=+10\n Q226=+12\n Q227=+2.5\n Q218=80\n Q219=60\n Q240=7\n Q206=150\n Q207=500\n Q209=200\n Q200=2\nCYCL CALL');
  const passes = r.moves.filter(m => m.cycle && m.feed === 500);
  ok(!r.errors.length && passes.length === 7 && near(Math.max(...passes.map(m => m.to.y)), 72), '230: 7 passes from Y12 to Y72');
  r = R('CYCL DEF 231 RULED SURFACE\n Q225=+0\n Q226=+5\n Q227=-2\n Q228=+100\n Q229=+15\n Q230=+5\n Q231=+15\n Q232=+125\n Q233=+25\n Q234=+15\n Q235=+125\n Q236=+25\n Q240=40\n Q207=500\nCYCL CALL');
  ok(!r.errors.length && r.moves.some(m => m.cycle && near(m.to.z, 25)), '231: reaches the 3rd/4th point height Z+25');
}

console.log('THREAD MILLING — 262 263 264 265 267: radius, pitch, depth, Q351 x Q239 direction table, Q355; tapping hand by Q239');
{ const hdr = 'BEGIN PGM T MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+3\nTOOL CALL 1 Z S2000\nL Z+50 R0 FMAX M3\n';
  const R = (def, call = 'L X+50 Y+50 R0 FMAX M99') => TNC.run(hdr + def + '\n' + call + '\nEND PGM T MM');
  const T262 = (p, d, n, c) => `CYCL DEF 262 THREAD MILLING\n Q335=16\n Q239=${p}\n Q201=${d}\n Q355=${n}\n Q253=750\n Q351=${c}\n Q200=2\n Q203=+0\n Q204=50\n Q207=500`;
  const rad = (q, x = 50, y = 50) => Math.hypot(q.x - x, q.y - y);
  const hel = (r, rr) => r.moves.filter(m => m.kind === 'arc' && Math.abs(m.sweep) > Math.PI + 0.1 && near(rad(m.from), rr) && near(rad(m.to), rr));
  const turns = m => m.sweep / (2 * Math.PI);
  /* manual table, inside thread, M3 tool: RH +1 Z+ | LH -1 Z+ | RH -1 Z- | LH +1 Z-; climb = RL = ccw inside */
  [['+1.5', '+1', true, true], ['-1.5', '-1', false, true], ['+1.5', '-1', false, false], ['-1.5', '+1', true, false]].forEach(([p, c, ccw, up]) => {
    const r = R(T262(p, -20, 0, c)), h = hel(r, 5);
    ok(!r.errors.length && h.length === 1, `262 Q239=${p} Q351=${c}: one helix on R = 16/2 - 3 = 5 ` + JSON.stringify(r.errors));
    if (!h.length) return;
    ok((h[0].sweep > 0) === ccw && near(Math.abs(turns(h[0])), 1), `262 Q239=${p} Q351=${c}: one 360° turn ${ccw ? 'ccw' : 'cw'}`);
    ok(near(h[0].to.z - h[0].from.z, up ? 1.5 : -1.5), `262 Q239=${p} Q351=${c}: works ${up ? 'Z+' : 'Z-'} one pitch, dz ${(h[0].to.z - h[0].from.z).toFixed(3)}`);
    ok(near(Math.min(h[0].from.z, h[0].to.z), -20), `262 Q239=${p} Q351=${c}: thread reaches the depth Z-20`);
    ok(near(h[0].from.x, 55) && near(h[0].from.y, 50) && near(h[0].to.x, 55), `262: starts and ends on the reference axis X+55`);
  });
  let r = R(T262('+1.5', -20, 0, '+1')), h = hel(r, 5)[0];
  ok(h && near(h.feed, 500 * 5 / 8), '262: Q207 is the feed at the cutting edge: centre runs 500 x 5 / 8 = 312.5, got ' + (h && h.feed));
  const last = r.moves[r.moves.length - 1];
  ok(near(last.to.x, 50) && near(last.to.y, 50) && near(last.to.z, 50), '262: back at the hole centre, 2nd set-up clearance Z+50');
  r = R(T262('+1.5', -20, 1, '+1')); h = hel(r, 5);
  ok(!r.errors.length && h.length === 1 && near(turns(h[0]), 14) && near(h[0].from.z, -20) && near(h[0].to.z, 1), 'Q355=1: one continuous helix, ceil(20 / 1.5) = 14 turns, Z-20 -> Z+1');
  r = R(T262('+1.5', -20, 3, '-1')); h = hel(r, 5);
  ok(!r.errors.length && h.length === 5 && h.every(m => near(turns(m), -1)), 'Q355=3: ceil(20 / 4.5) = 5 separate 360° paths, got ' + h.length);
  ok(h.length === 5 && h.map(m => +m.to.z.toFixed(3)).join() === '-2,-6.5,-11,-15.5,-20', 'Q355=3, up-cut: paths offset 3 x 1.5, top first, the last ends at Z-20: ' + h.map(m => +m.to.z.toFixed(3)));
  r = R(T262('+1.5', 0, 0, '+1'));
  ok(!r.errors.length && !r.moves.some(m => m.cycle), '262: thread depth 0 -> the cycle is not executed');
  r = R(T262('+1.5', -20, 0, '+1').replace('Q335=16', 'Q335=6'));
  ok(r.errors.some(e => e.msg === 'TOOL RADIUS TOO LARGE'), '262: tool R3 in a 6 mm thread -> TOOL RADIUS TOO LARGE');
  r = R('CYCL DEF 267 OUTSIDE THREAD MLLNG\n Q335=16\n Q239=+1.5\n Q201=-20\n Q355=0\n Q253=750\n Q351=+1\n Q200=2\n Q358=+0\n Q359=+0\n Q203=+0\n Q204=50\n Q254=150\n Q207=500');
  h = hel(r, 11);
  ok(!r.errors.length && h.length === 1 && h[0].sweep < 0 && near(h[0].to.z - h[0].from.z, -1.5) && near(h[0].to.z, -20), '267 RH climb: outside on R = 8 + 3 = 11, cw, works Z- to Z-20');
  ok(r.moves.some(m => m.cycle && m.kind === 'rapid' && near(m.to.x, 62.5) && near(m.to.y, 50) && m.to.z > 0), '267: starts on the reference axis');
  ok(h[0] && near(h[0].feed, 500 * 11 / 8), '267: centre feed 500 x 11 / 8 outside');
  r = R('CYCL DEF 267 OUTSIDE THREAD MLLNG\n Q335=16\n Q239=+1.5\n Q201=-20\n Q355=0\n Q253=750\n Q351=-1\n Q200=2\n Q358=+0\n Q359=+0\n Q203=+0\n Q204=50\n Q254=150\n Q207=500');
  h = hel(r, 11);
  ok(h.length === 1 && h[0].sweep > 0 && near(h[0].to.z - h[0].from.z, 1.5), '267 RH up-cut: ccw, works Z+');
  r = R('CYCL DEF 265 HEL.THREAD DRLG/MLG\n Q335=16\n Q239=+1.5\n Q201=-16\n Q253=750\n Q358=+0\n Q359=+0\n Q360=0\n Q200=2\n Q203=+0\n Q204=50\n Q254=150\n Q207=500');
  h = hel(r, 5);
  ok(!r.errors.length && h.length === 1 && near(turns(h[0]), -11) && near(h[0].to.z, -16) && near(h[0].from.z, 0.5), '265 RH: one continuous cw helix downward, 11 turns to Z-16');
  r = R('CYCL DEF 265 HEL.THREAD DRLG/MLG\n Q335=16\n Q239=-1.5\n Q201=-16\n Q253=750\n Q358=+0\n Q359=+0\n Q360=0\n Q200=2\n Q203=+0\n Q204=50\n Q254=150\n Q207=500');
  h = hel(r, 5);
  ok(h.length === 1 && h[0].sweep > 0 && h[0].to.z < h[0].from.z, '265 LH: ccw, still downward');
  r = R('CYCL DEF 264 THREAD DRILLNG/MLLNG\n Q335=16\n Q239=+1.5\n Q201=-16\n Q356=-20\n Q253=750\n Q351=+1\n Q202=5\n Q258=0.2\n Q257=0\n Q256=0.2\n Q358=+0\n Q359=+0\n Q200=2\n Q203=+0\n Q204=50\n Q206=150\n Q207=500');
  h = hel(r, 5);
  const drill = r.moves.filter(m => m.cycle && m.kind === 'feed' && m.feed === 150 && m.from.z - m.to.z > 1).map(m => +m.to.z.toFixed(3));
  ok(!r.errors.length && drill.join() === '-5,-10,-15,-20', '264: drills Q356 -20 in pecks of Q202 5 at Q206: ' + drill);
  ok(h.length === 1 && near(h[0].from.z, -16) && near(h[0].to.z, -14.5), '264: then one 360° thread path from the thread depth Z-16');
  r = R('CYCL DEF 263 THREAD MLLNG/CNTSNKG\n Q335=16\n Q239=+1.5\n Q201=-16\n Q356=-20\n Q253=750\n Q351=+1\n Q200=2\n Q357=0\n Q358=-1\n Q359=2\n Q203=+0\n Q204=50\n Q254=150\n Q207=500');
  h = hel(r, 5);
  const sink = r.moves.find(m => m.cycle && m.kind === 'feed' && near(m.to.z, -20));
  const ring = r.moves.find(m => m.kind === 'arc' && near(Math.abs(m.sweep), 2 * Math.PI) && near(rad(m.from), 2) && near(m.to.z, -1));
  ok(!r.errors.length && sink && sink.feed === 150 && near(sink.from.z, -18), '263: countersinking: F750 to Q356 + set-up clearance, F150 (Q254) to Z-20');
  ok(ring && ring.feed === 150, '263: countersinking at front: full circle Q359 = 2 at Q358 = Z-1, F150');
  ok(h.length === 1 && near(h[0].from.z, -16), '263: one 360° thread path from Z-16');
  const dlg = TNC_DIALOGS.cycleSpec(262), dv = {}; dlg.steps.forEach(s => dv[s.k] = s.dflt);
  r = R(dlg.build(dv));
  ok(!r.errors.length && hel(r, 2).length === 1, 'dialog: CYCL DEF 262 built from the manual\'s example values runs clean');
  ok([263, 264, 265, 267].every(n => { const s = TNC_DIALOGS.cycleSpec(n), v = {}; s.steps.forEach(t => v[t.k] = t.dflt); return !R(s.build(v)).errors.length; }), 'dialog: 263 264 265 267 with the example values run clean');
  r = R('CYCL DEF 207 RIGID TAPPING NEW\n Q200=2\n Q201=-20\n Q239=-1.5\n Q203=+0\n Q204=50');
  const tin = r.moves.find(m => m.cycle && m.kind === 'feed' && m.to.z < m.from.z);
  ok(tin && tin.spindle < 0, '207 Q239 -1.5 = left-hand: the spindle turns M4 on the way in');
  r = TNC.run(hdr + 'L X+50 Y+50 R0 FMAX M5\nL Z-5 R0 FMAX\nCYCL DEF 18.0 THREAD CUTTING\nCYCL DEF 18.1 DEPTH -20\nCYCL DEF 18.2 PITCH +1\nCYCL CALL\nL Z+5 R0 FMAX\nEND PGM T MM');
  const c18 = r.moves.filter(m => m.cycle);
  ok(!r.errors.length && c18.length === 1 && c18[0].spindle > 0 && near(c18[0].to.z, -25) && r.moves[r.moves.length - 1].spindle === 0, 'cycle 18: starts M3 itself (pitch +, depth -), cuts to depth, stops the spindle, no retract');
}

console.log('Touch probe cycles (iTNC 530 manual ch. 13/15/19; results Q150-Q162 per 426/430 manual 10.10) — ideal blank, nominal results');
{ const hdr = 'BEGIN PGM P MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 11 Z\nL Z+50 R0 FMAX\n', end = '\nEND PGM P MM';
  const R = (s, o) => TNC.run(hdr + s + end, o), last = r => r.moves[r.moves.length - 1];
  const P412 = (q301, q365, q305, q303) => 'TCH PROBE 412 DATUM INSIDE CIRCLE ~\n Q321=+50 ;CENTER IN 1ST AXIS ~\n Q322=+50 ;CENTER IN 2ND AXIS ~\n Q262=75 ;NOMINAL DIAMETER ~\n Q325=+0 ;STARTING ANGLE ~\n Q247=+60 ;STEPPING ANGLE ~\n Q261=-5 ;MEASURING HEIGHT ~\n Q320=0 ;SETUP CLEARANCE ~\n Q260=+20 ;CLEARANCE HEIGHT ~\n Q301=' + q301 + ' ;MOVE TO CLEARANCE ~\n Q305=' + q305 + ' ;NO. IN TABLE ~\n Q331=+0 ;DATUM ~\n Q332=+0 ;DATUM ~\n Q303=' + q303 + ' ;MEAS. VALUE TRANSFER ~\n Q381=0 ;PROBE IN TS AXIS ~\n Q382=+85 ;1ST CO. FOR TS AXIS ~\n Q383=+50 ;2ND CO. FOR TS AXIS ~\n Q384=+0 ;3RD CO. FOR TS AXIS ~\n Q333=+1 ;DATUM ~\n Q423=4 ;NO. OF MEAS. POINTS ~\n Q365=' + q365 + ' ;TYPE OF TRAVERSE';
  let r = R(P412(0, 1, 12, 1) + '\nL X+Q151 Y+Q152 Z+Q153 R0 FMAX');
  const t = r.moves.filter(m => m.touch), all = r.moves.filter(m => m.cycle === 'TCH PROBE 412');
  ok(!r.errors.length && t.length === 4 && t.every(m => m.kind === 'feed' && m.feed === 500 && near(Math.hypot(m.to.x - 50, m.to.y - 50), 37.5 - 3) && near(m.to.z, -8)),
    '412 manual example: 4 touches at MP 6120 F500, ball centre stops R3 short of the D75 wall, tip at Q261 - R = -8');
  ok(t.map(m => Math.round(Math.atan2(m.to.y - 50, m.to.x - 50) * 180 / Math.PI)).join() === '0,60,120,180', '412: touch points from Q325 = 0 in steps of Q247 = 60°');
  ok(all.every(m => m.probe) && all.filter(m => m.kind === 'arc').length === 3 && all.filter(m => m.kind === 'arc').every(m => near(m.to.z, -8) && m.ccw), '412 Q301 = 0: between points on an arc at measuring height (Q247 + = ccw), every move tagged probe');
  ok(all[0].kind === 'rapid' && near(all[0].from.z, 50) && near(all[0].to.z, 50) && near(all[all.length - 1].to.z, 20), '412: positioning logic — above Q260 it moves in the plane first; ends at the clearance height Q260');
  ok(near(last(r).to.x, 50) && near(last(r).to.y, 50) && near(last(r).to.z, 75), '412: Q151/Q152 = nominal centre, Q153 = nominal diameter; Q305 = 12, Q303 = 1 writes the preset table only — the datum stays');
  r = R(P412(1, 0, 0, 1));
  const a2 = r.moves.filter(m => m.probe && !m.touch && Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 5);
  ok(a2.length === 4 && a2.slice(1).every(m => m.kind === 'rapid' && near(m.to.z, 20)), '412 Q301 = 1, Q365 = 0: between points straight at the clearance height');
  ok(!R(P412(1, 1, 0, 1)).moves.some(m => m.kind === 'arc' && !near(m.to.z, 20) && m.probe), '412 Q301 = 1, Q365 = 1: arcs at the clearance height');
  r = R(P412(0, 1, 0, 1).replace('Q331=+0', 'Q331=+5').replace('Q332=+0', 'Q332=-7') + '\nL X+0 Y+0 R0 FMAX');
  ok(!r.errors.length && near(last(r).to.x, 45) && near(last(r).to.y, 57), '412 Q305 = 0: the display is set, centre (50,50) now reads (5,-7): X+0 Y+0 goes to machine (45,57)');
  r = R(P412(0, 1, 0, 1).replace('Q262=75', 'Q262=8') + '\n');
  const cent = r.moves.filter(m => m.cycle === 'TCH PROBE 412' && !m.touch && m.kind !== 'rapid');
  ok(!r.errors.length && !cent.length && r.moves.filter(m => m.touch).every(m => near(m.from.x, 50) && near(m.from.y, 50)), '412 D8 with R3 + MP 6140 2: no room — every point probed from the centre, no moves between');
  /* manual 15.13 example CYC413: 413 + Q381, display X0 Y10, Z0 on the top */
  r = R('TCH PROBE 413 DATUM OUTSIDE CIRCLE\n Q321=+25\n Q322=+25\n Q262=30\n Q325=+90\n Q247=+45\n Q261=-5\n Q320=2\n Q260=+10\n Q301=0\n Q305=0\n Q331=+0\n Q332=+10\n Q303=+0\n Q381=1\n Q382=+25\n Q383=+25\n Q384=+25\n Q333=+0\n Q423=4\n Q365=1\nL X+0 Y+10 Z+0 R0 FMAX');
  const t3 = r.moves.filter(m => m.touch);
  ok(!r.errors.length && t3.length === 5 && t3.slice(0, 4).every(m => near(Math.hypot(m.to.x - 25, m.to.y - 25), 18) && near(Math.hypot(m.from.x - 25, m.from.y - 25), 22)), '413: 4 touches from outside, start on R 15 + 3 + 2 + Q320 2, contact on R 18');
  ok(near(t3[4].to.x, 25) && near(t3[4].to.y, 25) && near(t3[4].to.z, 25) && near(t3[4].from.z, 29), '413 Q381 = 1: then down onto Q384 at (Q382, Q383) from Q384 + clearance');
  ok(near(last(r).to.x, 25) && near(last(r).to.y, 25) && near(last(r).to.z, 25), '413 example: centre (25,25) reads X0 Y10, top Z25 reads Z0 -> X+0 Y+10 Z+0 = machine (25,25,25)');
  /* manual 15.13 example CYC416 (417 part): Z into preset row 1, cycle 247 Q339 = 1 activates it */
  const P417 = 'TCH PROBE 417 DATUM IN TS AXIS\n Q263=+7.5\n Q264=+7.5\n Q294=+25\n Q320=0\n Q260=+50\n Q305=1\n Q333=+0\n Q303=+1\n';
  r = R(P417 + 'L X+0 Y+0 Z+0 R0 FMAX\nCYCL DEF 247 DATUM SETTING\n Q339=1\nL X+0 Y+0 Z+0 R0 FMAX');
  const t7 = r.moves.find(m => m.touch), zs = r.moves.filter(m => !m.probe).map(m => m.to.z);
  ok(!r.errors.length && t7 && near(t7.to.z, 25) && near(t7.from.z, 27) && near(t7.to.x, 7.5), '417: one touch down from Q294 + MP 6140 onto Q294 at (Q263, Q264)');
  ok(near(zs[zs.length - 2], 0) && near(zs[zs.length - 1], 25), '417 Q305 = 1, Q303 = 1: preset row only; cycle 247 Q339 = 1 then puts Z0 on the probed top');
  r = R('L X-55 Y+0 R0 FMAX\nTCH PROBE 419 DATUM IN ONE AXIS ~\n Q263=-55 ~\n Q264=+0 ~\n Q261=-4 ~\n Q320=+12 ~\n Q260=+5 ~\n Q272=+1 ~\n Q267=+1 ~\n Q305=+0 ~\n Q333=-40 ~\n Q303=+1\nL X-40 Y+0 R0 FMAX');
  const t9 = r.moves.find(m => m.touch);
  ok(!r.errors.length && near(t9.from.x, -72) && near(t9.to.x, -58) && near(t9.to.z, -7), '419 X, direction +: start Q263 - (R + MP 6140 + Q320), ball centre stops R short');
  ok(near(last(r).to.x, -55), '419: X-55 now reads X-40');
  r = R('TCH PROBE 411 DATUM OUTS. RECTAN.\n Q321=+22.5\n Q322=+0\n Q323=+35\n Q324=+60\n Q261=-4\n Q320=+12\n Q260=+5\n Q301=0\n Q305=+0\n Q331=+22.5\n Q332=+0\n Q303=+1\n Q381=+0\n Q382=+0\n Q383=+0\n Q384=+0\n Q333=+0');
  const s11 = r.moves.filter(m => m.probe && !m.touch && near(m.to.z, -7) && Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 1e-6);
  ok(!r.errors.length && r.moves.filter(m => m.touch).length === 4 && s11.every(m => near(m.to.x, m.from.x) || near(m.to.y, m.from.y)), '411 Q301 = 0: paraxial moves at measuring height around the stud');
  ok(s11.every(m => Math.abs(m.to.x - 22.5) > 17.5 + 3 - 1e-6 || Math.abs(m.to.y) > 30 + 3 - 1e-6), '411: the paraxial path rounds the corners outside the stud');
  r = R('CYCL DEF 200 DRILLING\n Q200=2\n Q201=-10\n Q206=150\n Q202=5\n Q210=0\n Q203=+0\n Q204=50\n Q211=0\n' + P417.replace('Q305=1', 'Q305=0') + 'L X+50 Y+50 R0 FMAX M3\nCYCL CALL');
  ok(!r.errors.length && r.moves.some(m => m.cycle === 'DRILLING 200'), 'a TCH PROBE does not replace the last CYCL DEF');
  r = R('TOOL CALL 4 Z\nTCH PROBE 31.0 TOOL LENGTH\nTCH PROBE 31.1 CHECK: 1 Q5\nTCH PROBE 31.2 HEIGHT: +120\nTCH PROBE 31.3 PROBING THE TEETH: 1\nQ5 = Q5 + 1\nTCH PROBE 481 TOOL LENGTH\n Q340=1 ;CHECK\n Q260=+100 ;CLEARANCE HEIGHT\n Q341=1 ;PROBING THE TEETH\nTCH PROBE 562 TOOL SETTING L ~\n Q350=+0 ;MEASURING TYPE ~\n Q361=+2 ;NUMBER OF MEASUREMEN ~\n Q362=+0.005 ;DISPERSION TOLERANCE\nL X+Q5 Y+Q199 Z+Q115 R0 FMAX');
  ok(!r.errors.length && !r.moves.some(m => m.probe) && near(last(r).to.x, 1) && near(last(r).to.y, 0) && near(last(r).to.z, 0), 'TT 31 (dotted) / 481 / 562: no motion; status Q5 / Q199 = 0 (in tolerance), deviation Q115 = 0');
  const pb = TNC.parse('TCH PROBE 31.0 TOOL LENGTH\nTCH PROBE 31.1 CHECK: 0\nTCH PROBE 412 DATUM INSIDE CIRCLE ~\n Q321=+50 ;CENTER ~\n Q322=+50\nL X+0').blocks;
  ok(pb.map(b => b.kind + b.n).join() === 'TCHPROBE0,CYCLPARM1,TCHPROBE2,CYCLPARM2,CYCLPARM2,L3', 'numbering: dotted TCH PROBE lines are blocks; Q lines belong to their TCH PROBE');
  r = R('TCH PROBE 400 BASIC ROTATION\n Q263=+10\n Q264=+3.5');
  ok(r.errors.some(e => e.msg === 'TCH PROBE 400 NOT IMPLEMENTED IN SIMULATOR'), 'a probe cycle not simulated parses and says so');
  const ps = TNC_DIALOGS.probeSpec(412), pv = {}; ps.steps.forEach(s => pv[s.k] = s.dflt);
  ok(/^TCH PROBE 412 DATUM INSIDE CIRCLE\n/.test(ps.build(pv)) && !R(ps.build(pv)).errors.length, 'dialog: TCH PROBE 412 from the manual\'s example values runs clean');
  ok(TNC_DIALOGS.probeList().every(c => { const s = TNC_DIALOGS.probeSpec(c.num), v = {}; s.steps.forEach(t => v[t.k] = t.dflt); return !R(s.build(v)).errors.length; }), 'dialog: every TCH PROBE spec with its example values runs clean');
}

console.log('Coordinate dialog — P turns L / C / CT into LP / CP / CTP (6.5); I = incremental polar words');
{ const D = TNC_DIALOGS.PATH, hdr = 'BEGIN PGM P MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+5\nTOOL CALL 1 Z S2000\nL Z+2 R0 FMAX M3\n';
  ok(D.L.polar === 'LP' && D.C.polar === 'CP' && D.CT.polar === 'CTP' && !D.CC.polar && !D.CR.polar, 'P key targets: L→LP, C→CP, CT→CTP; CC (pole: Cartesian only) and CR have none');
  const lp = D.LP.build({ pr: '30', pa: '0', rc: 'R0', f: '300' }), lpi = D.LP.build({ pa: 'I60' }), cp = D.CP.build({ pa: 'I-90', dr: 'DR-' }), ctp = D.CTP.build({ pr: '30', pa: '30' });
  ok(lp === 'LP PR+30 PA+0 R0 F300' && lpi === 'LP IPA+60' && cp === 'CP IPA-90 DR-' && ctp === 'CTP PR+30 PA+30', 'polar words: ' + [lp, lpi, cp, ctp].join(' | '));
  const r = TNC.run(hdr + 'CC X+40 Y+35\nL X+0 Y+35 F250\n' + D.LP.build({ pr: '25', pa: '120' }) + '\n' + ctp + '\nEND PGM P MM');
  const lm = r.moves[r.moves.length - 1];
  ok(!r.errors.length && lm.kind === 'arc' && near(lm.to.x, 40 + 30 * Math.cos(Math.PI / 6)) && near(lm.to.y, 35 + 15), 'manual p. 153 example built by the dialogs: LP PR+25 PA+120, CTP PR+30 PA+30 ends at the pole + 30 at 30 deg');
}

console.log('Coordinate dialog — keypad words (PC keyboard + soft keys), whole polar words, APPR/DEP polar (6.3 p. 134, examples p. 155-157)');
{ const D = TNC_DIALOGS.PATH, K = TNC_DIALOGS.PAD, AX = ['X', 'Y', 'Z'];
  /* the PC keyboard: each character typed at the end of the line; null = the browser types it as is (ui.js wizKey) */
  const typed = (keys, coords) => [...keys].reduce((l, ch) => { const n = K.type(l, ch, coords, AX); return n == null ? l + ch : n; }, '');
  const coordsOf = keys => K.coords(typed(keys, true), AX);
  ok(coordsOf('x10iy5') === 'X+10 IY+5', 'x10iy5 (no spaces) -> X+10 IY+5, got ' + coordsOf('x10iy5'));
  ok(coordsOf('x10 iy5') === 'X+10 IY+5' && coordsOf('ix10y-5') === 'IX+10 Y-5' && coordsOf('xi10') === 'IX+10' && coordsOf('10i5') === 'X+10 IY+5',
     'x10 iy5 / ix10y-5 / xi10 / 10i5 -> ' + ['x10 iy5', 'ix10y-5', 'xi10', '10i5'].map(coordsOf).join(' | '));
  /* the on-screen keys: X 1 0 I Y 5 and I before the axis */
  let l = ''; l = K.axis(l, 'X'); l = K.digit(l, '1'); l = K.digit(l, '0'); l = K.inc(l, true); l = K.axis(l, 'Y'); l = K.digit(l, '5');
  let l2 = ''; l2 = K.inc(l2, true); l2 = K.axis(l2, 'X'); l2 = K.digit(l2, '7'); l2 = K.sign(l2); l2 = K.inc(l2, true); l2 = K.inc(l2, true);
  ok(K.coords(l, AX) === 'X+10 IY+5' && l2 === 'IX-7 ' && K.inc('X', true) === 'IX' && K.inc('IX', true) === 'X', 'soft keys X 1 0 I Y 5 -> ' + K.coords(l, AX) + '; I X 7 -/+ I I -> "' + l2 + '"; I before the value toggles');
  /* PR / PA questions: one word, typed whole or bare */
  const pol = ['-90', 'i-90', 'PA-90', 'IPA+60', 'pa+q5'].map(k => typed(k, false));
  ok(pol.join(' ') === '-90 I-90 PA-90 IPA+60 PA+q5', 'PA question typing: ' + pol.join(' | '));
  ok(pol.every(v => K.polar(v, 'PA') === '') && typed('PR+25', false) === 'PR+25' && typed('IPR-5', false) === 'IPR-5' && K.polar('IPR-5', 'PR') === '',
     'whole and bare polar words pass the PR/PA check');
  ok(K.polar('PR+25', 'PA') !== '' && K.polar('I+PA60', 'PA') !== '' && K.polar('-PA90', 'PA') !== '', 'PR on the PA question and the old broken forms are refused');
  const cp = D.CP.build({ pa: typed('IPA+60', false), dr: 'DR+' }), lp = D.LP.build({ pr: typed('IPR-5', false), pa: typed('PA-90', false) });
  ok(cp === 'CP IPA+60 DR+' && lp === 'LP IPR-5 PA-90', 'built: ' + cp + ' | ' + lp);
  /* APPR / DEP polar */
  ok(D.APPR.polar === 'APPRP' && D.DEP.polar === 'DEPP' && D.DEP.polarIf({ form: 'LCT' }) === '' && ['LT', 'LN', 'CT'].every(f => D.DEP.polarIf({ form: f })),
     'P targets: APPR -> APPR P.. (all forms), DEP -> DEP PLCT only');
  ok(Object.keys(D).filter(k => D[k].polar).every(k => { const s = D[k].steps, t = D[D[k].polar].steps, i = s.findIndex(x => x.type === 'coords');
    return t[i] && t[i].pol && s.slice(0, i).every((x, j) => x.k === t[j].k); }), 'every polar spec has its PR/PA step where the coordinates step was (answers so far kept)');
  const aplct = D.APPRP.build({ form: 'LCT', pr: '45', pa: '180', r: '5', rc: 'RL', f: '250' }), dplct = D.DEPP.build({ form: 'LCT', pr: '60', pa: '180', r: '5', f: '1000' });
  const apct = D.APPRP.build({ form: 'CT', pr: '32', pa: '-180', cca: '180', r: '2', rc: 'RL', f: '100' });
  ok(aplct === 'APPR PLCT PR+45 PA+180 R+5 RL F250' && dplct === 'DEP PLCT PR+60 PA+180 R+5 F1000' && apct === 'APPR PCT PR+32 PA-180 CCA180 R+2 RL F100', 'built: ' + [aplct, dplct, apct].join(' | '));
  const same = (a, b) => a.moves.length === b.moves.length && a.moves.every((m, i) => !m.to || (near(m.to.x, b.moves[i].to.x) && near(m.to.y, b.moves[i].to.y) && near(m.to.z, b.moves[i].to.z)));
  const lpo = P.LINEARPO.replace('APPR PLCT PR+45 PA+180 R5 RL F250', aplct).replace('DEP PLCT PR+60 PA+180 R5 F1000', dplct);
  const hx = P.HELIX.replace('APPR PCT PR+32 PA-180 CCA180 R+2 RL F100', apct);
  const r1 = TNC.run(lpo), r0 = TNC.run(P.LINEARPO), r2 = TNC.run(hx), r3 = TNC.run(P.HELIX);
  ok(lpo !== P.LINEARPO && !r1.errors.length && same(r1, r0), 'LINEARPO (p. 155) with the dialog-built APPR PLCT / DEP PLCT runs and moves exactly as the manual blocks');
  ok(P.HELIX.includes('\n' + apct + '\n') && !r2.errors.length && same(r2, r3), 'HELIX (p. 156): the dialog-built APPR PCT is the manual block character for character, and runs');
  for (const f of ['LT', 'LN']) {   // PLT / PLN: polar by p. 134 ("position data ... Cartesian or polar"); no manual example
    const b = D.APPRP.build({ form: f, pr: '45', pa: '180', len: '10', rc: 'RL', f: '250' }), cart = P.LINEARPO.replace('APPR PLCT PR+45 PA+180 R5 RL F250', 'APPR ' + f + ' X+5 Y+50 LEN10 RL F250');
    const rp = TNC.run(P.LINEARPO.replace('APPR PLCT PR+45 PA+180 R5 RL F250', b)), rc = TNC.run(cart);
    ok(b === 'APPR P' + f + ' PR+45 PA+180 LEN10 RL F250' && !rp.errors.length && same(rp, rc), b + ' runs like APPR ' + f + ' X+5 Y+50 (the same point)');
  }
}

console.log('TNC 430 (operator\'s machine) — limits, arc tolerance 0.006, F cap 1500, cycle 19 tilts the head');
{ const M430 = { arcTol: 0.006, pocketK: 1.1, fMax: 1500, accel: 0.4, sMax: 2500, rapid: { x: 9000, y: 10000, z: 5000, a: 4000, b: 1000 },
    axes: ['X', 'Y', 'Z', 'B', 'A'], limits: { B: [-180.1, 0.1], A: [-195, 15] } };
  const hdr = 'BEGIN PGM M MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 4 Z S2000\nL Z+50 R0 FMAX M3\n';
  let r = TNC.run(hdr + 'L B+10 FMAX\nEND PGM M MM', { machine: M430 });
  ok(r.errors.some(e => e.msg === 'LIMIT SWITCH B+'), 'B+10 beyond +0.1 -> LIMIT SWITCH B+');
  r = TNC.run(hdr + 'L B-45 A+10 FMAX\nEND PGM M MM', { machine: M430 });
  const rm = r.moves[r.moves.length - 1];
  ok(!r.errors.length && rm.rot1 && rm.rot1.b === -45 && rm.rot1.a === 10 && rm.dur > 0, 'rotary move B-45 A+10 takes machine time');
  const arc = 'CC X+50 Y+50\nL X+60 Y+50 Z-1 F200\nC X+50 Y+60.01 DR+\nEND PGM M MM';
  ok(!TNC.run(hdr + arc).errors.length && TNC.run(hdr + arc, { machine: M430 }).errors.some(e => /ARC END/.test(e.msg)), 'a 0.01 radius mismatch passes on the default (0.05) and fails on the 430 (MP 7431 0.006)');
  r = TNC.run(hdr + 'L X+50 Y+50 Z-1 F3000\nEND PGM M MM', { machine: M430 });
  ok(r.moves[r.moves.length - 1].feed === 1500, 'F3000 is capped at MP 1020 1500');
  r = TNC.run(hdr + 'CYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1 A+0 B-90 C+0\nL X+10 Y+0 Z+0 R0 FMAX\nCYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1 A+0 B+0 C+0\nEND PGM M MM', { machine: M430 });
  const tilt = r.moves.find(m => m.rot1 && m.rot1.b === -90), after = r.moves.find(m => m.block === 7);
  ok(!r.errors.length && tilt, 'cycle 19 B-90 turns the head to B-90 (MP 7500 bit 2)');
  ok(after && near(Math.hypot(after.to.x, after.to.y, after.to.z), 10), 'a point 10 mm out in the tilted plane stays 10 mm from the datum');
}
console.log('SL cycles 14, 20-25 (8.6, p. 284-307): contour geometry from subprograms, rough-out, finishing, contour train');
{ /* the manual's example C21 (p. 303-305): pilot drilling, rough-out, floor and side finishing of two overlapping pockets with two islands */
  const C21 = 'BEGIN PGM C21 MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+6\nTOOL DEF 2 L+0 R+6\nTOOL CALL 1 Z S2500\nL Z+250 R0 F MAX\n' +
    'CYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL 1 /2 /3 /4\nCYCL DEF 20.0 CONTOUR DATA\n Q1=-20 ;MILLING DEPTH\n Q2=1 ;TOOL PATH OVERLAP\n Q3=+0.5 ;ALLOWANCE FOR SIDE\n' +
    ' Q4=+0.5 ;ALLOWANCE FOR FLOOR\n Q5=+0 ;WORKPIECE SURFACE COORD.\n Q6=2 ;SET-UP CLEARANCE\n Q7=+100 ;CLEARANCE HEIGHT\n Q8=0.1 ;ROUNDING RADIUS\n Q9=-1 ;DIRECTION OF ROTATION\n' +
    'CYCL DEF 21.0 PILOT DRILLING\n Q10=5 ;PLUNGING DEPTH\n Q11=250 ;FEED RATE FOR PLUNGING\n Q13=2 ;ROUGH-OUT TOOL\nCYCL CALL M3\nL Z+250 R0 F MAX M6\nTOOL CALL 2 Z S3000\n' +
    'CYCL DEF 22.0 ROUGH-OUT\n Q10=5 ;PLUNGING DEPTH\n Q11=100 ;FEED RATE FOR PLUNGING\n Q12=350 ;FEED RATE FOR MILLING\n Q18=0 ;COARSE ROUGHING TOOL\n Q19=150 ;RECIPROCATION FEED RATE\nCYCL CALL M3\n' +
    'CYCL DEF 23.0 FLOOR FINISHING\n Q11=100 ;FEED RATE FOR PLUNGING\n Q12=200 ;FEED RATE FOR MILLING\nCYCL CALL\n' +
    'CYCL DEF 24.0 SIDE FINISHING\n Q9=+1 ;DIRECTION OF ROTATION\n Q10=5 ;PLUNGING DEPTH\n Q11=100 ;FEED RATE FOR PLUNGING\n Q12=400 ;FEED RATE FOR MILLING\n Q14=+0 ;ALLOWANCE FOR SIDE\nCYCL CALL\n' +
    'L Z+250 R0 F MAX M2\nLBL 1\nCC X+35 Y+50\nL X+10 Y+50 RR\nC X+10 DR-\nLBL 0\nLBL 2\nCC X+65 Y+50\nL X+90 Y+50 RR\nC X+90 DR-\nLBL 0\n' +
    'LBL 3\nL X+27 Y+50 RL\nL Y+58\nL X+43\nL Y+42\nL X+27\nLBL 0\nLBL 4\nL X+65 Y+42 RL\nL X+57\nL X+65 Y+58\nL X+73 Y+42\nLBL 0\nEND PGM C21 MM';
  const seg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let u = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; u = Math.max(0, Math.min(1, u)); return Math.hypot(a[0] + dx * u - p[0], a[1] + dy * u - p[1]); };
  const inPoly = (p, Q) => { let c = false; for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) c = !c; } return c; };
  const wall = (p, Q) => Math.min(...Q.map((a, i) => seg(p, a, Q[(i + 1) % Q.length])));
  const sq = [[27, 50], [27, 58], [43, 58], [43, 42], [27, 42]], tri = [[65, 42], [57, 42], [65, 58], [73, 42]];
  /* room around the tool centre: in either circle (pockets A, B), outside both islands */
  const room = p => Math.min(Math.max(25 - Math.hypot(p[0] - 35, p[1] - 50), 25 - Math.hypot(p[0] - 65, p[1] - 50)), inPoly(p, sq) ? -wall(p, sq) : wall(p, sq), inPoly(p, tri) ? -wall(p, tri) : wall(p, tri));
  const pts = m => [...Array(11).keys()].map(k => { const t = k / 10;
    if (m.kind !== 'arc') return [m.from.x + (m.to.x - m.from.x) * t, m.from.y + (m.to.y - m.from.y) * t];
    const a0 = Math.atan2(m.from.y - m.cy, m.from.x - m.cx), rr = Math.hypot(m.from.x - m.cx, m.from.y - m.cy); return [m.cx + rr * Math.cos(a0 + m.sweep * t), m.cy + rr * Math.sin(a0 + m.sweep * t)]; });
  const cyc = (r, n) => r.moves.filter(m => (m.cycle || '').endsWith(' ' + n));
  const cutting = ms => ms.filter(m => m.kind !== 'rapid' && Math.max(m.from.z, m.to.z) < -1e-6);
  const minRoom = ms => Math.min(...cutting(ms).flatMap(pts).map(room));
  let r = TNC.run(C21);
  const c21 = cyc(r, 21), c22 = cyc(r, 22), c23 = cyc(r, 23), c24 = cyc(r, 24);
  ok(!r.errors.length && c21.length && c22.length && c23.length && c24.length, 'C21 runs clean; cycles 21 22 23 24 all move');
  ok(minRoom(c22) >= 6.5 - 1e-6 && minRoom(c23) >= 6.5 - 1e-6, '22 / 23: the tool centre keeps R 6 + Q3 0.5 from every pocket and island wall (combined contour): ' + minRoom(c22).toFixed(4));
  ok(minRoom(c24) >= 6 - 1e-6 && minRoom(c24) < 6.01, '24 Q14 = 0: the finish path runs at R 6 from the walls: ' + minRoom(c24).toFixed(4));
  const lv = ms => [...new Set(cutting(ms).filter(m => m.kind !== 'rapid' && Math.abs(m.to.z - m.from.z) < 1e-9).map(m => +m.to.z.toFixed(3)))].sort((a, b) => b - a).join();
  ok(lv(c22) === '-5,-10,-15,-19.5' && lv(c23) === '-20' && lv(c24) === '-5,-10,-15,-20', 'depths: 22 in Q10 steps to Q1 + Q4 = -19.5, 23 on the floor -20, 24 in Q10 steps to -20: ' + [lv(c22), lv(c23), lv(c24)].join(' | '));
  const plunge = ms => ms.filter(m => m.kind === 'feed' && Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) < 1e-9 && m.to.z < m.from.z);
  const holes = [...new Set(plunge(c21).map(m => m.to.x.toFixed(3) + ',' + m.to.y.toFixed(3)))], in22 = new Set(plunge(c22).map(m => m.to.x.toFixed(3) + ',' + m.to.y.toFixed(3)));
  ok(holes.length && holes.every(h => in22.has(h)) && Math.min(...plunge(c21).map(m => m.to.z)) === -19.5 && plunge(c21).every(m => m.feed === 250),
    '21: drills where 22 plunges (Q13 = T2, R6 + Q3), like cycle 1 in Q10 pecks at Q11 F250 to Q1 + Q4 = -19.5: ' + holes.join(' '));
  ok(c22.every(m => m.kind === 'rapid' || m.feed === 100 || m.feed === 350) && c24.every(m => m.kind === 'rapid' || m.feed === 100 || m.feed === 400), 'feeds: Q11 plunging, Q12 milling');
  const arcs24 = c24.filter(m => m.kind === 'arc');
  ok(arcs24.length === 3 * 4 * 2 && arcs24.every(m => Math.abs(Math.abs(m.sweep) - Math.PI / 2) < 1e-9), '24: three subcontours (the pocket outline, two islands), each depth in and out on a quarter arc');
  const end22 = c22[c22.length - 1];
  ok(near(end22.to.x, 0) && near(end22.to.y, 0) && near(end22.to.z, 250) && c22.some(m => near(m.to.z, 100) && m.kind === 'rapid'), 'end of 22 (MP 7420 bit 4 = 0): clearance height Q7, then back to the position before the call');
  /* p. 288-289: overlapping pockets — union, intersection (the first starts inside the second), exclusion (island) */
  const two = (a, b) => 'BEGIN PGM S MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+3\nTOOL CALL 1 Z S3000\nL Z+50 R0 FMAX\nCYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL 1 /2\n' +
    'CYCL DEF 20.0 CONTOUR DATA\n Q1=-5\n Q2=1\n Q3=+0\n Q4=+0\n Q5=+0\n Q6=2\n Q7=+20\n Q8=0\n Q9=+1\nCYCL DEF 22.0 ROUGH-OUT\n Q10=5\n Q11=100\n Q12=350\n Q18=0\n Q19=150\nCYCL CALL M3\nL Z+50 R0 FMAX M2\n' +
    'LBL 1\n' + a + '\nCC X+35 Y+50\nC ' + a.split(' ').slice(1, 3).join(' ') + ' DR-\nLBL 0\nLBL 2\n' + b + '\nCC X+65 Y+50\nC X+90 Y+50 DR-\nLBL 0\nEND PGM S MM';
  const dA = p => 25 - Math.hypot(p[0] - 35, p[1] - 50), dB = p => 25 - Math.hypot(p[0] - 65, p[1] - 50);
  const span = (r, f) => { const c = cutting(cyc(r, 22)).flatMap(pts); return [Math.min(...c.map(f)), Math.min(...c.map(p => p[0])), Math.max(...c.map(p => p[0]))]; };
  r = TNC.run(two('L X+10 Y+50 RR', 'L X+90 Y+50 RR'));
  let s = span(r, p => Math.max(dA(p), dB(p)));
  ok(!r.errors.length && s[0] >= 3 - 1e-6 && near(s[1], 13, 0.01) && near(s[2], 87, 0.01), 'area of inclusion: A starts outside B -> both circles: x ' + s[1].toFixed(2) + '..' + s[2].toFixed(2));
  r = TNC.run(two('L X+60 Y+50 RR', 'L X+90 Y+50 RR'));
  s = span(r, p => Math.min(dA(p), dB(p)));
  ok(!r.errors.length && s[0] >= 3 - 1e-6 && near(s[1], 43, 0.01) && near(s[2], 57, 0.01), 'area of intersection: A starts inside B -> only the overlap: x ' + s[1].toFixed(2) + '..' + s[2].toFixed(2));
  r = TNC.run(two('L X+10 Y+50 RR', 'L X+90 Y+50 RL'));
  s = span(r, p => Math.min(dA(p), -dB(p)));
  ok(!r.errors.length && s[0] >= 3 - 1e-6 && near(s[1], 13, 0.01) && s[2] < 50, 'area of exclusion: B with RL is an island -> A without B: x ' + s[1].toFixed(2) + '..' + s[2].toFixed(2));
}
{ /* a 60 x 40 pocket, R5: the channel on the exact offset, clearing loops Q2 x R apart, MP 7420 order and end position */
  const pk = (c20, cyc, opt) => TNC.run('BEGIN PGM R MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+5\nTOOL CALL 1 Z S2000\nL X+0 Y+0 Z+50 R0 FMAX\n' +
    'CYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL 1\nCYCL DEF 20.0 CONTOUR DATA\n Q1=' + (c20 == null ? -10 : c20) + '\n Q2=1\n Q3=+0\n Q4=+0\n Q5=+0\n Q6=2\n Q7=+20\n Q8=0\n Q9=+1\n' +
    (cyc || 'CYCL DEF 22.0 ROUGH-OUT\n Q10=5\n Q11=100\n Q12=350\n Q18=0\n Q19=150') + '\nCYCL CALL M3\nL X+Q1 Y+Q9 R0 FMAX M2\nLBL 1\nL X+20 Y+20 RR\nL Y+60\nL X+80\nL Y+20\nL X+20\nLBL 0\nEND PGM R MM', opt);
  let r = pk();
  const c = r.moves.filter(m => m.cycle === 'ROUGH-OUT 22'), at5 = c.filter(m => m.kind === 'feed' && near(m.from.z, -5) && near(m.to.z, -5));
  const corners = new Set(at5.map(m => m.to.x.toFixed(3) + ',' + m.to.y.toFixed(3)));
  ok(!r.errors.length && ['25.003,25.003', '74.997,25.003', '74.997,54.997', '25.003,54.997', '35.003,35.003', '30.003,30.003'].every(k => corners.has(k)),
    'channel corners on the R5 offset (25,25)-(75,55) within 0.003 mm, clearing loops every Q2 x R = 5 mm');
  let miss = 0;
  for (let x = 25; x <= 75; x += 1) for (let y = 25; y <= 55; y += 1) if (!at5.some(m => { const dx = m.to.x - m.from.x, dy = m.to.y - m.from.y, l2 = dx * dx + dy * dy; let u = l2 ? ((x - m.from.x) * dx + (y - m.from.y) * dy) / l2 : 0; u = Math.max(0, Math.min(1, u)); return Math.hypot(m.from.x + dx * u - x, m.from.y + dy * u - y) <= 5 + 1e-6; })) miss++;
  ok(miss === 0, 'the floor at Z-5 is cleared: every tool-centre point of the pocket within R of the path (' + miss + ' missed)');
  const ccw = at5.slice(0, 4).map(m => [m.to.x - m.from.x, m.to.y - m.from.y]).every(([dx, dy], i, a) => { const n = a[(i + 1) % 4]; return dx * n[1] - dy * n[0] > 0 || i === 3; });
  ok(ccw, 'channel of a pocket counterclockwise (MP 7420 bit 0 = 0)');
  /* which pass works at which depth, in order: C = channel (on the R5 offset), R = rough-out loops inside it */
  const pl = r2 => r2.moves.filter(m => m.cycle && m.kind === 'feed' && near(m.from.z, m.to.z) && m.to.z < 0).map(m => (near(Math.min(m.to.x - 25, 75 - m.to.x, m.to.y - 25, 55 - m.to.y), 0, 0.01) ? 'C' : 'R') + m.to.z)
    .filter((x, i, a) => x !== a[i - 1]).join(' ');
  ok(pl(r) === 'C-5 C-10 R-5 R-10', 'MP 7420 = 0: the channel at every depth, then the rough-out at every depth: ' + pl(r));
  r = pk(null, null, { machine: { mp7420: 8 } });
  ok(pl(r) === 'C-5 R-5 C-10 R-10', 'MP 7420 = 8 (the operator\'s 430): channel and rough-out at each depth in turn: ' + pl(r));
  r = pk(null, null, { machine: { mp7420: 16 } });
  const lc = r.moves.filter(m => m.cycle).pop();
  ok(near(lc.to.z, 20) && !near(lc.to.x, 0), 'MP 7420 + 16: the cycle ends at the clearance height Q7 above its last point');
  r = pk();
  const last = r.moves[r.moves.length - 1];
  ok(near(last.to.x, -10) && near(last.to.y, 1), 'cycle 20 writes Q1-Q9 (p. 290: "cannot be used as program parameters"): L X+Q1 Y+Q9 goes to X-10 Y+1');
  ok(!pk(0).moves.some(m => m.cycle), 'Q1 = 0: the cycle is not executed (p. 290)');
  r = TNC.run('BEGIN PGM R MM\nTOOL CALL 4 Z S2000\nCYCL DEF 22.0 ROUGH-OUT\n Q10=5\n Q11=100\n Q12=350\n Q18=0\n Q19=150\nCYCL CALL M3\nEND PGM R MM');
  ok(r.errors.some(e => e.msg === 'CYCL DEF INCOMPLETE'), '22 without 14 / 20: CYCL DEF INCOMPLETE');
  r = pk(null, 'CYCL DEF 200 DRILLING\n Q200=2\n Q201=-5\n Q206=150\n Q202=5\n Q210=0\n Q203=+0\n Q204=20\n Q211=0\nCYCL DEF 20.0 CONTOUR DATA\n Q1=-3');
  ok(r.moves.some(m => m.cycle === 'DRILLING 200'), 'cycles 14 and 20 are DEF active: CYCL CALL still calls the last machining cycle');
  r = pk(null, 'CYCL DEF 24.0 SIDE FINISHING\n Q9=-1\n Q10=5\n Q11=100\n Q12=350\n Q14=+0');
  const f24 = r.moves.filter(m => m.cycle === 'SIDE FINISHING 24' && m.kind === 'feed' && near(m.from.z, -5) && near(m.to.z, -5) && Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 20);
  ok(!r.errors.length && f24.length === 4 && f24.every(m => [m.from, m.to].every(p => near(Math.min(p.x - 20, 80 - p.x, p.y - 20, 60 - p.y), 5, 0.004))), '24 without 22: the walls at R from the contour');
  ok(f24.reduce((a, m) => a + m.from.x * m.to.y - m.to.x * m.from.y, 0) < 0, '24 Q9 = -1: clockwise');
}
{ /* the manual's example C25 (p. 306-307): contour train, open contour, RL, R10 */
  const C25 = (q15, q3, pre) => 'BEGIN PGM C25 MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+10\nTOOL CALL 1 Z S2000\nL Z+250 R0 F MAX\n' + (pre || '') +
    'CYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL 1\nCYCL DEF 25.0 CONTOUR TRAIN\n Q1=-20 ;MILLING DEPTH\n Q3=+' + (q3 || 0) + ' ;ALLOWANCE FOR SIDE\n Q5=+0 ;WORKPIECE SURFACE COORD.\n Q7=+250 ;CLEARANCE HEIGHT\n' +
    ' Q10=5 ;PLUNGING DEPTH\n Q11=100 ;FEED RATE FOR PLUNGING\n Q12=200 ;FEED RATE FOR MILLING\n Q15=' + q15 + ' ;CLIMB OR UP-CUT\nCYCL CALL M3\nL IX+10 R0 FMAX\nL Z+250 R0 F MAX M2\n' +
    'LBL 1\nL X+0 Y+15 RL\nL X+5 Y+20\nCT X+5 Y+75\nL Y+95\nRND R7.5\nL X+50\nRND R7.5\nL X+100 Y+80\nLBL 0\nEND PGM C25 MM';
  const s2 = Math.SQRT1_2 * 10, en = [100 + 10 * 15 / Math.hypot(50, 15), 80 + 10 * 50 / Math.hypot(50, 15)];
  let r = TNC.run(C25('+1'));
  const c = r.moves.filter(m => m.cycle === 'CONTOUR TRAIN 25'), cut = c.filter(m => m.kind !== 'rapid' && near(m.from.z, m.to.z) && m.to.z < 0);
  const starts = c.filter(m => m.kind === 'feed' && m.to.z < m.from.z);
  ok(!r.errors.length && starts.length === 4 && starts.every(m => near(m.to.x, -s2) && near(m.to.y, 15 + s2)) && starts.map(m => m.to.z).join() === '-5,-10,-15,-20',
    'Q15 +1 with RL = climb (M3): every pass plunges at the compensated start (-7.071, 22.071), depths -5 -10 -15 -20');
  ok(cut.every(m => m.feed === 200) && starts.every(m => m.feed === 100), 'feeds Q12 200 on the contour, Q11 100 plunging');
  const ends = c.filter(m => m.kind === 'rapid' && near(m.to.z, 250) && m.from.z < 0);
  ok(ends.length === 4 && ends.every(m => near(m.to.x, en[0]) && near(m.to.y, en[1])), 'each pass ends on the compensated end point and retracts to Q7 250');
  const nx = r.moves.find(m => !m.cycle && near(m.to.x - m.from.x, 10));
  ok(nx && near(nx.from.x, en[0]) && near(nx.to.x, en[0] + 10), 'p. 295: L IX+10 after the cycle starts from the tool\'s real end position: X ' + (nx && nx.to.x.toFixed(3)));
  r = TNC.run(C25('-1'));
  const st2 = r.moves.filter(m => m.cycle && m.kind === 'feed' && m.to.z < m.from.z);
  ok(!r.errors.length && st2.length === 4 && st2.every(m => near(m.to.x, en[0]) && near(m.to.y, en[1])), 'Q15 -1 (up-cut): the contour is run backwards, the tool stays on the same side');
  r = TNC.run(C25('+0'));
  const ups = r.moves.filter(m => m.cycle && m.kind === 'rapid' && near(m.to.z, 250) && m.from.z < 0), st0 = r.moves.filter(m => m.cycle && m.kind === 'feed' && m.to.z < m.from.z && m.to.z < 0);
  ok(!r.errors.length && ups.length === 1 && st0.length === 4 && near(st0[1].to.x, en[0]) && near(st0[2].to.x, -s2), 'Q15 0: back and forth without retracting between the infeeds');
  r = TNC.run(C25('+1', 0.5));
  const s3 = r.moves.filter(m => m.cycle && m.kind === 'feed' && m.to.z < m.from.z)[0];
  ok(near(s3.to.x, -Math.SQRT1_2 * 10.5) && near(s3.to.y, 15 + Math.SQRT1_2 * 10.5), 'Q3 0.5: the path runs at R + Q3 = 10.5');
  r = TNC.run(C25('+1', 0, 'CYCL DEF 8.0 MIRROR IMAGE\nCYCL DEF 8.1 X\n'));
  const sm = r.moves.filter(m => m.cycle && m.kind === 'feed' && m.to.z < m.from.z);
  ok(!r.errors.length && sm.length === 4 && sm.every(m => near(m.to.x, -en[0]) && near(m.to.y, en[1])), 'mirrored in X: climb milling kept (p. 295) -> the mirrored contour is run from its other end');
}
{ const hdr = 'BEGIN PGM D MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S2000\nL Z+100 R0 FMAX\n', sub = '\nL Z+100 R0 FMAX M2\nLBL 1\nL X+10 Y+10 RR\nL Y+90\nL X+90\nL Y+10\nL X+10\nLBL 0\nEND PGM D MM';
  const b = n => { const s = TNC_DIALOGS.cycleSpec(n), v = {}; s.steps.forEach(t => v[t.k] = t.dflt); return s.build(v); };
  ok(b(14) === 'CYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL 1' && /^CYCL DEF 20\.0 CONTOUR DATA\n  Q1=-20 /.test(b(20)), 'dialog: 14 and 20 in the manual\'s block form');
  ok([21, 22, 23, 24, 25].every(n => { const r = TNC.run(hdr + b(14) + '\n' + b(20) + '\n' + b(n) + '\nCYCL CALL M3' + sub); return !r.errors.length && r.moves.some(m => m.cycle && m.cycle.endsWith(' ' + n)); }),
    'dialog: 21-25 with the example values run clean after 14 + 20');
  ok(TNC.parse('CYCL DEF 20.0 CONTOUR DATA\n Q1=-20 ;MILLING DEPTH\n Q2=1\nL X+0\nQ1 = 5').blocks.map(x => x.kind).join() === 'CYCLDEF,CYCLPARM,CYCLPARM,L,FORMULA', 'parse: Q1-Q19 lines after CYCL DEF 20-25 belong to the cycle; a Q1 = assignment elsewhere stays a formula');
}
{ /* SL subprogram rules (p. 285), found by the adversarial run 2026-10-17 */
  const hd = 'BEGIN PGM X MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+5\nTOOL CALL 1 Z S2000\nL X+0 Y+0 Z+50 R0 FMAX\n';
  const sl = (labels, after, subs) => hd + 'CYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL ' + labels + '\nCYCL DEF 20.0 CONTOUR DATA\n Q1=-10\n Q2=1\n Q3=+0\n Q4=+0\n Q5=+0\n Q6=2\n Q7=+20\n Q8=0\n Q9=+1\n' +
    'CYCL DEF 22.0 ROUGH-OUT\n Q10=5\n Q11=100\n Q12=350\n Q18=0\n Q19=150\nCYCL CALL M3\n' + after + 'L Z+60 R0 FMAX M2\n' + subs + 'END PGM X MM';
  const box = r => { const c = r.moves.filter(m => m.cycle && m.kind !== 'rapid' && m.to.z < 0).flatMap(m => [m.from, m.to]); return [Math.min(...c.map(p => p.x)), Math.max(...c.map(p => p.x))].map(v => v.toFixed(3)).join('..'); };
  for (const m of ['M99', 'M2', 'M30']) {
    let r; try { r = TNC.run(sl('1', '', 'LBL 1\nL X+20 Y+20 RR\nL Y+60 ' + m + '\nL X+80\nL Y+20\nL X+20\nLBL 0\n')); } catch (e) { r = { errors: [{ msg: e.message }], moves: [] }; }
    ok(!r.errors.length && box(r) === '25.003..74.997', m + ' in a contour subprogram is ignored (p. 285 "ignores ... M"): ' + (r.errors[0] ? r.errors[0].msg : box(r)));
  }
  /* p. 285: transformations inside a subcontour act on the following subprograms, need not be reset after the call */
  const pocket = 'LBL 1\nL X+20 Y+20 RR\nL Y+60\nL X+80\nL Y+20\nL X+20\nLBL 0\n';
  const shift2 = 'LBL 2\nCYCL DEF 7.0 DATUM SHIFT\nCYCL DEF 7.1 X+10\nCYCL DEF 7.2 Y+0\nL X+40 Y+30 RL\nL Y+40\nL X+50\nL Y+30\nL X+40\nLBL 0\n';
  let r = TNC.run(sl('1 /2', 'L X+5 Y+5 R0 FMAX\n', pocket + shift2));
  const at = r.moves.filter(m => m.cycle && m.kind === 'feed' && near(m.from.z, -5) && near(m.to.z, -5));
  const dseg = (m, x, y) => { const dx = m.to.x - m.from.x, dy = m.to.y - m.from.y, l2 = dx * dx + dy * dy; let u = l2 ? ((x - m.from.x) * dx + (y - m.from.y) * dy) / l2 : 0; u = Math.max(0, Math.min(1, u)); return Math.hypot(m.from.x + dx * u - x, m.from.y + dy * u - y); };
  const drect = p => Math.hypot(Math.max(50 - p.x, 0, p.x - 60), Math.max(30 - p.y, 0, p.y - 40));
  const isl = at.some(m => [m.from, m.to].some(p => drect(p) < 5 - 0.01)), hole = at.some(m => dseg(m, 40, 35) < 1);
  ok(!r.errors.length && box(r) === '25.003..74.997' && !isl && hole, 'a datum shift in LBL 2 moves only the island (50..60), not the pocket LBL 1 before it');
  const after = r.moves.find(m => !m.cycle && near(m.to.z, 50) && near(m.to.y, 5));
  ok(after && near(after.to.x, 5), 'after the cycle the shift from the subcontour is gone: L X+5 Y+5 goes to X ' + (after && after.to.x));
  r = TNC.run(sl('1', 'L X+50 Y+0 R0 FMAX\n', 'LBL 1\nCYCL DEF 10.0 ROTATION\nCYCL DEF 10.1 ROT+90\nL X+20 Y+20 RR\nL Y+60\nL X+80\nL Y+20\nL X+20\nLBL 0\n'));
  const rot = r.moves.find(m => !m.cycle && near(m.to.z, 50) && near(m.to.x, 50));
  ok(!r.errors.length && rot && near(rot.to.y, 0) && box(r) === '-54.997..-25.003', 'ROT+90 in the subcontour turns the pocket (x -55..-25) and is gone after the call');
  r = TNC.run(sl('1', '', 'LBL 1\nCYCL DEF 8.0 MIRROR IMAGE\nCYCL DEF 8.1 X\nL X+20 Y+20 RR\nL Y+60\nL X+80\nL Y+20\nL X+20\nLBL 0\n'));
  ok(!r.errors.length && box(r) === '-74.997..-25.003', 'MIRROR X in the subcontour: still a pocket, mirrored to x -75..-25: ' + (r.errors[0] ? r.errors[0].msg : box(r)));
  /* p. 211: cycle 1 re-approaches to the last depth minus t = 0.6 mm (depth <= 30), depth / 50 beyond (max 7); cycle 21 the same (p. 291) */
  for (const [dep, t] of [[20, 0.6], [60, 1.2]]) {
    r = TNC.run(hd + 'CYCL DEF 1.0 PECKING\nCYCL DEF 1.1 SET UP 2\nCYCL DEF 1.2 DEPTH -' + dep + '\nCYCL DEF 1.3 PECKG 5\nCYCL DEF 1.4 DWELL 0\nCYCL DEF 1.5 F100\nL X+50 Y+50 Z+2 R0 FMAX\nCYCL CALL M3\nL Z+60 R0 FMAX M2\nEND PGM X MM');
    const back = r.moves.filter(m => m.cycle && m.kind === 'rapid' && m.to.z < m.from.z).map(m => +m.to.z.toFixed(3));
    ok(!r.errors.length && back.length && back.every((z, i) => near(z, -5 * (i + 1) + t)), `cycle 1, depth ${dep}: advanced stop distance ${t} mm: ${back.slice(0, 3).join(' ')}`);
  }
  r = TNC.run(sl('1', '', pocket).replace(/CYCL DEF 22\.0 ROUGH-OUT[^]*?Q19=150\n/, 'CYCL DEF 21.0 PILOT DRILLING\n Q10=4\n Q11=100\n Q13=1\n'));
  const b21 = r.moves.filter(m => m.cycle && m.kind === 'rapid' && m.to.z < m.from.z && m.to.z < 0).map(m => +m.to.z.toFixed(3));
  ok(!r.errors.length && b21.length && b21.every(z => [-3.4, -7.4].includes(z)), 'cycle 21 (Q1 -10, Q10 4) pecks like cycle 1 with t = 0.6: ' + [...new Set(b21)].join(' '));
  /* 6.6 FK free contour programming is not simulated: every FK block says so (manual example FK2, p. 170) */
  r = TNC.run(hd + 'L X+30 Y+30 R0 FMAX\nFPOL X+30 Y+30\nFC DR- R30 CCX+30 CCY+30\nFL AN+60 PDX+30 PDY+30 D10\nFSELECT 3\nFLT\nFCT DR- R15\nEND PGM X MM');
  ok(r.errors.filter(e => e.msg === 'FK NOT SIMULATED').length === 6 && !r.errors.some(e => e.msg === 'BLOCK FORMAT INCORRECT'), 'FK blocks report FK NOT SIMULATED: ' + r.errors.map(e => e.msg).join(','));
  /* p. 205: infeed in the TOOL CALL axis; only Z is simulated, X / Y say so and stop instead of milling as Z */
  r = TNC.run(hd.replace('TOOL CALL 1 Z', 'TOOL CALL 1 Y') + 'L X+10 Y+10 R0 FMAX\nEND PGM X MM');
  ok(r.errors.some(e => e.msg === 'TOOL AXIS Y NOT SIMULATED') && !r.moves.some(m => near(m.to.x, 10)), 'TOOL CALL 1 Y: TOOL AXIS Y NOT SIMULATED, the run stops: ' + r.errors.map(e => e.msg));
  /* p. 295: cycle 25 prevents undercuts; where the tool is too big the corner is left for rework (no error, no gouge) */
  const c25 = (contour) => hd.replace('R+5', 'R+10') + 'CYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL 1\nCYCL DEF 25.0 CONTOUR TRAIN\n Q1=-5\n Q3=+0\n Q5=+0\n Q7=+50\n Q10=5\n Q11=100\n Q12=200\n Q15=+1\nCYCL CALL M3\nL Z+60 R0 FMAX M2\nLBL 1\n' + contour + 'LBL 0\nEND PGM X MM';
  for (const [name, contour, segs, span] of [
    ['a 5 mm notch', 'L X+10 Y+50 RL\nL X+40\nL Y+40\nL X+45\nL Y+50\nL X+90\n', [[10, 50, 40, 50], [40, 50, 40, 40], [40, 40, 45, 40], [45, 40, 45, 50], [45, 50, 90, 50]], [10, 90]],
    ['an R2 inside corner', 'L X+10 Y+10 RL\nL X+50\nRND R2\nL Y+80\n', [[10, 10, 48, 10], [50, 12, 50, 80]], [10, 80]]]) {
    r = TNC.run(c25(contour));
    const mv = r.moves.filter(m => m.cycle && m.kind !== 'rapid' && near(m.from.z, -5) && near(m.to.z, -5));
    const ds = p => Math.min(...segs.map(([x0, y0, x1, y1]) => dseg({ from: { x: x0, y: y0 }, to: { x: x1, y: y1 } }, p.x, p.y)));
    const minD = Math.min(...mv.flatMap(m => [m.from, m.to]).map(ds));
    const xs = mv.flatMap(m => [m.from.x, m.from.y, m.to.x, m.to.y]);
    ok(!r.errors.length && mv.length && minD >= 10 - 0.01 && Math.max(...xs) >= span[1] - 1e-6,
      `cycle 25, R10 tool, ${name}: no error, the path stays >= R from the contour (min ${isFinite(minD) ? minD.toFixed(3) : '-'}) ${r.errors.map(e => e.msg)}`);
  }
  /* p. 285 "the cutter traverses around islands": a strip just wider than the tool between an island and the wall is cut */
  for (const [size, w] of [[100, 10.2], [300, 11]]) {
    const top = size === 100 ? 60 : 300, x1 = size === 100 ? 80 : 300, x0 = size === 100 ? 20 : 0; const xi = (x0 < 10 ? "" : "+") + (x0 - 10);
    const t = hd.replace('X+100 Y+100', 'X+' + size + ' Y+' + size) + 'CYCL DEF 14.0 CONTOUR GEOMETRY\nCYCL DEF 14.1 CONTOUR LABEL 1 /2\nCYCL DEF 20.0 CONTOUR DATA\n Q1=-5\n Q2=1\n Q3=+0\n Q4=+0\n Q5=+0\n Q6=2\n Q7=+20\n Q8=0\n Q9=+1\n' +
      'CYCL DEF 22.0 ROUGH-OUT\n Q10=5\n Q11=100\n Q12=350\n Q18=0\n Q19=150\nCYCL CALL M3\nL Z+60 R0 FMAX M2\n' +
      `LBL 1\nL X+${x0} Y+${x0} RR\nL Y+${top}\nL X+${x1}\nL Y+${x0}\nL X+${x0}\nLBL 0\nLBL 2\nL X${xi} Y+${x0 + w} RL\nL Y+${top - w}\nL X+${(x0 + x1) / 2}\nL Y+${x0 + w}\nL X${xi}\nLBL 0\nEND PGM X MM`;
    const t0 = Date.now(); r = TNC.run(t); const ms = Date.now() - t0;
    const cut = r.moves.filter(m => m.cycle && m.kind !== 'rapid' && m.to.z < 0), y = x0 + w / 2, x = (x0 + (x0 + x1) / 2) / 2;
    const d = Math.min(...cut.map(m => dseg(m, x, y)));
    ok(!r.errors.length && d <= (w - 10) / 2 + 0.01 && ms < 5000, `a ${w} mm strip (R5 tool) next to an island in a ${size} mm pocket is cut: nearest path ${d.toFixed(3)} mm from its centre line, ${ms} ms ${r.errors.map(e => e.msg)}`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nALL MANUAL EXAMPLES PASS');
process.exit(fails ? 1 : 0);
