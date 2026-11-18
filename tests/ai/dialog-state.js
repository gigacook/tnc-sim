/* The AI view of the New program dialog (sim/aigen.js) as a state machine: the pure reducer, the SSE parser and the
   controller with an injected transport, host and timers. No browser, no server, no network.
   node tests/ai/dialog-state.js */
const A = require('../../sim/aigen.js');
let fails = 0;
const ok = (c, m, d) => { console.log((c ? '  ok    ' : '  FAIL  ') + m + (c || d === undefined ? '' : '  (' + JSON.stringify(d) + ')')); if (!c) fails++; };
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

const SECRET = ['UNIT', 'TEST', 'KEY', 'not', 'real'].join('-');
const GOOD = 'BEGIN PGM SLOT MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nL Z+50 R0 FMAX M2\nEND PGM SLOT MM';
const model = (id, label, extra) => Object.assign({ id, label, name: 'ACME: ' + label, provider: 'acme', context_length: 1000000, max_completion_tokens: 32768,
  pricing: { prompt: '0.00000005', completion: '0.00000020' }, price_per_million: '$0.05 / $0.20 per 1M tokens',
  supports: { reasoning: true, tools: true, streaming: true }, reasoning: { effective: 'medium' }, output: { requested: 131072, effective_cap: 32768, parameter: 'max_tokens' } }, extra);
const CATALOG = { models: [
  model('acme/fast-one-v2', 'Fast One v2'),
  model('acme/small-context', 'Small Context', { context_length: 50000, max_completion_tokens: 32768 }),
  model('acme/odd', 'Server Says', { context_length: 50000, max_completion_tokens: 32768, output: { requested: 131072, effective_cap: 30000, parameter: 'max_tokens' } }),
  model('acme/bare', 'No Limits', { output: undefined, pricing: { prompt: '-1', completion: 'free' } }),
], default_model: 'acme/fast-one-v2', stale: false, policy: { max_refinement_rounds: 5 } };

const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/* a stream the test writes into */
function stream() {
  const q = []; let wake = null, closed = false, error = null;
  const kick = () => { if (wake) { const w = wake; wake = null; w(); } };
  return {
    send: (t) => { q.push(t); kick(); }, close: () => { closed = true; kick(); }, fail: (e) => { error = e || new Error('socket'); kick(); },
    chunks: (async function* () {
      for (;;) {
        if (q.length) { yield q.shift(); continue; }
        if (error) throw error;
        if (closed) return;
        await new Promise((r) => { wake = r; });
      }
    })(),
  };
}
function rig(o = {}) {
  const calls = [], timers = [], programs = { 'MINE.H': 'BEGIN PGM MINE MM\n; unsaved edit\nEND PGM MINE MM' };
  let st = stream(), used = false;   // one stream per job
  const env = { clock: 0, active: 'MINE.H', loads: [], changes: [], undo: [], measured: [], keyPresent: o.key !== false, refuse: o.refuse || null };
  const transport = {
    keyState: async () => { calls.push(['keyState']); return { ok: true, status: 200, data: { present: env.keyPresent, stored: env.keyPresent } }; },
    putKey: async (key) => { calls.push(['putKey', key]); if (o.putFails) return { ok: false, status: 403, error: { code: 'forbidden', message: 'admin only' } }; env.keyPresent = true; return { ok: true, status: 200, data: { present: true, stored: true } }; },
    deleteKey: async () => { calls.push(['deleteKey']); env.keyPresent = false; return { ok: true, status: 200, data: { present: false, stored: false } }; },
    models: async () => { calls.push(['models']); return { ok: true, status: 200, data: CATALOG }; },
    startJob: async (body, signal) => {
      calls.push(['startJob', body]);
      if (env.refuse) return { ok: false, status: 409, error: env.refuse };
      if (used) st = stream();
      used = true;
      const mine = st;
      if (signal) signal.addEventListener('abort', () => mine.fail(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      return { ok: true, status: 200, jobId: 'job-1', chunks: mine.chunks };
    },
    cancel: async (id) => { calls.push(['cancel', id]); return { ok: true, status: 200, data: { cancelled: true } }; },
    measure: async (id, body) => { calls.push(['measure', id, body]); return { ok: true, status: 200, data: { accepted: true } }; },
  };
  const host = {
    machine: () => '426', tools: () => [{ t: 5, name: 'ENDMILL_12', l: 120, r: 6, mine: true }], system: () => 'SYSTEM PROMPT',
    measure: o.measure === undefined ? ((program, spec) => { env.measured.push([program, spec]); env.clock += o.measureTakes || 5; return { score: 61.5, text: 'S1 SLOT: NOT CUT' }; }) : o.measure,
    active: () => env.active,
    base: () => (o.noBase ? null : { name: env.active, text: programs[env.active] }),
    change: (name, program) => { env.changes.push([name, program]); env.undo.push([name, programs[name]]); programs[name] = program; return name; },
    load: (program) => { env.loads.push(program); const n = A.freeName(A.programBase(program), Object.keys(programs)); programs[n] = program; env.active = n; return n; },
    pick: { get: () => null, set: () => {} },
  };
  const ctl = A.create({ transport, host, now: () => env.clock,
    timers: { set: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length - 1; }, clear: (i) => { if (timers[i]) timers[i].on = false; } } });
  const fire = (pred) => timers.filter((t) => t.on && pred(t)).forEach((t) => { t.on = false; t.fn(); });
  return { ctl, calls, get st() { return st; }, env, programs, fire, of: (name) => calls.filter((c) => c[0] === name), timers };
}
const start = async (r, prompt = 'a slot 80 long') => { await r.ctl.refresh(); const p = r.ctl.generate(prompt); await settle(); return [p]; };   // in a list: returning the promise itself would wait for the whole job
const job = (r) => r.st.send(frame('job', { id: 'job-1', model: 'acme/fast-one-v2', max_rounds: 5, client_measure: true }));
const stage = (r, s, round = 0) => r.st.send(frame('stage', { stage: s, round, max_rounds: 5 }));
const DONE = { program: GOOD, round: 0, accepted: true, model: 'acme/fast-one-v2', validation: { ok: true, errors: [], crashes: [], warnings: [], blocks: 5, summary: 'passed' }, measurement: { native: {}, client: null }, usage: { requests: 1 } };

(async () => {
  /* ---- the SSE parser ---- */
  {
    const whole = ': keepalive\n\n' + frame('job', { id: 'j' }) + ':\n\n' + frame('delta', { round: 0, text: 'L X+10 Ø12\n' }) + 'event: stage\r\ndata: {"stage":"validation",\r\ndata: "round":0}\r\n\r\n' + frame('done', { ok: 1 });
    const p = A.sseParser(); let evs = [];
    for (const ch of whole) evs = evs.concat(p.push(ch));                       // one character at a time
    ok(evs.map((e) => e.type).join() === 'job,delta,stage,done', 'SSE: split into single characters, the same four events', evs.map((e) => e.type));
    ok(p.keepalives === 2 && !p.partial, 'SSE: two keepalive comments skipped, nothing left over', p.keepalives);
    ok(evs[1].data.text === 'L X+10 Ø12\n', 'SSE: text survives the split', evs[1].data);
    ok(evs[2].data.stage === 'validation' && evs[2].data.round === 0, 'SSE: CRLF and two data lines are one event', evs[2].data);
    const one = A.sseParser().push(whole);
    ok(one.length === 4, 'SSE: one chunk gives the same events', one.length);
    const cut = A.sseParser(); cut.push(frame('job', { id: 'j' }) + 'event: delta\ndata: {"round":0,"te');
    ok(cut.partial, 'SSE: a stream that stops inside an event is reported as partial');
    const bad = A.sseParser().push('event: delta\ndata: {not json\n\n');
    ok(bad.length === 1 && bad[0].type === 'bad-event', 'SSE: an event that is not JSON does not throw', bad);
    ok(A.sseParser().push('data: 1\n\n')[0].type === 'message', 'SSE: no event line = type "message" (skipped by the reducer)');
  }

  /* ---- prices and limits, from the catalog ---- */
  {
    const m = CATALOG.models;
    ok(A.priceText(m[0], 'en') === '$0.05 / $0.20 per 1M tokens', 'price: "0.00000005" / "0.00000020" reads $0.05 / $0.20 per 1M tokens', A.priceText(m[0], 'en'));
    ok(A.priceText(m[0], 'en') === m[0].price_per_million, 'price: the same text the server makes');
    ok(A.priceText(m[0], 'sv').startsWith('$0.05 / $0.20 per 1M tokens') && A.priceText(m[0], 'sr').startsWith('$0.05 / $0.20 na 1M tokena'), 'price: Swedish and Serbian wording, the same numbers', [A.priceText(m[0], 'sv'), A.priceText(m[0], 'sr')]);
    ok(A.perMillion('0.0000000507') === '0.0507' && A.perMillion('0.000003') === '3.00' && A.perMillion('0.0000125') === '12.50' && A.perMillion('2') === '2000000.00' && A.perMillion('0') === '0.00', 'price: the decimal point moves six places, as text');
    ok(A.priceText(m[3], 'en') === null && A.perMillion('1e-7') === null && A.perMillion(5e-8) === null, 'price: not a plain amount = no price shown');
    const lim = A.outputLimit(m[1]);
    ok(lim.effective === 32768 && lim.requested === 131072, 'clamp: requested 131072, provider cap 32768, context 50000 -> effective 32768', lim);
    ok(A.outputLimit(m[2]).effective === 30000, 'clamp: the figure is the server\'s, not recomputed here (server says 30000)', A.outputLimit(m[2]));
    ok(A.outputLimit(m[3]) === null, 'clamp: no figure from the server = none shown');
    ok(A.filterModels(m, 'small').length === 1 && A.filterModels(m, 'ACME one').length === 1 && A.filterModels(m, '').length === 4 && A.filterModels(m, 'acme/odd')[0].label === 'Server Says', 'model search: label, name and id, every word');
    ok(A.groupNum(1000000, 'en') === '1,000,000' && A.groupNum(32768, 'sv') === '32 768', 'numbers are grouped per language');
  }

  /* ---- the texts ---- */
  {
    const flat = (o, p = '') => Object.keys(o).flatMap((k) => (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? flat(o[k], p + k + '.') : [p + k]));
    const sv = flat(A.STR.sv).sort().join();
    ok(sv === flat(A.STR.en).sort().join() && sv === flat(A.STR.sr).sort().join(), 'texts: every Swedish key exists in English and Serbian');
    const long = ['sv', 'en', 'sr'].flatMap((l) => A.STR[l].ex.filter((e) => e.trim().split(/\s+/).length > 10));
    ok(long.length === 0 && A.STR.sv.ex.length === A.STR.en.ex.length, 'texts: every example is ten words or fewer', long);
    ok(A.STR.sv.keyLabel === 'OpenRouter-nyckel' && A.STR.en.keyLabel === 'OpenRouter key' && A.STR.sr.keyLabel === 'OpenRouter ključ', 'texts: the key field label in three languages');
    ok(A.STR.sv.generate === 'GENERERA' && A.STR.en.generate === 'GENERATE' && A.STR.sv.load === 'Ladda' && A.STR.en.load === 'Load' && A.STR.sr.load === 'Učitaj', 'texts: GENERATE and Load / Ladda / Učitaj');
    ok(['sv', 'en', 'sr'].every((l) => /OpenRouter/.test(A.STR[l].disclosure) && /OpenRouter/.test(A.STR[l].offline) === false && /server/i.test(A.STR[l].offline)), 'texts: the disclosure names OpenRouter; the offline line names the server');
    ok(/[čćžšđ]/.test(JSON.stringify(A.STR.sr)) && !/[Ѐ-ӿ]/.test(JSON.stringify(A.STR.sr)), 'texts: Serbian is Latin script with its diacritics');
    ok(A.stepText('en', { stage: 'refinement', round: 2, maxRounds: 5 }) === 'Refinement, round 2 of 5' && A.stepText('sv', { stage: 'refinement', round: 2, maxRounds: 5 }) === 'Förfining, omgång 2 av 5', 'texts: a refinement step reads "round n of max"');
    ok(!/%/.test(JSON.stringify(A.STR)), 'texts: no percentage anywhere');
    ok(A.errorText('en', 'something_new') === 'The job failed (something_new). Try again.', 'texts: an unknown error code still gets a sentence');
  }

  /* ---- no server ---- */
  {
    const ctl = A.create({ transport: null, host: {} });
    await ctl.refresh();
    ok(ctl.state.phase === 'offline', 'no server: the state is "offline"');
    ok((await ctl.generate('a slot')) === false && (await ctl.saveKey(SECRET)) === false && ctl.state.phase === 'offline', 'no server: Generate and the key do nothing');
  }

  /* ---- the key ---- */
  {
    const r = rig({ key: false });
    await r.ctl.refresh();
    ok(r.ctl.state.key.present === false && r.ctl.state.phase === 'idle', 'missing key: the server says so');
    ok((await r.ctl.generate('a slot 80 long')) === false, 'missing key: Generate is refused here');
    ok(r.of('startJob').length === 0, 'missing key: no job request was made', r.calls.map((c) => c[0]));
    ok(r.ctl.state.error.code === 'no_key' && r.ctl.state.phase === 'idle', 'missing key: the error says where the key goes', r.ctl.state.error);
    ok((await r.ctl.saveKey('   ')) === false && r.of('putKey').length === 0 && r.ctl.state.key.error.code === 'bad_key', 'key: an empty field is not sent');
    const taken = await r.ctl.saveKey('  ' + SECRET + ' ');
    ok(taken === true && r.of('putKey')[0][1] === SECRET, 'key: sent to the server\'s key endpoint, trimmed');
    ok(r.ctl.state.key.present === true && r.ctl.state.key.note === 'saved' && r.ctl.state.error === null, 'key: accepted -> present, the no-key error is gone');
    ok(!JSON.stringify(r.ctl.state).includes(SECRET), 'key: the state never holds the key');
    await r.ctl.removeKey();
    ok(r.of('deleteKey').length === 1 && r.ctl.state.key.present === false && r.ctl.state.key.note === 'removed', 'key: removed through the server');
    const r2 = rig({ key: false, putFails: true });
    await r2.ctl.refresh();
    ok((await r2.ctl.saveKey(SECRET)) === false && r2.ctl.state.key.error.code === 'forbidden' && r2.ctl.state.key.present === false, 'key: a refusal keeps the field and says why');
    const r3 = rig({ refuse: { code: 'no_key', message: 'Set one.' } });
    await start(r3);
    ok(r3.ctl.state.phase === 'idle' && r3.ctl.state.key.present === false && r3.ctl.state.error.code === 'no_key', 'key: the server\'s own no_key answer brings the field back');
  }

  /* ---- a job from start to Load ---- */
  {
    const r = rig();
    await r.ctl.refresh();
    ok(r.ctl.state.model === 'acme/fast-one-v2' && r.ctl.state.catalog.models.length === 4, 'catalog: loaded, the server\'s default model is picked');
    r.ctl.pickModel('acme/small-context'); r.ctl.pickModel('Small Context');
    ok(r.ctl.state.model === 'acme/small-context', 'model: picked by id; a label is not an id');
    ok((await r.ctl.generate('   ')) === false && r.of('startJob').length === 0 && r.ctl.state.error.code === 'prompt_empty', 'an empty description sends nothing');
    const p = r.ctl.generate('a slot 80 long'); await settle();
    const body = r.of('startJob')[0][1];
    ok(body.model === 'acme/small-context' && body.prompt === 'a slot 80 long' && body.machine === '426' && body.system === 'SYSTEM PROMPT' && body.client_measure === true, 'job: the routable id, the prompt, the machine, the system prompt', body);
    ok(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['client_measure', 'machine', 'model', 'prompt', 'system', 'tools']) && JSON.stringify(body.tools) === '[{"t":5,"name":"ENDMILL_12","l":120,"r":6}]', 'job: no reasoning, token or round settings; tools as t, name, l, r', body);
    ok(r.ctl.state.phase === 'running' && r.ctl.state.steps.length === 0, 'job: running, no step shown before the server sends one');
    ok((await r.ctl.generate('again')) === false && r.of('startJob').length === 1, 'job: a second Generate while one runs sends nothing');
    r.st.send(': keepalive\n\n'); job(r); stage(r, 'generation');
    const d = frame('delta', { round: 0, text: 'BEGIN PGM SLOT MM\n' });
    r.st.send(d.slice(0, 9)); r.st.send(d.slice(9, 30)); r.st.send(d.slice(30)); await settle();
    ok(r.ctl.state.job.id === 'job-1' && r.ctl.state.stage === 'generation' && r.ctl.state.text === 'BEGIN PGM SLOT MM\n', 'stream: a keepalive, then an event in three pieces', r.ctl.state.text);
    r.st.send(frame('status', { code: 'reasoning', message: 'The model is reasoning.' })); stage(r, 'validation'); stage(r, 'measurement');
    r.st.send(frame('measure-request', { request_id: 'm1', round: 0, program: GOOD, spec: { blank: {} }, timeout_ms: 30000 })); await settle();
    r.fire((t) => t.ms === 0); await settle();
    ok(r.env.measured.length === 1 && r.env.measured[0][0] === GOOD, 'measure-request: the part measurement ran on the draft');
    const posted = r.of('measure')[0];
    ok(posted && posted[1] === 'job-1' && posted[2].request_id === 'm1' && posted[2].score === 61.5 && posted[2].text === 'S1 SLOT: NOT CUT' && !('pass' in posted[2]), 'measure-request: the result is posted to the job\'s measurement endpoint', posted);
    stage(r, 'refinement', 1); await settle();
    ok(r.ctl.state.text === '' && r.ctl.state.round === 1, 'a refinement stage clears the shown text');
    r.st.send(frame('delta', { round: 1, text: GOOD })); stage(r, 'validation', 1); stage(r, 'measurement', 1); stage(r, 'completion', 1); await settle();
    const steps = r.ctl.state.steps.map((s) => A.stepText('en', s));
    ok(steps.join(' > ') === 'Generation > Validation > Measurement > Refinement, round 1 of 5 > Validation > Measurement > Completion', 'stages and rounds are the server\'s events, in order', steps);
    ok(r.ctl.state.phase === 'running' && r.ctl.state.result === null && r.ctl.load() === null && r.env.loads.length === 0, 'not finished: nothing to load, Load does nothing');
    ok(r.programs['MINE.H'].includes('unsaved edit') && r.env.active === 'MINE.H', 'not finished: the active program is untouched');
    r.env.clock += 42000;
    r.st.send(frame('done', Object.assign({}, DONE, { round: 1, usage: { requests: 2, cost_usd: 0.0123 } }))); r.st.close();
    ok((await p) === true && r.ctl.state.phase === 'done' && r.ctl.state.result.program === GOOD, 'done: the result is ready');
    ok(r.env.loads.length === 0 && r.env.active === 'MINE.H', 'done: still nothing loaded on its own');
    ok(A.announcement('en', r.ctl.state) === A.STR.en.done + ' Time 42 s · cost $0.012', 'done: announced, with the time and the cost of the job', A.announcement('en', r.ctl.state));
    ok(r.ctl.state.meta.ms === 42005 && r.ctl.state.meta.cost === 0.0123 && A.metaText('sv', r.ctl.state.meta) === 'Tid 42 s · kostnad $0.012' && A.metaText('sr', r.ctl.state.meta) === 'Vreme 42 s · cena $0.012', 'done: one line with the elapsed time and the server\'s cost, in three languages', r.ctl.state.meta);
    const name = r.ctl.load();
    ok(name === 'SLOT.H' && r.env.loads.length === 1 && r.env.loads[0] === GOOD, 'Load: the explicit action opens the server\'s program as a new one', name);
    ok(r.programs['MINE.H'].includes('unsaved edit') && Object.keys(r.programs).length === 2, 'Load: the program that was active is still there, unchanged');
    ok(r.ctl.state.loaded.name === 'SLOT.H' && r.ctl.state.loaded.previous === 'MINE.H' && r.ctl.load() === null && r.env.loads.length === 1, 'Load: once');
    r.ctl.dispatch({ type: 'sse', event: { type: 'done', data: DONE } });
    ok(r.ctl.state.loaded.name === 'SLOT.H', 'events after the end change nothing');
    ok(A.freeName('SLOT', ['SLOT.H', 'SLOT_2.H']) === 'SLOT_3.H' && A.programBase('no header') === 'AI_PART', 'names: SLOT.H, SLOT_2.H, SLOT_3.H; AI_PART without a header');
  }

  /* ---- time and cost of a job ---- */
  {
    ok(A.durationText(42000) === '42 s' && A.durationText(400) === '0 s' && A.durationText(95000) === '1 min 35 s' && A.durationText(null) === null && A.durationText(-1) === null, 'time: seconds, minutes from 60 s on, nothing without a figure');
    ok(A.costText(0.0123) === '$0.012' && A.costText(1.5) === '$1.500' && A.costText(0.0004) === '<$0.001' && A.costText(0) === '$0' && A.costText(undefined) === null && A.costText('0.01') === null, 'cost: US$ with three decimals; under a tenth of a cent said as such; not a number = none');
    ok(A.metaText('en', { ms: 42000, cost: null }) === 'Time 42 s' && A.metaText('en', { ms: null, cost: 0.02 }) === 'cost $0.020' && A.metaText('en', null) === '', 'line: the cost is left out when the server sent none');
    const run = (s, a) => A.reduce(s, a);
    let s = run(A.initial(), { type: 'online' });
    s = run(s, { type: 'job/start', at: 1000 });
    const f = run(s, { type: 'sse', at: 8000, event: { type: 'error', data: { code: 'timeout', message: '', retryable: true, usage: { requests: 1, cost_usd: 0.002 } } } });
    ok(f.phase === 'failed' && f.meta.ms === 7000 && f.meta.cost === 0.002 && A.announcement('sv', f) === A.STR.sv.err.timeout + ' Tid 7 s · kostnad $0.002', 'failed job: the cost of the `error` event is shown and announced too', A.announcement('sv', f));
    const cut = run(s, { type: 'stream/end', at: 4000 });
    ok(cut.meta.ms === 3000 && cut.meta.cost === null, 'a stream that just ends: time, no cost', cut.meta);
    ok(run(f, { type: 'again' }).meta === null && run(f, { type: 'mode', mode: 'change' }).meta === null, 'the line goes when the view leaves the job');
    const refused = run(s, { type: 'job/refused', code: 'busy', at: 1500 });
    ok(refused.phase === 'idle' && refused.meta === null, 'a job the server refused never ran: no line');
  }

  /* ---- cancel ---- */
  {
    const r = rig();
    const [p] = await start(r);
    job(r); stage(r, 'generation'); r.st.send(frame('delta', { round: 0, text: 'BEGIN PGM SLOT MM\nL X+1' })); await settle();
    const before = r.calls.length;
    ok(r.ctl.cancel() === true && r.ctl.state.phase === 'cancelling', 'cancel: the state says so at once');
    ok(r.ctl.cancel() === false, 'cancel: a second press does nothing');
    await settle();
    r.st.send(frame('measure-request', { request_id: 'm9', round: 0, program: GOOD, spec: null, timeout_ms: 30000 })); stage(r, 'refinement', 1); await settle();
    r.fire((t) => t.ms === 0); await settle();
    ok((await r.ctl.generate('another')) === false, 'cancel: no new job while the cancel is on its way');
    const after = r.calls.slice(before).map((c) => c[0]);
    ok(after.join() === 'cancel' && r.env.measured.length === 0, 'cancel: one cancel call, then no further request', after);
    r.st.send(frame('done', DONE)); r.st.close(); await p; await settle();
    ok(r.ctl.state.phase === 'failed' && r.ctl.state.error.code === 'cancelled' && r.ctl.state.result === null, 'cancel: a late "done" does not make the job ready', r.ctl.state.error);
    ok(r.ctl.load() === null && r.env.loads.length === 0 && r.env.active === 'MINE.H', 'cancel: nothing is loaded, Load is not there');
    ok(r.calls.slice(before).map((c) => c[0]).join() === 'cancel', 'cancel: still no further request');

    const r2 = rig();
    const [p2] = await start(r2);
    job(r2); stage(r2, 'generation'); await settle();
    r2.ctl.cancel(); await settle();
    r2.st.send(frame('error', { code: 'cancelled', message: 'The job was cancelled.', retryable: false, draft: { program: 'BEGIN PGM D MM', round: 0, truncated: true } })); r2.st.close(); await p2;
    ok(r2.ctl.state.error.code === 'cancelled' && r2.ctl.state.draft.program === 'BEGIN PGM D MM' && r2.ctl.state.phase === 'failed', 'cancel: the server\'s draft so far is kept');
    const again = r2.ctl.state.phase === 'failed' && r2.ctl.state.key.present === true;
    ok(again, 'cancel: Generate is available again');

    const r3 = rig();
    const [p3] = await start(r3);
    job(r3); await settle();
    r3.ctl.cancel(); await settle();
    r3.fire((t) => t.ms === A.CANCEL_GRACE_MS); await p3;
    ok(r3.ctl.state.phase === 'failed' && r3.ctl.state.error.code === 'cancelled', 'cancel: a stream that does not end is closed here after the grace time');
  }

  /* ---- failures keep the draft and never read "ready" ---- */
  {
    const r = rig();
    const [p] = await start(r);
    job(r); stage(r, 'generation'); stage(r, 'validation'); stage(r, 'measurement'); stage(r, 'refinement', 5); stage(r, 'validation', 5);
    const msg = 'The program still fails the check after 5 repair round(s): BLOCK 5 `L Z-10 R0 FMAX`: RAPID TRAVERSE INTO MATERIAL.';
    r.st.send(frame('error', { code: 'validation_failed', message: msg, retryable: true, draft: { program: 'BEGIN PGM BAD MM\nL Z-10 R0 FMAX\nEND PGM BAD MM', round: 3, truncated: false, validation: { ok: false } } })); r.st.close();
    ok((await p) === false && r.ctl.state.phase === 'failed', 'validation failure: the job is failed, not done');
    ok(r.ctl.state.draft.program.includes('L Z-10 R0 FMAX') && r.ctl.state.text === r.ctl.state.draft.program, 'validation failure: the draft is kept and shown');
    ok(r.ctl.state.error.code === 'validation_failed' && r.ctl.state.error.message === msg && r.ctl.state.error.retryable === true, 'validation failure: the server\'s reason is kept');
    const shown = A.errorText('en', r.ctl.state.error.code), said = A.announcement('en', r.ctl.state);
    ok(/did not pass the check/.test(shown) && /Change the description or pick another model/.test(shown) && !/ready|passed the check/i.test(shown + said), 'validation failure: a short error that says what to do, never "ready"', shown);
    ok(r.ctl.state.result === null && r.ctl.load() === null && r.env.loads.length === 0, 'validation failure: nothing can be loaded');
    ok(r.ctl.state.meta && r.ctl.state.meta.cost === null && A.metaText('en', r.ctl.state.meta) === 'Time 0 s' && said.endsWith(' Time 0 s'), 'failed job: the time is shown and announced; no cost from the server = no cost in the line', [r.ctl.state.meta, said]);
    const q = r.ctl.generate('a slot, again'); await settle();
    ok(r.of('startJob').length === 2 && r.ctl.state.phase === 'running' && r.ctl.state.draft === null && r.ctl.state.error === null, 'after a failure Generate starts a fresh job');
    ok(r.ctl.state.meta === null, 'a fresh job: the line about the last job is gone');
    r.st.close(); await q;
  }
  {
    const r = rig();
    const [p] = await start(r);
    job(r); stage(r, 'generation'); r.st.send(frame('delta', { round: 0, text: 'BEGIN PGM SLOT MM\nL X+10' })); r.st.send('event: delta\ndata: {"round":0,"te'); r.st.close();
    ok((await p) === false && r.ctl.state.phase === 'failed' && r.ctl.state.error.code === 'stream_ended', 'truncated stream: no "done" or "error" -> a failure', r.ctl.state.error);
    ok(r.ctl.state.draft.truncated === true && r.ctl.state.draft.program === 'BEGIN PGM SLOT MM\nL X+10' && r.ctl.load() === null, 'truncated stream: the text so far is kept as a cut-off draft, not loadable');
  }
  {
    const r = rig();
    const [p] = await start(r);
    job(r); stage(r, 'generation'); r.st.send(frame('delta', { round: 0, text: 'BEGIN PGM SLOT MM\n' }));
    r.st.send(frame('error', { code: 'upstream_error', message: 'The provider failed mid-answer (502). Nothing was retried.', retryable: true, draft: { program: 'BEGIN PGM SLOT MM', round: 0, truncated: true, validation: null, measurement: null } })); r.st.close(); await p;
    ok(r.ctl.state.phase === 'failed' && r.ctl.state.error.code === 'upstream_error' && r.ctl.state.draft.truncated === true, 'mid-stream error event: failed, the partial draft kept');
    ok(r.of('startJob').length === 1 && r.of('cancel').length === 0, 'mid-stream error: nothing is retried from here');

    const r2 = rig();
    const [p2] = await start(r2);
    job(r2); stage(r2, 'generation'); r2.st.send(frame('delta', { round: 0, text: 'BEGIN PGM' })); await settle();
    r2.st.fail(new Error('connection reset')); await p2;
    ok(r2.ctl.state.phase === 'failed' && r2.ctl.state.error.code === 'network' && r2.ctl.state.draft.program === 'BEGIN PGM', 'mid-stream connection loss: failed, the text so far kept');

    const r3 = rig();
    const [p3] = await start(r3);
    job(r3); stage(r3, 'generation'); await settle();
    r3.fire((t) => t.ms === A.IDLE_MS); await p3;
    ok(r3.ctl.state.phase === 'failed' && r3.ctl.state.error.code === 'client_timeout' && r3.ctl.load() === null, 'timeout: a silent stream is stopped here', r3.ctl.state.error);

    const r4 = rig();
    const [p4] = await start(r4);
    job(r4); stage(r4, 'generation');
    r4.st.send(frame('error', { code: 'timeout', message: 'The provider sent nothing for 120 s.', retryable: true, draft: null })); r4.st.close(); await p4;
    ok(r4.ctl.state.error.code === 'timeout' && r4.ctl.state.draft === null && /Try again/.test(A.errorText('en', 'timeout')), 'timeout from the server: shown as such');

    const r5 = rig();
    const [p5] = await start(r5);
    job(r5); r5.st.send(frame('done', Object.assign({}, DONE, { accepted: false }))); r5.st.close(); await p5;
    ok(r5.ctl.state.phase === 'failed' && r5.ctl.state.result === null, 'a "done" that is not accepted is not a result');

    const r6 = rig({ refuse: { code: 'busy', message: 'A job is running.' } });
    await start(r6);
    ok(r6.ctl.state.phase === 'idle' && r6.ctl.state.error.code === 'busy' && r6.ctl.load() === null, 'a refusal before the stream: back to idle with the reason');
  }

  /* ---- change current: the open program is the base, Load changes it as one undo step ---- */
  {
    const r = rig();
    await r.ctl.refresh();
    ok(r.ctl.state.mode === 'new', 'mode: a new program is the default');
    r.ctl.setMode('sideways');
    ok(r.ctl.state.mode === 'new', 'mode: only "new" and "change" exist');
    r.ctl.setMode('change');
    const original = r.programs['MINE.H'];
    const [p] = await start(r, 'make the slot end at X+80');
    const body = r.of('startJob')[0][1];
    ok(body.base_program && body.base_program.name === 'MINE.H' && body.base_program.text === original && body.base_program.machine === '426' && body.prompt === 'make the slot end at X+80', 'change: the job carries the open program (name, text, machine) and the wish', body.base_program);
    ok(JSON.stringify(Object.keys(body.base_program).sort()) === '["machine","name","text"]' && body.client_measure === true && body.model === 'acme/fast-one-v2', 'change: otherwise the same job as for a new program', Object.keys(body));
    r.ctl.setMode('new');
    ok(r.ctl.state.mode === 'change' && r.ctl.state.base.name === 'MINE.H', 'change: the mode cannot be switched while the job runs');
    job(r); stage(r, 'generation'); stage(r, 'validation'); stage(r, 'measurement'); stage(r, 'refinement', 1); stage(r, 'validation', 1); stage(r, 'measurement', 1); stage(r, 'completion', 1); await settle();
    ok(r.ctl.state.steps.map((s) => A.stepText('en', s)).join(' > ') === 'Generation > Validation > Measurement > Refinement, round 1 of 5 > Validation > Measurement > Completion', 'change: progress and rounds are the same events');
    r.env.active = 'OTHER.H'; r.programs['OTHER.H'] = 'BEGIN PGM OTHER MM\nEND PGM OTHER MM';     // the operator opened another program meanwhile
    r.st.send(frame('done', DONE)); r.st.close(); await p;
    ok(r.ctl.state.phase === 'done' && r.programs['MINE.H'] === original && r.env.changes.length === 0 && r.env.loads.length === 0, 'change: done, and the program is still untouched');
    const name = r.ctl.load();
    ok(name === 'MINE.H' && r.env.changes.length === 1 && r.env.changes[0][0] === 'MINE.H' && r.env.changes[0][1] === GOOD && r.env.loads.length === 0, 'change: Load puts the result into the program the job started from, not into whatever is open now', r.env.changes);
    ok(r.env.undo.length === 1 && r.env.undo[0][1] === original && r.programs['OTHER.H'].includes('OTHER') && Object.keys(r.programs).length === 2, 'change: one undo step holds the original; no program was added, none lost');
    ok(r.ctl.state.loaded.changed === true && A.announcement('en', r.ctl.state) === 'MINE.H is changed. Ctrl+Z brings the original back.' && r.ctl.load() === null && r.env.changes.length === 1, 'change: said so, once', A.announcement('en', r.ctl.state));

    const r2 = rig({ noBase: true });
    await r2.ctl.refresh(); r2.ctl.setMode('change');
    ok((await r2.ctl.generate('deeper')) === false && r2.of('startJob').length === 0 && r2.ctl.state.error.code === 'base_empty', 'change: no open program -> nothing is sent');

    const r3 = rig();
    const [p3] = await start(r3);
    ok(!('base_program' in r3.of('startJob')[0][1]), 'new: no base program is sent');
    job(r3); r3.st.send(frame('done', DONE)); r3.st.close(); await p3;
    r3.ctl.setMode('change');
    ok(r3.ctl.state.phase === 'idle' && r3.ctl.state.result === null && r3.ctl.load() === null && r3.env.loads.length === 0 && r3.env.changes.length === 0, 'switching the mode drops a result that was waiting: a "new" result can never be loaded over the open program');

    const r4 = rig();
    r4.ctl.dispatch({ type: 'online' }); await r4.ctl.refresh(); r4.ctl.setMode('change');
    const [p4] = await start(r4, 'deeper');
    job(r4); stage(r4, 'generation'); await settle();
    r4.ctl.cancel(); await settle();
    r4.st.send(frame('error', { code: 'cancelled', message: '', retryable: false, draft: null })); r4.st.close(); await p4;
    ok(r4.ctl.state.error.code === 'cancelled' && r4.ctl.load() === null && r4.env.changes.length === 0 && r4.programs['MINE.H'].includes('unsaved edit'), 'change: cancel leaves the program as it was');
  }

  /* ---- a job the server stopped on a plateau ---- */
  {
    const r = rig();
    const [p] = await start(r);
    job(r); stage(r, 'generation'); stage(r, 'refinement', 1);
    r.st.send(frame('status', { code: 'plateau', message: 'The match stopped improving: best 88.7 % before, 88.7 % in round 1.' }));
    r.st.send(frame('done', Object.assign({}, DONE, { round: 1, stopped: 'plateau', measurement: { native: {}, client: { score: 88.7, pass: null, text: null } } }))); r.st.close(); await p;
    ok(r.ctl.state.phase === 'done' && r.ctl.state.result.stopped === 'plateau' && r.ctl.state.steps.length === 2, 'plateau: the job ends after the round the server stopped at, with a result');
    ok(A.statusText('en', r.ctl.state.lines[r.ctl.state.lines.length - 1]).startsWith('Refinement stopped: The match stopped improving') && A.statusText('sv', { code: 'plateau', message: 'x' }) === 'Förfiningen stoppades: x', 'plateau: the status line says refinement stopped');
    ok(/\{s\} percent \(goal \{g\}\)/.test(A.STR.en.donePlateau) && /did not improve/.test(A.STR.en.donePlateau), 'plateau: the result line gives the match and the goal');
  }

  /* ---- measurement inside the server's time ---- */
  {
    const r = rig({ measureTakes: 800 });
    const [p] = await start(r);
    job(r); stage(r, 'measurement');
    r.st.send(frame('measure-request', { request_id: 'slow', round: 0, program: GOOD, spec: { blank: {} }, timeout_ms: 700 })); await settle();
    r.fire((t) => t.ms === 0); await settle();
    ok(r.env.measured.length === 1 && r.of('measure').length === 0, 'measurement: a result that is later than the server\'s timeout is not posted');
    r.st.send(frame('done', DONE)); r.st.close(); await p;

    const r2 = rig({ measure: () => null });
    const [p2] = await start(r2);
    job(r2); r2.st.send(frame('measure-request', { request_id: 'm2', round: 0, program: GOOD, spec: null, timeout_ms: 30000 })); await settle();
    r2.fire((t) => t.ms === 0); await settle();
    ok(JSON.stringify(r2.of('measure')[0][2]) === '{"request_id":"m2"}', 'measurement: nothing to compare with -> answered at once without a score, the server does not wait', r2.of('measure')[0]);
    r2.st.send(frame('done', DONE)); r2.st.close(); await p2;

    const r3 = rig({ measure: null });
    await start(r3);
    ok(r3.of('startJob')[0][1].client_measure === false, 'measurement: a page that cannot measure does not ask for the hook');
    r3.st.close();
  }

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
