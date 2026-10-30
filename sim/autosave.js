/* autosave drafts (#338, made by gigacook): <input|textarea data-autosave="name"> keeps what is typed in localStorage and puts it
   back when the box is drawn again (boxes drawn by JS too, and after a reload). A submit that leaves the form gone, or
   GCDraft.clear(box), drops it. Never password / payment / card boxes: mark those data-autosave-exempt="why". */
(function () {
  var P = 'gc:draft:' + (location.pathname.replace(/^.*\//, '') || 'index') + ':', ls = null;
  try { ls = window.localStorage; ls.getItem('gc:draft'); } catch (e) { ls = null; }
  function scope(el) {
    var s = el.closest('[data-autosave-scope]'), f = el.closest('form');
    return (s ? s.getAttribute('data-autosave-scope') : '') + (f ? [f.id, f.dataset.form, f.dataset.coll, f.dataset.id, f.dataset.cust, f.dataset.only].join('.') : '');
  }
  function key(el) { return P + scope(el) + ':' + (el.getAttribute('data-autosave') || el.id || el.name); }
  function save(el) {
    if (!ls) return;
    try { if (el.value === el.defaultValue) ls.removeItem(key(el)); else ls.setItem(key(el), JSON.stringify({ v: el.value, b: el.defaultValue })); } catch (e) { /* full or blocked: the text stays in the box */ }
  }
  function restore(el) {
    if (!ls) return;
    try {
      var raw = ls.getItem(key(el)); if (raw === null) return;
      var d = JSON.parse(raw);
      if (d.b === el.defaultValue) { if (el.value !== d.v) el.value = d.v; } else ls.removeItem(key(el));
    } catch (e) { /* unreadable draft: ignore */ }
  }
  function clear(el) { if (ls) try { ls.removeItem(key(el)); } catch (e) { /* ignore */ } }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches('[data-autosave]')) restore(root);
    if (root.querySelector('[data-autosave]')) root.querySelectorAll('[data-autosave]').forEach(restore);
  }
  document.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('[data-autosave]')) save(e.target); }, true);
  // a real submit: the form is gone afterwards (dialog closed, page redrawn). A refused submit keeps the form, so it keeps the text.
  window.addEventListener('submit', function (e) {
    var f = e.target, boxes = f.querySelectorAll ? [].slice.call(f.querySelectorAll('[data-autosave]')) : [];
    if (!f.isConnected) boxes.forEach(clear);
  });
  new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(scan); }); }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document.documentElement);
  window.GCDraft = { clear: clear, restore: restore, scan: scan };
})();
