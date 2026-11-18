/* MOCK PROVIDER — a fake OpenRouter for the server's AI tests. Not OpenRouter, no network beyond 127.0.0.1,
   no key that works anywhere, no credit spent. Every answer carries the header `x-mock-provider`.

   It speaks the two paths the server calls:
     GET  /models             the model list in OpenRouter's documented shape (fixture below)
     POST /chat/completions   plays the next scripted step as a server-sent event stream

   A scripted step (mock.script.push({...})):
     text         the answer text                           finish     'stop' (default) | 'length'
     reasoning    send one reasoning delta first            keepalives number of `: OPENROUTER PROCESSING` comments first
     byteChunk    write the stream in slices of this many bytes (splits lines and multi-byte characters)
     pieceLen     characters of text per content delta      status     answer with this HTTP status instead (e.g. 503)
     midError     after the text: the documented mid-stream error chunk (HTTP stays 200)
     destroy      after the text: drop the connection       hang       after the text: keep the stream open, silent
     hangKeepalive  as hang, with a keepalive comment every 100 ms
   Every request is recorded in mock.requests: {method, path, auth, body, aborted}. */
import http from 'node:http';

/* a made-up value the mock accepts; deliberately not shaped like a real key */
export const MOCK_KEY = ['MOCK', 'PROVIDER', 'KEY', 'not', 'real'].join('-');

const base = (id, name, extra) => ({
  id, canonical_slug: id, name, created: 1790000000, description: 'mock entry',
  context_length: 1000000,
  architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other', instruct_type: null },
  pricing: { prompt: '0.00000005', completion: '0.00000020' },
  top_provider: { context_length: 1000000, max_completion_tokens: 32768, is_moderated: false },
  per_request_limits: null,
  supported_parameters: ['max_tokens', 'temperature', 'tools', 'reasoning', 'include_reasoning'],
  default_parameters: null, supported_voices: null,
  links: { details: `/api/v1/models/${id}/endpoints` },
  endpoints: ['/api/v1/chat/completions', '/api/v1/responses'],
  ...extra,
});

/* the catalog fixture: prices and limits live here, in the mock, never in the server */
export const MODELS = [
  base('mock/fast-one-v2', 'MOCK: Fast One v2', { reasoning: { mandatory: false, default_effort: 'medium', default_enabled: true, supported_efforts: null } }),
  base('mock/small-context', 'MOCK: Small Context', { context_length: 50000, top_provider: { context_length: 50000, max_completion_tokens: 131072, is_moderated: false } }),
  base('mock/no-reasoning', 'MOCK: Plain Writer', { supported_parameters: ['max_completion_tokens', 'temperature'] }),
  base('mock/batch-only', 'MOCK: Batch Only', { endpoints: ['/api/v1/batches'] }),
  base('mock/fast-one-v2:batch', 'MOCK: Fast One v2 (batch)'),
  base('mock/painter', 'MOCK: Painter', { architecture: { modality: 'text->image', input_modalities: ['text'], output_modalities: ['image'] } }),
  { id: 'mock/malformed', name: 'MOCK: no pricing' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chunk = (delta, finish) => ({ id: 'gen-mock', provider: 'mock', model: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish ?? null }] });

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

async function play(res, step) {
  if (step.status && step.status !== 200) {
    res.writeHead(step.status, { 'content-type': 'application/json', 'x-mock-provider': 'tnc-test-mock' });
    res.end(JSON.stringify({ error: { code: step.status, message: step.message ?? 'mock provider error' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-mock-provider': 'tnc-test-mock' });
  res.flushHeaders();
  const text = step.text ?? '';
  const cut = step.midError || step.destroy || step.hang || step.hangKeepalive;
  let out = '';
  for (let i = 0; i < (step.keepalives ?? 0); i++) out += ': OPENROUTER PROCESSING\n\n';
  if (step.reasoning) out += frame(chunk({ role: 'assistant', content: '', reasoning: 'thinking about the slot' }));
  const n = step.pieceLen ?? Math.max(text.length, 1);
  const pieces = [];
  for (let i = 0; i < text.length; i += n) pieces.push(text.slice(i, i + n));
  for (let i = 0; i < pieces.length; i++) {
    const last = i === pieces.length - 1 && !cut;
    out += frame(chunk({ role: 'assistant', content: pieces[i] }, last ? (step.finish ?? 'stop') : null));
  }
  if (!pieces.length && !cut) out += frame(chunk({ role: 'assistant', content: '' }, step.finish ?? 'stop'));
  if (step.midError) {
    out += frame({ ...chunk({ content: '' }, 'error'), error: { code: 502, message: 'Provider disconnected unexpectedly' } });
  } else if (!cut) {
    out += frame({ id: 'gen-mock', choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, cost: step.cost ?? 0.001 } });
    out += 'data: [DONE]\n\n';
  }
  const bytes = Buffer.from(out, 'utf8');
  const size = step.byteChunk ?? bytes.length;
  for (let i = 0; i < bytes.length && !res.destroyed; i += size) {
    res.write(bytes.subarray(i, i + size));
    if (step.byteChunk) await sleep(1);
  }
  if (step.destroy) {
    await sleep(30);
    res.destroy();
    return;
  }
  if (step.hang) return; // silent, open until the caller goes away
  if (step.hangKeepalive) {
    while (!res.destroyed) {
      res.write(': OPENROUTER PROCESSING\n\n');
      await sleep(100);
    }
    return;
  }
  res.end();
}

/** Starts the mock on 127.0.0.1:port. Resolves {url, port, requests, script, chat(), reset(), close()}. */
export function startMock(port) {
  const mock = {
    requests: [],
    script: [],
    models: MODELS,
    modelsStatus: 200,
    /** the recorded generation requests only */
    chat: () => mock.requests.filter((r) => r.path.endsWith('/chat/completions')),
    reset: () => {
      mock.requests.length = 0;
      mock.script.length = 0;
    },
  };
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = { unparsed: raw };
    }
    const path = (req.url ?? '').split('?')[0];
    const entry = { method: req.method, path, auth: req.headers.authorization ?? null, body, aborted: false };
    mock.requests.push(entry);
    res.on('close', () => {
      if (!res.writableFinished) entry.aborted = true;
    });
    if (req.method === 'GET' && path.endsWith('/models')) {
      res.writeHead(mock.modelsStatus, { 'content-type': 'application/json', 'x-mock-provider': 'tnc-test-mock' });
      res.end(JSON.stringify(mock.modelsStatus === 200 ? { data: mock.models, total_count: mock.models.length, links: { next: null } } : { error: { code: mock.modelsStatus, message: 'mock' } }));
      return;
    }
    if (req.method === 'POST' && path.endsWith('/chat/completions')) {
      await play(res, mock.script.shift() ?? { status: 500, message: 'mock: no scripted answer left' });
      return;
    }
    res.writeHead(404, { 'x-mock-provider': 'tnc-test-mock' });
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      mock.port = server.address().port;
      mock.url = `http://127.0.0.1:${mock.port}`;
      mock.close = () =>
        new Promise((r) => {
          server.closeAllConnections();
          server.close(() => r());
        });
      resolve(mock);
    });
  });
}
