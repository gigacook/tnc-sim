/* The AI loop against a MOCKED OpenRouter (no network, no key): a cut-off answer is continued, the part spec is
   planned and expanded, the first program is measured short, the measurement goes back, the refined program wins.
   Then the repair loop without a plan (repairLoop, part 2).
   node tests/ai/loop.js */
const T = require('../../sim/core.js'), SIM = require('../../sim/sim.js'), PART = require('../../sim/part.js'), AI = require('../../sim/ai.js');
let fails = 0;
const ok = (c, m, d) => { console.log((c ? '  ok    ' : '  FAIL  ') + m + (c ? '' : '  (' + d + ')')); if (!c) fails++; };

const SPEC = { blank: { x: [0, 100], y: [0, 60], z: [-10, 0] }, features: [{ id: 'S1', type: 'slot', from: [20, 30], to: [80, 30], w: 6, z: -2 }] };
const prog = (x1) => ['BEGIN PGM SLOT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-10', 'BLK FORM 0.2 X+100 Y+60 Z+0', 'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3',
  'L X+20 Y+30 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-1 R0 F150', `L X+${x1} R0 F500`, 'L Z-2 R0 F150', 'L X+20 R0 F500', 'L Z+50 R0 FMAX M5', 'M30', 'END PGM SLOT MM'].join('\n');
const answers = [
  { text: '```partspec\n' + JSON.stringify(SPEC) + '\n```' },                       // plan
  { text: '```klartext\n' + prog(50).slice(0, 120), finish: 'length' },                // write, cut off at max_tokens …
  { text: prog(50).slice(120) + '\n```' },                                           // … continued
  { text: '```klartext\n' + prog(80) + '\n```' },                                    // refine after the measurement
];
const sent = [];
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body); sent.push(body);
  const a = answers.shift();
  const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: a.text }, finish_reason: a.finish || 'stop' }] }), 'data: ' + JSON.stringify({ choices: [], usage: { cost: 0.001 } }), 'data: [DONE]', ''];
  const enc = new TextEncoder().encode(chunks.join('\n\n'));
  let done = false;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (done ? { done: true } : (done = true, { done: false, value: enc })) }) } };
};
const tools = T.TOOLS;
const verify = (src) => { const r = T.run(src, { tools }); const ex = SIM.expand(r); const ev = SIM.analyse(r, ex, SIM.grid(r.stock, ex.segs));
  const errs = r.errors.map((e) => e.msg), crashes = ev.filter((e) => e.sev === 'crash').map((e) => e.msg);
  return { ok: !errs.length && !crashes.length, errs, crashes, warns: [], text: errs.concat(crashes).join('\n') }; };
const measure = (spec, src) => { const r = T.run(src, { tools }); return r.errors.length ? null : PART.compare(spec, r, SIM.expand(r)); };
const steps = [];
(async () => {
  const res = await AI.generate({ key: 'k', model: 'm', prompt: 'a slot', tools, verify, measure, plan: true, rounds: 2, maxTokens: 32000, onStep: (s) => steps.push(s) });
  ok(sent.length === 4, 'plan + write + continuation + refine = 4 requests', sent.length);
  ok(sent[0].max_tokens === 32000, 'the requested token budget is sent', sent[0].max_tokens);
  ok(/STEP 1 of 2/.test(sent[0].messages[1].content), 'the first request asks for the part spec');
  ok(/S1 SLOT/.test(sent[1].messages[3].content), 'the write request carries the expanded spec sheet');
  ok(/cut off by the length limit/.test(sent[2].messages[sent[2].messages.length - 1].content), 'a cut-off answer is continued');
  ok(steps.some((s) => s.phase === 'continued'), 'the UI hears about the continuation');
  const m1 = steps.filter((s) => s.phase === 'measured');
  ok(m1.length === 2 && m1[0].measure.score < 70, 'the half-length slot is measured short', m1[0] && m1[0].measure.score);
  ok(/NOT CUT/.test(sent[3].messages[sent[3].messages.length - 1].content), 'the measurement goes back to the model');
  ok(res.measure.score > 95 && /X\+80/.test(res.src), 'the refined, full-length slot is the result', res.measure.score);
  ok(Math.abs(res.cost - 0.004) < 1e-9, 'cost adds up over all requests', res.cost);
  // a refinement round that fails keeps the best program so far
  answers.push({ text: '```partspec\n' + JSON.stringify(SPEC) + '\n```' }, { text: '```klartext\n' + prog(50) + '\n```' });
  const realFetch = global.fetch; let n = 0;
  global.fetch = async (u, i) => { if (++n === 3) throw new Error('TIMED OUT'); return realFetch(u, i); };
  const steps2 = [];
  const res2 = await AI.generate({ key: 'k', model: 'm', prompt: 'a slot', tools, verify, measure, plan: true, rounds: 2, onStep: (s) => steps2.push(s) });
  ok(res2 && /X\+50/.test(res2.src) && steps2.some((s) => s.phase === 'failed'), 'a failed refinement returns the best program so far');
  // a dropped connection is retried once
  answers.push({ text: '```klartext\n' + prog(80) + '\n```' });
  let drop = 1; const f2 = global.fetch;
  global.fetch = async (u, i) => { if (drop-- > 0) { const e = new TypeError('Network connection lost.'); throw e; } return f2(u, i); };
  const steps3 = [];
  const res3 = await AI.generate({ key: 'k', model: 'm', prompt: 'x', tools, verify, rounds: 0, retryDelayMs: 0, onStep: (s) => steps3.push(s) });
  ok(res3 && /X\+80/.test(res3.src) && steps3.some((s) => s.phase === 'continued' && s.network), 'a dropped connection is retried once');
  await repairLoop();
  console.log(fails ? `\n${fails} FAILED` : '\nALL AI LOOP CHECKS PASS (mocked, no network)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/* Part 2, plan off: the repair loop. Each round sends the best program so far with the simulator's report (blocks quoted,
   hints), the user can stop between rounds, a cut-off answer is continued, a program that only cuts air is rejected.
   rounds = refinements after the first answer: rounds 4 = 5 answers. */
async function repairLoop() {
  console.log('\nrepair loop (no plan)');
  const head = ['BEGIN PGM SLOT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+60 Z+0', 'TOOL CALL 4 Z S3000'];
  const tail = ['L Z+50 R0 FMAX M5', 'M30', 'END PGM SLOT MM'];
  const good = head.concat(['L Z+50 R0 FMAX M3', 'L X+20 Y+30 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-2 R0 F150', 'L X+80 R0 F500'], tail).join('\n');
  const rapid = head.concat(['L Z+50 R0 FMAX M3', 'L X+20 Y+30 R0 FMAX', 'L Z-2 R0 FMAX', 'L X+80 R0 F500'], tail).join('\n');   // FMAX into the blank
  const bad2 = head.concat(['L Z+50 R0 FMAX M3', 'L X+20 Y+30 R0 FMAX', 'L Z-2 R0 FMAX', 'L X+80 R0 FMAX', 'L FOO'], tail).join('\n');
  const air = head.concat(['L Z+50 R0 FMAX M3', 'L X+20 Y+30 Z+10 R0 F500', 'L X+80 R0 F500'], tail).join('\n');            // mills air

  const verify = (src) => {
    const r = T.run(src, { tools: T.TOOLS }); const ex = SIM.expand(r); const ev = SIM.analyse(r, ex, SIM.grid(r.stock, ex.segs));
    const q = (i) => { const b = r.blocks[i]; return b ? `BLOCK ${b.n} \`${b.raw.trim()}\`` : 'BLOCK ?'; };
    const errs = r.errors.map((e) => q(e.block) + ': ' + e.msg), crashes = ev.filter((e) => e.sev === 'crash').map((e) => q(e.block) + ': ' + e.msg), warns = [];
    if (!r.errors.length) { const c = AI.cutCheck(r, ev); if (c && c.err) errs.push(c.err); if (c && c.warn) warns.push(c.warn); }
    return { ok: !errs.length && !crashes.length, errs, crashes, warns, text: errs.concat(crashes).join('\n') };
  };

  let answers = [], sent = [];
  const mock = async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    const a = answers.shift();
    const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: a.text }, finish_reason: a.finish || 'stop' }] }), 'data: ' + JSON.stringify({ choices: [], usage: { cost: 0.001 } }), 'data: [DONE]', ''];
    const enc = new TextEncoder().encode(chunks.join('\n\n')); let done = false;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (done ? { done: true } : (done = true, { done: false, value: enc })) }) } };
  };
  global.fetch = mock;
  const fence = (s) => '```klartext\n' + s + '\n```';
  const last = (b) => b.messages[b.messages.length - 1].content;

    // 1. fails three times, passes in round 4; every round carries ONE program back, never the whole history
    answers = [{ text: fence(rapid) }, { text: fence(bad2) }, { text: 'Here you go:\n' + fence(air) }, { text: fence(good) }];
    sent = []; const asked = [];
    let res = await AI.generate({ key: 'k', model: 'm', prompt: 'a slot', tools: T.TOOLS, verify, rounds: 4, confirm: (q) => { asked.push(q.round); return Promise.resolve(true); } });
    ok(res.report.ok && res.round === 4 && sent.length === 4, 'passes in round 4 of 5', JSON.stringify({ ok: res.report.ok, round: res.round, n: sent.length }));
    ok(asked.join() === '1,2,3', 'asked after rounds 1, 2 and 3', asked.join());
    ok(sent.slice(1).every((b) => b.messages.length === 4), 'every repair request = system + task + one program + report');
    ok(/RAPID TRAVERSE INTO MATERIAL/.test(last(sent[1])) && /`L Z-2 R0 FMAX`/.test(last(sent[1])), 'the report quotes the offending block');
    ok(/-> FMAX only at Z\+2/.test(last(sent[1])), 'the report carries a fix hint');
    ok(/ROUND 2 of 5/.test(last(sent[1])), 'the model is told which round it is');
    ok(sent[2].messages[2].content.includes('L Z-2 R0 FMAX\nL X+80 R0 F500'), 'round 3 continues from the best program (round 1), not the worse round 2');
    ok(/round 2\) was worse/.test(last(sent[2])), '… and is told its newest version was worse');
    ok(/REMOVES NO MATERIAL/.test(last(sent[3])), 'a program that only cuts air is rejected and explained');

    // 2. the user stops after round 2: the best program so far comes back, marked stopped
    answers = [{ text: fence(bad2) }, { text: fence(rapid) }];
    sent = [];
    res = await AI.generate({ key: 'k', model: 'm', prompt: 'x', tools: T.TOOLS, verify, rounds: 4, confirm: (q) => Promise.resolve(q.round < 2) });
    ok(res.stopped && sent.length === 2 && res.round === 2 && !res.report.ok, 'stop after round 2 returns the best so far', JSON.stringify({ s: res.stopped, n: sent.length, r: res.round }));

    // 3. never more than 5 rounds; no confirm = auto
    answers = [1, 2, 3, 4, 5, 6].map(() => ({ text: fence(rapid) }));
    sent = [];
    res = await AI.generate({ key: 'k', model: 'm', prompt: 'x', tools: T.TOOLS, verify, rounds: 4 });
    ok(sent.length === 5 && !res.report.ok && !res.stopped, 'auto: 5 rounds at most, then the best program', sent.length);
    answers = [];

    // 4. a cut-off answer is continued and joined; an unclosed fence still parses
    answers = [{ text: '```klartext\n' + good.slice(0, 90), finish: 'length' }, { text: good.slice(90) }];
    sent = [];
    res = await AI.generate({ key: 'k', model: 'm', prompt: 'x', tools: T.TOOLS, verify, rounds: 4 });
    ok(res.report.ok && sent.length === 2 && /cut off/.test(last(sent[1])), 'a cut-off answer is continued');

    // 5. extraction: block numbers, lower case, typographic minus, END PGM fixed, last program wins
    const ex = AI.extract('old:\n```\nBEGIN PGM OLD MM\nEND PGM OLD MM\n```\nnew:\n```nc\n0 begin pgm new mm\n1 blk form 0.1 z x+0 y+0 z−20 ; Keep\nM30\nEND PGM X MM\n```');
    ok(ex === 'BEGIN PGM NEW MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20 ; Keep\nM30\nEND PGM NEW MM', 'extract + normalize', JSON.stringify(ex));
    ok(AI.extract('```klartext\nBEGIN PGM CUT MM\nL X+1') === 'BEGIN PGM CUT MM\nL X+1\nEND PGM CUT MM', 'an answer cut off before END PGM is closed');

    // 6. the system prompt's templates run clean
    const sys = AI.system(T.TOOLS, { sMax: 3000, fMax: 1500 });
    ok(/BALL_6/.test(sys) && /500 mm cube/.test(sys) && /Milling only REMOVES material/.test(sys), 'prompt: tools, 500 mm blanks, subtractive rule');
}
