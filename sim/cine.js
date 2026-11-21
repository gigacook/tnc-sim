/* ==========================================================================
 * TNC 426 simulator  --  cine.js
 * Machining replay: the loaded program re-run from the start as a short film.
 *
 * Presentation only. Nothing here reaches the interpreter: the film drives the
 * simulator's own run (NC START, the run scrub, the speed) and its own camera,
 * and gives all of it back on close().
 *
 *   window.TNC_CINE = { open(o), close(), available(), playing, film(), sample(f), seek(f), debug() }
 *
 * The film is a pure function of the move list (S.segs), the blank, the vice
 * and the program text (FNV-1a hash -> the seed of every random choice):
 *   1. segmenter  every move -> air / plunge / drill / cut; consecutive moves of
 *                 one class and one tool form a run; cut runs are split into
 *                 contour / pocket / helix by path length against their extent
 *                 and by the angle they turn while Z changes.
 *   2. time remap each run gets film seconds by class (rapids fast-forward, a
 *                 plunge or a drill slow-mo, long cuts ~sqrt of their time, the
 *                 entry of a long cut slower); a monotone cubic through the knots
 *                 gives smooth speed ramps; the whole cutting part is capped.
 *   3. shots      runs grouped into shots of 2.4-6 s, cut at class changes and
 *                 tool changes; each shot type is drawn from the shot types that
 *                 suit its class (seeded), never the same type twice in a row.
 *   4. rigs       every shot type is a camera rig: f (film time) -> position,
 *                 target, fov, roll, depth of field. Camera kept out of the blank
 *                 and the vice jaws (expanded boxes), fov held in 14-65 deg.
 * Live: critically damped springs on top of the rigs, one post pass (motion
 * blur along the screen motion, depth-of-field disc around the tool, grade,
 * vignette, grain), WebAudio synthesised sound (spindle, cutting, whoosh, hits).
 * Reduced motion: no whip pans, no dolly zoom, no blur, cuts dip to black.
 * Slow frames (software rendering): fewer taps, then no post pass at all.
 *
 * Plain browser JS, no modules, a TNC_UI plugin. Exposes one global: TNC_CINE.
 * ========================================================================== */
var TNC_CINE = (function () {
  'use strict';

  /* ---------------- strings (sv / en / sr, Serbian in Latin script) ---------------- */
  var STR = {
    sv: { title: 'Bearbetningsrepris', play: 'Spela', pause: 'Paus', next: 'Nästa scen', prev: 'Föregående scen', sound: 'Ljud',
      close: 'Stäng (Esc)', scrub: 'Filmposition', again: 'Spela igen', tools: 'verktyg', machining: 'bearbetning', none: 'Inga rörelser att visa',
      establish: 'Översikt', track: 'Följer verktyget', macro: 'Makro på eggen', map: 'Kartvy ovanifrån', vertigo: 'Dolly-zoom',
      toolchange: 'Verktygsbyte', flyby: 'Förbiflygning', hero: 'Färdig detalj' },
    en: { title: 'Machining replay', play: 'Play', pause: 'Pause', next: 'Next shot', prev: 'Previous shot', sound: 'Sound',
      close: 'Close (Esc)', scrub: 'Film position', again: 'Play again', tools: 'tools', machining: 'machining', none: 'No moves to show',
      establish: 'Establishing', track: 'Tool follow', macro: 'Macro on the edge', map: 'Top-down map', vertigo: 'Dolly zoom',
      toolchange: 'Tool change', flyby: 'Fly-by', hero: 'Finished part' },
    sr: { title: 'Reprodukcija obrade', play: 'Pusti', pause: 'Pauza', next: 'Sledeći kadar', prev: 'Prethodni kadar', sound: 'Zvuk',
      close: 'Zatvori (Esc)', scrub: 'Pozicija filma', again: 'Pusti ponovo', tools: 'alata', machining: 'obrada', none: 'Nema pokreta za prikaz',
      establish: 'Uvodni kadar', track: 'Praćenje alata', macro: 'Makro na sečivu', map: 'Pogled odozgo', vertigo: 'Doli-zum',
      toolchange: 'Izmena alata', flyby: 'Prelet', hero: 'Gotov deo' }
  };
  function lang() { var l = (typeof window !== 'undefined' && window.TNC_I18N && window.TNC_I18N.lang) || 'sv'; return STR[l] ? l : 'sv'; }
  function L(k) { return STR[lang()][k] || STR.en[k] || k; }

  /* ---------------- small pure helpers ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); }   // smootherstep
  function ease3(u) { u = clamp(u, 0, 1); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function hash(str) { var h = 0x811c9dc5; str = String(str || ''); for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function pick(R, list, avoid) {                     // weighted, never `avoid` when there is anything else
    var l = list.filter(function (c) { return c[0] !== avoid; }); if (!l.length) l = list;
    var s = 0, i; for (i = 0; i < l.length; i++) s += l[i][1];
    var x = R() * s; for (i = 0; i < l.length; i++) { x -= l[i][1]; if (x <= 0) return l[i][0]; } return l[l.length - 1][0];
  }
  /* monotone cubic (Fritsch-Carlson) through (xs, ys): film time -> program time, smooth speed ramps, never backwards */
  function monotone(xs, ys) {
    var n = xs.length, d = [], m = [], k;
    if (n < 2) return function () { return ys[0] || 0; };
    for (k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (k = 0; k < n - 1; k++) {
      if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
      var a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
      if (s > 9) { var tau = 3 / Math.sqrt(s); m[k] = tau * a * d[k]; m[k + 1] = tau * b * d[k]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
      var lo = 0, hi = n - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
      var h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
    };
  }
  /* where the tool is at program time t (the same interpolation the DRO uses) */
  function toolAt(segs, t) {
    var lo = 0, hi = segs.length - 1, r = -1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (segs[m].t1 < t) lo = m + 1; else { r = m; hi = m - 1; } }
    if (r < 0) r = segs.length - 1;
    var s = segs[r], u = clamp((t - s.t0) / Math.max(1e-9, s.t1 - s.t0), 0, 1);
    return { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u, z: s.a.z + (s.b.z - s.a.z) * u, s: s, i: r };
  }

  /* ---------------- 1. segmenter ---------------- */
  function segClass(s, st) {
    if (s.kind !== 'feed' || !s.spindle || s.probe) return 'air';
    var r = +s.toolR || 0, zmin = Math.min(s.a.z, s.b.z);
    var inside = zmin < st.z1 - 1e-3 && Math.max(s.a.x, s.b.x) > st.x0 - r && Math.min(s.a.x, s.b.x) < st.x1 + r &&
      Math.max(s.a.y, s.b.y) > st.y0 - r && Math.min(s.a.y, s.b.y) < st.y1 + r;
    if (!inside) return 'air';
    if (s.cycle != null) return 'drill';
    var dz = s.b.z - s.a.z, len = Math.max(1e-9, s.len);
    if (dz < -0.05 && -dz > 0.7 * len) return 'plunge';
    if (dz > 0.05 && dz > 0.7 * len) return 'air';            // straight up out of the cut
    return 'cut';
  }
  function runsOf(segs, st) {
    var runs = [], prevTool = null;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], cls = segClass(s, st), change = prevTool != null && s.tool !== prevTool, last = runs[runs.length - 1];
      prevTool = s.tool;
      if (last && !change && last.cls === cls && last.tool === s.tool) {
        last.i1 = i; last.t1 = s.t1; grow(last, s);
      } else {
        last = { cls: cls, tool: s.tool, r: +s.toolR || 1, i0: i, i1: i, t0: s.t0, t1: s.t1, change: change,
          x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, len: 0, turn: 0, dir: null, rpm: s.sRpm || Math.abs(s.spindle || 0), f: s.f };
        grow(last, s); runs.push(last);
      }
    }
    runs.forEach(function (r) {
      if (r.cls !== 'cut') return;
      var w = r.x1 - r.x0, h = r.y1 - r.y0;
      if (r.z1 - r.z0 > Math.max(2, r.r) && r.turn > 4 * Math.PI) r.cls = 'helix';
      else if (r.len > 3 * (w + h) && Math.min(w, h) > 3 * r.r) r.cls = 'pocket';
      else r.cls = 'contour';
    });
    return runs;
  }
  function grow(r, s) {
    r.x0 = Math.min(r.x0, s.a.x, s.b.x); r.x1 = Math.max(r.x1, s.a.x, s.b.x);
    r.y0 = Math.min(r.y0, s.a.y, s.b.y); r.y1 = Math.max(r.y1, s.a.y, s.b.y);
    r.z0 = Math.min(r.z0, s.a.z, s.b.z); r.z1 = Math.max(r.z1, s.a.z, s.b.z);
    r.len += s.len || 0;
    var dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    if (Math.hypot(dx, dy) > 1e-6) { var a = Math.atan2(dy, dx);
      if (r.dir != null) { var d = a - r.dir; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; r.turn += Math.abs(d); }
      r.dir = a; }
  }

  /* ---------------- 2.+3. the film: time remap + shot list ---------------- */
  var INTRO = 4.4, CHANGE = 2.6, HERO = 10, CAP = 62, MIN_SHOT = 2.4, MAX_SHOT = 6, WHIP = 0.42, DIP = 0.5;
  var CUTKIND = { contour: 1, pocket: 1, helix: 1 };
  var CHOICES = {
    contour: [['macro', 4], ['track', 4], ['map', 1], ['flyby', 1]],
    pocket: [['map', 5], ['track', 3], ['macro', 2]],
    helix: [['vertigo', 3], ['track', 4], ['macro', 3]],
    plunge: [['vertigo', 6], ['track', 3], ['macro', 1]],
    drill: [['vertigo', 5], ['track', 4], ['map', 2]],
    air: [['flyby', 3], ['track', 1]]
  };
  function plan(inp) {
    var segs = inp.segs || [], st = inp.stock, reduced = !!inp.reduced, seed = hash(inp.text || ''), R = rng(seed ^ 0x9e3779b9);
    var total = segs.length ? segs[segs.length - 1].t1 : 0;
    var runs = runsOf(segs, st);
    /* film seconds per run */
    var firstWork = runs.findIndex(function (r) { return r.cls !== 'air'; }); if (firstWork < 0) firstWork = runs.length;
    var introDt = 0, i, r;
    for (i = 0; i < firstWork; i++) introDt += runs[i].t1 - runs[i].t0;
    var flex = 0;
    runs.forEach(function (r, i) {
      var dt = r.t1 - r.t0;
      if (i < firstWork) { r.F = introDt > 0 ? INTRO * dt / introDt : (i === 0 ? INTRO : 0); r.fixed = true; return; }
      if (r.change) { r.F = Math.max(CHANGE, dt / 28); r.fixed = true; return; }
      if (r.cls === 'air') r.F = Math.min(1, dt / 28);
      else if (r.cls === 'plunge') r.F = clamp(dt / 0.7, Math.min(0.45, dt / 0.7), 3);
      else if (r.cls === 'drill') r.F = clamp(dt / 0.9, Math.min(0.5, dt / 0.9), 2.6);
      else r.F = clamp(1.5 * Math.sqrt(dt), Math.min(0.35, dt / 0.3), 11);
      flex += r.F;
    });
    if (flex > CAP) { var k = CAP / flex; runs.forEach(function (r) { if (!r.fixed) r.F *= k; }); }
    if (!runs.length) runs.push({ cls: 'air', tool: 0, r: 3, t0: 0, t1: 0, F: INTRO, fixed: true, x0: st.x0, x1: st.x1, y0: st.y0, y1: st.y1, z0: st.z1, z1: st.z1, len: 0 });
    /* knots */
    var fx = [0], ty = [0], f = 0;
    function knot(ff, tt) { if (ff - fx[fx.length - 1] < 1e-6) { ty[ty.length - 1] = Math.max(ty[ty.length - 1], tt); return; } fx.push(ff); ty.push(tt); }
    runs.forEach(function (r) {
      r.f0 = f; var dt = r.t1 - r.t0;
      if (CUTKIND[r.cls] && r.F > 1.4) knot(f + 0.3 * r.F, r.t0 + 0.13 * dt);   // the entry of a long cut slower
      f += r.F; r.f1 = f; knot(f, r.t1);
    });
    var progEnd = f, P = monotone(fx, ty);
    /* shots over the runs */
    var shots = [], cur = null;
    function famOf(r) { return r.cls; }
    function open_(r, i) { cur = { f0: r.f0, f1: r.f1, runs: [i], fam: {}, tool: r.tool, r: r.r }; if (r.cls !== 'air') cur.fam[r.cls] = r.F; }
    function close_() {
      if (!cur) return;
      var best = 'air', bf = 0, k;
      for (k in cur.fam) if (cur.fam[k] > bf) { bf = cur.fam[k]; best = k; }
      ['plunge', 'drill', 'helix'].forEach(function (q) { if (cur.fam[q] && cur.fam[q] > 0.25 * (cur.f1 - cur.f0) && best !== 'pocket') best = q; });
      cur.cls = best; shots.push(cur); cur = null;
    }
    shots.push({ type: 'establish', f0: 0, f1: firstWork > 0 ? runs[firstWork - 1].f1 : INTRO, runs: [], cls: 'intro', tool: runs[0].tool, r: runs[0].r });
    for (i = firstWork; i < runs.length; i++) {
      r = runs[i];
      if (r.change) { close_(); shots.push({ type: 'toolchange', f0: r.f0, f1: r.f1, runs: [i], cls: 'change', tool: r.tool, r: r.r }); continue; }
      if (!cur) { open_(r, i); continue; }
      var dur = cur.f1 - cur.f0, fam = famOf(r), has = Object.keys(cur.fam);
      var same = fam === 'air' || !has.length || cur.fam[fam] != null;
      if ((same || dur < MIN_SHOT) && dur + r.F <= MAX_SHOT) { cur.f1 = r.f1; cur.runs.push(i); if (fam !== 'air') cur.fam[fam] = (cur.fam[fam] || 0) + r.F; }
      else if (fam === 'air' && r.F < 0.6) { cur.f1 = r.f1; cur.runs.push(i); }
      else { close_(); open_(r, i); }
    }
    close_();
    /* a too-short last shot of a tool folds into the one before; a long one splits */
    var out = [];
    shots.forEach(function (s) {
      var prev = out[out.length - 1];
      if (s.type == null && s.f1 - s.f0 < MIN_SHOT * 0.6 && prev && prev.type == null) { prev.f1 = s.f1; prev.runs = prev.runs.concat(s.runs); return; }
      var d = s.f1 - s.f0;
      if (s.type == null && d > MAX_SHOT) {
        var n = Math.ceil(d / 4.8), k;
        for (k = 0; k < n; k++) out.push(Object.assign({}, s, { f0: s.f0 + d * k / n, f1: s.f0 + d * (k + 1) / n, piece: k }));
      } else out.push(s);
    });
    shots = out;
    /* never fewer than two middle shots: the finished part gets a map and a fly-by before the orbit */
    var mid = shots.filter(function (s) { return s.type !== 'establish'; }).length;
    var tail = progEnd;
    if (mid < 2) {
      ['map', 'flyby'].slice(0, 2 - mid).forEach(function (t) { shots.push({ type: t, f0: tail, f1: tail + 3.2, runs: [], cls: 'post', tool: runs[runs.length - 1].tool, r: runs[runs.length - 1].r }); tail += 3.2; });
    }
    /* types */
    var prevType = 'establish';
    shots.forEach(function (s) {
      if (!s.type) {
        var list = CHOICES[s.cls] || CHOICES.contour;
        if (reduced) list = list.filter(function (c) { return c[0] !== 'vertigo'; });
        s.type = pick(R, list, prevType);
      }
      prevType = s.type;
    });
    var used = {}; shots.forEach(function (s) { used[s.type] = 1; });
    if (Object.keys(used).length < 3) {                  // + the hero = 4: give the longest middle shot an unused type
      var cand = shots.filter(function (s) { return s.type !== 'establish' && s.type !== 'toolchange'; }).sort(function (a, b) { return (b.f1 - b.f0) - (a.f1 - a.f0); })[0];
      var free = ['track', 'macro', 'map', 'flyby'].filter(function (t) { return !used[t]; });
      if (cand && free.length) cand.type = free[Math.floor(R() * free.length)];
    }
    shots.push({ type: 'hero', f0: tail, f1: tail + HERO, runs: [], cls: 'hero', tool: runs[runs.length - 1].tool, r: runs[runs.length - 1].r });
    /* per-shot parameters + transitions */
    var span = Math.max(st.x1 - st.x0, st.y1 - st.y0, 40);
    shots.forEach(function (s, k) {
      s.az = R() * Math.PI * 2; s.side = R() < 0.5 ? -1 : 1; s.sign = R() < 0.5 ? -1 : 1; s.k = k;
      s.trans = k === 0 ? 'fade' : (reduced ? 'dip' : (s.type === 'hero' || R() < 0.4 ? 'whip' : 'cut'));
      if (k === 1 && !reduced) s.trans = 'cut';
      var bx = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, plungeF = null;
      s.runs.forEach(function (ri) { var q = runs[ri]; if (q.cls === 'air') return;
        bx.x0 = Math.min(bx.x0, q.x0 - q.r); bx.x1 = Math.max(bx.x1, q.x1 + q.r); bx.y0 = Math.min(bx.y0, q.y0 - q.r); bx.y1 = Math.max(bx.y1, q.y1 + q.r);
        if (plungeF == null && (q.cls === 'plunge' || q.cls === 'drill' || q.cls === 'helix')) plungeF = Math.max(s.f0, q.f0); });
      if (!isFinite(bx.x0)) bx = { x0: st.x0, y0: st.y0, x1: st.x1, y1: st.y1 };
      s.box = { x0: Math.max(st.x0 - span * 0.1, bx.x0), x1: Math.min(st.x1 + span * 0.1, bx.x1), y0: Math.max(st.y0 - span * 0.1, bx.y0), y1: Math.min(st.y1 + span * 0.1, bx.y1) };
      s.plungeF = plungeF;
      delete s.fam;
    });
    var len = shots[shots.length - 1].f1;
    return { seed: seed, shots: shots, runs: runs.length, len: len, progEnd: progEnd, total: total, P: function (ff) { return ff >= progEnd ? total : clamp(P(ff), 0, total); },
      tools: Array.from(new Set(segs.map(function (s) { return s.tool; }))).filter(function (t) { return t; }).length };
  }
  function shotAt(film, f) { var sh = film.shots; for (var i = sh.length - 1; i >= 0; i--) if (f >= sh[i].f0 - 1e-9) return i; return 0; }

  /* ---------------- 4. rigs: (film, shot, f) -> camera ---------------- */
  /* ctx: { segs, st, boxes (keep-out, program coords), aspect, band (visible band / canvas height), dT (live: S.t - P(f)) } */
  function V3(x, y, z) { return { x: x, y: y, z: z }; }
  function add(a, b, k) { k = k == null ? 1 : k; return V3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k); }
  function sub(a, b) { return V3(a.x - b.x, a.y - b.y, a.z - b.z); }
  function len3(a) { return Math.hypot(a.x, a.y, a.z); }
  function norm(a) { var l = len3(a) || 1; return V3(a.x / l, a.y / l, a.z / l); }
  function cross(a, b) { return V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  function vlerp(a, b, u) { return V3(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u)); }
  function dirH(az) { return V3(Math.cos(az), Math.sin(az), 0); }
  var DEG = Math.PI / 180;

  /* the subject at shot point (sx, sy) of the visible frame: rule of thirds without moving the camera */
  function aim(pos, subj, sx, sy, fov, ctx) {
    var fw = sub(subj, pos), d = len3(fw); fw = norm(fw);
    var rt = cross(fw, V3(0, 0, 1)); if (len3(rt) < 1e-6) rt = V3(1, 0, 0); rt = norm(rt);
    var up = cross(rt, fw), tv = Math.tan(fov * DEG / 2), th = tv * (ctx.aspect || 1.78);
    return add(add(subj, rt, -sx * th * d), up, -sy * tv * (ctx.band || 1) * d);
  }
  function keepOut(p, ctx, tip) {
    var q = V3(p.x, p.y, p.z), m = ctx.margin;
    for (var it = 0; it < 4; it++) {
      var moved = false;
      ctx.boxes.forEach(function (b) {
        if (q.x > b.x0 - m && q.x < b.x1 + m && q.y > b.y0 - m && q.y < b.y1 + m && q.z > b.z0 - m && q.z < b.z1 + m) {
          var c = [[(q.x - (b.x0 - m)), 'x', b.x0 - m - 0.01], [((b.x1 + m) - q.x), 'x', b.x1 + m + 0.01],
            [(q.y - (b.y0 - m)), 'y', b.y0 - m - 0.01], [((b.y1 + m) - q.y), 'y', b.y1 + m + 0.01], [((b.z1 + m) - q.z) * 0.8, 'z', b.z1 + m + 0.01]];
          c.sort(function (a, b) { return a[0] - b[0]; }); q[c[0][1]] = c[0][2]; moved = true;
        }
      });
      if (!moved) break;
    }
    if (tip) {                                            // not inside the cutter or the holder
      var dx = q.x - tip.x, dy = q.y - tip.y, h = Math.hypot(dx, dy), L = tip.L || 80;
      var need = q.z > tip.z + L * 0.85 ? 70 : (q.z > tip.z - 2 ? Math.max(tip.r * 2.2, 10) + 6 : 0);
      if (need && h < need) { if (h < 1e-6) { dx = 1; dy = 0; h = 1; } q.x = tip.x + dx / h * need; q.y = tip.y + dy / h * need; }
    }
    return q;
  }
  function tipF(film, ctx, f) {
    var t = clamp(film.P(f) + (ctx.dT || 0), 0, film.total), p = ctx.segs.length ? toolAt(ctx.segs, t) : { x: 0, y: 0, z: ctx.st.z1 + 50, s: null };
    var s = p.s; return { x: p.x, y: p.y, z: p.z, r: s ? (+s.toolR || 3) : 3, L: s ? (+s.toolL || 80) : 80, stick: s ? (+s.stick || 0) : 0, s: s };
  }
  function smoothTip(film, ctx, f, w, lagW) {             // average over the film window: smooth, slightly behind
    var ks = [-1, -0.66, -0.33, 0, 0.33], ws = [0.6, 0.8, 1, 1, lagW == null ? 0.6 : lagW], o = V3(0, 0, 0), s = 0, last = null;
    for (var i = 0; i < ks.length; i++) { var p = tipF(film, ctx, f + ks[i] * w); o.x += p.x * ws[i]; o.y += p.y * ws[i]; o.z += p.z * ws[i]; s += ws[i]; if (ks[i] === 0) last = p; }
    o.x /= s; o.y /= s; o.z /= s; o.r = last.r; o.L = last.L; o.stick = last.stick; o.now = last; return o;
  }
  function sph(az, el) { return V3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)); }
  /* the angle to look down into the cut: the tool's depth below the top against how open the worked area is round it */
  function needEl(subj, sh, st) {
    var dep = st.z1 - subj.z; if (dep <= 0.5) return 0;
    var B = sh.box, open = Math.max(Math.min(B.x1 - B.x0, B.y1 - B.y0) / 2 - (subj.r || 3) * 0.5, (subj.r || 3) * 1.5);
    return Math.atan2(dep, open);
  }
  /* the camera sees the cutting edge under the holder: the line from the camera to the tip passes below the ER nut
     (R 27 from tip + max(stick, L/4)) and below the flange (R 52 from tip + L - 30). Too high: lower it; lower than
     minZ (out of the blank) allows: move out sideways until it does. */
  function underHolder(p, tip, minZ) {
    var hb = Math.max(+tip.stick || 0, (tip.L || 80) * 0.25), hf = Math.max(hb + 10, (tip.L || 80) - 30);
    var dx = p.x - tip.x, dy = p.y - tip.y, h = Math.hypot(dx, dy); if (h < 1e-6) { dx = 1; dy = 0; h = 1; }
    var need = Math.max((minZ - tip.z) * 27 / (hb * 0.9), (minZ - tip.z) * 52 / (hf * 0.9), 0);
    if (h < need) { var k = need / h; dx *= k; dy *= k; h = need; }
    var cap = tip.z + Math.min(hb * 0.9 * Math.max(1, h / 27), hf * 0.9 * Math.max(1, h / 52));
    return V3(tip.x + dx, tip.y + dy, clamp(p.z, minZ, Math.max(minZ, cap)));
  }
  /* the tool deep in a hole the camera cannot look into (held under the holder): frame the mouth of the hole instead */
  function mouth(p, subj, sh, st) {
    if (subj.z > st.z1 - 1) return subj;
    var h = Math.hypot(p.x - subj.x, p.y - subj.y), el = Math.atan2(p.z - subj.z, Math.max(1e-6, h));
    if (el >= needEl(subj, sh, st) - 2 * DEG) return subj;
    return V3(subj.x, subj.y, st.z1 + (subj.r || 3) * 0.5);
  }
  function stockInfo(st) {
    var w = st.x1 - st.x0, h = st.y1 - st.y0, d = st.z1 - st.z0;
    return { c: V3((st.x0 + st.x1) / 2, (st.y0 + st.y1) / 2, (st.z0 + st.z1) / 2), top: st.z1, span: Math.max(w, h, 40), diag: Math.hypot(w, h, d) };
  }
  function pose(film, sh, f, ctx) {
    var st = ctx.st, I = stockInfo(st), u = clamp((f - sh.f0) / Math.max(1e-6, sh.f1 - sh.f0), 0, 1), e = smooth(u);
    var o = { fov: 36, roll: 0, up: null, dof: 0.12, focusR: 0.22, st: 0.3, focus: null }, p, t, subj, d;
    switch (sh.type) {
      case 'establish': {
        var az = -Math.PI / 2 + (sh.az - Math.PI) * 0.35;      // from the operator's side, seeded a little round
        var a0 = az - sh.side * 0.5, a1 = az + sh.side * 0.35, el0 = 32 * DEG, el1 = 14 * DEG;
        var D0 = I.span * 3.6 + 160, D1 = I.span * 1.6 + 50, azE = lerp(a0, a1, e), elE = lerp(el0, el1, e), DE = lerp(D0, D1, e);
        subj = tipF(film, ctx, f);
        t = vlerp(V3(I.c.x, I.c.y, st.z0), vlerp(V3(I.c.x, I.c.y, I.top), V3(subj.x, subj.y, Math.min(subj.z, I.top + 20)), 0.25), e);
        p = add(t, sph(azE, elE), DE);
        o.fov = lerp(46, 36, e); o.st = 0.12; o.dof = 0; o.focus = t; o.roll = lerp(sh.side * 4, 0, e) * DEG;
        break;
      }
      case 'track': {
        subj = smoothTip(film, ctx, f, 0.7);
        d = clamp(subj.r * 11, 60, I.span * 0.7 + 50);
        var a2 = sh.az + sh.sign * 0.4 * (u - 0.5), el2 = clamp(Math.max(14 * DEG, needEl(subj, sh, st) + 6 * DEG), 0, 70 * DEG);
        p = underHolder(add(subj, sph(a2, el2), d), subj, I.top + 5 + subj.r);
        o.fov = 32; t = aim(p, mouth(p, subj, sh, st), sh.side * 0.3, -0.12, o.fov, ctx); o.focus = subj.now; o.dof = 0.35; o.focusR = 0.2; o.st = 0.35;
        break;
      }
      case 'macro': {
        subj = smoothTip(film, ctx, f, 0.5, 1);
        var a = tipF(film, ctx, f - 0.8), b = tipF(film, ctx, f + 0.8), mv = Math.atan2(b.y - a.y, b.x - a.x);
        var az3 = Math.hypot(b.x - a.x, b.y - a.y) > 0.5 ? mv + sh.side * 62 * DEG : sh.az;
        var el3 = clamp(Math.max(17 * DEG, needEl(subj, sh, st) + 5 * DEG), 0, 72 * DEG);
        d = clamp(subj.r * 5 + 16, 26, 60);
        p = underHolder(add(subj, sph(az3, el3), d), subj, I.top + subj.r * 0.6 + 3);
        var aimAt = add(subj.now, V3(0, 0, subj.r * 0.6));
        o.fov = 26; t = aim(p, mouth(p, aimAt, sh, st), sh.side * -0.12, -0.05, o.fov, ctx); o.focus = subj.now; o.dof = 1; o.focusR = 0.1; o.st = 0.4;
        break;
      }
      case 'map': {                                     // high and steep over the area the shot works in, a slow sweep and turn
        var B = sh.box, cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, ex = Math.max(B.x1 - B.x0, 40), ey = Math.max(B.y1 - B.y0, 40);
        o.fov = 24;
        var tv = Math.tan(o.fov * DEG / 2), fit = Math.max(ey / 2 / (tv * (ctx.band || 1)), ex / 2 / (tv * (ctx.aspect || 1.78)));
        var along = ex >= ey ? V3(1, 0, 0) : V3(0, 1, 0), sw = (ex >= ey ? ex : ey) * 0.12 * sh.sign;
        t = V3(cx + along.x * lerp(-sw, sw, e), cy + along.y * lerp(-sw, sw, e), I.top);
        var t0 = tipF(film, ctx, sh.f0 + 0.2), away = Math.hypot(cx - t0.x, cy - t0.y) > Math.min(ex, ey) * 0.15 ? Math.atan2(cy - t0.y, cx - t0.x) : sh.az;
        var azm = away + sh.sign * lerp(-14, 14, e) * DEG;
        p = add(t, sph(azm, 52 * DEG), fit * 1.5 * lerp(1.04, 0.94, e) + 40);
        o.focus = tipF(film, ctx, f); o.dof = 0.7; o.focusR = 0.18; o.st = 0.6;
        break;
      }
      case 'vertigo': {
        subj = tipF(film, ctx, f);
        var W = clamp(subj.r * 9, 40, 110), uu = sh.plungeF != null ? clamp((f - Math.max(sh.f0, sh.plungeF - 0.6)) / Math.min(3.6, sh.f1 - sh.f0), 0, 1) : u;
        var ev = ease3(uu);
        o.fov = sh.sign > 0 ? lerp(20, 56, ev) : lerp(56, 20, ev);
        d = W / (2 * Math.tan(o.fov * DEG / 2));
        var fixedXY = smoothTip(film, ctx, f, 0.4), el = clamp(Math.max(13 * DEG, needEl(fixedXY, sh, st) + 4 * DEG), 0, 65 * DEG);
        var s0 = V3(fixedXY.x, fixedXY.y, subj.z + subj.r * 0.5);
        var elMax = Math.atan2(Math.max(+subj.stick || 0, subj.L * 0.25) * 0.9, 27);
        if (d * Math.cos(el) > 27) elMax = Math.max(elMax, Math.atan2(Math.max(+subj.stick || 0, subj.L * 0.25) * 0.9 * d * Math.cos(el) / 27, d * Math.cos(el)) * 0.999);
        p = add(s0, sph(sh.az, Math.min(el, Math.max(elMax, 8 * DEG))), d); p.z = Math.max(p.z, I.top + 4); t = s0; o.focus = subj; o.dof = 0.45; o.focusR = 0.14; o.st = 0.05;
        break;
      }
      case 'toolchange': {
        subj = smoothTip(film, ctx, f, 0.6);               // the new tool, whole: cutter low in the frame, holder above
        var Hs = subj.L + 110, H = V3(subj.x, subj.y, subj.z + Hs * 0.42);   // cutter + holder below the spindle face
        o.fov = 30;
        var dd = Hs * 1.25 / (2 * Math.tan(o.fov * DEG / 2) * (ctx.band || 1)) * lerp(1.1, 0.9, e);
        p = add(H, sph(sh.az, -4 * DEG), dd); p.z = Math.max(I.top + 10, p.z); t = aim(p, H, sh.side * 0.2, 0.05, o.fov, ctx); o.roll = lerp(sh.side * 5, 0, e) * DEG; o.focus = subj.now; o.dof = 0.3; o.focusR = 0.3; o.st = 0.3;
        break;
      }
      case 'flyby': {
        subj = smoothTip(film, ctx, f, 0.5);
        if (sh.cls === 'post') subj = V3(I.c.x, I.c.y, I.top);
        d = clamp(I.span * 0.55, 70, 220);
        var tang = dirH(sh.az + Math.PI / 2);
        p = add(add(subj, sph(sh.az, clamp(Math.max(21 * DEG, needEl(subj, sh, st) + 5 * DEG), 0, 65 * DEG)), d), tang, lerp(-0.7, 0.7, e) * d * sh.sign);
        if (sh.cls !== 'post') { var tp = tipF(film, ctx, f); p = underHolder(p, tp, I.top + 12); } else p.z = Math.max(p.z, I.top + 12);
        o.fov = 40; t = aim(p, subj, 0, -0.05, o.fov, ctx); o.focus = subj; o.dof = 0.2; o.st = 0.18;
        break;
      }
      default: {                                          // hero: one full turn round the finished part
        o.fov = 30;
        var Rr = (I.diag * 0.5) / Math.sin(o.fov * DEG / 2 * Math.min(1, ctx.band || 1)) * 0.86 * lerp(1.1, 0.96, smooth(u));
        var azh = sh.az + sh.sign * Math.PI * 2 * (0.5 - 0.5 * Math.cos(Math.PI * u)), elh = (26 + 8 * Math.sin(Math.PI * u)) * DEG;
        var tc = V3(I.c.x, I.c.y, lerp(I.c.z, I.top, 0.5));
        p = add(tc, V3(Math.cos(azh) * Math.cos(elh), Math.sin(azh) * Math.cos(elh), Math.sin(elh)), Rr); t = tc;
        o.focus = tc; o.dof = 0; o.st = 0.15; o.hero = true;
      }
    }
    var tip = tipF(film, ctx, f);
    o.p = keepOut(p, ctx, sh.type === 'hero' ? null : tip); o.t = t;
    o.fov = clamp(o.fov, 14, 65);
    return o;
  }
  /* the pose at film time f, with the transition into the shot (whip pan / dip) */
  function poseAt(film, f, ctx) {
    var i = shotAt(film, f), sh = film.shots[i], o = pose(film, sh, f, ctx), w = f - sh.f0;
    o.shot = i; o.type = sh.type; o.blurBoost = 0; o.fade = 0;
    if (sh.trans === 'whip' && i > 0 && w < WHIP) {
      var A = pose(film, film.shots[i - 1], f, ctx), q = w / WHIP, k = ease3(q), sgn = sh.sign;
      var src = q < 0.5 ? A : o, kk = q < 0.5 ? k : (1 - k);  // swing out of A, swing into B: the jump is hidden in the blur
      var yaw = sgn * 75 * DEG * kk, fw = sub(src.t, src.p), dist = len3(fw);
      var c = Math.cos(yaw), s = Math.sin(yaw), r = V3(fw.x * c - fw.y * s, fw.x * s + fw.y * c, fw.z);
      o = Object.assign({}, src, { p: src.p, t: add(src.p, norm(r), dist), shot: i, type: sh.type, blurBoost: Math.sin(Math.PI * q), whip: true, fade: 0 });
    } else if ((sh.trans === 'dip' || sh.trans === 'fade') && w < (sh.trans === 'fade' ? 1 : DIP)) {
      o.fade = 1 - w / (sh.trans === 'fade' ? 1 : DIP);
    }
    var nxt = film.shots[i + 1];
    if (nxt && nxt.trans === 'dip' && nxt.f0 - f < DIP) o.fade = Math.max(o.fade, 1 - (nxt.f0 - f) / DIP);
    return o;
  }

  var api = { open: function () { return false; }, close: function () {}, available: function () { return false; }, get playing() { return false; },
    _pure: { plan: plan, runsOf: runsOf, hash: hash, monotone: monotone } };

  if (typeof window === 'undefined') return api;

  (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
    var THREE = ui.THREE, renderer = ui.renderer, scene = ui.scene, camera = ui.camera, controls = ui.controls;
    var partRoot = null, rigOn = false, ready = false;
    ui.on('scene', function (e) { partRoot = e.partRoot; rigOn = !!e.rig; if (C) close(); });
    ui.on('ready', function () { ready = true; });

    /* ---------- CSS (page tokens, so it fits every theme) ---------- */
    var css = '' +
      '.cine{position:absolute;inset:0;z-index:60;pointer-events:none;font-family:var(--gc-font-sans,system-ui,sans-serif);color:var(--gc-ink,#f5f5f7)}' +
      '.cine *{box-sizing:border-box}' +
      '.cine-bar{position:absolute;left:0;right:0;background:#000;pointer-events:auto}' +
      '.cine-bar.t{top:0}.cine-bar.b{bottom:0}' +
      '.cine-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}' +
      '.cine-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;mix-blend-mode:screen}' +
      '.cine-ttl{position:absolute;left:0;right:0;text-align:center;letter-spacing:.42em;text-transform:uppercase;font-weight:300;opacity:0;transition:opacity .8s var(--gc-ease,ease);pointer-events:none;text-shadow:0 1px 12px rgb(0 0 0/.7)}' +
      '.cine-ttl b{display:block;font-weight:600;letter-spacing:.3em;font-size:1.5em;margin-bottom:.35em}' +
      '.cine-ttl small{display:block;font-size:.72em;color:var(--gc-ink-2,#d1d1d6);letter-spacing:.3em}' +
      '.cine-lbl{position:absolute;left:18px;font:500 10px/1 var(--gc-font-mono,monospace);letter-spacing:.24em;text-transform:uppercase;color:var(--gc-ink-2,#d1d1d6);opacity:.85;pointer-events:none;white-space:nowrap}' +
      '.cine-lbl i{font-style:normal;color:var(--gc-accent,#2997ff);margin-right:.8em}' +
      '.cine-strip{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:6px 12px;pointer-events:auto;' +
        'background:linear-gradient(transparent,rgb(0 0 0/.55));opacity:.92;transition:opacity .3s}' +
      '.cine-strip button{min-width:32px;height:32px;padding:0 8px;border:1px solid color-mix(in srgb,var(--gc-ink,#fff) 22%,transparent);border-radius:var(--gc-radius-btn,2px);' +
        'background:color-mix(in srgb,var(--gc-surface,#141416) 70%,transparent);color:var(--gc-ink,#f5f5f7);font:600 12px/1 var(--gc-font-sans,system-ui);cursor:pointer}' +
      '.cine-strip button:hover{background:var(--gc-hover,#1c1c1f)}' +
      '.cine-strip button:focus-visible{outline:2px solid var(--gc-focus,#2997ff);outline-offset:1px}' +
      '.cine-strip button[aria-pressed=false]{color:var(--gc-muted,#98989d)}' +
      '.cine-strip input[type=range]{flex:1;min-width:60px;accent-color:var(--gc-accent,#2997ff);height:24px}' +
      '.cine-strip .tm{font:500 11px/1 var(--gc-font-mono,monospace);color:var(--gc-ink-2,#d1d1d6);min-width:86px;text-align:right}' +
      '.cine-ticks{position:absolute;left:0;right:0;height:3px;pointer-events:none}' +
      '.cine-host-on>:not(canvas):not(.cine){visibility:hidden!important}' +
      '@media (prefers-reduced-motion:reduce){.cine-ttl{transition:none}}';
    var styleEl = document.createElement('style'); styleEl.textContent = css; document.head.appendChild(styleEl);

    /* ---------- state of an open film ---------- */
    var C = null;           // null = closed
    var REDUCED = false;

    function ctxLive() {
      var S = ui.state, st = S.res.stock, el = renderer.domElement, w = el.clientWidth || 16, h = el.clientHeight || 9;
      var boxes = [{ x0: st.x0, y0: st.y0, z0: st.z0, x1: st.x1, y1: st.y1, z1: st.z1 }];
      try { if (window.TNC_STOCK && TNC_STOCK.VICE.on && S.vice !== false) boxes = boxes.concat(TNC_STOCK.vice(st)); } catch (e) {}
      var span = Math.max(st.x1 - st.x0, st.y1 - st.y0, 40);
      return { segs: S.segs, st: st, boxes: boxes, margin: 4 + span * 0.02, aspect: w / h, band: Math.min(1, (w / 2.39) / h) };
    }
    function filmFor() {
      var S = ui.state; if (!S || !S.res) return null;
      var rm = false; try { rm = !!(window.TNC_SETTINGS && TNC_SETTINGS.reducedMotion()); } catch (e) {}
      return plan({ segs: S.segs, stock: S.res.stock, text: S.text, reduced: rm });
    }

    /* ---------- the program run, driven through the simulator's own controls ---------- */
    var scrubEl = function () { return document.getElementById('scrub'); };
    function jumpProg(t) {                                // the run scrub, with step=any so the time is exact
      var S = ui.state, sc = scrubEl(); if (!sc || !(S.total > 0)) return;
      var step = sc.getAttribute('step');
      sc.setAttribute('step', 'any'); sc.value = String(clamp(t, 0, S.total) / S.total * 1000);
      sc.dispatchEvent(new Event('input', { bubbles: true }));
      if (step == null) sc.removeAttribute('step'); else sc.setAttribute('step', step);
    }
    function progStart() { var S = ui.state; if (S.t >= S.total - 1e-6) return; if (S.mode === 'edit' || S.mode === 'single') S.mode = 'test'; ui.exec('start'); }

    /* ---------- post: one pass (blur along the screen motion + depth of field disc + grade + vignette + grain) ---------- */
    var CineShader = {
      uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uBlur: { value: new THREE.Vector2(0, 0) },
        uFocus: { value: new THREE.Vector2(0.5, 0.5) }, uDof: { value: 0 }, uFocusR: { value: 0.2 }, uTaps: { value: 12 },
        uVig: { value: 0.42 }, uGrain: { value: 0.035 }, uTime: { value: 0 }, uBand: { value: 1 }, uGrade: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform vec2 uRes; uniform vec2 uBlur; uniform vec2 uFocus; uniform float uDof; uniform float uFocusR;',
        'uniform float uTaps; uniform float uVig; uniform float uGrain; uniform float uTime; uniform float uBand; uniform float uGrade; varying vec2 vUv;',
        'float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }',
        'void main(){',
        '  vec2 d=vUv-uFocus; d.x*=uRes.x/uRes.y; float coc=uDof*smoothstep(uFocusR,uFocusR+0.38,length(d))*0.011;',
        '  vec3 c=vec3(0.0); float n=0.0;',
        '  for(int i=0;i<12;i++){ float fi=float(i); if(fi>=uTaps) break;',
        '    float t=uTaps>1.0?fi/(uTaps-1.0)-0.5:0.0; float a=fi*2.39996; float r=sqrt((fi+0.5)/uTaps);',
        '    vec2 o=uBlur*t+coc*r*vec2(cos(a),sin(a)*uRes.x/uRes.y);',
        '    c+=texture2D(tDiffuse,vUv+o).rgb; n+=1.0; }',
        '  c/=max(n,1.0);',
        '  float l=dot(c,vec3(0.299,0.587,0.114));',
        '  vec3 g=mix(c*vec3(0.9,1.0,1.1),c*vec3(1.07,1.0,0.92),smoothstep(0.15,0.8,l));',     // teal shadows, warm highlights
        '  g=mix(g,g*g*(3.0-2.0*g),0.35);',                                                         // a little contrast
        '  c=mix(c,g,uGrade);',
        '  vec2 v=(vUv-0.5)*vec2(1.0,1.0/max(uBand,0.2)); c*=1.0-uVig*smoothstep(0.32,0.78,length(v));',
        '  c+=(h(vUv*uRes+uTime)-0.5)*uGrain;',
        '  gl_FragColor=vec4(c,1.0);',
        '}'].join('\n')
    };
    function buildComposer() {
      try {
        if (!(THREE.EffectComposer && THREE.RenderPass && THREE.ShaderPass)) return null;
        var comp = new THREE.EffectComposer(renderer);
        comp.addPass(new THREE.RenderPass(scene, camera));
        if (THREE.OutputPass) comp.addPass(new THREE.OutputPass());
        var pass = new THREE.ShaderPass(CineShader); comp.addPass(pass);
        sizeComposer(comp);
        return { comp: comp, pass: pass };
      } catch (e) { return null; }
    }
    function sizeComposer(comp) {
      var v = new THREE.Vector2(); renderer.getSize(v);
      try { comp.setPixelRatio(renderer.getPixelRatio()); comp.setSize(Math.max(1, v.x), Math.max(1, v.y)); } catch (e) {}
    }

    /* ---------- sound: WebAudio, synthesised, created only when the sound is on ---------- */
    function noiseBuf(ac, sec) { var n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0), x = 22222;
      for (var i = 0; i < n; i++) { x = (x * 16807) % 2147483647; d[i] = x / 1073741823.5 - 1; } return b; }   // seeded: the same noise every time
    function makeAudio() {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try {
        var ac = new AC(), A = { ac: ac };
        A.master = ac.createGain(); A.master.gain.value = 0;
        var comp = ac.createDynamicsCompressor(); A.master.connect(comp); comp.connect(ac.destination);
        A.nb = noiseBuf(ac, 2);
        /* spindle whine: saw + sine an octave up, low-passed */
        A.sp = ac.createGain(); A.sp.gain.value = 0;
        var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(A.sp); A.sp.connect(A.master);
        A.o1 = ac.createOscillator(); A.o1.type = 'sawtooth'; A.o2 = ac.createOscillator(); A.o2.type = 'sine';
        var g1 = ac.createGain(); g1.gain.value = 0.35; var g2 = ac.createGain(); g2.gain.value = 0.6;
        A.o1.connect(g1); g1.connect(lp); A.o2.connect(g2); g2.connect(lp); A.o1.start(); A.o2.start();
        /* cutting noise: band-passed noise, amplitude-modulated at the tooth-pass frequency */
        A.cut = ac.createGain(); A.cut.gain.value = 0;
        var src = ac.createBufferSource(); src.buffer = A.nb; src.loop = true;
        A.bp = ac.createBiquadFilter(); A.bp.type = 'bandpass'; A.bp.Q.value = 1.1; A.bp.frequency.value = 2200;
        var am = ac.createGain(); am.gain.value = 0.7; A.lfo = ac.createOscillator(); A.lfo.frequency.value = 160; var lg = ac.createGain(); lg.gain.value = 0.3;
        A.lfo.connect(lg); lg.connect(am.gain); src.connect(A.bp); A.bp.connect(am); am.connect(A.cut); A.cut.connect(A.master); src.start(); A.lfo.start();
        /* rapid traverse: low rush */
        A.air = ac.createGain(); A.air.gain.value = 0; var s2 = ac.createBufferSource(); s2.buffer = A.nb; s2.loop = true; s2.playbackRate.value = 0.7;
        var alp = ac.createBiquadFilter(); alp.type = 'lowpass'; alp.frequency.value = 520; s2.connect(alp); alp.connect(A.air); A.air.connect(A.master); s2.start();
        /* hero pad */
        A.pad = ac.createGain(); A.pad.gain.value = 0; A.pad.connect(A.master);
        A.p1 = ac.createOscillator(); A.p1.frequency.value = 55; A.p2 = ac.createOscillator(); A.p2.frequency.value = 82.6; A.p2.type = 'triangle';
        A.p1.connect(A.pad); A.p2.connect(A.pad); A.p1.start(); A.p2.start();
        A.master.gain.setTargetAtTime(0.55, ac.currentTime, 0.3);
        return A;
      } catch (e) { return null; }
    }
    function sfx(kind) {
      var A = C && C.audio; if (!A || !C.soundOn) return;
      try {
        var ac = A.ac, t = ac.currentTime;
        if (kind === 'whoosh') {
          var s = ac.createBufferSource(); s.buffer = A.nb; var bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
          bp.frequency.setValueAtTime(380, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.2); bp.frequency.exponentialRampToValueAtTime(500, t + 0.46);
          var g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          s.connect(bp); bp.connect(g); g.connect(A.master); s.start(t, 0.3); s.stop(t + 0.55);
        } else if (kind === 'hit' || kind === 'clunk') {
          var o = ac.createOscillator(), gg = ac.createGain(); o.frequency.setValueAtTime(kind === 'hit' ? 92 : 140, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.45);
          gg.gain.setValueAtTime(kind === 'hit' ? 0.55 : 0.35, t); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); o.connect(gg); gg.connect(A.master); o.start(t); o.stop(t + 0.62);
          var n = ac.createBufferSource(); n.buffer = A.nb; var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'hit' ? 900 : 2400;
          var gn = ac.createGain(); gn.gain.setValueAtTime(0.25, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); n.connect(lp); lp.connect(gn); gn.connect(A.master); n.start(t); n.stop(t + 0.1);
          if (kind === 'clunk') [1760, 2637].forEach(function (fq, i) { var p = ac.createOscillator(), pg = ac.createGain(); p.frequency.value = fq;
            pg.gain.setValueAtTime(0.0001, t + 0.12 + i * 0.05); pg.gain.exponentialRampToValueAtTime(0.06, t + 0.13 + i * 0.05); pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
            p.connect(pg); pg.connect(A.master); p.start(t + 0.1); p.stop(t + 0.75); });
        }
      } catch (e) {}
    }
    function audioTick(st) {
      var A = C && C.audio; if (!A) return;
      try {
        var ac = A.ac, t = ac.currentTime, on = C.soundOn && C.playing, s = st.seg, rate = st.rate || 1;
        var rpm = s && s.spindle ? (s.sRpm || Math.abs(s.spindle)) : 0, slow = 0.62 + 0.38 * clamp(rate / 2, 0, 1);
        var f1 = (70 + Math.min(rpm, 12000) * 0.055) * slow;
        A.o1.frequency.setTargetAtTime(Math.max(30, f1), t, 0.08); A.o2.frequency.setTargetAtTime(Math.max(60, f1 * 2.01), t, 0.08);
        A.sp.gain.setTargetAtTime(on && rpm && !st.hero ? 0.05 : 0, t, 0.15);
        var feed = s ? s.f || 0 : 0, eng = clamp((s ? +s.toolR || 3 : 3) / 5, 0.4, 1) * (0.55 + 0.45 * clamp(feed / 1500, 0, 1));
        A.bp.frequency.setTargetAtTime((900 + clamp(feed, 0, 6000) * 0.55) * slow, t, 0.1);
        A.lfo.frequency.setTargetAtTime(Math.max(8, rpm / 60 * 4 * slow), t, 0.1);
        A.cut.gain.setTargetAtTime(on && st.cutting ? 0.11 * eng : 0, t, 0.05);
        A.air.gain.setTargetAtTime(on && s && s.kind === 'rapid' && !st.hero ? 0.05 * clamp(rate / 20, 0.3, 1) : 0, t, 0.12);
        A.pad.gain.setTargetAtTime(on && st.hero ? 0.05 : 0, t, 0.8);
      } catch (e) {}
    }

    /* ---------- player DOM ---------- */
    function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function fmtT(s) { s = Math.max(0, s); var m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ':' + (x < 10 ? '0' : '') + x; }
    function buildDom(host) {
      var root = el('div', 'cine'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', L('title'));
      var bt = el('div', 'cine-bar t'), bb = el('div', 'cine-bar b'), fade = el('div', 'cine-fade'), flash = el('div', 'cine-flash');
      var ttl = el('div', 'cine-ttl'), lbl = el('div', 'cine-lbl'), strip = el('div', 'cine-strip');
      strip.innerHTML = '<button type="button" data-a="prev" aria-label="' + esc(L('prev')) + '" title="' + esc(L('prev')) + '">&#x23EE;</button>' +
        '<button type="button" data-a="play" aria-label="' + esc(L('pause')) + '" title="' + esc(L('pause')) + ' (Space)">&#x23F8;</button>' +
        '<button type="button" data-a="next" aria-label="' + esc(L('next')) + '" title="' + esc(L('next')) + ' (&#x2192;)">&#x23ED;</button>' +
        '<input type="range" min="0" max="1000" step="1" value="0" aria-label="' + esc(L('scrub')) + '">' +
        '<span class="tm">0:00 / 0:00</span>' +
        '<button type="button" data-a="sound" aria-pressed="false" aria-label="' + esc(L('sound')) + '" title="' + esc(L('sound')) + ' (M)">&#x266A;</button>' +
        '<button type="button" data-a="close" aria-label="' + esc(L('close')) + '" title="' + esc(L('close')) + '">&#x2715;</button>';
      root.appendChild(fade); root.appendChild(flash); root.appendChild(bt); root.appendChild(bb); root.appendChild(ttl); root.appendChild(lbl); bb.appendChild(strip);
      host.appendChild(root);
      var q = function (a) { return strip.querySelector('[data-a=' + a + ']'); };
      var D = { root: root, bt: bt, bb: bb, fade: fade, flash: flash, ttl: ttl, lbl: lbl, strip: strip, range: strip.querySelector('input'), tm: strip.querySelector('.tm'),
        play: q('play'), next: q('next'), prev: q('prev'), sound: q('sound'), close: q('close') };
      strip.addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (!b) return; act(b.getAttribute('data-a')); });
      D.range.addEventListener('input', function () { if (C) seek(+D.range.value / 1000 * C.film.len); });
      D.range.addEventListener('keydown', function (e) { if (e.key !== 'Escape') e.stopPropagation(); });
      return D;
    }
    function layout() {
      if (!C) return;
      var host = C.host, w = host.clientWidth, h = host.clientHeight, bar = Math.max(0, (h - w / 2.39) / 2);
      C.D.bt.style.height = bar + 'px'; C.D.bb.style.height = Math.max(bar, 0) + 'px';
      C.D.strip.style.background = bar >= 44 ? 'none' : '';
      C.D.ttl.style.top = (bar + (h - 2 * bar) * 0.66) + "px"; C.D.ttl.style.fontSize = clamp(w / 52, 11, 20) + 'px';
      C.D.lbl.style.top = (bar + 12) + 'px';
      C.band = Math.min(1, (w / 2.39) / Math.max(1, h));
      if (C.post) sizeComposer(C.post.comp);
    }
    function act(a) {
      if (!C) return;
      if (a === 'close') close();
      else if (a === 'play') setPlaying(!C.playing);
      else if (a === 'next') { var i = shotAt(C.film, C.f) + 1; if (i < C.film.shots.length) seek(C.film.shots[i].f0 + 1e-3); }
      else if (a === 'prev') { var j = shotAt(C.film, C.f); if (C.f - C.film.shots[j].f0 < 1 && j > 0) j--; seek(C.film.shots[j].f0 + 1e-3); }
      else if (a === 'sound') setSound(!C.soundOn);
    }
    function setPlaying(on) {
      if (!C) return;
      if (on && C.f >= C.film.len - 1e-6) seek(0);
      C.playing = !!on;
      C.D.play.innerHTML = C.playing ? '&#x23F8;' : (C.f >= C.film.len - 1e-6 ? '&#x21BB;' : '&#x25B6;');
      var lab = C.playing ? L('pause') : (C.f >= C.film.len - 1e-6 ? L('again') : L('play'));
      C.D.play.setAttribute('aria-label', lab); C.D.play.title = lab;
      if (!C.playing && ui.state.running) ui.exec('stop');
      if (C.audio) try { if (C.playing && C.soundOn) C.audio.ac.resume(); } catch (e) {}
    }
    function setSound(on) {
      if (!C) return;
      C.soundOn = !!on; C.D.sound.setAttribute('aria-pressed', String(C.soundOn));
      if (C.soundOn && !C.audio) C.audio = makeAudio();
      if (C.audio) try { if (C.soundOn) { C.audio.ac.resume(); C.audio.master.gain.setTargetAtTime(0.55, C.audio.ac.currentTime, 0.1); } else C.audio.master.gain.setTargetAtTime(0, C.audio.ac.currentTime, 0.05); } catch (e) {}
    }
    function seek(f) {
      if (!C) return;
      C.f = clamp(f, 0, C.film.len); C.snap = true; C.lastShot = shotAt(C.film, C.f);
      var t = C.film.P(C.f); if (Math.abs(ui.state.t - t) > 1e-9) jumpProg(t);
      if (C.playing && C.f < C.film.progEnd) progStart();
      if (!C.playing) setPlaying(false);
    }

    /* ---------- keys: the player owns the keyboard while it is open ---------- */
    function onKey(e) {
      if (!C) return;
      var k = e.key, used = true;
      if (k === 'Escape') close();
      else if (k === ' ' || k === 'k' || k === 'K') { if (e.target && e.target.closest && e.target.closest('.cine button') && k === ' ') used = false; else act('play'); }
      else if (k === 'ArrowRight' || k === 'n' || k === 'N') act('next');
      else if (k === 'ArrowLeft' || k === 'p' || k === 'P') act('prev');
      else if (k === 'm' || k === 'M') act('sound');
      else if (k === 'Home') seek(0);
      else if (k === 'End') seek(C.film.len - 1e-3);
      else if (k === 'Tab') { used = false; var f = [].slice.call(C.D.strip.querySelectorAll('button,input')); if (f.length) {
        var i = f.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1); f[n].focus(); e.preventDefault(); } }
      else if (k === 'Enter') used = false;
      if (used) { e.preventDefault(); }
      e.stopImmediatePropagation(); e.stopPropagation();
    }

    /* ---------- open / close ---------- */
    function available() { var S = ui.state; return !!(ready || S) && !!(S && S.segs && S.segs.length && S.res && S.res.stock) && !S.lock; }
    function hideList() {                                 // the toolpath lines, the axes, the trace: not in the film
      var out = []; if (!partRoot) return out;
      partRoot.traverse(function (o) { if (o.isLine || o.isLineSegments || o.isPoints) out.push([o, o.visible]); });
      return out;
    }
    function open(o) {
      o = o || {};
      if (C) return true;
      if (!available()) { try { ui.say(L('none').toUpperCase()); } catch (e) {} return false; }
      var S = ui.state, host = renderer.domElement.parentElement || document.body;
      try { REDUCED = !!(window.TNC_SETTINGS && TNC_SETTINGS.reducedMotion()); } catch (e) { REDUCED = false; }
      C = {
        host: host, film: filmFor(), f: 0, playing: false, rate: +o.speed > 0 ? +o.speed : 1, snap: true, lastShot: -1, band: 1,
        save: { pos: camera.position.clone(), quat: camera.quaternion.clone(), up: camera.up.clone(), fov: camera.fov, zoom: camera.zoom,
          target: controls.target.clone(), enabled: controls.enabled, damping: controls.enableDamping,
          speed: S.speed, ovr: S.ovr, mode: S.mode, running: S.running, t: S.t, k: S.k, cursor: S.cursor, render: ui.render,
          hostPos: host.style.position, focus: document.activeElement, cam: S.cam, shake: S.shake },
        vel: { p: new THREE.Vector3(), t: new THREE.Vector3(), fov: 0 }, cur: null, ema: 1 / 30, level: o.post != null ? clamp(+o.post, 0, 2) : 0, lock: o.post != null ? +o.post : null, card: -1, levelHold: 0, warm: 0,
        prevVP: null, audio: null, soundOn: false, hidden: hideList(), rim: null, shot: -1, lastT: performance.now()
      };
      if (S.running) ui.exec('stop');
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.classList.add('cine-host-on');
      C.D = buildDom(host); layout();
      controls.enabled = false; controls.enableDamping = false; S.cam = null;
      S.ovr = 100; S.speed = 1e-4;
      C.post = buildComposer();
      C.rim = new THREE.DirectionalLight(0xcfe4ff, 0); scene.add(C.rim); scene.add(C.rim.target);
      ui.render = render;
      document.addEventListener('keydown', onKey, true);
      setSound(!!(o.sound != null ? o.sound : S.sound));
      jumpProg(0); C.f = 0;
      title(false);
      setPlaying(o.autoplay !== false);
      if (C.playing) progStart();
      try { C.D.play.focus({ preventScroll: true }); } catch (e) {}
      return true;
    }
    function close() {
      if (!C) return;
      var c = C, S = ui.state, sv = c.save; C = null;
      document.removeEventListener('keydown', onKey, true);
      try { c.D.root.remove(); } catch (e) {}
      c.host.classList.remove('cine-host-on'); c.host.style.position = sv.hostPos;
      if (S.running) ui.exec('stop');
      c.hidden.forEach(function (h) { h[0].visible = h[1]; });
      if (c.rim) { scene.remove(c.rim); scene.remove(c.rim.target); c.rim.dispose && c.rim.dispose(); }
      if (c.post) try { c.post.comp.dispose && c.post.comp.dispose(); c.post.pass.material.dispose(); } catch (e) {}
      if (c.audio) try { c.audio.master.gain.value = 0; c.audio.ac.close(); } catch (e) {}
      ui.render = sv.render;
      S.speed = sv.speed; S.ovr = sv.ovr; S.mode = sv.mode;
      if (sv.t <= 0) { ui.exec('reset'); } else if (Math.abs(S.t - sv.t) > 0) jumpProg(sv.t);
      S.k = sv.k; S.cursor = sv.cursor; S.cam = sv.cam;
      if (sv.running) { ui.exec('start'); }
      var put = function () {
        camera.position.copy(sv.pos); camera.quaternion.copy(sv.quat); camera.up.copy(sv.up); camera.fov = sv.fov; camera.zoom = sv.zoom; camera.updateProjectionMatrix();
        controls.target.copy(sv.target); controls.enabled = sv.enabled; controls.enableDamping = sv.damping;
      };
      put(); pendingPut = put;                             // once more after the next tick (camera follow, damping)
      try { if (sv.focus && sv.focus.focus) sv.focus.focus({ preventScroll: true }); } catch (e) {}
    }
    var pendingPut = null;

    function title(on) {
      if (!C) return;
      var S = ui.state, nm = String(S.pgm || '').replace(/\.H$/i, '');
      C.D.ttl.innerHTML = '<b>' + esc(nm) + '</b><small>' + esc(L('title')) + '</small>';
      C.D.ttl.style.opacity = on ? '1' : '0';
    }
    function endCard() {
      if (!C) return;
      var S = ui.state, nm = String(S.pgm || '').replace(/\.H$/i, '');
      C.D.ttl.innerHTML = '<b>' + esc(nm) + '</b><small>' + C.film.tools + ' ' + esc(L('tools')) + ' &middot; ' + fmtT(C.film.total) + ' ' + esc(L('machining')) + '</small>';
      C.D.ttl.style.opacity = '1';
    }

    /* ---------- per frame ---------- */
    ui.on('tick', function (dt, st) {
      if (pendingPut && !C) { var p = pendingPut; pendingPut = null; p(); }
      if (!C) return;
      var S = ui.state, film = C.film;
      C.ema = C.ema * 0.92 + dt * 0.08; C.warm += dt;
      if (C.lock == null && C.warm > 1.2 && C.levelHold <= 0) {              // software rendering: fewer taps, then no post pass
        if (C.ema > 0.075 && C.level < 2) { C.level++; C.levelHold = 1.5; }
      }
      C.levelHold -= dt;
      if (C.playing) {
        C.f += dt * C.rate;
        if (C.f >= film.len) { C.f = film.len; setPlaying(false); }
      }
      if (C.f < film.progEnd) {
        var want = film.P(C.f);
        if (Math.abs(S.t - want) > Math.max(0.5, (film.P(C.f + 0.25) - want) * 4) + 1e-6) jumpProg(want);
        if (C.playing) {
          if (!S.running) progStart();
          var g = Math.max(dt, 1 / 120), nextT = film.P(C.f + g * C.rate);
          S.speed = clamp((nextT - S.t) / g, 1e-4, 1e6);
          C.progRate = (nextT - want) / g;
        } else if (S.running) ui.exec('stop');
      } else {
        if (S.running) ui.exec('stop');
        if (S.t < S.total - 1e-9) jumpProg(S.total);
        C.progRate = 0;
      }
      var i = shotAt(film, C.f);
      if (i !== C.lastShot) { onShot(i, C.lastShot); C.lastShot = i; }
      var u = clamp(C.f / Math.max(1e-6, film.len), 0, 1);
      if (document.activeElement !== C.D.range) C.D.range.value = String(Math.round(u * 1000));
      C.D.tm.textContent = fmtT(C.f) + ' / ' + fmtT(film.len);
      audioTick({ seg: st && st.seg, cutting: st && st.cutting, rate: C.progRate, hero: film.shots[i].type === 'hero' });
      var lab = film.shots[i].type, lh = '<i>' + (i + 1) + '/' + film.shots.length + '</i>' + esc(L(lab)) + (st && st.seg && lab !== 'hero' && lab !== 'establish' ? ' &middot; T' + st.seg.tool + ' &Oslash;' + (+(st.seg.toolR * 2).toFixed(1)) : '');
      if (C.lblH !== lh) { C.lblH = lh; C.D.lbl.innerHTML = lh; }
      var card = C.f > 0.4 && C.f < 3.4 ? 1 : (lab === 'hero' && C.f - film.shots[i].f0 > 3.2 ? 2 : 0);
      if (card !== C.card) { C.card = card; if (card === 2) endCard(); else title(card === 1); }
    });
    function onShot(i, prev) {
      var sh = C.film.shots[i];
      if (prev < 0) return;
      if (sh.trans === 'whip') sfx('whoosh');
      if (sh.type === 'toolchange') sfx('clunk');
      else if ((sh.type === 'vertigo' || sh.type === 'macro') && sh.trans !== 'whip') { sfx('hit'); flash(0.18); }
      if (sh.trans === 'cut' || sh.trans === 'dip') C.snap = true;
    }
    function flash(a) { if (!C || REDUCED) return; var f = C.D.flash; f.style.transition = 'none'; f.style.opacity = String(a);
      requestAnimationFrame(function () { f.style.transition = 'opacity .35s'; f.style.opacity = '0'; }); }

    /* ---------- the camera, set right before the frame is drawn ---------- */
    function damp(cur, tgt, vel, st, dt) {                // critically damped spring (smooth-damp form)
      if (st <= 1e-3) { vel.set(0, 0, 0); return cur.copy(tgt); }
      var om = 2 / st, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      var ch = cur.clone().sub(tgt), tmp = vel.clone().addScaledVector(ch, om).multiplyScalar(dt);
      vel.sub(tmp.clone().multiplyScalar(om)).multiplyScalar(ex);
      return cur.copy(tgt).add(ch.add(tmp).multiplyScalar(ex));
    }
    function toW(v) { var q = new THREE.Vector3(v.x, v.y, v.z); if (rigOn && partRoot) partRoot.localToWorld(q); return q; }
    function render(sc, cam) {
      if (!C) { renderer.render(scene, camera); return; }
      var now = performance.now(), dt = clamp((now - C.lastT) / 1000, 0, 0.1); C.lastT = now;
      try {
        var S = ui.state, film = C.film, ctx = ctxLive(); ctx.band = C.band;
        ctx.dT = (C.f < film.progEnd) ? S.t - film.P(C.f) : 0;
        var o = poseAt(film, C.f, ctx), sh = film.shots[o.shot];
        var P = toW(o.p), T = toW(o.t);
        if (!C.cur || C.snap || o.whip) { if (C.snap) C.prevVP = null; C.cur = { p: P.clone(), t: T.clone(), fov: o.fov }; C.vel.p.set(0, 0, 0); C.vel.t.set(0, 0, 0); C.snap = false; }
        else {
          damp(C.cur.p, P, C.vel.p, o.st, dt); damp(C.cur.t, T, C.vel.t, o.st * 0.8, dt);
          C.cur.fov += (o.fov - C.cur.fov) * (o.st < 0.1 ? 1 : 1 - Math.exp(-dt / (o.st * 0.7)));
        }
        if (rigOn) { var lb = keepOutWorld(C.cur.p, ctx); C.cur.p.copy(lb); }
        else { var kp = keepOut(C.cur.p, ctx, null); C.cur.p.set(kp.x, kp.y, kp.z); }
        camera.position.copy(C.cur.p); camera.up.set(0, 0, 1); if (o.up) camera.up.set(o.up.x, o.up.y, o.up.z);
        camera.lookAt(C.cur.t); if (o.roll) camera.rotateZ(o.roll);
        camera.fov = C.cur.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        controls.target.copy(C.cur.t);
        C.hidden.forEach(function (h) { h[0].visible = false; });
        /* fade (dips, the opening) */
        C.D.fade.style.opacity = String(o.fade || 0);
        /* rim light for the hero orbit */
        var heroK = sh.type === 'hero' ? smooth((C.f - sh.f0) / 1.5) : 0;
        if (C.rim) { var I = stockInfo(ctx.st), cc = toW(I.c), back = cc.clone().sub(camera.position).setLength(I.diag * 2);
          C.rim.position.copy(cc).add(back).add(new THREE.Vector3(0, 0, I.diag)); C.rim.target.position.copy(cc); C.rim.intensity = 2.6 * heroK; }
        /* post */
        var post = C.post, vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        if (post && C.level < 2) {
          var U = post.pass.uniforms, blur = new THREE.Vector2(0, 0);
          if (!REDUCED && C.prevVP && dt > 0) {
            var q = C.cur.t.clone().applyMatrix4(C.prevVP);   // where the point now in the middle was a frame ago
            blur.set(-q.x * 0.5, -q.y * 0.5).multiplyScalar(0.55 + 1.6 * (o.blurBoost || 0));
            if (blur.length() > 0.09) blur.setLength(0.09); if (blur.length() < 0.0015) blur.set(0, 0);
          }
          var fo = o.focus ? toW(o.focus).project(camera) : new THREE.Vector3();
          U.uBlur.value.copy(blur); U.uFocus.value.set(fo.x * 0.5 + 0.5, fo.y * 0.5 + 0.5);
          U.uDof.value = REDUCED ? o.dof * 0.5 : o.dof; U.uFocusR.value = o.focusR;
          U.uTaps.value = C.level === 0 ? 12 : 5; U.uTime.value = (now % 10000) / 10; U.uBand.value = C.band;
          U.uGrain.value = REDUCED ? 0 : 0.035;
          var v2 = new THREE.Vector2(); renderer.getSize(v2); U.uRes.value.set(v2.x, v2.y);
          C.prevVP = vp;
          post.comp.render(dt);
        } else {
          C.prevVP = vp;
          if (C.save.render) C.save.render(sc, cam); else renderer.render(scene, camera);
        }
      } catch (e) {
        console.warn('cine render', e);
        try { renderer.render(scene, camera); } catch (e2) {}
      }
    }
    function keepOutWorld(p, ctx) {                        // a machine rig: the boxes as the part stands now
      var bx = ctx.boxes.map(function (b) {
        var B = new THREE.Box3();
        for (var i = 0; i < 8; i++) B.expandByPoint(toW({ x: i & 1 ? b.x1 : b.x0, y: i & 2 ? b.y1 : b.y0, z: i & 4 ? b.z1 : b.z0 }));
        return { x0: B.min.x, y0: B.min.y, z0: B.min.z, x1: B.max.x, y1: B.max.y, z1: B.max.z };
      });
      var q = keepOut(p, { boxes: bx, margin: ctx.margin }, null); return new THREE.Vector3(q.x, q.y, q.z);
    }
    ui.on('resize', function () { layout(); });

    /* ---------- public ---------- */
    api.open = open; api.close = close; api.available = available;
    Object.defineProperty(api, 'playing', { get: function () { return !!(C && C.playing); }, configurable: true });
    api.film = function () { var f = C ? C.film : filmFor(); return f ? summary(f) : null; };
    api.sample = function (f) {                           // the rig pose at film time f, pure (no springs), program coordinates
      var film = C ? C.film : filmFor(); if (!film) return null; var ctx = ctxLive(); ctx.band = C ? C.band : ctx.band;
      var o = poseAt(film, f, ctx); return { p: o.p, t: o.t, fov: o.fov, type: o.type, shot: o.shot, boxes: ctx.boxes, margin: ctx.margin };
    };
    api.seek = function (f) { seek(f); };
    api.pause = function () { setPlaying(false); };
    api.play = function () { setPlaying(true); };
    api.debug = function () { return C ? { f: C.f, len: C.film.len, shot: shotAt(C.film, C.f), level: C.level, ema: C.ema, audio: !!C.audio, soundOn: C.soundOn,
      cam: camera.position.toArray(), progT: ui.state.t, rate: C.rate } : null; };
    function summary(f) {
      return { seed: f.seed, len: +f.len.toFixed(3), progEnd: +f.progEnd.toFixed(3), total: f.total, runs: f.runs, tools: f.tools,
        shots: f.shots.map(function (s) { return { type: s.type, cls: s.cls, trans: s.trans, f0: +s.f0.toFixed(3), f1: +s.f1.toFixed(3), az: +s.az.toFixed(4), side: s.side, sign: s.sign }; }) };
    }
  });

  return api;
})();
if (typeof module !== 'undefined') module.exports = TNC_CINE;
