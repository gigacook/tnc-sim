/* No credential in the browser: fails when a shipped simulator source reads or writes a key in browser storage,
   bakes one into a page, or brings back a key field outside the one view that sends it to the server.
   Scans sim/*.js, sim/sim-shell.html and build.py (the sources), then the built pages when they exist.
   node tests/ai/no-browser-key.js */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0, n = 0;
const ok = (c, m, d) => { n++; if (!c) { fails++; console.log('  FAIL  ' + m + (d && d.length ? '\n          ' + d.slice(0, 8).join('\n          ') : '')); } else console.log('  ok    ' + m); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sources = fs.readdirSync(path.join(ROOT, 'sim')).filter((f) => /\.(js|html)$/.test(f)).map((f) => 'sim/' + f).concat(['build.py']);
const built = ['index.html', 'docs/index.html'].filter((f) => fs.existsSync(path.join(ROOT, f)));
const VIEW = 'sim/aigen.js';
const hits = (files, re, skip) => files.flatMap((f) => read(f).split('\n').map((l, i) => (re.test(l) && !(skip && skip(f, l)) ? `${f}:${i + 1}  ${l.trim().slice(0, 110)}` : null)).filter(Boolean));

/* what a storage call looks like in these sources: the Web Storage API, the wrappers ui.js / settings.js define, IndexedDB helpers */
const STORE = String.raw`(?:localStorage|sessionStorage|\blocal|\bsess|\bst|\bls|idbKeyval|\bidb)\s*\.\s*`;
const SECRET = String.raw`(?:or_?key|api_?key|openrouter|secret|bearer|password|credential|\bKEY_LS\b|\btoken\b)`;
const readOrWrite = new RegExp(STORE + String.raw`(?:getItem|setItem|get|set)\s*\([^)]*` + SECRET, 'i');
const viaHelper = new RegExp(String.raw`\b(?:lsGet|lsSet)\s*\([^)]*` + SECRET, 'i');

ok(sources.includes(VIEW) && sources.includes('sim/ui.js') && sources.includes('sim/ai.js') && sources.length > 15, `the simulator sources are found (${sources.length} files)`);
let found = hits(sources, readOrWrite).concat(hits(sources, viaHelper));
ok(found.length === 0, 'no source reads or writes a key in browser storage', found);
found = hits(sources.concat(built), /TNC_AI_LOCAL_KEY/);
ok(found.length === 0, 'no source and no built page mentions TNC_AI_LOCAL_KEY', found);
found = hits(['build.py'], /index\.local\.html|OPENROUTER_API_KEY[^\n]*json\.dumps|window\.\w*KEY\w*\s*=/);
ok(found.length === 0, 'build.py writes no page with a key in it (no index.local.html)', found);
ok(!fs.existsSync(path.join(ROOT, 'index.local.html')), 'no index.local.html lies in the repo folder');
/* the storage name an older build used: only the one line that deletes it may name it, and only with removeItem */
found = hits(sources, /tnc426\.orkey|\bKEY_LS\b/, (f) => f === VIEW);
ok(found.length === 0, 'the old browser key name is gone from every source but the view that deletes it', found);
const view = read(VIEW);
ok(/BROWSER_KEY_NAMES = \['tnc426\.orkey'\]/.test(view) && /BROWSER_KEY_NAMES\.forEach\([^\n]*st\.removeItem\(n\)/.test(view), 'the view deletes a key an older build left in this browser');
const uses = view.split('\n').filter((l) => /BROWSER_KEY_NAMES/.test(l) && !/^\s*(var BROWSER_KEY_NAMES|\/\*)/.test(l) && !/removeItem\(n\)/.test(l) && !/BROWSER_KEY_NAMES: BROWSER_KEY_NAMES/.test(l));
ok(uses.length === 0, 'that name is used for nothing but the deletion (never read, never sent)', uses);
const writes = view.split('\n').filter((l) => /\.setItem\(|\.getItem\(/.test(l) && !/MODEL_PICK/.test(l));
ok(writes.length === 0, 'the view stores one thing in the browser: the picked model id', writes);
/* a key field: only in the view, and its value goes to one place */
found = hits(sources, /type\s*[=:]\s*["']password["']/, (f) => f === VIEW);
ok(found.length === 0, 'no key or password field outside the AI view', found);
ok((view.match(/keyInput\.value/g) || []).length === 2 && /ctl\.saveKey\(keyInput\.value\)/.test(view) && /keyInput\.value = ''/.test(view), 'the key field\'s value is read once (sent to the server) and cleared once');
ok(!/console\.(log|info|debug|error)\(/.test(view) && (view.match(/console\.warn\(/g) || []).length === 1, 'the view logs one fixed warning and nothing else');
/* nothing sends a browser-held key to OpenRouter from ui.js any more */
found = hits(['sim/ui.js', 'sim/sim-shell.html'], /\bgetKey\s*\(|storeKey\s*\(|ai-key\b|ai-remember|Remember the key|AI\.testKey|key\s*:\s*key\b/);
ok(found.length === 0, 'ui.js and the shell hold no key field, no key reader and no key test', found);
found = hits(built, /tnc426\.orkey['"]\s*[,)]\s*(?!\])|sessionStorage\.setItem\([^)]*orkey|local\.set\(KEY_LS/).filter((l) => !/BROWSER_KEY_NAMES/.test(l));
ok(found.length === 0, `the built pages (${built.join(', ') || 'none built'}) hold no key storage code`, found);

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fails ? 1 : 0);
