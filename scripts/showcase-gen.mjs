#!/usr/bin/env node
// showcase-gen.mjs - writes the sixteen showcase programs and their manifest, deterministically (no AI, no network).
//   node scripts/showcase-gen.mjs            writes examples/showcase/*.H and examples/showcase/manifest.json
//   node scripts/showcase-gen.mjs --check    exit 1 when the files on disk differ from what this script generates
// The same input always gives the same bytes. The manifest's "validation" block of a program is kept as long as
// the program text is unchanged (same sha256); scripts/showcase-verify.mjs fills it.
// Every program uses only the built-in tool table of sim/engine.js (TNC.TOOLS), so it also runs from the
// simulator's program manager without a tool upload.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples', 'showcase');
const require = createRequire(import.meta.url);
const BUILTIN = require(join(ROOT, 'sim', 'engine.js')).TOOLS;

/* ---------- small helpers ---------- */
const n3 = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? 0 : r; };
const s = (v) => { const r = n3(v); return (r < 0 ? '-' : '+') + Math.abs(r); };          // signed Klartext number
const tool = (t) => { const e = BUILTIN.find((x) => x.t === t); if (!e) throw new Error('no built-in tool ' + t); return { t: e.t, name: e.name, l: e.l, r: e.r }; };
const head = (name, st, lines) => [`BEGIN PGM ${name} MM`, `BLK FORM 0.1 Z X${s(st.x[0])} Y${s(st.y[0])} Z${s(st.z[0])}`,
  `BLK FORM 0.2 X${s(st.x[1])} Y${s(st.y[1])} Z${s(st.z[1])}`, ...lines.map((l) => '; ' + l)];
const tail = (name) => ['L Z+100 R0 FMAX M5 M9', 'L Z+150 R0 FMAX M2', `END PGM ${name} MM`];
const cyc = (headLine, q) => [headLine, ...Object.entries(q).map(([k, v]) => `  ${k}=${v}`)];
const drill200 = (depth, peck, feed, surf = 0) => cyc('CYCL DEF 200 DRILLING', { Q200: 2, Q201: depth, Q206: feed, Q202: peck, Q210: 0, Q203: s(surf), Q204: 30, Q211: 0 });
const pocket4 = (depth, peck, fpl, x, y, f) => ['CYCL DEF 4.0 POCKET MILLING', 'CYCL DEF 4.1 SET UP 2', `CYCL DEF 4.2 DEPTH ${depth}`,
  `CYCL DEF 4.3 PLNGNG ${peck} F${fpl}`, `CYCL DEF 4.4 X${s(x)}`, `CYCL DEF 4.5 Y${s(y)}`, `CYCL DEF 4.6 F${f} DR+ RADIUS 0`];

/* single-stroke glyphs on a 4 x 6 grid (the generator's own, straight strokes only) */
const GLYPH = {
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  A: [[[0, 0], [2, 6], [4, 0]], [[1, 3], [3, 3]]],
  R: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  5: [[[4, 6], [0, 6], [0, 3.4], [3, 3.4], [4, 2.5], [4, 1], [3, 0], [0, 0]]],
  1: [[[1, 4.8], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
};
/* text as strokes: lower-left x0,y0; cell w x h; gap between cells */
function strokes(text, x0, y0, w, h, gap) {
  const out = [];
  [...text].forEach((ch, i) => { const g = GLYPH[ch]; if (!g) throw new Error('no glyph ' + ch);
    for (const pl of g) out.push({ ch, pts: pl.map(([u, v]) => [x0 + i * (w + gap) + u * w / 4, y0 + v * h / 6]) }); });
  return out;
}
/* strokes as blocks: rapid above the start, plunge to zWord (a number or a Q word), cut, lift */
function engrave(list, zWord, fPlunge, fCut) {
  const out = []; let last = '';
  for (const st of list) {
    if (st.ch !== last) { out.push(`; ---------- ${st.ch} ----------`); last = st.ch; }
    out.push(`L X${s(st.pts[0][0])} Y${s(st.pts[0][1])} R0 FMAX`, `L Z${zWord} R0 F${fPlunge}`);
    st.pts.slice(1).forEach((p, k) => { out.push(`L X${s(p[0])} Y${s(p[1])} R0${k === 0 ? ' F' + fCut : ''}`); });
    out.push('L Z+2 R0 FMAX');
  }
  return out;
}
const BOTH = ['426', '430'];

/* ====================================================================================================
   The programs. Each entry: name, title, description, machines, stock, tools, cycles, techniques,
   substitutions, placeholders (CONTINUE.md ids the result depends on), expected, body().
   expected.cutMinZ          lowest tool-tip Z of a cutting move (mm)
   expected.cutEnvelope      tool-centre extents of all moves below the blank top (mm)
   expected.minRemovedCm3    the removed volume must be at least this (design value, rounded down)
   ==================================================================================================== */
const P = [];

/* ---------- 01 ---------- */
P.push({ name: '01_NAMEPLATE', stock: { x: [0, 180], y: [0, 60], z: [-10, 0] }, tools: [9, 4], machines: BOTH,
  title: { sv: 'Namnskylt', en: 'Nameplate' },
  description: { sv: 'Graverar KLARTEXT med raka streck i två skär och fräser en ram med rundade hörn.',
    en: 'Engraves KLARTEXT in single strokes in two passes and mills a frame with rounded corners.' },
  cycles: [], techniques: ['L', 'RND', 'LBL / CALL LBL REP', 'FN 0', 'FN 1', 'Q in a coordinate'],
  substitutions: ['Lettering: the control has no text cycle, so each letter is written as straight L strokes from the generator\'s own single-stroke glyphs.'],
  placeholders: [],
  expected: { cutMinZ: -1.5, cutEnvelope: { x: [6, 174], y: [6, 54] }, minRemovedCm3: 2,
    features: ['8 letters, 12 x 20 mm cells, 1.5 mm deep, 3 mm stroke', 'underline at Y+14', 'frame groove 6 mm wide, 1 mm deep, corner radius 5 on the centre line'] },
  body() {
    const txt = strokes('KLARTEXT', 24.5, 20, 12, 20, 5);
    return [
      'TOOL CALL 9 Z S2500', 'L Z+50 R0 FMAX M3',
      'FN 0: Q1 = -0.75             ; INFEED PER PASS', 'FN 0: Q2 = +0                ; CURRENT DEPTH',
      'L X+24.5 Y+40 R0 FMAX M8', 'L Z+2 R0 FMAX',
      'LBL 1', 'FN 1: Q2 = +Q2 + +Q1',
      ...engrave(txt, '+Q2', 120, 280),
      '; ---------- UNDERLINE ----------', 'L X+24.5 Y+14 R0 FMAX', 'L Z+Q2 R0 F120', 'L X+155.5 R0 F280', 'L Z+2 R0 FMAX',
      'CALL LBL 1 REP 1             ; 2 PASSES = 1.5 DEEP', 'L Z+50 R0 FMAX',
      '; ---------- FRAME, CENTRE LINE 6 MM INSIDE THE EDGE ----------',
      'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3', 'L X+90 Y+6 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-1 R0 F150',
      'L X+174 R0 F600', 'RND R5', 'L Y+54', 'RND R5', 'L X+6', 'RND R5', 'L Y+6', 'RND R5', 'L X+90',
      'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 02 ---------- */
P.push({ name: '02_STEPPED_POCKET', stock: { x: [0, 100], y: [0, 100], z: [-30, 0] }, tools: [5], machines: BOTH,
  title: { sv: 'Trappficka', en: 'Stepped pocket' },
  description: { sv: 'Tre rektangulära fickor i varandra med cykel 4, varje steg 6 mm djupare.',
    en: 'Three nested rectangular pockets with cycle 4, each step 6 mm deeper.' },
  cycles: [4], techniques: ['CYCL DEF 4 POCKET MILLING', 'CYCL CALL', 'pre-positioning in Z sets the cycle surface'],
  substitutions: [], placeholders: [],
  expected: { cutMinZ: -18, cutEnvelope: { x: [16, 84], y: [16, 84] }, minRemovedCm3: 60,
    features: ['pocket 80 x 80 to Z-6', 'pocket 56 x 56 to Z-12', 'pocket 32 x 32 to Z-18', 'corner radius 6 = the cutter'] },
  body() {
    return [
      'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3', 'L X+50 Y+50 R0 FMAX M8',
      '; ---------- STEP 1: 80 X 80, SURFACE Z+0 ----------', 'L Z+2 R0 FMAX', ...pocket4(-6, 3, 200, 80, 80, 800), 'CYCL CALL',
      '; ---------- STEP 2: 56 X 56, SURFACE Z-6 ----------', 'L Z-4 R0 FMAX', ...pocket4(-6, 3, 200, 56, 56, 800), 'CYCL CALL',
      '; ---------- STEP 3: 32 X 32, SURFACE Z-12 ----------', 'L Z-10 R0 FMAX', ...pocket4(-6, 3, 200, 32, 32, 800), 'CYCL CALL',
      'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 03 ---------- */
P.push({ name: '03_SPIRAL_POCKET', stock: { x: [0, 100], y: [0, 100], z: [-20, 0] }, tools: [5], machines: BOTH,
  title: { sv: 'Spiralficka', en: 'Spiral pocket' },
  description: { sv: 'Rund ficka Ø70 som fräses inifrån och ut i en spiral av inkrementala polära block, två djup.',
    en: 'Round pocket Ø70 milled from the centre outwards along a spiral of incremental polar blocks, two depths.' },
  cycles: [], techniques: ['CC', 'LP IPR IPA', 'CP IPA', 'LBL / CALL LBL REP (nested)', 'FN 0', 'FN 2'],
  substitutions: ['Spiral: the control has no spiral interpolation; the spiral is 232 short LP blocks (IPR+0.125, IPA+10 = 4.5 mm per turn) closed by one full circle.'],
  placeholders: [],
  expected: { cutMinZ: -8, cutEnvelope: { x: [21, 79], y: [21, 79] }, minRemovedCm3: 28,
    features: ['round pocket Ø70 at X+50 Y+50', 'floor Z-8 in two infeeds of 4 mm'] },
  body() {
    return [
      'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3', 'CC X+50 Y+50', 'FN 0: Q1 = +0                ; CURRENT DEPTH',
      'LBL 1', 'FN 2: Q1 = +Q1 - +4', 'L Z+2 R0 FMAX', 'LP PR+0 PA+0 R0 FMAX M8', 'L Z+Q1 R0 F200',
      'LBL 2', 'LP IPR+0.125 IPA+10 R0 F700', 'CALL LBL 2 REP 231           ; 232 STEPS = RADIUS 29',
      'CP IPA+360 DR+ F700          ; FULL CIRCLE CLEANS THE WALL', 'L Z+2 R0 FMAX',
      'CALL LBL 1 REP 1             ; 2 DEPTHS', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 04 ---------- */
P.push({ name: '04_BOLT_CIRCLE', stock: { x: [0, 120], y: [0, 120], z: [-20, 0] }, tools: [1, 2, 5], machines: BOTH,
  title: { sv: 'Hålcirkel', en: 'Bolt circle' },
  description: { sv: 'Åtta hål på en delningscirkel Ø84 (centrumborr, borr Ø8,5) och ett fräst centrumhål Ø32.',
    en: 'Eight holes on a Ø84 pitch circle (spot drill, Ø8.5 drill) and a milled Ø32 centre bore.' },
  cycles: [200, 208, 220], techniques: ['CYCL DEF 200 DRILLING', 'CYCL DEF 220 POLAR PATTERN', 'CYCL DEF 208 BORE MILLING', 'CYCL CALL'],
  substitutions: [], placeholders: [],
  expected: { cutMinZ: -16, cutEnvelope: { x: [18, 102], y: [18, 102] }, minRemovedCm3: 12,
    features: ['8 holes Ø8.5 x 16 deep on Ø84 at X+60 Y+60, first at 0 degrees', 'spot marks 2.5 deep', 'centre bore Ø32 x 10 deep'] },
  body() {
    const pat = cyc('CYCL DEF 220 POLAR PATTERN', { Q216: '+60', Q217: '+60', Q244: 84, Q245: '+0', Q246: '+360', Q247: '+0', Q241: 8, Q200: 2, Q203: '+0', Q204: 30, Q301: 1 });
    return [
      '; ---------- SPOT DRILL ----------', 'TOOL CALL 1 Z S2000', 'L Z+50 R0 FMAX M3', ...drill200(-2.5, 2.5, 150), ...pat, 'L Z+50 R0 FMAX',
      '; ---------- DRILL 8.5 ----------', 'TOOL CALL 2 Z S1800', 'L Z+50 R0 FMAX M3', 'M8', ...drill200(-16, 5, 180), ...pat, 'L Z+50 R0 FMAX',
      '; ---------- CENTRE BORE 32 ----------', 'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3', 'L X+60 Y+60 R0 FMAX',
      ...cyc('CYCL DEF 208 BORE MILLING', { Q200: 2, Q201: -10, Q206: 400, Q334: 2, Q203: '+0', Q204: 30, Q335: 32, Q342: 0 }), 'CYCL CALL',
      'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 05 ---------- */
P.push({ name: '05_POLAR_STAR', stock: { x: [0, 100], y: [0, 100], z: [-15, 0] }, tools: [4], machines: BOTH,
  title: { sv: 'Polär stjärna', en: 'Polar star' },
  description: { sv: 'Femuddig stjärna skriven helt med polära block (CC, LP PR/PA) inuti en ring, två skär.',
    en: 'Five-pointed star written entirely with polar blocks (CC, LP PR/PA) inside a ring, two passes.' },
  cycles: [], techniques: ['CC', 'LP PR PA', 'CP IPA', 'LBL / CALL LBL REP', 'FN 0', 'FN 2'],
  substitutions: [], placeholders: [],
  expected: { cutMinZ: -3, cutEnvelope: { x: [4, 96], y: [4, 96] }, minRemovedCm3: 5,
    features: ['star: tips PR 42 at PA 90 + n x 72, notches PR 17', 'ring PR 46', 'centre ring PR 6', 'groove 6 mm wide, 3 mm deep'] },
  body() {
    const star = []; for (let k = 1; k <= 10; k++) { const a = (90 + 36 * k) % 360; star.push(`LP PR+${k % 2 ? 17 : 42} PA${s(a)}`); }
    return [
      'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3', 'CC X+50 Y+50', 'FN 0: Q1 = +0                ; CURRENT DEPTH',
      'LBL 1', 'FN 2: Q1 = +Q1 - +1.5',
      '; ---------- STAR ----------', 'LP PR+42 PA+90 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z+Q1 R0 F150', star[0] + ' R0 F500', ...star.slice(1), 'L Z+2 R0 FMAX',
      '; ---------- RING ----------', 'LP PR+46 PA+0 R0 FMAX', 'L Z+Q1 R0 F150', 'CP IPA+360 DR+ F500', 'L Z+2 R0 FMAX',
      '; ---------- CENTRE RING ----------', 'LP PR+6 PA+0 R0 FMAX', 'L Z+Q1 R0 F150', 'CP IPA+360 DR+ F500', 'L Z+2 R0 FMAX',
      'CALL LBL 1 REP 1             ; 2 PASSES = 3 DEEP', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 06 ---------- */
P.push({ name: '06_ROUNDED_PLATE', stock: { x: [0, 120], y: [0, 80], z: [-20, 0] }, tools: [6, 5, 2], machines: BOTH,
  title: { sv: 'Rundad platta', en: 'Rounded plate' },
  description: { sv: 'Planfräst platta 108 x 68 med hörnradie 12, konturfräst med radiekompensering, och fyra hål.',
    en: 'Faced plate 108 x 68 with corner radius 12, contour-milled with radius compensation, and four holes.' },
  cycles: [200], techniques: ['RL', 'APPR LCT', 'DEP LCT', 'RND', 'LBL / CALL LBL REP', 'CYCL DEF 200 DRILLING', 'M99'],
  substitutions: [], placeholders: [],
  expected: { cutMinZ: -12.5, cutEnvelope: { x: [-30, 150], y: [0, 80] }, minRemovedCm3: 20,
    features: ['top faced 0.5 mm', 'outline 108 x 68, corner radius 12, wall to Z-8.5', '4 holes Ø8.5 to Z-12.5 at 20 mm from the plate corners'] },
  body() {
    return [
      '; ---------- FACE 0.5 ----------', 'TOOL CALL 6 Z S1200', 'L Z+50 R0 FMAX M3', 'L X-30 Y+20 R0 FMAX M8', 'L Z-0.5 R0 FMAX',
      'L X+150 R0 F900', 'L Y+60 R0 FMAX', 'L X-30 R0 F900', 'L Z+50 R0 FMAX',
      '; ---------- OUTLINE, CLIMB MILLING, 2 X 4 MM ----------', 'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3',
      'FN 0: Q1 = -0.5              ; CURRENT DEPTH (FACED SURFACE)',
      'LBL 1', 'FN 2: Q1 = +Q1 - +4', 'L X-14 Y+40 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z+Q1 R0 F250',
      'APPR LCT X+6 Y+40 R4 RL F600', 'L Y+74', 'RND R12', 'L X+114', 'RND R12', 'L Y+6', 'RND R12', 'L X+6', 'RND R12', 'L Y+40',
      'DEP LCT X-14 Y+40 R4 F600', 'L Z+2 R0 FMAX', 'CALL LBL 1 REP 1', 'L Z+50 R0 FMAX',
      '; ---------- 4 HOLES ----------', 'TOOL CALL 2 Z S1800', 'L Z+50 R0 FMAX M3', ...drill200(-12, 4, 180, -0.5),
      'L X+26 Y+26 R0 FMAX M99', 'L X+94 Y+26 R0 FMAX M99', 'L X+94 Y+54 R0 FMAX M99', 'L X+26 Y+54 R0 FMAX M99', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 07 ---------- */
P.push({ name: '07_HELIX_BORE', stock: { x: [0, 80], y: [0, 80], z: [-30, 0] }, tools: [5], machines: BOTH,
  title: { sv: 'Spiralborrning', en: 'Helix bore' },
  description: { sv: 'Hål Ø40 x 18 fräst med skruvlinje (CP med IZ) i två radier, och en försänkning Ø56 x 4.',
    en: 'Bore Ø40 x 18 milled with helical interpolation (CP with IZ) at two radii, plus a Ø56 x 4 counterbore.' },
  cycles: [], techniques: ['CC', 'LP PR PA', 'CP IPA IZ (helix)', 'CP IPA (full circle)'],
  substitutions: ['Bore: written as explicit CP helix blocks instead of cycle 208, to show the helix itself (04_BOLT_CIRCLE uses cycle 208).'],
  placeholders: [],
  expected: { cutMinZ: -18, cutEnvelope: { x: [18, 62], y: [18, 62] }, minRemovedCm3: 24,
    features: ['bore Ø40 to Z-18 at X+40 Y+40', 'counterbore Ø56 to Z-4', 'helix pitch 2 mm per turn'] },
  body() {
    const helix = (pr, turns, z) => [`LP PR+${pr} PA+0 R0 FMAX`, 'L Z+1 R0 FMAX', `CP IPA+${turns * 360} IZ${s(z - 1)} DR+ F500`, 'CP IPA+360 DR+              ; FLAT FLOOR'];
    return [
      'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3', 'L X+40 Y+40 R0 FMAX M8', 'CC X+40 Y+40', 'L Z+2 R0 FMAX',
      '; ---------- CENTRE HELIX, RADIUS 6 ----------', ...helix(6, 9.5, -18), 'L X+40 Y+40 R0 F500', 'L Z+2 R0 FMAX',
      '; ---------- WALL HELIX, RADIUS 14 = BORE 40 ----------', ...helix(14, 9.5, -18), 'L X+40 Y+40 R0 F500', 'L Z+2 R0 FMAX',
      '; ---------- COUNTERBORE, RADIUS 22 = 56 ----------', ...helix(22, 2.5, -4), 'L X+40 Y+40 R0 F500', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 08 ---------- */
P.push({ name: '08_CONTOUR_ISLAND', stock: { x: [0, 100], y: [0, 100], z: [-20, 0] }, tools: [5, 4], machines: BOTH,
  title: { sv: 'Kontur med öar', en: 'Contour with islands' },
  description: { sv: 'SL-cykler: ficka med rundade hörn och två öar (rund och romb), grovfräst, sedan botten och sida finfräst.',
    en: 'SL cycles: a pocket with rounded corners and two islands (round and diamond), roughed out, then floor and side finished.' },
  cycles: [14, 20, 22, 23, 24], techniques: ['CYCL DEF 14 CONTOUR GEOMETRY', 'CYCL DEF 20 CONTOUR DATA', 'CYCL DEF 22 ROUGH-OUT', 'CYCL DEF 23 FLOOR FINISHING', 'CYCL DEF 24 SIDE FINISHING', 'subcontours as LBL, RR pocket / RL island', 'RND', 'CC + C'],
  substitutions: [],
  placeholders: ['SL3', 'SL4', 'SL8', 'SL9', 'SL11', 'SL13', 'SL14'],
  expected: { cutMinZ: -8, cutEnvelope: { x: [11, 89], y: [18, 82] }, minRemovedCm3: 30,
    features: ['pocket X+8..92 Y+15..85, corner radius 10, floor Z-8', 'round island Ø18 at X+35 Y+50', 'diamond island 18 across at X+68 Y+50'] },
  body() {
    return [
      'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3',
      'CYCL DEF 14.0 CONTOUR GEOMETRY', 'CYCL DEF 14.1 CONTOUR LABEL 1 /2 /3',
      ...cyc('CYCL DEF 20.0 CONTOUR DATA', { Q1: '-8 ;MILLING DEPTH', Q2: '1 ;TOOL PATH OVERLAP', Q3: '+0.3 ;ALLOWANCE FOR SIDE', Q4: '+0.2 ;ALLOWANCE FOR FLOOR',
        Q5: '+0 ;WORKPIECE SURFACE COORD.', Q6: '2 ;SET-UP CLEARANCE', Q7: '+50 ;CLEARANCE HEIGHT', Q8: '0 ;ROUNDING RADIUS', Q9: '-1 ;DIRECTION OF ROTATION' }),
      ...cyc('CYCL DEF 22.0 ROUGH-OUT', { Q10: '4 ;PLUNGING DEPTH', Q11: '150 ;FEED RATE FOR PLUNGING', Q12: '700 ;FEED RATE FOR MILLING', Q18: '0 ;COARSE ROUGHING TOOL', Q19: '150 ;RECIPROCATION FEED RATE' }),
      'CYCL CALL M8', 'L Z+50 R0 FMAX',
      'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3',
      ...cyc('CYCL DEF 23.0 FLOOR FINISHING', { Q11: '150 ;FEED RATE FOR PLUNGING', Q12: '500 ;FEED RATE FOR MILLING' }), 'CYCL CALL M8',
      ...cyc('CYCL DEF 24.0 SIDE FINISHING', { Q9: '+1 ;DIRECTION OF ROTATION', Q10: '4 ;PLUNGING DEPTH', Q11: '150 ;FEED RATE FOR PLUNGING', Q12: '500 ;FEED RATE FOR MILLING', Q14: '+0 ;ALLOWANCE FOR SIDE' }), 'CYCL CALL',
      'L Z+100 R0 FMAX M5 M9', 'L Z+150 R0 FMAX M2',
      '; ---------- POCKET: CLOCKWISE, RR = INSIDE ----------', 'LBL 1', 'L X+8 Y+50 RR', 'L Y+85', 'RND R10', 'L X+92', 'RND R10', 'L Y+15', 'RND R10', 'L X+8', 'RND R10', 'L Y+50', 'LBL 0',
      '; ---------- ROUND ISLAND: CLOCKWISE, RL = OUTSIDE ----------', 'LBL 2', 'CC X+35 Y+50', 'L X+26 Y+50 RL', 'C X+26 DR-', 'LBL 0',
      '; ---------- DIAMOND ISLAND ----------', 'LBL 3', 'L X+59 Y+50 RL', 'L X+68 Y+59', 'L X+77 Y+50', 'L X+68 Y+41', 'L X+59 Y+50', 'LBL 0',
    ];
  }, ownTail: true });

/* ---------- 09 ---------- */
P.push({ name: '09_GEAR_OUTLINE', stock: { x: [0, 120], y: [0, 120], z: [-20, 0] }, tools: [5, 4], machines: BOTH,
  title: { sv: 'Kugghjulskontur', en: 'Gear outline' },
  description: { sv: 'Kugghjulsliknande kontur med 12 raka kuggar i polära block. En visuell demonstration, inte ett certifierat evolventkugghjul.',
    en: 'Gear-like outline with 12 straight-flanked teeth in polar blocks. A visual demonstration, not a certified involute gear.' },
  cycles: [208], techniques: ['CC', 'LP PR PA', 'RR', 'APPR PLCT', 'DEP PLCT', 'CP IPA', 'LBL / CALL LBL REP', 'CYCL DEF 208 BORE MILLING'],
  substitutions: ['Tooth form: straight flanks between a root circle (PR 38) and a tip circle (PR 48) instead of involute flanks; the control has no gear cycle and the engine no FK. Not a certified involute gear.'],
  placeholders: [],
  expected: { cutMinZ: -6, cutEnvelope: { x: [2, 118], y: [2, 118] }, minRemovedCm3: 20,
    features: ['12 teeth, tip Ø96, root Ø76, 6 mm high', 'clearance ring out to Ø128', 'hub bore Ø20 x 6'] },
  body() {
    const pts = [];                                   // CCW from the first tip corner at PA-5
    for (let k = 0; k < 12; k++) { const c = k * 30; pts.push([48, c + 5], [38, c + 9.5], [38, c + 20.5], [48, c + 25]); }
    const gear = pts.map(([pr, pa]) => `LP PR+${pr} PA${s(pa > 360 ? pa - 360 : pa)}`);
    return [
      '; ---------- CLEARANCE RING AND HUB BORE ----------', 'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3', 'CC X+60 Y+60', 'FN 0: Q1 = +0                ; CURRENT DEPTH',
      'LBL 1', 'FN 2: Q1 = +Q1 - +3', 'LP PR+58 PA+0 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z+Q1 R0 F200', 'CP IPA+360 DR+ F700', 'L Z+2 R0 FMAX', 'CALL LBL 1 REP 1',
      'L X+60 Y+60 R0 FMAX', ...cyc('CYCL DEF 208 BORE MILLING', { Q200: 2, Q201: -6, Q206: 400, Q334: 2, Q203: '+0', Q204: 30, Q335: 20, Q342: 0 }), 'CYCL CALL', 'L Z+50 R0 FMAX',
      '; ---------- TOOTH OUTLINE, COUNTER-CLOCKWISE, RR = OUTSIDE ----------', 'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3', 'CC X+60 Y+60', 'FN 0: Q1 = +0',
      'LBL 2', 'FN 2: Q1 = +Q1 - +3', 'LP PR+58 PA-20 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z+Q1 R0 F150',
      'APPR PLCT PR+48 PA-5 R3 RR F500', ...gear, 'DEP PLCT PR+58 PA+20 R3 F500', 'L Z+2 R0 FMAX', 'CALL LBL 2 REP 1', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 10 ---------- */
P.push({ name: '10_COOLANT_SWEEP', stock: { x: [0, 140], y: [0, 80], z: [-20, 0] }, tools: [6, 22], machines: BOTH,
  title: { sv: 'Kylvätskesvep', en: 'Coolant sweep' },
  description: { sv: 'Planfräsning med cykel 230 och ett slingrande spår med kulfräs och tangentiella bågar, allt med kylvätska (M8).',
    en: 'Face milling with cycle 230 and a serpentine groove with a ball cutter and tangential arcs, all under coolant (M8).' },
  cycles: [230], techniques: ['CYCL DEF 230 MULTIPASS MILLING', 'CT (tangential arc)', 'M8 / M9'],
  substitutions: ['Coolant: M8 / M9 switch the simulator\'s coolant spray; there is no fluid model, so the sweep is the tool path under coolant.'],
  placeholders: [],
  expected: { cutMinZ: -3.5, cutEnvelope: { x: [-30, 170], y: [15, 65] }, minRemovedCm3: 6,
    features: ['top faced 0.5 mm in 3 cuts', 'serpentine groove, ball Ø6, 3 mm below the faced top, three runs joined by R10 arcs'] },
  body() {
    return [
      '; ---------- FACE 0.5 ----------', 'TOOL CALL 6 Z S1200', 'L Z+50 R0 FMAX M3', 'M8',
      ...cyc('CYCL DEF 230 MULTIPASS MILLING', { Q225: '-30', Q226: '+15', Q227: '-0.5', Q218: 200, Q219: 50, Q240: 3, Q206: 300, Q207: 900, Q209: 900, Q200: 2 }), 'CYCL CALL',
      'L Z+50 R0 FMAX M9',
      '; ---------- SERPENTINE GROOVE ----------', 'TOOL CALL 22 Z S3000', 'L Z+50 R0 FMAX M3', 'L X+15 Y+20 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z-3.5 R0 F150',
      'L X+115 R0 F500', 'CT X+115 Y+40', 'L X+25', 'CT X+25 Y+60', 'L X+125', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 11 ---------- */
P.push({ name: '11_Q_PATTERN', stock: { x: [0, 100], y: [0, 100], z: [-15, 0] }, tools: [9], machines: BOTH,
  title: { sv: 'Q-parametermönster', en: 'Q-parameter pattern' },
  description: { sv: 'Tre rosetter räknade med Q-parametrar: radie = Q4 + Q5 x cos(6 x vinkel), med hopp och underprogram.',
    en: 'Three rosettes computed with Q parameters: radius = Q4 + Q5 x cos(6 x angle), with jumps and a subprogram.' },
  cycles: [], techniques: ['FN 0', 'FN 1', 'FN 2', 'FN 3', 'FN 6 SIN', 'FN 7 COS', 'FN 11 / FN 12 conditional jumps', 'LBL / CALL LBL', 'Q in coordinates'],
  substitutions: [], placeholders: [],
  expected: { cutMinZ: -1, cutEnvelope: { x: [10, 90], y: [10, 90] }, minRemovedCm3: 1,
    features: ['rosette radius 32 +/- 8', 'rosette radius 21 +/- 5.5', 'rosette radius 10 +/- 3', '6 lobes each, 3 degree steps, 1 mm deep, 3 mm stroke'] },
  body() {
    return [
      'TOOL CALL 9 Z S2500', 'L Z+50 R0 FMAX M3',
      'FN 0: Q1 = +50               ; CENTRE X', 'FN 0: Q2 = +50               ; CENTRE Y', 'FN 0: Q4 = +32               ; MEAN RADIUS', 'FN 0: Q5 = +8                ; AMPLITUDE',
      'FN 0: Q6 = +6                ; LOBES', 'FN 0: Q7 = +3                ; ANGLE STEP', 'FN 0: Q8 = -1                ; DEPTH',
      'LBL 10', 'FN 0: Q10 = +0               ; ANGLE', 'CALL LBL 20', 'L X+Q21 Y+Q22 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z+Q8 R0 F120',
      'LBL 11', 'FN 1: Q10 = +Q10 + +Q7', 'CALL LBL 20', 'L X+Q21 Y+Q22 R0 F280', 'FN 12: IF +Q10 LT +360 GOTO LBL 11', 'L Z+2 R0 FMAX',
      'FN 2: Q4 = +Q4 - +11', 'FN 2: Q5 = +Q5 - +2.5', 'FN 11: IF +Q4 GT +9 GOTO LBL 10',
      'L Z+100 R0 FMAX M5 M9', 'L Z+150 R0 FMAX M2',
      '; ---------- POINT ON THE ROSETTE AT ANGLE Q10 -> Q21, Q22 ----------',
      'LBL 20', 'FN 3: Q11 = +Q6 * +Q10', 'FN 7: Q12 = COS +Q11', 'FN 3: Q12 = +Q12 * +Q5', 'FN 1: Q13 = +Q4 + +Q12       ; RADIUS',
      'FN 7: Q14 = COS +Q10', 'FN 6: Q15 = SIN +Q10', 'FN 3: Q21 = +Q13 * +Q14', 'FN 1: Q21 = +Q21 + +Q1', 'FN 3: Q22 = +Q13 * +Q15', 'FN 1: Q22 = +Q22 + +Q2', 'LBL 0',
    ];
  }, ownTail: true });

/* ---------- 12 ---------- */
P.push({ name: '12_SUBPROGRAM_GRID', stock: { x: [0, 140], y: [0, 90], z: [-15, 0] }, tools: [4], machines: BOTH,
  title: { sv: 'Underprogram i rutnät', en: 'Subprogram grid' },
  description: { sv: 'Ett underprogram (rund ficka Ø16) anropas 15 gånger i ett 5 x 3-rutnät med nollpunktsförskjutning (cykel 7).',
    en: 'One subprogram (round pocket Ø16) is called 15 times on a 5 x 3 grid with datum shift (cycle 7).' },
  cycles: [7], techniques: ['LBL subprogram + CALL LBL', 'CYCL DEF 7 DATUM SHIFT with Q', 'FN 0', 'FN 1', 'FN 12 conditional jumps', 'CC + C'],
  substitutions: [], placeholders: [],
  expected: { cutMinZ: -3, cutEnvelope: { x: [15, 125], y: [15, 75] }, minRemovedCm3: 8,
    features: ['15 round pockets Ø16 x 3 deep', 'columns X+20 .. X+120 pitch 25', 'rows Y+20, Y+45, Y+70'] },
  body() {
    return [
      'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3', 'M8',
      'FN 0: Q2 = +20               ; ROW Y', 'LBL 1', 'FN 0: Q1 = +20               ; COLUMN X',
      'LBL 2', 'CYCL DEF 7.0 DATUM SHIFT', 'CYCL DEF 7.1 X+Q1', 'CYCL DEF 7.2 Y+Q2', 'CALL LBL 10',
      'FN 1: Q1 = +Q1 + +25', 'FN 12: IF +Q1 LT +121 GOTO LBL 2', 'FN 1: Q2 = +Q2 + +25', 'FN 12: IF +Q2 LT +71 GOTO LBL 1',
      'CYCL DEF 7.0 DATUM SHIFT', 'CYCL DEF 7.1 X+0', 'CYCL DEF 7.2 Y+0',
      'L Z+100 R0 FMAX M5 M9', 'L Z+150 R0 FMAX M2',
      '; ---------- ROUND POCKET 16 AT THE SHIFTED DATUM ----------',
      'LBL 10', 'L X+0 Y+0 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-3 R0 F150', 'L X+5 R0 F500', 'CC X+0 Y+0', 'C X+5 Y+0 DR+', 'L X+0 Y+0', 'L Z+2 R0 FMAX', 'LBL 0',
    ];
  }, ownTail: true });

/* ---------- 13 ---------- */
P.push({ name: '13_RADIUS_COMP', stock: { x: [0, 100], y: [0, 100], z: [-20, 0] }, tools: [4], machines: BOTH,
  title: { sv: 'Radiekompensering', en: 'Radius compensation' },
  description: { sv: 'Samma kvadrat 40 x 40 körs tre gånger: RR (utanför), R0 (på linjen) och RL (innanför). Resultatet är en trappa som visar förskjutningen.',
    en: 'The same 40 x 40 square is run three times: RR (outside), R0 (on the line) and RL (inside). The result is a staircase that shows the offset.' },
  cycles: [], techniques: ['RL', 'RR', 'R0', 'compensation switched on and off in L blocks', 'transition arcs at outside corners'],
  substitutions: ['Approach: each compensated pass plunges on its own offset path and switches RL / RR on in the first L block, so no lead-in mark is left; APPR / DEP are shown in 06, 09 and 16.'], placeholders: [],
  expected: { cutMinZ: -6, cutEnvelope: { x: [27, 73], y: [27, 73] }, minRemovedCm3: 5,
    features: ['programmed square X+30..70 Y+30..70, counter-clockwise', 'RR pass: band 6 mm outside the line at Z-6', 'R0 pass: band 3 mm each side at Z-4', 'RL pass: band 6 mm inside the line at Z-2'] },
  body() {
    const sq = ['L X+70', 'L Y+70', 'L X+30', 'L Y+30'];
    return [
      'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3',
      '; ---------- RR: TOOL RIGHT OF THE PATH = OUTSIDE, Z-6 ----------', 'L X+50 Y+27 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z-6 R0 F150',
      'L X+50 Y+30 RR F500', ...sq, 'L X+50', 'L X+50 Y+27 R0', 'L Z+2 R0 FMAX',
      '; ---------- R0: TOOL CENTRE ON THE PATH, Z-4 ----------', 'L X+30 Y+30 R0 FMAX', 'L Z-4 R0 F150', 'L X+70 R0 F500', ...sq.slice(1), 'L Z+2 R0 FMAX',
      '; ---------- RL: TOOL LEFT OF THE PATH = INSIDE, Z-2 ----------', 'L X+50 Y+33 R0 FMAX', 'L Z-2 R0 F150',
      'L X+50 Y+30 RL F500', ...sq, 'L X+50', 'L X+50 Y+33 R0', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 14 ---------- */
P.push({ name: '14_MULTI_TOOL', stock: { x: [0, 120], y: [0, 80], z: [-25, 0] }, tools: [6, 5, 4, 1, 2, 3, 8], machines: BOTH,
  title: { sv: 'Flera verktyg', en: 'Multi tool' },
  description: { sv: 'Sju verktyg i en körning: planfräs, grovficka, finficka, centrumborr, borr, gängtapp M10 och fasfräs.',
    en: 'Seven tools in one run: face mill, pocket roughing, pocket finishing, spot drill, drill, M10 tap and chamfer mill.' },
  cycles: [4, 212, 200, 207, 221], techniques: ['TOOL CALL x 7', 'CYCL DEF 4 POCKET MILLING', 'CYCL DEF 212 POCKET FINISHING', 'CYCL DEF 200 DRILLING', 'CYCL DEF 207 RIGID TAPPING NEW', 'CYCL DEF 221 CARTESIAN PATTERN'],
  substitutions: [], placeholders: [],
  expected: { cutMinZ: -18.5, cutEnvelope: { x: [-30, 150], y: [0, 80] }, minRemovedCm3: 30,
    features: ['top faced 0.5 mm', 'pocket 72 x 42, corner radius 6, floor Z-8.5', '4 holes Ø8.5 to Z-18.5 at X+12/108 Y+12/68, tapped M10 x 1.5 to Z-14.5', 'edge break around the top'] },
  body() {
    const pat = cyc('CYCL DEF 221 CARTESIAN PATTERN', { Q225: '+12', Q226: '+12', Q237: '+96', Q238: '+56', Q242: 2, Q243: 2, Q224: '+0', Q200: 2, Q203: '-0.5', Q204: 30, Q301: 1 });
    return [
      '; ---------- T6 FACE 0.5 ----------', 'TOOL CALL 6 Z S1200', 'L Z+50 R0 FMAX M3', 'L X-30 Y+20 R0 FMAX M8', 'L Z-0.5 R0 FMAX', 'L X+150 R0 F900', 'L Y+60 R0 FMAX', 'L X-30 R0 F900', 'L Z+50 R0 FMAX',
      '; ---------- T5 ROUGH POCKET 70 X 40 ----------', 'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3', 'L X+60 Y+40 R0 FMAX', 'L Z+1.5 R0 FMAX', ...pocket4(-8, 4, 200, 70, 40, 800), 'CYCL CALL', 'L Z+50 R0 FMAX',
      '; ---------- T4 FINISH POCKET 72 X 42 ----------', 'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3',
      ...cyc('CYCL DEF 212 POCKET FINISHING', { Q200: 2, Q201: -8, Q206: 150, Q202: 8, Q207: 500, Q203: '-0.5', Q204: 30, Q216: '+60', Q217: '+40', Q218: 72, Q219: 42, Q220: 6, Q221: 0 }), 'CYCL CALL', 'L Z+50 R0 FMAX',
      '; ---------- T1 SPOT ----------', 'TOOL CALL 1 Z S2000', 'L Z+50 R0 FMAX M3', ...drill200(-2.5, 2.5, 150, -0.5), ...pat, 'L Z+50 R0 FMAX',
      '; ---------- T2 DRILL 8.5 ----------', 'TOOL CALL 2 Z S1800', 'L Z+50 R0 FMAX M3', ...drill200(-18, 5, 180, -0.5), ...pat, 'L Z+50 R0 FMAX',
      '; ---------- T3 TAP M10 X 1.5 ----------', 'TOOL CALL 3 Z S300', 'L Z+50 R0 FMAX M3',
      ...cyc('CYCL DEF 207 RIGID TAPPING NEW', { Q200: 2, Q201: -14, Q239: '+1.5', Q203: '-0.5', Q204: 30 }), ...pat, 'L Z+50 R0 FMAX',
      '; ---------- T8 EDGE BREAK ----------', 'TOOL CALL 8 Z S2400', 'L Z+50 R0 FMAX M3', 'L X-10 Y+0 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-1.5 R0 F300',
      'L X+120 R0 F800', 'L Y+80', 'L X+0', 'L Y+0', 'L Z+50 R0 FMAX',
    ];
  } });

/* ---------- 15 ---------- */
P.push({ name: '15_430_SWIVEL', stock: { x: [0, 100], y: [0, 80], z: [-40, 0] }, tools: [15, 2], machines: ['430'], view: [0.72, -0.5, 0.62],
  title: { sv: '430 svänghuvud', en: '430 swivel head' },
  description: { sv: 'Endast TNC 430: cykel 304 vrider B-huvudet 30 grader och cykel 19 lutar bearbetningsplanet lika mycket, en sned yta fräses och två hål borras vinkelrätt mot den.',
    en: 'TNC 430 only: cycle 304 turns the B head 30 degrees and cycle 19 tilts the working plane to match, a sloped face is milled and two holes are drilled square to it.' },
  cycles: [7, 19, 200, 304], techniques: ['CYCL DEF 304 B head (machine builder, placeholder H1)', 'CYCL DEF 19 WORKING PLANE', 'CYCL DEF 7 DATUM SHIFT', 'CYCL DEF 200 DRILLING in the tilted plane', 'M99'],
  substitutions: ['Radius compensation in the tilted plane is approximate in the engine (docs/FEATURES.txt), so the sloped face is milled with R0 centre-line passes.'],
  placeholders: ['V2', 'H1'],
  expected: { cutMinZ: -21, cutEnvelope: { x: [70, 109], y: [-12, 92] }, minRemovedCm3: 24,
    features: ['face sloped 30 degrees about Y along the X+100 edge, from X+65.4 on the top to Z-20 on the side', '2 holes Ø8.5 x 12 square to the sloped face, 40 mm apart'] },
  body() { return SWIVEL(); } });

/* ---------- 16 ---------- */
P.push({ name: '16_5511_SHOWCASE', stock: { x: [0, 160], y: [0, 110], z: [-15, 0] }, tools: [5, 4, 9, 1], machines: BOTH,
  title: { sv: '5511-märket', en: 'The 5511 badge' },
  description: { sv: 'Ett lekfullt verkstadsmärke: rundad bricka, stora siffror 5511, tunn ram, två polära stjärnor och fyra nitmärken.',
    en: 'A playful shop badge: rounded plate, big 5511 numerals, a thin frame, two polar stars and four rivet marks.' },
  cycles: [200], techniques: ['RL', 'APPR LCT', 'DEP LCT', 'RND', 'LBL / CALL LBL REP', 'CC', 'LP PR PA', 'CYCL DEF 7 DATUM SHIFT', 'CYCL DEF 200 DRILLING', 'M99'],
  substitutions: ['Numerals: written as straight L strokes from the generator\'s own single-stroke glyphs (no text cycle on the control).',
    '"5511" is treated as a shop badge text only; it stands for no part number, standard or certification.'],
  placeholders: [],
  expected: { cutMinZ: -4, cutEnvelope: { x: [-14, 161], y: [-1, 111] }, minRemovedCm3: 12,
    features: ['badge outline 150 x 100, corner radius 15, wall to Z-4', 'numerals 5511: 22 x 40 mm cells, 6 mm stroke, 3 mm deep', 'frame 1 mm deep', '2 five-pointed stars and an underline', '4 rivet marks'] },
  body() {
    const dig = strokes('5511', 24, 38, 22, 40, 8);
    const star = (cx) => { const o = ['CYCL DEF 7.0 DATUM SHIFT', `CYCL DEF 7.1 X${s(cx)}`, 'CYCL DEF 7.2 Y+25', 'CC X+0 Y+0', 'LP PR+6 PA+90 R0 FMAX', 'L Z-1 R0 F120'];
      for (let k = 1; k <= 10; k++) o.push(`LP PR+${k % 2 ? 2.5 : 6} PA${s((90 + 36 * k) % 360)}${k === 1 ? ' R0 F280' : ''}`);
      o.push('L Z+2 R0 FMAX'); return o; };
    return [
      '; ---------- T5 BADGE OUTLINE, CLIMB MILLING ----------', 'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3', 'L X-14 Y+55 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z-4 R0 F250',
      'APPR LCT X+5 Y+55 R4 RL F600', 'L Y+105', 'RND R15', 'L X+155', 'RND R15', 'L Y+5', 'RND R15', 'L X+5', 'RND R15', 'L Y+55', 'DEP LCT X-14 Y+55 R4 F600', 'L Z+50 R0 FMAX',
      '; ---------- T4 NUMERALS 5511, 2 X 1.5 MM ----------', 'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3', 'FN 0: Q1 = -1.5', 'FN 0: Q2 = +0', 'L X+24 Y+78 R0 FMAX M8', 'L Z+2 R0 FMAX',
      'LBL 1', 'FN 1: Q2 = +Q2 + +Q1', ...engrave(dig, '+Q2', 150, 500), 'CALL LBL 1 REP 1', 'L Z+50 R0 FMAX',
      '; ---------- T9 FRAME, UNDERLINE, STARS ----------', 'TOOL CALL 9 Z S2500', 'L Z+50 R0 FMAX M3', 'L X+80 Y+13 R0 FMAX M8', 'L Z+2 R0 FMAX', 'L Z-1 R0 F120',
      'L X+147 R0 F280', 'RND R8', 'L Y+97', 'RND R8', 'L X+13', 'RND R8', 'L Y+13', 'RND R8', 'L X+80', 'L Z+2 R0 FMAX',
      'L X+52 Y+25 R0 FMAX', 'L Z-1 R0 F120', 'L X+108 R0 F280', 'L Z+2 R0 FMAX',
      ...star(40), ...star(120), 'CYCL DEF 7.0 DATUM SHIFT', 'CYCL DEF 7.1 X+0', 'CYCL DEF 7.2 Y+0', 'L Z+50 R0 FMAX',
      '; ---------- T1 RIVET MARKS ----------', 'TOOL CALL 1 Z S2000', 'L Z+50 R0 FMAX M3', ...drill200(-2, 2, 150),
      'L X+22 Y+88 R0 FMAX M99', 'L X+138 Y+88 R0 FMAX M99', 'L X+138 Y+22 R0 FMAX M99', 'L X+22 Y+22 R0 FMAX M99', 'L Z+50 R0 FMAX',
    ];
  } });

function SWIVEL() {
  /* the operator's 430 (11-21): the head is turned by the machine builder's cycle 304 (Q2 = B head); cycle 19 only tilts the plane */
  const tilt = ['CYCL DEF 7.0 DATUM SHIFT', 'CYCL DEF 7.1 X+100', 'CYCL DEF 7.2 Y+40', 'CYCL DEF 7.3 Z-20', 'CYCL DEF 304 ~', '  Q2=-30 ;', 'CYCL DEF 19.0 WORKING PLANE', 'CYCL DEF 19.1 A+0 B-30 C+0'];
  const level = ['CYCL DEF 19.0 WORKING PLANE', 'CYCL DEF 19.1 A+0 B+0 C+0', 'CYCL DEF 304 ~', '  Q2=+0 ;', 'CYCL DEF 7.0 DATUM SHIFT', 'CYCL DEF 7.1 X+0', 'CYCL DEF 7.2 Y+0', 'CYCL DEF 7.3 Z+0'];
  return [
    '; DATUM ON THE X+100 EDGE AT Z-20, PLANE TILTED 30 DEGREES ABOUT Y:', '; IN THE TILTED PLANE THE SLOPED FACE IS Z+0, X-40 (TOP EDGE) TO X+0',
    '; THE HEAD IS TURNED BY CYCLE 304 (B HEAD), CYCLE 19 ONLY TILTS THE PLANE',
    'TOOL CALL 15 Z S2500', 'L Z+100 R0 FMAX M3', ...tilt,
    '; ---------- SLOPED FACE, 4 LEVELS, 4 PASSES ALONG Y ----------', 'L X-34 Y-52 Z+40 R0 FMAX M8', 'FN 0: Q1 = +18               ; HEIGHT ABOVE THE FACE',
    'LBL 1', 'FN 2: Q1 = +Q1 - +4.5', 'L X-34 Y-52 R0 FMAX', 'L Z+Q1 R0 FMAX',
    'L Y+52 R0 F600', 'L X-22 R0 FMAX', 'L Y-52 R0 F600', 'L X-10 R0 FMAX', 'L Y+52 R0 F600', 'L X+2 R0 FMAX', 'L Y-52 R0 F600',
    'CALL LBL 1 REP 3', 'L Z+40 R0 FMAX', ...level, 'L Z+100 R0 FMAX',
    '; ---------- 2 HOLES SQUARE TO THE SLOPED FACE ----------', 'TOOL CALL 2 Z S1800', 'L Z+100 R0 FMAX M3', ...tilt, 'L X-20 Y-20 Z+40 R0 FMAX M8',
    ...cyc('CYCL DEF 200 DRILLING', { Q200: 2, Q201: -12, Q206: 150, Q202: 4, Q210: 0, Q203: '+0', Q204: 20, Q211: 0 }),
    'L X-20 Y-20 R0 FMAX M99', 'L X-20 Y+20 R0 FMAX M99', 'L Z+40 R0 FMAX', ...level,
  ];
}

/* ---------- write ---------- */
function build() {
  const files = {}, entries = [];
  for (const p of P) {
    const lines = [...head(p.name, p.stock, [p.title.en.toUpperCase(), ...(p.headNote || [])]), ...p.body(), ...(p.ownTail ? [`END PGM ${p.name} MM`] : tail(p.name))];
    const text = lines.join('\n') + '\n';
    files[p.name + '.H'] = text;
    entries.push({ id: p.name, file: p.name + '.H', title: p.title, description: p.description, machines: p.machines, machine: p.machines[0], units: 'MM',
      stock: { x: p.stock.x, y: p.stock.y, z: p.stock.z, form: 'BLK FORM 0.1 Z / 0.2, blank top at Z+0, datum at the lower left corner' },
      tools: p.tools.map(tool), cycles: p.cycles, techniques: p.techniques, substitutions: p.substitutions, placeholders: p.placeholders,
      expected: p.expected, thumbnail: 'thumbs/' + p.name.toLowerCase().replace(/_/g, '-') + '.png', ...(p.view ? { thumbnailView: p.view } : {}), sha256: createHash('sha256').update(text).digest('hex') });
  }
  return { files, entries };
}
function manifestOf(entries, old) {
  const prev = new Map((old?.programs || []).map((e) => [e.id, e]));
  return { schema: 1, generator: 'scripts/showcase-gen.mjs', verifier: 'scripts/showcase-verify.mjs', thumbnails: 'scripts/showcase-thumbs.mjs',
    note: 'Sixteen original showcase programs for the TNC 426/430 simulator. Educational examples for the simulator, not verified on a real control.',
    toolTable: 'Every tool is an entry of the simulator\'s built-in table (sim/engine.js TNC.TOOLS); holder ISO 50, A = 100 mm.',
    programs: entries.map((e) => { const o = prev.get(e.id); return o && o.sha256 === e.sha256 && o.validation ? { ...e, validation: o.validation } : { ...e, validation: null }; }) };
}
const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === join(process.argv[1]).toLowerCase();
if (isMain) {
  const { files, entries } = build(), mf = join(OUT, 'manifest.json');
  const old = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : null;
  const manifest = JSON.stringify(manifestOf(entries, old), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const diff = Object.entries(files).filter(([n, t]) => !existsSync(join(OUT, n)) || readFileSync(join(OUT, n), 'utf8') !== t).map(([n]) => n);
    if (!old || manifest !== readFileSync(mf, 'utf8')) diff.push('manifest.json');
    console.log(diff.length ? 'showcase-gen: differs: ' + diff.join(', ') : 'showcase-gen: ' + Object.keys(files).length + ' programs and the manifest match the generator');
    process.exit(diff.length ? 1 : 0);
  }
  mkdirSync(join(OUT, 'thumbs'), { recursive: true });
  for (const [n, t] of Object.entries(files)) writeFileSync(join(OUT, n), t);
  writeFileSync(mf, manifest);
  JSON.parse(readFileSync(mf, 'utf8'));
  console.log('showcase-gen: wrote ' + Object.keys(files).length + ' programs and manifest.json to ' + OUT);
}
export { build, P };
