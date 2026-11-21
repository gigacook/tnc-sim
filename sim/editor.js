/* ============================================================
   TNC_EDITOR — a plain text editor over the workspace: a .H program from the profile, or any text file from disk.
   A textarea with line numbers (no library). The state badge always says where the text stands:
     ● ändrad, inte sparad (amber) · ● utkast återställt, inte sparat (amber, after a reload) · ✓ sparad 20:14 (green) · ○ från disk
   Save (Ctrl S): a program goes into the profile (TNC_UI.library.save: one undo step in the simulator) and becomes the active
   program; a file opened from disk is also written back (File System Access API) or offered as a download. A plain text file
   is written back / downloaded. What is typed is kept as a draft (localStorage "tnc.editor.draft.v1") until it is saved,
   reverted or thrown away, so a reload never loses it — and the badge says it is a draft, not saved.
   TNC_EDITOR = { open(name?, machine?), openFile(), close(), get isOpen }
   ============================================================ */
var TNC_EDITOR = (function () {
  'use strict';
  var STR = {
    sv: { dirty: 'ändrad, inte sparad', draft: 'utkast återställt, inte sparat', saved: 'sparad {t}', savedNo: 'sparad', disk: 'från disk, inte sparad i profilen', diskTxt: 'från disk',
      open: 'Öppna fil…', revert: 'Ångra ändringar', save: 'Spara', close: 'Stäng', download: 'Ladda ner', row: 'rad', col: 'kol', rows: '{n} rader',
      noErr: 'inga fel', errs: '{n} fel', lineErr: 'rad {l}: {m}', ask: 'Spara ändringar i {n}?', discard: 'Släng', cancel: 'Avbryt', find: 'Sök',
      written: 'SPARAD PÅ DISK: {n}', downloaded: 'NEDLADDAD: {n}', editor: 'Texteditor', text: 'text', drop: 'Släpp filen här', notFound: 'hittades inte' },
    en: { dirty: 'changed, not saved', draft: 'draft restored, not saved', saved: 'saved {t}', savedNo: 'saved', disk: 'from disk, not saved in the profile', diskTxt: 'from disk',
      open: 'Open file…', revert: 'Revert changes', save: 'Save', close: 'Close', download: 'Download', row: 'line', col: 'col', rows: '{n} lines',
      noErr: 'no errors', errs: '{n} errors', lineErr: 'line {l}: {m}', ask: 'Save changes to {n}?', discard: 'Discard', cancel: 'Cancel', find: 'Find',
      written: 'SAVED TO DISK: {n}', downloaded: 'DOWNLOADED: {n}', editor: 'Text editor', text: 'text', drop: 'Drop the file here', notFound: 'not found' },
    sr: { dirty: 'izmenjeno, nije sačuvano', draft: 'nacrt vraćen, nije sačuvan', saved: 'sačuvano {t}', savedNo: 'sačuvano', disk: 'sa diska, nije sačuvano u profilu', diskTxt: 'sa diska',
      open: 'Otvori fajl…', revert: 'Poništi izmene', save: 'Sačuvaj', close: 'Zatvori', download: 'Preuzmi', row: 'red', col: 'kol', rows: '{n} redova',
      noErr: 'nema grešaka', errs: '{n} greš.', lineErr: 'red {l}: {m}', ask: 'Sačuvati izmene u {n}?', discard: 'Odbaci', cancel: 'Otkaži', find: 'Traži',
      written: 'SAČUVANO NA DISK: {n}', downloaded: 'PREUZETO: {n}', editor: 'Uređivač teksta', text: 'tekst', drop: 'Spusti fajl ovde', notFound: 'nije pronađeno' }
  };
  var lang = function () { var l = (window.TNC_I18N && TNC_I18N.lang) || 'sv'; return STR[l] ? l : 'sv'; };
  function L(k, v) { var s = STR[lang()][k]; if (s == null) s = STR.en[k] || k; return v ? s.replace(/\{(\w+)\}/g, function (a, x) { return v[x] == null ? a : String(v[x]); }) : s; }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var UI = function () { return window.TNC_UI || null; };
  var $ = function (id) { return document.getElementById(id); };
  var hm = function (d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  var DRAFT = 'tnc.editor.draft.v1';

  var CSS = [
    '.ted{position:fixed;left:0;right:0;top:var(--bar-h,48px);bottom:0;z-index:66;background:var(--scr);color:var(--scr-ink);display:flex;flex-direction:column}',
    '.ted[hidden]{display:none}',
    '.ted button{font:inherit;cursor:pointer}',
    '.ted :focus-visible{outline:2px solid var(--gc-focus);outline-offset:1px}',
    '.ted-tb{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:8px 14px;border-bottom:1px solid var(--gc-line);background:var(--gc-surface);color:var(--gc-ink);font-size:13px}',
    '.ted-fn{font:600 13px var(--gc-font-mono);overflow-wrap:anywhere}',
    '.ted-st{font:12.5px var(--gc-font-mono);color:var(--gc-muted)}',
    '.ted-st[data-state=dirty],.ted-st[data-state=draft]{color:var(--gc-warning)}',
    '.ted-st[data-state=saved]{color:var(--gc-success)}',
    '.ted-sp{flex:1}',
    '.ted-tb button{background:transparent;border:1px solid var(--gc-line);color:var(--gc-ink);border-radius:var(--gc-radius-btn);min-height:30px;padding:0 10px;font-size:12.5px;white-space:nowrap}',
    '.ted-tb button:hover:not(:disabled){border-color:var(--gc-line-strong);background:var(--gc-hover)}',
    '.ted-tb button:disabled{opacity:.45;cursor:default}',
    '.ted-tb button.pri{background:var(--gc-accent-fill);border-color:var(--gc-accent-fill);color:var(--gc-on-accent)}',
    '.ted-tb button.pri:hover:not(:disabled){background:var(--gc-accent-fill-hover)}',
    '.ted-tb kbd{font:11px var(--gc-font-mono);opacity:.7;margin-left:6px}',
    '.ted-find{display:flex;gap:6px;align-items:center}',
    '.ted-find[hidden]{display:none}',
    '.ted-find input{font:12.5px var(--gc-font-mono);background:var(--gc-canvas);color:var(--gc-ink);border:1px solid var(--gc-line-strong);border-radius:var(--gc-radius-btn);min-height:28px;padding:0 8px;width:16ch}',
    '.ted-find span{font:12px var(--gc-font-mono);color:var(--gc-muted)}',
    '.ted-body{flex:1;min-height:0;display:flex;position:relative;font:14px/22px var(--gc-font-mono);background:var(--scr)}',
    '.ted-gut{flex:none;position:relative;overflow:hidden;min-width:54px;border-right:1px solid var(--scr-line);color:var(--scr-muted);background:var(--scr-2);user-select:none}',
    '.ted-gut pre{margin:0;padding:10px 10px 10px 8px;text-align:right;font:inherit;will-change:transform}',
    '.ted-gut .mk{position:absolute;left:0;right:0;height:22px;pointer-events:none}',
    '.ted-gut .mk.cur{background:var(--scr-accent-soft)}',
    '.ted-gut .mk.err{box-shadow:inset 3px 0 0 var(--scr-danger);background:color-mix(in srgb,var(--scr-danger) 14%,transparent)}',
    '.ted-ta{flex:1;min-width:0;margin:0;border:0;outline:none;resize:none;padding:10px 14px;font:inherit;color:var(--scr-ink);background:transparent;white-space:pre;overflow:auto;tab-size:4;caret-color:var(--scr-accent)}',
    '.ted-ta:focus-visible{outline:none}',
    '.ted-ta::selection{background:color-mix(in srgb,var(--scr-accent) 28%,transparent)}',
    '.ted-ft{flex:none;display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center;padding:5px 14px;border-top:1px solid var(--gc-line);background:var(--gc-surface);font:12px var(--gc-font-mono);color:var(--gc-muted)}',
    '.ted-ck{margin-left:auto;display:flex;gap:6px;align-items:center;min-width:0}',
    '.ted-ck .ok{color:var(--gc-success)} .ted-ck .er{color:var(--gc-danger)}',
    '.ted-ck button{background:transparent;border:0;padding:0;color:var(--gc-danger);font:inherit;text-decoration:underline;text-underline-offset:2px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}',
    '.ted-drop{position:absolute;inset:0;display:none;place-items:center;background:color-mix(in srgb,var(--scr-accent) 12%,transparent);border:2px dashed var(--scr-accent);color:var(--scr-ink);font:600 15px var(--gc-font-mono);pointer-events:none}',
    '.ted.over .ted-drop{display:grid}',
    '.ted-ask{position:absolute;inset:0;z-index:2;display:grid;place-items:center;background:var(--gc-scrim)}',
    '.ted-ask[hidden]{display:none}',
    '.ted-ask>div{background:var(--gc-elevated);color:var(--gc-ink);box-shadow:var(--gc-shadow-3);border-radius:var(--gc-radius-xl);padding:18px 20px;max-width:min(420px,calc(100% - 32px));font:14px/1.5 var(--gc-font-mono)}',
    '.ted-ask .row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}',
    '.ted-ask button{background:transparent;border:1px solid var(--gc-line);color:var(--gc-ink);border-radius:var(--gc-radius-btn);min-height:32px;padding:0 12px}',
    '.ted-ask button.pri{background:var(--gc-accent-fill);border-color:var(--gc-accent-fill);color:var(--gc-on-accent)}',
    '@media (max-width:760px){.ted{top:0}.ted-tb kbd{display:none}.ted-tb{padding:8px 10px;gap:6px}.ted-sp{flex-basis:100%;height:0}.ted-tb button{flex:1 1 0;min-width:0;white-space:normal;line-height:1.2;min-height:36px;padding:2px 6px}.ted-find{flex-basis:100%}.ted-find input{flex:1}.ted-body{font-size:13px}}'
  ].join('\n');

  /* ---------- state ---------- */
  var root, ta, gut, gpre, ft = {}, st, fileIn;
  var E = { open: false, src: null, base: '', savedAt: null, restored: false, handle: null, eol: '\n', enc: 'utf-8', offerDl: false, errors: [], back: null, ask: null };
  var draftT = 0, checkT = 0, lineH = 22;

  function build() {
    if (root) return;
    var s = document.createElement('style'); s.id = 'ted-css'; s.textContent = CSS; document.head.appendChild(s);
    root = document.createElement('section'); root.className = 'ted'; root.id = 'ted'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.innerHTML =
      '<div class="ted-tb"><span class="ted-fn" id="ted-fn"></span><span class="ted-st" id="ted-st" role="status" aria-live="polite"></span><span class="ted-sp"></span>' +
      '<span class="ted-find" id="ted-find" hidden><input id="ted-q" type="search" spellcheck="false" autocomplete="off"><span id="ted-qn"></span></span>' +
      '<button type="button" id="ted-open"></button><button type="button" id="ted-revert"></button><button type="button" id="ted-dl" hidden></button>' +
      '<button type="button" class="pri" id="ted-save"></button><button type="button" id="ted-close"></button></div>' +
      '<div class="ted-body"><div class="ted-gut" aria-hidden="true"><pre id="ted-gpre"></pre></div>' +
      '<textarea class="ted-ta" id="ted-ta" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" data-autosave-exempt="kept as a draft per file by editor.js (tnc.editor.draft.v1)"></textarea>' +
      '<div class="ted-drop" id="ted-drop"></div><div class="ted-ask" id="ted-ask" hidden></div></div>' +
      '<div class="ted-ft"><span id="ted-pos"></span><span id="ted-enc"></span><span id="ted-n"></span><span class="ted-ck" id="ted-ck"></span></div>';
    document.body.appendChild(root);
    ta = $('ted-ta'); gut = root.querySelector('.ted-gut'); gpre = $('ted-gpre'); st = $('ted-st');
    ft = { pos: $('ted-pos'), enc: $('ted-enc'), n: $('ted-n'), ck: $('ted-ck') };
    ta.addEventListener('input', onInput);
    ta.addEventListener('scroll', syncScroll);
    ['keyup', 'click', 'select', 'focus'].forEach(function (ev) { ta.addEventListener(ev, caret); });
    $('ted-open').onclick = function () { openFile(); };
    $('ted-revert').onclick = revert;
    $('ted-save').onclick = function () { save(); };
    $('ted-dl').onclick = function () { downloadBack(); };
    $('ted-close').onclick = function () { close(); };
    ft.ck.addEventListener('click', function (e) { var b = e.target.closest('[data-line]'); if (b) goLine(+b.dataset.line); });
    $('ted-q').addEventListener('input', function () { findNext(false, true); });
    root.addEventListener('dragover', function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); root.classList.add('over'); } });
    root.addEventListener('dragleave', function (e) { if (!root.contains(e.relatedTarget)) root.classList.remove('over'); });
    root.addEventListener('drop', function (e) { e.preventDefault(); root.classList.remove('over'); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) guard().then(function (go) { if (go) loadFile(f, null); }); });
    try { lineH = parseFloat(getComputedStyle(ta).lineHeight) || 22; } catch (e) { lineH = 22; }
  }
  function labels() {
    root.setAttribute('aria-label', L('editor'));
    $('ted-open').innerHTML = esc(L('open')) + '<kbd>Ctrl O</kbd>';
    $('ted-revert').textContent = L('revert');
    $('ted-dl').textContent = L('download');
    $('ted-save').innerHTML = esc(L('save')) + '<kbd>Ctrl S</kbd>';
    $('ted-close').innerHTML = esc(L('close')) + '<kbd>Esc</kbd>';
    $('ted-q').setAttribute('aria-label', L('find')); $('ted-q').placeholder = L('find');
    $('ted-drop').textContent = L('drop');
    ta.setAttribute('aria-label', L('text'));
  }

  /* ---------- what is open ---------- */
  var isPgm = function () { return E.src && (E.src.kind === 'pgm' || E.src.isPgm); };
  var title = function () { return E.src ? (E.src.kind === 'pgm' ? E.src.name : E.src.fileName) : ''; };
  var dirty = function () { return ta.value !== E.base; };
  var base0 = function () { return isPgm() ? 0 : 1; };          // programs count lines like blocks (from 0), other text from 1

  function show(text, opts) {
    build(); labels();
    ta.value = text; E.restored = !!(opts && opts.restored);
    if (!E.open) {
      E.back = document.activeElement; E.open = true; root.hidden = false;
      var app = document.querySelector('.app'); if (app) app.inert = true;
      window.addEventListener('keydown', onKey, true);
    }
    ta.scrollTop = 0; ta.scrollLeft = 0; try { ta.setSelectionRange(0, 0); } catch (e) { /* ok */ }
    gutter(); render(); check(true); caret();
    try { ta.focus({ preventScroll: true }); } catch (e) { /* ok */ }
    keepDraft();
  }
  function open(name, machine) {
    var ui = UI(); if (!ui || !ui.library) return false;
    var prog = ui.program, m = machine || prog.machine, n = name || prog.name;
    var text = ui.library.text(m, n); if (text == null) return false;
    return guard().then(function (go) {
      if (!go) return false;
      var meta = (ui.library.list().find(function (p) { return p.machine === m && p.name === n; }) || {}).meta || {};
      E.src = { kind: 'pgm', machine: m, name: n }; E.base = text; E.handle = null; E.eol = '\n'; E.enc = 'utf-8'; E.offerDl = false;
      E.savedAt = meta.m ? new Date(meta.m) : null;
      show(text); return true;
    });
  }

  /* ---------- files from disk ---------- */
  function decode(buf) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf-8' }; }
    catch (e) { var t = window.TNC_PROFILE ? TNC_PROFILE.decode(buf) : new TextDecoder('windows-1252').decode(buf); return { text: t, enc: 'windows-1252' }; }
  }
  function encode(text) {
    if (E.enc !== 'windows-1252') return new TextEncoder().encode(text);
    var W = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
      0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); out[i] = (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) ? c : (W[c] || 0x3F); }
    return out;
  }
  function loadFile(file, handle) {
    var rd = file.arrayBuffer ? file.arrayBuffer() : new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); });
    return rd.then(function (buf) {
      var d = decode(buf), raw = d.text, pg = /\.(h|i)$/i.test(file.name) || /^\s*(\d+\s+)?BEGIN\s+PGM\b/i.test(raw);
      E.eol = /\r\n/.test(raw) ? '\r\n' : '\n'; E.enc = d.enc;
      var text = raw.replace(/\r\n?/g, '\n');
      E.src = { kind: 'file', fileName: file.name, isPgm: pg, machine: UI() ? UI().state.machine : '426' };
      E.base = text; E.handle = handle || null; E.savedAt = null; E.offerDl = false;
      show(text);
    });
  }
  function openFile() {
    build();
    return guard().then(function (go) {
      if (!go) return;
      if (window.showOpenFilePicker && !window.__tedNoFSA) {
        return window.showOpenFilePicker({ multiple: false, id: 'tnc-editor' }).then(function (hs) {
          return hs[0].getFile().then(function (f) { return loadFile(f, hs[0]); });
        }, function (e) { if (e && e.name !== 'AbortError') pickInput(); });
      }
      pickInput();
    });
  }
  function pickInput() {
    if (!fileIn) { fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.id = 'ted-file'; fileIn.hidden = true; document.body.appendChild(fileIn);
      fileIn.onchange = function () { var f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) loadFile(f, null); }; }
    fileIn.click();
  }
  function diskBytes() { var t = ta.value; if (E.eol === '\r\n') t = t.replace(/\n/g, '\r\n'); return encode(t); }
  function writeBack() {
    var h = E.handle; if (!h || !h.createWritable) return Promise.resolve(false);
    return h.createWritable().then(function (w) { return w.write(diskBytes()).then(function () { return w.close(); }); })
      .then(function () { say(L('written', { n: E.src.fileName })); return true; }, function () { return false; });
  }
  function downloadBack() {
    var name = E.src ? E.src.fileName || E.src.name : 'text.txt';
    var url = URL.createObjectURL(new Blob([diskBytes()], { type: 'text/plain' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    E.offerDl = false; render(); say(L('downloaded', { n: name }));
  }
  function say(m) { var ui = UI(); if (ui && ui.say) ui.say(m); }

  /* ---------- save / revert / close ---------- */
  function save() {
    if (!E.open || !E.src) return Promise.resolve(false);
    var text = ta.value, ui = UI();
    if (isPgm()) {
      var want = E.src.kind === 'pgm' ? E.src.name : E.src.fileName.replace(/\.[^.]*$/, '');
      var fromDisk = E.src.kind === 'file', fileName = E.src.fileName;
      var n = ui.library.save(E.src.machine, want, text);
      E.src = { kind: 'pgm', machine: ui.state.machine, name: n, fileName: fileName, fromDisk: fromDisk };
      E.base = text; E.savedAt = new Date(); E.restored = false;
      if (fromDisk) { E.offerDl = true; writeBack().then(function (ok) { if (ok) { E.offerDl = false; render(); } }); }
      clearDraft(true); render(); check(true);
      return Promise.resolve(true);
    }
    E.base = text; E.savedAt = new Date(); E.restored = false; clearDraft(true);
    return writeBack().then(function (ok) { if (!ok) downloadBack(); render(); return true; });
  }
  function revert() { if (!E.open) return; ta.value = E.base; E.restored = false; gutter(); render(); check(true); caret(); clearDraft(true); ta.focus(); }
  /* Spara / Släng / Avbryt when there are unsaved changes: resolves true when it is fine to go on */
  function guard() {
    if (!E.open || !dirty()) return Promise.resolve(true);
    return askSave().then(function (a) {
      if (a === 'save') return save().then(function () { return true; });
      if (a === 'discard') { ta.value = E.base; clearDraft(true); return true; }
      return false;
    });
  }
  function askSave() {
    var box = $('ted-ask');
    box.innerHTML = '<div role="alertdialog" aria-modal="true" aria-labelledby="ted-ask-q"><span id="ted-ask-q">' + esc(L('ask', { n: title() })) + '</span>' +
      '<div class="row"><button type="button" class="pri" data-r="save">' + esc(L('save')) + '</button><button type="button" data-r="discard">' + esc(L('discard')) + '</button><button type="button" data-r="cancel">' + esc(L('cancel')) + '</button></div></div>';
    box.hidden = false;
    return new Promise(function (res) {
      E.ask = function (r) { box.hidden = true; box.innerHTML = ''; E.ask = null; res(r); if (r === 'cancel') ta.focus(); };
      box.onclick = function (e) { var b = e.target.closest('[data-r]'); if (b && E.ask) E.ask(b.dataset.r); };
      box.querySelector('.pri').focus();
    });
  }
  function close() {
    if (!E.open) return Promise.resolve(true);
    return guard().then(function (go) {
      if (!go) return false;
      E.open = false; root.hidden = true; clearDraft(false);
      window.removeEventListener('keydown', onKey, true);
      var app = document.querySelector('.app'); if (app) app.inert = false;
      closeFind();
      var r = E.back; E.back = null; if (r && r.isConnected && r !== document.body) try { r.focus({ preventScroll: true }); } catch (e) { /* ok */ }
      return true;
    });
  }

  /* ---------- drafts: kept until saved / reverted / thrown away ---------- */
  function keepDraft() {
    clearTimeout(draftT);
    draftT = setTimeout(writeDraft, 300);
  }
  function writeDraft() {
    if (!E.open || !E.src) return;
    try {
      if (!dirty()) { localStorage.removeItem(DRAFT); return; }
      localStorage.setItem(DRAFT, JSON.stringify({ v: 1, src: E.src, text: ta.value, base: E.base, eol: E.eol, enc: E.enc, t: Date.now() }));
    } catch (e) { /* storage off: the text stays in the editor until the page is left */ }
  }
  function clearDraft() { clearTimeout(draftT); try { localStorage.removeItem(DRAFT); } catch (e) { /* ok */ } }
  addEventListener('pagehide', function () { if (E.open) { clearTimeout(draftT); writeDraft(); } });
  function restoreDraft(ui) {
    var d = null; try { d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) { d = null; }
    if (!d || !d.src || typeof d.text !== 'string') return;
    var base = d.base;
    if (d.src.kind === 'pgm') { var cur = ui.library.text(d.src.machine, d.src.name); if (cur != null) base = cur; }
    if (d.text === base) { clearDraft(); return; }
    E.src = d.src; E.base = base; E.eol = d.eol || '\n'; E.enc = d.enc || 'utf-8'; E.handle = null; E.savedAt = null; E.offerDl = false;
    show(d.text, { restored: true });
  }

  /* ---------- view ---------- */
  function render() {
    if (!root) return;
    $('ted-fn').textContent = title();
    var d = dirty(), state, txt;
    if (d) { state = E.restored ? 'draft' : 'dirty'; txt = '● ' + L(E.restored ? 'draft' : 'dirty'); }
    else if (E.src && E.src.kind === 'file' && !E.savedAt) { state = 'disk'; txt = '○ ' + L(E.src.isPgm ? 'disk' : 'diskTxt'); }
    else { state = 'saved'; txt = '✓ ' + (E.savedAt ? L('saved', { t: hm(E.savedAt) }) : L('savedNo')); }
    st.dataset.state = state; st.textContent = txt;
    $('ted-revert').disabled = !d;
    $('ted-dl').hidden = !(E.offerDl && !d);
    ft.enc.textContent = (E.enc === 'windows-1252' ? 'Windows-1252' : 'UTF-8') + ' · ' + (E.eol === '\r\n' ? 'CRLF' : 'LF');
  }
  function gutter() {
    var n = ta.value.split('\n').length, b = base0(), out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = i + b;
    gpre.textContent = out.join('\n');
    gut.style.minWidth = (String(n + b).length + 3) + 'ch';
    ft.n.textContent = L('rows', { n: n });
    marks();
  }
  function marks() {
    gut.querySelectorAll('.mk').forEach(function (m) { m.remove(); });
    var top = 10 - ta.scrollTop, frag = document.createDocumentFragment(), add = function (line, cls) { var d = document.createElement('div'); d.className = 'mk ' + cls; d.style.top = (top + line * lineH) + 'px'; frag.appendChild(d); };
    add(lineOf(ta.selectionStart), 'cur');
    (E.errors || []).slice(0, 200).forEach(function (e) { add(e.block, 'err'); });
    gut.insertBefore(frag, gpre);
  }
  function syncScroll() { gpre.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)'; marks(); }
  function lineOf(pos) { var s = ta.value, n = 0; for (var i = s.indexOf('\n'); i >= 0 && i < pos; i = s.indexOf('\n', i + 1)) n++; return n; }
  function caret() {
    if (!E.open) return;
    var p = ta.selectionStart, ln = lineOf(p), c0 = ta.value.lastIndexOf('\n', p - 1) + 1;
    ft.pos.textContent = L('row') + ' ' + (ln + base0()) + ', ' + L('col') + ' ' + (p - c0 + 1);
    marks();
  }
  function goLine(line) {
    var s = ta.value, pos = 0; for (var i = 0; i < line; i++) { var j = s.indexOf('\n', pos); if (j < 0) break; pos = j + 1; }
    var end = s.indexOf('\n', pos); if (end < 0) end = s.length;
    ta.focus(); ta.setSelectionRange(pos, end);
    var y = line * lineH; if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - lineH * 2) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
    caret();
  }

  /* ---------- live check: the machine's own interpreter, without touching the simulator ---------- */
  function check(now) {
    clearTimeout(checkT);
    var run = function () {
      if (!E.open) return;
      if (!isPgm()) { E.errors = []; ft.ck.innerHTML = ''; marks(); return; }
      var r = UI().library.run(E.src.machine, ta.value), errs = (r.res && r.res.errors) || [];
      E.errors = errs;
      if (!errs.length) ft.ck.innerHTML = '<span class="ok" data-check="ok">✓ ' + esc(L('noErr')) + '</span>';
      else { var e0 = errs[0]; ft.ck.innerHTML = '<span class="er" data-check="bad">✕ ' + esc(L('errs', { n: errs.length })) + '</span>' +
        '<button type="button" data-line="' + e0.block + '">' + esc(L('lineErr', { l: e0.block + base0(), m: e0.msg })) + '</button>'; }
      marks();
    };
    if (now) run(); else checkT = setTimeout(run, 250);
  }
  function onInput() {
    if (E.restored && !dirty()) E.restored = false;
    gutter(); render(); check(false); caret(); keepDraft();
  }

  /* ---------- tab / find ---------- */
  function indent(out) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    if (!out && s === e) { if (!document.execCommand || !document.execCommand('insertText', false, '  ')) { ta.setRangeText('  ', s, e, 'end'); onInput(); } return; }
    var a = v.lastIndexOf('\n', s - 1) + 1, b = v.indexOf('\n', e - (e > s && v[e - 1] === '\n' ? 1 : 0)); if (b < 0) b = v.length;
    var block = v.slice(a, b), lines = block.split('\n');
    var neu = lines.map(function (l) { return out ? l.replace(/^ {1,2}/, '') : '  ' + l; }).join('\n');
    ta.setSelectionRange(a, b);
    if (!document.execCommand || !document.execCommand('insertText', false, neu)) { ta.setRangeText(neu, a, b, 'select'); onInput(); }
    ta.setSelectionRange(a, a + neu.length);
  }
  function openFind() { var f = $('ted-find'); f.hidden = false; var q = $('ted-q'); var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd); if (sel && sel.indexOf('\n') < 0) q.value = sel; q.focus(); q.select(); }
  function closeFind() { var f = $('ted-find'); if (f && !f.hidden) { f.hidden = true; $('ted-qn').textContent = ''; } }
  function findNext(back, live) {
    var q = $('ted-q').value; if (!q) { $('ted-qn').textContent = ''; return; }
    var v = ta.value.toUpperCase(), Q = q.toUpperCase(), from = live ? ta.selectionStart : (back ? ta.selectionStart - 1 : ta.selectionEnd);
    var i = back ? v.lastIndexOf(Q, from) : v.indexOf(Q, from);
    if (i < 0) i = back ? v.lastIndexOf(Q) : v.indexOf(Q);
    if (i < 0) { $('ted-qn').textContent = L('notFound'); return; }
    var n = 0, k = -1; while ((k = v.indexOf(Q, k + 1)) >= 0 && k <= i) n++;
    var tot = 0; k = -1; while ((k = v.indexOf(Q, k + 1)) >= 0) tot++;
    $('ted-qn').textContent = n + '/' + tot;
    ta.setSelectionRange(i, i + q.length);
    var line = lineOf(i), y = line * lineH; if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - lineH * 2) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
    caret();
  }

  /* ---------- keyboard: the editor's keys stay in the editor (the simulator's shortcuts do not fire under it) ---------- */
  function onKey(e) {
    if (!E.open) return;
    var k = e.key, mod = e.ctrlKey || e.metaKey, t = e.target;
    e.stopPropagation();
    if (E.ask) {
      if (k === 'Escape') { e.preventDefault(); E.ask('cancel'); }
      else if (k === 'Tab') { var bs = [].slice.call($('ted-ask').querySelectorAll('button')), i = bs.indexOf(t); e.preventDefault(); bs[(i + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus(); }
      return;
    }
    if (mod && !e.altKey && (k === 's' || k === 'S')) { e.preventDefault(); save(); return; }
    if (mod && !e.altKey && (k === 'o' || k === 'O')) { e.preventDefault(); openFile(); return; }
    if (mod && !e.altKey && (k === 'f' || k === 'F')) { e.preventDefault(); openFind(); return; }
    if (k === 'F3' || (mod && (k === 'g' || k === 'G'))) { e.preventDefault(); if ($('ted-find').hidden) openFind(); else findNext(e.shiftKey); return; }
    if (t && t.id === 'ted-q') {
      if (k === 'Enter') { e.preventDefault(); findNext(e.shiftKey); ta.focus(); return; }
      if (k === 'Escape') { e.preventDefault(); closeFind(); ta.focus(); return; }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); if (!$('ted-find').hidden) { closeFind(); ta.focus(); return; } close(); return; }
    if (k === 'Tab' && t === ta && !mod && !e.altKey) { e.preventDefault(); indent(e.shiftKey); return; }
    if (k === 'Tab') {                                     // focus stays inside the editor
      var f = [].filter.call(root.querySelectorAll('button,input,textarea'), function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; }), j = f.indexOf(t);
      if (e.shiftKey && j <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (j === f.length - 1 || j < 0)) { e.preventDefault(); f[0].focus(); }
    }
  }

  (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
    setTimeout(function () { try { restoreDraft(ui); } catch (e) { /* a broken draft never blocks the page */ } }, 0);
  });

  return { open: open, openFile: openFile, close: close, save: save, revert: revert,
    get isOpen() { return E.open; }, get dirty() { return !!(E.open && dirty()); }, get state() { return st ? st.dataset.state : null; } };
})();
if (typeof module !== 'undefined') module.exports = TNC_EDITOR;
