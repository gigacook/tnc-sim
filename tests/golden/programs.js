/* The golden program set: every complete program in the repo (manual examples, lessons, demos, test fixtures),
   deterministic one-line mutations of each (the error paths), and seeded random programs spliced from their block
   lines (state combinations no example reaches). Same output on every machine: no clock, no Math.random.
   programs() -> [{ id, src }] */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SOURCES = ['tests/manual.js', 'tests/part.js', 'tests/ai/loop.js', 'sim/programs.js', 'sim/lessons.js', 'sim/ui.js', 'sim/ai.js', 'tests/golden/extra.txt'];

/* JS string / template literal bodies that hold a whole program */
function harvest(file) {
  const txt = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'), out = [];   // a Windows checkout has CRLF: the record must not depend on it
  const lit = /`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  const unesc = (s) => s.replace(/\\(n|t|'|"|`|\\)/g, (_, c) => ({ n: '\n', t: '\t' })[c] || c);
  if (file.endsWith('.txt')) return txt.split(/\n=====\n/).filter((s) => /BEGIN PGM/.test(s));
  while ((m = lit.exec(txt))) {
    const body = unesc(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    if (/BEGIN PGM \S+/.test(body) && /END PGM/.test(body) && !/\$\{/.test(body)) out.push(body);
  }
  return out;
}

function prng(seed) {                                 // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function programs(opts) {
  opts = opts || {};
  const base = [], seen = new Set();
  const add = (id, src) => { if (!seen.has(src)) { seen.add(src); base.push({ id, src }); } };
  for (const f of SOURCES) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    harvest(f).forEach((src, i) => add(f + '#' + i, src));
  }
  // lessons and demo programs as the modules export them (some are built from arrays)
  const walk = (o, p) => { if (typeof o === 'string') { if (/BEGIN PGM/.test(o) && /END PGM/.test(o)) add(p, o.replace(/\r\n/g, '\n')); }
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p + '.' + k); };
  walk(require(path.join(ROOT, 'sim/lessons.js')), 'lessons');
  walk(require(path.join(ROOT, 'sim/programs.js')), 'programs');
  const out = base.slice();
  // one-line mutations: drop each line, duplicate each line (every program, every line, capped per program)
  for (const p of base) {
    const L = p.src.split('\n'), n = Math.min(L.length, 80);
    for (let i = 1; i < n; i++) {
      out.push({ id: p.id + '/drop' + i, src: L.slice(0, i).concat(L.slice(i + 1)).join('\n') });
      if (i % 3 === 0) out.push({ id: p.id + '/dup' + i, src: L.slice(0, i + 1).concat(L.slice(i)).join('\n') });
    }
  }
  // spliced random programs from the pool of real block lines
  const pool = [];
  for (const p of base) for (const l of p.src.split('\n')) if (l.trim() && !/^\s*(BEGIN|END) PGM/.test(l)) pool.push(l);
  const R = prng(426430), N = opts.random != null ? opts.random : 3000;
  const heads = base.map((p) => p.src.split('\n').filter((l) => /BLK FORM/.test(l))).filter((h) => h.length === 2);
  for (let k = 0; k < N; k++) {
    const len = 4 + Math.floor(R() * 60), lines = ['BEGIN PGM R' + k + ' MM'].concat(heads[Math.floor(R() * heads.length)] || []);
    for (let j = 0; j < len; j++) {
      let l = pool[Math.floor(R() * pool.length)];
      if (R() < 0.15) l = l.replace(/([XYZRF])([+-]?)(\d+(\.\d+)?)/, (_, a, s, v) => a + (R() < 0.5 ? '-' : '+') + (Math.round(R() * 2000) / 10));   // perturb one number
      lines.push(l);
    }
    if (R() < 0.85) lines.push('END PGM R' + k + ' MM');
    out.push({ id: 'random#' + k, src: lines.join('\n') });
  }
  return out;
}
module.exports = { programs, prng };
if (require.main === module) { const P = programs(); console.log(P.length + ' programs (' + P.filter((p) => !/\/|random/.test(p.id)).length + ' harvested)'); }
