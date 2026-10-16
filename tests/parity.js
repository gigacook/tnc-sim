/* Behaviour freeze: the golden record of what the interpreter and its checks do, and the check that an engine matches it.
   node tests/parity.js --record           write tests/golden/golden.jsonl.gz from the JS engine (only when behaviour changes on purpose)
   node tests/parity.js [--engine js|rust] compare that engine with the record (default: rust)
   node tests/parity.js --vs js            compare the Rust engine with the JS one live, in full (no digests)
   --only <id part>   --show <n>
   Exit 1 on any difference; the first differences are printed with their path. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { programs } = require('./golden/programs.js'), { snapshot, canon, compact, diff, jsEngine } = require('./golden/snapshot.js');
const FILE = path.join(__dirname, 'golden', 'golden.jsonl.gz');
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1] || true; };
const engine = (name) => name === 'js' ? jsEngine() : require('./golden/engine-rust.js')();

(async () => {
  if (arg('--record')) {
    const E = jsEngine(), P = programs(), gz = zlib.createGzip({ level: 9 }), ws = fs.createWriteStream(FILE);
    gz.pipe(ws);
    for (const p of P) gz.write(JSON.stringify({ id: p.id, src: p.src, out: compact(canon(snapshot(E, p.src))) }) + '\n');
    gz.end(); await new Promise((r) => ws.on('finish', r));
    console.log('recorded ' + P.length + ' programs -> ' + path.relative(process.cwd(), FILE) + ' (' + (fs.statSync(FILE).size / 1e6).toFixed(1) + ' MB)');
    return;
  }
  const E = engine(arg('--engine') || 'rust'), vs = arg('--vs') ? engine(arg('--vs')) : null, only = arg('--only');
  const rec = vs ? programs().map((p) => ({ id: p.id, src: p.src }))
    : zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  let bad = 0, shown = 0, n = 0;
  const t0 = Date.now();
  for (const g of rec) {
    if (only && !g.id.includes(only)) continue;
    n++;
    let d;
    try {
      const got = canon(snapshot(E, g.src));
      d = vs ? diff(canon(snapshot(vs, g.src)), got) : diff(g.out, compact(got));
    } catch (e) { d = 'threw ' + (e && e.stack || e); }
    if (d) { bad++; if (shown++ < (+arg('--show') || 10)) console.log('  DIFF  ' + g.id + '  ' + d.slice(0, 400)); }
  }
  console.log(`${n - bad} / ${n} programs identical (${E.name} engine${vs ? ' vs ' + vs.name : ''}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(bad ? 1 : 0);
})();
