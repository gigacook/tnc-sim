/* The server's AI generation API, end to end against a MOCK PROVIDER (tests/ai/server-mock-provider.mjs):
   the real tnc-server binary, a fake OpenRouter on 127.0.0.1, no real network, no API credit.

   Build the server first:  cargo build --manifest-path server/Cargo.toml -p tnc-server
   Run:                     node tests/ai/server-job.mjs
   The binary is found through TNC_SERVER_BIN, else CARGO_TARGET_DIR/debug, else server/target/debug.
   Ports come from the machine's port catalog (range "dev") when it is installed, else from the OS. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MOCK_KEY, startMock } from './server-mock-provider.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXE = process.platform === 'win32' ? 'tnc-server.exe' : 'tnc-server';

function serverBin() {
  const tries = [
    process.env.TNC_SERVER_BIN,
    process.env.CARGO_TARGET_DIR && path.join(process.env.CARGO_TARGET_DIR, 'debug', EXE),
    path.join(ROOT, 'server', 'target', 'debug', EXE),
  ].filter(Boolean);
  const found = tries.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`tnc-server binary not found (looked in ${tries.join(', ')}). Build it: cargo build --manifest-path server/Cargo.toml -p tnc-server`);
  return found;
}

/* a free port from the port catalog; 0 (the OS picks) where the catalog is not installed */
function catalogPort() {
  const script = path.join(os.homedir(), 'gigacook', 'core', 'infra', 'scripts', 'catalog.mjs');
  if (!fs.existsSync(script)) return 0;
  try {
    const n = Number(execFileSync(process.execPath, [script, '--free', 'dev'], { encoding: 'utf8' }).trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function osPort() {
  return new Promise((resolve, reject) => {
    import('node:net').then(({ createServer }) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, cond, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/* ---------- programs ---------- */
const fence = (s) => `\`\`\`klartext\n${s}\n\`\`\``;
const GOOD = ['BEGIN PGM SLOT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+100 Z+0', '; slot with the Ø12 cutter', 'TOOL CALL 5 Z S3000', 'L Z+50 R0 FMAX M3',
  'L X+10 Y+10 R0 FMAX', 'L Z-2 R0 F200', 'L X+90 F500', 'L Z+50 R0 FMAX M2', 'END PGM SLOT MM'].join('\n');
/* FMAX straight down into the blank: a crash in the interpreter's safety analysis */
const BAD = ['BEGIN PGM SLOT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+100 Z+0', 'TOOL CALL 5 Z S3000', 'L X+50 Y+50 Z+50 R0 FMAX M3',
  'L Z-10 R0 FMAX', 'L Z+50 R0 FMAX M2', 'END PGM SLOT MM'].join('\n');

/* ---------- the server under test ---------- */
let mock, proc, base, admin, dataDir;
let serverLog = '';
const MODEL = 'mock/fast-one-v2';

async function api(method, route, { token = admin, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

/* Starts a job and reads its event stream to the end. onEvent(event, job) may act on the job (cancel, post a
   measurement, abort). Resolves {status, json, events, jobId, types}. */
async function job(body, { onEvent, signal, token = admin } = {}) {
  const res = await fetch(`${base}/api/v1/ai/jobs`, {
    method: 'POST', signal,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = { status: res.status, json: null, events: [], jobId: res.headers.get('x-job-id'), contentType: res.headers.get('content-type') };
  if (!String(out.contentType).startsWith('text/event-stream')) {
    out.json = await res.json();
    return out;
  }
  const dec = new TextDecoder();
  let buf = '';
  let aborted = false;
  try {
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true });
      for (;;) {
        const end = buf.indexOf('\n\n');
        if (end < 0) break;
        const block = buf.slice(0, end);
        buf = buf.slice(end + 2);
        let type = 'message';
        const data = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (!data.length) continue; // a keepalive comment
        const ev = { type, data: JSON.parse(data.join('\n')) };
        out.events.push(ev);
        if (onEvent) await onEvent(ev, out);
      }
    }
  } catch (e) {
    if (!signal?.aborted) throw e;
    aborted = true;
  }
  out.aborted = aborted;
  out.types = out.events.map((e) => e.type);
  out.of = (type) => out.events.filter((e) => e.type === type).map((e) => e.data);
  out.last = out.events[out.events.length - 1];
  out.stages = out.of('stage').map((s) => (s.stage === 'refinement' ? `refinement ${s.round}/${s.max_rounds}` : s.stage));
  return out;
}

before(async () => {
  mock = await startMock(catalogPort());
  const port = catalogPort() || (await osPort());
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnc-ai-test-'));
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY; // the test starts without any key
  Object.assign(env, {
    TNC_BIND: `127.0.0.1:${port}`, TNC_DATA_DIR: dataDir, TNC_WEB_DIR: path.join(dataDir, 'no-web'), TNC_SIM_FILE: path.join(dataDir, 'no-sim.html'),
    TNC_OPENROUTER_BASE: mock.url, TNC_AI_DEFAULT_MODEL: MODEL, TNC_AI_MODELS: '', TNC_AI_MAX_TOKENS: '0', TNC_AI_MONTHLY_BUDGET_USD: '5',
    TNC_AI_RETRY_DELAY_MS: '50', TNC_AI_IDLE_TIMEOUT_MS: '1500', TNC_AI_MEASURE_TIMEOUT_MS: '700', TNC_AI_JOB_TIMEOUT_MS: '60000',
    RUST_LOG: 'tnc_server=debug,tower_http=debug',
  });
  proc = spawn(serverBin(), ['serve'], { env, cwd: dataDir, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { serverLog += d; });
  proc.stderr.on('data', (d) => { serverLog += d; });
  await until('the server to answer /api/health', async () => {
    try {
      return (await fetch(`${base}/api/health`)).ok;
    } catch {
      return false;
    }
  }, 20000);
  const r = await api('POST', '/api/v1/auth/signup', { token: null, body: { email: 'admin@shop.test', name: 'Admin', password: 'correct horse' } });
  assert.equal(r.status, 201, r.text);
  admin = r.json.token;
});

after(async () => {
  proc?.kill();
  await mock?.close();
  await sleep(200);
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows may still hold the database file for a moment */
  }
});

/* ---------- 1. key ---------- */

test('missing key: a typed no_key answer and zero upstream requests', async () => {
  assert.deepEqual((await api('GET', '/api/v1/ai/key')).json, { present: false, stored: false });
  const r = await job({ prompt: 'a slot 80 long', model: MODEL });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'no_key');
  assert.match(r.json.error.message, /Set one/);
  assert.equal(mock.requests.length, 0, 'not even the model list was fetched');
  assert.equal((await api('GET', '/api/v1/info', { token: null })).json.ai.enabled, false);
});

test('key: set by an admin only, checked as booleans, never returned, deleted', async () => {
  assert.equal((await api('GET', '/api/v1/ai/key', { token: null })).status, 401);
  assert.equal((await api('PUT', '/api/v1/ai/key', { token: null, body: { key: MOCK_KEY } })).status, 401);
  // an ordinary user may look but not touch
  assert.equal((await api('POST', '/api/v1/admin/users', { body: { email: 'op@shop.test', name: 'Operator', password: 'machinist1' } })).status, 201);
  const op = (await api('POST', '/api/v1/auth/login', { token: null, body: { email: 'op@shop.test', password: 'machinist1' } })).json.token;
  assert.equal((await api('PUT', '/api/v1/ai/key', { token: op, body: { key: MOCK_KEY } })).status, 403);
  assert.equal((await api('DELETE', '/api/v1/ai/key', { token: op })).status, 403);
  assert.deepEqual((await api('GET', '/api/v1/ai/key', { token: op })).json, { present: false, stored: false });

  // refused keys: the answer never repeats what was sent
  for (const bad of ['', '   ', 'two words', `x${'k'.repeat(600)}`]) {
    const r = await api('PUT', '/api/v1/ai/key', { body: { key: bad } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'bad_key');
    if (bad.trim()) assert.ok(!r.text.includes(bad.trim()), 'a refused key is not echoed');
  }
  const junk = await api('PUT', '/api/v1/ai/key', { body: { key: MOCK_KEY, extra: 1 } });
  assert.equal(junk.status, 400);
  assert.ok(!junk.text.includes(MOCK_KEY));

  const set = await api('PUT', '/api/v1/ai/key', { body: { key: `  ${MOCK_KEY}  ` } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.json, { present: true, stored: true });
  assert.ok(!set.text.includes(MOCK_KEY));
  assert.deepEqual((await api('GET', '/api/v1/ai/key', { token: op })).json, { present: true, stored: true });
  assert.equal((await api('GET', '/api/v1/info', { token: null })).json.ai.enabled, true);

  // on disk: one file in the data folder, not in the database
  assert.equal(fs.readFileSync(path.join(dataDir, 'openrouter.key'), 'utf8'), MOCK_KEY);
  for (const f of fs.readdirSync(dataDir).filter((n) => n.startsWith('tnc.db'))) {
    assert.ok(!fs.readFileSync(path.join(dataDir, f)).includes(MOCK_KEY), `${f} holds no key`);
  }

  const del = await api('DELETE', '/api/v1/ai/key');
  assert.deepEqual(del.json, { present: false, stored: false });
  assert.ok(!fs.existsSync(path.join(dataDir, 'openrouter.key')));
  assert.equal((await job({ prompt: 'a slot', model: MODEL })).json.error.code, 'no_key');
  assert.equal(mock.requests.length, 0);
  assert.equal((await api('PUT', '/api/v1/ai/key', { body: { key: MOCK_KEY } })).status, 200);
});

/* ---------- 2. catalog ---------- */

test('catalog: reduced, validated, prices as given, batch variants left out', async () => {
  assert.equal((await api('GET', '/api/v1/ai/models', { token: null })).status, 401);
  const r = await api('GET', '/api/v1/ai/models');
  assert.equal(r.status, 200, r.text);
  const ids = r.json.models.map((m) => m.id);
  assert.deepEqual(ids, ['mock/fast-one-v2', 'mock/small-context', 'mock/no-reasoning']);
  assert.deepEqual(r.json.excluded, { not_live: 3, invalid: 1 });
  const m = r.json.models[0];
  assert.equal(m.id, 'mock/fast-one-v2');
  assert.equal(m.label, 'Fast One v2');
  assert.equal(m.name, 'MOCK: Fast One v2');
  assert.deepEqual(m.pricing, { prompt: '0.00000005', completion: '0.00000020' }, 'price strings pass through unchanged');
  assert.equal(m.price_per_million, '$0.05 / $0.20 per 1M tokens');
  assert.equal(m.context_length, 1000000);
  assert.equal(m.max_completion_tokens, 32768);
  assert.deepEqual(m.supports, { reasoning: true, tools: true, streaming: true });
  assert.deepEqual(m.reasoning.sent, { effort: 'medium' });
  assert.equal(m.reasoning.effective, 'medium');
  assert.deepEqual(m.output, { requested: 131072, effective_cap: 32768, parameter: 'max_tokens' });
  const plain = r.json.models[2];
  assert.equal(plain.reasoning.sent, null);
  assert.equal(plain.reasoning.effective, 'none');
  assert.equal(plain.output.parameter, 'max_completion_tokens');
  assert.deepEqual(r.json.policy, { reasoning: 'medium', requested_output_ceiling: 131072, auto_repair: true, max_refinement_rounds: 5, measure_goal: 95, server_max_tokens: 0 });
  assert.equal(r.json.default_model, MODEL);
  // cached: a second read does not ask upstream again
  const before = mock.requests.filter((q) => q.path.endsWith('/models')).length;
  assert.equal((await api('GET', '/api/v1/ai/models')).json.models.length, 3);
  assert.equal(mock.requests.filter((q) => q.path.endsWith('/models')).length, before);
  assert.equal(before, 1);
  assert.ok(!r.text.includes(MOCK_KEY));
});

/* ---------- 3. the job ---------- */

test('stages in order, keepalives and split chunks, the clamp and reasoning sent upstream', async () => {
  mock.reset();
  // slices of 7 bytes cut lines, JSON and the two-byte Ø apart; keepalive comments come first
  mock.script.push({ text: `Here is the program.\n${fence(GOOD)}\nDone.`, keepalives: 3, reasoning: true, byteChunk: 7, pieceLen: 23 });
  const r = await job({ prompt: 'a slot 80 long, 2 deep', model: MODEL });
  assert.equal(r.status, 200);
  assert.ok(r.jobId);
  assert.equal(r.events[0].type, 'job');
  assert.equal(r.events[0].data.id, r.jobId);
  assert.deepEqual(r.stages, ['generation', 'validation', 'measurement', 'completion']);
  assert.equal(r.last.type, 'done');
  assert.equal(r.types.filter((t) => t === 'done' || t === 'error').length, 1, 'exactly one terminal event');
  // deltas: the program text only (no fence, no prose), the Ø intact after being split
  const streamed = r.of('delta').map((d) => d.text).join('');
  assert.equal(streamed, `${GOOD}\n`);
  assert.ok(r.of('delta').length > 3, 'the text arrived in several deltas');
  assert.ok(r.of('status').some((s) => s.code === 'waiting'), 'a keepalive became a status line');
  assert.ok(r.of('status').some((s) => s.code === 'reasoning'));
  assert.ok(!JSON.stringify(r.events).includes('thinking about the slot'), 'reasoning text is not forwarded');
  const done = r.last.data;
  assert.equal(done.program, GOOD);
  assert.equal(done.accepted, true);
  assert.equal(done.round, 0);
  assert.equal(done.validation.ok, true);
  assert.equal(done.validation.summary, 'passed');
  assert.ok(done.measurement.native.removed_volume_mm3 > 0);
  assert.equal(done.measurement.client, null);
  assert.deepEqual(done.usage, { requests: 1, prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.001 });

  const sent = mock.chat();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].auth, `Bearer ${MOCK_KEY}`);
  assert.equal(sent[0].body.model, MODEL);
  assert.equal(sent[0].body.stream, true);
  assert.equal(sent[0].body.max_tokens, 32768, 'requested 131072, provider cap 32768 -> 32768');
  assert.deepEqual(sent[0].body.reasoning, { effort: 'medium' });
  assert.equal(sent[0].body.messages.length, 2);
  assert.match(sent[0].body.messages[1].content, /a slot 80 long, 2 deep/);
  assert.ok(!JSON.stringify(r.events).includes(MOCK_KEY));
});

test('the clamp follows the context window, and unsupported parameters are left out', async () => {
  mock.reset();
  mock.script.push({ text: fence(GOOD) }, { text: fence(GOOD) });
  let r = await job({ prompt: 'a slot', model: 'mock/small-context' });
  assert.equal(r.last.type, 'done');
  const cap = mock.chat()[0].body.max_tokens;
  assert.ok(cap < 50000 && cap > 45000, `context 50000 minus the prompt: ${cap}`);
  r = await job({ prompt: 'a slot', model: 'mock/no-reasoning' });
  assert.equal(r.last.type, 'done');
  const body = mock.chat()[1].body;
  assert.equal(body.reasoning, undefined, 'no reasoning parameter for a model that documents none');
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.max_completion_tokens, 32768);
  assert.equal(r.events[0].data.reasoning.effective, 'none');
});

test('validation failure -> a repair round with the report, then early stop', async () => {
  mock.reset();
  mock.script.push({ text: fence(BAD) }, { text: fence(GOOD) }, { text: fence(GOOD) });
  const r = await job({ prompt: 'a slot', model: MODEL });
  assert.deepEqual(r.stages, ['generation', 'validation', 'measurement', 'refinement 1/5', 'validation', 'measurement', 'completion']);
  assert.equal(r.last.type, 'done');
  assert.equal(r.last.data.round, 1);
  assert.equal(r.last.data.usage.requests, 2);
  const sent = mock.chat();
  assert.equal(sent.length, 2, 'stopped as soon as the check passed');
  assert.equal(mock.script.length, 1, 'the third scripted answer was never asked for');
  const msgs = sent[1].body.messages;
  assert.equal(msgs.length, 4, 'system + task + the program + the report');
  assert.ok(msgs[2].content.includes('L Z-10 R0 FMAX'));
  assert.match(msgs[3].content, /ROUND 2 of 6/);
  assert.match(msgs[3].content, /BLOCK 5 `L Z-10 R0 FMAX`: /);
  assert.match(msgs[3].content, /-> FMAX only at Z\+2/);
  assert.ok(r.of('status').some((s) => s.code === 'validated' && /crash/.test(s.message)));
  // each round's deltas are tagged with the round
  assert.deepEqual([...new Set(r.of('delta').map((d) => d.round))], [0, 1]);
});

test('five-round cap: six answers at most, then an error that keeps the draft', async () => {
  mock.reset();
  for (let i = 0; i < 8; i++) mock.script.push({ text: fence(BAD) });
  const r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(mock.chat().length, 6, 'the first generation plus five refinement rounds');
  assert.deepEqual(r.stages.filter((s) => s.startsWith('refinement')), ['refinement 1/5', 'refinement 2/5', 'refinement 3/5', 'refinement 4/5', 'refinement 5/5']);
  assert.ok(!r.types.includes('done'), 'never "done" for a program that fails the check');
  assert.ok(!r.stages.includes('completion'));
  assert.equal(r.last.type, 'error');
  const e = r.last.data;
  assert.equal(e.code, 'validation_failed');
  assert.match(e.message, /still fails the check after 5 repair round/);
  assert.match(e.message, /RAPID|FMAX|crash/i);
  assert.match(e.message, /draft is kept/);
  assert.equal(e.draft.program, BAD, 'the draft is preserved');
  assert.equal(e.draft.validation.ok, false);
  assert.ok(e.draft.validation.crashes.length >= 1);
  assert.equal(e.usage.requests, 6);
});

test('cancel endpoint: the upstream stream is dropped and no refinement request follows', async () => {
  mock.reset();
  mock.script.push({ text: fence(BAD) }, { text: '```klartext\nBEGIN PGM SLOT MM\nL X+1', hangKeepalive: true }, { text: fence(GOOD) });
  let cancelled = null;
  const r = await job({ prompt: 'a slot', model: MODEL }, {
    onEvent: async (ev, j) => {
      if (ev.type === 'delta' && ev.data.round === 1 && !cancelled) cancelled = await api('POST', `/api/v1/ai/jobs/${j.jobId}/cancel`);
    },
  });
  assert.deepEqual(cancelled.json, { cancelled: true });
  assert.equal(r.last.type, 'error');
  assert.equal(r.last.data.code, 'cancelled');
  assert.equal(r.last.data.draft.program, BAD, 'the best draft so far comes back');
  assert.ok(!r.types.includes('done'));
  await until('the mock to see the dropped connection', () => mock.chat()[1].aborted);
  await sleep(400);
  assert.equal(mock.chat().length, 2, 'no upstream request after the cancel');
  assert.equal(mock.script.length, 1);
  // the job is gone: cancelling again is a 404, and a new job may start
  assert.equal((await api('POST', `/api/v1/ai/jobs/${r.jobId}/cancel`)).json.error.code, 'job_not_found');
  assert.equal((await api('POST', '/api/v1/ai/jobs/nope/cancel')).status, 404);
});

test('client disconnect stops the job the same way; one job per account meanwhile', async () => {
  mock.reset();
  mock.script.push({ text: fence(BAD) }, { text: '```klartext\nBEGIN PGM SLOT MM\n', hangKeepalive: true }, { text: fence(GOOD) });
  const ac = new AbortController();
  let busy = null;
  const r = await job({ prompt: 'a slot', model: MODEL }, {
    signal: ac.signal,
    onEvent: async (ev) => {
      if (ev.type === 'stage' && ev.data.stage === 'refinement') {
        busy = await job({ prompt: 'another', model: MODEL });
        await until('the second upstream request', () => mock.chat().length === 2);
        ac.abort();
      }
    },
  });
  assert.equal(r.aborted, true);
  assert.equal(busy.status, 429);
  assert.equal(busy.json.error.code, 'busy');
  await until('the mock to see the dropped connection', () => mock.chat()[1].aborted);
  await sleep(400);
  assert.equal(mock.chat().length, 2, 'no upstream request after the client went away');
  // the job was cleaned up: the account can generate again
  mock.reset();
  mock.script.push({ text: fence(GOOD) });
  assert.equal((await job({ prompt: 'a slot', model: MODEL })).last.type, 'done');
});

test('truncated output: a visible repair round, never a silent continuation', async () => {
  mock.reset();
  mock.script.push({ text: `\`\`\`klartext\n${GOOD.slice(0, 120)}`, finish: 'length' }, { text: fence(GOOD) });
  const r = await job({ prompt: 'a slot', model: MODEL });
  assert.deepEqual(r.stages, ['generation', 'refinement 1/5', 'validation', 'measurement', 'completion']);
  assert.ok(r.of('status').some((s) => s.code === 'truncated' && /cut off at the output limit \(32768 tokens\)/.test(s.message)));
  assert.equal(r.last.type, 'done');
  assert.equal(r.last.data.program, GOOD);
  const msgs = mock.chat()[1].body.messages;
  assert.match(msgs[3].content, /cut off at the output limit of 32768 tokens/);
  assert.match(msgs[3].content, /COMPLETE program again, shorter/);
});

test('truncated every time: a clear error with the cut-off draft, six requests at most', async () => {
  mock.reset();
  for (let i = 0; i < 8; i++) mock.script.push({ text: `\`\`\`klartext\n${GOOD.slice(0, 120)}`, finish: 'length' });
  const r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(mock.chat().length, 6);
  assert.equal(r.last.type, 'error');
  assert.equal(r.last.data.code, 'truncated');
  assert.match(r.last.data.message, /larger output limit/);
  assert.equal(r.last.data.draft.truncated, true);
  assert.ok(r.last.data.draft.program.startsWith('BEGIN PGM SLOT MM'));
  assert.ok(!r.types.includes('done'));
});

test('upstream error mid-stream (HTTP 200, error chunk): no retry, the partial draft is kept', async () => {
  mock.reset();
  mock.script.push({ text: `\`\`\`klartext\n${GOOD.slice(0, 150)}`, midError: true }, { text: fence(GOOD) });
  const r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.type, 'error');
  assert.equal(r.last.data.code, 'upstream_error');
  assert.match(r.last.data.message, /502: Provider disconnected unexpectedly/);
  assert.match(r.last.data.message, /Nothing was retried/);
  assert.equal(r.last.data.retryable, true);
  assert.equal(r.last.data.draft.truncated, true);
  assert.ok(r.last.data.draft.program.startsWith('BEGIN PGM SLOT MM'));
  assert.equal(mock.chat().length, 1, 'a request that may have been billed is not repeated');
  assert.deepEqual(r.stages, ['generation']);
});

test('connection dropped mid-stream: no retry', async () => {
  mock.reset();
  mock.script.push({ text: '```klartext\nBEGIN PGM SLOT MM\n', destroy: true }, { text: fence(GOOD) });
  const r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.data.code, 'upstream_error');
  assert.equal(mock.chat().length, 1);
});

test('HTTP 503 before any answer: one announced retry, then bounded', async () => {
  mock.reset();
  mock.script.push({ status: 503, message: 'No available providers' }, { text: fence(GOOD) });
  let r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.type, 'done');
  assert.equal(mock.chat().length, 2);
  const retry = r.of('status').filter((s) => s.code === 'retry');
  assert.equal(retry.length, 1, 'the retry is announced');
  assert.match(retry[0].message, /HTTP 503: No available providers\)\. Retry 1 of 1/);
  assert.equal(r.last.data.usage.requests, 2);

  mock.reset();
  mock.script.push({ status: 503 }, { status: 502 }, { text: fence(GOOD) });
  r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.type, 'error');
  assert.equal(r.last.data.code, 'upstream_unavailable');
  assert.equal(mock.chat().length, 2, 'one retry, not more');
  assert.equal(r.last.data.draft, null);
});

test('a refused key and a refused request are typed and not retried', async () => {
  mock.reset();
  mock.script.push({ status: 401, message: 'No auth credentials found' });
  let r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.data.code, 'key_rejected');
  assert.match(r.last.data.message, /Set a valid OpenRouter key/);
  mock.script.push({ status: 402, message: 'Insufficient credits' });
  r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.data.code, 'provider_credit');
  mock.script.push({ status: 400, message: 'Invalid model specified' });
  r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.data.code, 'upstream_rejected');
  assert.equal(mock.chat().length, 3);
});

test('idle timeout: a silent provider ends the job, no retry', async () => {
  mock.reset();
  mock.script.push({ text: '', hang: true }, { text: fence(GOOD) });
  const t0 = Date.now();
  const r = await job({ prompt: 'a slot', model: MODEL });
  assert.equal(r.last.type, 'error');
  assert.equal(r.last.data.code, 'timeout');
  assert.ok(Date.now() - t0 >= 1400 && Date.now() - t0 < 6000, `${Date.now() - t0} ms`);
  assert.equal(mock.chat().length, 1);
  await until('the mock to see the dropped connection', () => mock.chat()[0].aborted);
});

test('measurement hook: measure-request, the posted result steers the next round', async () => {
  mock.reset();
  const spec = { blank: { x: [0, 100], y: [0, 100], z: [-20, 0] }, features: [{ id: 'S1', type: 'slot', from: [10, 10], to: [90, 10], w: 12, z: -2 }] };
  mock.script.push({ text: `\`\`\`partspec\n${JSON.stringify(spec)}\n\`\`\`\n${fence(GOOD)}` }, { text: fence(GOOD.replace('L Z-2 R0 F200', 'L Z-2 R0 F150')) });
  const posts = [];
  const r = await job({ prompt: 'a slot', model: MODEL, client_measure: true }, {
    onEvent: async (ev, j) => {
      if (ev.type !== 'measure-request') return;
      const first = posts.length === 0;
      if (first) {
        // wrong request id, wrong score: refused, the job keeps waiting
        assert.equal((await api('POST', `/api/v1/ai/jobs/${j.jobId}/measurement`, { body: { request_id: 'nope', score: 50 } })).json.error.code, 'measurement_not_pending');
        assert.equal((await api('POST', `/api/v1/ai/jobs/${j.jobId}/measurement`, { body: { request_id: ev.data.request_id, score: 150 } })).status, 400);
      }
      const body = first ? { request_id: ev.data.request_id, score: 61.5, text: 'S1 SLOT: NOT CUT from X50 to X90' } : { request_id: ev.data.request_id, score: 97 };
      posts.push(await api('POST', `/api/v1/ai/jobs/${j.jobId}/measurement`, { body }));
    },
  });
  const asks = r.of('measure-request');
  assert.equal(asks.length, 2);
  assert.equal(asks[0].program, GOOD);
  assert.deepEqual(asks[0].spec, spec, 'the model\'s part spec is passed on');
  assert.equal(asks[0].round, 0);
  assert.equal(asks[0].timeout_ms, 700);
  assert.deepEqual(posts.map((p) => p.json), [{ accepted: true }, { accepted: true }]);
  assert.deepEqual(r.stages, ['generation', 'validation', 'measurement', 'refinement 1/5', 'validation', 'measurement', 'completion']);
  assert.equal(r.last.type, 'done');
  assert.equal(r.last.data.measurement.client.score, 97);
  assert.equal(r.last.data.round, 1);
  const msgs = mock.chat()[1].body.messages;
  assert.match(msgs[3].content, /S1 SLOT: NOT CUT from X50 to X90/);
  assert.ok(msgs[2].content.includes('```partspec'), 'the spec goes back with the program');
  assert.ok(!r.of('delta').some((d) => d.text.includes('blank')), 'the part spec is not streamed as program text');
  // a posted measurement for a finished job
  assert.equal((await api('POST', `/api/v1/ai/jobs/${r.jobId}/measurement`, { body: { request_id: 'x', score: 1 } })).json.error.code, 'job_not_found');
});

test('measurement hook: no answer in time -> the job goes on with the interpreter check', async () => {
  mock.reset();
  mock.script.push({ text: fence(GOOD) });
  const r = await job({ prompt: 'a slot', model: MODEL, client_measure: true });
  assert.equal(r.of('measure-request').length, 1);
  assert.ok(r.of('status').some((s) => s.code === 'measurement_timeout'));
  assert.equal(r.last.type, 'done');
  assert.equal(r.last.data.measurement.client, null);
});

test('bad requests are refused before anything is sent', async () => {
  mock.reset();
  const cases = [
    [{ model: MODEL }, 400, 'bad_request'],
    [{ prompt: '   ', model: MODEL }, 400, 'bad_request'],
    [{ prompt: 'x', model: MODEL, surprise: 1 }, 400, 'bad_request'],
    [{ prompt: 'x', model: MODEL, machine: '999' }, 400, 'bad_request'],
    [{ prompt: 'x', model: 'mock/batch-only' }, 400, 'model_unknown'],
    [{ prompt: 'x', model: 'mock/does-not-exist' }, 400, 'model_unknown'],
  ];
  for (const [body, status, code] of cases) {
    const r = await job(body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.equal(r.json.error.code, code, JSON.stringify(body));
  }
  assert.equal((await fetch(`${base}/api/v1/ai/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt":"x"}' })).status, 401);
  assert.equal(mock.chat().length, 0);
});

test('the key never reaches the log; usage is recorded per request', async () => {
  assert.ok(serverLog.length > 0, 'the server logged something');
  assert.ok(!serverLog.includes(MOCK_KEY), 'the key is not in the server log');
  const u = (await api('GET', '/api/ai/v1/usage')).json;
  assert.ok(u.calls >= 20, `every upstream request is in ai_usage: ${u.calls}`);
  assert.ok(u.cost_usd > 0);
});
