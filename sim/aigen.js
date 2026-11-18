/* ============================================================
   TNC_AIGEN — the AI view of the New program dialog, against the server's generation API (docs/AI_API.md).

   Parts, top to bottom:
     1. pure helpers   the SSE parser, price / number text, model filter, program names
     2. reduce()       the whole view state as one pure reducer (tests/ai/dialog-state.js)
     3. create()       the controller: the reducer plus an injected transport, host and timers
     4. httpTransport  fetch against window.TNC_BACKEND.api, cookies only, same origin
     5. STR            every text of the view: sv (default), en, sr (Latin)
     6. the view       DOM and one <style>, built here, mounted into #new-ai through the plugin bus

   Rules this module keeps:
     - The OpenRouter key goes from the field straight to PUT /ai/key. It is never put in the state, in
       browser storage, in a log line or in a program; the field is taken out of the page once the server took it.
     - No server (plain index.html, GitHub Pages): one line of text, no key field, no request.
     - The active program is never touched by a job. Only the Load button brings the result in: a "new" job opens it as a
       new program; a "change" job (the open program is the base) replaces that program's text as ONE undo step, so
       Ctrl+Z gives the original back.
     - Progress is what the server sent: stage and round. No percentage is made up.
     - Reasoning, token, measurement and round settings are the server's policy; there are no controls for them.
     - "fast & cheap" is not shown: the catalog has prices but no speed figure, so there is no current,
       data-based comparison to rest the claim on. The rows show the catalog's own data instead.
   ============================================================ */
var TNC_AIGEN = (function () {
  'use strict';
  var STAGES = ['generation', 'validation', 'measurement', 'refinement', 'completion'];
  var IDLE_MS = 50000;          // the server sends a keepalive every 15 s: three missed in a row = the stream is dead
  var CANCEL_GRACE_MS = 3000;   // after the cancel call: how long the stream may take to end before it is closed here
  var TEXT_MAX = 400000;
  /* storage names an older build kept a key under: deleted on load, never read, never sent anywhere */
  var BROWSER_KEY_NAMES = ['tnc426.orkey'];
  var MODEL_PICK = 'tnc.aigen.model';   // the picked model id (not a secret)

  /* ---------- 1. pure helpers ---------- */

  /* Server-sent events, fed any slices of text. Comment lines (": keepalive") and blocks without data give no event. */
  function sseParser() {
    var buf = '', keepalives = 0;
    function block(b, out) {
      var type = 'message', data = [], lines = b.split('\n'), i, l, seen = false;
      for (i = 0; i < lines.length; i++) {
        l = lines[i];
        if (!l) continue;
        if (l.charAt(0) === ':') { keepalives++; continue; }
        if (l.indexOf('event:') === 0) { type = l.slice(6).trim(); seen = true; }
        else if (l.indexOf('data:') === 0) { data.push(l.slice(5).replace(/^ /, '')); seen = true; }
      }
      if (!seen || !data.length) return;
      try { out.push({ type: type, data: JSON.parse(data.join('\n')) }); }
      catch { out.push({ type: 'bad-event', data: { of: type } }); }
    }
    return {
      push: function (text) {
        var out = [], end;
        buf = (buf + String(text == null ? '' : text)).replace(/\r\n/g, '\n');
        for (;;) {
          end = buf.indexOf('\n\n');
          if (end < 0) break;
          block(buf.slice(0, end), out);
          buf = buf.slice(end + 2);
        }
        return out;
      },
      /* true when the stream stopped in the middle of an event */
      get partial() { return buf.trim().length > 0; },
      get keepalives() { return keepalives; }
    };
  }

  /* "0.00000005" (US$ per token, the catalog's string) -> "0.05" (per million): the decimal point moves six places,
     as text, so no float rounding. At least two decimals. null for anything that is not a plain amount. */
  function perMillion(s) {
    if (typeof s !== 'string' || !/^\d+(\.\d+)?$/.test(s)) return null;
    var p = s.split('.'), frac = (p[1] || '') + '000000';
    var whole = (p[0] + frac.slice(0, 6)).replace(/^0+(?=\d)/, ''), rest = frac.slice(6).replace(/0+$/, '');
    while (rest.length < 2) rest += '0';
    return whole + '.' + rest;
  }
  var PRICE_UNIT = { en: 'per 1M tokens', sv: 'per 1M tokens (in / ut)', sr: 'na 1M tokena (ulaz / izlaz)' };
  function priceText(model, lang) {
    var pr = (model && model.pricing) || {}, a = perMillion(pr.prompt), b = perMillion(pr.completion);
    if (a == null || b == null) return null;
    return '$' + a + ' / $' + b + ' ' + (PRICE_UNIT[lang] || PRICE_UNIT.en);
  }
  function groupNum(n, lang) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ');
  }
  /* the output limit a job will use for this model: what the server reports, never recomputed here */
  function outputLimit(model) {
    var o = model && model.output;
    if (!o || typeof o.effective_cap !== 'number') return null;
    return { effective: o.effective_cap, requested: typeof o.requested === 'number' ? o.requested : null };
  }
  function filterModels(models, q) {
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return models.slice();
    return models.filter(function (m) {
      var hay = (m.label + ' ' + m.id + ' ' + (m.name || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }
  function programBase(text) {
    var m = /BEGIN\s+PGM\s+([A-Za-z0-9_]+)/i.exec(String(text || ''));
    return ((m ? m[1] : 'AI_PART').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 16)) || 'AI_PART';
  }
  /* the simulator's own rule for a new program name (ui.js uniqueName): NAME.H, then NAME_2.H, ... */
  function freeName(base, names) {
    var n = base + '.H', k = 2;
    while (names.indexOf(n) >= 0) { n = base.slice(0, 13) + '_' + k + '.H'; k++; }
    return n;
  }

  /* ---------- 2. the state ---------- */
  function initial() {
    return {
      phase: 'boot',            // boot | offline | idle | running | cancelling | done | failed
      key: { present: null, stored: false, busy: false, error: null, note: null },
      catalog: { status: 'idle', models: [], def: null, policy: null, stale: false, error: null },
      model: null, query: '',
      mode: 'new',              // 'new' = write a program | 'change' = change the open one
      base: null,               // {name}: the program a running or finished change job started from
      job: null,                // {id, model, maxRounds}
      steps: [],                // the stage events, in the order the server sent them
      stage: null, round: 0, maxRounds: null,
      text: '',                 // the program text streamed so far, or the final program / the draft
      lines: [],                // the last status lines {code, message}
      result: null,             // the `done` event: the only thing Load may open
      draft: null,              // a program that did not pass: shown, never loaded
      error: null,              // {code, message, retryable}
      loaded: null,             // {name, previous} after the Load button
      say: null, sayN: 0        // the last thing worth announcing
    };
  }
  function set(s, patch) { var o = {}, k; for (k in s) o[k] = s[k]; for (k in patch) o[k] = patch[k]; return o; }
  function say(s, patch, what) { patch.say = what; patch.sayN = s.sayN + 1; return set(s, patch); }
  function fail(s, error, draft) {
    var d = draft || (s.text ? { program: s.text, round: s.round, truncated: true, local: true } : null);
    return say(s, { phase: 'failed', error: error, draft: d, result: null, text: d ? d.program : s.text }, { k: 'error', code: error.code });
  }
  var CANCELLED = { code: 'cancelled', message: '', retryable: false };

  function reduceEvent(s, ev) {
    var d = ev.data || {};
    if (s.phase !== 'running' && s.phase !== 'cancelling') return s;   // nothing after the end, nothing before the start
    switch (ev.type) {
      case 'job': return set(s, { job: { id: d.id, model: d.model, maxRounds: d.max_rounds }, maxRounds: d.max_rounds == null ? s.maxRounds : d.max_rounds });
      case 'stage': {
        if (STAGES.indexOf(d.stage) < 0) return s;
        const step = { stage: d.stage, round: d.round || 0, maxRounds: d.max_rounds == null ? s.maxRounds : d.max_rounds };
        const patch = { steps: s.steps.concat([step]), stage: step.stage, round: step.round, maxRounds: step.maxRounds };
        if (d.stage === 'generation' || d.stage === 'refinement') patch.text = '';
        return s.phase === 'running' ? say(s, patch, { k: 'stage', stage: step.stage, round: step.round, max: step.maxRounds }) : set(s, patch);
      }
      case 'delta': return typeof d.text === 'string' ? set(s, { text: (s.text + d.text).slice(-TEXT_MAX) }) : s;
      case 'status': return set(s, { lines: s.lines.concat([{ code: String(d.code || ''), message: String(d.message || '') }]).slice(-4) });
      case 'done':
        if (s.phase === 'cancelling') return fail(s, CANCELLED, typeof d.program === 'string' ? { program: d.program, round: d.round, truncated: false } : null);
        if (d.accepted !== true || typeof d.program !== 'string' || !d.program) return fail(s, { code: 'internal', message: '', retryable: true }, null);
        return say(s, { phase: 'done', result: d, draft: null, error: null, text: d.program }, { k: 'done' });
      case 'error':
        return fail(s, s.phase === 'cancelling' ? set(CANCELLED, { message: String(d.message || '') })
          : { code: String(d.code || 'internal'), message: String(d.message || ''), retryable: d.retryable === true }, d.draft && typeof d.draft.program === 'string' ? d.draft : null);
      default: return s;   // measure-request is an effect (the controller); unknown events are skipped
    }
  }

  function reduce(s, a) {
    switch (a.type) {
      case 'offline': return set(s, { phase: 'offline' });
      case 'online': return s.phase === 'boot' || s.phase === 'offline' ? set(s, { phase: 'idle' }) : s;
      case 'key/busy': return set(s, { key: set(s.key, { busy: true, error: null, note: null }) });
      case 'key/state': return set(s, { key: { present: a.present === true, stored: a.stored === true, busy: false, error: null, note: a.note || null },
        error: a.present === true && s.error && s.error.code === 'no_key' ? null : s.error });
      case 'key/error': return set(s, { key: set(s.key, { busy: false, error: { code: a.code, message: a.message || '' }, note: null }) });
      case 'catalog/loading': return set(s, { catalog: set(s.catalog, { status: 'loading', error: null }) });
      case 'catalog/ok': {
        const models = (a.data.models || []).filter(function (m) { return m && typeof m.id === 'string' && typeof m.label === 'string'; });
        const has = function (id) { return models.some(function (m) { return m.id === id; }); };
        const pick = has(s.model) ? s.model : has(a.pick) ? a.pick : has(a.data.default_model) ? a.data.default_model : (models[0] ? models[0].id : null);
        return set(s, { catalog: { status: 'ready', models: models, def: a.data.default_model || null, policy: a.data.policy || null, stale: a.data.stale === true, error: null }, model: pick });
      }
      case 'catalog/error': return set(s, { catalog: set(s.catalog, { status: 'error', error: { code: a.code, message: a.message || '' } }) });
      case 'model': return s.catalog.models.some(function (m) { return m.id === a.id; }) ? set(s, { model: a.id }) : s;
      case 'query': return set(s, { query: String(a.q || '') });
      case 'mode':            // not while a job runs, and not while its result waits for Load
        if (s.phase === 'running' || s.phase === 'cancelling' || (a.mode !== 'new' && a.mode !== 'change') || a.mode === s.mode) return s;
        return set(s, { mode: a.mode, phase: s.phase === 'done' || s.phase === 'failed' ? 'idle' : s.phase, result: null, draft: null, error: null, loaded: null, steps: [], text: '', lines: [] });
      case 'guard': return say(s, { error: { code: a.code, message: '', retryable: false } }, { k: 'error', code: a.code });
      case 'job/start':
        if (s.phase !== 'idle' && s.phase !== 'done' && s.phase !== 'failed') return s;
        return say(s, { phase: 'running', job: null, base: a.base || null, steps: [], stage: null, round: 0, text: '', lines: [], result: null, draft: null, error: null, loaded: null }, { k: 'sent' });
      case 'job/refused':
        if (s.phase !== 'running' && s.phase !== 'cancelling') return s;
        return say(s, { phase: 'idle', error: { code: a.code, message: a.message || '', retryable: false },
          key: a.code === 'no_key' ? set(s.key, { present: false, stored: false }) : s.key }, { k: 'error', code: a.code });
      case 'sse': return reduceEvent(s, a.event);
      case 'stream/end':     // the stream closed without `done` or `error`
        if (s.phase === 'cancelling') return fail(s, CANCELLED, null);
        return s.phase === 'running' ? fail(s, { code: 'stream_ended', message: '', retryable: true }, null) : s;
      case 'stream/fail':
        if (s.phase === 'cancelling') return fail(s, CANCELLED, null);
        return s.phase === 'running' ? fail(s, { code: a.code, message: '', retryable: true }, null) : s;
      case 'cancel': return s.phase === 'running' ? say(s, { phase: 'cancelling' }, { k: 'cancelling' }) : s;
      case 'load/done': return s.phase === 'done' && s.result && !s.loaded ? say(s, { loaded: { name: a.name, previous: a.previous, changed: a.changed === true } }, { k: 'loaded' }) : s;
      case 'again': return s.phase === 'done' || s.phase === 'failed' ? set(s, { phase: 'idle', result: null, error: null, loaded: null }) : s;
      default: return s;
    }
  }

  /* ---------- 3. the controller ----------
     create({transport, host, timers, now}):
       transport  {keyState(), putKey(key), deleteKey(), models(), startJob(body, signal), cancel(id), measure(id, body)}
                  every call resolves {ok, status, data | error:{code, message}}; startJob resolves
                  {ok:true, jobId, chunks: async iterable of text} or {ok:false, status, error}. null = no server.
       host       {machine(), tools(), system(tools), measure(program, spec) | null, active(), load(program) -> name,
                  base() -> {name, text} | null (the open program), change(name, program) -> name, pick: {get(), set(id)}}
       timers     {set(fn, ms) -> id, clear(id)} */
  function create(o) {
    var tr = o.transport || null, host = o.host || {}, timers = o.timers || { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (i) { clearTimeout(i); } };
    var now = o.now || Date.now, s = initial(), subs = [], run = 0, abort = null, headerId = null;
    function dispatch(a) { var n = reduce(s, a), i; if (n === s) return; s = n; for (i = 0; i < subs.length; i++) subs[i](s, a); }
    function err(r) { return (r && r.error) || { code: 'network', message: '' }; }

    function refreshKey() {
      if (!tr) return Promise.resolve();
      return tr.keyState().then(function (r) {
        if (r.ok) dispatch({ type: 'key/state', present: r.data.present, stored: r.data.stored, note: s.key.note });
        else dispatch({ type: 'key/error', code: err(r).code, message: err(r).message });
      });
    }
    function refreshCatalog() {
      if (!tr) return Promise.resolve();
      dispatch({ type: 'catalog/loading' });
      return tr.models().then(function (r) {
        if (r.ok && r.data && Array.isArray(r.data.models)) dispatch({ type: 'catalog/ok', data: r.data, pick: host.pick ? host.pick.get() : null });
        else dispatch({ type: 'catalog/error', code: err(r).code, message: err(r).message });
      });
    }
    function refresh() {
      if (!tr) { dispatch({ type: 'offline' }); return Promise.resolve(); }
      dispatch({ type: 'online' });
      return Promise.all([refreshKey(), s.catalog.status === 'ready' ? null : refreshCatalog()]);
    }
    /* the key goes to the server and nowhere else; resolves true when the server took it (the caller then clears the field) */
    function saveKey(value) {
      var v = String(value == null ? '' : value).trim();
      if (!tr || s.key.busy) return Promise.resolve(false);
      if (!v) { dispatch({ type: 'key/error', code: 'bad_key' }); return Promise.resolve(false); }
      dispatch({ type: 'key/busy' });
      return tr.putKey(v).then(function (r) {
        if (r.ok) { dispatch({ type: 'key/state', present: r.data.present, stored: r.data.stored, note: 'saved' }); return r.data.present === true; }
        dispatch({ type: 'key/error', code: err(r).code, message: err(r).message });
        return false;
      });
    }
    function removeKey() {
      if (!tr || s.key.busy || s.phase === 'running' || s.phase === 'cancelling') return Promise.resolve(false);
      dispatch({ type: 'key/busy' });
      return tr.deleteKey().then(function (r) {
        if (r.ok) { dispatch({ type: 'key/state', present: r.data.present, stored: r.data.stored, note: r.data.present ? 'removed-env' : 'removed' }); return true; }
        dispatch({ type: 'key/error', code: err(r).code, message: err(r).message });
        return false;
      });
    }

    function measure(my, d) {
      if (!host.measure || !d || typeof d.request_id !== 'string') return;
      var id = (s.job && s.job.id) || headerId, limit = typeof d.timeout_ms === 'number' ? d.timeout_ms : 30000;
      timers.set(function () {
        if (my !== run || s.phase !== 'running' || !id) return;
        var t0 = now(), m = null, body = { request_id: d.request_id };
        try { m = host.measure(String(d.program || ''), d.spec || null); } catch { m = null; }
        if (my !== run || s.phase !== 'running') return;        // cancelled meanwhile: nothing is sent
        if (now() - t0 >= limit) return;                         // too late: the server has moved on
        if (m && typeof m.score === 'number' && isFinite(m.score)) body.score = Math.max(0, Math.min(100, m.score));
        if (m && typeof m.text === 'string' && m.text) body.text = m.text.slice(0, 8000);
        Promise.resolve(tr.measure(id, body)).catch(function () {});
      }, 0);
    }

    function generate(prompt) {
      var p = String(prompt == null ? '' : prompt).trim(), body, tools, my, parser, watch = null, timedOut = false, ended = false, r, machine, base = null;
      if (!tr || s.phase === 'running' || s.phase === 'cancelling' || s.phase === 'boot' || s.phase === 'offline') return Promise.resolve(false);
      if (s.key.present !== true) { dispatch({ type: 'guard', code: 'no_key' }); return Promise.resolve(false); }
      if (!p) { dispatch({ type: 'guard', code: 'prompt_empty' }); return Promise.resolve(false); }
      if (p.length > 20000) { dispatch({ type: 'guard', code: 'prompt_long' }); return Promise.resolve(false); }
      if (s.mode === 'change') {
        base = host.base ? host.base() : null;
        if (!base || typeof base.text !== 'string' || !base.text.trim()) { dispatch({ type: 'guard', code: 'base_empty' }); return Promise.resolve(false); }
      }
      tools = (host.tools ? host.tools() : []).map(function (t) { return { t: t.t, name: t.name, l: t.l, r: t.r }; });
      body = { prompt: p, tools: tools, client_measure: !!host.measure };
      if (s.model) body.model = s.model;
      machine = host.machine ? host.machine() : null;
      if (machine === '426' || machine === '430') body.machine = machine;
      if (host.system) body.system = host.system(tools);
      if (base) {
        body.base_program = { name: String(base.name || '').slice(0, 64), text: base.text };
        if (body.machine) body.base_program.machine = body.machine;
      }
      dispatch({ type: 'job/start', base: base ? { name: base.name } : null });
      my = ++run; headerId = null; abort = typeof AbortController === 'function' ? new AbortController() : { signal: null, abort: function () {} };
      var ac = abort;
      function arm() { if (watch != null) timers.clear(watch); watch = timers.set(function () { timedOut = true; ac.abort(); if (my === run && !ended) { ended = true; dispatch({ type: 'stream/fail', code: 'client_timeout' }); } }, IDLE_MS); }
      function disarm() { if (watch != null) timers.clear(watch); watch = null; }
      arm();
      return Promise.resolve().then(function () { return tr.startJob(body, ac.signal); }).then(async function (res) {
        var i, evs, ev;
        r = res;
        if (my !== run || ended) return false;
        if (!r || !r.ok) { ended = true; dispatch({ type: 'job/refused', code: err(r).code, message: err(r).message }); return false; }
        headerId = r.jobId || null;
        parser = sseParser();
        for await (var chunk of r.chunks) {
          if (my !== run || ended) break;
          arm();
          evs = parser.push(chunk);
          for (i = 0; i < evs.length && !ended; i++) {
            ev = evs[i];
            dispatch({ type: 'sse', event: ev });
            if (ev.type === 'measure-request') measure(my, ev.data);
            if (ev.type === 'done' || ev.type === 'error') ended = true;
          }
          if (ended) break;
        }
        if (my === run && !ended) { ended = true; dispatch({ type: 'stream/end' }); }
        return s.phase === 'done';
      }).catch(function () {
        if (my === run && !ended) { ended = true; dispatch({ type: 'stream/fail', code: timedOut ? 'client_timeout' : 'network' }); }
        return false;
      }).then(function (v) { disarm(); return v; });
    }

    /* one cancel call, then nothing more for this job: no measurement, no new request */
    function cancel() {
      if (s.phase !== 'running') return false;
      var id = (s.job && s.job.id) || headerId, ac = abort, my = run;
      dispatch({ type: 'cancel' });
      if (!id) { ac.abort(); return true; }
      Promise.resolve(tr.cancel(id)).then(function (r) { if (!r || !r.ok) ac.abort(); }, function () { ac.abort(); });
      timers.set(function () { if (my === run && s.phase === 'cancelling') ac.abort(); }, CANCEL_GRACE_MS);
      return true;
    }
    /* the only way a generated program reaches the control. A change job puts its result into the program it started
       from, as one undo step; every other job opens a new program. */
    function load() {
      if (s.phase !== 'done' || !s.result || s.loaded || !host.load) return null;
      var previous = host.active ? host.active() : null, changed = !!(s.base && host.change);
      var name = changed ? host.change(s.base.name, s.result.program) : host.load(s.result.program);
      dispatch({ type: 'load/done', name: name, previous: changed ? s.base.name : previous, changed: changed });
      return name;
    }
    return {
      get state() { return s; }, subscribe: function (fn) { subs.push(fn); }, dispatch: dispatch,
      refresh: refresh, refreshCatalog: refreshCatalog, saveKey: saveKey, removeKey: removeKey, generate: generate, cancel: cancel, load: load,
      setMode: function (mode) { dispatch({ type: 'mode', mode: mode }); },
      pickModel: function (id) { dispatch({ type: 'model', id: id }); if (s.model === id && host.pick) host.pick.set(id); },
      search: function (q) { dispatch({ type: 'query', q: q }); },
      again: function () { dispatch({ type: 'again' }); }
    };
  }

  /* ---------- 4. the transport ---------- */
  function httpTransport(api) {
    function call(method, path, body) {
      var init = { method: method, credentials: 'same-origin', headers: {} };
      if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      return fetch(api + path, init).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (d) {
          return res.ok ? { ok: true, status: res.status, data: d || {} } : { ok: false, status: res.status, error: (d && d.error) || { code: 'http_' + res.status, message: '' } };
        });
      }, function () { return { ok: false, status: 0, error: { code: 'network', message: '' } }; });
    }
    async function* text(body) {
      var dec = new TextDecoder(), reader = body.getReader(), part;
      for (;;) {
        part = await reader.read();
        if (part.done) break;
        yield dec.decode(part.value, { stream: true });
      }
    }
    return {
      keyState: function () { return call('GET', '/ai/key'); },
      putKey: function (key) { return call('PUT', '/ai/key', { key: key }); },
      deleteKey: function () { return call('DELETE', '/ai/key'); },
      models: function () { return call('GET', '/ai/models'); },
      cancel: function (id) { return call('POST', '/ai/jobs/' + encodeURIComponent(id) + '/cancel'); },
      measure: function (id, body) { return call('POST', '/ai/jobs/' + encodeURIComponent(id) + '/measurement', body); },
      startJob: function (body, signal) {
        return fetch(api + '/ai/jobs', { method: 'POST', credentials: 'same-origin', signal: signal || undefined, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
          if (String(res.headers.get('content-type') || '').indexOf('text/event-stream') !== 0) {
            return res.json().catch(function () { return null; }).then(function (d) { return { ok: false, status: res.status, error: (d && d.error) || { code: 'http_' + res.status, message: '' } }; });
          }
          return { ok: true, status: res.status, jobId: res.headers.get('x-job-id'), chunks: text(res.body) };
        });
      }
    };
  }

  /* ---------- 5. the texts ---------- */
  var STR = {
    sv: {
      offline: 'AI kräver den lokala eller hostade servern. Manuellt skapande fungerar som vanligt.',
      keyLabel: 'OpenRouter-nyckel',
      keyHelp: 'Nyckeln skickas till servern och lagras där. Den sparas aldrig i webbläsaren.',
      keySave: 'Spara nyckel',
      keySaved: 'Nyckeln är lagrad på servern.',
      keyRemove: 'Ta bort nyckeln från servern',
      keyRemoveSure: 'Bekräfta: ta bort nyckeln',
      keyRemoved: 'Nyckeln är borttagen från servern.',
      keyRemovedEnv: 'Den lagrade nyckeln är borttagen. Servern har fortfarande en nyckel från sin egen inställning.',
      keyMigrated: 'En nyckel som låg sparad i den här webbläsaren har raderats härifrån. Nyckeln lagras nu på servern.',
      prompt: 'Beskriv detaljen',
      modeLabel: 'Vad ska AI göra?', modeNew: 'Nytt', modeChange: 'Ändra aktuellt',
      promptChange: 'Vad ska ändras i {pgm}?',
      exChange: ['Gör spåret 1 mm djupare', 'Lägg en fas på 1 mm runt utsidan', 'Sänk matningen till F300 i alla skär'],
      disclosureChange: 'När du trycker på GENERERA skickas beskrivningen och hela programmet {pgm} till OpenRouter (tredje part).',
      loadNoteChange: 'Ladda ersätter texten i {active} med resultatet, som ett enda ångringssteg: Ctrl+Z ger tillbaka originalet.',
      loadedChange: '{name} är ändrat. Ctrl+Z ger tillbaka originalet.',
      donePlateau: 'Programmet klarade kontrollen och matchar den planerade detaljen till {s} procent (mål {g}). Fler omgångar gav ingen förbättring, så förfiningen stoppades.',
      examples: 'Exempel',
      ex: ['Platta 100x60, spår 80 långt, 6 brett, 2 djupt', 'Rektangulär ficka 60x40, djup 5, hörnradie 6', 'Fyra hål Ø8 på delningscirkel Ø60, djup 12'],
      model: 'Modell', selected: 'Vald modell', search: 'Sök modell', count: '{n} av {m}', noMatch: 'Ingen modell matchar sökningen.',
      catLoading: 'Hämtar modellistan…', catError: 'Modellistan kunde inte hämtas.', catStale: 'Modellistan är en äldre kopia: OpenRouter svarade inte.', retry: 'Försök igen',
      dId: 'Modell-id (skickas)', dName: 'Version', dCtx: 'Kontext', dOut: 'Effektiv utdatagräns', dPrice: 'Pris', dCaps: 'Stöd',
      tokens: '{n} tokens', outOf: '{n} tokens (begärt {r})', unknown: 'anges inte',
      capReasoning: 'resonemang', capTools: 'verktyg', capStreaming: 'strömning', yes: 'ja', no: 'nej',
      reason: { medium: 'medel', 'nearest-supported': 'närmaste nivå som modellen stöder', 'model-default': 'modellens egen nivå', none: 'inget' },
      generate: 'GENERERA', cancel: 'Avbryt', load: 'Ladda', again: 'Generera igen', copy: 'Kopiera utkast', copied: 'Utkastet är kopierat.',
      disclosure: 'När du trycker på GENERERA skickas beskrivningen och programtexten till OpenRouter (tredje part).',
      progress: 'Förlopp',
      stage: { generation: 'Generering', validation: 'Validering', measurement: 'Mätning', refinement: 'Förfining', completion: 'Slutförande' },
      round: 'omgång {n} av {m}', stepDone: 'klar', stepNow: 'pågår', stepStopped: 'avbruten',
      sent: 'Begäran skickad. Väntar på servern.', cancelling: 'Avbryter…',
      status: { waiting: 'Väntar på modellen…', reasoning: 'Modellen resonerar (visas inte).', retry: 'Begäran misslyckades innan något svar kom. Ett nytt försök görs.',
        truncated: 'Svaret klipptes vid utdatagränsen. Nästa omgång begär ett kortare program.', validated: 'Kontroll: {m}', measured: 'Mätning: {m}',
        measurement_timeout: 'Mätningen kom inte fram i tid. Omgången bedöms på kontrollen.', plateau: 'Förfiningen stoppades: {m}' },
      textLabel: 'Programtext', draftLabel: 'Utkast (inte laddat)',
      done: 'Programmet klarade kontrollen. Tryck på Ladda för att öppna det.',
      doneMeta: '{b} block · omgång {n} · {q} förfrågningar',
      loadNote: 'Ladda öppnar det som ett nytt program, {name}. {active} ligger kvar oförändrat i programlistan.',
      editNote: 'Ett block i {active} som inte är lagrat med ENT går förlorat.',
      loaded: '{name} är laddat. {active} ligger kvar oförändrat.',
      serverSays: 'Servern:',
      err: {
        no_key: 'Ingen OpenRouter-nyckel är lagrad. Ange nyckeln överst.',
        prompt_empty: 'Beskriv detaljen först.',
        base_empty: 'Det finns inget öppet program att ändra.',
        prompt_long: 'Beskrivningen är för lång (högst 20 000 tecken).',
        unauthorized: 'Du är inte inloggad på servern. Logga in och öppna dialogen igen.',
        forbidden: 'Bara en administratör kan ändra nyckeln.',
        bad_key: 'Nyckeln godtogs inte: den är tom, för lång eller innehåller mellanslag.',
        bad_request: 'Servern godtog inte förfrågan. Korta beskrivningen och försök igen.',
        key_not_stored: 'Servern kunde inte lagra nyckeln (datamappen går inte att skriva i).',
        key_not_deleted: 'Servern kunde inte ta bort nyckeln.',
        validator_unavailable: 'Programkontrollen körs inte på servern. Starta om servern.',
        model_not_allowed: 'Modellen är inte tillåten på den här servern. Välj en annan.',
        model_unknown: 'Modellen finns inte i listan över aktiva modeller. Välj en annan.',
        catalog_unavailable: 'OpenRouters modellista gick inte att hämta. Försök igen om en stund.',
        busy: 'Ett jobb körs redan för det här kontot. Vänta tills det är klart.',
        budget_exceeded: 'Månadens AI-budget är slut. Vänta till den 1:a eller be administratören.',
        validation_failed: 'Programmet klarade inte kontrollen. Utkastet finns kvar nedan och är inte laddat. Ändra beskrivningen eller välj en annan modell.',
        no_program: 'Svaret innehöll inget program. Formulera om beskrivningen.',
        truncated: 'Svaret klipptes vid utdatagränsen. Beskriv en enklare detalj eller välj en modell med högre utdatagräns.',
        cancelled: 'Avbrutet. Inget laddades.',
        timeout: 'Leverantören svarade inte i tid. Försök igen.',
        upstream_error: 'Leverantören avbröt mitt i svaret. Försök igen.',
        upstream_unavailable: 'Leverantören är inte tillgänglig just nu. Försök senare eller välj en annan modell.',
        upstream_rejected: 'OpenRouter avvisade förfrågan. Välj en annan modell eller ändra beskrivningen.',
        key_rejected: 'OpenRouter godtog inte nyckeln. Ta bort den och ange en giltig nyckel.',
        provider_credit: 'OpenRouter-kontot har för lite kredit. Fyll på eller byt nyckel.',
        content_filter: 'Leverantörens filter stoppade svaret. Formulera om beskrivningen.',
        prompt_too_long: 'Beskrivningen lämnar för lite plats för svaret. Korta den eller välj en modell med större kontext.',
        internal: 'Servern kunde inte slutföra jobbet. Försök igen.',
        stream_ended: 'Anslutningen till servern bröts innan jobbet var klart. Inget laddades. Försök igen.',
        client_timeout: 'Servern har inte hörts av på 50 sekunder. Jobbet stoppades. Försök igen.',
        network: 'Servern gick inte att nå. Kontrollera att den körs och försök igen.',
        other: 'Jobbet misslyckades ({code}). Försök igen.'
      }
    },
    en: {
      offline: 'AI needs the local or hosted server. Manual creation works as usual.',
      keyLabel: 'OpenRouter key',
      keyHelp: 'The key is sent to the server and stored there. It is never saved in the browser.',
      keySave: 'Save key',
      keySaved: 'The key is stored on the server.',
      keyRemove: 'Remove the key from the server',
      keyRemoveSure: 'Confirm: remove the key',
      keyRemoved: 'The key was removed from the server.',
      keyRemovedEnv: 'The stored key was removed. The server still has a key from its own configuration.',
      keyMigrated: 'A key that was saved in this browser has been deleted from it. The key now lives on the server.',
      prompt: 'Describe the part',
      modeLabel: 'What should the AI do?', modeNew: 'New', modeChange: 'Change current',
      promptChange: 'What should change in {pgm}?',
      exChange: ['Make the slot 1 mm deeper', 'Add a 1 mm chamfer around the outside', 'Lower the feed to F300 in every cut'],
      disclosureChange: 'Pressing GENERATE sends your description and the whole program {pgm} to OpenRouter (a third party).',
      loadNoteChange: 'Load replaces the text of {active} with the result as one undo step: Ctrl+Z brings the original back.',
      loadedChange: '{name} is changed. Ctrl+Z brings the original back.',
      donePlateau: 'The program passed the check and matches the planned part to {s} percent (goal {g}). Further rounds did not improve it, so refinement stopped.',
      examples: 'Examples',
      ex: ['Plate 100x60, slot 80 long, 6 wide, 2 deep', 'Rectangular pocket 60x40, depth 5, corner radius 6', 'Four Ø8 holes on a Ø60 bolt circle, depth 12'],
      model: 'Model', selected: 'Selected model', search: 'Search models', count: '{n} of {m}', noMatch: 'No model matches the search.',
      catLoading: 'Loading the model list…', catError: 'The model list could not be loaded.', catStale: 'The model list is an older copy: OpenRouter did not answer.', retry: 'Try again',
      dId: 'Model id (sent)', dName: 'Version', dCtx: 'Context', dOut: 'Effective output limit', dPrice: 'Price', dCaps: 'Supports',
      tokens: '{n} tokens', outOf: '{n} tokens (requested {r})', unknown: 'not given',
      capReasoning: 'reasoning', capTools: 'tools', capStreaming: 'streaming', yes: 'yes', no: 'no',
      reason: { medium: 'medium', 'nearest-supported': 'nearest level the model supports', 'model-default': 'the model\'s own level', none: 'none' },
      generate: 'GENERATE', cancel: 'Cancel', load: 'Load', again: 'Generate again', copy: 'Copy draft', copied: 'The draft was copied.',
      disclosure: 'Pressing GENERATE sends your description and the program text to OpenRouter (a third party).',
      progress: 'Progress',
      stage: { generation: 'Generation', validation: 'Validation', measurement: 'Measurement', refinement: 'Refinement', completion: 'Completion' },
      round: 'round {n} of {m}', stepDone: 'done', stepNow: 'in progress', stepStopped: 'stopped',
      sent: 'Request sent. Waiting for the server.', cancelling: 'Cancelling…',
      status: { waiting: 'Waiting for the model…', reasoning: 'The model is reasoning (not shown).', retry: 'The request failed before any answer came. One retry is being made.',
        truncated: 'The answer was cut off at the output limit. The next round asks for a shorter program.', validated: 'Check: {m}', measured: 'Measurement: {m}',
        measurement_timeout: 'The measurement did not arrive in time. The round is judged by the check.', plateau: 'Refinement stopped: {m}' },
      textLabel: 'Program text', draftLabel: 'Draft (not loaded)',
      done: 'The program passed the check. Press Load to open it.',
      doneMeta: '{b} blocks · round {n} · {q} requests',
      loadNote: 'Load opens it as a new program, {name}. {active} stays unchanged in the program list.',
      editNote: 'A block in {active} that is not stored with ENT is dropped.',
      loaded: '{name} is loaded. {active} stays unchanged.',
      serverSays: 'Server:',
      err: {
        no_key: 'No OpenRouter key is stored. Enter the key at the top.',
        prompt_empty: 'Describe the part first.',
        base_empty: 'There is no open program to change.',
        prompt_long: 'The description is too long (20,000 characters at most).',
        unauthorized: 'You are not signed in to the server. Sign in and open the dialog again.',
        forbidden: 'Only an administrator can change the key.',
        bad_key: 'The key was refused: it is empty, too long or contains spaces.',
        bad_request: 'The server refused the request. Shorten the description and try again.',
        key_not_stored: 'The server could not store the key (its data folder is not writable).',
        key_not_deleted: 'The server could not remove the key.',
        validator_unavailable: 'The program check is not running on the server. Restart the server.',
        model_not_allowed: 'This model is not allowed on this server. Pick another one.',
        model_unknown: 'This model is not in the list of live models. Pick another one.',
        catalog_unavailable: 'OpenRouter\'s model list could not be read. Try again in a moment.',
        busy: 'A job is already running for this account. Wait until it has finished.',
        budget_exceeded: 'This month\'s AI budget is used up. Wait for the 1st or ask the administrator.',
        validation_failed: 'The program did not pass the check. The draft is kept below and is not loaded. Change the description or pick another model.',
        no_program: 'The answer held no program. Rephrase the description.',
        truncated: 'The answer was cut off at the output limit. Describe a simpler part or pick a model with a larger output limit.',
        cancelled: 'Cancelled. Nothing was loaded.',
        timeout: 'The provider did not answer in time. Try again.',
        upstream_error: 'The provider broke off in the middle of the answer. Try again.',
        upstream_unavailable: 'The provider is not available right now. Try later or pick another model.',
        upstream_rejected: 'OpenRouter refused the request. Pick another model or change the description.',
        key_rejected: 'OpenRouter refused the key. Remove it and enter a valid key.',
        provider_credit: 'The OpenRouter account has too little credit. Add credit or change the key.',
        content_filter: 'The provider\'s filter stopped the answer. Rephrase the description.',
        prompt_too_long: 'The description leaves too little room for the answer. Shorten it or pick a model with more context.',
        internal: 'The server could not finish the job. Try again.',
        stream_ended: 'The connection to the server broke before the job finished. Nothing was loaded. Try again.',
        client_timeout: 'Nothing was heard from the server for 50 seconds. The job was stopped. Try again.',
        network: 'The server could not be reached. Check that it is running and try again.',
        other: 'The job failed ({code}). Try again.'
      }
    },
    sr: {
      offline: 'AI zahteva lokalni ili hostovani server. Ručno pravljenje radi kao i obično.',
      keyLabel: 'OpenRouter ključ',
      keyHelp: 'Ključ se šalje serveru i tamo se čuva. Nikada se ne čuva u pregledaču.',
      keySave: 'Sačuvaj ključ',
      keySaved: 'Ključ je sačuvan na serveru.',
      keyRemove: 'Ukloni ključ sa servera',
      keyRemoveSure: 'Potvrdi: ukloni ključ',
      keyRemoved: 'Ključ je uklonjen sa servera.',
      keyRemovedEnv: 'Sačuvani ključ je uklonjen. Server i dalje ima ključ iz sopstvenog podešavanja.',
      keyMigrated: 'Ključ koji je bio sačuvan u ovom pregledaču obrisan je odavde. Ključ se sada čuva na serveru.',
      prompt: 'Opišite deo',
      modeLabel: 'Šta AI treba da uradi?', modeNew: 'Novo', modeChange: 'Izmeni trenutni',
      promptChange: 'Šta da se izmeni u {pgm}?',
      exChange: ['Produbi žleb za 1 mm', 'Dodaj obaranje ivice 1 mm spolja', 'Smanji pomak na F300 u svim rezovima'],
      disclosureChange: 'Pritiskom na GENERIŠI opis i ceo program {pgm} šalju se servisu OpenRouter (treća strana).',
      loadNoteChange: 'Učitavanje zamenjuje tekst programa {active} rezultatom kao jedan korak poništavanja: Ctrl+Z vraća original.',
      loadedChange: '{name} je izmenjen. Ctrl+Z vraća original.',
      donePlateau: 'Program je prošao proveru i poklapa se sa planiranim delom {s} procenata (cilj {g}). Dalji krugovi ga nisu poboljšali, pa je dorada zaustavljena.',
      examples: 'Primeri',
      ex: ['Ploča 100x60, žleb dužine 80, širine 6, dubine 2', 'Pravougaoni džep 60x40, dubina 5, radijus ugla 6', 'Četiri rupe Ø8 na podeonom krugu Ø60, dubina 12'],
      model: 'Model', selected: 'Izabrani model', search: 'Pretraži modele', count: '{n} od {m}', noMatch: 'Nijedan model ne odgovara pretrazi.',
      catLoading: 'Učitavanje liste modela…', catError: 'Lista modela nije mogla da se učita.', catStale: 'Lista modela je starija kopija: OpenRouter nije odgovorio.', retry: 'Pokušaj ponovo',
      dId: 'ID modela (šalje se)', dName: 'Verzija', dCtx: 'Kontekst', dOut: 'Efektivno ograničenje izlaza', dPrice: 'Cena', dCaps: 'Podržava',
      tokens: '{n} tokena', outOf: '{n} tokena (traženo {r})', unknown: 'nije navedeno',
      capReasoning: 'rezonovanje', capTools: 'alati', capStreaming: 'strimovanje', yes: 'da', no: 'ne',
      reason: { medium: 'srednje', 'nearest-supported': 'najbliži nivo koji model podržava', 'model-default': 'sopstveni nivo modela', none: 'bez' },
      generate: 'GENERIŠI', cancel: 'Otkaži', load: 'Učitaj', again: 'Generiši ponovo', copy: 'Kopiraj nacrt', copied: 'Nacrt je kopiran.',
      disclosure: 'Pritiskom na GENERIŠI opis i tekst programa šalju se servisu OpenRouter (treća strana).',
      progress: 'Tok',
      stage: { generation: 'Generisanje', validation: 'Provera', measurement: 'Merenje', refinement: 'Dorada', completion: 'Završetak' },
      round: 'krug {n} od {m}', stepDone: 'gotovo', stepNow: 'u toku', stepStopped: 'prekinuto',
      sent: 'Zahtev je poslat. Čeka se server.', cancelling: 'Otkazivanje…',
      status: { waiting: 'Čeka se model…', reasoning: 'Model rezonuje (ne prikazuje se).', retry: 'Zahtev nije uspeo pre nego što je stigao odgovor. Pokušava se još jednom.',
        truncated: 'Odgovor je odsečen na ograničenju izlaza. Sledeći krug traži kraći program.', validated: 'Provera: {m}', measured: 'Merenje: {m}',
        measurement_timeout: 'Merenje nije stiglo na vreme. Krug se ocenjuje po proveri.', plateau: 'Dorada je zaustavljena: {m}' },
      textLabel: 'Tekst programa', draftLabel: 'Nacrt (nije učitan)',
      done: 'Program je prošao proveru. Pritisnite Učitaj da ga otvorite.',
      doneMeta: '{b} blokova · krug {n} · {q} zahteva',
      loadNote: 'Učitavanje ga otvara kao novi program, {name}. {active} ostaje nepromenjen u listi programa.',
      editNote: 'Blok u {active} koji nije sačuvan tasterom ENT se gubi.',
      loaded: '{name} je učitan. {active} ostaje nepromenjen.',
      serverSays: 'Server:',
      err: {
        no_key: 'Nijedan OpenRouter ključ nije sačuvan. Unesite ključ na vrhu.',
        prompt_empty: 'Prvo opišite deo.',
        base_empty: 'Nema otvorenog programa za izmenu.',
        prompt_long: 'Opis je predugačak (najviše 20.000 znakova).',
        unauthorized: 'Niste prijavljeni na server. Prijavite se i ponovo otvorite dijalog.',
        forbidden: 'Samo administrator može da menja ključ.',
        bad_key: 'Ključ nije prihvaćen: prazan je, predugačak ili sadrži razmake.',
        bad_request: 'Server nije prihvatio zahtev. Skratite opis i pokušajte ponovo.',
        key_not_stored: 'Server nije mogao da sačuva ključ (u fasciklu sa podacima ne može da se piše).',
        key_not_deleted: 'Server nije mogao da ukloni ključ.',
        validator_unavailable: 'Provera programa ne radi na serveru. Ponovo pokrenite server.',
        model_not_allowed: 'Ovaj model nije dozvoljen na ovom serveru. Izaberite drugi.',
        model_unknown: 'Ovaj model nije na listi aktivnih modela. Izaberite drugi.',
        catalog_unavailable: 'Lista modela servisa OpenRouter nije mogla da se pročita. Pokušajte ponovo za trenutak.',
        busy: 'Za ovaj nalog već radi jedan posao. Sačekajte da se završi.',
        budget_exceeded: 'Mesečni AI budžet je potrošen. Sačekajte prvi u mesecu ili pitajte administratora.',
        validation_failed: 'Program nije prošao proveru. Nacrt je sačuvan ispod i nije učitan. Izmenite opis ili izaberite drugi model.',
        no_program: 'Odgovor nije sadržao program. Preformulišite opis.',
        truncated: 'Odgovor je odsečen na ograničenju izlaza. Opišite jednostavniji deo ili izaberite model sa većim ograničenjem izlaza.',
        cancelled: 'Otkazano. Ništa nije učitano.',
        timeout: 'Provajder nije odgovorio na vreme. Pokušajte ponovo.',
        upstream_error: 'Provajder je prekinuo usred odgovora. Pokušajte ponovo.',
        upstream_unavailable: 'Provajder trenutno nije dostupan. Pokušajte kasnije ili izaberite drugi model.',
        upstream_rejected: 'OpenRouter je odbio zahtev. Izaberite drugi model ili izmenite opis.',
        key_rejected: 'OpenRouter je odbio ključ. Uklonite ga i unesite ispravan ključ.',
        provider_credit: 'OpenRouter nalog nema dovoljno kredita. Dopunite ga ili promenite ključ.',
        content_filter: 'Filter provajdera je zaustavio odgovor. Preformulišite opis.',
        prompt_too_long: 'Opis ostavlja premalo mesta za odgovor. Skratite ga ili izaberite model sa većim kontekstom.',
        internal: 'Server nije mogao da završi posao. Pokušajte ponovo.',
        stream_ended: 'Veza sa serverom je prekinuta pre kraja posla. Ništa nije učitano. Pokušajte ponovo.',
        client_timeout: 'Server se nije javio 50 sekundi. Posao je zaustavljen. Pokušajte ponovo.',
        network: 'Server nije dostupan. Proverite da li radi i pokušajte ponovo.',
        other: 'Posao nije uspeo ({code}). Pokušajte ponovo.'
      }
    }
  };
  function fill(t, v) { return String(t).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? String(v[k]) : a; }); }
  function strings(lang) { return STR[lang] || STR.sv; }
  function errorText(lang, code) { var e = strings(lang).err; return e[code] || fill(e.other, { code: code }); }
  function stepText(lang, st) {
    var L = strings(lang), t = L.stage[st.stage] || st.stage;
    return st.stage === 'refinement' && st.maxRounds ? t + ', ' + fill(L.round, { n: st.round, m: st.maxRounds }) : t;
  }
  function statusText(lang, line) {
    var t = strings(lang).status[line.code];
    return t ? fill(t, { m: line.message }) : line.message;
  }
  function announcement(lang, s) {
    var L = strings(lang), a = s.say;
    if (!a) return '';
    if (a.k === 'stage') return stepText(lang, { stage: a.stage, round: a.round, maxRounds: a.max });
    if (a.k === 'error') return errorText(lang, a.code);
    if (a.k === 'done') return L.done;
    if (a.k === 'loaded') return fill(s.loaded.changed ? L.loadedChange : L.loaded, { name: s.loaded.name, active: s.loaded.previous || '' });
    return L[a.k] || '';
  }

  var pure = { STAGES: STAGES, IDLE_MS: IDLE_MS, CANCEL_GRACE_MS: CANCEL_GRACE_MS, BROWSER_KEY_NAMES: BROWSER_KEY_NAMES, STR: STR, sseParser: sseParser, perMillion: perMillion, priceText: priceText, groupNum: groupNum,
    outputLimit: outputLimit, filterModels: filterModels, programBase: programBase, freeName: freeName, initial: initial, reduce: reduce, create: create,
    httpTransport: httpTransport, errorText: errorText, stepText: stepText, statusText: statusText, announcement: announcement };
  if (typeof window === 'undefined' || typeof document === 'undefined') return pure;

  /* ---------- 6. the view ---------- */
  var CSS = [
    '.ag{display:flex;flex-direction:column;gap:.75rem;font-size:.8125rem;color:var(--gc-ink)}',
    '.ag [hidden]{display:none!important}',
    '.ag p{margin:0;line-height:1.5}',
    '.ag-muted{color:var(--gc-ink-2);font-size:.78rem}',
    '.ag-note{border-left:.1875rem solid var(--gc-accent);padding:.375rem .625rem;background:var(--gc-elevated);color:var(--gc-ink)}',
    '.ag-key{display:flex;flex-direction:column;gap:.375rem;border:1px solid var(--gc-line-strong);border-radius:var(--gc-radius-md);padding:.625rem;background:var(--gc-elevated)}',
    '.ag-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end}',
    '.ag-row>.fld{flex:1 1 12rem}',
    '.ag .fld input,.ag .fld textarea{min-height:2.75rem}',
    '.ag .fld textarea{min-height:4.5rem}',
    '.ag .cbtn,.ag-ex button,.ag-m,.ag-link,.ag .seg button{min-height:2.75rem;min-width:2.75rem}',
    '.ag-mode{align-self:flex-start}',
    '.ag-ex{display:flex;gap:.375rem;flex-wrap:wrap}',
    '.ag-ex button{background:transparent;border:1px solid var(--gc-line);border-radius:var(--gc-radius-btn);color:var(--gc-ink-2);padding:0 .625rem;font-size:.78rem;text-align:left}',
    '.ag-ex button:hover{background:var(--gc-hover);color:var(--gc-ink)}',
    '.ag-models{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:.5rem .75rem;align-items:start}',
    '.ag-models>.ag-sel,.ag-models>.fld,.ag-models>.ag-cat{grid-column:1/-1}',
    '.ag-list{max-height:9rem;overflow:auto;border:1px solid var(--gc-line);border-radius:var(--gc-radius-md);background:var(--gc-canvas)}',
    '.ag-m{display:flex;align-items:center;gap:.5rem;width:100%;background:transparent;border:0;border-bottom:1px solid var(--gc-line-subtle);color:var(--gc-ink-2);padding:0 .625rem;text-align:left;font-size:.8125rem}',
    '.ag-m:hover{background:var(--gc-hover);color:var(--gc-ink)}',
    '.ag-m::before{content:"\\25CB";font-size:.75rem}',
    '.ag-m[aria-checked="true"]{color:var(--gc-ink);font-weight:600;box-shadow:var(--gc-inset-l3-accent)}',
    '.ag-m[aria-checked="true"]::before{content:"\\25CF";color:var(--gc-accent)}',
    '.ag-m:focus-visible{outline:2px solid var(--gc-focus);outline-offset:-2px}',
    '.ag-det{margin:0;border:1px solid var(--gc-line);border-radius:var(--gc-radius-md);padding:.5rem .625rem;display:grid;grid-template-columns:auto minmax(0,1fr);gap:.125rem .625rem;font-size:.75rem;line-height:1.45}',
    '.ag-det dt{color:var(--gc-ink-2)}',
    '.ag-det dd{margin:0;overflow-wrap:anywhere}',
    '.ag-det .ag-mono{font-family:var(--gc-font-mono)}',
    '.ag-steps{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.25rem .375rem}',
    '.ag-steps li{border:1px solid var(--gc-line);border-radius:var(--gc-radius-btn);padding:.125rem .5rem;color:var(--gc-ink-2);font-size:.75rem;line-height:1.5}',
    '.ag-steps li[aria-current="step"]{border-color:var(--gc-accent);color:var(--gc-ink);font-weight:600}',
    '.ag-steps li.ag-stop{border-style:dashed}',
    '.ag-err{border-left:.1875rem solid var(--gc-danger);padding:.375rem .625rem;background:var(--gc-elevated)}',
    '.ag-err strong{color:var(--gc-danger)}',
    '.ag-ok{border-left:.1875rem solid var(--gc-success);padding:.375rem .625rem;background:var(--gc-elevated)}',
    '.ag-ok strong{color:var(--gc-success)}',
    '.ag-text{margin:0;max-height:11rem;overflow:auto;background:var(--gc-canvas);border:1px solid var(--gc-line);border-radius:var(--gc-radius-md);padding:.5rem .625rem;font-family:var(--gc-font-mono);font-size:.75rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--gc-ink)}',
    '.ag-foot{position:sticky;bottom:-1rem;z-index:2;background:var(--gc-surface);border-top:1px solid var(--gc-line);margin:0 -1rem -1rem;padding:.625rem 1rem calc(.625rem + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:.5rem}',
    '.ag-act{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}',
    '.ag-go{flex:1 1 12rem;font-weight:600;letter-spacing:.04em}',
    '.ag-link{background:transparent;border:0;color:var(--gc-ink-2);text-decoration:underline;font-size:.78rem;padding:0 .25rem;text-align:left}',
    '.ag-link:hover{color:var(--gc-ink)}',
    '.ag-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
    '@media (max-width:40rem){.ag-models{grid-template-columns:minmax(0,1fr)}.ag-list{max-height:8.5rem}}'
  ].join('\n');

  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    for (k in attrs || {}) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'cls') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function show(n, on) { if (n.hidden === on) n.hidden = !on; }
  function text(n, t) { if (n.textContent !== t) n.textContent = t; }

  /* a key an older build kept in this browser: deleted, not read, not sent. True when there was one. */
  function dropBrowserKey() {
    var had = false;
    ['localStorage', 'sessionStorage'].forEach(function (store) {
      try {
        const st = window[store];
        BROWSER_KEY_NAMES.forEach(function (n) { if (Object.keys(st).indexOf(n) >= 0) { had = true; st.removeItem(n); } });
      } catch { /* storage is off: nothing can be stored there either */ }
    });
    return had;
  }

  function mount(ui) {
    var box = document.getElementById('new-ai');
    if (!box) { console.warn('aigen: the AI panel (#new-ai) is not in this page; the AI view is not mounted'); return null; }
    var lang = function () { return STR[ui.lang] ? ui.lang : 'sv'; }, L = function () { return strings(lang()); };
    var backend = window.TNC_BACKEND && typeof window.TNC_BACKEND.api === 'string' ? window.TNC_BACKEND : null;
    var migrated = dropBrowserKey();

    function measure(program, spec) {
      if (!spec || !window.TNC_PART || !window.TNC || !window.TNC_SIM) return null;
      if (window.TNC_PART.validate(spec)) return null;
      var tools = ui.tools.get(), opt = { tools: tools }, cfg = (window.TNC_MACHINE_CONFIGS || {})[ui.state.machine];
      if (ui.state.machine === '430' && cfg) opt.machine = cfg;
      var ex = window.TNC_PART.expand(spec, tools), r = window.TNC.run(program, opt);
      if (r.errors.length) return null;
      return window.TNC_PART.compare(ex.spec, r, window.TNC_SIM.expand(r));
    }
    function names() { return Object.keys((ui.state.pgms || {})[ui.state.machine] || {}); }
    function closeDialog() { var x = document.querySelector('#m-new [data-close]'); if (x && !document.getElementById('m-new').hidden) x.click(); }
    var host = {
      machine: function () { return ui.state.machine; },
      tools: function () { return ui.tools.get(); },
      system: function (tools) { return window.TNC_AI && window.TNC_AI.system ? window.TNC_AI.system(tools, { plan: true }) : undefined; },
      measure: window.TNC_PART && window.TNC && window.TNC_SIM ? measure : null,
      active: function () { return ui.program.name; },
      base: function () { var p = ui.program; return p && p.name ? { name: p.name, text: p.text } : null; },
      /* the program the job started from gets the result as one undo step (ui.js changeProgram): Ctrl+Z gives the original back */
      change: function (name, program) { closeDialog(); return ui.changeProgram(name, program); },
      /* the way "New program" does it: a new name, the program added and opened; the one on screen before stays as it is */
      load: function (program) {
        var base = programBase(program);
        closeDialog();
        return ui.addProgram(base, program);
      },
      pick: {
        get: function () { try { return window.localStorage.getItem(MODEL_PICK); } catch { return null; } },
        set: function (id) { try { window.localStorage.setItem(MODEL_PICK, id); } catch { /* the pick lasts for this page only */ } }
      }
    };
    var ctl = create({ transport: backend ? httpTransport(backend.api) : null, host: host });

    if (!document.getElementById('aigen-style')) document.head.appendChild(el('style', { id: 'aigen-style', text: CSS }));

    while (box.firstChild) box.removeChild(box.firstChild);   // the panel is this view's alone

    var N = {};
    N.off = el('p', { cls: 'ag-note', id: 'aigen-offline' });
    N.notice = el('p', { cls: 'ag-note', id: 'aigen-notice', role: 'status' });
    N.keyForm = el('form', { cls: 'ag-key', id: 'aigen-keyform', autocomplete: 'off', novalidate: '' });
    N.modeNew = el('button', { type: 'button', id: 'aigen-mode-new', 'data-mode': 'new' });
    N.modeChange = el('button', { type: 'button', id: 'aigen-mode-change', 'data-mode': 'change' });
    N.mode = el('div', { cls: 'seg ag-mode', id: 'aigen-mode', role: 'group' }, [N.modeNew, N.modeChange]);
    N.promptLabel = el('span', { id: 'aigen-promptl' });
    N.prompt = el('textarea', { id: 'aigen-prompt', 'data-autosave': 'aigen-prompt', rows: '3', maxlength: '20000' });
    N.exLabel = el('span', { cls: 'ag-muted', id: 'aigen-exl' });
    N.ex = el('div', { cls: 'ag-ex', id: 'aigen-ex', role: 'group', 'aria-labelledby': 'aigen-exl' });
    N.sel = el('p', { cls: 'ag-sel', id: 'aigen-selected' });
    N.qLabel = el('span');
    N.q = el('input', { id: 'aigen-q', type: 'search', autocomplete: 'off', spellcheck: 'false', 'data-autosave-exempt': 'a search box' });
    N.list = el('div', { cls: 'ag-list', id: 'aigen-list', role: 'radiogroup' });
    N.det = el('dl', { cls: 'ag-det', id: 'aigen-det' });
    N.cat = el('p', { cls: 'ag-cat ag-muted', id: 'aigen-cat' });
    N.retry = el('button', { cls: 'cbtn', type: 'button', id: 'aigen-retry' });
    N.models = el('div', { cls: 'ag-models' }, [N.sel, el('label', { cls: 'fld' }, [N.qLabel, N.q]), N.cat, N.list, N.det]);
    N.steps = el('ol', { cls: 'ag-steps', id: 'aigen-steps' });
    N.status = el('p', { cls: 'ag-muted', id: 'aigen-status' });
    N.err = el('p', { cls: 'ag-err', id: 'aigen-error' });
    N.ok = el('p', { cls: 'ag-ok', id: 'aigen-ok' });
    N.textLabel = el('span', { cls: 'ag-muted', id: 'aigen-textl' });
    N.text = el('pre', { cls: 'ag-text', id: 'aigen-text', tabindex: '0', role: 'group', 'aria-labelledby': 'aigen-textl' });
    N.prog = el('div', { id: 'aigen-progress', role: 'group' }, [N.steps, N.status]);
    N.prog.style.cssText = 'display:flex;flex-direction:column;gap:.375rem';
    N.loadNote = el('p', { cls: 'ag-muted', id: 'aigen-loadnote' });
    N.disc = el('p', { cls: 'ag-muted', id: 'aigen-disclosure' });
    N.go = el('button', { cls: 'cbtn pri ag-go', type: 'button', id: 'aigen-go', 'aria-describedby': 'aigen-disclosure' });
    N.cancel = el('button', { cls: 'cbtn', type: 'button', id: 'aigen-cancel' });
    N.again = el('button', { cls: 'cbtn', type: 'button', id: 'aigen-again' });
    N.copy = el('button', { cls: 'cbtn', type: 'button', id: 'aigen-copy' });
    N.rm = el('button', { cls: 'ag-link', type: 'button', id: 'aigen-keyrm' });
    N.foot = el('div', { cls: 'ag-foot' }, [N.loadNote, N.disc, el('div', { cls: 'ag-act' }, [N.go, N.cancel, N.again, N.copy]), N.rm]);
    N.live = el('div', { cls: 'ag-live', id: 'aigen-live', role: 'status', 'aria-live': 'polite' });
    N.main = el('div', { id: 'aigen-main' }, [N.mode, el('label', { cls: 'fld wide' }, [N.promptLabel, N.prompt]), el('div', {}, [N.exLabel, N.ex]), N.models, N.retry, N.prog, N.err, N.ok,
      el('div', { id: 'aigen-textbox' }, [N.textLabel, N.text]), N.foot]);
    N.main.style.cssText = 'display:flex;flex-direction:column;gap:.75rem';
    N.root = el('div', { cls: 'ag', id: 'aigen' }, [N.off, N.notice, N.keyForm, N.main, N.live]);
    box.appendChild(N.root);

    /* the key field exists only while the server reports no key */
    var keyInput = null, keyErr = null, keyBtn = null, keyLabel = null, keyHelp = null, rmArmed = false, hover = null, listSig = '', saidN = 0, copied = false;
    function keyField(on) {
      if (on && !keyInput) {
        keyLabel = el('span');
        keyInput = el('input', { id: 'aigen-key', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'data-autosave-exempt': 'a credential', 'aria-describedby': 'aigen-keyhelp aigen-keyerr' });
        keyBtn = el('button', { cls: 'cbtn', type: 'submit', id: 'aigen-keysave' });
        keyHelp = el('p', { cls: 'ag-muted', id: 'aigen-keyhelp' });
        keyErr = el('p', { cls: 'ag-err', id: 'aigen-keyerr' });
        N.keyForm.appendChild(el('div', { cls: 'ag-row' }, [el('label', { cls: 'fld' }, [keyLabel, keyInput]), keyBtn]));
        N.keyForm.appendChild(keyHelp); N.keyForm.appendChild(keyErr);
      } else if (!on && keyInput) {
        keyInput.value = '';
        while (N.keyForm.firstChild) N.keyForm.removeChild(N.keyForm.firstChild);
        keyInput = keyErr = keyBtn = keyLabel = keyHelp = null;
      }
      show(N.keyForm, on);
    }
    N.keyForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!keyInput) return;
      ctl.saveKey(keyInput.value).then(function (ok) { if (ok) N.prompt.focus(); else if (keyInput) keyInput.focus(); });
    });

    function detail(m) {
      var Lx = L(), lg = lang(), out = outputLimit(m), rows = [], sup = m.supports || {}, rs = m.reasoning || {};
      var yn = function (v) { return v ? Lx.yes : Lx.no; };
      rows.push([Lx.dId, m.id, true]);
      rows.push([Lx.dName, m.name || m.label]);
      rows.push([Lx.dCtx, m.context_length == null ? Lx.unknown : fill(Lx.tokens, { n: groupNum(m.context_length, lg) })]);
      rows.push([Lx.dOut, out ? fill(out.requested == null ? Lx.tokens : Lx.outOf, { n: groupNum(out.effective, lg), r: groupNum(out.requested, lg) }) : Lx.unknown]);
      rows.push([Lx.dPrice, priceText(m, lg) || Lx.unknown]);
      rows.push([Lx.dCaps, Lx.capReasoning + ': ' + (sup.reasoning ? (Lx.reason[rs.effective] || Lx.yes) : Lx.no) + ' · ' + Lx.capTools + ': ' + yn(sup.tools) + ' · ' + Lx.capStreaming + ': ' + yn(sup.streaming)]);
      while (N.det.firstChild) N.det.removeChild(N.det.firstChild);
      rows.forEach(function (r) { N.det.appendChild(el('dt', { text: r[0] })); N.det.appendChild(el('dd', { text: r[1], cls: r[2] ? 'ag-mono' : '' })); });
    }
    function byId(id) { var ms = ctl.state.catalog.models, i; for (i = 0; i < ms.length; i++) if (ms[i].id === id) return ms[i]; return null; }
    function paintList(s) {
      var Lx = L(), rows = filterModels(s.catalog.models, s.query), sig = lang() + '|' + s.query + '|' + s.catalog.models.length + '|' + s.catalog.status, shown = rows.slice(0, 60);
      if (sig !== listSig) {
        listSig = sig;
        while (N.list.firstChild) N.list.removeChild(N.list.firstChild);
        shown.forEach(function (m) { N.list.appendChild(el('button', { cls: 'ag-m', type: 'button', role: 'radio', 'data-id': m.id, 'aria-describedby': 'aigen-det', text: m.label })); });
      }
      var kids = N.list.children, i, on, any = false;
      for (i = 0; i < kids.length; i++) { on = kids[i].getAttribute('data-id') === s.model; any = any || on; kids[i].setAttribute('aria-checked', on ? 'true' : 'false'); kids[i].tabIndex = on ? 0 : -1; }
      if (!any && kids.length) kids[0].tabIndex = 0;
      N.list.setAttribute('aria-label', Lx.model);
      var cur = byId(hover) || byId(s.model), ready = s.catalog.status === 'ready';
      show(N.list, ready && shown.length > 0); show(N.det, ready && !!cur);
      if (ready && cur) detail(cur);
      text(N.cat, s.catalog.status === 'loading' ? Lx.catLoading : s.catalog.status === 'error' ? Lx.catError + ' ' + errorText(lang(), s.catalog.error.code)
        : !ready ? '' : (rows.length ? fill(Lx.count, { n: shown.length, m: s.catalog.models.length }) : Lx.noMatch) + (s.catalog.stale ? ' ' + Lx.catStale : ''));
      show(N.retry, s.catalog.status === 'error'); text(N.retry, Lx.retry);
      var selM = byId(s.model);
      text(N.sel, Lx.selected + ': ' + (selM ? selM.label : '—'));
      show(N.q.parentNode, ready);
    }
    function paintSteps(s) {
      var lg = lang(), Lx = L(), live = s.phase === 'running' || s.phase === 'cancelling', i, st, last, li, state;
      while (N.steps.firstChild) N.steps.removeChild(N.steps.firstChild);
      for (i = 0; i < s.steps.length; i++) {
        st = s.steps[i]; last = i === s.steps.length - 1;
        state = !last || s.phase === 'done' ? Lx.stepDone : live ? Lx.stepNow : Lx.stepStopped;
        li = el('li', { text: (!last || s.phase === 'done' ? '✓ ' : live ? '▸ ' : '× ') + stepText(lg, st) + ' (' + state + ')' });
        if (last && live) li.setAttribute('aria-current', 'step');
        if (last && s.phase === 'failed') li.className = 'ag-stop';
        N.steps.appendChild(li);
      }
      N.prog.setAttribute('aria-label', Lx.progress);
      var line = s.phase === 'cancelling' ? Lx.cancelling : s.lines.length ? statusText(lg, s.lines[s.lines.length - 1]) : s.phase === 'running' && !s.steps.length ? Lx.sent : '';
      text(N.status, line); show(N.status, !!line && live);
      show(N.prog, s.steps.length > 0 || live);
    }
    function render() {
      var s = ctl.state, Lx = L(), lg = lang(), online = s.phase !== 'offline' && s.phase !== 'boot', live = s.phase === 'running' || s.phase === 'cancelling', i, b;
      text(N.off, Lx.offline); show(N.off, s.phase === 'offline');
      show(N.main, online);
      var note = s.key.note === 'saved' ? Lx.keySaved : s.key.note === 'removed' ? Lx.keyRemoved : s.key.note === 'removed-env' ? Lx.keyRemovedEnv : '';
      text(N.notice, (migrated ? Lx.keyMigrated + (note ? ' ' : '') : '') + note); show(N.notice, migrated || !!note);
      keyField(online && s.key.present === false);
      if (keyInput) {
        text(keyLabel, Lx.keyLabel); text(keyBtn, Lx.keySave); text(keyHelp, Lx.keyHelp); keyBtn.disabled = s.key.busy;
        text(keyErr, s.key.error ? '⚠ ' + errorText(lg, s.key.error.code) : ''); show(keyErr, !!s.key.error);
      }
      if (!online) return;
      var change = s.mode === 'change', exs = change ? Lx.exChange : Lx.ex, exKey = lg + ':' + s.mode, baseName = (live || s.phase === 'done') && s.base ? s.base.name : ui.program.name;
      text(N.modeNew, Lx.modeNew); text(N.modeChange, Lx.modeChange); N.mode.setAttribute('aria-label', Lx.modeLabel);
      N.modeNew.setAttribute('aria-pressed', change ? 'false' : 'true'); N.modeChange.setAttribute('aria-pressed', change ? 'true' : 'false');
      N.modeNew.disabled = live; N.modeChange.disabled = live;
      text(N.promptLabel, change ? fill(Lx.promptChange, { pgm: baseName }) : Lx.prompt); text(N.exLabel, Lx.examples); text(N.qLabel, Lx.search);
      if (N.ex.getAttribute('data-lang') !== exKey) {
        N.ex.setAttribute('data-lang', exKey);
        while (N.ex.firstChild) N.ex.removeChild(N.ex.firstChild);
        for (i = 0; i < exs.length; i++) { b = el('button', { type: 'button', text: exs[i] }); N.ex.appendChild(b); }
      }
      N.prompt.readOnly = live; N.q.disabled = live;
      paintList(s); paintSteps(s);
      var e = s.error, keyGone = keyInput ? null : s.key.error;
      text(N.err, e ? '⚠ ' + errorText(lg, e.code) + (e.message && e.code !== 'cancelled' ? ' ' + Lx.serverSays + ' ' + e.message : '') : keyGone ? '⚠ ' + errorText(lg, keyGone.code) : '');
      show(N.err, !!e || !!keyGone);
      var res = s.result, v = res && res.validation, u = res && res.usage;
      var cm = res && res.measurement && res.measurement.client, pol = s.catalog.policy || {};
      var doneLine = res && res.stopped === 'plateau' && cm && typeof cm.score === 'number' ? fill(Lx.donePlateau, { s: cm.score.toFixed(1), g: pol.measure_goal == null ? 95 : pol.measure_goal }) : Lx.done;
      text(N.ok, s.phase === 'done' ? '✓ ' + (s.loaded ? fill(s.loaded.changed ? Lx.loadedChange : Lx.loaded, { name: s.loaded.name, active: s.loaded.previous || '' })
        : doneLine + ' ' + fill(Lx.doneMeta, { b: v && v.blocks != null ? v.blocks : '—', n: res.round == null ? 0 : res.round, q: u && u.requests != null ? u.requests : '—' })) : '');
      show(N.ok, s.phase === 'done');
      text(N.textLabel, s.phase === 'failed' && s.draft ? Lx.draftLabel : Lx.textLabel);
      text(N.text, s.text); show(N.text.parentNode, !!s.text);
      if (live) N.text.scrollTop = N.text.scrollHeight;
      var canLoad = s.phase === 'done' && !s.loaded;
      text(N.loadNote, canLoad ? (s.base ? fill(Lx.loadNoteChange, { active: s.base.name }) : fill(Lx.loadNote, { name: freeName(programBase(res.program), names()), active: ui.program.name })) + (ui.state.editing ? ' ' + fill(Lx.editNote, { active: ui.program.name }) : '') : '');
      show(N.loadNote, canLoad);
      text(N.disc, change ? fill(Lx.disclosureChange, { pgm: baseName }) : Lx.disclosure); show(N.disc, !canLoad && !live);
      text(N.go, canLoad ? Lx.load : Lx.generate); N.go.setAttribute('data-mode', canLoad ? 'load' : 'generate');
      show(N.go, !live && !(s.phase === 'done' && s.loaded));
      text(N.cancel, Lx.cancel); show(N.cancel, live); N.cancel.disabled = s.phase === 'cancelling';
      text(N.again, Lx.again); show(N.again, s.phase === 'done');
      text(N.copy, copied ? Lx.copied : Lx.copy); show(N.copy, s.phase === 'failed' && !!s.draft);
      text(N.rm, rmArmed ? Lx.keyRemoveSure : Lx.keyRemove); show(N.rm, s.key.stored === true && !live);
      if (s.sayN !== saidN) { saidN = s.sayN; text(N.live, announcement(lg, s)); }
    }

    /* focus follows the one action that is there: Cancel while a job runs, the primary button after it */
    var lastPhase = ctl.state.phase;
    ctl.subscribe(function (s, a) {
      var inside = N.root.contains(document.activeElement) || document.activeElement === document.body, was = lastPhase;
      lastPhase = s.phase;
      if (a.type === 'key/state' || a.type === 'job/start') { rmArmed = false; copied = false; }
      render();
      if (was === s.phase || box.hidden || !inside) return;
      if (s.phase === 'running') N.cancel.focus();
      else if ((was === 'running' || was === 'cancelling') && !N.go.hidden) N.go.focus();
    });

    N.go.addEventListener('click', function () {
      if (N.go.getAttribute('data-mode') === 'load') { ctl.load(); return; }
      ctl.generate(N.prompt.value).then(function (ok) { if (ok && window.GCDraft) window.GCDraft.clear(N.prompt); });
      var s = ctl.state;
      if (s.error && s.error.code === 'no_key' && keyInput) keyInput.focus();
      else if (s.error && s.error.code === 'prompt_empty') N.prompt.focus();
    });
    N.cancel.addEventListener('click', function () { ctl.cancel(); });
    N.again.addEventListener('click', function () { ctl.again(); N.prompt.focus(); });
    N.mode.addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (b && !b.disabled) { ctl.setMode(b.getAttribute('data-mode')); render(); } });
    N.retry.addEventListener('click', function () { ctl.refreshCatalog(); });
    N.copy.addEventListener('click', function () {
      var d = ctl.state.draft;
      if (!d || !navigator.clipboard) return;
      navigator.clipboard.writeText(d.program).then(function () { copied = true; render(); text(N.live, L().copied); }, function () {});
    });
    N.rm.addEventListener('click', function () {
      if (!rmArmed) { rmArmed = true; render(); return; }
      rmArmed = false; ctl.removeKey();
    });
    N.rm.addEventListener('blur', function () { if (rmArmed) { rmArmed = false; render(); } });
    N.ex.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || N.prompt.readOnly) return;
      N.prompt.value = b.textContent; N.prompt.dispatchEvent(new Event('input', { bubbles: true })); N.prompt.focus();
    });
    N.q.addEventListener('input', function () { hover = null; ctl.search(N.q.value); });
    function rowOf(t) { return t && t.closest ? t.closest('.ag-m') : null; }
    N.list.addEventListener('click', function (e) { var r = rowOf(e.target); if (r && !N.q.disabled) { hover = null; ctl.pickModel(r.getAttribute('data-id')); } });
    N.list.addEventListener('mouseover', function (e) { var r = rowOf(e.target); if (r) { hover = r.getAttribute('data-id'); paintList(ctl.state); } });
    N.list.addEventListener('mouseleave', function () { hover = null; paintList(ctl.state); });
    N.list.addEventListener('focusin', function (e) { var r = rowOf(e.target); if (r) { hover = r.getAttribute('data-id'); paintList(ctl.state); } });
    N.list.addEventListener('focusout', function () { hover = null; paintList(ctl.state); });
    N.list.addEventListener('keydown', function (e) {
      var r = rowOf(e.target), to = null;
      if (!r || N.q.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = r.nextElementSibling || N.list.firstElementChild;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = r.previousElementSibling || N.list.lastElementChild;
      else if (e.key === 'Home') to = N.list.firstElementChild;
      else if (e.key === 'End') to = N.list.lastElementChild;
      if (!to) return;
      e.preventDefault(); ctl.pickModel(to.getAttribute('data-id')); to.focus();
    });
    /* typing here is typing: the simulator's one-letter shortcuts stay out (Escape and Tab still reach the dialog) */
    N.root.addEventListener('keydown', function (e) { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); });

    /* the panel was opened: ask the server where things stand, put the cursor where the work starts */
    new MutationObserver(function () {
      if (box.hidden) return;
      var start = function () {
        var a = document.activeElement, t = keyInput || (N.main.hidden ? null : N.prompt);
        if (box.hidden || !t || (a !== document.body && a !== N.prompt && N.root.contains(a))) return;
        t.focus();
      };
      ctl.refresh().then(function () { render(); start(); });
      setTimeout(start, 0);
    }).observe(box, { attributes: true, attributeFilter: ['hidden'] });
    ui.on('settings', function () { listSig = ''; render(); });
    ui.on('program', render);

    if (!backend) ctl.dispatch({ type: 'offline' });
    else if (!box.hidden) ctl.refresh();
    render();
    return ctl;
  }

  var mounted = null;
  window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || [];
  window.TNC_UI_PLUGINS.push(function (ui) { mounted = mount(ui); });
  pure.controller = function () { return mounted; };
  return pure;
})();
if (typeof module !== 'undefined') module.exports = TNC_AIGEN;
