/* autosave drafts (#338, made by gigacook): <input|textarea data-autosave="name"> keeps what is typed in localStorage and puts it
   back when the box is drawn again (boxes drawn by JS too, and after a reload). Only a submit that leaves the form gone, or
   GCDraft.clear(box), deletes a draft. A draft typed on an older saved value is still restored, with a note and "Use saved value".
   data-autosave-commit: after a restore, fire the box's own "change" so the app saves it too. Never password / payment / card
   boxes: mark those data-autosave-exempt="why". Keys: gc:draft:<host><path>:<form scope>:<name> (older gc:draft:<page>: keys migrate). */
(function () {
  var MAX = 1000000, ls = null, path = location.pathname.replace(/index\.html$/, '');
  var P = 'gc:draft:' + location.host + path + ':', OLD = 'gc:draft:' + (location.pathname.replace(/^.*\//, '') || 'index') + ':';
  try { ls = window.localStorage; ls.getItem('gc:draft'); } catch (e) { ls = null; }
  function scope(el) {
    var s = el.closest('[data-autosave-scope]'), f = el.closest('form');
    return (s ? s.getAttribute('data-autosave-scope') : '') + (f ? [f.id, f.dataset.form, f.dataset.coll, f.dataset.id, f.dataset.cust, f.dataset.only].join('.') : '');
  }
  function tail(el) { return scope(el) + ':' + (el.getAttribute('data-autosave') || el.id || el.name); }
  function unnote(el) { if (el.__gcn) { el.__gcn.remove(); el.__gcn = null; } }
  function note(el, text, label, fn) {
    unnote(el);
    var n = document.createElement('div'); n.setAttribute('role', 'status'); n.className = 'gc-draft-note'; n.style.cssText = 'font-size:.85em;margin:.25em 0';
    n.appendChild(document.createTextNode(text + ' '));
    if (label) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; n.appendChild(b); }
    el.insertAdjacentElement('afterend', n); el.__gcn = n;
  }
  function read(el) {   // the draft text of a box; an older-style key is moved to the new one
    if (!ls) return null;
    try {
      var k = P + tail(el), raw = ls.getItem(k);
      if (raw === null) { raw = ls.getItem(OLD + tail(el)); if (raw !== null) { ls.setItem(k, raw); ls.removeItem(OLD + tail(el)); } }
      return raw;
    } catch (e) { return null; }
  }
  function clear(el) { unnote(el); if (ls) try { ls.removeItem(P + tail(el)); ls.removeItem(OLD + tail(el)); } catch (e) { /* ignore */ } }
  function settle(el) {   // after a submit: drop this box's own draft, but not text another tab typed in the same box
    var raw = read(el), d = null; try { d = raw && JSON.parse(raw); } catch (e) { /* ignore */ }
    if (!d || d.v === el.value) clear(el);
  }
  function save(el) {
    var k = P + tail(el);
    if (el.value === el.defaultValue) { clear(el); return; }
    if (el.value.length > MAX) { try { if (ls) ls.removeItem(k); } catch (e) { /* ignore */ } note(el, 'This text is too long to keep as a draft; it stays in this box until you leave the page.'); return; }
    try { if (!ls) throw 0; ls.setItem(k, JSON.stringify({ v: el.value, b: el.defaultValue })); if (el.__gcn && !el.__gcr) unnote(el); }
    catch (e) { note(el, 'Could not keep this text as a draft (browser storage is full or off); it stays in this box until you leave the page.'); }
  }
  function restore(el) {
    var raw = read(el); if (raw === null) return;
    var d; try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d.v !== 'string') return;
    if (d.v === el.defaultValue) { clear(el); return; }
    if (el.value !== d.v) el.value = d.v;
    if (el.hasAttribute('data-autosave-commit')) { el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (d.b !== el.defaultValue) {   // typed on an older saved value: keep the text, say so, let the user take the saved one
      var saved = el.defaultValue.length > 80 ? el.defaultValue.slice(0, 80) + '...' : el.defaultValue;
      el.__gcr = true;
      note(el, 'Unsaved text restored; the saved value is now "' + saved + '".', 'Use saved value', function () { el.value = el.defaultValue; el.__gcr = false; clear(el); el.focus(); });
    }
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches('[data-autosave]')) restore(root);
    if (root.querySelector('[data-autosave]')) root.querySelectorAll('[data-autosave]').forEach(restore);
  }
  document.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('[data-autosave]')) save(e.target); }, true);
  // a real submit: the form is gone afterwards (dialog closed, page redrawn). A refused submit keeps the form, so it keeps the text.
  window.addEventListener('submit', function (e) {
    var f = e.target, boxes = f.querySelectorAll ? [].slice.call(f.querySelectorAll('[data-autosave]')) : [];
    if (!f.isConnected) boxes.forEach(settle);
  });
  new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(scan); }); }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document.documentElement);
  window.GCDraft = { clear: clear, restore: restore, scan: scan };
})();
