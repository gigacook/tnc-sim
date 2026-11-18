/* ============================================================
   TNC_BRIDGE — the simulator talking to the TNC server and to the web app around it.

   Two independent parts:
   1. Server (only when the server injected window.TNC_BACKEND = {api, ai} while serving the page at /sim/):
      AI goes through the server (window.TNC_AI_API): the OpenRouter key stays on the server, the browser sends
      its session cookie. Nothing of this runs in the plain page (GitHub Pages, a downloaded index.html).
   2. Embedding (whenever the page sits in an iframe of the SAME origin, with or without a server): postMessage.
      Contract: docs/BUILD_STATE.md "Bridge contract v2". Every message is checked three ways before it is acted on:
      e.origin is this origin, e.source is the parent window, and the payload has the shape of its type.
      Anything else (unknown type, wrong shape, another origin, another window) is dropped without an answer.

     v1 (unchanged)
     app -> sim  {type:'tnc:open', name, text, machine, tools}   open / replace a program
                 {type:'tnc:get', id}                            ask for the program on screen
     sim -> app  {type:'tnc:ready'}                              now with v, edition, machine, lang (additive)
                 {type:'tnc:program', id, name, machine, text}   answer to tnc:get
                 {type:'tnc:changed', name, machine, text}       after an edit (debounced)
                 {type:'tnc:selected', name, machine}            another program was opened

     v2
     app -> sim  tnc:hello {v:2} · tnc:present {lang? ('sv'|'en'|'sr'), skin?, env?, quality?, motion?, sound?} · tnc:machine {machine}
                 tnc:exec {cmd} · tnc:camera {view} · tnc:lock {locked, reason?} · tnc:tools:get {id} · tnc:tools:set {tools}
                 tnc:inspect {panel:'compare'|'diag'|'ref'|'progs'}   open the inspector on that tab (compare = the comparison in Diagnostics)
     sim -> app  tnc:ready {v:2, edition, machine, lang} · tnc:state {...} (at most 10 a second, at once on a transition)
                 tnc:tools {id, tools} · tnc:exit {} · tnc:settings {lang, skin, env, quality, motion, sound}

   The edition (?edition=business|play, anything else = core) is read by settings.js and only reported here.
   ============================================================ */
var TNC_BRIDGE = (function () {
  'use strict';
  if (typeof window === 'undefined') return null;
  var B = window.TNC_BACKEND || null, embedded = false;
  try { embedded = window.parent !== window && window.parent.location.origin === location.origin; } catch { embedded = false; }
  var edition = (window.TNC_SETTINGS && window.TNC_SETTINGS.edition) || 'core';

  /* ---- 1. server ---- */
  if (B) {
    fetch(B.api + '/info', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
      if (info && info.ai && info.ai.enabled) window.TNC_AI_API = B.ai;
    }).catch(function () {});
  }

  function post(msg) { if (embedded) try { window.parent.postMessage(msg, location.origin); } catch {} }

  /* ---- payload shapes: a message is acted on only when its checker says yes ---- */
  var isStr = function (v, max) { return typeof v === 'string' && v.length <= (max || 4000000); };
  var isId = function (v) { return typeof v === 'string' ? v.length <= 200 : (typeof v === 'number' && Number.isFinite(v)); };
  var oneOf = function (v, list) { return list.indexOf(v) >= 0; };
  var optOf = function (v, list) { return v === undefined || oneOf(v, list); };
  var MACH = ['426', '430'], LANGS = window.TNC_SETTINGS ? Object.keys(window.TNC_SETTINGS.LOCALES) : ['sv', 'en', 'sr'];
  function isTools(a) {
    if (!Array.isArray(a) || a.length > 999) return false;
    var i, t;
    for (i = 0; i < a.length; i++) { t = a[i];
      if (!t || typeof t !== 'object' || typeof t.t !== 'number' || t.t % 1 !== 0 || t.t < 0 || typeof t.l !== 'number' || !Number.isFinite(t.l) ||
          typeof t.r !== 'number' || !Number.isFinite(t.r) || t.r < 0 || (t.name !== undefined && !isStr(t.name, 200))) return false; }
    return true;
  }
  var SHAPE = {
    'tnc:open': function (m) { return isStr(m.text) && (m.name === undefined || isStr(m.name, 200)) && (m.machine === undefined || m.machine === null || oneOf(m.machine, MACH)) && (m.tools === undefined || m.tools === null || isTools(m.tools)); },
    'tnc:get': function (m) { return m.id === undefined || isId(m.id); },
    'tnc:hello': function (m) { return m.v === 2; },
    'tnc:present': function (m) { return optOf(m.lang, LANGS) && optOf(m.skin, MACH) && optOf(m.env, ['cold-steel', 'workshop-night']) && optOf(m.quality, ['low', 'medium', 'high']) &&
      optOf(m.motion, ['full', 'reduced']) && (m.sound === undefined || typeof m.sound === 'boolean'); },
    'tnc:machine': function (m) { return oneOf(m.machine, MACH); },
    'tnc:exec': function (m) { return oneOf(m.cmd, ['start', 'stop', 'step', 'reset']); },
    'tnc:camera': function (m) { return oneOf(m.view, ['orbit', 'pov', 'tool', 'part', 'plan']); },
    'tnc:lock': function (m) { return typeof m.locked === 'boolean' && (m.reason === undefined || isStr(m.reason, 200)); },
    'tnc:tools:get': function (m) { return isId(m.id); },
    'tnc:tools:set': function (m) { return isTools(m.tools); },
    'tnc:inspect': function (m) { return oneOf(m.panel, ['compare', 'diag', 'ref', 'progs']); }
  };
  function valid(m) { return !!m && typeof m === 'object' && !Array.isArray(m) && typeof m.type === 'string' && Object.hasOwn(SHAPE, m.type) && SHAPE[m.type](m) === true; }

  var dropped = 0;
  (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
    if (!embedded) return;
    var ready = function () { post({ type: 'tnc:ready', v: 2, edition: edition, machine: ui.state.machine, lang: ui.lang }); };

    /* v1: the program on screen */
    var t = 0;
    ui.on('text', function (p) {
      clearTimeout(t);
      t = setTimeout(function () { post({ type: 'tnc:changed', name: p.name, machine: p.machine, text: p.text }); }, 400);
    });
    ui.on('program', function (p) { post({ type: 'tnc:selected', name: p.name, machine: p.machine }); });

    /* v2: the run. Sent when it changed: at once on a transition, else at most every 100 ms. */
    var lastSent = 0, lastJson = '', lastKey = '';
    function state(force) {
      var st = ui.runState(), key = [st.running, st.done, st.mode, st.machine, st.errors, st.cutting, st.locked, st.tool && st.tool.t].join('|'), now = Date.now();
      if (key === lastKey && !force && now - lastSent < 100) return;
      var json = JSON.stringify(st); if (json === lastJson && !force) return;
      lastKey = key; lastJson = json; lastSent = now; st.type = 'tnc:state'; post(st);
    }
    ui.on('tick', function () { state(false); });
    ui.on('settings', function (s, how) { if (how && how.silent) return; post({ type: 'tnc:settings', lang: s.lang, skin: s.skin, env: s.env, quality: s.quality, motion: s.motion, sound: s.sound }); });

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || e.source !== window.parent || !valid(e.data)) { dropped++; return; }
      var m = e.data, p, o;
      switch (m.type) {
        case 'tnc:open': ui.open(m.name, m.text, { machine: m.machine || undefined, tools: m.tools || undefined }); break;
        case 'tnc:get': { p = ui.program; post({ type: 'tnc:program', id: m.id, name: p.name, machine: p.machine, text: p.text }); break; }
        case 'tnc:hello': ready(); state(true); break;
        case 'tnc:present': { o = {}; ['lang', 'skin', 'env', 'quality', 'motion', 'sound'].forEach(function (k) { if (m[k] !== undefined) o[k] = m[k]; }); ui.present(o); break; }
        case 'tnc:machine': ui.setMachine(m.machine); state(true); break;
        case 'tnc:exec': ui.exec(m.cmd); state(true); break;
        case 'tnc:camera': ui.cameraPreset(m.view); break;
        case 'tnc:lock': ui.lock(m.locked, m.reason); state(true); break;
        case 'tnc:tools:get': post({ type: 'tnc:tools', id: m.id, tools: ui.tools.get() }); break;
        case 'tnc:tools:set': ui.tools.set(m.tools); state(true); break;
        case 'tnc:inspect': ui.inspect(m.panel); break;
      }
    });
    ui.on('ready', ready);
  });

  return { embedded: embedded, backend: B, edition: edition, exit: function () { post({ type: 'tnc:exit' }); }, get dropped() { return dropped; } };
})();
if (typeof module !== 'undefined') module.exports = TNC_BRIDGE;
