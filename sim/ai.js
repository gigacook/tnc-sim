/* ============================================================
   TNC_AI — the third way to make a program: describe it, an AI writes it.
   OpenRouter only (BYOK). Plain fetch, no SDK, no server.
   The key lives in this browser (sessionStorage, or localStorage if the
   operator ticks Remember), or comes from .env in the gitignored local build.

   TNC_AI.DEFAULT_MODEL, TNC_AI.RECOMMENDED — the recommended model (DeepSeek V4.1 Flash)
   TNC_AI.listModels() -> Promise {live, models:[{id,name,provider,context,pin,pout,created}], frontier:[...]}
     the ONE model catalogue: OpenRouter's live list (or the server's filtered copy); pin/pout = US$ per million
     tokens in/out. frontier = newest flagship per major provider, computed from that list. Never rejects: when
     the list can't be fetched it resolves the small OFFLINE list with live:false.
   TNC_AI.providerName(slug) -> 'Anthropic', 'xAI', ...
   TNC_AI.generate({key, model, prompt, system, tools, verify, onStep, signal, maxRepairs, timeoutMs}) -> {src, report, cost}
     onStep phases: 'request' {attempt}, 'progress' {attempt, secs, chars, reasoningChars, stage:'thinking'|'writing'}
     (fired about once a second while the model streams), 'checked' {attempt, report, src}.
   TNC_AI.testKey(key) -> {label, usage, limit, ...}
   TNC_AI.extract(text) -> program text or null
   TNC_AI.system(tools) -> the system prompt for a tool table
   ============================================================ */
var TNC_AI = (function () {
  'use strict';
  var API = 'https://openrouter.ai/api/v1';
  var DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';

  /* ---------- the model catalogue: the only model list in the app ---------- */
  var FRONTIER_PROVIDERS = ['anthropic', 'openai', 'google', 'x-ai', 'deepseek', 'qwen', 'meta-llama', 'mistralai'];
  var PROVIDERS = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', 'x-ai': 'xAI', deepseek: 'DeepSeek', qwen: 'Qwen',
    'meta-llama': 'Meta', mistralai: 'Mistral', moonshotai: 'Moonshot', 'z-ai': 'Z.ai', cohere: 'Cohere', perplexity: 'Perplexity',
    amazon: 'Amazon', microsoft: 'Microsoft', nvidia: 'NVIDIA', minimax: 'MiniMax', openrouter: 'OpenRouter', baidu: 'Baidu',
    tencent: 'Tencent', bytedance: 'ByteDance', 'ibm-granite': 'IBM', inception: 'Inception', liquid: 'Liquid', 'arcee-ai': 'Arcee' };
  function providerName(slug) { return PROVIDERS[slug] || slug; }
  /* Offline fallback ONLY (the live list could not be fetched): ids that were on OpenRouter on 2026-09-27.
     Only DeepSeek V4.1 Flash's price was checked then ($0.035 / $0.29 per M); the rest show as unknown. */
  var OFFLINE = [
    { id: DEFAULT_MODEL, name: 'DeepSeek V4.1 Flash', pin: 0.035, pout: 0.29 },
    { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5' },
    { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna' },
    { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
    { id: 'deepseek/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro' },
    { id: 'qwen/qwen3.8-flash', name: 'Qwen 3.8 Flash' }
  ].map(function (m) { return { id: m.id, name: m.name, provider: m.id.split('/')[0], context: null,
    pin: m.pin == null ? null : m.pin, pout: m.pout == null ? null : m.pout, created: 0 }; });
  var RECOMMENDED = OFFLINE[0];

  function perM(x) { var v = parseFloat(x); return isFinite(v) && v >= 0 ? v * 1e6 : null; }   // OpenRouter: US$ per token; -1 = variable
  function normalize(m) {
    var pr = m.pricing || {}, out = (m.architecture || {}).output_modalities, n = String(m.name || m.id), c = n.indexOf(': ');
    return { id: m.id, name: c > 0 && c < 30 ? n.slice(c + 2) : n, provider: String(m.id).split('/')[0],
      context: +m.context_length || (m.top_provider && +m.top_provider.context_length) || null,
      maxOut: (m.top_provider && +m.top_provider.max_completion_tokens) || null,               // the model's own answer limit, if OpenRouter knows it
      pin: perM(pr.prompt), pout: perM(pr.completion), created: +m.created || 0,
      text: !out || (out.indexOf('text') >= 0 && out.indexOf('image') < 0), variant: /:/.test(m.id) };
  }
  /* Frontier quick picks: per major provider, drop the small / fast / special-purpose models and the premium
     "pro" tier (> $60 per M out), keep the ones released within 120 days of that provider's newest, and take the
     top-tier name first (opus / pro / max / large / ultra), then the highest output price, then the newest.
     A heuristic over names and prices, not a benchmark. */
  var TOP_TIER = /(^|[-_.])(opus|pro|max|large|ultra|premier)(?=[-_.\d]|$)/i;
  var NOT_FLAGSHIP = /(^|[-_.])(mini|nano|lite|tiny|small|micro|flash|fast|haiku|air|turbo|instant|embed\w*|guard|moderation|audio|tts|image|realtime|search|research|ocr|vl|vision|codex|coder|devstral|codestral|distill|oss|ministral|saba)(?=[-_.\d]|$)/i;
  function frontier(models) {
    var out = [];
    FRONTIER_PROVIDERS.forEach(function (p) {
      var c = models.filter(function (m) { return m.provider === p && m.pout > 0 && m.pout <= 60 && !NOT_FLAGSHIP.test(m.id.slice(p.length + 1)); });
      if (!c.length) return;
      var newest = Math.max.apply(null, c.map(function (m) { return m.created; }));
      c = c.filter(function (m) { return newest - m.created <= 120 * 86400; });
      var top = function (m) { return TOP_TIER.test(m.id.slice(p.length + 1)) ? 1 : 0; };
      c.sort(function (a, b) { return (top(b) - top(a)) || (b.pout - a.pout) || (b.created - a.created); });
      out.push(c[0]);
    });
    return out;
  }
  var catalogue = null;
  function listModels() {
    var base = api();
    if (catalogue && catalogue.base === base) return catalogue.p;
    var p = fetch(base + '/models', { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (j) {
      var L = (j.data || []).map(normalize).filter(function (m) { return m.id && !m.variant && m.text; });
      if (!L.length) throw new Error('empty model list');
      return { live: true, models: L, frontier: frontier(L) };
    }).catch(function (e) {
      catalogue = null;                                   // try again next time the picker opens
      return { live: false, error: String(e && e.message || e), models: OFFLINE.slice(), frontier: OFFLINE.slice(1) };
    });
    catalogue = { base: base, p: p };
    return p;
  }

  /* window.TNC_AI_API: set by bridge.js when the page is served by the TNC server, which holds the
     OpenRouter key and forwards to OpenRouter. The browser then sends its session cookie, never a key. */
  function api() { return (typeof window !== 'undefined' && window.TNC_AI_API) || API; }
  function headers(key) {
    var h = { 'Content-Type': 'application/json', 'X-Title': 'TNC 426 Simulator' };
    if (api() === API) h['Authorization'] = 'Bearer ' + key;
    try { if (typeof location !== 'undefined' && /^https?:/.test(location.origin)) h['HTTP-Referer'] = location.origin + location.pathname; } catch (e) {}
    return h;
  }
  function httpError(res, body) {
    var msg = (body && body.error && (body.error.message || body.error)) || res.statusText || 'request failed';
    var e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)); e.status = res.status; return e;
  }
  function dataError(obj) {
    var msg = (obj && obj.error && (obj.error.message || obj.error)) || 'stream error';
    var e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)); e.status = (obj && obj.error && obj.error.code) || 502; return e;
  }
  function readJson(res) { return res.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return { raw: t }; } }); }

  /* SSE line/byte parsing, kept pure (no fetch, no timers) so it can be unit-tested without a network call. */
  function sseLine(line, onEvent) {
    line = line.replace(/\r$/, '');
    if (line.slice(0, 5) !== 'data:') return;
    var data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    var obj; try { obj = JSON.parse(data); } catch (e) { return; }
    onEvent(obj);
  }
  function sseFeed(buf, chunk, onEvent) {
    buf += chunk;
    var lines = buf.split('\n');
    buf = lines.pop();
    for (var i = 0; i < lines.length; i++) sseLine(lines[i], onEvent);
    return buf;
  }

  function testKey(key) {
    return fetch(api() + '/key', { headers: headers(key) }).then(function (res) {
      return readJson(res).then(function (b) { if (!res.ok) throw httpError(res, b); return b.data || b; });
    });
  }

  /* Streams the answer over SSE so the caller can show live progress (reasoning models can think for
     minutes before writing anything). Ties together the caller's AbortSignal and an overall timeout. */
  /* the request as sent (minus the key): shown to the user on demand.
     reasoning: 'off' | 'low' | 'medium' | 'high' (OpenRouter unified reasoning); maxTokens caps the answer (budget guard) */
  function requestBody(o) {
    var b = { model: o.model, messages: o.messages, temperature: 0.2, usage: { include: true }, stream: true };
    if (o.reasoning === 'off') b.reasoning = { enabled: false };
    else if (o.reasoning) b.reasoning = { effort: o.reasoning };
    if (o.maxTokens) b.max_tokens = o.maxTokens;
    return b;
  }
  /* chat, and when the answer stops at max_tokens, ask for the rest (at most twice) and join the pieces.
     When only reasoning fit in the budget, try once more with twice the budget. A dropped connection or a
     provider 5xx is retried once; never a 4xx or a cancel. */
  var TOKEN_CAP = 64000;
  function chatFull(o, onCont) {
    var parts = [], cost = 0, conts = 0;
    function once(req) {
      return chat(req).then(function (r) {
        cost += r.cost; parts.push(r.text);
        if (r.finish === 'length' && conts < 2) {
          conts++; if (onCont) onCont({ n: conts, chars: parts.join('').length });
          var msgs = o.messages.concat([{ role: 'assistant', content: parts.join('') },
            { role: 'user', content: 'Your answer was cut off by the length limit. Continue EXACTLY where it stopped: the next characters only — no repetition, no explanation, do not reopen a code fence that is already open.' }]);
          return once(Object.assign({}, o, { messages: msgs }));
        }
        return { text: parts.join(''), cost: cost, finish: r.finish, continued: conts };
      }, function (e) {
        if (e && e.cutOff && !o._retried && (o.maxTokens || 0) < TOKEN_CAP) {
          var more = Math.min(TOKEN_CAP, (o.maxTokens || 16000) * 2);
          if (onCont) onCont({ n: 0, retry: true, maxTokens: more });
          return chatFull(Object.assign({}, o, { _retried: true, maxTokens: more }), onCont).then(function (r) { r.cost += cost; return r; });
        }
        var transient = e && e.name !== 'AbortError' && !e.cutOff && !(e.status >= 400 && e.status < 500) && !/TIMED OUT/.test(e.message || '');
        if (transient && !o._netRetried) {
          if (onCont) onCont({ n: 0, network: true, error: String(e.message || e) });
          return new Promise(function (r) { setTimeout(r, o.retryDelayMs != null ? o.retryDelayMs : 2000); })
            .then(function () { return chatFull(Object.assign({}, o, { _netRetried: true }), onCont); })
            .then(function (r) { r.cost += cost; return r; });
        }
        throw e;
      });
    }
    return once(o);
  }
  function chat(o) {
    var onProgress = o.onProgress || function () {};
    /* idle timeout: nothing streamed for this long = stuck (reasoning models stream their thinking, so a working
       model keeps the line busy); plus a hard cap for the whole answer. A long program that streams steadily is fine. */
    var timeoutMs = o.timeoutMs || 180000, hardMs = o.hardTimeoutMs || 1800000;
    var text = '', reasoning = '', usage = null, streamErr = null, timedOut = false, finish = null;
    var start = Date.now();
    var ac = new AbortController();
    var to = null, hard = setTimeout(function () { timedOut = true; ac.abort(); }, hardMs);
    function alive() { clearTimeout(to); to = setTimeout(function () { timedOut = true; ac.abort(); }, timeoutMs); }
    alive();
    if (o.signal) { if (o.signal.aborted) ac.abort(); else o.signal.addEventListener('abort', function () { ac.abort(); }); }
    var tick = setInterval(function () {
      onProgress({ secs: (Date.now() - start) / 1000, chars: text.length, reasoningChars: reasoning.length,
        stage: text.length ? 'writing' : 'thinking', text: text, reasoningTail: reasoning.slice(-400) });
    }, 500);
    function cleanup() { clearTimeout(to); clearTimeout(hard); clearInterval(tick); }
    function onEvent(obj) {
      if (obj.error) { streamErr = streamErr || dataError(obj); return; }
      var d = obj.choices && obj.choices[0] && obj.choices[0].delta;
      if (d) {
        if (d.content) text += d.content;
        if (d.reasoning) reasoning += d.reasoning; // OpenRouter puts reasoning-model "thinking" tokens here
      }
      var fr = obj.choices && obj.choices[0] && obj.choices[0].finish_reason;
      if (fr) finish = fr;                       // 'length' = cut off by max_tokens (reasoning counts against it)
      if (obj.usage) usage = obj.usage;
    }

    return fetch(api() + '/chat/completions', {
      method: 'POST', headers: headers(o.key), signal: ac.signal,
      body: JSON.stringify(requestBody(o))
    }).then(function (res) {
      if (!res.ok) return readJson(res).then(function (b) { throw httpError(res, b); });
      if (!res.body || !res.body.getReader) { // no streaming reader available: fall back to one shot
        return res.text().then(function (t) { var lines = t.split('\n'); for (var i = 0; i < lines.length; i++) sseLine(lines[i], onEvent); });
      }
      var reader = res.body.getReader(), decoder = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (streamErr) throw streamErr;
          if (r.done) { if (buf) sseLine(buf, onEvent); return; }
          alive(); buf = sseFeed(buf, decoder.decode(r.value, { stream: true }), onEvent);
          if (streamErr) throw streamErr;
          return pump();
        });
      }
      return pump();
    }).then(function () {
      cleanup();
      if (streamErr) throw streamErr;
      if (!text && reasoning) { var e = new Error('THE MODEL ANSWERED WITH REASONING ONLY, NO FINAL TEXT (' + reasoning.length + ' chars)' +
        (finish === 'length' ? ' — THE TOKEN LIMIT RAN OUT WHILE IT WAS STILL THINKING' : '') + ' — raise the answer limit or lower the reasoning effort'); e.status = 502; e.cutOff = finish === 'length'; throw e; }
      if (!text) { var e2 = new Error('EMPTY ANSWER FROM THE MODEL'); e2.status = 502; throw e2; }
      return { text: text, cost: (usage && +usage.cost) || 0, finish: finish, usage: usage };
    }).catch(function (e) {
      cleanup();
      if (e && e.name === 'AbortError') {
        if (timedOut) { var te = new Error('TIMED OUT WAITING FOR THE MODEL (' + Math.round((Date.now() - start) / 1000) + ' s; nothing for ' + Math.round(timeoutMs / 1000) + ' s, or over the ' + Math.round(hardMs / 60000) + ' min cap)'); te.status = 0; throw te; }
        throw e; // caller cancelled: keep e.name === 'AbortError' so the UI shows CANCELLED
      }
      throw e;
    });
  }

  /* ---------- the program out of the answer ----------
     Models wrap it in ```klartext, ```nc, ```text or no fence; a cut-off answer leaves the fence open; a repair answer
     may quote the old program before the new one. The LAST fenced block with BEGIN PGM wins, an unclosed fence counts,
     else the last BEGIN PGM .. END PGM (or to the end) in the raw text. Then normalizeSrc(). */
  function extract(text) {
    text = String(text || '').replace(/\r/g, '');
    var fences = text.match(/```[^\n`]*\n[\s\S]*?(?:```|$)/g) || [], pick = null;
    for (var i = 0; i < fences.length; i++) {
      var body = fences[i].replace(/^```[^\n]*\n/, '').replace(/```$/, '');
      if (/BEGIN\s+PGM/i.test(body)) pick = body;
    }
    if (!pick) { var all = text.match(/BEGIN\s+PGM[\s\S]*?(?:END\s+PGM[^\n]*|$)/gi); pick = all && all[all.length - 1]; }
    return pick ? normalizeSrc(pick) : null;
  }
  /* the small slips that are not worth a repair round: block numbers, typographic minus signs, lower case,
     blank lines, text after END PGM, a missing or mismatched END PGM. Comments (after ;) keep their case. */
  function normalizeSrc(s) {
    var lines = String(s).replace(/\r/g, '').replace(/[−–—]/g, '-').replace(/[   ]/g, ' ').split('\n'), out = [], name = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/^\s*N?\d+\s+(?=[A-Za-z;*])/, '').replace(/\s+$/, '');
      if (!l.trim() || /^\s*```/.test(l)) continue;
      var c = l.indexOf(';'), code = c < 0 ? l : l.slice(0, c), rest = c < 0 ? '' : l.slice(c);
      l = code.toUpperCase() + rest;
      var b = /^\s*BEGIN\s+PGM\s+(\S+)/.exec(l);
      if (b && name == null) { name = b[1]; out.push(l.trim()); continue; }
      if (/^\s*END\s+PGM\b/.test(l)) { if (name != null) { out.push('END PGM ' + name + ' MM'); name = false; break; } continue; }
      out.push(l);                                            // indentation kept: cycle Q lines are indented
    }
    if (name) out.push('END PGM ' + name + ' MM');          // the answer was cut off before END PGM
    return out.join('\n');
  }

  /* ---------- does the program cut anything? (a program that mills air passes every safety check) ----------
     res: TNC.run result, ev: TNC_SIM.analyse events (ev.cut = {feed, cut} path lengths in mm). */
  function cutCheck(res, ev) {
    var c = ev && ev.cut, st = res && res.stock; if (!c || !(c.feed > 0) || !st) return null;
    var box = 'X' + st.x0 + '..' + st.x1 + ' Y' + st.y0 + '..' + st.y1 + ' Z' + st.z0 + '..' + st.z1;
    if (c.cut < 1) return { err: 'THE PROGRAM REMOVES NO MATERIAL: every cutting move is in the air. Milling only takes material away: the cuts must be inside the blank (' + box + '), below its top Z' + st.z1 + '.' };
    var f = c.cut / c.feed;
    if (f < 0.15) return { warn: 'ONLY ' + Math.round(f * 100) + '% OF THE CUTTING PATH REMOVES MATERIAL — most feed moves cut air. Check that the shape is inside the blank (' + box + ') and below its top.' };
    return null;
  }

  /* ---------- the tool table as capabilities: kind, Ø, reach, a safe S and F (same chip-load rule as the check) ---------- */
  function kindOf(t) {
    var n = String(t.name || '').toUpperCase();
    return /PROBE|TS\d/.test(n) ? 'probe' : /BALL|KUGEL|KULFR/.test(n) ? 'ball mill' : /FACE/.test(n) ? 'face mill' : /SPOT|CENTER|CENTRE/.test(n) ? 'spot drill'
      : /CHAMF|CONE/.test(n) ? 'chamfer cone' : /TAP|GEW/.test(n) ? 'tap' : /REAM/.test(n) ? 'reamer' : /BORE/.test(n) ? 'boring head'
      : /DRILL|BOHR/.test(n) ? 'drill' : /MILL|FRAES/.test(n) ? 'end mill' : 'tool';
  }
  /* o: {holderA: mm from the spindle face to the holder nose (stick-out = L - A), sMax, fMax: the machine's limits} */
  function toolSheet(tools, o) {
    o = o || {};
    var A = o.holderA || 100, sMax = o.sMax || 12000, fMax = o.fMax || 20000;
    return (tools || []).slice().sort(function (a, b) { return a.t - b.t; }).map(function (t) {
      var D = +(2 * t.r).toFixed(3), k = kindOf(t), L = +t.l || 0, mill = /mill/.test(k);
      var reach = L > 0 ? Math.floor(Math.max(L - A, 0.25 * L) - 1) : null;
      var z = k === 'face mill' ? 5 : mill ? 3 : 2, vc = k === 'face mill' ? 300 : mill ? 200 : /drill/.test(k) ? 80 : 60;
      var S = Math.max(100, Math.min(sMax, Math.round(vc * 1000 / (Math.PI * D) / 100) * 100));
      var F = Math.max(10, Math.min(fMax, Math.floor(0.8 * (0.012 * D + 0.005) * S * z / 10) * 10));
      var s = 'T' + t.t + ' ' + t.name + ': ' + k + ' D' + D + (reach != null ? ', reach ' + reach + ' mm' : '');
      if (k === 'end mill') s += ', flat bottom, slot width ' + D + ', smallest inside radius ' + (+t.r) + '. S' + S + ' F' + F + ', plunge F' + Math.max(10, Math.round(F / 4 / 10) * 10);
      else if (k === 'ball mill') s += ', round tip (centre ' + (+t.r) + ' above the tip): 3-D surfaces, fillets, textures. S' + S + ' F' + F + ', plunge F' + Math.max(10, Math.round(F / 4 / 10) * 10);
      else if (k === 'face mill') s += ', facing only, depth per pass <= 2. S' + S + ' F' + F;
      else if (k === 'drill') s += ', holes D' + D + ' with CYCL DEF 200/203/205 only. S' + S + ' Q206=+' + Math.max(50, Math.round(S * D * 0.012));
      else if (k === 'spot drill') s += ', 90 deg point: spotting before drilling, small countersinks';
      else if (k === 'chamfer cone') s += ', 45 deg cone: edge chamfers, V-engraving (depth = half the line width)';
      else if (k === 'tap') s += ', tapping (CYCL DEF 207 / 206) in a pre-drilled hole, F = S x pitch';
      else if (k === 'reamer') s += ', reaming (CYCL DEF 201) a hole drilled 0.2 under size';
      else if (k === 'boring head') s += ', boring (CYCL DEF 202) an existing hole';
      else if (k === 'probe') s += ', touch probe: NEVER cuts';
      return s + '.';
    }).join('\n');
  }

  function system(tools, opts) {
    opts = opts || {};
    return [
'You write HEIDENHAIN TNC 426 / TNC 430 conversational (Klartext) programs, NC software 280 476, for a simulator that machines',
'them on a virtual blank and checks every block. Its interpreter accepts ONLY the syntax below; anything else is rejected. Units: mm.',
'',
'OUTPUT FORMAT',
'- Reply with ONLY the program inside a single ```klartext fenced block. Nothing before or after the fence.',
'- Always the COMPLETE program: never "...", never "rest unchanged", never two programs.',
'- No block numbers. One block per line. Upper case. A comment starts with ; and runs to the end of the line.',
'- Line 1: BEGIN PGM <NAME> MM. Last line: END PGM <NAME> MM (same name). NAME: A-Z, 0-9, _ only, max 16 characters.',
'- Lines 2-3: the BLK FORM. Then ; comment lines: blank size, the plan (features, order, tools with S and F).',
'',
'HOW MILLING WORKS — READ THIS FIRST',
'- Milling only REMOVES material. The finished part is what is LEFT of the blank. Nothing is ever added.',
'- So the blank must contain the whole finished part, and every cutting move is inside the blank, at or below its top face Z+0.',
'  A move above Z+0 or outside the blank outline cuts air. Never "draw" the shape in the air: that is 3-D printing, not milling.',
'- A raised shape (boss, figure, sculpture) = cut away everything AROUND it, level by level from the top down.',
'  A recessed shape (pocket, engraving, cavity) = cut away everything INSIDE it.',
'- Every 3-D shape is a stack of 2-D cross-sections: at each Z level, mill away the material outside the section (raised) or inside it (recessed).',
'',
'BLANK',
'BLK FORM 0.1 Z X+0 Y+0 Z-20   (MIN corner; Z after 0.1 = tool axis)',
'BLK FORM 0.2 X+100 Y+80 Z+0   (MAX corner)',
'Datum at the front-left corner, top face Z+0, blank bottom negative. The tool starts at X0 Y0 Z0.',
'Any size up to 500 mm in every direction: a 500 mm cube is BLK FORM 0.1 Z X+0 Y+0 Z-500 / BLK FORM 0.2 X+500 Y+500 Z+0.',
'The vice grips the blank\'s Y- and Y+ faces from below the bottom up to 6 mm above it: leave a base at least 10 mm thick (never cut lower than blank bottom + 10, except drilled holes).',
'',
'PATH BLOCKS',
'TOOL CALL 5 Z S3000            tool, axis Z, speed. Does NOT start the spindle.',
'L X+10 Y+20 Z-3 R0 F500 M3     line. X Y Z absolute, IX IY IZ incremental. F modal mm/min. FMAX = rapid, this block only.',
'CC X+50 Y+40                   circle centre / pole (modal). C X+30 Y+40 DR+  arc about CC to X Y (end = start: full circle).',
'CR X+80 Y+40 R+20 DR-          arc by radius (+R <= 180 deg, -R > 180 deg). DR+ counter-clockwise, DR- clockwise, seen from +Z.',
'CT X+40 Y+5                    arc tangent to the previous element.',
'RND R5                         rounding arc between the element before and after it (between two path blocks).',
'CHF 5                          chamfer of side length 5 between two straight lines.',
'LP PR+30 PA+45                 polar line about CC (PR radius, PA angle deg; IPR IPA incremental). PR+Q2 works too.',
'CP IPA+360 IZ-2 DR+            polar arc about CC by an angle; with IZ it is a helix. CTP PR.. PA.. tangent polar arc.',
'',
'RADIUS COMPENSATION (use it for contours; the simulator offsets exactly like the TNC)',
'RL = tool left of the contour, RR = right, seen in the direction of travel. R0 = tool centre on the path. Modal.',
'Climb milling an outside contour: RL going clockwise around the part. Inside a pocket: RL going counter-clockwise.',
'Outside corners get an arc automatically; inside corners must be larger than the tool radius or TOOL RADIUS TOO LARGE.',
'Never switch RL straight to RR: an R0 block must come between. Cancel with an R0 line or a DEP block.',
'For roughing loops and 3-D surfaces program the tool CENTRE with R0 and add the tool radius yourself (simplest, never fails).',
'Approach and depart tangentially (preferred for finished contours):',
'  L X-20 Y-20 R0 FMAX / L Z-5 R0 F200    start point PS outside the contour, at depth',
'  APPR LCT X+0 Y+0 R5 RL F500             first contour point, arc radius 5, compensation',
'  L ... contour ...',
'  DEP LCT X-20 Y-20 R5 F1000               depart to PN with an arc, compensation cancelled',
'  Also: APPR LT X Y LEN10 RL, APPR LN X Y LEN10 RL, APPR CT X Y CCA90 R5 RL, DEP LT LEN10, DEP LN LEN10, DEP CT CCA90 R5.',
'',
'PROGRAM FLOW AND Q PARAMETERS (use loops: a short program with loops beats thousands of lines)',
'LBL 1 / LBL 0 / CALL LBL 1 / CALL LBL 1 REP 3/3 (section repeat: REP r runs it r+1 times in total).',
'Subprogram: CALL LBL n (no REP) runs LBL n ... LBL 0; place subprograms after M30.',
'FN 0: Q1 = -2      FN 1: Q2 = +Q2 + +Q1      (FN 2 minus, FN 3 times, FN 4 divide). Q in coordinates and feeds: L X+Q10 Z+Q22 FQ3.',
'Formulas: Q20 = SQ (Q10 - 50) + SQ (Q11 - 50)   Q22 = SQRT (Q21 - Q20) - Q2   Q5 = SIN (Q4) * 20   (SIN COS TAN SQRT SQ ABS PI; angles in deg).',
'Jumps: FN 9: IF +Q1 EQU +Q2 GOTO LBL 3, FN 10 NE, FN 11 GT, FN 12 LT. A jump back to a LBL above makes a loop.',
'M30 alone on a line ends the program. Never use: FK, INCH, block numbers.',
'',
'M-FUNCTIONS',
'M3/M4 spindle on, M8 coolant, M13/M14 spindle+coolant: at block START. M5, M9, M2/M30: at block END.',
'Every TOOL CALL stops the spindle: the next block must carry M3, e.g. L Z+50 R0 FMAX M3. M5 only on a retract block.',
'',
'CYCLES. A CYCL DEF plus its indented Q lines is ONE block; call it with M99 on a positioning block or CYCL CALL.',
'Available: 200 201 202 203 204 205 206 207 208 209 (drilling, boring, tapping; 207: Q239 pitch, F = S x pitch), 212 213 214 215 (pocket/stud finishing, centre Q216 Q217),',
'210 211 (slots), 220 221 (patterns: define the machining cycle first, then 220/221 runs it at every point, no CYCL CALL), 230 231 (surfaces),',
'7 DATUM SHIFT (7.1 X+.. 7.2 Y+..), 8 MIRROR, 10 ROTATION (10.1 ROT+..), 11 SCALING (11.1 SCL ..), 4 and 5 old pockets. Reset shifts/rotations when done.',
'CYCL DEF 200 DRILLING',
'  Q200=+2    ;SET-UP CLEARANCE',
'  Q201=-15   ;DEPTH',
'  Q206=+150  ;FEED RATE FOR PLNGNG',
'  Q202=+5    ;PLUNGING DEPTH',
'  Q210=+0    ;DWELL TIME AT TOP',
'  Q203=+0    ;SURFACE COORDINATE',
'  Q204=+50   ;2ND SET-UP CLEARANCE',
'L X+20 Y+20 R0 FMAX M99',
'CYCL DEF 201 REAMING: Q200 Q201 Q206 Q211 Q208 (retract feed, 0 = ream feed) Q203 Q204.',
'CYCL DEF 203 UNIVERSAL DRILLING: as 200 plus Q212 Q213 Q205 Q211 Q208 (0 = plunging feed) Q256.',
'Pocket, dotted form, called at the pocket centre at Z = surface + set-up:',
'CYCL DEF 4.0 POCKET MILLING / 4.1 SET UP 2 / 4.2 DEPTH -10 / 4.3 PECKG 3 F100 / 4.4 X60 / 4.5 Y40 / 4.6 F600 DR+ RADIUS 0',
'NOT AVAILABLE (rejected): FK, SL contour cycles 14 20-25, cycles 251 and up, PLANE, M128, M91/M92, TOOL DEF, INCH.',
'',
'TOOL TABLE — these tools and nothing else. Reach = how deep below the blank top the tool may cut before its holder hits the part.',
toolSheet(tools, opts),
'Use the big cutters to remove the bulk, the small ones for detail: thin grooves, letters, textures and fine features ("painting" with',
'ENDMILL_1/2 or BALL_2/4 at 0.2 to 1 mm deep). A shape deeper than a tool\'s reach needs a longer tool (the _LONG / _XLONG ones).',
'',
'HOW TO BUILD A 3-D PART OR SCULPTURE',
'1. Choose the blank so the part fits inside with 5 to 10 mm to spare; top face Z+0. Plan in comments: which shapes, at which X Y Z.',
'2. ROUGH with the biggest cutter that fits: Z levels (waterline), step-down <= the cutter radius, step-over <= 0.6 x D.',
'   At each level clear everything outside the cross-section (raised shapes) or inside it (cavities); the tool centre stays one',
'   tool radius (plus 0.5 stock) away from the finished surface. Rings around a round shape, offset rectangles around a square one.',
'3. FINISH with a ball mill: a raster (rows along X, step-over 0.5 to 2 mm in Y) with Z from a formula, or fine waterline levels',
'   (step-down 0.5 to 1 mm) following the cross-section. Ball tip Z on a surface of height h: offset the ball CENTRE by r along the normal.',
'4. DETAIL with the small tools: grooves, eyes, lines, letters, patterns, chamfers.',
'5. Spheres, domes, cones, cylinders, fins, cubes and their combinations make most things; write one ; comment per feature.',
'When the request is artistic, interpret it boldly but keep it machinable: smooth forms, nothing thinner than the cutter, no undercuts',
'(the tool only comes from above: every point of the part must be visible from +Z).',
'',
'TEMPLATE A — waterline roughing around a raised round shape (checked: no errors). Rings of tool-centre radius Q2 at level Q1:',
'TOOL CALL 15 Z S3000',
'L Z+50 R0 FMAX M3',
'CC X+60 Y+60                 ; centre of a D40 boss, 40 high',
'FN 0: Q1 = +0                ; level',
'LBL 1',
'FN 2: Q1 = +Q1 - +4          ; step-down 4',
'FN 0: Q2 = +28               ; first ring: boss radius 20 + tool radius 8',
'LBL 2',
'LP PR+Q2 PA+0 R0 FMAX',
'L Z+2 R0 FMAX',
'L Z+Q1 R0 F200',
'CP IPA+360 DR- R0 F1200',
'L Z+2 R0 FMAX',
'FN 1: Q2 = +Q2 + +9          ; step-over 9 (0.6 x D16)',
'FN 12: IF +Q2 LT +95 GOTO LBL 2    ; until the rings clear the blank corners',
'FN 12: IF +Q1 GT -40 GOTO LBL 1',
'L Z+50 R0 FMAX M5',
'A cone or a dome = the same loop with the boss radius depending on the level (e.g. Q3 = SQRT (SQ 40 - SQ Q1) for a sphere R40).',
'',
'TEMPLATE B — ball-mill raster finishing of a dome R40 centred X50 Y50, apex Z+0 (checked: no errors):',
'TOOL CALL 22 Z S3000          ; BALL_6, r = 3',
'L Z+50 R0 FMAX M3',
'FN 0: Q1 = +40                ; dome radius R',
'FN 0: Q2 = +3                 ; ball radius r',
'Q21 = SQ (Q1 + Q2)',
'FN 0: Q11 = +0                ; row Y',
'LBL 1',
'FN 0: Q10 = +0                ; X along the row',
'L X+Q10 Y+Q11 R0 FMAX',
'L Z+2 R0 FMAX',
'LBL 2',
'Q20 = SQ (Q10 - 50) + SQ (Q11 - 50)',
'FN 0: Q22 = -40               ; floor outside the dome',
'FN 12: IF +Q20 GT +Q21 GOTO LBL 3',
'Q22 = SQRT (Q21 - Q20) - Q2 - Q1   ; ball centre on a sphere R+r, tip = centre - r',
'FN 12: IF +Q22 GT -40 GOTO LBL 3',
'FN 0: Q22 = -40',
'LBL 3',
'L X+Q10 Z+Q22 R0 F600',
'FN 1: Q10 = +Q10 + +1',
'FN 12: IF +Q10 LT +100.5 GOTO LBL 2',
'L Z+2 R0 FMAX',
'FN 1: Q11 = +Q11 + +2',
'FN 12: IF +Q11 LT +100.5 GOTO LBL 1',
'L Z+50 R0 FMAX M5',
'Any surface Z = f(X, Y) works the same way: compute Q22 from Q10 and Q11, keep it >= the floor.',
'',
'SAFETY RULES THE SIMULATOR ENFORCES (a violation is reported as a crash or an error)',
'1. No FMAX into uncut stock: FMAX over the part only at Z+2 or higher; feed into the cut; FMAX back to Z+2 before any XY rapid.',
'2. No cutting move without M3/M4 since the last TOOL CALL.',
'3. The holder must never reach the part: never cut deeper below the blank top than the tool\'s reach.',
'4. Chip load: keep F at or under the F given for each tool at its S (higher S allows proportionally higher F).',
'5. Stay off the vice (see BLANK). Going below the blank bottom is allowed only for drilled through holes.',
'6. The program must remove material (a program that only cuts air is rejected).',
'Plunge straight down only at the plunge F; deeper than the tool radius per plunge only into already cleared space or with a ramp / helix.',
'',
'ERRORS',
'If you get an error report from the simulator (each item quotes the block; BEGIN PGM is block 0; a CYCL DEF with its Q lines is one block),',
'fix the cause of EVERY item, keep everything that already works, and return the COMPLETE corrected program, same format, nothing outside the fence.'
    ].join('\n');
  }
  var FALLBACK_SYSTEM = system([]);

  /* ---------- the repair loop ----------
     generate({key, model, prompt, system, tools, verify, confirm, rounds, onStep, signal, reasoning, maxTokens, timeoutMs})
     verify(src) -> {ok, errs, crashes, warns, text}: the simulator's checks.
     rounds (default 5): write, check, then send the problems back with the program, until it passes or the rounds run out.
     Each round sends ONE program back, the best so far (fewest errors / crashes), with its report and a one-line history
     of the earlier rounds, never the whole conversation: the context stays small and a worse attempt cannot derail it.
     confirm({round, rounds, report}) -> Promise<bool>: asked after each failed round; false stops with the best program
     so far (the user fixes it by hand). No confirm = keep going (auto).
     onStep phases: 'request' {attempt, round, rounds}, 'progress', 'continued' {n}, 'checked' {attempt, round, rounds, report, src, best},
     'failed' {error}. Resolves {src, report, cost, attempts, round (of the returned program), stopped}. */
  var HINTS = [
    [/RAPID TRAVERSE INTO MATERIAL/, 'FMAX only at Z+2 or higher over the part (or beside it); go down and cut with a feed F.'],
    [/SPINDLE STOPPED/, 'Every TOOL CALL stops the spindle: put M3 on the first move after it.'],
    [/HOLDER/, 'Deeper than this tool reaches: use a longer tool from the table (see reach) or cut less deep.'],
    [/VICE/, 'The vice holds the Y- and Y+ faces up to 6 mm above the blank bottom: stay higher, leave a base.'],
    [/RADIUS TOO LARGE|TOOL RADIUS/, 'An inside corner or arc is smaller than the tool radius: use a smaller tool, a bigger radius, or R0 with your own offset.'],
    [/REMOVES NO MATERIAL|CUTS AIR|REMOVES MATERIAL/, 'Milling removes material: the cuts belong inside the blank, below Z+0. Rebuild the shape by cutting away what is around it.'],
    [/CHIP LOAD/, 'Lower F to the suggested value (or raise S).'],
    [/LIMIT SWITCH/, 'A rotary axis is out of its range (see THIS MACHINE).'],
    [/LABEL|LBL/, 'Every CALL LBL / GOTO LBL needs its LBL; subprograms go after M30 and end with LBL 0.'],
    [/FORMAT|INCORRECT|UNKNOWN|NOT ALLOWED|SYNTAX|INVALID|ENTRY/, 'Not valid for this control: rewrite this line with the syntax from the system prompt only.'],
    [/NO PROGRAM/, 'Reply with the complete program in one ```klartext fence.']
  ];
  function hint(msg) { for (var i = 0; i < HINTS.length; i++) if (HINTS[i][0].test(msg)) return HINTS[i][1]; return null; }
  function listing(title, items, max) {
    if (!items || !items.length) return '';
    var seen = {}, out = [], n = 0;
    items.forEach(function (m) { if (n >= max) return; out.push((++n) + '. ' + m); var h = hint(m); if (h && !seen[h]) { seen[h] = 1; out.push('   -> ' + h); } });
    return title + ' (' + items.length + ')\n' + out.join('\n') + (items.length > max ? '\n   ... and ' + (items.length - max) + ' more of the same kinds' : '') + '\n\n';
  }
  function summary(rep) { return rep.ok ? 'passed' : (rep.errs.length + ' error(s), ' + rep.crashes.length + ' crash(es)' + (rep.errs[0] || rep.crashes[0] ? ': ' + String(rep.errs[0] || rep.crashes[0]).slice(0, 90) : '')); }
  function feedback(base, last, hist, round, rounds) {
    var rep = base.report;
    return 'ROUND ' + (round + 1) + ' of ' + rounds + '. The simulator machined your program and found:\n\n' +
      listing('ERRORS — the program is rejected until these are gone', rep.errs, 15) +
      listing('CRASHES', rep.crashes, 15) +
      listing('WARNINGS — fix if easy', rep.warns, 6) +
      (last && last !== base ? 'Your newest version (round ' + (last.round + 1) + ') was worse (' + summary(last.report) + '); the program above is your best one so far (round ' + (base.round + 1) + '): continue from it.\n\n' : '') +
      (hist.length > 1 ? 'Earlier rounds: ' + hist.map(function (h) { return 'round ' + (h.round + 1) + ' ' + h.sum; }).join(' | ') + '. Do not bring back problems you fixed.\n\n' : '') +
      'Fix the cause of every item, keep what already works, and return the COMPLETE corrected program in one ```klartext fence.';
  }
  function rank(c) { var r = c.report; return r.ok ? 1e9 : -(r.errs.length * 10 + r.crashes.length * 4 + (r.warns ? r.warns.length : 0) * 0.1); }

  function generate(o) {
    var model = o.model || DEFAULT_MODEL, onStep = o.onStep || function () {};
    var rounds = Math.max(1, o.rounds || ((o.maxRepairs == null ? 4 : o.maxRepairs) + 1));
    var sys = { role: 'system', content: o.system || system(o.tools) };
    var ask = { role: 'user', content: 'Write the program for this part:\n\n' + o.prompt };
    var cost = 0, round = 0, best = null, hist = [], noProg = null;
    function call(messages) {
      var req = { key: o.key, model: model, messages: messages, signal: o.signal, timeoutMs: o.timeoutMs, reasoning: o.reasoning, maxTokens: o.maxTokens, retryDelayMs: o.retryDelayMs };
      onStep({ phase: 'request', attempt: round, round: round + 1, rounds: rounds, body: JSON.parse(JSON.stringify(requestBody(req))) });
      return chatFull(Object.assign(req, {
        onProgress: function (p) { onStep({ phase: 'progress', attempt: round, round: round + 1, rounds: rounds, secs: p.secs, chars: p.chars, reasoningChars: p.reasoningChars, stage: p.stage, text: p.text, reasoningTail: p.reasoningTail }); }
      }), function (c) { onStep({ phase: 'continued', attempt: round, n: c.n, retry: !!c.retry, maxTokens: c.maxTokens, network: !!c.network, error: c.error }); })
        .then(function (r) { cost += r.cost; return r; });
    }
    function result(stopped) {
      if (!best) { var e = new Error('THE MODEL DID NOT RETURN A PROGRAM'); e.status = 0; throw e; }
      return { src: best.src, report: best.report, cost: cost, attempts: round + 1, round: best.round + 1, stopped: !!stopped };
    }
    function messagesFor(last) {
      if (!best) return [sys, ask, { role: 'assistant', content: String(noProg || '').slice(0, 4000) },
        { role: 'user', content: 'ROUND ' + (round + 1) + ' of ' + rounds + '. Your answer contained no program. Reply with the complete program in one ```klartext fence, nothing else.' }];
      return [sys, ask, { role: 'assistant', content: '```klartext\n' + best.src + '\n```' }, { role: 'user', content: feedback(best, last, hist, round, rounds) }];
    }
    function next(messages) {
      return call(messages).then(function (r) {
        var src = extract(r.text), report, cand = null;
        if (!src) { noProg = r.text; report = { ok: false, errs: ['NO PROGRAM IN THE ANSWER'], crashes: [], warns: [], text: 'NO PROGRAM IN THE ANSWER' }; }
        else {
          try { report = o.verify ? o.verify(src) : { ok: true, errs: [], crashes: [], warns: [], text: '' }; }
          catch (e) { report = { ok: false, errs: ['INTERNAL ERROR: ' + (e && e.message || e)], crashes: [], warns: [], text: 'INTERNAL ERROR' }; }
          cand = { src: src, report: report, round: round };
          if (!best || rank(cand) >= rank(best)) best = cand;               // ties: the newer one
        }
        hist.push({ round: round, sum: summary(report) });
        onStep({ phase: 'checked', attempt: round, round: round + 1, rounds: rounds, report: report, src: src, best: !!cand && best === cand });
        if (report.ok || round + 1 >= rounds) return result(false);
        return Promise.resolve(o.confirm ? o.confirm({ round: round + 1, rounds: rounds, report: (best || cand || { report: report }).report }) : true).then(function (go) {
          if (!go) return result(true);
          round++;
          return next(messagesFor(cand)).catch(function (e) {
            if ((e && e.name === 'AbortError') || !best) throw e;              // a cancel, or nothing to fall back on
            onStep({ phase: 'failed', attempt: round, error: String(e && e.message || e) });
            return result(false);                                             // a failed round keeps the best program so far
          });
        });
      });
    }
    return next([sys, ask]);
  }

  return { DEFAULT_MODEL: DEFAULT_MODEL, RECOMMENDED: RECOMMENDED, FRONTIER_PROVIDERS: FRONTIER_PROVIDERS, FALLBACK_SYSTEM: FALLBACK_SYSTEM,
    listModels: listModels, providerName: providerName, _normalize: normalize, _frontier: frontier,
    generate: generate, testKey: testKey, extract: extract, normalizeSrc: normalizeSrc, system: system, toolSheet: toolSheet, cutCheck: cutCheck, chatFull: chatFull,
    _sseLine: sseLine, _sseFeed: sseFeed /* internal: exposed only so tests can drive the SSE parser without a network call */ };
})();
if (typeof module !== 'undefined') module.exports = TNC_AI;
