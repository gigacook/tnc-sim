/* #23: every block shape the operator's CAM post (Hermle C800U, TNC 430, default properties: usePlane false
   -> cycle 19, useFunctionTCPM false -> M128/M129) can write runs without errors. Our own synthetic blocks,
   one small program per shape.   Run:  node tests/post.js                                                */
const { TNC } = require('../sim/engine.js');
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  FAIL ' + msg); } };
const pgm = (body) => `BEGIN PGM POST MM
BLK FORM 0.1 Z X+0 Y+0 Z-40
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+3
TOOL CALL 1 Z S2000
L Z+50 R0 FMAX M3
L X+50 Y+50 R0 FMAX
${body}
L Z+50 R0 FMAX
END PGM POST MM`;
const cyc = (head, q) => head + '\n' + q.split(' ').map(s => '  ' + s).join('\n');
const call = (head, q) => cyc(head, q) + '\nL Z+2 R0 FMAX\nCYCL CALL';
const probe = (n, q) => cyc('TCH PROBE ' + n, q);
const P = 'Q261=-5 Q320=2 Q260=+20 Q301=1 Q305=0 Q303=1';
const S = {
  'tool def/call + M': 'TOOL DEF 2\nTOOL CALL 1 Z S3000\nM8\nM9\nM126\nM127',
  'L lines, R0/RL/RR, FMAX, M99': 'L X+10 Y+10 Z+2 R0 FMAX\nL Z-2 F200\nL X+20 RL F300\nL Y+20\nL X+10 R0\nCYCL DEF 200 DRILLING\n Q200=2\n Q201=-5\n Q206=150\n Q202=5\n Q210=0\n Q203=+0\n Q204=50\n Q211=0\nL Z+2 FMAX M99',
  'CC + C arc (XY, XZ, YZ planes)': 'L X+60 Y+50 Z+2 R0 FMAX\nCC X+50 Y+50\nC X+40 Y+50 DR+ F300\nCC X+50 Z+2\nC X+50 Z+12 DR- F300\nCC Y+50 Z+2\nC Y+60 Z+2 DR+ F300',
  'CP helix': 'L X+60 Y+50 Z+2 R0 FMAX\nCC X+50 Y+50\nCP IPA+720 IZ-4 DR+ F300',
  'M140 MB MAX': 'L M140 MB MAX',
  'cycle 7 datum shift + #': 'CYCL DEF 7.0 DATUM SHIFT\nCYCL DEF 7.1 X+0\nCYCL DEF 7.2 Y+0\nCYCL DEF 7.3 Z+0\nCYCL DEF 7.0 DATUM SHIFT\nCYCL DEF 7.1 #0',
  'cycle 9 dwell': 'CYCL DEF 9.0 DWELL TIME\nCYCL DEF 9.1 DWELL 1.5',
  'cycle 19 working plane + reset': 'CYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1 A+0 B+0 C+30\nL Z+50 R0 FMAX\nCYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1 A+0 B+0 C+0\nCYCL DEF 19.0 WORKING PLANE\nCYCL DEF 19.1',
  'cycle 32 tolerance + cancel': 'CYCL DEF 32.0 TOLERANCE\nCYCL DEF 32.1 T0.013\nCYCL DEF 32.2 HSC-MODE:0 TA0.5\nCYCL DEF 32.0 TOLERANCE\nCYCL DEF 32.1',
  'M128/M129': 'M128\nL X+40 Y+40 R0 FMAX\nM129',
  'FN 0 / FN 17': 'FN 0: Q216 = +50\nFN 0: Q217 = +50\nFN 17: SYSWRITE ID210 NR6 = 0',
  'LBL sub + CALL LBL': 'CALL LBL 1\nL Z+50 R0 FMAX\nM30\nLBL 1\nL X+20 Y+20 R0 FMAX\nLBL 0',
  'cycle 247 preset': cyc('CYCL DEF 247 DATUM SETTING', 'Q339=+1'),
  'cycle 200': call('CYCL DEF 200 DRILLING', 'Q200=2 Q201=-10 Q206=150 Q202=5 Q210=0 Q203=+0 Q204=50 Q211=0'),
  'cycle 201': call('CYCL DEF 201 REAMING', 'Q200=2 Q201=-10 Q206=150 Q211=0 Q208=500 Q203=+0 Q204=50'),
  'cycle 202': call('CYCL DEF 202 BORING', 'Q200=2 Q201=-10 Q206=150 Q211=0 Q208=500 Q203=+0 Q204=50 Q214=1 Q336=0'),
  'cycle 203': call('CYCL DEF 203 UNIVERSAL DRILLING', 'Q200=2 Q201=-10 Q206=150 Q202=5 Q210=0 Q203=+0 Q204=50 Q212=0.2 Q213=3 Q205=2 Q211=0 Q208=500 Q256=0.2'),
  'cycle 204': call('CYCL DEF 204 BACK BORING', 'Q200=2 Q249=+5 Q250=20 Q251=3.5 Q252=15 Q253=750 Q254=200 Q255=0 Q203=+0 Q204=50 Q214=1 Q336=0'),
  'cycle 205': call('CYCL DEF 205 UNIVERSAL PECKING', 'Q200=2 Q201=-20 Q206=150 Q202=5 Q203=+0 Q204=50 Q212=0.2 Q205=2 Q258=0.5 Q259=1 Q257=0 Q256=0.2 Q211=0 Q379=0 Q253=750'),
  'cycle 207': call('CYCL DEF 207 RIGID TAPPING NEW', 'Q200=2 Q201=-15 Q239=+1.5 Q203=+0 Q204=50'),
  'cycle 208': call('CYCL DEF 208 BORE MILLING', 'Q200=2 Q201=-10 Q206=150 Q334=2 Q203=+0 Q204=50 Q335=20 Q342=0'),
  'cycle 209': call('CYCL DEF 209 TAPPING W/ CHIP BRKG', 'Q200=2 Q201=-15 Q239=+1.5 Q203=+0 Q204=50 Q257=5 Q256=0.5 Q336=0'),
  'cycle 241': call('CYCL DEF 241 SINGLE-LIP D.H.DRLNG', 'Q200=2 Q201=-20 Q206=150 Q211=0 Q203=+0 Q204=50 Q379=0 Q253=750 Q208=1000 Q426=3 Q427=2000 Q428=2000 Q429=0 Q430=0 Q435=0'),
  'cycle 252': call('CYCL DEF 252 CIRCULAR POCKET', 'Q215=0 Q223=30 Q368=0 Q207=500 Q351=+1 Q201=-10 Q202=5 Q369=0 Q206=150 Q338=0 Q200=2 Q203=+0 Q204=50 Q370=1 Q366=1 Q385=500'),
  'cycle 262': call('CYCL DEF 262 THREAD MILLING', 'Q335=10 Q239=+1.5 Q201=-10 Q355=0 Q253=750 Q351=+1 Q200=2 Q203=+0 Q204=50 Q207=500'),
  'probe 400': probe('400 BASIC ROTATION', 'Q263=+10 Q264=+10 Q265=+80 Q266=+10 Q272=2 Q267=+1 ' + P + ' Q307=0'),
  'probe 403': probe('403 ROT IN ROTARY AXIS', 'Q263=+10 Q264=+10 Q265=+80 Q266=+10 Q272=2 Q267=+1 ' + P + ' Q312=6 Q337=0 Q380=0'),
  'probe 408': probe('408 SLOT CENTER REF PT', 'Q321=+50 Q322=+50 Q311=20 Q272=1 ' + P + ' Q405=0 Q381=0 Q382=0 Q383=0 Q384=0 Q333=0'),
  'probe 409': probe('409 RIDGE CENTER REF PT', 'Q321=+50 Q322=+50 Q311=20 Q272=1 ' + P + ' Q405=0 Q381=0 Q382=0 Q383=0 Q384=0 Q333=0'),
  'probe 410': probe('410 DATUM INSIDE RECTAN.', 'Q321=+50 Q322=+50 Q323=60 Q324=40 ' + P + ' Q331=0 Q332=0 Q381=0 Q382=0 Q383=0 Q384=0 Q333=0'),
  'probe 411': probe('411 DATUM OUTS. RECTAN.', 'Q321=+50 Q322=+50 Q323=60 Q324=40 ' + P + ' Q331=0 Q332=0 Q381=0 Q382=0 Q383=0 Q384=0 Q333=0'),
  'probe 412': probe('412 DATUM INSIDE CIRCLE', 'Q321=+50 Q322=+50 Q262=40 Q325=+0 Q247=+90 ' + P + ' Q331=0 Q332=0 Q381=0 Q382=0 Q383=0 Q384=0 Q333=0 Q423=4 Q365=1'),
  'probe 413': probe('413 DATUM OUTSIDE CIRCLE', 'Q321=+50 Q322=+50 Q262=40 Q325=+0 Q247=+90 ' + P + ' Q331=0 Q332=0 Q381=0 Q382=0 Q383=0 Q384=0 Q333=0 Q423=4 Q365=1'),
  'probe 415': probe('415 DATUM INSIDE CORNER', 'Q263=+10 Q264=+10 Q326=20 Q327=20'),
  'probe 417': probe('417 DATUM IN TS AXIS', 'Q263=+50 Q264=+50 Q294=+0 Q320=2 Q260=+20 Q305=0 Q333=0 Q303=1'),
  'probe 419': probe('419 DATUM IN ONE AXIS', 'Q263=+10 Q264=+50 Q261=-5 Q320=2 Q260=+20 Q272=1 Q267=+1 Q305=0 Q333=0 Q303=1'),
};
// shapes the post emits that the engine does not simulate yet (CONTINUE.md #25); reported, not failed
const OPEN = new Set([]);
// the post can write these, but they are not TNC 426/430 cycles (not in its manual): the control rejects them, so must we
const NOT_430 = new Set(['cycle 241', 'cycle 252']);
const bad = [];
for (const [name, body] of Object.entries(S)) {
  const r = TNC.run(pgm(body));
  const errs = r.errors.map(e => `block ${e.block}: ${e.msg}`);
  if (NOT_430.has(name)) { ok(errs.length === 1 && /NOT ON TNC 426\/430/.test(errs[0]), name + ' is refused as NOT ON TNC 426/430: ' + errs.join('; ')); continue; }
  if (OPEN.has(name)) { console.log('  OPEN ' + name + (errs.length ? ': ' + errs.join('; ') : ' now runs: drop it from OPEN')); continue; }
  ok(!errs.length, name + ': ' + errs.join('; '));
  if (errs.length) bad.push(name);
}
console.log(fails ? `post: ${fails} FAILED (${bad.join(", ")})` : `post: ${Object.keys(S).length - OPEN.size - NOT_430.size} of ${Object.keys(S).length} post block shapes run without errors, ${NOT_430.size} correctly refused (not 426/430 cycles), ${OPEN.size} open (listed above)`);
process.exit(fails ? 1 : 0);
