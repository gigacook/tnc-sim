/* Behaviour freeze: the golden record of what the interpreter and its checks do, and the check that the engine matches it.
   node tests/parity.js            compare the engine (sim/engine/tnc_core.wasm, or TNC_WASM=<path>) with the record
   node tests/parity.js --record   re-record from the engine: only when behaviour changes on purpose, in the same commit
   --only <id part>   --show <n>   PARITY_FULL=1 keeps every segment instead of a digest (for a manual deep look)
   The record was first written from the JS engine (sim/core.js, stock.js, sim.js) before it was retired on 2026-10-17;
   the Rust engine matched it on every program, live and in full.
   Exit 1 on any difference; the first differences are printed with their path. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { programs } = require('./golden/programs.js'), { snapshot, canon, compact, diff } = require('./golden/snapshot.js');
const FILE = path.join(__dirname, 'golden', 'golden.jsonl.gz');
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1] || true; };
const engine = () => require('./golden/engine-rust.js')();

(async () => {
  const E = engine();
  if (arg('--record')) {
    const P = programs(), gz = zlib.createGzip({ level: 9 }), ws = fs.createWriteStream(FILE);
    gz.pipe(ws);
    for (const p of P) gz.write(JSON.stringify({ id: p.id, src: p.src, out: compact(canon(snapshot(E, p.src))) }) + '\n');
    gz.end(); await new Promise((r) => ws.on('finish', r));
    console.log('recorded ' + P.length + ' programs -> ' + path.relative(process.cwd(), FILE) + ' (' + (fs.statSync(FILE).size / 1e6).toFixed(1) + ' MB)');
    return;
  }
  const only = arg('--only');
  const rec = zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  let bad = 0, shown = 0, n = 0;
  const t0 = Date.now();
  for (const g of rec) {
    if (only && !g.id.includes(only)) continue;
    n++;
    let d;
    try { d = diff(g.out, compact(canon(snapshot(E, g.src)))); } catch (e) { d = 'threw ' + (e && e.stack || e); }
    if (d) { bad++; if (shown++ < (+arg('--show') || 10)) console.log('  DIFF  ' + g.id + '  ' + d.slice(0, 400)); }
  }
  console.log(`${n - bad} / ${n} programs identical to the record (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(bad ? 1 : 0);
})();
