/* The AI repair loop against a MOCKED OpenRouter (no network, no key): up to 5 rounds, each round sends the best
   program so far with the simulator's report (blocks quoted, hints), the user can stop between rounds, a cut-off
   answer is continued, a program that only cuts air is rejected.   node tests/ai-loop.js */
const T = require('../sim/core.js'), SIM = require('../sim/sim.js'), AI = require('../sim/ai.js');
let fails = 0;
const ok = (c, m, d) => { console.log((c ? '  ok    ' : '  FAIL  ') + m + (c ? '' : '  (' + d + ')')); if (!c) fails++; };

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
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body); sent.push(body);
  const a = answers.shift();
  const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: a.text }, finish_reason: a.finish || 'stop' }] }), 'data: ' + JSON.stringify({ choices: [], usage: { cost: 0.001 } }), 'data: [DONE]', ''];
  const enc = new TextEncoder().encode(chunks.join('\n\n')); let done = false;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (done ? { done: true } : (done = true, { done: false, value: enc })) }) } };
};
const fence = (s) => '```klartext\n' + s + '\n```';
const last = (b) => b.messages[b.messages.length - 1].content;

(async () => {
  // 1. fails three times, passes in round 4; every round carries ONE program back, never the whole history
  answers = [{ text: fence(rapid) }, { text: fence(bad2) }, { text: 'Here you go:\n' + fence(air) }, { text: fence(good) }];
  sent = []; const asked = [];
  let res = await AI.generate({ key: 'k', model: 'm', prompt: 'a slot', tools: T.TOOLS, verify, rounds: 5, confirm: (q) => { asked.push(q.round); return Promise.resolve(true); } });
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
  res = await AI.generate({ key: 'k', model: 'm', prompt: 'x', tools: T.TOOLS, verify, rounds: 5, confirm: (q) => Promise.resolve(q.round < 2) });
  ok(res.stopped && sent.length === 2 && res.round === 2 && !res.report.ok, 'stop after round 2 returns the best so far', JSON.stringify({ s: res.stopped, n: sent.length, r: res.round }));

  // 3. never more than 5 rounds; no confirm = auto
  answers = [1, 2, 3, 4, 5, 6].map(() => ({ text: fence(rapid) }));
  sent = [];
  res = await AI.generate({ key: 'k', model: 'm', prompt: 'x', tools: T.TOOLS, verify, rounds: 5 });
  ok(sent.length === 5 && !res.report.ok && !res.stopped, 'auto: 5 rounds at most, then the best program', sent.length);
  answers = [];

  // 4. a cut-off answer is continued and joined; an unclosed fence still parses
  answers = [{ text: '```klartext\n' + good.slice(0, 90), finish: 'length' }, { text: good.slice(90) }];
  sent = [];
  res = await AI.generate({ key: 'k', model: 'm', prompt: 'x', tools: T.TOOLS, verify, rounds: 5 });
  ok(res.report.ok && sent.length === 2 && /cut off/.test(last(sent[1])), 'a cut-off answer is continued');

  // 5. extraction: block numbers, lower case, typographic minus, END PGM fixed, last program wins
  const ex = AI.extract('old:\n```\nBEGIN PGM OLD MM\nEND PGM OLD MM\n```\nnew:\n```nc\n0 begin pgm new mm\n1 blk form 0.1 z x+0 y+0 z−20 ; Keep\nM30\nEND PGM X MM\n```');
  ok(ex === 'BEGIN PGM NEW MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20 ; Keep\nM30\nEND PGM NEW MM', 'extract + normalize', JSON.stringify(ex));
  ok(AI.extract('```klartext\nBEGIN PGM CUT MM\nL X+1') === 'BEGIN PGM CUT MM\nL X+1\nEND PGM CUT MM', 'an answer cut off before END PGM is closed');

  // 6. the system prompt's templates run clean
  const sys = AI.system(T.TOOLS, { sMax: 3000, fMax: 1500 });
  ok(/BALL_6/.test(sys) && /500 mm cube/.test(sys) && /Milling only REMOVES material/.test(sys), 'prompt: tools, 500 mm blanks, subtractive rule');

  console.log(fails ? `\n${fails} FAILED` : '\nALL AI LOOP CHECKS PASS (mocked, no network)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
