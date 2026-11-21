/* ============================================================
   TNC_SETPANEL — the settings panel behind the gear: one side panel that slides out from the left, over the page.
   It replaces the old settings modal (#m-set) and the "Effects and view" menu under the 3-D view (#fxmenu).

   One control language: groups (disclosure rows, collapsed by default, the current mode at a glance) hold
     · a mode row (segments with a sliding thumb): a group preset; choosing one sets the group's toggles, changing a toggle
       shows the group as Custom. The mode shown is worked out from the toggles, so it is never out of step with the view;
     · toggle tiles (role=switch) that light up;
     · choice segments and tiles (role=radio): language, decimal character, controller, environment, material, theme.
   No key letters or shortcut hints inside the panel.

     TNC_SETPANEL.open(group?)   open, the named group expanded and scrolled to ('view', 'effects', …)
     TNC_SETPANEL.close()        close, focus back on the gear
     TNC_SETPANEL.toggle()

   Persists: theme, fskey, replay, groups ({group: mode}) through TNC_SETTINGS when it has the key, otherwise in
   localStorage "tnc.setpanel.v1" (one small store adapter, store()). The view and effect toggles go through ui.js:
   UIAPI.view / setSpeed / setTheme / fullscreen when they exist, otherwise the existing buttons are clicked (drive()).
   ============================================================ */
var TNC_SETPANEL = (function () {
  'use strict';
  var api = { open: function () {}, close: function () {}, toggle: function () {} };
  if (typeof window === 'undefined') return api;

  /* ---------- strings (sv / en / sr Latin) ---------- */
  var STR = {
    sv: {
      title: 'Inställningar', close: 'Stäng', custom: 'Egen', on: 'På', off: 'Av',
      'g.look': 'Utseende', 'g.camera': 'Kamera', 'g.view': 'Vy', 'g.effects': 'Effekter', 'g.machine': 'Maskin och ämne',
      'g.run': 'Körning', 'g.input': 'Mus och tangentbord', 'g.help': 'Hjälp', 'g.about': 'Om',
      theme: 'Tema', lang: 'Språk', decimal: 'Decimaltecken', 'dec.auto': 'Följ språk', 'dec.comma': 'Komma', 'dec.point': 'Punkt',
      skin: 'Styrsystem', 'skin.auto': 'Följ maskin', env: 'Miljö', 'env.cold-steel': 'Cold Steel', 'env.workshop-night': 'Workshop Night',
      'cam.still': 'Stilla', 'cam.follow': 'Följ', 'cam.film': 'Film', dir: 'Riktning', 'dir.3D': '3D', 'dir.TOP': 'Plan', 'dir.FRONT': 'Front', 'dir.SIDE': 'Sida',
      fit: 'Passa in vyn', 'fit.d': 'Hela ämnet och verktyget i bild',
      'view.clean': 'Ren', 'view.standard': 'Standard',
      labels: 'Etiketter', vectors: 'Axelvektorer', path: 'Verktygsbana', pick: 'Peka i vyn', flow: 'Flödesvy',
      'fx.off': 'Av', 'fx.calm': 'Lugn', 'fx.full': 'Full',
      chips: 'Spån', cool: 'Kylvätska', smoke: 'Rök', sound: 'Ljud', motion: 'Rörelse', 'motion.auto': 'System', 'motion.full': 'Full', 'motion.reduced': 'Reducerad',
      vice: 'Skruvstycke', quality: 'Grafik', 'q.low': 'Låg', 'q.medium': 'Medel', 'q.high': 'Hög', material: 'Material',
      speed: 'Hastighet', replay: 'Repris efter körning', keepgoing: 'Fortsätt efter fel',
      tips: 'Tips på knappar', zoom: 'Zooma och flytta', rotate: 'Rotera vyn', fskey: 'Helskärm', 'fskey.press': 'Tryck en tangent', 'fskey.none': 'Ingen',
      fullscreen: 'Helskärm nu',
      'help.lessons': 'Hjälp och lektioner', 'help.keys': 'Kortkommandon', 'help.intro': 'Visa introduktionen', 'help.reset': 'Återställ hjälpen',
      'help.profile': 'Profil', 'help.dev': 'Utvecklarlogg', 'help.reset.done': 'HJÄLPEN ÅTERSTÄLLD',
      'about.edu': 'En simulator för utbildning — använd den aldrig för att köra in ett program till en riktig maskin.',
      'about.notice': 'Inte knuten till DR. JOHANNES HEIDENHAIN GmbH. ”HEIDENHAIN” och ”TNC” är deras varumärken.',
      'about.lic': 'MIT-licens. Innehåller three.js, three.quarks, JSZip (MIT) och idb-keyval (Apache-2.0).',
      'about.gh': 'gigacook på GitHub', diag: 'Kopiera diagnostik', copied: 'DIAGNOSTIK KOPIERAD',
      'th.night': 'Natt', 'th.graphite': 'Grafit', 'th.mocha': 'Mocka', 'th.acid': 'Syra', 'th.oled': 'OLED', 'th.cream': 'Grädde'
    },
    en: {
      title: 'Settings', close: 'Close', custom: 'Custom', on: 'On', off: 'Off',
      'g.look': 'Appearance', 'g.camera': 'Camera', 'g.view': 'View', 'g.effects': 'Effects', 'g.machine': 'Machine and stock',
      'g.run': 'Run', 'g.input': 'Mouse and keyboard', 'g.help': 'Help', 'g.about': 'About',
      theme: 'Theme', lang: 'Language', decimal: 'Decimal character', 'dec.auto': 'Follow language', 'dec.comma': 'Comma', 'dec.point': 'Point',
      skin: 'Controller', 'skin.auto': 'Follow machine', env: 'Environment', 'env.cold-steel': 'Cold Steel', 'env.workshop-night': 'Workshop Night',
      'cam.still': 'Still', 'cam.follow': 'Follow', 'cam.film': 'Film', dir: 'Direction', 'dir.3D': '3D', 'dir.TOP': 'Top', 'dir.FRONT': 'Front', 'dir.SIDE': 'Side',
      fit: 'Fit the view', 'fit.d': 'The whole blank and the tool in frame',
      'view.clean': 'Clean', 'view.standard': 'Standard',
      labels: 'Labels', vectors: 'Axis vectors', path: 'Tool path', pick: 'Pick a point', flow: 'Flow view',
      'fx.off': 'Off', 'fx.calm': 'Calm', 'fx.full': 'Full',
      chips: 'Chips', cool: 'Coolant', smoke: 'Smoke', sound: 'Sound', motion: 'Motion', 'motion.auto': 'System', 'motion.full': 'Full', 'motion.reduced': 'Reduced',
      vice: 'Vice', quality: 'Graphics', 'q.low': 'Low', 'q.medium': 'Medium', 'q.high': 'High', material: 'Material',
      speed: 'Speed', replay: 'Replay after the run', keepgoing: 'Continue after errors',
      tips: 'Hints on buttons', zoom: 'Zoom and pan', rotate: 'Rotate the view', fskey: 'Full screen', 'fskey.press': 'Press a key', 'fskey.none': 'None',
      fullscreen: 'Full screen now',
      'help.lessons': 'Help and lessons', 'help.keys': 'Shortcuts', 'help.intro': 'Show the introduction', 'help.reset': 'Reset help',
      'help.profile': 'Profile', 'help.dev': 'Developer log', 'help.reset.done': 'HELP RESET',
      'about.edu': 'An educational simulator — never use it to prove out a program for a real machine.',
      'about.notice': 'Not affiliated with DR. JOHANNES HEIDENHAIN GmbH. “HEIDENHAIN” and “TNC” are their trademarks.',
      'about.lic': 'MIT licence. Bundles three.js, three.quarks, JSZip (MIT) and idb-keyval (Apache-2.0).',
      'about.gh': 'gigacook on GitHub', diag: 'Copy diagnostics', copied: 'DIAGNOSTICS COPIED',
      'th.night': 'Night', 'th.graphite': 'Graphite', 'th.mocha': 'Mocha', 'th.acid': 'Acid', 'th.oled': 'OLED', 'th.cream': 'Cream'
    },
    sr: {
      title: 'Podešavanja', close: 'Zatvori', custom: 'Prilagođeno', on: 'Uključeno', off: 'Isključeno',
      'g.look': 'Izgled', 'g.camera': 'Kamera', 'g.view': 'Prikaz', 'g.effects': 'Efekti', 'g.machine': 'Mašina i pripremak',
      'g.run': 'Izvršavanje', 'g.input': 'Miš i tastatura', 'g.help': 'Pomoć', 'g.about': 'O programu',
      theme: 'Tema', lang: 'Jezik', decimal: 'Decimalni znak', 'dec.auto': 'Prema jeziku', 'dec.comma': 'Zarez', 'dec.point': 'Tačka',
      skin: 'Upravljanje', 'skin.auto': 'Prema mašini', env: 'Okruženje', 'env.cold-steel': 'Cold Steel', 'env.workshop-night': 'Workshop Night',
      'cam.still': 'Mirno', 'cam.follow': 'Prati', 'cam.film': 'Film', dir: 'Pravac', 'dir.3D': '3D', 'dir.TOP': 'Odozgo', 'dir.FRONT': 'Spreda', 'dir.SIDE': 'Sa strane',
      fit: 'Uklopi prikaz', 'fit.d': 'Ceo pripremak i alat u kadru',
      'view.clean': 'Čisto', 'view.standard': 'Standardno',
      labels: 'Oznake', vectors: 'Vektori osa', path: 'Putanja alata', pick: 'Tačka klikom', flow: 'Dijagram toka',
      'fx.off': 'Isključeno', 'fx.calm': 'Mirno', 'fx.full': 'Puno',
      chips: 'Strugotina', cool: 'Rashladna tečnost', smoke: 'Dim', sound: 'Zvuk', motion: 'Pokret', 'motion.auto': 'Sistem', 'motion.full': 'Puno', 'motion.reduced': 'Smanjeno',
      vice: 'Stega', quality: 'Grafika', 'q.low': 'Niska', 'q.medium': 'Srednja', 'q.high': 'Visoka', material: 'Materijal',
      speed: 'Brzina', replay: 'Ponovi posle izvršavanja', keepgoing: 'Nastavi posle greške',
      tips: 'Saveti na dugmadima', zoom: 'Zumiranje i pomeranje', rotate: 'Rotiranje prikaza', fskey: 'Ceo ekran', 'fskey.press': 'Pritisnite taster', 'fskey.none': 'Nijedan',
      fullscreen: 'Ceo ekran sada',
      'help.lessons': 'Pomoć i lekcije', 'help.keys': 'Prečice', 'help.intro': 'Prikaži uvod', 'help.reset': 'Resetuj pomoć',
      'help.profile': 'Profil', 'help.dev': 'Dnevnik razvoja', 'help.reset.done': 'POMOĆ RESETOVANA',
      'about.edu': 'Simulator za obuku — nikada ga ne koristite za proveru programa za pravu mašinu.',
      'about.notice': 'Nije povezano sa DR. JOHANNES HEIDENHAIN GmbH. „HEIDENHAIN” i „TNC” su njihovi žigovi.',
      'about.lic': 'MIT licenca. Sadrži three.js, three.quarks, JSZip (MIT) i idb-keyval (Apache-2.0).',
      'about.gh': 'gigacook na GitHub-u', diag: 'Kopiraj dijagnostiku', copied: 'DIJAGNOSTIKA KOPIRANA',
      'th.night': 'Noć', 'th.graphite': 'Grafit', 'th.mocha': 'Moka', 'th.acid': 'Kiselina', 'th.oled': 'OLED', 'th.cream': 'Krem'
    }
  };
  function lang() { var l = (window.TNC_I18N && TNC_I18N.lang) || 'sv'; return STR[l] ? l : 'sv'; }
  function T(k) { var s = STR[lang()]; return s[k] != null ? s[k] : (STR.en[k] != null ? STR.en[k] : k); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* themes: the shell's list (window.TNC_THEMES), else this fallback (swatch colours here are placeholders until the shell has its list) */
  var FALLBACK_THEMES = [
    { id: 'night', dark: true, swatch: ['#0B0B0D', '#1F1F22', '#F5F5F7', '#2997FF'] },
    { id: 'graphite', dark: true, swatch: ['#1A1C20', '#2A2D33', '#E6E7EA', '#8AB4F8'] },
    { id: 'mocha', dark: true, swatch: ['#1C1714', '#2C241F', '#F0E6DA', '#D29A5C'] },
    { id: 'acid', dark: true, swatch: ['#0B0E09', '#1A2013', '#EAF5D8', '#B6F23A'] },
    { id: 'oled', dark: true, swatch: ['#000000', '#111111', '#FFFFFF', '#2997FF'] },
    { id: 'cream', dark: false, swatch: ['#F4EFE6', '#FFFCF6', '#2A251F', '#B0602A'] }
  ];
  function themes() { var t = window.TNC_THEMES; return Array.isArray(t) && t.length ? t : FALLBACK_THEMES; }
  function themeName(th) { if (th.name && typeof th.name === 'object') return th.name[lang()] || th.name.en || th.id; return th.name || T('th.' + th.id); }

  /* ---------- store adapter: TNC_SETTINGS when it has the key, else our own localStorage entry ---------- */
  var OWN = 'tnc.setpanel.v1';
  var DEFAULTS = { theme: 'night', fskey: 'F11', replay: true, keepgoing: false, groups: {}, zoom: true, rotate: true };
  function SET() { return window.TNC_SETTINGS || null; }
  function own() { try { return JSON.parse(localStorage.getItem(OWN) || '{}') || {}; } catch (e) { return {}; } }
  function has(k) { var s = SET(); return !!(s && s.DEF && Object.prototype.hasOwnProperty.call(s.DEF, k)); }
  var store = {
    get: function (k) { var v = has(k) ? SET().get(k) : own()[k]; return v === undefined || v === null ? DEFAULTS[k] : v; },
    set: function (k, v) {
      if (has(k)) { SET().set(k, v); return; }
      var o = own(); o[k] = v; try { localStorage.setItem(OWN, JSON.stringify(o)); } catch (e) {}
    }
  };
  function groupMode(g) { var o = store.get('groups'); return o && typeof o === 'object' ? o[g] : undefined; }
  function setGroupMode(g, m) { var o = store.get('groups'); o = o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : {}; if (o[g] === m) return; o[g] = m; store.set('groups', o); }

  var UI = null;     // UIAPI, set when the plugin runs
  function $(id) { return document.getElementById(id); }
  function S() { return (UI && UI.state) || {}; }

  /* ---------- the one adapter into ui.js and the view plugins ----------
     read(k) and drive(k, v). Prefers UIAPI.view / setSpeed / setTheme / fullscreen (when ui.js has them), else the old
     controls: the buttons in #fxmenu, '#spd [data-s]', the material <select>, the 'g' key for the view direction. */
  var BTN = { chips: 'b-fx', cool: 'b-cool', smoke: 'b-fire', labels: 'b-labels', vice: 'b-vice', flow: 'b-view', pick: 'b-pick', vectors: 'b-vec' };
  var SKEY = { chips: 'fx', cool: 'fxCool', smoke: 'fxFire', labels: 'labels', vice: 'vice', flow: 'flowView', speed: 'speed' };
  function viewGet() { try { return UI && UI.view && typeof UI.view.get === 'function' ? (UI.view.get() || null) : null; } catch (e) { return null; } }
  function avail(k) {
    var vg = viewGet(); if (vg && k in vg) return true;
    if (k === 'path') return false;
    if (BTN[k]) { var b = $(BTN[k]); return !!b && !b.hidden; }
    return true;
  }
  /* the panel's names -> UIAPI.view's names (ui.js) */
  var VALIAS = { chips: 'fx', smoke: 'fire', vectors: 'axes' };
  function read(k) {
    var vg = viewGet(), ak = VALIAS[k] || k; if (vg && ak in vg && vg[ak] !== null) return vg[ak];
    if (k === 'pick' || k === 'vectors') { var b = $(BTN[k]); return !!b && b.getAttribute('aria-pressed') === 'true'; }
    if (k === 'material') return window.TNC_MATERIALS && TNC_MATERIALS.current ? TNC_MATERIALS.current.id : null;
    if (k === 'dir') return S().view || '3D';
    if (k === 'cam') return S().cam || null;
    if (k === 'cine') { var C = window.TNC_CINE; return !!(C && C.playing); }
    if (SKEY[k]) return S()[SKEY[k]];
    return undefined;
  }
  function pressG() { synth = true; try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true })); } finally { synth = false; } }
  function drive(k, v) {
    var vg = viewGet(), ak = VALIAS[k] || k;
    if (vg && ak in vg && vg[ak] !== null && UI.view.set) { UI.view.set(ak, v); return; }
    if (k === 'speed') { if (UI && typeof UI.setSpeed === 'function') UI.setSpeed(v); else { var sb = document.querySelector('#spd [data-s="' + v + '"]'); if (sb) sb.click(); } return; }
    if (k === 'material') { var sel = $('mat-sel'); if (sel) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } else if (window.TNC_MATERIALS && TNC_MATERIALS.select) TNC_MATERIALS.select(v); return; }
    if (k === 'dir') {      // 3D / TOP through the camera presets, FRONT / SIDE (and a refit) by the view key
      if (v === '3D' && UI.cameraPreset && UI.cameraPreset('orbit')) return;
      if (v === 'TOP' && UI.cameraPreset && UI.cameraPreset('plan')) return;
      for (var i = 0; i < 4 && (S().view !== v || S().cam); i++) pressG();
      return;
    }
    if (k === 'fit') { if (S().view === '3D' && !S().cam && UI.cameraPreset) { UI.cameraPreset('orbit'); return; } for (var j = 0; j < 4; j++) pressG(); return; }
    if (k === 'cam') { if (UI.cameraPreset) UI.cameraPreset(v); return; }
    if (k === 'cine') { var C = window.TNC_CINE; if (!C) return; if (v && !C.playing) C.open(); else if (!v && C.playing) C.close(); return; }
    if (k === 'theme') {
      if (UI && typeof UI.setTheme === 'function') UI.setTheme(v);
      else { store.set('theme', v); document.documentElement.dataset.theme = v; }
      store.set('theme', v); document.documentElement.dataset.theme = v; return;
    }
    if (k === 'fullscreen') {
      if (UI && typeof UI.fullscreen === 'function') { UI.fullscreen(); return; }
      try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {}
      return;
    }
    if (BTN[k] && !!read(k) !== !!v) { var b = $(BTN[k]); if (b) b.click(); }
  }
  /* mouse and touch in the 3-D view (OrbitControls) */
  function applyInput() { var c = UI && UI.controls; if (!c) return; c.enableZoom = c.enablePan = !!store.get('zoom'); c.enableRotate = !!store.get('rotate'); }

  /* ---------- groups ---------- */
  var VIEW_KEYS = ['labels', 'vectors', 'path', 'pick'];
  var MODES = {
    view: { clean: { labels: false, vectors: false, path: true, pick: false }, standard: { labels: true, vectors: true, path: true, pick: true } },
    effects: { off: { chips: false, cool: false, smoke: false, sound: false }, calm: { chips: true, cool: true, smoke: false, sound: true }, full: { chips: true, cool: true, smoke: true, sound: true } }
  };
  var OWN_T = ['zoom', 'rotate', 'replay', 'keepgoing'];      // panel switches kept by the store adapter
  function tget(k) {
    if (k === 'sound' || k === 'tips') return !!(SET() ? SET().get(k) : true);
    if (OWN_T.indexOf(k) >= 0) return !!store.get(k);
    return !!read(k);
  }
  function tset(k, v) {
    if (k === 'sound' || k === 'tips') { if (SET()) SET().set(k, !!v); return; }
    if (k === 'zoom' || k === 'rotate') { store.set(k, !!v); applyInput(); return; }
    if (k === 'replay' || k === 'keepgoing') { store.set(k, !!v); return; }
    drive(k, !!v);
  }
  function derive(g) {
    var m = MODES[g]; if (!m) return null;
    for (var id in m) { var ok = true; for (var k in m[id]) { if (!avail(k) && k !== 'sound') continue; if (tget(k) !== m[id][k]) { ok = false; break; } } if (ok) return id; }
    return 'custom';
  }
  function camMode() { if (read('cine')) return 'film'; var c = read('cam'); return c === 'tool' || c === 'pov' ? 'follow' : 'still'; }
  function applyMode(g, id) {
    if (g === 'camera') {
      if (id !== 'film' && read('cine')) drive('cine', false);
      if (id === 'follow') drive('cam', 'tool'); else if (id === 'film') drive('cine', true); else drive('dir', S().view || '3D');
      setGroupMode(g, id); return;
    }
    var m = MODES[g] && MODES[g][id]; if (!m) return;
    for (var k in m) if (k === 'sound' || avail(k)) { if (tget(k) !== m[k]) tset(k, m[k]); }
    setGroupMode(g, id);
  }

  /* icons: 16 px strokes */
  var IC = {
    look: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
    camera: '<rect x="1.5" y="4.5" width="9" height="7" rx="1"/><path d="M10.5 7l4-2v6l-4-2"/>',
    view: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    effects: '<path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4z"/><path d="M12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
    machine: '<path d="M2 13.5h12M4 13.5V9h8v4.5M6 9V5.5h4V9M7 5.5V2.5h2v3"/>',
    run: '<path d="M8 14a6 6 0 1 1 6-6"/><path d="M8 8l3.5-3"/><circle cx="8" cy="8" r=".8" fill="currentColor"/>',
    input: '<rect x="4.5" y="1.5" width="7" height="13" rx="3.5"/><path d="M8 4v3"/>',
    help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.5"/><circle cx="8" cy="11.4" r=".6" fill="currentColor"/>',
    about: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4"/><circle cx="8" cy="5" r=".6" fill="currentColor"/>',
    chips: '<path d="M3 11c2-1 2.5-4 5-5M7 12.5c1.5-1 3-1.5 4.5-4M10 4.5c1 .2 2 .9 2.5 2"/>',
    cool: '<path d="M8 2s4 4.6 4 7.3A4 4 0 0 1 4 9.3C4 6.6 8 2 8 2z"/>',
    smoke: '<path d="M4 13c-1.6-1.3-1.4-3.3.3-4.2C3.6 6.6 5.6 5 7.4 6c.4-2 3.3-2.6 4.4-.7 1.7.1 2.6 2.1 1.7 3.6.8 1.7-.4 3.6-2.3 3.6"/>',
    sound: '<path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z"/><path d="M11 5.5c1.3 1.4 1.3 3.6 0 5M12.8 3.8c2.2 2.3 2.2 6.1 0 8.4"/>',
    labels: '<path d="M2 3.5h7.5l4.5 4.5-4.5 4.5H2z"/><circle cx="5" cy="8" r="1"/>',
    vectors: '<path d="M3 13V3M3 13h10M3 13l6-6"/><path d="M1.5 4.5L3 3l1.5 1.5M11.5 11.5L13 13l-1.5 1.5"/>',
    path: '<path d="M2 12.5c3 0 2.5-9 6-9s3 9 6 9" stroke-dasharray="2 1.6"/>',
    pick: '<path d="M3 2.5l9.5 4-4 1.5-1.5 4z"/><path d="M8.5 8.5l4 4"/>',
    flow: '<rect x="5" y="1.5" width="6" height="3.5"/><rect x="5" y="11" width="6" height="3.5"/><path d="M8 5v6"/>',
    vice: '<path d="M2 12.5h12M3 12.5V6h3.5v6.5M9.5 12.5V6H13v6.5M6.5 9h3"/>',
    replay: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5v3h3"/>',
    keepgoing: '<path d="M2 8h9M8 4.5L11.5 8 8 11.5"/><path d="M14 3v10"/>',
    tips: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M5 14h6M8 11v3"/>',
    zoom: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14M5 7h4M7 5v4"/>',
    rotate: '<path d="M13.5 8A5.5 5.5 0 1 1 8 2.5"/><path d="M8 .8l2 1.7L8 4.2"/>',
    chev: '<path d="M6 4l4 4-4 4"/>', x: '<path d="M4 4l8 8M12 4l-8 8"/>', fit: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 3V2.5h-8v8H3"/>', ext: '<path d="M6 3H3v10h10v-3M9 2.5h4.5V7M13.5 2.5L7 9"/>',
    fs: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>'
  };
  function ic(n) { return '<svg class="sp-ic" viewBox="0 0 16 16" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

  /* ---------- markup helpers ---------- */
  var uid = 0;
  function seg(key, opts, cur, label, cls) {      // opts [[value,label,disabled]]; one radiogroup with a sliding thumb
    var i = 0, n = opts.length; opts.forEach(function (o, j) { if (String(o[0]) === String(cur)) i = j; });
    var none = !opts.some(function (o) { return String(o[0]) === String(cur); });
    return '<div class="sp-seg' + (cls ? ' ' + cls : '') + (none ? ' none' : '') + '" role="radiogroup" aria-label="' + esc(label) + '" data-k="' + key + '" style="--n:' + n + ';--i:' + i + '"><span class="sp-thumb" aria-hidden="true"></span>' +
      opts.map(function (o) { var on = String(o[0]) === String(cur);
        return '<button type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on || (none && o === opts[0]) ? 0 : -1) + '" data-v="' + esc(o[0]) + '"' + (o[2] ? ' aria-disabled="true"' : '') + '>' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function tile(k) { if (!avail(k)) return ''; var on = tget(k);
    return '<button type="button" class="sp-tile" role="switch" aria-checked="' + on + '" data-t="' + k + '">' + ic(k) +
      '<span class="sp-tl">' + esc(T(k)) + '</span><span class="sp-dot" aria-hidden="true"></span></button>'; }
  function tiles(keys) { var h = keys.map(tile).join(''); return h ? '<div class="sp-tiles">' + h + '</div>' : ''; }
  function lab(t, id) { return '<div class="sp-lab"' + (id ? ' id="' + id + '"' : '') + '>' + esc(t) + '</div>'; }
  function row(act, label, icn, sub) { return '<button type="button" class="sp-row" data-act="' + act + '">' + ic(icn || 'chev') + '<span class="sp-rl">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' + ic('chev') + '</button>'; }

  function modeOpts(g) {
    var ids = Object.keys(MODES[g]); return ids.map(function (id) { return [id, T((g === 'effects' ? 'fx' : g) + '.' + id)]; }).concat([['custom', T('custom'), true]]);
  }
  function summary(g) {
    var s = SET(), L = s && s.LOCALES ? s.LOCALES : {};
    if (g === 'look') { var th = themes().filter(function (t) { return t.id === curTheme(); })[0]; return (th ? themeName(th) : '') + ' · ' + ((L[s && s.get('lang')] || {}).name || ''); }
    if (g === 'camera') return T('cam.' + camMode()) + ' · ' + T('dir.' + (read('dir') || '3D'));
    if (g === 'view' || g === 'effects') { var d = derive(g); return d === 'custom' ? T('custom') : T(g === 'view' ? 'view.' + d : 'fx.' + d); }
    if (g === 'machine') { var m = window.TNC_MATERIALS && TNC_MATERIALS.current; return (m ? m.label : '') + (s ? ' · ' + T('q.' + s.get('quality')) : ''); }
    if (g === 'run') { var v = read('speed'); return (v ? v + '×' : 'MAX') + (store.get('replay') ? ' · ' + T('replay').split(' ')[0] : ''); }
    if (g === 'input') return T('fskey') + ' · ' + (store.get('fskey') || T('fskey.none'));
    if (g === 'about') return 'NC SW 280 476-17';
    return '';
  }
  function curTheme() { return document.documentElement.dataset.theme || store.get('theme') || 'night'; }

  function body(g) {
    var s = SET(), h = '';
    if (g === 'look') {
      h += '<div class="sp-sw" role="radiogroup" aria-label="' + esc(T('theme')) + '" data-k="theme">' + themes().map(function (t) {
        var on = t.id === curTheme(), c = t.swatch || ['#111', '#222', '#eee', '#29f'];
        return '<button type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-v="' + esc(t.id) + '"><span class="sp-pv" aria-hidden="true" style="background:' + esc(c[0]) + '">' +
          '<i style="background:' + esc(c[1]) + '"></i><b style="background:' + esc(c[2]) + '"></b><u style="background:' + esc(c[3]) + '"></u></span><span class="sp-nm">' + esc(themeName(t)) + '</span></button>'; }).join('') + '</div>';
      if (s) {
        var L = s.LOCALES || {};
        h += lab(T('lang')) + seg('lang', Object.keys(L).map(function (k) { return [k, L[k].name]; }), s.get('lang'), T('lang'));
        h += lab(T('decimal')) + seg('decimal', [['auto', T('dec.auto')], ['comma', T('dec.comma') + '  0,5'], ['point', T('dec.point') + '  0.5']], s.get('decimal'), T('decimal'));
        h += lab(T('skin')) + seg('skin', [['auto', T('skin.auto')], ['426', '426 Classic'], ['430', '430 Steel']], s.get('skin'), T('skin'));
        h += lab(T('env')) + seg('env', [['cold-steel', T('env.cold-steel')], ['workshop-night', T('env.workshop-night')]], s.get('env'), T('env'));
      }
    } else if (g === 'camera') {
      h += seg('mode:camera', [['still', T('cam.still')], ['follow', T('cam.follow')], ['film', T('cam.film'), !window.TNC_CINE]], camMode(), T('g.camera'), 'sp-mode');
      h += lab(T('dir')) + seg('dir', ['3D', 'TOP', 'FRONT', 'SIDE'].map(function (v) { return [v, T('dir.' + v)]; }), S().cam ? '' : read('dir'), T('dir'));
      h += '<div class="sp-rows">' + row('fit', T('fit'), 'fit', T('fit.d')) + '</div>';
    } else if (g === 'view') {
      h += seg('mode:view', modeOpts('view'), derive('view'), T('g.view'), 'sp-mode') + tiles(VIEW_KEYS.concat(['flow']));
    } else if (g === 'effects') {
      h += seg('mode:effects', modeOpts('effects'), derive('effects'), T('g.effects'), 'sp-mode') + tiles(['chips', 'cool', 'smoke', 'sound']);
      if (s) h += lab(T('motion')) + seg('motion', [['auto', T('motion.auto')], ['full', T('motion.full')], ['reduced', T('motion.reduced')]], s.get('motion'), T('motion'));
    } else if (g === 'machine') {
      if (s) h += seg('quality', [['low', T('q.low')], ['medium', T('q.medium')], ['high', T('q.high')]], s.get('quality'), T('quality'), 'sp-mode');
      h += tiles(['vice']);
      var M = window.TNC_MATERIALS;
      if (M && M.presets) {
        var cur = read('material');
        h += lab(T('material')) + '<div class="sp-mat" role="radiogroup" aria-label="' + esc(T('material')) + '" data-k="material">' + M.presets.map(function (p) { var on = p.id === cur;
          return '<button type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-v="' + esc(p.id) + '"><span class="sp-chip" aria-hidden="true" style="--c:#' + ('00000' + p.color.toString(16)).slice(-6) + '"></span><span>' + esc(p.label) + '</span></button>'; }).join('') + '</div>';
      }
    } else if (g === 'run') {
      h += seg('speed', [[1, '1×'], [4, '4×'], [16, '16×'], [64, '64×'], [0, 'MAX']], read('speed'), T('speed'), 'sp-mode') + tiles(['replay', 'keepgoing']);
    } else if (g === 'input') {
      var fk = store.get('fskey');
      h += tiles(['zoom', 'rotate', 'tips']);
      h += '<div class="sp-cap-w">' + lab(T('fskey'), 'sp-fsl') + '<div class="sp-capr"><button type="button" class="sp-cap" data-act="fskey" aria-labelledby="sp-fsl sp-fsv"><span class="sp-capv" id="sp-fsv">' + esc(fk || T('fskey.none')) + '</span></button>' +
        '<button type="button" class="sp-ibtn" data-act="fullscreen" aria-label="' + esc(T('fullscreen')) + '">' + ic('fs') + '</button></div></div>';
    } else if (g === 'help') {
      h += '<div class="sp-rows">' + row('lessons', T('help.lessons'), 'help') + row('keys', T('help.keys'), 'tips') + row('intro', T('help.intro'), 'replay') +
        row('profile', T('help.profile'), 'input') + row('dev', T('help.dev'), 'flow') + row('reset', T('help.reset'), 'rotate') + '</div>';
    } else if (g === 'about') {
      h += '<div class="sp-about"><div class="sp-at">TNC 426 / 430 Simulator</div><div class="sp-mono">NC SW 280 476-17 (SIM) · ' + esc((s && s.edition) || 'core') + '</div>' +
        '<p>' + esc(T('about.edu')) + '</p><p class="sp-fine">' + esc(T('about.notice')) + '</p><p class="sp-fine">' + esc(T('about.lic')) + '</p>' +
        '<p class="sp-fine"><a id="sp-gh" href="https://github.com/gigacook" target="_blank" rel="noopener noreferrer">' + esc(T('about.gh')) + '</a></p></div>' +
        '<div class="sp-rows">' + row('diag', T('diag'), 'copy') + '</div>';
    }
    return h;
  }

  var GROUPS = ['look', 'camera', 'view', 'effects', 'machine', 'run', 'input', 'help', 'about'];
  var ALIAS = { appearance: 'look', theme: 'look', fx: 'effects', effekter: 'effects', vy: 'view', kamera: 'camera', speed: 'run', korning: 'run', inmatning: 'input', om: 'about', stock: 'machine' };
  var open = {};       // expanded groups, kept for the session (all collapsed at first)
  var booted = false, panel = null, scrim = null, isOpen = false, ret = null, synth = false, capture = false, closeT = 0;

  function render() {
    if (!panel) return;
    var foc = document.activeElement && panel.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    panel.querySelector('.sp-title').textContent = T('title');
    var x = panel.querySelector('.sp-x'); x.setAttribute('aria-label', T('close'));
    panel.setAttribute('aria-label', T('title'));
    panel.querySelector('.sp-body').innerHTML = GROUPS.map(function (g) {
      var ex = !!open[g], id = 'sp-g-' + g;
      return '<section class="sp-g' + (ex ? ' ex' : '') + '" data-g="' + g + '"><h3 class="sp-h"><button type="button" class="sp-hb" id="' + id + '-h" aria-expanded="' + ex + '" aria-controls="' + id + '">' + ic(g) +
        '<span class="sp-hn">' + esc(T('g.' + g)) + '</span><span class="sp-hs" data-sum="' + g + '">' + esc(summary(g)) + '</span>' + ic('chev') + '</button></h3>' +
        '<div class="sp-d" id="' + id + '" role="region" aria-labelledby="' + id + '-h"' + (ex ? '' : ' inert') + '><div class="sp-di"><div class="sp-dp">' + body(g) + '</div></div></div></section>';
    }).join('');
    if (foc) refocus(foc);
  }
  function focusKey(el) {
    var g = el.closest('[data-g]'), k = el.closest('[data-k]');
    return { g: g && g.dataset.g, hb: el.classList.contains('sp-hb'), k: k && k.dataset.k, v: el.dataset.v, t: el.dataset.t, act: el.dataset.act, x: el.classList.contains('sp-x') };
  }
  function refocus(f) {
    var sel = f.x ? '.sp-x' : f.hb ? '[data-g="' + f.g + '"] .sp-hb' : f.t ? '[data-t="' + f.t + '"]' : f.act ? '[data-act="' + f.act + '"]' : f.k ? '[data-k="' + f.k + '"] [data-v="' + f.v + '"]' : null;
    var el = sel && panel.querySelector(sel); if (el) try { el.focus({ preventScroll: true }); } catch (e) {}
  }
  /* refresh in place: states, thumbs, summaries (keeps the transitions) — a group's body is redrawn only when its content changes shape */
  function sync() {
    if (!panel || !isOpen) return;
    GROUPS.forEach(function (g) {
      var sec = panel.querySelector('[data-g="' + g + '"]'); if (!sec) return;
      var sum = sec.querySelector('[data-sum]'); if (sum) sum.textContent = summary(g);
      var tmp = document.createElement('div'); tmp.innerHTML = body(g);
      var dp = sec.querySelector('.sp-dp');
      /* copy the states over element by element (same markup shape), else replace */
      var a = dp.querySelectorAll('[aria-checked],[data-k],.sp-capv'), b = tmp.querySelectorAll('[aria-checked],[data-k],.sp-capv');
      if (a.length !== b.length) { var f = document.activeElement && dp.contains(document.activeElement) ? focusKey(document.activeElement) : null; dp.innerHTML = tmp.innerHTML; if (f) refocus(f); return; }
      for (var i = 0; i < a.length; i++) {
        if (b[i].hasAttribute('aria-checked')) { a[i].setAttribute('aria-checked', b[i].getAttribute('aria-checked')); if (b[i].hasAttribute('tabindex')) a[i].setAttribute('tabindex', b[i].getAttribute('tabindex')); }
        if (b[i].dataset.k) { a[i].setAttribute('style', b[i].getAttribute('style') || ''); a[i].classList.toggle('none', b[i].classList.contains('none')); }
        if (b[i].classList.contains('sp-capv') && !capture) a[i].textContent = b[i].textContent;
      }
    });
  }

  function css() {
    var st = document.createElement('style'); st.id = 'sp-css';
    st.textContent = [
      '.sp-scrim{position:fixed;inset:0;z-index:70;background:var(--gc-scrim);opacity:0;transition:opacity 240ms var(--gc-ease)}',
      '.sp-scrim.on{opacity:1}',
      '.sp{position:fixed;top:0;bottom:0;left:0;z-index:71;width:min(400px,100vw);display:flex;flex-direction:column;background:var(--gc-surface);color:var(--gc-ink);',
      '  border-right:1px solid var(--gc-line);box-shadow:var(--gc-shadow-3);transform:translateX(-100%);opacity:0;',
      '  transition:transform 300ms cubic-bezier(.2,.8,.2,1),opacity 220ms var(--gc-ease);font-family:var(--gc-font-sans);font-size:14px;line-height:20px}',
      '.sp.on{transform:none;opacity:1}',
      'html[data-motion="reduced"] .sp,html[data-motion="reduced"] .sp-scrim{transition:opacity 120ms linear}html[data-motion="reduced"] .sp{transform:none}',
      'html[data-motion="reduced"] .sp *{transition:none!important}',
      '@media (prefers-reduced-motion:reduce){.sp,.sp-scrim{transition:opacity 120ms linear}.sp{transform:none}.sp *{transition:none!important}}',
      '.sp-head{flex:none;display:flex;align-items:center;gap:8px;height:56px;padding:0 10px 0 20px;border-bottom:1px solid var(--gc-line-subtle)}',
      '.sp-title{flex:1;margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em}',
      '.sp-x{width:32px;height:32px;display:grid;place-items:center;background:transparent;border:0;border-radius:var(--gc-radius-md);color:var(--gc-muted)}',
      '.sp-x:hover{background:var(--gc-hover);color:var(--gc-ink)}',
      '.sp-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 0 28px;scrollbar-width:thin;scrollbar-color:var(--gc-scroll-thumb) transparent}',
      '.sp-ic{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}',
      '.sp-g{border-bottom:1px solid var(--gc-line-subtle)}',
      '.sp-h{margin:0;font:inherit}',
      '.sp-hb{width:100%;display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px 0 20px;background:transparent;border:0;text-align:left;color:var(--gc-ink-2)}',
      '.sp-hb:hover{background:var(--gc-hover);color:var(--gc-ink)}',
      '.sp-hb>.sp-ic:first-child{color:var(--gc-muted)}',
      '.sp-hn{flex:none;font-size:14px;font-weight:500;color:var(--gc-ink)}',
      '.sp-hs{flex:1;min-width:0;text-align:right;font-size:13px;color:var(--gc-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sp-hb>.sp-ic:last-child{color:var(--gc-muted);transition:transform 240ms cubic-bezier(.2,.8,.2,1)}',
      '.sp-g.ex .sp-hb>.sp-ic:last-child{transform:rotate(90deg)}',
      '.sp-g.ex .sp-hb>.sp-ic:first-child{color:var(--gc-accent)}',
      '.sp-d{display:grid;grid-template-rows:0fr;transition:grid-template-rows 280ms cubic-bezier(.2,.8,.2,1)}',
      '.sp-g.ex .sp-d{grid-template-rows:1fr}',
      '.sp-di{min-height:0;overflow:hidden}',
      '.sp-dp{padding:2px 20px 20px;opacity:0;transform:translateY(-4px);transition:opacity 200ms var(--gc-ease),transform 240ms var(--gc-ease)}',
      '.sp-g.ex .sp-dp{opacity:1;transform:none}',
      '.sp-lab{margin:16px 0 7px;font-size:12px;line-height:16px;color:var(--gc-muted)}',
      /* segments with a sliding thumb */
      '.sp-seg{position:relative;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);padding:2px;min-height:34px;background:var(--gc-canvas);',
      '  border:1px solid var(--gc-line-subtle);border-radius:calc(var(--gc-radius-xl) + 2px)}',
      '.sp-thumb{position:absolute;top:2px;bottom:2px;left:2px;width:calc((100% - 4px) / var(--n));transform:translateX(calc(var(--i) * 100%));',
      '  background:var(--gc-elevated);border-radius:var(--gc-radius-xl);box-shadow:0 1px 2px var(--gc-shade),0 0 0 1px var(--gc-line);transition:transform 260ms cubic-bezier(.2,.8,.2,1)}',
      '.sp-seg.none .sp-thumb{opacity:0}',
      '.sp-seg button{position:relative;z-index:1;min-width:0;padding:0 6px;background:transparent;border:0;border-radius:var(--gc-radius-xl);font-size:13px;color:var(--gc-muted);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color 160ms var(--gc-ease);font-variant-numeric:tabular-nums}',
      '.sp-seg button:hover{color:var(--gc-ink)}',
      '.sp-seg button[aria-checked="true"]{color:var(--gc-ink);font-weight:600}',
      '.sp-seg button[aria-disabled="true"]{cursor:default;color:var(--gc-muted);opacity:.55}',
      '.sp-seg button[aria-disabled="true"][aria-checked="true"]{opacity:1;color:var(--gc-ink)}',
      '.sp-mode{margin:4px 0 0}',
      '.sp-mode .sp-thumb{background:var(--gc-accent-soft);box-shadow:0 0 0 1px color-mix(in srgb,var(--gc-accent) 40%,transparent)}',
      '.sp-mode button[aria-checked="true"]{color:var(--gc-accent)}',
      /* toggle tiles */
      '.sp-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px}',
      '.sp-tile{position:relative;display:flex;align-items:center;gap:10px;min-height:46px;padding:0 12px;text-align:left;background:transparent;',
      '  border:1px solid var(--gc-line-subtle);border-radius:var(--gc-radius-xl);color:var(--gc-muted);transition:background 180ms var(--gc-ease),border-color 180ms var(--gc-ease),color 180ms var(--gc-ease)}',
      '.sp-tile:hover{border-color:var(--gc-line)}',
      '.sp-tile .sp-ic{color:var(--gc-muted);transition:color 180ms var(--gc-ease)}',
      '.sp-tl{flex:1;min-width:0;font-size:13px;line-height:17px}',
      '.sp-dot{flex:none;width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--gc-line-strong);transition:background 180ms var(--gc-ease),box-shadow 180ms var(--gc-ease)}',
      '.sp-tile[aria-checked="true"]{background:var(--gc-elevated);border-color:var(--gc-line);color:var(--gc-ink);box-shadow:0 1px 2px var(--gc-shade)}',
      '.sp-tile[aria-checked="true"] .sp-ic{color:var(--gc-accent)}',
      '.sp-tile[aria-checked="true"] .sp-dot{background:var(--gc-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--gc-accent) 22%,transparent)}',
      /* theme swatches */
      '.sp-sw{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:4px}',
      '.sp-sw button{display:flex;flex-direction:column;gap:6px;padding:0;background:transparent;border:0;color:var(--gc-muted);font-size:12px;line-height:16px;text-align:left}',
      '.sp-pv{position:relative;display:block;height:46px;border-radius:var(--gc-radius-xl);box-shadow:0 0 0 1px var(--gc-line);overflow:hidden;transition:box-shadow 180ms var(--gc-ease)}',
      '.sp-pv i{position:absolute;left:10px;top:10px;right:22px;bottom:-4px;border-radius:3px 3px 0 0}',
      '.sp-pv b{position:absolute;left:16px;top:17px;width:42%;height:3px;border-radius:2px;opacity:.9}',
      '.sp-pv u{position:absolute;left:16px;top:25px;width:22%;height:3px;border-radius:2px}',
      '.sp-sw button:hover .sp-pv{box-shadow:0 0 0 1px var(--gc-line-strong)}',
      '.sp-sw button[aria-checked="true"] .sp-pv{box-shadow:0 0 0 2px var(--gc-accent),0 0 0 4px color-mix(in srgb,var(--gc-accent) 20%,transparent)}',
      '.sp-sw button[aria-checked="true"]{color:var(--gc-ink);font-weight:600}',
      '.sp-nm{padding-left:2px}',
      /* materials */
      '.sp-mat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}',
      '.sp-mat button{display:flex;align-items:center;gap:9px;min-height:36px;padding:0 10px;background:transparent;border:1px solid transparent;border-radius:var(--gc-radius-xl);',
      '  color:var(--gc-ink-2);font-size:13px;line-height:16px;text-align:left;transition:background 160ms var(--gc-ease),border-color 160ms var(--gc-ease)}',
      '.sp-mat button span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sp-mat button:hover{background:var(--gc-hover)}',
      '.sp-mat button[aria-checked="true"]{background:var(--gc-elevated);border-color:var(--gc-line);color:var(--gc-ink);font-weight:600;box-shadow:0 1px 2px var(--gc-shade)}',
      '.sp-chip{flex:none;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--c) 40%,#fff),var(--c) 55%,color-mix(in srgb,var(--c) 60%,#000));box-shadow:0 0 0 1px var(--gc-line)}',
      /* action rows */
      '.sp-rows{display:flex;flex-direction:column;margin:10px -8px 0}',
      '.sp-row{display:flex;align-items:center;gap:12px;min-height:40px;padding:4px 8px;background:transparent;border:0;border-radius:var(--gc-radius-xl);color:var(--gc-ink-2);text-align:left}',
      '.sp-row:hover{background:var(--gc-hover);color:var(--gc-ink)}',
      '.sp-row>.sp-ic{color:var(--gc-muted)}',
      '.sp-rl{flex:1;min-width:0;display:flex;flex-direction:column;font-size:13px;line-height:18px;color:var(--gc-ink)}',
      '.sp-rl small{font-size:12px;line-height:16px;color:var(--gc-muted)}',
      '.sp-help .sp-rows,.sp-g[data-g="help"] .sp-rows{margin-top:0}',
      /* key capture */
      '.sp-capr{display:flex;gap:6px}',
      '.sp-cap{flex:1;display:flex;align-items:center;justify-content:center;min-height:40px;background:var(--gc-canvas);border:1px dashed var(--gc-line);border-radius:var(--gc-radius-xl);color:var(--gc-ink);transition:border-color 160ms var(--gc-ease),background 160ms var(--gc-ease)}',
      '.sp-cap:hover{border-color:var(--gc-line-strong)}',
      '.sp-capv{font-family:var(--gc-font-mono);font-size:13px;letter-spacing:.02em}',
      '.sp-cap.listen{border-style:solid;border-color:var(--gc-accent);background:var(--gc-accent-soft)}',
      '.sp-cap.listen .sp-capv{font-family:var(--gc-font-sans);color:var(--gc-accent);animation:sp-pulse 1.4s ease-in-out infinite}',
      '@keyframes sp-pulse{50%{opacity:.45}}',
      '.sp-ibtn{flex:none;width:40px;display:grid;place-items:center;background:var(--gc-canvas);border:1px solid var(--gc-line-subtle);border-radius:var(--gc-radius-xl);color:var(--gc-muted)}',
      '.sp-ibtn:hover{color:var(--gc-ink);border-color:var(--gc-line)}',
      /* about */
      '.sp-about{font-size:13px;line-height:19px;color:var(--gc-ink-2)}',
      '.sp-about p{margin:8px 0 0}',
      '.sp-at{font-weight:600;color:var(--gc-ink)}',
      '.sp-mono{font-family:var(--gc-font-mono);font-size:12px;color:var(--gc-muted)}',
      '.sp-fine{font-size:12px;line-height:17px;color:var(--gc-muted)}',
      '.sp:focus{outline:0}.sp :focus-visible{outline:2px solid var(--gc-focus);outline-offset:-2px}',
      '.sp-sw button:focus-visible{outline:0}.sp-sw button:focus-visible .sp-pv{box-shadow:0 0 0 2px var(--gc-focus)}',
      /* phones: full width, 44 px targets */
      '@media (max-width:600px),(pointer:coarse){.sp-hb{min-height:56px}.sp-seg button{min-height:44px}.sp-tile{min-height:52px}.sp-mat button,.sp-row,.sp-cap{min-height:44px}',
      '  .sp-x{width:44px;height:44px}.sp-ibtn{width:44px}.sp-sw button{min-height:44px}}',
      '@media (max-width:600px){.sp{width:100vw;border-right:0}.sp-head{padding-left:16px}.sp-hb{padding:0 12px 0 16px}.sp-dp{padding:2px 16px 20px}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function build() {
    css();
    scrim = document.createElement('div'); scrim.className = 'sp-scrim'; scrim.hidden = true;
    panel = document.createElement('div'); panel.className = 'sp'; panel.id = 'setpanel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.tabIndex = -1; panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'sp-title');
    panel.innerHTML = '<div class="sp-head"><h2 class="sp-title" id="sp-title"></h2><button type="button" class="sp-x">' + ic('x') + '</button></div><div class="sp-body"></div>';
    document.body.appendChild(scrim); document.body.appendChild(panel);
    scrim.addEventListener('click', function () { close(); });
    panel.querySelector('.sp-x').addEventListener('click', function () { close(); });
    panel.addEventListener('click', onClick);
  }

  function onClick(e) {
    var t = e.target;
    var hb = t.closest('.sp-hb'); if (hb) { var g = hb.closest('[data-g]').dataset.g; expand(g, !open[g]); return; }
    var sw = t.closest('[role=switch]'); if (sw) { var k = sw.dataset.t; tset(k, !tget(k)); afterChange(); var el = panel.querySelector('[data-t="' + k + '"]'); if (el) el.focus(); return; }
    var r = t.closest('[role=radio]'); if (r) { pick(r); return; }
    var a = t.closest('[data-act]'); if (a) action(a.dataset.act, a);
  }
  function pick(r) {
    if (r.getAttribute('aria-disabled') === 'true') return;
    var grp = r.closest('[data-k]'), key = grp.dataset.k, raw = r.dataset.v, s = SET();
    if (key.indexOf('mode:') === 0) applyMode(key.slice(5), raw);
    else if (key === 'theme') drive('theme', raw);
    else if (key === 'speed') drive('speed', +raw);
    else if (key === 'material') drive('material', raw);
    else if (key === 'dir') drive('dir', raw);
    else if (s) s.set(key, raw);       // lang, decimal, skin, env, quality, motion: the settings listener in ui.js applies them
    afterChange();
    var again = panel.querySelector('[data-k="' + key + '"] [data-v="' + raw + '"]'); if (again) again.focus();
  }
  function remember() { ['view', 'effects'].forEach(function (g) { var d = derive(g); if (d && groupMode(g) !== d) setGroupMode(g, d); }); }
  function afterChange() {
    remember();
    var cm = camMode(); if (groupMode('camera') !== cm && !(cm === 'still' && groupMode('camera') === undefined)) setGroupMode('camera', cm);
    sync();
  }
  function expand(g, on) {
    open[g] = !!on;
    var sec = panel.querySelector('[data-g="' + g + '"]'); if (!sec) return;
    sec.classList.toggle('ex', !!on); sec.querySelector('.sp-hb').setAttribute('aria-expanded', String(!!on));
    var d = sec.querySelector('.sp-d'); if (on) d.removeAttribute('inert'); else d.setAttribute('inert', '');
  }

  /* help, profile, developer log, introduction: the simulator's own dialogs (the old settings modal's buttons where ui.js has no other door) */
  var legacyGear = null;
  function legacy(tab, id) {
    if (!legacyGear) return;
    legacyGear(); var tb = $('set-t-' + tab); if (tb) tb.click(); var b = $(id); if (b) b.click();
  }
  function action(act, el) {
    if (act === 'fit') { drive('fit'); afterChange(); return; }
    if (act === 'fullscreen') { drive('fullscreen'); return; }
    if (act === 'fskey') { listen(el); return; }
    if (act === 'diag') { copyDiag(); return; }
    if (act === 'reset') { try { localStorage.removeItem('tnc.lessons.v1'); } catch (e) {} if (SET()) SET().set('setup', 0); if (UI && UI.say) UI.say(T('help.reset.done')); return; }
    close(true);
    if (act === 'lessons') { var h = $('b-help'); if (h) h.click(); }
    else if (act === 'keys') { var h2 = $('b-help'); if (h2) h2.click(); var kt = document.querySelector('#help-tabs [data-tab="keys"]'); if (kt) kt.click(); }
    else if (act === 'intro') { var su = $('help-setup'); if (su) su.click(); }
    else if (act === 'profile') { var p = $('b-prof'); if (p) p.click(); else legacy('general', 'set-prof'); }
    else if (act === 'dev') legacy('adv', 'set-dev');
  }
  function listen(el) {
    capture = true; el.classList.add('listen'); el.querySelector('.sp-capv').textContent = T('fskey.press');
  }
  function endListen(key) {
    capture = false; var el = panel.querySelector('.sp-cap'); if (!el) return; el.classList.remove('listen');
    if (key !== undefined) store.set('fskey', key);
    el.querySelector('.sp-capv').textContent = store.get('fskey') || T('fskey.none'); sync();
  }
  function diagText() {
    var s = S(), r = UI && UI.renderer, st = s.res && s.res.stats || {};
    var gl = null; try { gl = r && r.getContext(); } catch (e) {}
    return ['edition    ' + ((SET() && SET().edition) || 'core'), 'embedded   ' + ((window.TNC_BRIDGE || {}).embedded ? 'yes' : 'no') + ' · server ' + (window.TNC_BACKEND ? 'yes' : 'no'),
      'engine     tnc-core WebAssembly · ' + (window.TNC_ENGINE && TNC_ENGINE.ready && TNC_ENGINE.ready() ? 'loaded' : 'not loaded'),
      'three.js   r' + (UI && UI.THREE ? UI.THREE.REVISION : '?') + ' · WebGL2 ' + (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'yes' : 'no') + ' · pixel ratio ' + (r ? r.getPixelRatio() : '?'),
      'viewport   ' + innerWidth + ' x ' + innerHeight + ' · reduced motion ' + (SET() && SET().reducedMotion() ? 'yes' : 'no') + ' · theme ' + curTheme(),
      'machine    ' + s.machine + ' · ' + s.pgm + ' · ' + (s.res && s.res.blocks ? s.res.blocks.length : 0) + ' blocks · ' + (s.segs ? s.segs.length : 0) + ' moves · ' + (s.res && s.res.errors ? s.res.errors.length : 0) + ' errors',
      'run        t ' + (+s.t || 0).toFixed(1) + ' / ' + (+s.total || 0).toFixed(1) + ' s · feed path ' + (+st.pathFeed || 0).toFixed(0) + ' mm',
      'settings   ' + JSON.stringify(SET() ? SET().all() : {}), 'panel      ' + JSON.stringify(own())].join('\n');
  }
  function copyDiag() {
    var t = diagText();
    var done = function () { if (UI && UI.say) UI.say(T('copied')); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    } catch (e) { fallback(); }
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px'; panel.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove(); }
  }

  /* ---------- open / close ---------- */
  function appInert(on) { ['.app', '#scrim'].forEach(function (q) { var el = document.querySelector(q); if (el) el.inert = on; }); }
  function doOpen(g) {
    if (!panel) return;
    g = g ? (ALIAS[g] || g) : null;
    var modal = document.querySelector('.modal:not([hidden]) [data-close]'); if (modal) modal.click();     // one layer at a time
    if (!isOpen) { ret = document.activeElement; clearTimeout(closeT); }
    if (g && GROUPS.indexOf(g) >= 0) open[g] = true;
    isOpen = true; render();
    scrim.hidden = false; panel.hidden = false; appInert(true);
    void panel.offsetWidth;                       // start the slide from off screen
    scrim.classList.add('on'); panel.classList.add('on');
    var gear = $('b-gear'); if (gear) gear.setAttribute('aria-expanded', 'true');
    var target = g && panel.querySelector('[data-g="' + g + '"]');
    if (target) { target.scrollIntoView({ block: 'start' }); target.querySelector('.sp-hb').focus({ preventScroll: true }); }
    else panel.focus({ preventScroll: true });
  }
  function close(quiet) {
    if (!isOpen) return;
    if (capture) endListen();
    isOpen = false; appInert(false);
    scrim.classList.remove('on'); panel.classList.remove('on');
    var gear = $('b-gear'); if (gear) gear.setAttribute('aria-expanded', 'false');
    var reduced = SET() && SET().reducedMotion && SET().reducedMotion();
    closeT = setTimeout(function () { if (!isOpen) { panel.hidden = true; scrim.hidden = true; } }, reduced ? 130 : 320);
    var r = (gear && visible(gear)) ? gear : (ret && ret.isConnected && visible(ret) && !panel.contains(ret) ? ret : null);
    if (!r) { var m = $('b-menu'); if (m && visible(m)) r = m; }
    if (r) try { r.focus({ preventScroll: true }); } catch (e) {}
    ret = null;
  }
  function visible(el) { return el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.offsetParent !== null; }

  /* keys while the panel is open belong to the panel; ',' opens it (ui.js's own ',' never sees the key) */
  function typing(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function onKey(e) {
    if (synth) return;
    if (!isOpen) {
      var s = S();
      if (e.key === ',' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !document.querySelector('.modal:not([hidden])') &&
          !s.editing && !s.raw && !s.wiz && !s.mgt && ($('setup') ? $('setup').hidden : true) && !($('hmore') && $('hmore').classList.contains('open'))) {
        e.preventDefault(); e.stopImmediatePropagation(); doOpen();
      }
      return;
    }
    e.stopImmediatePropagation();
    if (capture) {
      e.preventDefault();
      if (e.key === 'Escape') { endListen(); return; }
      if (e.key === 'Tab') { endListen(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { endListen(''); return; }
      if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
      var name = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      endListen(name); return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      var f = [].slice.call(panel.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && x.tabIndex >= 0 && !x.closest('[inert]') && visible(x); });
      if (!f.length) return; var first = f[0], last = f[f.length - 1];
      if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    var g = e.target.closest && e.target.closest('.sp [role=radiogroup]');
    var d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (g && d) {
      e.preventDefault();
      var rs = [].slice.call(g.querySelectorAll('[role=radio]')).filter(function (x) { return x.getAttribute('aria-disabled') !== 'true' || x === e.target; });
      var i = rs.indexOf(e.target); if (i < 0) return;
      var n = rs[(i + d + rs.length) % rs.length]; if (n.getAttribute('aria-disabled') === 'true') return; pick(n); return;
    }
    if (e.target.classList && e.target.classList.contains('sp-hb') && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
      e.preventDefault(); var hs = [].slice.call(panel.querySelectorAll('.sp-hb')), j = hs.indexOf(e.target);
      var to = e.key === 'Home' ? 0 : e.key === 'End' ? hs.length - 1 : Math.max(0, Math.min(hs.length - 1, j + (e.key === 'ArrowDown' ? 1 : -1))); hs[to].focus();
    }
  }

  api.open = function (g) { doOpen(g); };
  api.close = function () { close(); };
  api.toggle = function () { if (isOpen) close(); else doOpen(); };
  Object.defineProperty(api, 'isOpen', { get: function () { return isOpen; } });
  Object.defineProperty(api, 'ready', { get: function () { return booted; } });

  (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
    UI = ui;
    build();
    /* the stored theme on the page (the shell applies it itself once it has themes; this keeps it right before that) */
    var th = store.get('theme'); if (th && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = th;
    applyInput();
    /* the gear: ui.js set its click handler before the plugins ran; keep that one as the door to the old dialogs */
    var gear = $('b-gear');
    if (gear) { legacyGear = gear.onclick; gear.onclick = function (e) { if (e) e.preventDefault(); api.toggle(); }; gear.setAttribute('aria-expanded', 'false'); gear.setAttribute('aria-controls', 'setpanel'); }
    var fxm = $('fxmenu'); if (fxm) { fxm.open = false; fxm.hidden = true; }    // its controls stay in the page for the adapter
    window.addEventListener('keydown', onKey, true);
    /* the fullscreen key, until ui.js has its own (UIAPI.fullscreen) */
    if (typeof ui.fullscreen !== 'function') window.addEventListener('keydown', function (e) {
      var k = store.get('fskey'); if (!k || isOpen || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('.modal:not([hidden])')) return;
      var name = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (name === k && k.length > 1) { e.preventDefault(); drive('fullscreen'); }
    });
    if (window.TNC_SETTINGS) TNC_SETTINGS.on(function (keys) { if (!isOpen) return; if (keys.indexOf('lang') >= 0) render(); else sync(); });
    /* the group modes follow the toggles also when they change outside the panel (keys, the old buttons) */
    var watch = $('fxmenu');
    if (watch && window.MutationObserver) new MutationObserver(function () { if (booted) remember(); }).observe(watch, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    if (ui.on) ui.on('ready', function () {
      applyInput();
      /* a page without the cookie that keeps the toggles (file://) comes back with the defaults: the stored mode puts them back */
      ['view', 'effects'].forEach(function (g) { var m = groupMode(g); if (m && MODES[g][m] && derive(g) !== m) applyMode(g, m); });
      booted = true; remember();
    });
  });
  return api;
})();
if (typeof module !== 'undefined') module.exports = TNC_SETPANEL;
