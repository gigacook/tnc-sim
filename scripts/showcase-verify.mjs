#!/usr/bin/env node
// showcase-verify.mjs - runs every showcase program through the engine the browser uses and checks the result.
//   node scripts/showcase-verify.mjs             WASM checks, writes artifacts/showcase/report.json and the manifest's validation blocks
//   node scripts/showcase-verify.mjs --native    also builds a small native runner against server/crates/tnc-engine and compares
//   node scripts/showcase-verify.mjs --no-write  checks only, writes nothing
// Engine path: sim/engine.js loading sim/engine/tnc_core.wasm (the module build.py inlines into index.html), called the way
// sim/ui.js calls it: TNC.run with the machine config of sim/machines.js and the ISO 50 holder (A = 100), then
// TNC_SIM.expand, TNC_SIM.grid and TNC_SIM.analyse with the vice on. The run gets ONLY the tools the manifest lists
// (auto-tools off), so a TOOL CALL for an undeclared tool is an engine error.
// Exports checkProgram() and verifyAll() for tests/showcase.js. Exit code 1 on any failed check.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'examples', 'showcase');
const REPORT = join(ROOT, 'artifacts', 'showcase', 'report.json');
const WASM = process.env.TNC_WASM || join(ROOT, 'sim', 'engine', 'tnc_core.wasm');
const require = createRequire(import.meta.url);
const E = require(join(ROOT, 'sim', 'engine.js'));
const MACHINES = require(join(ROOT, 'sim', 'machines.js'));
const HOLDER_A = 100;                      // sim/tools3d.js HOLDERS.ISO50.A, the simulator's default holder
const SAFE_Z = 20;                         // mm above the blank top: where tool changes and the program end must be
const CLEAR_Z = 1;                         // mm above the blank top: rapid moves across the blank must be at least here
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/* One program on one machine. p: {text, machine, tools, stock, expected}. Returns {ok, failures[], checks{}, metrics{}}. */
export function checkProgram(p) {
  const failures = [], checks = {}, metrics = {};
  const check = (name, ok, detail) => { checks[name] = !!ok; if (!ok) failures.push(name + (detail ? ': ' + detail : '')); return !!ok; };
  if (!E.ready()) throw new Error('TNC engine not loaded: ' + WASM + ' is missing (python build.py --wasm)');
  if (!(p.machine in MACHINES)) throw new Error('unknown machine ' + p.machine);
  const text = p.text, lines = text.split(/\r?\n/).filter((l) => l.trim());
  check('units', /^BEGIN PGM \S+ MM$/.test(lines[0] || '') && /^END PGM \S+ MM$/.test(lines[lines.length - 1] || ''), 'BEGIN / END PGM ... MM');
  check('blkForm', /^BLK FORM 0\.1 Z /.test(lines[1] || '') && /^BLK FORM 0\.2 /.test(lines[2] || ''), 'BLK FORM 0.1 / 0.2 after BEGIN PGM');

  const r = E.run(text, { tools: p.tools, machine: MACHINES[p.machine], holder: { stack: () => HOLDER_A } });
  const errors = r.errors.map((e) => `block ${e.block}: ${e.msg}`);
  check('noErrors', errors.length === 0, errors.slice(0, 5).join('; '));
  metrics.errors = errors;
  const st = r.stock, want = p.stock;
  check('stock', want && st.x0 === want.x[0] && st.x1 === want.x[1] && st.y0 === want.y[0] && st.y1 === want.y[1] && st.z0 === want.z[0] && st.z1 === want.z[1],
    'engine blank ' + JSON.stringify(st) + ' is not the manifest stock');

  /* completion: the M2 / M30 block was executed and the tool is retracted */
  const exec = new Set(r.exec), endBlock = r.blocks.find((b, i) => /\bM(2|30)\b/.test(String(b.raw || '').replace(/;.*/, '')) && exec.has(i));   // exec holds line indices
  const last = r.moves[r.moves.length - 1];
  check('completed', !!endBlock && !!last && last.to.z >= st.z1 + SAFE_Z - 1e-9, endBlock ? 'ends at Z' + last?.to.z : 'no executed M2 / M30');

  /* tools: every tool used is declared, every declared tool is used and is a built-in table entry */
  const used = (r.stats.toolsUsed || []).map((t) => t.t).filter((t) => t > 0), declared = p.tools.map((t) => t.t);
  check('toolsDeclared', used.every((t) => declared.includes(t)), 'used ' + used.join(',') + ' declared ' + declared.join(','));
  check('toolsUsed', declared.every((t) => used.includes(t)), 'declared but never cutting: ' + declared.filter((t) => !used.includes(t)).join(','));
  check('toolsBuiltIn', p.tools.every((t) => E.TOOLS.some((b) => b.t === t.t && b.name === t.name && b.l === t.l && b.r === t.r)), 'a tool differs from sim/engine.js TNC.TOOLS');
  metrics.toolsUsed = used;

  if (errors.length) return { ok: false, failures, checks, metrics };     // the simulator does not run a broken program

  const ex = E.SIM.expand(r), g = E.SIM.grid(st, ex.segs);
  const wasOn = E.STOCK.VICE.on; E.STOCK.VICE.on = true;
  const ev = E.SIM.analyse(r, ex, g); E.STOCK.VICE.on = wasOn;
  const crashes = ev.filter((e) => e.sev === 'crash'), warns = ev.filter((e) => e.sev === 'warn'), notes = ev.filter((e) => e.sev !== 'crash' && e.sev !== 'warn');
  const say = (l) => l.slice(0, 4).map((e) => `block ${e.block}: ${e.msg}`).join('; ');
  check('noCollision', crashes.length === 0, say(crashes));
  check('noWarnings', warns.length === 0, say(warns));
  check('noThroughCut', notes.length === 0, say(notes));
  metrics.events = ev.map((e) => ({ code: e.code, sev: e.sev, block: e.block, msg: e.msg }));

  /* geometry: cutting stays in the blank's depth, inside the expected envelope; travel stays in a sane range */
  const inXY = (q, m) => q.x > st.x0 - m && q.x < st.x1 + m && q.y > st.y0 - m && q.y < st.y1 + m;
  let cutMinZ = Infinity; const env = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] }, all = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  const unsafe = []; let lowRapid = null;
  ex.segs.forEach((s, i) => {
    for (const q of [s.a, s.b]) { for (const k of ['x', 'y', 'z']) { all[k][0] = Math.min(all[k][0], q[k]); all[k][1] = Math.max(all[k][1], q[k]); } }
    const tilted = (s.a.a != null && (Math.abs(s.a.a) > 1e-9 || Math.abs(s.a.b) > 1e-9)) || (s.b.a != null && (Math.abs(s.b.a) > 1e-9 || Math.abs(s.b.b) > 1e-9));
    const low = Math.min(s.a.z, s.b.z);
    if (low < st.z1 - 1e-9) for (const q of [s.a, s.b]) { if (q.z < st.z1 - 1e-9 || s.kind === 'feed') { env.x[0] = Math.min(env.x[0], q.x); env.x[1] = Math.max(env.x[1], q.x); env.y[0] = Math.min(env.y[0], q.y); env.y[1] = Math.max(env.y[1], q.y); } }
    if (s.kind === 'feed' && !s.probe) cutMinZ = Math.min(cutMinZ, low);
    /* a rapid that moves sideways over the blank lower than CLEAR_Z, outside a cycle: unsafe (cycles reposition inside what they cleared) */
    if (s.kind === 'rapid' && !s.cycle && !tilted && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-6 && low < st.z1 + CLEAR_Z - 1e-9 && (inXY(s.a, s.toolR) || inXY(s.b, s.toolR)))
      if (!lowRapid) lowRapid = `block ${s.block} rapid at Z${round(low)}`;
    const prev = ex.segs[i - 1];
    if (prev && prev.tool !== s.tool && s.a.z < st.z1 + SAFE_Z - 1e-9) unsafe.push(`tool change T${prev.tool} -> T${s.tool} at Z${round(s.a.z)}`);
  });
  check('safeTravel', !lowRapid && unsafe.length === 0, [lowRapid, ...unsafe].filter(Boolean).join('; '));
  check('insideBlankDepth', cutMinZ >= st.z0 - 1e-6, 'cuts to Z' + round(cutMinZ) + ' below the blank bottom Z' + st.z0);
  const lim = MACHINES[p.machine]?.limits || {}, span = (k) => all[k][1] - all[k][0], limSpan = (k) => (lim[k] ? lim[k][1] - lim[k][0] : Infinity);
  check('insideTravel', span('x') <= Math.min(limSpan('X'), 600) && span('y') <= Math.min(limSpan('Y'), 600) && span('z') <= Math.min(limSpan('Z'), 400),
    `travel span X ${round(span('x'))} Y ${round(span('y'))} Z ${round(span('z'))}`);
  const xp = p.expected || {};
  if (xp.cutMinZ != null) check('expectedDepth', Math.abs(cutMinZ - xp.cutMinZ) <= 0.011, 'lowest cut Z' + round(cutMinZ) + ', expected Z' + xp.cutMinZ);
  if (xp.cutEnvelope) check('expectedEnvelope', env.x[0] >= xp.cutEnvelope.x[0] - 0.05 && env.x[1] <= xp.cutEnvelope.x[1] + 0.05 && env.y[0] >= xp.cutEnvelope.y[0] - 0.05 && env.y[1] <= xp.cutEnvelope.y[1] + 0.05,
    'tool centre below the blank top X ' + env.x.map((v) => round(v, 2)) + ' Y ' + env.y.map((v) => round(v, 2)) + ', expected inside X ' + xp.cutEnvelope.x + ' Y ' + xp.cutEnvelope.y);
  metrics.cutMinZ = round(cutMinZ); metrics.cutEnvelope = { x: env.x.map((v) => round(v, 2)), y: env.y.map((v) => round(v, 2)) };
  metrics.travel = { x: all.x.map((v) => round(v, 2)), y: all.y.map((v) => round(v, 2)), z: all.z.map((v) => round(v, 2)) };

  /* removed volume from the height field, stamped the way sim/ui.js cutSeg does (feed moves with the spindle on) */
  const hm = E.STOCK.field(st, g);
  for (const s of ex.segs) {
    if (s.kind !== 'feed' || !s.spindle || s.probe) continue;
    const step = Math.max(0.3, Math.min(s.toolR * 0.45, 2)), n = Math.max(1, Math.ceil(s.len / step));
    for (let i = 0; i <= n; i++) { const u = i / n; E.STOCK.stamp(hm, st, g, s, { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u, z: s.a.z + (s.b.z - s.a.z) * u }, E.STOCK.axis(s, u), 0); }
  }
  let vol = 0; for (let k = 0; k < hm.length; k++) vol += st.z1 - hm[k]; vol *= g.DX * g.DY;
  const blank = (st.x1 - st.x0) * (st.y1 - st.y0) * (st.z1 - st.z0);
  check('removal', vol > 0 && vol >= (xp.minRemovedCm3 || 0) * 1000 && vol < blank, 'removed ' + round(vol / 1000, 2) + ' cm3, expected at least ' + (xp.minRemovedCm3 || 0));
  metrics.removedCm3 = round(vol / 1000, 2); metrics.removedShare = round(vol / blank, 4); metrics.engineRemovedEstimateCm3 = round(r.stats.removedVolume / 1000, 2);

  const t = r.stats.cycleTime;
  check('cycleTime', Number.isFinite(t) && t > 0 && Math.abs(ex.total - t) < Math.max(1, t * 0.5), 'cycle time ' + t);
  Object.assign(metrics, { cycleTimeS: round(t, 1), animationTimeS: round(ex.total, 1), blocks: r.stats.blockCount, moves: r.stats.moveCount, pathFeedMm: round(r.stats.pathFeed, 1),
    pathRapidMm: round(r.stats.pathRapid, 1), cutShareOfFeed: ev.cut?.feed ? round(ev.cut.cut / ev.cut.feed, 3) : null, grid: [g.NX, g.NY] });
  return { ok: failures.length === 0, failures, checks, metrics };
}

/* ---------- native: a small runner over server/crates/tnc-engine (check_now), built into local/ ---------- */
function nativeRun(jobs) {
  const dir = join(ROOT, 'local', 'showcase-native');
  mkdirSync(join(dir, 'src'), { recursive: true });
  const dep = (c) => join(ROOT, 'server', 'crates', c).replace(/\\/g, '/');
  writeFileSync(join(dir, 'Cargo.toml'), `[package]\nname = "showcase-native"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[workspace]\n\n[dependencies]\ntnc-engine = { path = "${dep('tnc-engine')}" }\ntnc-formats = { path = "${dep('tnc-formats')}" }\nserde_json = "1"\n`);
  writeFileSync(join(dir, 'src', 'main.rs'), `// generated by scripts/showcase-verify.mjs: stdin = [{id, text, machine, tools}], stdout = [{id, report}]
use std::io::Read;
fn main() {
    let mut s = String::new(); std::io::stdin().read_to_string(&mut s).unwrap();
    let jobs: Vec<serde_json::Value> = serde_json::from_str(&s).unwrap();
    let out: Vec<serde_json::Value> = jobs.iter().map(|j| {
        let tools: Vec<tnc_formats::Tool> = serde_json::from_value(j["tools"].clone()).unwrap();
        let o = tnc_engine::Options { machine: j["machine"].as_str().unwrap().into(), tools, ..Default::default() };
        let text = j["text"].as_str().unwrap().to_string();
        let r = std::thread::Builder::new().stack_size(16 << 20).spawn(move || tnc_engine::check_now(&text, &o)).unwrap().join().unwrap();
        serde_json::json!({ "id": j["id"], "report": r })
    }).collect();
    println!("{}", serde_json::to_string(&out).unwrap());
}
`);
  const lock = join(ROOT, 'server', 'Cargo.lock');
  if (existsSync(lock) && !existsSync(join(dir, 'Cargo.lock'))) writeFileSync(join(dir, 'Cargo.lock'), readFileSync(lock));
  const b = spawnSync('cargo', ['build', '--release', '--quiet', '--manifest-path', join(dir, 'Cargo.toml')], { encoding: 'utf8' });
  if (b.status !== 0) return { error: 'cargo build failed: ' + String(b.stderr || b.error || '').trim().split('\n').slice(-6).join(' | ') };
  const meta = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(dir, 'Cargo.toml')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const exe = join(JSON.parse(meta.stdout).target_directory, 'release', 'showcase-native' + (process.platform === 'win32' ? '.exe' : ''));
  const run = spawnSync(exe, [], { input: JSON.stringify(jobs), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) return { error: 'native runner failed: ' + String(run.stderr || run.error || '').trim().slice(-400) };
  return { results: JSON.parse(run.stdout) };
}
/* the same numbers from the WASM run, for the comparison */
function wasmSummary(p) {
  const r = E.run(p.text, { tools: nativeTools(p.tools), machine: MACHINES[p.machine], holder: { stack: () => HOLDER_A } });
  let events = [];
  if (!r.errors.length) { const ex = E.SIM.expand(r); const on = E.STOCK.VICE.on; E.STOCK.VICE.on = true; events = E.SIM.analyse(r, ex, E.SIM.grid(r.stock, ex.segs)).filter((e) => e.sev === 'crash' || e.sev === 'warn'); E.STOCK.VICE.on = on; }
  const s = r.stats;
  return { errors: r.errors.map((e) => e.msg), events: events.map((e) => e.msg), move_count: s.moveCount, path_feed: s.pathFeed, path_rapid: s.pathRapid, cycle_time: s.cycleTime, min_z: s.minZ, max_z: s.maxZ, removed_volume: s.removedVolume };
}
/* the native check merges the given tools over the built-in table (as ui.js mtools does); the WASM side gets the same table */
const nativeTools = (mine) => { const by = new Map(E.TOOLS.map((t) => [t.t, { t: t.t, name: t.name, l: t.l, r: t.r }])); for (const t of mine) by.set(t.t, t); return [...by.values()].sort((a, b) => a.t - b.t); };
function compareNative(jobs) {
  const n = nativeRun(jobs.map((j) => ({ id: j.key, text: j.text, machine: j.machine, tools: j.tools })));
  if (n.error) return { ran: false, reason: n.error };
  const out = {};
  for (const j of jobs) {
    const rep = n.results.find((x) => x.id === j.key).report, w = wasmSummary(j), diffs = [];
    const same = (a, b) => (a === b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)));
    for (const k of ['move_count', 'path_feed', 'path_rapid', 'cycle_time', 'min_z', 'max_z', 'removed_volume']) if (!same(w[k], rep.stats[k])) diffs.push(`${k}: wasm ${w[k]} native ${rep.stats[k]}`);
    if (JSON.stringify(w.errors) !== JSON.stringify(rep.errors.map((e) => e.msg))) diffs.push('errors differ');
    if (JSON.stringify(w.events) !== JSON.stringify(rep.events.map((e) => e.msg))) diffs.push('events differ');
    out[j.key] = { agree: diffs.length === 0, nativeOk: rep.ok, interpreter: rep.interpreter, diffs };
  }
  return { ran: true, results: out };
}

export function loadManifest() { return JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')); }

/* All sixteen, on every machine each one lists. opts: {native, write}. */
export function verifyAll(opts = {}) {
  const manifest = loadManifest(), wasmSha = sha(readFileSync(WASM)), date = new Date().toISOString().slice(0, 10);
  const prev = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : null;
  const programs = [], jobs = [];
  for (const m of manifest.programs) {
    const file = join(DIR, m.file), failures = [], runs = {};
    if (!existsSync(file)) { programs.push({ id: m.id, file: m.file, ok: false, failures: ['file missing'], runs }); continue; }
    const text = readFileSync(file, 'utf8');
    if (sha(text) !== m.sha256) failures.push('manifest sha256 is stale: run node scripts/showcase-gen.mjs');
    if (m.machine !== m.machines[0]) failures.push('machine is not the first of machines');
    for (const machine of m.machines) {
      const res = checkProgram({ text, machine, tools: m.tools, stock: m.stock, expected: m.expected });
      runs[machine] = res; for (const f of res.failures) failures.push(`[${machine}] ${f}`);
      jobs.push({ key: m.id + '@' + machine, id: m.id, text, machine, tools: m.tools });
    }
    programs.push({ id: m.id, file: m.file, sha256: sha(text), ok: failures.length === 0, failures, runs });
  }
  let native;
  if (opts.native) native = { ...compareNative(jobs), date, wasmSha256: wasmSha };
  else if (prev?.native?.ran && prev.native.wasmSha256 === wasmSha && programs.every((p) => prev.programs.find((q) => q.id === p.id)?.sha256 === p.sha256)) native = prev.native;   // same programs, same engine: the earlier comparison still holds
  else native = { ran: false, reason: 'not requested in this run (node scripts/showcase-verify.mjs --native)' };
  if (native.ran) for (const p of programs) for (const machine of Object.keys(p.runs)) { const a = native.results[p.id + '@' + machine]; if (!a?.agree) { p.ok = false; p.failures.push(`[${machine}] native and WASM disagree: ${a ? a.diffs.join('; ') : 'no native result'}`); } }
  const report = { schema: 1, generatedOn: date, node: process.version, platform: process.platform, engine: { path: 'sim/engine/tnc_core.wasm via sim/engine.js', wasmSha256: wasmSha, holderA: HOLDER_A, vice: true },
    ok: programs.every((p) => p.ok), passed: programs.filter((p) => p.ok).length, total: programs.length, native, programs };
  if (opts.write !== false) {
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
    JSON.parse(readFileSync(REPORT, 'utf8'));
    for (const m of manifest.programs) {
      const p = programs.find((q) => q.id === m.id);
      m.validation = { ok: p.ok, verifiedOn: date, engineWasmSha256: wasmSha, report: 'artifacts/showcase/report.json', failures: p.failures,
        native: native.ran ? { compared: true, date: native.date, agree: Object.keys(p.runs).every((k) => native.results[p.id + '@' + k] && native.results[p.id + '@' + k].agree) } : { compared: false },
        machines: Object.fromEntries(Object.entries(p.runs).map(([k, v]) => [k, { ok: v.ok, errors: v.metrics.errors.length, collisions: (v.metrics.events || []).filter((e) => e.sev === 'crash').length,
          warnings: (v.metrics.events || []).filter((e) => e.sev === 'warn').length, cycleTimeS: v.metrics.cycleTimeS, removedCm3: v.metrics.removedCm3, cutMinZ: v.metrics.cutMinZ,
          cutEnvelope: v.metrics.cutEnvelope, travel: v.metrics.travel, moves: v.metrics.moves, toolsUsed: v.metrics.toolsUsed }])) };
    }
    writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  }
  return report;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === join(process.argv[1]).toLowerCase();
if (isMain) {
  const report = verifyAll({ native: process.argv.includes('--native'), write: !process.argv.includes('--no-write') });
  for (const p of report.programs) {
    const m = Object.entries(p.runs).map(([k, v]) => `${k}: ${v.metrics.cycleTimeS ?? '-'} s, ${v.metrics.removedCm3 ?? '-'} cm3`).join(' | ');
    console.log((p.ok ? '  ok    ' : '  FAIL  ') + p.file.padEnd(24) + m);
    for (const f of p.failures) console.log('          ' + f);
  }
  console.log(report.native.ran ? `native: compared, ${Object.values(report.native.results).filter((r) => r.agree).length} of ${Object.keys(report.native.results).length} runs agree with WASM (${report.native.date})` : 'native: ' + report.native.reason);
  console.log(`showcase: ${report.passed} of ${report.total} pass` + (process.argv.includes('--no-write') ? '' : ', report ' + REPORT));
  process.exit(report.ok ? 0 : 1);
}
