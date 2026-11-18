/* The sixteen showcase programs (examples/showcase) run through the engine the browser uses, on every machine each
   one lists, with the tools its manifest entry declares. Checks per program: no errors, M2 reached and tool
   retracted, tools declared and used, no crash / warning / through-cut event, safe travel, cutting inside the blank
   and inside the expected envelope and depth, material removed, cycle time. Writes artifacts/showcase/report.json
   and the manifest's validation blocks. First the checker itself is proven: green on a known-good program, red on
   seven broken ones (each for the reason it was broken).
     node tests/showcase.js            WASM (sim/engine/tnc_core.wasm via sim/engine.js)
     node tests/showcase.js --native   also compares with the native engine (cargo builds a small runner)        */
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'examples', 'showcase');
let fails = 0;
const ok = (c, m, d) => { console.log((c ? '  ok    ' : '  FAIL  ') + m + (c || !d ? '' : '  (' + d + ')')); if (!c) fails++; };

(async () => {
  const V = await import(pathToFileURL(path.join(ROOT, 'scripts', 'showcase-verify.mjs')).href);
  const G = await import(pathToFileURL(path.join(ROOT, 'scripts', 'showcase-gen.mjs')).href);

  console.log('The checker on fixtures');
  const T5 = { t: 5, name: 'ENDMILL_12', l: 88.75, r: 6 }, T4 = { t: 4, name: 'ENDMILL_6', l: 64.1, r: 3 };
  const stock = { x: [0, 100], y: [0, 100], z: [-20, 0] };
  const good = ['BEGIN PGM FIX MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+100 Z+0', 'TOOL CALL 5 Z S2500', 'L Z+50 R0 FMAX M3',
    'L X+20 Y+50 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-3 R0 F200', 'L X+80 R0 F600', 'L Z+50 R0 FMAX', 'L Z+100 R0 FMAX M5', 'L Z+150 R0 FMAX M2', 'END PGM FIX MM'].join('\n');
  const fx = (text, tools) => V.checkProgram({ text, machine: '426', tools: tools || [T5], stock, expected: { cutMinZ: -3, cutEnvelope: { x: [20, 80], y: [50, 50] }, minRemovedCm3: 1 } });
  const g = fx(good);
  ok(g.ok, 'a known-good program passes every check', g.failures.join('; '));
  const red = (name, text, check, tools) => { const r = fx(text, tools); ok(!r.ok && r.checks[check] === false, name + ' fails "' + check + '"', 'ok ' + r.ok + ', failures: ' + r.failures.join('; ')); };
  red('a TOOL CALL for a tool that is not declared', good.replace('TOOL CALL 5', 'TOOL CALL 7'), 'noErrors');
  red('a rapid into the material', good.replace('L Z-3 R0 F200', 'L Z-3 R0 FMAX'), 'noCollision');
  red('a program that only cuts air', good.replace('L Z-3 R0 F200', 'L Z+1 R0 F200'), 'removal');
  red('a program without M2', good.replace(' M2', ''), 'completed');
  red('a cut through the blank bottom', good.replace('L Z-3 R0 F200', 'L Z-21 R0 F200'), 'insideBlankDepth');
  red('a rapid across the blank below the clearance height', good.replace('L X+80 R0 F600', 'L Z+0.5 R0 F600\nL X+80 R0 FMAX'), 'safeTravel');
  red('a tool change close to the part', good.replace('L Z+50 R0 FMAX\nL Z+100', 'L Z+5 R0 FMAX\nTOOL CALL 4 Z S3000\nL X+20 R0 F600 M3\nL Z+50 R0 FMAX\nL Z+100'), 'safeTravel', [T5, T4]);
  red('a cut outside the expected envelope', good.replace('L X+80 R0 F600', 'L X+90 R0 F600'), 'expectedEnvelope');
  red('a declared tool that is never used', good, 'toolsUsed', [T5, T4]);

  console.log('The files');
  const manifest = V.loadManifest(), NAMES = ['01_NAMEPLATE', '02_STEPPED_POCKET', '03_SPIRAL_POCKET', '04_BOLT_CIRCLE', '05_POLAR_STAR', '06_ROUNDED_PLATE', '07_HELIX_BORE', '08_CONTOUR_ISLAND',
    '09_GEAR_OUTLINE', '10_COOLANT_SWEEP', '11_Q_PATTERN', '12_SUBPROGRAM_GRID', '13_RADIUS_COMP', '14_MULTI_TOOL', '15_430_SWIVEL', '16_5511_SHOWCASE'];
  ok(JSON.stringify(manifest.programs.map((p) => p.id)) === JSON.stringify(NAMES), 'the manifest lists the sixteen programs by their names');
  const onDisk = fs.readdirSync(DIR).filter((n) => /\.H$/.test(n)).sort();
  ok(JSON.stringify(onDisk) === JSON.stringify(NAMES.map((n) => n + '.H')), 'examples/showcase holds exactly those sixteen .H files', onDisk.join(' '));
  const built = G.build();
  const stale = Object.entries(built.files).filter(([n, t]) => !fs.existsSync(path.join(DIR, n)) || fs.readFileSync(path.join(DIR, n), 'utf8').replace(/\r\n/g, '\n') !== t).map(([n]) => n);
  ok(stale.length === 0, 'every .H file is what scripts/showcase-gen.mjs generates', stale.join(' '));
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  const bad = manifest.programs.filter((p) => !(str(p.title?.sv) && str(p.title?.en) && str(p.description?.sv) && str(p.description?.en) && p.units === 'MM'
    && Array.isArray(p.machines) && p.machines.length && p.stock && Array.isArray(p.tools) && p.tools.length && p.expected && Array.isArray(p.expected.features) && p.expected.features.length
    && Array.isArray(p.cycles) && Array.isArray(p.substitutions) && str(p.thumbnail))).map((p) => p.id);
  ok(bad.length === 0, 'every entry has title and description in Swedish and English, machines, stock, units, tools, expected features, cycles, substitutions, thumbnail', bad.join(' '));
  const polar = fs.readFileSync(path.join(DIR, '05_POLAR_STAR.H'), 'utf8');
  ok(/^CC X\+50 Y\+50$/m.test(polar) && (polar.match(/^LP PR\+\d+(\.\d+)? PA[+-]\d+/gm) || []).length >= 10, '05_POLAR_STAR is written with CC and LP PR / PA blocks');
  ok(/^CYCL DEF 19\.1 A\+0 B-30 C\+0$/m.test(fs.readFileSync(path.join(DIR, '15_430_SWIVEL.H'), 'utf8')) && JSON.stringify(manifest.programs[14].machines) === '["430"]', '15_430_SWIVEL tilts the head with cycle 19 and is listed for the 430 only');
  ok(/not a certified involute gear/i.test(manifest.programs[8].description.en) && /inte ett certifierat evolventkugghjul/i.test(manifest.programs[8].description.sv), '09_GEAR_OUTLINE says it is not a certified involute gear');
  const thumbs = manifest.programs.filter((p) => { const f = path.join(DIR, p.thumbnail); if (!fs.existsSync(f)) return true; const b = fs.readFileSync(f);
    return !(b.length > 2000 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(16) === 640 && b.readUInt32BE(20) === 400); }).map((p) => p.id);
  ok(thumbs.length === 0, 'every program has a 640 x 400 PNG thumbnail (node scripts/showcase-thumbs.mjs)', thumbs.join(' '));

  console.log('The sixteen programs on the engine');
  const report = V.verifyAll({ native: process.argv.includes('--native') });
  for (const p of report.programs) {
    const m = Object.entries(p.runs).map(([k, v]) => `${k}: ${v.metrics.cycleTimeS ?? '-'} s, ${v.metrics.removedCm3 ?? '-'} cm3`).join(' | ');
    ok(p.ok, p.file.padEnd(22) + ' ' + m, p.failures.join('; '));
  }
  if (report.native.ran) { const r = Object.values(report.native.results); ok(r.every((x) => x.agree), `native engine agrees with WASM on ${r.filter((x) => x.agree).length} of ${r.length} runs (compared ${report.native.date})`); }
  else if (process.argv.includes('--native')) ok(false, 'native comparison', report.native.reason);
  else console.log('  note  native comparison not run now: ' + report.native.reason);
  const back = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', 'showcase', 'report.json'), 'utf8'));
  ok(back.total === 16 && back.programs.length === 16 && back.ok === report.ok, 'artifacts/showcase/report.json is written and reads back');
  console.log(fails ? `\nshowcase: ${fails} FAILED` : `\nshowcase: ALL PASS (${report.passed} of ${report.total} programs, report artifacts/showcase/report.json)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
