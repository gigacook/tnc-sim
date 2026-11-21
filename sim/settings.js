/* ============================================================
   TNC_SETTINGS — presentation settings, one store: localStorage "tnc.settings.v1".
   Shared by every edition on the same origin (docs/BUILD_STATE.md, Edition model). Presentation only:
   nothing here reaches the interpreter. Read before i18n.js and ui.js; ui.js applies them and draws the panel.

     lang     'sv' | 'en' | 'sr'                 default 'sv' (sr = Serbian, Latin script)
     decimal  'auto' | 'comma' | 'point'         decimal character on the screen (MP 7280); 'auto' follows the language
     skin     'auto' | '426' | '430'             controller skin; 'auto' follows the selected machine
     env      'cold-steel' | 'workshop-night'    appearance of the 3-D scene and the frame around it
     quality  'low' | 'medium' | 'high'
     motion   'auto' | 'full' | 'reduced'        'auto' follows the system setting (prefers-reduced-motion)
     sound    boolean
     setup    0 | 1                              1 = the first-run setup was finished or skipped
     tips     boolean                            shortcut hints on the keys and in tooltips
     theme    'night' | 'graphite' | 'mocha' | 'acid' | 'oled' | 'cream'   colour theme of the whole page; default 'night' (dark).
                                                 cream is the one light theme. Supersedes env for the frame (env still sets the 3-D scene)
     fskey    one key name (KeyboardEvent.key)   the fullscreen shortcut, default 'F11'
     replay   boolean                            offer the machining replay when a run finishes
     groups   object {group: mode}               the settings panel's per-group mode ('calm', 'full', 'custom' …); free-form, sim/setpanel.js owns it

   Migration (first read without a "tnc.settings.v1"): the language from "tnc.lang" and the sound switch from the
   "tnc426_prefs" cookie. The old keys are read, never deleted. Unknown or malformed values fall back to the default.
   The edition (?edition=business|play, anything else = core) is read here too and put on <html data-edition>.
   ============================================================ */
var TNC_SETTINGS = (function () {
  'use strict';
  var KEY = 'tnc.settings.v1';
  /* the one locale table: the languages, their <html lang>, their own name, and the decimal character "follow language" shows.
     The Swedish and the English manual print the same block with a comma and with a point (280 476-xx, p. 173). */
  var LOCALES = { sv: { html: 'sv', name: 'Svenska', comma: true }, en: { html: 'en', name: 'English', comma: false }, sr: { html: 'sr-Latn', name: 'Srpski', comma: true } };
  var ENUM = { lang: Object.keys(LOCALES), decimal: ['auto', 'comma', 'point'], skin: ['auto', '426', '430'], env: ['cold-steel', 'workshop-night'],
    quality: ['low', 'medium', 'high'], motion: ['auto', 'full', 'reduced'],
    theme: ['night', 'graphite', 'mocha', 'acid', 'oled', 'cream'] };
  var DEF = { v: 1, lang: 'sv', decimal: 'auto', skin: 'auto', env: 'cold-steel', quality: 'high', motion: 'auto', sound: true, setup: 0, tips: true,
    theme: 'night', fskey: 'F11', replay: true, groups: {} };
  var hasWin = typeof window !== 'undefined';

  function lsGet(k) { try { return hasWin && window.localStorage ? window.localStorage.getItem(k) : null; } catch { return null; } }
  function lsSet(k, v) { try { if (hasWin && window.localStorage) { window.localStorage.setItem(k, v); return true; } } catch {} return false; }
  /* one value, checked: the value itself or undefined */
  function clean(k, v) {
    if (ENUM[k]) return ENUM[k].indexOf(v) >= 0 ? v : undefined;
    if (k === 'sound' || k === 'tips' || k === 'replay') return typeof v === 'boolean' ? v : undefined;
    if (k === 'fskey') return typeof v === 'string' && v.length > 0 && v.length <= 16 ? v : undefined;
    if (k === 'groups') { if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      var g = {}, n; for (n in v) if (/^[a-z]{1,16}$/.test(n) && typeof v[n] === 'string' && /^[a-z]{1,16}$/.test(v[n])) g[n] = v[n]; return g; }
    if (k === 'setup') return v === 1 || v === true ? 1 : (v === 0 || v === false ? 0 : undefined);
    return undefined;
  }
  function merge(into, from) {
    if (!from || typeof from !== 'object') return into;
    var k, c;
    for (k in DEF) { if (k === 'v') continue; c = clean(k, from[k]); if (c !== undefined) into[k] = c; }
    return into;
  }
  function fromEarlierKeys() {
    var o = {}, l = lsGet('tnc.lang'), m, p;
    if (LOCALES[l]) o.lang = l;
    try { m = hasWin && document.cookie.match(/(?:^|;\s*)tnc426_prefs=([^;]*)/); p = m ? JSON.parse(decodeURIComponent(m[1])) : null;
      if (p && typeof p.sound === 'boolean') o.sound = p.sound; } catch {}
    return o;
  }
  var S = merge({}, DEF), stored = null, migrated = false;
  S.v = 1;
  try { stored = JSON.parse(lsGet(KEY) || 'null'); } catch { stored = null; }
  if (stored && typeof stored === 'object') merge(S, stored);
  else { merge(S, fromEarlierKeys()); migrated = true; }

  var subs = [];
  function save() { return lsSet(KEY, JSON.stringify(S)); }
  if (migrated) save();
  function get(k) { return S[k]; }
  /* set one value or several; returns the keys that changed. o.silent: listeners are not told (bridge: the parent set it) */
  function set(k, v, o) {
    var patch = typeof k === 'string' ? {} : (k || {}), changed = [], n, c;
    if (typeof k === 'string') patch[k] = v; else o = v;
    for (n in patch) { if (!(n in DEF) || n === 'v') continue; c = clean(n, patch[n]); if (c !== undefined && c !== S[n]) { S[n] = c; changed.push(n); } }
    if (changed.length) { save(); subs.forEach(function (fn) { try { fn(changed, o || {}); } catch {} }); }
    return changed;
  }
  function on(fn) { subs.push(fn); }
  function all() { var o = {}; for (var k in S) o[k] = S[k]; return o; }
  /* what the settings come to right now */
  function reducedMotion() {
    if (S.motion === 'reduced') return true; if (S.motion === 'full') return false;
    try { return hasWin && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }
  /* the decimal character of the screen, resolved: MP 7280 is its own parameter on the control (0 = comma, 1 = point),
     separate from the dialog language MP 7230 (manual 280 476-xx, p. 457). Display only: input takes both, stored text keeps the point. */
  function decimalComma() { return S.decimal === 'comma' || (S.decimal === 'auto' && !!(LOCALES[S.lang] || {}).comma); }
  function skinFor(machine) { return S.skin === 'auto' ? (machine === '430' ? '430' : '426') : S.skin; }

  /* edition: validated, anything else = core */
  var edition = 'core', q, h;
  try { q = hasWin ? new URLSearchParams(window.location.search).get('edition') : null; if (q === 'business' || q === 'play') edition = q; } catch {}
  if (hasWin && document.documentElement) {
    h = document.documentElement;
    h.setAttribute('data-edition', edition); h.setAttribute('data-env', S.env); h.setAttribute('data-quality', S.quality);
    h.setAttribute('data-motion', reducedMotion() ? 'reduced' : 'full'); h.lang = LOCALES[S.lang].html;
  }

  return { KEY: KEY, DEF: DEF, ENUM: ENUM, LOCALES: LOCALES, decimalComma: decimalComma, get: get, set: set, on: on, all: all, clean: clean, reducedMotion: reducedMotion, skinFor: skinFor, edition: edition, migrated: migrated };
})();
if (typeof module !== 'undefined') module.exports = TNC_SETTINGS;
