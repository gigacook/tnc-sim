/* Bridge contract v2 (docs/BUILD_STATE.md), proven with a real iframe parent in a real browser.
   The built index.html is served on 127.0.0.1 as /sim/index.html inside /parent.html (same origin, NO server behind it:
   window.TNC_BACKEND does not exist), next to a sibling frame (same origin, wrong source) and inside a page of a second
   origin (another port). Checked: the handshake, every app -> sim message and its effect in the simulator, every sim -> app
   message and its shape, the 10-per-second limit of tnc:state, the NC-start interlock with its visible reason, and that
   malformed, unknown, wrong-source and foreign-origin messages are dropped without an effect or an answer.

   Run:  python build.py && node tests/bridge.js        (Chromium from Playwright, or PW_CHROMIUM=<chrome executable>) */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SIM = path.join(ROOT, 'index.html');
if (!fs.existsSync(SIM)) { console.error('index.html missing: run python build.py'); process.exit(1); }
let chromium; try { ({ chromium } = require('playwright')); } catch { console.error('playwright missing: npm ci'); process.exit(1); }

let pass = 0, fail = 0; const failures = [];
function ok(c, name, detail) { if (c) { pass++; console.log('  ok    ' + name); } else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); } }

const PARENT = (q) => `<!doctype html><meta charset="utf-8"><title>parent</title>
<iframe id="sim" src="/sim/index.html${q}" style="width:1280px;height:820px;border:0"></iframe>
<iframe id="sib" src="/sibling.html" style="width:10px;height:10px"></iframe>
<script>
window.log = [];
addEventListener('message', function (e) { window.log.push({ t: performance.now(), origin: e.origin, fromSim: e.source === document.getElementById('sim').contentWindow, data: e.data }); });
window.send = function (m) { document.getElementById('sim').contentWindow.postMessage(m, location.origin); };
window.sendFromSibling = function (m) { document.getElementById('sib').contentWindow.relay(m); };
</script>`;
const SIBLING = `<!doctype html><meta charset="utf-8"><title>sibling</title><script>
window.relay = function (m) { parent.frames[0].postMessage(m, location.origin); };   // same origin, but e.source is this frame, not the simulator's parent
</script>`;
const FOREIGN = (simOrigin) => `<!doctype html><meta charset="utf-8"><title>foreign</title>
<iframe id="sim" src="${simOrigin}/sim/index.html?edition=business" style="width:1280px;height:820px;border:0"></iframe>
<script>
window.log = [];
addEventListener('message', function (e) { window.log.push({ origin: e.origin, data: e.data }); });
window.send = function (m) { document.getElementById('sim').contentWindow.postMessage(m, '*'); };
</script>`;

function serve(pages) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let u; try { u = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); res.end(); return; }
    hits.push(u.pathname);
    if (u.pathname === '/sim/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(SIM).pipe(res); return; }
    const p = pages[u.pathname];
    if (p) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(typeof p === 'function' ? p(u) : p); return; }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, hits, origin: 'http://127.0.0.1:' + srv.address().port })));
}

const PROGRAM = ['BEGIN PGM BRIDGE MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+80 Z+0', 'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3', 'L X+10 Y+10 R0 FMAX',
  'L Z-1 R0 F150 M8', 'L X+90 R0 F300', 'L Y+70 R0', 'L X+10 R0', 'L Y+10 R0', 'L Z+50 R0 FMAX M5 M9', 'M30', 'END PGM BRIDGE MM'].join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* the run speed is one chip (#spd-chip, data-s = the speed); a click steps 1× → 4× → 16× → 64× → MAX (0) and wraps */
const SPEED = (v) => { const c = document.getElementById('spd-chip'); for (let i = 0; i < 6 && c.dataset.s !== String(v); i++) c.click(); };

(async () => {
  const exe = [process.env.PW_CHROMIUM, undefined].find((x) => x === undefined || (x && fs.existsSync(x)));
  let browser;
  try { browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); }
  catch (e) { console.error('no Chromium: npx playwright install chromium, or set PW_CHROMIUM (' + String(e.message).split('\n')[0] + ')'); process.exit(1); }
  const A = await serve({ '/parent.html': (u) => PARENT(u.search || ''), '/sibling.html': SIBLING });
  const B = await serve({ '/foreign.html': () => FOREIGN(A.origin) });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { if (localStorage.getItem('tnc.settings.v1') == null) localStorage.setItem('tnc.settings.v1', JSON.stringify({ v: 1, lang: 'sv', setup: 1 })); } catch {} });
  const errors = [];
  async function open(url) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(url);
    const frame = await (async () => { for (let i = 0; i < 100; i++) { const f = page.frames().find((x) => /\/sim\/index\.html/.test(x.url())); if (f) return f; await sleep(50); } return null; })();
    await frame.waitForFunction(() => window.TNC_UI && TNC_UI.state.res && document.querySelectorAll('#plist .blk').length > 3, null, { timeout: 60000 });
    await sleep(500);
    return { page, frame };
  }
  /* parent-side helpers */
  const send = (page, m) => page.evaluate((m) => window.send(m), m);
  const log = (page, type) => page.evaluate((t) => window.log.filter((x) => x.data && x.data.type === t), type);
  const mark = (page) => page.evaluate(() => window.log.length);
  const since = (page, n, type) => page.evaluate(([n, t]) => window.log.slice(n).filter((x) => !t || (x.data && x.data.type === t)), [n, type]);
  async function waitMsg(page, n, type, pred, ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const l = (await since(page, n, type)).filter((x) => !pred || pred(x.data)); if (l.length) return l[l.length - 1].data; await sleep(40); }
    return null;
  }
  const sim = (frame) => frame.evaluate(() => { const s = TNC_UI.state; return { machine: s.machine, pgm: s.pgm, running: s.running, mode: s.mode, lock: !!s.lock, lang: TNC_I18N.lang, tools: (s.tools[s.machine] || []).length, t: s.t,
    html: { ...document.documentElement.dataset }, htmlLang: document.documentElement.lang, dropped: TNC_BRIDGE.dropped, embedded: TNC_BRIDGE.embedded, edition: TNC_BRIDGE.edition, backend: !!window.TNC_BACKEND }; });

  try {
    /* ================= same-origin parent, no server ================= */
    const { page, frame } = await open(A.origin + '/parent.html?edition=business');
    let s = await sim(frame);
    ok(s.embedded === true && s.backend === false, 'the bridge is active in a same-origin iframe without a server (no TNC_BACKEND)', JSON.stringify(s));
    ok(!A.hits.some((h) => /\/info|\/api\//.test(h)) && await frame.evaluate(() => !window.TNC_AI_API), 'the server-only part stays off: no /info request, no AI endpoint', A.hits.filter((h) => !/sim|parent|sibling|favicon/.test(h)).join(','));
    ok(s.edition === 'business' && s.html.edition === 'business', '?edition=business sets <html data-edition="business">', JSON.stringify(s.html));

    /* tnc:ready (v1 type, v2 fields) and tnc:hello */
    const ready = await log(page, 'tnc:ready');
    ok(ready.length === 1 && ready[0].fromSim && ready[0].origin === A.origin, 'tnc:ready arrives once from the simulator frame, same origin', JSON.stringify(ready.map((r) => r.data)));
    ok(ready[0] && ready[0].data.v === 2 && ready[0].data.edition === 'business' && ready[0].data.machine === '426' && ready[0].data.lang === 'sv', 'tnc:ready carries {v:2, edition, machine, lang}', JSON.stringify(ready[0] && ready[0].data));
    let n = await mark(page);
    await send(page, { type: 'tnc:hello', v: 2 });
    const r2 = await waitMsg(page, n, 'tnc:ready'), st0 = await waitMsg(page, n, 'tnc:state');
    ok(r2 && r2.v === 2 && r2.edition === 'business', 'tnc:hello {v:2} is answered with tnc:ready', JSON.stringify(r2));
    ok(!!st0, 'tnc:hello is followed by a tnc:state at once');

    /* v1: open, selected, get, changed */
    n = await mark(page);
    await send(page, { type: 'tnc:open', name: 'bridge', text: PROGRAM, machine: '426' });
    const sel = await waitMsg(page, n, 'tnc:selected');
    ok(sel && sel.name === 'BRIDGE.H' && sel.machine === '426' && Object.keys(sel).sort().join() === 'machine,name,type', 'v1 tnc:open opens the program; tnc:selected {name, machine} as before', JSON.stringify(sel));
    ok((await frame.evaluate(() => TNC_UI.state.text)) === PROGRAM, 'the simulator shows the program that was sent');
    n = await mark(page);
    await send(page, { type: 'tnc:get', id: 'q-1' });
    const got = await waitMsg(page, n, 'tnc:program');
    ok(got && got.id === 'q-1' && got.name === 'BRIDGE.H' && got.machine === '426' && got.text === PROGRAM && Object.keys(got).sort().join() === 'id,machine,name,text,type', 'v1 tnc:get is answered with tnc:program {id, name, machine, text}', JSON.stringify(got && { ...got, text: got.text.length }));
    n = await mark(page);
    await frame.evaluate(() => document.querySelector('.mode[data-m="edit"]').click());
    await frame.click('#plist .blk[data-i="7"]'); await frame.press('body', 'e'); await frame.fill('#dlg-in', 'L X+80 R0 F300'); await frame.press('#dlg-in', 'Enter');
    const ch = await waitMsg(page, n, 'tnc:changed');
    ok(ch && ch.name === 'BRIDGE.H' && /\nL X\+80 R0 F300\n/.test(ch.text) && ch.machine === '426', 'v1 tnc:changed after an edit in the simulator', JSON.stringify(ch && { ...ch, text: ch.text.length }));

    /* tnc:state: shape */
    n = await mark(page);
    await send(page, { type: 'tnc:hello', v: 2 });
    const st = await waitMsg(page, n, 'tnc:state');
    const shape = st && typeof st.running === 'boolean' && typeof st.cutting === 'boolean' && typeof st.mode === 'string' && typeof st.machine === 'string' &&
      st.tool && typeof st.tool.t === 'number' && typeof st.tool.r === 'number' && typeof st.tool.l === 'number' &&
      st.pos && ['x', 'y', 'z', 'a', 'b'].every((k) => typeof st.pos[k] === 'number') && st.spindle && typeof st.spindle.on === 'boolean' && typeof st.spindle.rpm === 'number' &&
      typeof st.coolant === 'boolean' && typeof st.progress === 'number' && st.progress >= 0 && st.progress <= 1 && typeof st.errors === 'number' && typeof st.done === 'boolean';
    ok(!!shape, 'tnc:state {running, cutting, mode, machine, tool{t,r,l}, pos{x,y,z,a,b}, spindle{on,rpm}, coolant, progress, errors, done}', JSON.stringify(st));
    ok(st && st.mode === 'edit' && st.machine === '426' && st.running === false && st.errors === 0 && st.tool.t === 4, 'tnc:state reports the mode, the machine and the tool of the program', JSON.stringify(st));

    /* tnc:exec with the simulator's own run controls; the state follows; at most 10 a second */
    await frame.evaluate(() => { document.querySelector('.mode[data-m="test"]').click(); }); await frame.evaluate(SPEED, 1);
    n = await mark(page);
    const tStart = Date.now();
    await send(page, { type: 'tnc:exec', cmd: 'start' });
    const run = await waitMsg(page, n, 'tnc:state', (d) => d.running === true, 3000);
    ok(run && run.running === true && Date.now() - tStart < 1500, 'tnc:exec start starts the run; tnc:state says running at once', JSON.stringify(run && { running: run.running, ms: Date.now() - tStart }));
    ok((await sim(frame)).running === true && await frame.evaluate(() => /KÖR|RUNNING/.test(document.getElementById('run-state').textContent)), 'the simulator itself is running (its own state line)');
    const n1 = await mark(page); await sleep(2000);
    const flow = await since(page, n1, 'tnc:state');
    const gaps = flow.slice(1).map((x, i) => x.t - flow[i].t), tight = gaps.filter((g) => g < 80).length;
    ok(flow.length >= 6 && flow.length <= 24, 'while running, tnc:state keeps coming, at most about 10 a second', flow.length + ' in 2 s');
    ok(tight <= 3, 'steady tnc:state messages are at least ~100 ms apart (a transition may come sooner)', 'gaps under 80 ms: ' + tight + ' of ' + gaps.length);
    ok(flow.some((x) => x.data.progress > 0) && flow[flow.length - 1].data.progress >= flow[0].data.progress, 'progress moves forward', JSON.stringify(flow.map((x) => x.data.progress).slice(0, 6)));
    n = await mark(page);
    await send(page, { type: 'tnc:exec', cmd: 'stop' });
    const held = await waitMsg(page, n, 'tnc:state', (d) => d.running === false, 3000);
    ok(held && held.running === false && held.progress > 0 && held.done === false, 'tnc:exec stop holds the run where it is', JSON.stringify(held && { running: held.running, progress: held.progress }));
    n = await mark(page);
    await send(page, { type: 'tnc:exec', cmd: 'reset' });
    const rst = await waitMsg(page, n, 'tnc:state', (d) => d.progress === 0, 3000);
    ok(rst && rst.progress === 0 && rst.running === false, 'tnc:exec reset goes back to the start', JSON.stringify(rst && { progress: rst.progress }));
    const t0 = (await sim(frame)).t;
    n = await mark(page);
    await send(page, { type: 'tnc:exec', cmd: 'step' });
    const stp = await waitMsg(page, n, 'tnc:state', null, 3000);
    await sleep(200);
    ok(stp && (await frame.evaluate(() => TNC_UI.state.k)) === 1 && (await sim(frame)).running === false && (await sim(frame)).t >= t0, 'tnc:exec step runs one block (the single-block control)', JSON.stringify(await frame.evaluate(() => ({ k: TNC_UI.state.k, cursor: TNC_UI.state.cursor }))));
    /* done */
    await frame.evaluate(SPEED, 0);
    n = await mark(page);
    await send(page, { type: 'tnc:exec', cmd: 'reset' }); await send(page, { type: 'tnc:exec', cmd: 'start' });
    const done = await waitMsg(page, n, 'tnc:state', (d) => d.done === true, 5000);
    ok(done && done.done === true && done.progress === 1 && done.running === false, 'at the end of the program tnc:state says done, progress 1', JSON.stringify(done && { done: done.done, progress: done.progress, running: done.running }));
    await send(page, { type: 'tnc:exec', cmd: 'reset' }); await frame.evaluate(SPEED, 1);

    /* tnc:lock: NC start refused, with the reason on screen */
    n = await mark(page);
    await send(page, { type: 'tnc:lock', locked: true, reason: 'Oil level empty' });
    const lk = await waitMsg(page, n, 'tnc:state');
    ok((await sim(frame)).lock === true && !!lk, 'tnc:lock {locked:true} locks the simulator');
    ok(await frame.evaluate(() => { const e = document.getElementById('sb-lock'); return !e.hidden && /Oil level empty/.test(e.textContent) && document.getElementById('b-start').getAttribute('aria-disabled') === 'true'; }), 'the lock and its reason are shown in the status bar; Run is marked unavailable');
    await send(page, { type: 'tnc:exec', cmd: 'start' }); await sleep(400);
    ok((await sim(frame)).running === false, 'NC start by message is refused while locked');
    ok(await frame.evaluate(() => { const a = document.getElementById('alarm'); return !a.hidden && /Oil level empty/.test(a.textContent) && a.getAttribute('role') === 'alert'; }), 'the refusal shows the reason as an alert', await frame.evaluate(() => document.getElementById('alarm').textContent));
    await frame.evaluate(() => document.getElementById('alarm').querySelector('button').click());
    await frame.click('#b-start', { force: true }); await sleep(300);   // aria-disabled: still clickable, so the reason can be shown
    ok((await sim(frame)).running === false && await frame.evaluate(() => !document.getElementById('alarm').hidden), 'the Run button in the simulator is refused the same way');
    await frame.press('body', 'Space'); await sleep(200);
    ok((await sim(frame)).running === false, 'SPACE (NC START) is refused too');
    await send(page, { type: 'tnc:exec', cmd: 'step' }); await sleep(300);
    ok(await frame.evaluate(() => TNC_UI.state.k) === 0, 'single block is refused while locked');
    await send(page, { type: 'tnc:lock', locked: false }); await sleep(200);
    ok((await sim(frame)).lock === false && await frame.evaluate(() => document.getElementById('sb-lock').hidden && document.getElementById('b-start').getAttribute('aria-disabled') === 'false'), 'tnc:lock {locked:false} unlocks and removes the notice');
    n = await mark(page);
    await send(page, { type: 'tnc:exec', cmd: 'start' });
    ok(!!(await waitMsg(page, n, 'tnc:state', (d) => d.running === true, 3000)), 'after unlocking, NC start works again');
    // locking a running machine stops it
    n = await mark(page);
    await send(page, { type: 'tnc:lock', locked: true, reason: 'Door open' });
    ok(!!(await waitMsg(page, n, 'tnc:state', (d) => d.running === false, 3000)) && (await sim(frame)).running === false, 'locking while running holds the run');
    await send(page, { type: 'tnc:lock', locked: false }); await send(page, { type: 'tnc:exec', cmd: 'reset' }); await sleep(200);

    /* tnc:camera: the presets, with the simulator's own camera */
    const cam = () => frame.evaluate(() => ({ p: TNC_UI.camera.position.toArray().map((v) => +v.toFixed(2)).join(','), t: TNC_UI.controls.target.toArray().map((v) => +v.toFixed(2)).join(','), label: document.getElementById('gfx-rt').textContent, view: TNC_UI.state.view, cam: TNC_UI.state.cam }));
    const views = {};
    for (const v of ['orbit', 'plan', 'part', 'tool', 'pov']) { await send(page, { type: 'tnc:camera', view: v }); await sleep(200); views[v] = await cam(); }
    ok(new Set(Object.values(views).map((c) => c.p)).size === 5, 'tnc:camera: orbit, plan, part, tool and pov are five different camera positions', JSON.stringify(views));
    ok(views.orbit.view === '3D' && views.orbit.cam === null && views.plan.view === 'TOP' && views.part.cam === 'part' && views.tool.cam === 'tool' && views.pov.cam === 'pov', 'orbit and plan are the existing 3-D and plan views; part, tool, pov are presets', JSON.stringify(Object.fromEntries(Object.entries(views).map(([k, c]) => [k, c.view + '/' + c.cam]))));
    ok(new Set(Object.values(views).map((c) => c.label)).size === 5, 'the view label names the preset', Object.values(views).map((c) => c.label).join(' | '));
    // tool / pov follow the tool
    await send(page, { type: 'tnc:camera', view: 'tool' }); await sleep(150);
    const c0 = await cam(); await frame.evaluate(() => { document.getElementById('scrub').value = 500; document.getElementById('scrub').dispatchEvent(new Event('input')); }); await sleep(300);
    const c1 = await cam();
    ok(c0.t !== c1.t && c0.p !== c1.p, 'the tool preset follows the tool when the run moves it', c0.t + ' -> ' + c1.t);
    await send(page, { type: 'tnc:camera', view: 'orbit' }); await send(page, { type: 'tnc:exec', cmd: 'reset' }); await sleep(200);

    /* tnc:present: presentation only; no echo. A change made inside the simulator is reported with tnc:settings. */
    const engine = () => frame.evaluate(() => { const r = TNC_UI.state.res; return JSON.stringify([r.blocks.length, r.moves.length, r.errors.length, +TNC_UI.state.total.toFixed(6)]); });
    const e0 = await engine();
    n = await mark(page);
    await send(page, { type: 'tnc:present', lang: 'en', skin: '430', env: 'workshop-night', quality: 'low', motion: 'reduced', sound: false }); await sleep(400);
    s = await sim(frame);
    ok(s.htmlLang === 'en' && s.lang === 'en' && s.html.skin === '430' && s.html.env === 'workshop-night' && s.html.quality === 'low' && s.html.motion === 'reduced', 'tnc:present sets language, skin, environment, quality and motion', JSON.stringify(s.html) + ' ' + s.htmlLang);
    ok(await frame.evaluate(() => TNC_UI.state.sound === false && document.querySelector('#b-new span').textContent.trim() === 'New program…' && TNC_UI.state.machine === '426'), 'sound off, the bar in English, the machine untouched by the skin');
    ok(await engine() === e0, 'tnc:present does not change the engine result');
    ok((await since(page, n, 'tnc:settings')).length === 0, 'a tnc:present from the app is not echoed back as tnc:settings');
    await send(page, { type: 'tnc:present', lang: 'sr' }); await sleep(300);
    s = await sim(frame);
    ok(s.lang === 'sr' && s.htmlLang === 'sr-Latn' && await frame.evaluate(() => document.querySelector('#b-new span').textContent.trim() === 'Novi program…' && JSON.parse(localStorage.getItem('tnc.settings.v1')).lang === 'sr'),
      'tnc:present lang "sr" switches to Serbian (html lang sr-Latn) and stores it', JSON.stringify({ lang: s.lang, html: s.htmlLang }));
    n = await mark(page);
    await send(page, { type: 'tnc:hello', v: 2 });
    const rsr = await waitMsg(page, n, 'tnc:ready');
    ok(rsr && rsr.lang === 'sr', 'tnc:ready reports lang "sr"', JSON.stringify(rsr));
    n = await mark(page);
    await frame.evaluate(() => TNC_SETTINGS.set('sound', true));
    const ssr = await waitMsg(page, n, 'tnc:settings');
    ok(ssr && ssr.lang === 'sr' && ssr.sound === true, 'tnc:settings reports lang "sr"', JSON.stringify(ssr));
    await send(page, { type: 'tnc:present', sound: false }); await sleep(150);
    n = await mark(page);
    await send(page, { type: 'tnc:present', lang: 'sv' }); await sleep(250);
    ok((await sim(frame)).lang === 'sv' && (await sim(frame)).html.skin === '430', 'a partial tnc:present changes only what it names');
    n = await mark(page);
    // the gear opens the settings panel (sim/setpanel.js); Appearance holds the environment
    await frame.evaluate(() => document.getElementById('b-gear').click()); await frame.waitForFunction(() => window.TNC_SETPANEL && TNC_SETPANEL.isOpen, null, { timeout: 10000 });
    if ((await frame.getAttribute('#setpanel [data-g="look"] .sp-hb', 'aria-expanded')) !== 'true') await frame.click('#setpanel [data-g="look"] .sp-hb');
    await frame.click('#setpanel [data-k="env"] [data-v="cold-steel"]'); await frame.press('body', 'Escape');
    const set = await waitMsg(page, n, 'tnc:settings');
    ok(set && set.lang === 'sv' && set.skin === '430' && set.env === 'cold-steel' && set.quality === 'low' && set.motion === 'reduced' && set.sound === false && Object.keys(set).sort().join() === 'env,lang,motion,quality,skin,sound,type',
      'a setting changed inside the simulator is reported: tnc:settings {lang, skin, env, quality, motion, sound}', JSON.stringify(set));

    /* tnc:machine */
    n = await mark(page);
    await send(page, { type: 'tnc:machine', machine: '430' });
    const m430 = await waitMsg(page, n, 'tnc:state', (d) => d.machine === '430', 4000);
    ok(m430 && (await sim(frame)).machine === '430' && await frame.evaluate(() => document.getElementById('mach-sel').value === '430'), 'tnc:machine selects the 430 profile (and the dropdown in the bar follows)', JSON.stringify(m430 && m430.machine));
    await send(page, { type: 'tnc:machine', machine: '426' }); await sleep(400);
    ok((await sim(frame)).machine === '426' && (await sim(frame)).pgm === 'BRIDGE.H', 'tnc:machine back to 426 brings its program back');

    /* tools: get / set through the tool table */
    n = await mark(page);
    await send(page, { type: 'tnc:tools:get', id: 'tools-1' });
    const tl = await waitMsg(page, n, 'tnc:tools');
    ok(tl && tl.id === 'tools-1' && Array.isArray(tl.tools) && tl.tools.length >= 11 && tl.tools.every((t) => typeof t.t === 'number' && typeof t.l === 'number' && typeof t.r === 'number' && typeof t.name === 'string'),
      'tnc:tools:get is answered with tnc:tools {id, tools:[{t,name,l,r}]}', JSON.stringify(tl && { id: tl.id, n: tl.tools.length, first: tl.tools[0] }));
    const t4 = tl.tools.find((t) => t.t === 4);
    await send(page, { type: 'tnc:tools:set', tools: [{ t: 4, name: 'ENDMILL_10', l: 90, r: 5 }, { t: 77, name: 'SHOP_TOOL', l: 120, r: 2.5, extra: 'kept out' }] }); await sleep(400);
    n = await mark(page);
    await send(page, { type: 'tnc:tools:get', id: 'tools-2' });
    const tl2 = await waitMsg(page, n, 'tnc:tools');
    const n4 = tl2 && tl2.tools.find((t) => t.t === 4), n77 = tl2 && tl2.tools.find((t) => t.t === 77);
    ok(n4 && n4.r === 5 && n4.name === 'ENDMILL_10' && n77 && n77.r === 2.5 && t4.r !== 5, 'tnc:tools:set replaces the tool table: T4 changed, T77 added', JSON.stringify([t4, n4, n77]));
    ok(await frame.evaluate(() => { const s = TNC_UI.state; return s.tools[s.machine].length === 2 && s.res.moves.some((m) => m.toolR === 5); }), 'the program is recompiled with the new table (tool radius 5 in its moves)');
    await frame.evaluate(() => document.getElementById('b-tools').click()); await sleep(200);
    ok(await frame.evaluate(() => [...document.querySelectorAll('.ttab input[data-k=name]')].some((i) => i.value === 'SHOP_TOOL')), 'the simulator\'s own tool table shows the tools that were set');
    await frame.press('body', 'Escape');

    /* tnc:inspect: the inspector on the named tab */
    /* the inspector is a flyout (#insp-fly, opened from the rail or the bottom bar's F control) with two tabs, Run (diag) and Manual (ref);
       the programs moved to the profile sheet, so tnc:inspect progs opens that sheet */
    const insp = () => frame.evaluate(() => ({ open: (() => { const f = document.getElementById('insp-fly'); return f.classList.contains('open') && getComputedStyle(f).visibility === 'visible'; })(),
      tab: document.querySelector('#stabs [aria-selected="true"]').dataset.tab, pressed: document.getElementById('b-insp-k').getAttribute('aria-expanded'),
      sheet: !!(window.TNC_SHEET && TNC_SHEET.isOpen),
      cmp: (() => { const r = document.querySelector('.card-compare').getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1; })() }));
    ok((await insp()).open === false, 'the inspector is closed before tnc:inspect (default layout)', JSON.stringify(await insp()));
    const seenTabs = [];
    for (const panel of ['ref', 'diag', 'compare']) { await send(page, { type: 'tnc:inspect', panel }); await sleep(250); seenTabs.push({ panel, ...(await insp()) }); }
    ok(seenTabs.every((x) => x.open && x.pressed === 'true') && seenTabs.map((x) => x.tab).join() === 'ref,diag,diag', 'tnc:inspect opens the inspector on ref (Manual), diag (Run); compare = the Run tab', JSON.stringify(seenTabs));
    ok(seenTabs[2].cmp === true, 'tnc:inspect compare has the comparison card on screen', JSON.stringify(seenTabs[2]));
    await frame.evaluate(() => document.getElementById('insp-x').click()); await sleep(150);
    await send(page, { type: 'tnc:inspect', panel: 'progs' });
    await frame.waitForFunction(() => window.TNC_SHEET && TNC_SHEET.isOpen, null, { timeout: 5000 }).catch(() => {});
    ok((await insp()).sheet === true, 'tnc:inspect progs opens the programs, which live in the profile sheet now', JSON.stringify(await insp()));
    await frame.press('body', 'Escape'); await frame.waitForFunction(() => !TNC_SHEET.isOpen, null, { timeout: 5000 }).catch(() => {});
    for (const m of [{ type: 'tnc:inspect', panel: 'dev' }, { type: 'tnc:inspect' }, { type: 'tnc:inspect', panel: ['ref'] }]) await send(page, m);
    await sleep(250);
    ok((await insp()).open === false, 'tnc:inspect with an unknown or missing panel is dropped (the inspector stays closed)', JSON.stringify(await insp()));

    /* ================= malformed and unknown messages are dropped ================= */
    const before = await sim(frame), eB = await engine();
    n = await mark(page);
    const bad = [
      { type: 'tnc:exec', cmd: 'explode' }, { type: 'tnc:exec' }, { type: 'tnc:exec', cmd: ['start'] }, { type: 'tnc:camera', view: '<img src=x onerror=alert(1)>' }, { type: 'tnc:camera' },
      { type: 'tnc:machine', machine: '999' }, { type: 'tnc:machine', machine: 430 }, { type: 'tnc:lock', locked: 'yes' }, { type: 'tnc:lock', locked: true, reason: { toString: 1 } }, { type: 'tnc:lock' },
      { type: 'tnc:present', lang: 'de' }, { type: 'tnc:present', skin: 'auto' }, { type: 'tnc:present', sound: 'on' }, { type: 'tnc:present', env: 'cold-steel', quality: 'ultra' },
      { type: 'tnc:tools:set', tools: 'all' }, { type: 'tnc:tools:set', tools: [{ t: '4', l: 1, r: 1 }] }, { type: 'tnc:tools:set', tools: [{ t: 4, l: 1, r: -1 }] }, { type: 'tnc:tools:set', tools: [null] }, { type: 'tnc:tools:get' },
      { type: 'tnc:open', text: 5 }, { type: 'tnc:open', name: 'X', text: 'BEGIN PGM X MM\nEND PGM X MM', machine: 'lathe' }, { type: 'tnc:open', name: 'X', text: 'BEGIN PGM X MM\nEND PGM X MM', tools: [{ t: 'x' }] },
      { type: 'tnc:hello', v: 3 }, { type: 'tnc:hello' }, { type: 'tnc:nope' }, { type: 'constructor' }, { type: 'toString' }, { type: 42 }, {}, 'tnc:exec', 42, null, [], [{ type: 'tnc:exec', cmd: 'start' }]
    ];
    for (const m of bad) await send(page, m);
    await sleep(600);
    const after = await sim(frame);
    ok(after.machine === before.machine && after.pgm === before.pgm && after.running === false && after.lock === false && after.lang === before.lang && after.tools === before.tools &&
      JSON.stringify(after.html) === JSON.stringify(before.html) && await engine() === eB, bad.length + ' malformed or unknown messages change nothing in the simulator', JSON.stringify([before, after]));
    ok(after.dropped - before.dropped === bad.length, 'each of them is counted as dropped', (after.dropped - before.dropped) + ' of ' + bad.length);
    const answers = (await since(page, n)).filter((x) => x.data && /^tnc:(ready|program|tools|selected|settings|exit)$/.test(x.data.type));
    ok(answers.length === 0, 'none of them is answered', JSON.stringify(answers.map((a) => a.data.type)));

    /* ================= wrong source: a same-origin sibling frame ================= */
    n = await mark(page);
    for (const m of [{ type: 'tnc:exec', cmd: 'start' }, { type: 'tnc:machine', machine: '430' }, { type: 'tnc:lock', locked: true, reason: 'sibling' }, { type: 'tnc:get', id: 'sib' }, { type: 'tnc:hello', v: 2 }, { type: 'tnc:inspect', panel: 'ref' }])
      await page.evaluate((m) => window.sendFromSibling(m), m);
    await sleep(600);
    const sib = await sim(frame);
    ok(sib.machine === '426' && sib.running === false && sib.lock === false && sib.dropped - after.dropped === 6 && (await insp()).open === false, 'valid messages from a same-origin sibling frame (not the parent) are dropped', JSON.stringify({ machine: sib.machine, running: sib.running, lock: sib.lock, dropped: sib.dropped - after.dropped }));
    ok((await since(page, n)).filter((x) => x.data && /^tnc:(ready|program)$/.test(x.data.type)).length === 0, 'and not answered');
    // a message the simulator posts to itself is not from the parent either
    await frame.evaluate(() => window.postMessage({ type: 'tnc:machine', machine: '430' }, location.origin)); await sleep(300);
    ok((await sim(frame)).machine === '426', 'a message from the simulator window to itself is dropped');
    await page.close();

    /* ================= ?edition ================= */
    const play = await open(A.origin + '/parent.html?edition=play');
    s = await sim(play.frame);
    const pr = await log(play.page, 'tnc:ready');
    ok(s.edition === 'play' && s.html.edition === 'play' && pr[0] && pr[0].data.edition === 'play', '?edition=play: data-edition and tnc:ready say play', JSON.stringify(s.html));
    ok(await play.frame.evaluate(() => { const b = document.getElementById('b-exit'); return !b.hidden && b.offsetParent !== null && b.textContent.trim().length > 0; }), 'Play shows the exit control');
    n = await mark(play.page);
    await play.frame.click('#b-exit');
    const ex = await waitMsg(play.page, n, 'tnc:exit');
    ok(ex && Object.keys(ex).join() === 'type', 'the exit control posts tnc:exit {}', JSON.stringify(ex));
    ok(await play.frame.evaluate(() => document.getElementById('setup').hidden), 'no simulator setup card inside Play');
    await play.page.close();
    for (const [q, want] of [['?edition=evil', 'core'], ['?edition=BUSINESS', 'core'], ['?edition=business%20x', 'core'], ['', 'core']]) {
      const o = await open(A.origin + '/parent.html' + q); const so = await sim(o.frame), ro = await log(o.page, 'tnc:ready');
      ok(so.edition === want && so.html.edition === want && ro[0].data.edition === want && await o.frame.evaluate(() => document.getElementById('b-exit').hidden), `"${q || '(no edition)'}" is the ${want} edition, without the exit control`, JSON.stringify(so.html));
      await o.page.close();
    }
    // not embedded: the plain page
    const plain = await ctx.newPage(); await plain.goto(A.origin + '/sim/index.html?edition=play');
    await plain.waitForFunction(() => window.TNC_UI && TNC_UI.state.res, null, { timeout: 60000 });
    ok(await plain.evaluate(() => TNC_BRIDGE.embedded === false && document.getElementById('b-exit').hidden), 'the plain page (no parent) has no bridge and no exit control');
    await plain.evaluate(() => window.postMessage({ type: 'tnc:machine', machine: '430' }, location.origin)); await sleep(300);
    ok(await plain.evaluate(() => TNC_UI.state.machine === '426'), 'the plain page ignores bridge messages');
    await plain.close();

    /* ================= foreign origin: a parent on another origin ================= */
    const f = await open(B.origin + '/foreign.html');
    s = await sim(f.frame);
    ok(s.embedded === false, 'inside a parent of another origin the bridge is not active', A.origin + ' in ' + B.origin);
    for (const m of [{ type: 'tnc:hello', v: 2 }, { type: 'tnc:machine', machine: '430' }, { type: 'tnc:exec', cmd: 'start' }, { type: 'tnc:lock', locked: true, reason: 'foreign' }, { type: 'tnc:get', id: 'x' },
      { type: 'tnc:open', name: 'EVIL', text: 'BEGIN PGM EVIL MM\nEND PGM EVIL MM', machine: '426' }, { type: 'tnc:tools:set', tools: [{ t: 1, l: 1, r: 1 }] }, { type: 'tnc:present', lang: 'en' }]) await send(f.page, m);
    await sleep(700);
    const fs2 = await sim(f.frame);
    ok(fs2.machine === s.machine && fs2.running === false && fs2.lock === false && fs2.lang === s.lang && fs2.tools === s.tools && fs2.pgm === s.pgm && fs2.pgm !== 'EVIL.H' && JSON.stringify(fs2.html) === JSON.stringify(s.html),
      'messages from a foreign-origin parent have no effect', JSON.stringify([s, fs2]));
    ok((await f.page.evaluate(() => window.log.filter((x) => x.data && typeof x.data.type === 'string' && /^tnc:/.test(x.data.type)).length)) === 0, 'and the foreign parent receives nothing: no tnc:ready, no tnc:state, no program');
    await f.page.close();

    ok(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
  } catch (e) { fail++; failures.push('crashed: ' + (e.stack || e)); console.log(e); }
  await browser.close(); A.srv.close(); B.srv.close();
  console.log(`\n${pass} passed · ${fail} failed`);
  if (fail) { console.log('\nFAILURES\n' + failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
  console.log('BRIDGE CONTRACT v2: ALL CHECKS PASS');
})();
