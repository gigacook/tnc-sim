/* What "the same behaviour" means: for every golden program, under two option sets (426 defaults; 430 with the built-in
   tools, holder A 100 and auto tools), the full TNC.run result (blocks, moves, errors, stock, stats, execution order)
   and, when it runs clean, the checks (expand + analyse: events, cut / feed length, grid, segment summary).
   snapshot(engine, src) -> plain JSON-able object.   engine: { run(src, opts), expand(res), grid(stock, segs), analyse(res, ex, g), TOOLS, MACHINES } */
const OPTS = (E) => [
  ['426', {}],
  ['430', { tools: E.TOOLS, machine: E.MACHINES['430'], holder: { stack: () => 100 }, autoTools: true }],
];

function segSummary(segs) {
  let len = 0, time = 0, h = 0;
  for (const s of segs) {
    len += s.len; time = s.t1;
    for (const v of [s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z]) h = (h * 31 + Math.round(v * 1000)) % 1000000007;
  }
  return { n: segs.length, len, time, h };
}

function snapshot(E, src) {
  const out = {};
  for (const [key, opts] of OPTS(E)) {
    const r = E.run(src, opts);
    const o = { blocks: r.blocks, moves: r.moves, errors: r.errors, stock: r.stock, stats: r.stats, exec: r.exec };
    if (!r.errors.length) {
      const ex = E.expand(r), g = E.grid(r.stock, ex.segs), ev = E.analyse(r, ex, g);
      o.check = { segs: segSummary(ex.segs), total: ex.total, grid: g, events: ev.slice(), cut: ev.cut };
    }
    out[key] = o;
  }
  return out;
}

/* JSON with NaN / Infinity kept (JSON.stringify would make them null), undefined dropped, keys sorted */
function canon(v) {
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v === Infinity ? 'Inf' : v === -Infinity ? '-Inf' : Object.is(v, -0) ? 0 : v;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) if (v[k] !== undefined && typeof v[k] !== 'function') o[k] = canon(v[k]); return o; }
  return v;
}

/* long arrays (moves, exec, blocks of big programs) as a digest: length, a hash of the values rounded to 1e-6, the first
   and last 20 entries. Keeps the record small; `node tests/parity.js --vs js` compares in full when a digest differs. */
function hashOf(v, h) {
  if (typeof v === 'number') return (h * 31 + (Math.round(v * 1e6) % 1000000007)) % 1000000007;
  if (typeof v === 'string') { for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) % 1000000007; return h; }
  if (typeof v === 'boolean') return (h * 31 + (v ? 7 : 3)) % 1000000007;
  if (v === null) return (h * 31 + 1) % 1000000007;
  if (Array.isArray(v)) { for (const x of v) h = hashOf(x, h); return (h * 31 + v.length) % 1000000007; }
  for (const k of Object.keys(v)) { h = hashOf(k, h); h = hashOf(v[k], h); }
  return h;
}
function compact(v) {
  if (Array.isArray(v)) return v.length > 200 ? { $n: v.length, $h: hashOf(v, 17), head: v.slice(0, 20).map(compact), tail: v.slice(-20).map(compact) } : v.map(compact);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = compact(v[k]); return o; }
  return v;
}

/* first difference, numbers within 1e-9 (relative above 1) */
function diff(a, b, path) {
  path = path || '';
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? null : path + ': ' + a + ' vs ' + b;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return path + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
  if (Array.isArray(a)) {
    if (a.length !== b.length) return path + '.length: ' + a.length + ' vs ' + b.length;
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], path + '[' + i + ']'); if (d) return d; }
    return null;
  }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    for (const k of new Set(ka.concat(kb))) { if (!(k in a) || !(k in b)) return path + '.' + k + ': ' + (k in a ? 'only in golden' : 'only in engine'); const d = diff(a[k], b[k], path + '.' + k); if (d) return d; }
    return null;
  }
  return a === b ? null : path + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
}

const jsEngine = () => {
  const T = require('../../sim/core.js'), SIM = require('../../sim/sim.js');
  return { name: 'js', run: T.run, TOOLS: T.TOOLS, MACHINES: require('../../sim/machines.js'), expand: SIM.expand, grid: SIM.grid, analyse: SIM.analyse };
};
module.exports = { snapshot, canon, compact, diff, jsEngine, OPTS };
