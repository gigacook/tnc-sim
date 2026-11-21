/* ============================================================
   TNC_SHEET — the operator's profile as a bottom sheet: flat terminal lines on the left
   (namn / program / verktyg / maskiner / mapp / språk / tema / sparad), the programs as cards on the right.
   Every program is its own card; the older "projects" stay in the stored profile, untouched, and are not shown.
   Storage, import / export and the program library are ui.js's (TNC_UI.library, TNC_UI.profile); nothing is stored here
   except the viewer's card sort and size (localStorage "tnc.sheet.v1", a convenience).
   TNC_SHEET = { open(), close(), get isOpen }
   ============================================================ */
var TNC_SHEET = (function () {
  'use strict';
  var STR = {
    sv: { name: 'namn', programs: 'program', tools: 'verktyg', machines: 'maskiner', folder: 'mapp', lang: 'språk', theme: 'tema', saved: 'sparad',
      own: '{n} egna', examples: '{n} exempel', toolsN: '{n} verktyg', notSaved: 'inte sparad än', blocked: 'lagring blockerad',
      pickFolder: 'välj mapp', import: 'importera', export: 'exportera', newProfile: 'ny profil', close: 'stäng',
      sort: 'sortera', recent: 'senast använd', created: 'skapad', byName: 'namn', size: 'storlek', owner: 'ägare', cards: 'kort',
      newPgm: '+ Nytt program', openText: 'öppna i texteditor', dlH: 'ladda ner .H', rename: 'byt namn', del: 'radera', restore: 'återställ original',
      delAsk: 'Radera {n}?', restoreAsk: 'Återställ {n} till originalet?', cancel: 'avbryt', never: 'aldrig öppnad', today: 'i dag {t}', yesterday: 'i går {t}',
      blocks: '{n} block', example: 'exempel', you: 'du', exists: 'namnet finns redan', merge: 'slå ihop', replace: 'ersätt',
      profileFile: '{f} · profil "{n}" · {p} program', replaceAsk: 'Ersätt hela profilen med {n}? Dina nuvarande program försvinner.',
      actions: 'åtgärder för {n}', open: 'öppna {n}', sheet: 'Profil', list: 'Program', deleted: '{n} RADERAD', restored: '{n} ÅTERSTÄLLD',
      perm: 'behörighet krävs', missing: 'saknas', newName: 'namn på nytt program', create: 'skapa',
      themes: { night: 'natt', graphite: 'grafit', mocha: 'mocka', acid: 'acid', oled: 'oled', cream: 'krämvit', light: 'ljus', dark: 'mörk' } },
    en: { name: 'name', programs: 'programs', tools: 'tools', machines: 'machines', folder: 'folder', lang: 'language', theme: 'theme', saved: 'saved',
      own: '{n} yours', examples: '{n} examples', toolsN: '{n} tools', notSaved: 'not saved yet', blocked: 'storage blocked',
      pickFolder: 'choose folder', import: 'import', export: 'export', newProfile: 'new profile', close: 'close',
      sort: 'sort', recent: 'last used', created: 'created', byName: 'name', size: 'size', owner: 'owner', cards: 'cards',
      newPgm: '+ New program', openText: 'open in text editor', dlH: 'download .H', rename: 'rename', del: 'delete', restore: 'restore original',
      delAsk: 'Delete {n}?', restoreAsk: 'Restore {n} to the original?', cancel: 'cancel', never: 'never opened', today: 'today {t}', yesterday: 'yesterday {t}',
      blocks: '{n} blocks', example: 'example', you: 'you', exists: 'name already taken', merge: 'merge', replace: 'replace',
      profileFile: '{f} · profile "{n}" · {p} programs', replaceAsk: 'Replace your whole profile with {n}? Your current programs will be gone.',
      actions: 'actions for {n}', open: 'open {n}', sheet: 'Profile', list: 'Programs', deleted: '{n} DELETED', restored: '{n} RESTORED',
      perm: 'permission needed', missing: 'missing', newName: 'name of the new program', create: 'create',
      themes: { night: 'night', graphite: 'graphite', mocha: 'mocha', acid: 'acid', oled: 'oled', cream: 'cream', light: 'light', dark: 'dark' } },
    sr: { name: 'ime', programs: 'programi', tools: 'alati', machines: 'mašine', folder: 'fascikla', lang: 'jezik', theme: 'tema', saved: 'sačuvano',
      own: '{n} tvojih', examples: '{n} primera', toolsN: '{n} alata', notSaved: 'još nije sačuvano', blocked: 'skladište blokirano',
      pickFolder: 'izaberi fasciklu', import: 'uvezi', export: 'izvezi', newProfile: 'novi profil', close: 'zatvori',
      sort: 'sortiraj', recent: 'poslednje korišćeno', created: 'napravljeno', byName: 'ime', size: 'veličina', owner: 'vlasnik', cards: 'kartice',
      newPgm: '+ Novi program', openText: 'otvori u uređivaču teksta', dlH: 'preuzmi .H', rename: 'preimenuj', del: 'obriši', restore: 'vrati original',
      delAsk: 'Obrisati {n}?', restoreAsk: 'Vratiti {n} na original?', cancel: 'otkaži', never: 'nikad otvoren', today: 'danas {t}', yesterday: 'juče {t}',
      blocks: '{n} blokova', example: 'primer', you: 'ti', exists: 'ime je zauzeto', merge: 'spoji', replace: 'zameni',
      profileFile: '{f} · profil "{n}" · {p} programa', replaceAsk: 'Zameniti ceo profil sa {n}? Tvoji sadašnji programi će nestati.',
      actions: 'radnje za {n}', open: 'otvori {n}', sheet: 'Profil', list: 'Programi', deleted: '{n} OBRISAN', restored: '{n} VRAĆEN',
      perm: 'potrebna dozvola', missing: 'nedostaje', newName: 'ime novog programa', create: 'napravi',
      themes: { night: 'noć', graphite: 'grafit', mocha: 'moka', acid: 'acid', oled: 'oled', cream: 'krem', light: 'svetla', dark: 'tamna' } }
  };
  var lang = function () { var l = (window.TNC_I18N && TNC_I18N.lang) || 'sv'; return STR[l] ? l : 'sv'; };
  function L(k, v) {
    var s = STR[lang()][k]; if (s == null) s = STR.en[k]; if (s == null) s = k;
    return v ? String(s).replace(/\{(\w+)\}/g, function (a, x) { return v[x] == null ? a : String(v[x]); }) : s;
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var UI = function () { return window.TNC_UI || null; };
  var reduced = function () { return document.documentElement.getAttribute('data-motion') === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches; };

  /* ---------- the viewer's card sort and size ---------- */
  var PREF_KEY = 'tnc.sheet.v1', SORTS = ['recent', 'created', 'name', 'size', 'owner'], SIZES = ['S', 'M', 'L'];
  function prefs() { var o = {}; try { o = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { o = {}; }
    return { sort: SORTS.indexOf(o.sort) >= 0 ? o.sort : 'recent', size: SIZES.indexOf(o.size) >= 0 ? o.size : 'M' }; }
  function setPref(k, v) { var o = prefs(); o[k] = v; try { localStorage.setItem(PREF_KEY, JSON.stringify(o)); } catch (e) { /* per page load */ } }

  /* ---------- CSS: page tokens (--gc-*) for the frame, program-screen tokens (--scr-*) for the sheet ---------- */
  var CSS = [
    '.tsh-scrim{position:fixed;inset:0;z-index:71;background:var(--gc-scrim);opacity:0;transition:opacity 220ms var(--gc-ease)}',
    '.tsh-scrim.on{opacity:1}',
    '.tsh{position:fixed;left:0;right:0;bottom:0;z-index:72;height:min(74vh,700px);display:flex;flex-direction:column;background:var(--scr);color:var(--scr-ink);',
    '  font:14px/1.75 var(--gc-font-mono);border-top:1px solid var(--scr-line-strong);box-shadow:0 -18px 48px var(--gc-shade);transform:translateY(100%);',
    '  transition:transform 240ms var(--gc-ease);padding-bottom:env(safe-area-inset-bottom,0px)}',
    '.tsh.on{transform:translateY(0)}',
    '.tsh[hidden],.tsh-scrim[hidden]{display:none}',
    '.tsh.drag{transition:none}',
    'html[data-motion="reduced"] .tsh,html[data-motion="reduced"] .tsh-scrim{transition:none}',
    '@media (prefers-reduced-motion:reduce){.tsh,.tsh-scrim{transition:none}}',
    ':where(.tsh) button{font:inherit;color:inherit;background:transparent;border:0;padding:0;cursor:pointer;text-align:left}',
    '.tsh :focus-visible{outline:2px solid var(--scr-accent);outline-offset:2px}',
    '.tsh-grab{flex:none;height:22px;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none}',
    '.tsh-grab i{display:block;width:44px;height:4px;border-radius:2px;background:var(--scr-line-strong);opacity:.7}',
    '.tsh-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,30rem) 1fr;gap:0}',
    '.tsh-lines{overflow:auto;padding:4px 28px 18px;border-right:1px solid var(--scr-line)}',
    '.tsh-ln{display:flex;gap:14px;align-items:baseline;min-height:26px}',
    '.tsh-ln>.a{color:var(--scr-muted);width:10ch;flex:none}',
    '.tsh-ln>.v{color:var(--scr-ink);min-width:0;display:flex;flex-direction:column}',
    '.tsh-ln>.v>*{overflow-wrap:anywhere}',
    '.tsh-ln .lnk:hover,.tsh-ln .lnk:focus-visible{color:var(--scr-accent)}',
    '.tsh-ln .dim{color:var(--scr-muted)}',
    '.tsh-gap{height:10px}',
    '.tsh-name{font:inherit;color:var(--scr-ink);background:transparent;border:0;border-bottom:1px solid var(--scr-line-strong);padding:0 2px;width:18ch;max-width:100%;outline:none;border-radius:0}',
    '.tsh-name:focus{border-bottom-color:var(--scr-accent)}',
    '.tsh .ok{color:var(--scr-success)} .tsh .wa{color:var(--scr-warning)} .tsh .er{color:var(--scr-danger)}',
    '.tsh-g{display:inline-block;width:1.6ch}',
    '.tsh-ask{margin-top:10px;color:var(--scr-ink)}',
    '.tsh-ask .row{display:flex;gap:18px;flex-wrap:wrap}',
    '.tsh-ask button{color:var(--scr-accent)}',
    '.tsh-pg{min-width:0;min-height:0;display:flex;flex-direction:column}',
    '.tsh-bar{flex:none;display:flex;flex-wrap:wrap;gap:4px 18px;align-items:baseline;padding:4px 24px 8px;color:var(--scr-muted);font-size:13px}',
    '.tsh-bar .grp{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}',
    '.tsh-bar [role=radio]{color:var(--scr-ink-2);border-bottom:1px solid transparent;line-height:1.5}',
    '.tsh-bar [role=radio][aria-checked=true]{color:var(--scr-accent);border-bottom-color:var(--scr-accent)}',
    '.tsh-cards{flex:1;min-height:0;overflow:auto;padding:2px 24px 20px;display:grid;gap:12px;align-content:start;grid-template-columns:repeat(auto-fill,minmax(var(--tsh-w,210px),1fr))}',
    '.tsh-cards[data-size=S]{--tsh-w:160px}.tsh-cards[data-size=L]{--tsh-w:290px}',
    '.tsh-card{position:relative;background:var(--scr-hi);border:1px solid var(--scr-line);border-radius:var(--gc-radius-md);min-width:0;display:flex}',
    '.tsh-card:hover{border-color:var(--scr-line-strong)}',
    '.tsh-card.cur{box-shadow:var(--gc-inset-l3-scr-accent)}',
    '.tsh-open{flex:1;min-width:0;display:flex;flex-direction:column;gap:0;padding:10px 12px 10px;line-height:1.5;font-size:12.5px;color:var(--scr-muted)!important}',
    '.tsh-th{display:block;width:100%;height:84px;margin:0 0 8px;background:var(--scr-2);border-radius:var(--gc-radius-xs)}',
    '.tsh-cards[data-size=S] .tsh-th{display:none}.tsh-cards[data-size=L] .tsh-th{height:130px}',
    '.tsh-nm{font-size:15.5px;font-weight:600;color:var(--scr-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:22px;line-height:1.45}',
    '.tsh-cards[data-size=L] .tsh-nm{font-size:17px}',
    '.tsh-open>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tsh-more{position:absolute;top:6px;right:6px;width:26px;height:26px;text-align:center!important;color:var(--scr-muted)!important;border-radius:var(--gc-radius-btn);line-height:26px}',
    '.tsh-more:hover,.tsh-more[aria-expanded=true]{color:var(--scr-ink)!important;background:var(--scr-fill)!important}',
    '.tsh-menu{position:absolute;inset:0;background:var(--scr-hi);border-radius:var(--gc-radius-md);padding:10px 12px;display:flex;flex-direction:column;gap:2px;font-size:13px;z-index:1;overflow:auto}',
    '.tsh-menu[hidden]{display:none}',
    '.tsh-menu button{color:var(--scr-accent);line-height:1.6}',
    '.tsh-menu button.er{color:var(--scr-danger)}',
    '.tsh-menu .q{color:var(--scr-ink);font-weight:600;overflow-wrap:anywhere}',
    '.tsh-menu .row{display:flex;gap:16px;margin-top:4px}',
    '.tsh-menu input,.tsh-new input{font:inherit;color:var(--scr-ink);background:transparent;border:0;border-bottom:1px solid var(--scr-accent);outline:none;width:100%;padding:0;border-radius:0}',
    '.tsh-menu .msg{color:var(--scr-danger);font-size:12px}',
    '.tsh-new{border-style:dashed;align-items:stretch}',
    '.tsh-new .tsh-open{justify-content:center;align-items:center;color:var(--scr-accent)!important;font-size:14px;min-height:76px}',
    '.tsh-new .tsh-menu{position:static;background:transparent}',
    '.tsh-act{flex:none;display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline;padding:10px 28px 12px;border-top:1px solid var(--scr-line)}',
    '.tsh-act button{color:var(--scr-accent)}',
    '.tsh-act .sp{flex:1}',
    '.tsh-act button.dim{color:var(--scr-muted)}',
    '.tsh-act button:hover{text-decoration:underline}',
    '.tsh kbd{font:12px var(--gc-font-mono);color:var(--scr-muted);margin-left:5px}',
    '@media (max-width:760px){',
    '  .tsh{height:100%;height:100dvh;border-top:0}',
    '  .tsh-main{display:block;overflow:auto}',
    '  .tsh-lines{border-right:0;border-bottom:1px solid var(--scr-line);padding:4px 16px 14px;overflow:visible}',
    '  .tsh-pg{display:block}',
    '  .tsh-bar{padding:10px 16px 8px}',
    '  .tsh-cards{overflow:visible;padding:2px 16px 16px;grid-template-columns:1fr!important}',
    '  .tsh-act{padding:10px 16px 12px;gap:6px 16px}',
    '  .tsh kbd{display:none}',
    '}'
  ].join('\n');
  function injectCSS() { if (document.getElementById('tsh-css')) return; var s = document.createElement('style'); s.id = 'tsh-css'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- formatting ---------- */
  var htmlLang = function () { return { sv: 'sv-SE', en: 'en-GB', sr: 'sr-Latn' }[lang()]; };
  var comma = function () { return lang() !== 'en'; };
  function hm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function when(iso) {
    if (!iso) return L('never');
    var d = new Date(iso); if (isNaN(d)) return L('never');
    var now = new Date(), day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var dd = Math.round((day(now) - day(d)) / 864e5);
    if (dd === 0) return L('today', { t: hm(d) });
    if (dd === 1) return L('yesterday', { t: hm(d) });
    var o = { day: 'numeric', month: 'short' }; if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
    try { return d.toLocaleDateString(htmlLang(), o) + ' ' + hm(d); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  function bytes(n) { if (n < 1000) return n + ' B'; var s = (n / 1000).toFixed(n < 1e5 ? 1 : 0) + ' kB'; return comma() ? s.replace('.', ',') : s; }
  function mmss(s) { s = Math.max(0, +s || 0); var m = Math.floor(s / 60), r = Math.round(s % 60); if (r === 60) { m++; r = 0; } return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  var l2 = function (s) { return L('blocks', { n: s.blocks }) + ' · ' + (s.unchecked ? '—' : mmss(s.time)); };
  var lastUsed = function (p) { var a = p.meta.o || '', b = p.meta.m || ''; return a > b ? a : b; };

  /* ---------- per-program summary (blocks, run time, check, XY path): computed in the background, cached by text ---------- */
  var CACHE = {}, BIG = 400000;   // a program over 400 kB is not run for its card: ▲ = not checked here (the editor and the simulator check it)
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }
  function summaryKey(p) { var t = UI().library.text(p.machine, p.name) || ''; return { k: p.machine + '|' + p.name, h: t.length + ':' + hash(t), t: t }; }
  function summarize(p) {
    var sk = summaryKey(p), c = CACHE[sk.k]; if (c && c.h === sk.h) return c.s;
    if (sk.t.length > BIG) { var s0 = { blocks: sk.t.split('\n').length, time: 0, state: 'warn', errors: 0, segs: [], stock: null, unchecked: true }; CACHE[sk.k] = { h: sk.h, s: s0 }; return s0; }
    var r = UI().library.run(p.machine, sk.t, { expand: true }), res = r.res || {}, ex = r.ex;
    var errs = (res.errors || []).length, crash = false, warn = false;
    var segs = [], st = res.stock || null;
    if (ex && ex.segs) { var step = Math.max(1, Math.ceil(ex.segs.length / 4000));
      for (var i = 0; i < ex.segs.length; i += step) { var s = ex.segs[i]; segs.push([s.a.x, s.a.y, s.b.x, s.b.y, s.kind === 'rapid' ? 1 : 0]); } }
    var s2 = { blocks: (res.blocks || []).filter(function (b) { return b.kind !== 'BLANK'; }).length, time: ex ? ex.total : 0,
      state: errs || crash ? 'bad' : (warn ? 'warn' : 'ok'), errors: errs, segs: segs, stock: st };
    CACHE[sk.k] = { h: sk.h, s: s2 }; return s2;
  }
  function cached(p) { var sk = summaryKey(p), c = CACHE[sk.k]; return c && c.h === sk.h ? c.s : null; }

  function drawThumb(cv, s) {
    if (!cv || !s) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var g = cv.getContext('2d'); if (!g) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    var cs = getComputedStyle(cv), acc = cs.getPropertyValue('--scr-accent').trim() || '#06c', mut = cs.getPropertyValue('--scr-muted').trim() || '#888', line = cs.getPropertyValue('--scr-line-strong').trim() || '#999';
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, st = s.stock;
    if (st && st.x1 > st.x0 && st.y1 > st.y0) { x0 = st.x0; y0 = st.y0; x1 = st.x1; y1 = st.y1; }
    s.segs.forEach(function (q) { if (q[4]) return; x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]); });
    if (!isFinite(x0) || x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return;
    var pad = 8, k = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0)), ox = (w - k * (x1 - x0)) / 2, oy = (h - k * (y1 - y0)) / 2;
    var X = function (x) { return ox + (x - x0) * k; }, Y = function (y) { return h - oy - (y - y0) * k; };
    if (st && st.x1 > st.x0) { g.strokeStyle = line; g.globalAlpha = .55; g.lineWidth = 1; g.strokeRect(X(st.x0) + .5, Y(st.y1) + .5, (st.x1 - st.x0) * k, (st.y1 - st.y0) * k); }
    g.globalAlpha = .35; g.strokeStyle = mut; g.setLineDash([2, 3]); g.beginPath();
    s.segs.forEach(function (q) { if (q[4]) { g.moveTo(X(q[0]), Y(q[1])); g.lineTo(X(q[2]), Y(q[3])); } }); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1; g.strokeStyle = acc; g.lineWidth = 1.1; g.beginPath();
    s.segs.forEach(function (q) { if (!q[4]) { g.moveTo(X(q[0]), Y(q[1])); g.lineTo(X(q[2]), Y(q[3])); } }); g.stroke();
  }

  /* ---------- state ---------- */
  var root = null, scrim = null, back = null, openNow = false, queueT = 0, askInc = null, folderInfo = null, newOpen = false;

  function items() {
    var ui = UI(), cur = ui.state.machine;
    return ui.library.list().filter(function (p) { return p.own || p.machine === cur; });
  }
  function sorted(list) {
    var by = prefs().sort, nm = function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : (a.machine < b.machine ? -1 : 1); };
    var rec = function (a, b) { var x = lastUsed(a), y = lastUsed(b); if (x !== y) return x > y ? -1 : 1; if (a.own !== b.own) return a.own ? -1 : 1; return nm(a, b); };
    var f = { recent: rec, name: nm,
      created: function (a, b) { var x = a.meta.c || '', y = b.meta.c || ''; return x !== y ? (x > y ? -1 : 1) : rec(a, b); },
      size: function (a, b) { return a.bytes !== b.bytes ? b.bytes - a.bytes : nm(a, b); },
      owner: function (a, b) { return a.own !== b.own ? (a.own ? -1 : 1) : rec(a, b); } }[by] || rec;
    return list.slice().sort(f);
  }

  /* ---------- render ---------- */
  function glyph(state) { return state === 'ok' ? '<span class="tsh-g ok" data-glyph="ok">✓</span>' : state === 'warn' ? '<span class="tsh-g wa" data-glyph="warn">▲</span>' : '<span class="tsh-g er" data-glyph="bad">✕</span>'; }
  function line(a, v, cls) { return '<div class="tsh-ln' + (cls ? ' ' + cls : '') + '"><span class="a">' + esc(a) + '</span><span class="v">' + v + '</span></div>'; }
  function themeName() {
    var t = document.documentElement.getAttribute('data-theme') || (window.TNC_SETTINGS && TNC_SETTINGS.get && TNC_SETTINGS.get('theme')) || 'night';
    var th = L('themes'); return (th && th[t]) || t;
  }
  function langName() { var S = window.TNC_SETTINGS, l = lang(); return (S && S.LOCALES && S.LOCALES[l] && S.LOCALES[l].name) || l; }

  function linesHTML() {
    var ui = UI(), all = ui.library.list(), own = all.filter(function (p) { return p.own; }).length, ex = {};
    all.forEach(function (p) { if (!p.own) ex[p.name] = 1; });
    var tools = (ui.tools && ui.tools.get ? ui.tools.get().length : 0), cur = ui.state.machine;
    var mach = ui.library.machines().map(function (m) { return '<button type="button" class="lnk' + (m.id === cur ? '' : ' dim') + '" data-mach="' + esc(m.id) + '" aria-pressed="' + (m.id === cur) + '">' + esc(m.label) + '</button>'; }).join('<span class="dim"> · </span>');
    var f = folderInfo, fl = f ? '<button type="button" class="lnk" data-folder="' + f.state + '">' + glyph(f.state) + esc(f.path === 'default' ? 'default' : f.path) +
      (f.state === 'warn' ? ' <span class="dim">' + esc(L('perm')) + '</span>' : f.state === 'bad' ? ' <span class="dim">' + esc(L('missing')) + '</span>' : '') + '</button>' : '<span class="dim">…</span>';
    var at = ui.profile.savedAt, sv = ui.profile.blocked ? glyph('bad') + esc(L('blocked')) : at ? glyph('ok') + esc(hm(at)) : glyph('warn') + esc(L('notSaved'));
    return line(L('name'), '<input class="tsh-name" id="tsh-name" maxlength="40" autocomplete="name" spellcheck="false" data-autosave-exempt="saved to the profile on every keystroke" aria-label="' + esc(L('name')) + '" value="' + esc(ui.profile.name) + '">') +
      '<div class="tsh-gap"></div>' +
      line(L('programs'), '<span>' + esc(L('own', { n: own })) + '<span class="dim"> · </span>' + esc(L('examples', { n: Object.keys(ex).length })) + '</span>', 'ln-pgm') +
      line(L('tools'), '<button type="button" class="lnk" data-tt="1">TOOL.T<span class="dim"> · </span>' + esc(L('toolsN', { n: tools })) + '</button>', 'ln-tools') +
      line(L('machines'), '<span>' + mach + '</span>', 'ln-mach') +
      '<div class="tsh-gap"></div>' +
      line(L('folder'), fl, 'ln-folder') +
      '<div class="tsh-gap"></div>' +
      line(L('lang'), '<button type="button" class="lnk" data-set="lang">' + esc(langName()) + '</button>', 'ln-lang') +
      line(L('theme'), '<button type="button" class="lnk" data-set="theme">' + esc(themeName()) + '</button>', 'ln-theme') +
      line(L('saved'), '<span id="tsh-saved">' + sv + '</span>', 'ln-saved') +
      '<div class="tsh-ask" id="tsh-ask"></div>';
  }
  function cardHTML(p, i) {
    var s = cached(p), owner = p.own ? '' : esc(L('example')) + ' · ';
    var st = s ? glyph(s.state) : '<span class="tsh-g dim">·</span>';
    return '<div class="tsh-card' + (p.current ? ' cur' : '') + '" role="listitem" data-m="' + esc(p.machine) + '" data-n="' + esc(p.name) + '" data-i="' + i + '">' +
      '<button type="button" class="tsh-open" data-open="1" aria-label="' + esc(L('open', { n: p.name })) + '">' +
      '<canvas class="tsh-th" aria-hidden="true"></canvas>' +
      '<span class="tsh-nm">' + esc(p.name) + '</span>' +
      '<span class="l1">' + owner + esc(when(lastUsed(p))) + '</span>' +
      '<span class="l2">' + (s ? esc(l2(s)) : '…') + '</span>' +
      '<span class="l3">' + esc(p.machine) + ' · <span class="st">' + st + '</span> · ' + esc(bytes(p.bytes)) + '</span>' +
      '</button>' +
      '<button type="button" class="tsh-more" data-more="1" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(L('actions', { n: p.name })) + '">⋯</button>' +
      '<div class="tsh-menu" hidden></div></div>';
  }
  function cardsHTML() {
    var list = sorted(items());
    return '<div class="tsh-card tsh-new" role="listitem" data-new="1"><button type="button" class="tsh-open" data-newpgm="1">' + esc(L('newPgm')) + '</button><div class="tsh-menu" hidden></div></div>' +
      list.map(cardHTML).join('');
  }
  function barHTML() {
    var p = prefs();
    var radio = function (grp, v, label, on) { return '<button type="button" role="radio" data-' + grp + '="' + v + '" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + esc(label) + '</button>'; };
    return '<div class="grp" role="radiogroup" aria-label="' + esc(L('sort')) + '" id="tsh-sort">' +
      SORTS.map(function (s) { return radio('sort', s, L({ recent: 'recent', created: 'created', name: 'byName', size: 'size', owner: 'owner' }[s]), p.sort === s); }).join('') + '</div>' +
      '<div class="grp" role="radiogroup" aria-label="' + esc(L('cards')) + '" id="tsh-size">' + SIZES.map(function (s) { return radio('size', s, s, p.size === s); }).join('') + '</div>';
  }
  function actHTML() {
    return '<button type="button" data-act="folder">' + esc(L('pickFolder')) + '</button>' +
      '<button type="button" data-act="import">' + esc(L('import')) + '<kbd>Ctrl I</kbd></button>' +
      '<button type="button" data-act="export">' + esc(L('export')) + '<kbd>Ctrl E</kbd></button>' +
      '<span class="sp"></span>' +
      '<button type="button" class="dim" data-act="new">' + esc(L('newProfile')) + '</button>' +
      '<button type="button" class="dim" data-act="close">' + esc(L('close')) + '<kbd>Esc</kbd></button>';
  }

  function build() {
    injectCSS();
    scrim = document.createElement('div'); scrim.className = 'tsh-scrim'; scrim.hidden = true;
    root = document.createElement('section'); root.className = 'tsh'; root.id = 'tsh'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="tsh-grab" id="tsh-grab"><i></i></div><div class="tsh-main"><div class="tsh-lines" id="tsh-lines"></div>' +
      '<div class="tsh-pg"><div class="tsh-bar" id="tsh-bar"></div><div class="tsh-cards" role="list" id="tsh-cards"></div></div></div><div class="tsh-act" id="tsh-act"></div>';
    document.body.appendChild(scrim); document.body.appendChild(root);
    scrim.addEventListener('click', close);
    root.addEventListener('click', onClick);
    root.addEventListener('input', function (e) { if (e.target.id === 'tsh-name') UI().profile.setName(e.target.value); });
    grabDrag();
  }
  function render() {
    root.setAttribute('aria-label', L('sheet'));
    $('tsh-lines').innerHTML = linesHTML();
    $('tsh-bar').innerHTML = barHTML();
    renderCards();
    $('tsh-act').innerHTML = actHTML();
    if (askInc) renderAsk();
  }
  function renderCards() {
    var c = $('tsh-cards'); c.dataset.size = prefs().size; c.setAttribute('aria-label', L('list'));
    c.innerHTML = cardsHTML(); newOpen = false;
    c.querySelectorAll('.tsh-card[data-m]').forEach(function (el) { var s = cachedFor(el); if (s) drawThumb(el.querySelector('canvas'), s); });
    queue();
  }
  function $(id) { return document.getElementById(id); }
  function pOf(el) { var c = el.closest('.tsh-card'); if (!c || !c.dataset.m) return null; return { machine: c.dataset.m, name: c.dataset.n, el: c }; }
  function cachedFor(el) { return cached({ machine: el.dataset.m, name: el.dataset.n }); }
  function refreshLines() { var l = $('tsh-lines'); if (!l) return; var a = document.activeElement, keep = a && a.id === 'tsh-name';
    if (keep) return; var ask = $('tsh-ask') && $('tsh-ask').innerHTML; l.innerHTML = linesHTML(); if (ask) $('tsh-ask').innerHTML = ask; }

  /* background: one card summary per tick, only while the sheet is open */
  function queue() {
    clearTimeout(queueT);
    var step = function () {
      if (!openNow) return;
      var el = [].find.call(root.querySelectorAll('.tsh-card[data-m]'), function (c) { return !cachedFor(c); });
      if (!el) return;
      var p = { machine: el.dataset.m, name: el.dataset.n }, s;
      try { s = summarize(p); } catch (e) { s = { blocks: 0, time: 0, state: 'bad', segs: [], stock: null }; CACHE[p.machine + '|' + p.name] = { h: summaryKey(p).h, s: s }; }
      el.querySelector('.l2').textContent = l2(s);
      el.querySelector('.st').innerHTML = glyph(s.state);
      drawThumb(el.querySelector('canvas'), s);
      queueT = setTimeout(step, 0);
    };
    queueT = setTimeout(step, 30);
  }

  /* ---------- card actions ---------- */
  function menuClose(card) { if (!card) return; var m = card.querySelector('.tsh-menu'); if (m) { m.hidden = true; m.innerHTML = ''; } var b = card.querySelector('.tsh-more'); if (b) b.setAttribute('aria-expanded', 'false'); }
  function menuOpenFor(p) {
    root.querySelectorAll('.tsh-card').forEach(function (c) { if (c !== p.el) menuClose(c); });
    var it = UI().library.list().find(function (x) { return x.machine === p.machine && x.name === p.name; }); if (!it) return;
    var m = p.el.querySelector('.tsh-menu');
    m.innerHTML = '<button type="button" data-a="text">' + esc(L('openText')) + '</button>' +
      '<button type="button" data-a="dl">' + esc(L('dlH')) + '</button>' +
      (it.builtin ? '' : '<button type="button" data-a="rename">' + esc(L('rename')) + '</button>') +
      (it.builtin ? (it.changed ? '<button type="button" class="er" data-a="del">' + esc(L('restore')) + '</button>' : '') : '<button type="button" class="er" data-a="del">' + esc(L('del')) + '</button>');
    m.hidden = false; p.el.querySelector('.tsh-more').setAttribute('aria-expanded', 'true');
    m.querySelector('button').focus();
  }
  function askDelete(p) {
    var it = UI().library.list().find(function (x) { return x.machine === p.machine && x.name === p.name; }); if (!it || (it.builtin && !it.changed)) return;
    var m = p.el.querySelector('.tsh-menu');
    m.innerHTML = '<span class="q" role="alert">' + esc(L(it.builtin ? 'restoreAsk' : 'delAsk', { n: p.name })) + '</span>' +
      '<div class="row"><button type="button" class="er" data-a="del-yes">' + esc(L(it.builtin ? 'restore' : 'del')) + '</button><button type="button" data-a="menu-x">' + esc(L('cancel')) + '</button></div>';
    m.hidden = false; p.el.querySelector('.tsh-more').setAttribute('aria-expanded', 'true');
    m.querySelector('[data-a=menu-x]').focus();
  }
  function askRename(p) {
    var m = p.el.querySelector('.tsh-menu');
    m.innerHTML = '<input id="tsh-rn" data-autosave-exempt="short rename box, committed with Enter" spellcheck="false" maxlength="18" aria-label="' + esc(L('rename')) + '" value="' + esc(p.name.replace(/\.H$/, '')) + '">' +
      '<span class="msg" id="tsh-rn-msg" role="status"></span>' +
      '<div class="row"><button type="button" data-a="rn-ok">' + esc(L('rename')) + '</button><button type="button" data-a="menu-x">' + esc(L('cancel')) + '</button></div>';
    m.hidden = false; var i = m.querySelector('input'); i.focus(); i.select();
  }
  function doRename(p) {
    var v = $('tsh-rn').value, r = UI().library.rename(p.machine, p.name, v);
    if (r && r.error) { $('tsh-rn-msg').textContent = r.error === 'exists' ? L('exists') : r.error; return; }
    renderCards(); refreshLines(); focusCard(p.machine, r);
  }
  function doDelete(p) {
    var r = UI().library.remove(p.machine, p.name);
    if (r) UI().say(L(r === 'restored' ? 'restored' : 'deleted', { n: p.name }));
    var idx = +p.el.dataset.i; renderCards(); refreshLines();
    var cards = root.querySelectorAll('.tsh-card[data-m]'); var t = cards[Math.min(idx, cards.length - 1)] || root.querySelector('.tsh-new');
    if (t) t.querySelector('.tsh-open').focus();
  }
  function focusCard(m, n) { var c = [].find.call(root.querySelectorAll('.tsh-card[data-m]'), function (x) { return x.dataset.m === m && x.dataset.n === n; }); if (c) c.querySelector('.tsh-open').focus(); }
  function openProgram(p) { UI().library.open(p.machine, p.name); close(); }
  function newProgramAsk() {
    var c = root.querySelector('.tsh-new'), m = c.querySelector('.tsh-menu'); newOpen = true;
    c.querySelector('.tsh-open').hidden = true;
    m.innerHTML = '<input id="tsh-nn" data-autosave-exempt="short name box, committed with Enter" spellcheck="false" maxlength="16" aria-label="' + esc(L('newName')) + '" placeholder="NY_PGM">' +
      '<div class="row"><button type="button" data-a="nn-ok">' + esc(L('create')) + '</button><button type="button" data-a="nn-x">' + esc(L('cancel')) + '</button></div>';
    m.hidden = false; m.querySelector('input').focus();
  }
  function newProgramCancel() { var c = root.querySelector('.tsh-new'); if (!c) return; newOpen = false; var m = c.querySelector('.tsh-menu'); m.hidden = true; m.innerHTML = ''; var o = c.querySelector('.tsh-open'); o.hidden = false; o.focus(); }
  function newProgramGo() {
    var v = ($('tsh-nn').value || '').trim() || 'NY_PGM';
    UI().library.create(v); close();
  }

  /* ---------- profile import (a profile file asks Merge / Replace here; programs and tool tables go straight in) ---------- */
  var fileIn = null;
  function importPick() {
    if (!fileIn) { fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.multiple = true; fileIn.hidden = true; fileIn.id = 'tsh-file';
      fileIn.accept = '.h,.H,.i,.I,.txt,.nc,.zip,.t,.T,.json'; document.body.appendChild(fileIn);
      fileIn.onchange = function () { var fs = [].slice.call(fileIn.files); fileIn.value = ''; importFiles(fs); }; }
    fileIn.click();
  }
  function importFiles(files) {
    if (!files.length) return;
    var ui = UI(), rest = [], chain = Promise.resolve(), prof = null, pname = '';
    files.forEach(function (f) { chain = chain.then(function () {
      if (!/\.(zip|json)$/i.test(f.name)) { rest.push(f); return; }
      return ui.profile.read(f).then(function (r) { if (r.kind === 'profile' && !prof) { prof = r.profile; pname = f.name; } else rest.push(f); }, function () { rest.push(f); });
    }); });
    chain.then(function () {
      if (rest.length) { ui.profile.importFiles(rest); setTimeout(function () { if (openNow) { renderCards(); refreshLines(); } }, 300); }
      if (prof) { askInc = { inc: prof, file: pname }; renderAsk(); }
    });
  }
  function renderAsk() {
    var box = $('tsh-ask'); if (!box) return;
    if (!askInc) { box.innerHTML = ''; return; }
    var d = UI().profile.describe(askInc.inc);
    box.innerHTML = '<div role="alert">' + esc(L('profileFile', { f: askInc.file, n: d.name || '—', p: d.programs })) + '</div>' +
      '<div class="row"><button type="button" data-a="imp-merge">' + esc(L('merge')) + '</button><button type="button" data-a="imp-replace">' + esc(L('replace')) + '</button><button type="button" data-a="imp-x">' + esc(L('cancel')) + '</button></div>';
    box.querySelector('button').focus();
  }

  /* ---------- clicks ---------- */
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    var ui = UI(), p = pOf(b), a = b.dataset.a;
    if (b.dataset.act) {
      var k = b.dataset.act;
      if (k === 'close') close();
      else if (k === 'folder') Promise.resolve(ui.profile.pickFolder()).then(updateFolder);
      else if (k === 'import') importPick();
      else if (k === 'export') ui.profile.export();
      else if (k === 'new') ui.profile.fresh();
      return;
    }
    if (b.dataset.sort) { setPref('sort', b.dataset.sort); $('tsh-bar').innerHTML = barHTML(); renderCards(); var q = root.querySelector('[data-sort="' + b.dataset.sort + '"]'); if (q) q.focus(); return; }
    if (b.dataset.size) { setPref('size', b.dataset.size); $('tsh-bar').innerHTML = barHTML(); renderCards(); var q2 = root.querySelector('[data-size="' + b.dataset.size + '"]'); if (q2) q2.focus(); return; }
    if (b.dataset.mach) { ui.setMachine(b.dataset.mach); render(); var mb = root.querySelector('[data-mach="' + b.dataset.mach + '"]'); if (mb) mb.focus(); return; }
    if (b.dataset.tt) { close(); ui.toolTable(); return; }
    if (b.dataset.set) { close(); ui.openSettings(); return; }
    if (b.dataset.folder) { (b.dataset.folder === 'warn' ? ui.profile.regrant() : Promise.resolve(ui.profile.pickFolder())).then(updateFolder); return; }
    if (b.dataset.newpgm) { newProgramAsk(); return; }
    if (a === 'nn-ok') { newProgramGo(); return; }
    if (a === 'nn-x') { newProgramCancel(); return; }
    if (a === 'imp-x') { askInc = null; renderAsk(); return; }
    if (a === 'imp-merge') { var inc = askInc.inc; askInc = null; ui.profile.merge(inc); return; }
    if (a === 'imp-replace') { var inc2 = askInc.inc; if (!confirm(L('replaceAsk', { n: inc2.name || askInc.file }))) return; askInc = null; ui.profile.replace(inc2); return; }
    if (!p) return;
    if (b.dataset.open) { openProgram(p); return; }
    if (b.dataset.more) { if (b.getAttribute('aria-expanded') === 'true') { menuClose(p.el); b.focus(); } else menuOpenFor(p); return; }
    if (a === 'menu-x') { menuClose(p.el); p.el.querySelector('.tsh-open').focus(); return; }
    if (a === 'text') { close(); if (window.TNC_EDITOR) TNC_EDITOR.open(p.name, p.machine); return; }
    if (a === 'dl') { ui.library.download(p.machine, p.name); menuClose(p.el); p.el.querySelector('.tsh-open').focus(); return; }
    if (a === 'rename') { askRename(p); return; }
    if (a === 'rn-ok') { doRename(p); return; }
    if (a === 'del') { askDelete(p); return; }
    if (a === 'del-yes') { doDelete(p); return; }
  }
  function updateFolder() { return UI().profile.folder().then(function (f) { folderInfo = f; refreshLines(); }, function () {}); }

  /* ---------- keyboard: everything inside the sheet stays inside it (the simulator's shortcuts do not fire) ---------- */
  function focusables() { return [].filter.call(root.querySelectorAll('button,input,[tabindex]'), function (el) { return !el.disabled && el.tabIndex >= 0 && !el.hidden && el.offsetParent !== null && !el.closest('[hidden]'); }); }
  function moveCard(cur, key) {
    var cards = [].slice.call(root.querySelectorAll('.tsh-card')).filter(function (c) { return c.offsetParent !== null; }), i = cards.indexOf(cur);
    if (i < 0) return;
    var t = null;
    if (key === 'ArrowRight') t = cards[i + 1]; else if (key === 'ArrowLeft') t = cards[i - 1];
    else if (key === 'Home') t = cards[0]; else if (key === 'End') t = cards[cards.length - 1];
    else {
      var r0 = cur.getBoundingClientRect(), dn = key === 'ArrowDown', best = null, bd = Infinity;
      cards.forEach(function (c) { var r = c.getBoundingClientRect(); if (dn ? r.top <= r0.top + 2 : r.top >= r0.top - 2) return;
        var dy = Math.abs(r.top - r0.top), dx = Math.abs(r.left - r0.left), d = dy * 10 + dx; if (d < bd) { bd = d; best = c; } });
      t = best;
    }
    if (t) { var o = t.querySelector('.tsh-open:not([hidden])') || t.querySelector('button,input'); if (o) { o.focus(); o.scrollIntoView({ block: 'nearest' }); } }
  }
  function onKey(e) {
    if (!openNow) return;
    if (window.TNC_EDITOR && TNC_EDITOR.isOpen) return;
    var k = e.key, t = e.target, mod = e.ctrlKey || e.metaKey, card = t.closest && t.closest('.tsh-card');
    e.stopPropagation();
    if (!root.contains(t) && k !== 'Escape' && k !== 'Tab') { e.preventDefault(); var f0 = focusables()[0]; if (f0) f0.focus(); return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (t.id === 'tsh-nn' || (card && card.dataset.new && newOpen)) { newProgramCancel(); return; }
      if (card) { var m = card.querySelector('.tsh-menu'); if (m && !m.hidden) { menuClose(card); card.querySelector('.tsh-open').focus(); return; } }
      if (askInc) { askInc = null; renderAsk(); return; }
      close(); return;
    }
    if (k === 'Tab') {
      var f = focusables(); if (!f.length) return; var i = f.indexOf(t);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (mod && (k === 'i' || k === 'I')) { e.preventDefault(); importPick(); return; }
    if (mod && (k === 'e' || k === 'E')) { e.preventDefault(); UI().profile.export(); return; }
    if (t.id === 'tsh-name' && k === 'Enter') { e.preventDefault(); t.blur(); return; }
    if (t.id === 'tsh-rn' && k === 'Enter') { e.preventDefault(); var p = pOf(t); if (p) doRename(p); return; }
    if (t.id === 'tsh-nn' && k === 'Enter') { e.preventDefault(); newProgramGo(); return; }
    if (t.getAttribute && t.getAttribute('role') === 'radio' && /^Arrow(Left|Right|Up|Down)$/.test(k)) {
      e.preventDefault(); var g = [].slice.call(t.parentNode.querySelectorAll('[role=radio]')), j = g.indexOf(t), d = (k === 'ArrowLeft' || k === 'ArrowUp') ? -1 : 1;
      var nx = g[(j + d + g.length) % g.length]; nx.click(); return;
    }
    if (card && t.classList.contains('tsh-open') && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(k)) { e.preventDefault(); moveCard(card, k); return; }
    if (card && card.dataset.m && t.classList.contains('tsh-open')) {
      var pp = pOf(t);
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); askDelete(pp); return; }
      if (k === 'F2') { e.preventDefault(); var it = UI().library.list().find(function (x) { return x.machine === pp.machine && x.name === pp.name; }); if (it && !it.builtin) askRename(pp); return; }
      if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) { e.preventDefault(); menuOpenFor(pp); return; }
    }
    if (card && t.closest('.tsh-menu') && /^Arrow(Up|Down)$/.test(k)) {
      e.preventDefault(); var bs = [].slice.call(t.closest('.tsh-menu').querySelectorAll('button')), bi = bs.indexOf(t);
      var nb = bs[(bi + (k === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; if (nb) nb.focus(); return;
    }
  }

  /* ---------- swipe down on the grab handle closes ---------- */
  function grabDrag() {
    var g = $('tsh-grab'), y0 = null, dy = 0, t0 = 0, id = null;
    g.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; t0 = Date.now(); id = e.pointerId; try { g.setPointerCapture(id); } catch (x) { /* ok */ } root.classList.add('drag'); });
    g.addEventListener('pointermove', function (e) { if (y0 == null || e.pointerId !== id) return; dy = Math.max(0, e.clientY - y0); root.style.transform = 'translateY(' + dy + 'px)'; });
    var end = function (e) { if (y0 == null || (e && e.pointerId !== id)) return; y0 = null; root.classList.remove('drag'); root.style.transform = '';
      var v = dy / Math.max(1, Date.now() - t0); if (dy > Math.min(120, root.offsetHeight * .25) || (dy > 30 && v > .6)) close(); };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  }

  /* ---------- open / close ---------- */
  function open() {
    if (!UI() || !UI().library) return;
    if (!root) build();
    if (openNow) return;
    back = document.activeElement;
    askInc = null; folderInfo = null;
    render();
    scrim.hidden = false; root.hidden = false; openNow = true;
    var app = document.querySelector('.app'); if (app) app.inert = true;
    void root.offsetHeight;
    scrim.classList.add('on'); root.classList.add('on');
    window.addEventListener('keydown', onKey, true);
    updateFolder();
    var first = root.querySelector('.tsh-card[data-m] .tsh-open') || $('tsh-name');
    if (first) try { first.focus({ preventScroll: true }); } catch (e) { /* ok */ }
  }
  function close() {
    if (!openNow) return;
    openNow = false; clearTimeout(queueT);
    window.removeEventListener('keydown', onKey, true);
    root.classList.remove('on'); scrim.classList.remove('on');
    var app = document.querySelector('.app'); if (app) app.inert = false;
    var done = function () { if (openNow) return; root.hidden = true; scrim.hidden = true; };
    if (reduced()) done(); else setTimeout(done, 260);
    var r = back; back = null;
    if (r && r.isConnected && r !== document.body && !(window.TNC_EDITOR && TNC_EDITOR.isOpen)) try { r.focus({ preventScroll: true }); } catch (e) { /* ok */ }
  }

  /* last opened = "last used": stamped whenever the simulator opens a program */
  (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
    ui.on('program', function (p) { if (p && ui.library) ui.library.stamp(p.machine, p.name); });
    try { var p0 = ui.program; if (p0 && p0.name && ui.library) ui.library.stamp(p0.machine, p0.name); } catch (e) {}   // the program open at start-up
  });

  /* a profile file that came in elsewhere (Ctrl O, drag-drop on the page): the sheet asks merge / replace */
  function askProfile(inc, file) { open(); askInc = { inc: inc, file: file }; renderAsk(); }

  return { open: open, close: close, askProfile: askProfile, get isOpen() { return openNow; } };
})();
if (typeof module !== 'undefined') module.exports = TNC_SHEET;
