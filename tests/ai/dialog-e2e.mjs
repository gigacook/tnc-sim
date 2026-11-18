/* The AI view of the New program dialog, in a real browser against the real server and a MOCK PROVIDER
   (tests/ai/server-mock-provider.mjs): no real network, no key that works anywhere, no credit.

   Build first:  cargo build --manifest-path server/Cargo.toml -p tnc-server   and   python build.py
   Run:          node tests/ai/dialog-e2e.mjs
   Chromium: PW_CHROMIUM=<chrome executable>, else Playwright's own. One headless browser, closed at the end.
   The page under test is the built index.html with the CURRENT sim/aigen.js put in place of the built copy (so an
   edit to the module is tested without a rebuild); it is written to a temp folder, never into the repo.
   Ports: the machine's port catalog (range "dev") when installed, else the OS; 127.0.0.1 only.
   Screenshots: artifacts/business/ai-*.png (1920x1080 and 390x844). */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MOCK_KEY, startMock } from './server-mock-provider.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(ROOT, 'artifacts', 'business');
const EXE = process.platform === 'win32' ? 'tnc-server.exe' : 'tnc-server';
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
let failures = 0;
const check = (c, m, d) => { if (!c) failures++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}${c || d === undefined ? '' : `  (${typeof d === 'string' ? d : JSON.stringify(d)})`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- the harness of tests/ai/server-job.mjs ---------- */
function serverBin() {
  const tries = [process.env.TNC_SERVER_BIN, process.env.CARGO_TARGET_DIR && path.join(process.env.CARGO_TARGET_DIR, 'debug', EXE), path.join(ROOT, 'server', 'target', 'debug', EXE)].filter(Boolean);
  const found = tries.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`tnc-server binary not found (looked in ${tries.join(', ')}). Build it: cargo build --manifest-path server/Cargo.toml -p tnc-server`);
  return found;
}
function catalogPort() {
  const script = path.join(os.homedir(), 'gigacook', 'core', 'infra', 'scripts', 'catalog.mjs');
  if (!fs.existsSync(script)) return 0;
  try {
    const n = Number(execFileSync(process.execPath, [script, '--free', 'dev'], { encoding: 'utf8' }).trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch { return 0; }
}
async function osPort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}
async function until(what, cond, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await sleep(40); }
  check(false, `timed out waiting for: ${what}`);
  return false;
}

/* ---------- programs (as in server-job.mjs) ---------- */
const fence = (s) => `\`\`\`klartext\n${s}\n\`\`\``;
const GOOD = ['BEGIN PGM SLOT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+100 Z+0', '; slot with the Ø12 cutter', 'TOOL CALL 5 Z S3000', 'L Z+50 R0 FMAX M3',
  'L X+10 Y+10 R0 FMAX', 'L Z-2 R0 F200', 'L X+90 F500', 'L Z+50 R0 FMAX M2', 'END PGM SLOT MM'].join('\n');
const BAD = ['BEGIN PGM SLOT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+100 Z+0', 'TOOL CALL 5 Z S3000', 'L X+50 Y+50 Z+50 R0 FMAX M3', 'L Z-10 R0 FMAX', 'L Z+50 R0 FMAX M2', 'END PGM SLOT MM'].join('\n');
/* the slot GOOD cuts. w = 0.5 mm under the diameter of tool 5 in the simulator's own tool table (read from the page):
   on its 0.8 mm grid TNC_PART.compare scores the exact diameter 88.7 and this 99.5 (measured with node, same program) */
const specFor = (w) => ({ blank: { x: [0, 100], y: [0, 100], z: [-20, 0] }, features: [{ id: 'S1', type: 'slot', from: [10, 10], to: [90, 10], w, z: -2 }] });
const MODEL = 'mock/fast-one-v2';

/* ---------- the page under test: index.html with the current sim/aigen.js ---------- */
function pageWithModule(dir) {
  const built = path.join(ROOT, 'index.html');
  if (!fs.existsSync(built)) throw new Error('index.html is not built: run python build.py');
  let html = fs.readFileSync(built, 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'sim', 'aigen.js'), 'utf8');
  const tag = `<script type="text/x-tnc-deferred">/* ===== AI view under test (sim/aigen.js) ===== */\n${src}\n</script>\n`;
  const had = /<script type="text\/x-tnc-deferred">\/\* ===== [^\n]*\n\/\* =+\n {3}TNC_AIGEN[\s\S]*?<\/script>\n/;
  const ui = '<script type="text/x-tnc-deferred">/* ===== Simulator UI ===== */';
  if (had.test(html)) html = html.replace(had, () => tag);
  else if (html.includes(ui)) html = html.replace(ui, () => tag + ui);
  else throw new Error('index.html has no "Simulator UI" module to put the AI view in front of');
  const file = path.join(dir, 'sim.html');
  fs.writeFileSync(file, html);
  return { file, inBuild: had.test(fs.readFileSync(built, 'utf8')) };
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnc-ai-e2e-'));
let mock = null, proc = null, browser = null, serverLog = '';
try {
  fs.mkdirSync(SHOTS, { recursive: true });
  const sim = pageWithModule(dataDir);
  console.log(`page: index.html ${sim.inBuild ? 'already lists aigen.js; its copy was replaced by' : 'does not list aigen.js yet; added'} the current sim/aigen.js`);
  mock = await startMock(catalogPort());
  const port = catalogPort() || (await osPort());
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  Object.assign(env, { TNC_BIND: `127.0.0.1:${port}`, TNC_DATA_DIR: dataDir, TNC_WEB_DIR: path.join(dataDir, 'no-web'), TNC_SIM_FILE: sim.file,
    TNC_OPENROUTER_BASE: mock.url, TNC_AI_DEFAULT_MODEL: MODEL, TNC_AI_MODELS: '', TNC_AI_MAX_TOKENS: '0', TNC_AI_MONTHLY_BUDGET_USD: '5',
    TNC_AI_RETRY_DELAY_MS: '50', TNC_AI_IDLE_TIMEOUT_MS: '20000', TNC_AI_MEASURE_TIMEOUT_MS: '10000', TNC_AI_JOB_TIMEOUT_MS: '60000', RUST_LOG: 'tnc_server=debug' });
  proc = spawn(serverBin(), ['serve'], { env, cwd: dataDir, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { serverLog += d; });
  proc.stderr.on('data', (d) => { serverLog += d; });
  if (!(await until('the server to answer /api/health', async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, 20000))) throw new Error(serverLog.slice(-800));
  console.log(`server ${base} · mock provider ${mock.url}`);

  browser = await pw.chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const outside = [], jobs = [], measurements = [], errors = [];
  await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith(base) || u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); outside.push(u); return route.abort(); });
  const signup = await ctx.request.post(`${base}/api/v1/auth/signup`, { data: { email: 'admin@shop.test', name: 'Admin', password: 'correct horse' } });
  check(signup.status() === 201, 'signed up on the test server (session cookie in the browser)', signup.status());
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
  page.on('request', (q) => { if (q.method() === 'POST' && /\/ai\/jobs$/.test(q.url())) jobs.push(q.postDataJSON()); if (/\/measurement$/.test(q.url())) measurements.push(q.postDataJSON()); });
  const boot = async (url) => { await page.goto(url); await page.waitForSelector('#b-new'); await page.waitForFunction(() => window.TNC_UI?.state.res, null, { timeout: 30000 }); await page.waitForTimeout(300); if (await page.locator('#setup:not([hidden])').count()) await page.click('#setup-skip'); };
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `ai-${name}.png`) });
  const txt = (sel) => page.locator(sel).innerText();
  const vis = (sel) => page.locator(sel).isVisible();
  const leaks = () => page.evaluate((k) => ({ dom: document.documentElement.outerHTML.includes(k), ls: JSON.stringify(Object.entries(localStorage)).includes(k), ss: JSON.stringify(Object.entries(sessionStorage)).includes(k),
    fields: [...document.querySelectorAll('input,textarea')].some((i) => i.value.includes(k)) }), MOCK_KEY);
  /* every control of the view that can be pressed or typed in: at least 44 x 44 CSS px */
  const small = () => page.evaluate(() => [...document.querySelectorAll('#aigen button, #aigen input, #aigen textarea')].filter((n) => n.checkVisibility()).map((n) => { const r = n.getBoundingClientRect(); return { id: n.id || n.textContent.slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.w < 44 || r.h < 44));

  await boot(`${base}/sim/?edition=business`);
  check(await page.evaluate(() => !!window.TNC_BACKEND && !!window.TNC_AIGEN && !!window.TNC_AIGEN.controller()), 'the simulator is served by the server and the AI view is mounted');
  await page.evaluate(() => { localStorage.setItem('tnc426.orkey', 'browser-stored-value'); sessionStorage.setItem('tnc426.orkey', 'tab-stored-value'); });
  await boot(`${base}/sim/?edition=business`);
  check(await page.evaluate(() => localStorage.getItem('tnc426.orkey') === null && sessionStorage.getItem('tnc426.orkey') === null), 'a key an older build kept in this browser is deleted on load');
  const before = await page.evaluate(() => ({ name: window.TNC_UI.program.name, text: window.TNC_UI.program.text, count: Object.keys(window.TNC_UI.state.pgms[window.TNC_UI.state.machine]).length }));

  /* --- no key --- */
  await page.click('#b-new'); await page.click('#new-t-ai');
  await page.waitForSelector('#aigen-key', { state: 'visible' });
  check(/har raderats härifrån/.test(await txt('#aigen-notice')), 'one notice says the browser key was deleted and the key now lives on the server', await txt('#aigen-notice'));
  check((await txt('#aigen-keyform label')).trim() === 'OpenRouter-nyckel', 'no key: the top field is labelled "OpenRouter-nyckel"', await txt('#aigen-keyform label'));
  check(await page.evaluate(() => document.activeElement.id === 'aigen-key' && document.activeElement.type === 'password'), 'no key: the cursor is in the key field (a password field)');
  check(await page.evaluate(() => document.querySelector('#aigen').firstElementChild.id === 'aigen-offline' && document.querySelector('#aigen-keyform').compareDocumentPosition(document.querySelector('#aigen-prompt')) === 4), 'no key: the key field is above the prompt');
  check((await page.locator('#ai-prompt, #ai-go, #ai-mp, #ai-mode, #ai-key, #ai-keypill, #ai-setup').count()) === 0, 'the old AI popup is gone from the page');
  check((await txt('#aigen-go')) === 'GENERERA' && /OpenRouter \(tredje part\)/.test(await txt('#aigen-disclosure')), 'one primary action GENERERA with the OpenRouter line next to it', await txt('#aigen-disclosure'));
  check(await page.evaluate(() => !document.querySelector('#aigen select, #aigen input[type=number], #aigen input[type=checkbox], #aigen input[type=range]')), 'no thinking, token, measurement or round controls');
  await page.fill('#aigen-prompt', 'Platta med ett spår');
  await page.click('#aigen-go');
  await page.waitForTimeout(400);
  check(jobs.length === 0 && mock.chat().length === 0, 'no key: GENERERA sends no job', jobs.length);
  check(/Ingen OpenRouter-nyckel/.test(await txt('#aigen-error')), 'no key: the error says where the key goes', await txt('#aigen-error'));
  await shot('nokey-1920x1080');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  check((await small()).length === 0, '390 px: every control is at least 44 x 44', await small());
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390 px: no sideways scroll');
  await shot('nokey-390x844');
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(200);
  check((await small()).length === 0, '1920 px: every control is at least 44 x 44', await small());

  /* --- the key goes to the server, the field goes away --- */
  await page.focus('#aigen-key');
  await page.keyboard.type(MOCK_KEY);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#aigen-key', { state: 'detached' });
  check(!(await vis('#aigen-keyform')) && (await page.locator('#aigen input[type=password]').count()) === 0, 'key accepted: the field is cleared and gone');
  check(/lagrad på servern/.test(await txt('#aigen-notice')), 'key accepted: said in words', await txt('#aigen-notice'));
  check(fs.readFileSync(path.join(dataDir, 'openrouter.key'), 'utf8') === MOCK_KEY, 'key accepted: it is in the server\'s key file');
  const l1 = await leaks();
  check(!l1.dom && !l1.ls && !l1.ss && !l1.fields, 'the key is not in the page, not in localStorage, not in sessionStorage', l1);
  check(await page.evaluate(() => document.activeElement.id === 'aigen-prompt'), 'after the key the cursor is in the prompt');

  /* --- models --- */
  await page.waitForSelector('#aigen-list .ag-m');
  check((await page.locator('#aigen-list .ag-m').allInnerTexts()).join('|') === 'Fast One v2|Small Context|Plain Writer', 'models: short names, live models only', await page.locator('#aigen-list .ag-m').allInnerTexts());
  check(/Vald modell: Fast One v2/.test(await txt('#aigen-selected')), 'models: the selected model is shown', await txt('#aigen-selected'));
  const det = (await txt('#aigen-det')).replace(/ /g, ' ');
  check(det.includes('mock/fast-one-v2') && det.includes('MOCK: Fast One v2'), 'details: the routable id apart from the label, and the full name', det);
  check(det.includes('1 000 000 tokens') && det.includes('32 768 tokens (begärt 131 072)'), 'details: context and the effective output limit 32768 of the requested 131072', det);
  check(det.includes('$0.05 / $0.20 per 1M tokens'), 'details: the price per 1M tokens', det);
  check(/resonemang: medel · verktyg: ja · strömning: ja/.test(det) && !/fast (&|and) cheap|snabb (&|och) billig/i.test(await txt('#aigen')), 'details: capabilities; no "fast & cheap" claim', det);
  await page.fill('#aigen-q', 'small');
  check((await page.locator('#aigen-list .ag-m').allInnerTexts()).join('|') === 'Small Context' && /1 av 3/.test(await txt('#aigen-cat')), 'search: one match of three', await txt('#aigen-cat'));
  await page.hover('#aigen-list .ag-m');
  check((await txt('#aigen-det')).includes('mock/small-context'), 'details open on hover');
  await page.mouse.move(5, 5);
  check((await txt('#aigen-det')).includes('mock/fast-one-v2'), 'details go back to the selected model');
  await page.fill('#aigen-q', '');
  await page.focus('#aigen-list .ag-m[aria-checked="true"]');
  await page.keyboard.press('ArrowDown');
  check((await txt('#aigen-det')).includes('mock/small-context') && /Small Context/.test(await txt('#aigen-selected')), 'details open on keyboard focus; arrows pick');
  await page.locator('#aigen-list .ag-m', { hasText: 'Plain Writer' }).tap().catch(() => page.locator('#aigen-list .ag-m', { hasText: 'Plain Writer' }).click());
  check((await txt('#aigen-det')).includes('mock/no-reasoning') && /resonemang: nej/.test(await txt('#aigen-det')), 'details open on tap / click', await txt('#aigen-det'));
  await page.locator('#aigen-list .ag-m', { hasText: 'Fast One v2' }).click();

  /* --- the prompt is kept as a draft over a reload; with a key on the server the key field never comes back --- */
  await page.fill('#aigen-prompt', 'Utkast som ska finnas kvar');
  await boot(`${base}/sim/?edition=business`);
  await page.click('#b-new'); await page.click('#new-t-ai');
  await page.waitForSelector('#aigen-list .ag-m');
  check((await page.inputValue('#aigen-prompt')) === 'Utkast som ska finnas kvar', 'the typed prompt survives a reload (autosave draft)', await page.inputValue('#aigen-prompt'));
  check((await page.locator('#aigen input[type=password]').count()) === 0 && !(await vis('#aigen-keyform')) && (await page.evaluate(() => document.activeElement.id)) === 'aigen-prompt', 'key present: no key field, the cursor is in the prompt');
  check(await vis('#aigen-keyrm'), 'key present: the stored key can be removed from the server from here');

  /* --- languages --- */
  await page.evaluate(() => window.TNC_SETTINGS.set('lang', 'en')); await page.waitForTimeout(150);
  check((await txt('#aigen-go')) === 'GENERATE' && (await txt('#aigen-det')).includes('$0.05 / $0.20 per 1M tokens') && /a third party/.test(await txt('#aigen-disclosure')), 'English: GENERATE, $0.05 / $0.20 per 1M tokens', await txt('#aigen-go'));
  await page.evaluate(() => window.TNC_SETTINGS.set('lang', 'sr')); await page.waitForTimeout(150);
  check((await txt('#aigen-go')) === 'GENERIŠI' && (await txt('#aigen-det')).includes('$0.05 / $0.20 na 1M tokena') && /Opišite deo/.test(await txt('#aigen-main')), 'Serbian: GENERIŠI, the same numbers', await txt('#aigen-go'));
  await page.evaluate(() => window.TNC_SETTINGS.set('lang', 'sv')); await page.waitForTimeout(150);

  /* --- generate, see stages, cancel --- */
  mock.reset();
  mock.script.push({ text: `\`\`\`klartext\n${GOOD.slice(0, 150)}`, pieceLen: 20, hangKeepalive: true }, { text: fence(GOOD) });
  await page.locator('#aigen-ex button').first().click();
  check((await page.inputValue('#aigen-prompt')).startsWith('Platta 100x60'), 'an example fills the prompt');
  await page.keyboard.press('Tab');   // from the prompt on to the examples: the whole flow has a keyboard path
  await page.focus('#aigen-go');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#aigen-cancel', { state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#aigen-steps li') && document.querySelector('#aigen-text').textContent.includes('BLK FORM'));
  check(jobs.length === 1 && jobs[0].model === MODEL && jobs[0].client_measure === true && typeof jobs[0].system === 'string' && jobs[0].system.length > 2000 && !('max_tokens' in jobs[0]) && !('reasoning' in jobs[0]), 'the job: routable model id, the simulator\'s system prompt, no policy fields', Object.keys(jobs[0] || {}));
  check(/▸ Generering \(pågår\)/.test(await txt('#aigen-steps')) && (await page.getAttribute('#aigen-steps li', 'aria-current')) === 'step', 'running: the stage is shown as a step, marked in words', await txt('#aigen-steps'));
  check(!/%/.test(await txt('#aigen-progress')), 'running: no percentage');
  check(!(await vis('#aigen-go')) && (await txt('#aigen-cancel')) === 'Avbryt' && (await page.evaluate(() => document.activeElement.id)) === 'aigen-cancel', 'running: GENERERA is gone, a compact Avbryt has the focus');
  check((await page.evaluate(() => window.TNC_UI.program.name)) === before.name && (await page.evaluate(() => window.TNC_UI.program.text)) === before.text, 'running: the active program is untouched');
  check((await small()).length === 0, 'running: every control is at least 44 x 44', await small());
  await shot('running-1920x1080');
  await page.keyboard.press('Enter');   // Avbryt
  await page.waitForSelector('#aigen-go', { state: 'visible' });
  check(/Avbrutet\. Inget laddades\./.test(await txt('#aigen-error')) && (await txt('#aigen-go')) === 'GENERERA' && (await page.getAttribute('#aigen-go', 'data-mode')) === 'generate', 'cancelled: said so, the primary action is GENERERA again (not Ladda)', await txt('#aigen-error'));
  check(/Utkast \(inte laddat\)/.test(await txt('#aigen-textbox')) && (await txt('#aigen-text')).includes('BEGIN PGM SLOT MM'), 'cancelled: the draft so far is kept and labelled as a draft');
  check(/× Generering \(avbruten\)/.test(await txt('#aigen-steps')), 'cancelled: the step shows it stopped', await txt('#aigen-steps'));
  await until('the provider to see the dropped connection', () => mock.chat()[0]?.aborted);
  await sleep(600);
  check(mock.chat().length === 1 && mock.script.length === 1 && jobs.length === 1, 'cancelled: no further request to the provider', mock.chat().length);
  check((await page.evaluate(() => window.TNC_UI.program.name)) === before.name && !(await page.evaluate(() => Object.keys(window.TNC_UI.state.pgms[window.TNC_UI.state.machine]).includes('SLOT.H'))), 'cancelled: nothing was loaded');

  /* --- generate again: a repair round, a measurement, success --- */
  const SPEC = specFor(await page.evaluate(() => 2 * window.TNC_UI.tools.get().find((x) => x.t === 5).r - 0.5));
  mock.reset();
  mock.script.push({ text: fence(BAD), keepalives: 2, reasoning: true, byteChunk: 11, pieceLen: 23 }, { text: `\`\`\`partspec\n${JSON.stringify(SPEC)}\n\`\`\`\n${fence(GOOD)}`, byteChunk: 13, pieceLen: 19 }, { text: fence(GOOD) }, { text: fence(GOOD) });
  await page.focus('#aigen-go');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#aigen-go')?.getAttribute('data-mode') === 'load' && !document.querySelector('#aigen-go').hidden, null, { timeout: 30000 }).catch(async (e) => { console.log(`the view when the wait gave up:
${await txt('#aigen-main')}
measurements posted: ${JSON.stringify(measurements).slice(0, 600)}
provider requests: ${mock.chat().length}`); throw e; });
  const steps = (await txt('#aigen-steps')).replace(/\s+/g, ' ');
  check(/✓ Generering \(klar\) ✓ Validering \(klar\) ✓ Mätning \(klar\) ✓ Förfining, omgång 1 av 5 \(klar\)/.test(steps) && /✓ Slutförande \(klar\)$/.test(steps.trim()), 'success: generation, validation, measurement, refinement round 1 of 5, completion', steps);
  check(measurements.length >= 1 && typeof measurements[0].request_id === 'string', 'measure-request: the browser posted to the measurement endpoint', measurements);
  const scored = measurements.find((m) => typeof m.score === 'number');
  check(!!scored && scored.score >= 95 && scored.score <= 100 && /MEASURED/.test(scored.text || ''), 'measure-request: the part measurement of sim/part.js ran on the draft (a score and its text)', measurements.map((m) => m.score));
  check(!/measurement_timeout/.test(serverLog) && !(await txt('#aigen')).includes('kom inte fram i tid'), 'measure-request: answered inside the server\'s timeout');
  check((await txt('#aigen-go')) === 'Ladda' && /klarade kontrollen/.test(await txt('#aigen-ok')) && (await page.evaluate(() => document.activeElement.id)) === 'aigen-go', 'success: the primary action is Ladda and has the focus', await txt('#aigen-ok'));
  check(/nytt program, SLOT\.H\./.test(await txt('#aigen-loadnote')) && (await txt('#aigen-loadnote')).includes(`${before.name} ligger kvar oförändrat`), 'success: one line says what Ladda does to the active program', await txt('#aigen-loadnote'));
  check((await txt('#aigen-text')) === GOOD, 'success: the validated program text is shown');
  check((await txt('#aigen-live')).length > 0 && (await page.getAttribute('#aigen-live', 'aria-live')) === 'polite', 'status changes go through a polite live region', await txt('#aigen-live'));
  check((await page.evaluate(() => window.TNC_UI.program.name)) === before.name && !(await page.evaluate(() => 'SLOT.H' in window.TNC_UI.state.pgms[window.TNC_UI.state.machine])), 'success: still nothing loaded before Ladda is pressed');
  check((await small()).length === 0, 'success: every control is at least 44 x 44', await small());
  await shot('done-1920x1080');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
  check((await small()).length === 0 && (await page.evaluate(() => { const r = document.querySelector('#aigen-go').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth; })), '390 px: Ladda is on screen at the bottom, 44 px targets, no sideways scroll', await small());
  await shot('done-390x844');
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(200);

  /* --- Load --- */
  await page.focus('#aigen-go');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('m-new').hidden);
  const after = await page.evaluate((prev) => { const ui = window.TNC_UI, all = ui.state.pgms[ui.state.machine]; return { name: ui.program.name, text: ui.program.text, prevText: all[prev], count: Object.keys(all).length, onScreen: document.body.innerText.includes('SLOT') }; }, before.name);
  check(after.name === 'SLOT.H' && after.text === GOOD && after.onScreen, 'Ladda: the generated program is the program on screen', after.name);
  check(after.prevText === before.text && after.count === before.count + 1, 'Ladda: the program that was active still exists, unchanged; one program was added', { count: after.count, was: before.count });
  await page.waitForTimeout(400);
  await shot('loaded-1920x1080');
  const l2 = await leaks();
  check(!l2.dom && !l2.ls && !l2.ss && !l2.fields && !after.text.includes(MOCK_KEY), 'the key is nowhere in the page, the storage or the program at the end', l2);
  check(await page.evaluate(() => Object.keys(localStorage).every((k) => !/key|token|secret/i.test(k) || k === 'tnc.settings.v1')), 'no storage entry is named like a credential', await page.evaluate(() => Object.keys(localStorage)));
  check(!serverLog.includes(MOCK_KEY), 'the key is not in the server log');
  check(await page.evaluate(() => Object.keys(localStorage).every((k) => !k.endsWith(':aigen-prompt'))), 'the prompt draft is cleared after a successful job');
  check(outside.length === 0, 'no request left 127.0.0.1', [...new Set(outside)].slice(0, 5));
  check(errors.length === 0, 'no page error and no console error', errors.slice(0, 5));

  /* --- no server: the plain file --- */
  const plain = await ctx.newPage();
  plain.setDefaultTimeout(10000);
  const perr = [];
  plain.on('pageerror', (e) => perr.push(e.message));
  await plain.setViewportSize({ width: 1920, height: 1080 });
  await plain.goto(`${pathToFileURL(sim.file).href}?edition=business`); await plain.waitForSelector('#b-new'); await plain.waitForFunction(() => window.TNC_UI?.state.res, null, { timeout: 30000 }); await plain.waitForTimeout(300);
  if (await plain.locator('#setup:not([hidden])').count()) await plain.click('#setup-skip');
  await plain.click('#b-new'); await plain.click('#new-t-ai');
  await plain.waitForSelector('#aigen-offline', { state: 'visible' });
  check((await plain.locator('#aigen-offline').innerText()) === 'AI kräver den lokala eller hostade servern. Manuellt skapande fungerar som vanligt.', 'no server: one line says AI needs the local or hosted server', await plain.locator('#aigen-offline').innerText());
  check(await plain.evaluate(() => [...document.querySelectorAll('#new-ai input, #new-ai textarea, #new-ai button, #new-ai select')].every((n) => !n.checkVisibility())), 'no server: no key field, no prompt, no button in the AI choice');
  await plain.screenshot({ path: path.join(SHOTS, 'ai-offline-1920x1080.png') });
  await plain.click('#new-t-scratch'); await plain.fill('#ns-name', 'BY_HAND'); await plain.click('#ns-go');
  check(await plain.evaluate(() => window.TNC_UI.program.name === 'BY_HAND.H' && /BEGIN PGM BY_HAND MM/.test(window.TNC_UI.program.text)), 'no server: manual creation works as before');
  check(perr.length === 0, 'no server: no page error', perr.slice(0, 3));
  await plain.close();
} catch (e) {
  failures++;
  console.log(`FAIL the run stopped: ${e?.stack || e}`);
} finally {
  await browser?.close().catch(() => {});
  proc?.kill();
  await mock?.close().catch(() => {});
  await sleep(300);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows may still hold the database file for a moment */ }
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
