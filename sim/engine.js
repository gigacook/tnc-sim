/* ==========================================================================
 * TNC — the Klartext interpreter, now Rust (server/crates/tnc-core) compiled to WebAssembly.
 * Same global and same calls as the old core.js: TNC.run(text, opts), TNC.parse(text), TNC.TOOLS.
 * The module is instantiated before first use: TNC_ENGINE.init(bytes) (sync, node) or
 * TNC_ENGINE.load(bytes) (async, the browser: Chrome refuses synchronous compiles over 4 KB).
 * opts.holder.stack(r) is read once as stack(3): every holder in tools3d.js has one A dimension.
 * ========================================================================== */
var TNC_ENGINE = (function () {
  'use strict';
  var ex = null, enc = new TextEncoder(), dec = new TextDecoder();
  function set(instance) { ex = instance.exports; return api; }
  function init(bytes) { return set(new WebAssembly.Instance(new WebAssembly.Module(bytes), {})); }
  function load(bytes) { return WebAssembly.instantiate(bytes, {}).then(function (r) { return set(r.instance); }); }
  function put(s) {
    var b = enc.encode(s), p = ex.tnc_alloc(b.length || 1);
    new Uint8Array(ex.memory.buffer, p, b.length).set(b);
    return [p, b.length];
  }
  /* NaN / ±Infinity travel as "\u0001NaN" / "\u0001Inf" / "\u0001-Inf" (JSON has no such numbers) */
  function revive(k, v) { return v === '\u0001NaN' ? NaN : v === '\u0001Inf' ? Infinity : v === '\u0001-Inf' ? -Infinity : v; }
  function result(n) {
    var s = dec.decode(new Uint8Array(ex.memory.buffer, ex.tnc_out(), n));
    return s.indexOf('\u0001') >= 0 || s.indexOf('\\u0001') >= 0 ? JSON.parse(s, revive) : JSON.parse(s);
  }
  function call(fn, args) {
    if (!ex) throw new Error('TNC engine not loaded');
    var bufs = args.map(put), flat = [];
    bufs.forEach(function (b) { flat.push(b[0], b[1]); });
    var n = ex[fn].apply(null, flat);
    bufs.forEach(function (b) { ex.tnc_free(b[0], b[1] || 1); });
    return result(n);
  }
  function hideParseErrors(blocks) {          // core.js kept the parse error as a hidden __perr property
    blocks.forEach(function (b) { if (b.error) Object.defineProperty(b, '__perr', { value: b.error, enumerable: false, writable: true, configurable: true }); });
    return blocks;
  }
  function run(text, opts) {
    opts = opts || {};
    var o = {
      tools: opts.tools ? opts.tools.map(function (t) { return { t: t.t, name: t.name, l: t.l, r: t.r }; }) : null,
      machine: opts.machine || null,
      holder_a: opts.holder && opts.holder.stack ? opts.holder.stack(3) : null,
      auto_tools: !!opts.autoTools,
      programs: opts.programs || null   // CALL PGM / cycle 12: {NAME.H: text}
    };
    var r = call('tnc_run', [String(text === undefined || text === null ? '' : text), JSON.stringify(o)]);
    var res = { blocks: hideParseErrors(r.blocks), moves: r.moves, stock: r.stock, stats: r.stats, machine: opts.machine || {}, exec: r.exec, errors: r.errors };
    Object.defineProperty(res, '__h', { value: r.h, enumerable: false });   // the engine keeps the last runs: expand / analyse use this
    return res;
  }
  function parse(text) {
    var r = call('tnc_parse', [String(text === undefined || text === null ? '' : text)]);
    hideParseErrors(r.blocks);
    return r;
  }
  var TOOLS = [
    { t: 1,  name: 'SPOT_DRILL_90', l: 72.400,  r: 3.000  }, { t: 2,  name: 'DRILL_8.5',     l: 118.20,  r: 4.250  },
    { t: 3,  name: 'TAP_M10',       l: 96.000,  r: 5.000  }, { t: 4,  name: 'ENDMILL_6',     l: 64.100,  r: 3.000  },
    { t: 5,  name: 'ENDMILL_12',    l: 88.750,  r: 6.000  }, { t: 6,  name: 'FACEMILL_50',   l: 52.300,  r: 25.00  },
    { t: 7,  name: 'BORE_HEAD',     l: 142.00,  r: 16.00  }, { t: 8,  name: 'CHAMFER_45',    l: 58.900,  r: 5.000  },
    { t: 9,  name: 'ENDMILL_3',     l: 58.000,  r: 1.500  }, { t: 11, name: 'PROBE_TS640',   l: 155.00,  r: 3.000  },
    { t: 42, name: 'REAMER_H7',     l: 101.30,  r: 5.000  },
    /* sculpting set: small cutters for detail, ball mills for 3-D surfaces, long-reach cutters for deep blanks.
       L is the gauge length; reach below the holder nose = L - holder A (ISO 50: 100 mm). Not from the operator's table. */
    { t: 10, name: 'ENDMILL_2',     l: 120.00,  r: 1.000  }, { t: 12, name: 'ENDMILL_1',     l: 110.00,  r: 0.500  },
    { t: 13, name: 'ENDMILL_4',     l: 125.00,  r: 2.000  }, { t: 14, name: 'ENDMILL_8',     l: 140.00,  r: 4.000  },
    { t: 15, name: 'ENDMILL_16',    l: 180.00,  r: 8.000  }, { t: 16, name: 'ENDMILL_25_LONG', l: 400.00, r: 12.50 },
    { t: 17, name: 'ENDMILL_32_XLONG', l: 620.00, r: 16.00 }, { t: 20, name: 'BALL_2',       l: 120.00,  r: 1.000  },
    { t: 21, name: 'BALL_4',        l: 130.00,  r: 2.000  }, { t: 22, name: 'BALL_6',        l: 150.00,  r: 3.000  },
    { t: 23, name: 'BALL_10',       l: 200.00,  r: 5.000  }, { t: 24, name: 'BALL_16_LONG',  l: 400.00,  r: 8.000  },
    { t: 25, name: 'BALL_20_XLONG', l: 620.00,  r: 10.00  }
  ];
  /* ---------------- TNC_SIM: expand + analyse run in the engine on the retained run ---------------- */
  function handle(res) {
    if (!res || !res.__h) throw new Error('TNC_SIM needs a result from TNC.run');
    return res.__h;
  }
  function rapidOf(res) { return +((res.stats && res.stats.rapidRate) || 18000); }
  function expand(res) {
    var n = ex.tnc_expand(handle(res), rapidOf(res));
    if (!n) throw new Error('TNC_SIM.expand: this TNC.run result is no longer kept (only the last few are)');
    return result(n);
  }
  function analyse(res, exd, g) {
    var st = res.stock, sMax = res.machine && res.machine.sMax;      // as sim.js read them: the caller may have swapped the blank
    var n = ex.tnc_analyse(handle(res), st.x0, st.y0, st.z0, st.x1, st.y1, st.z1, rapidOf(res), +sMax || 0, g.NX, g.NY, g.DX, g.DY, STOCK.VICE.on ? 1 : 0);
    if (!n) throw new Error('TNC_SIM.analyse: this TNC.run result is no longer kept (only the last few are)');
    var r = result(n), ev = r.events;
    Object.defineProperty(ev, 'cut', { value: r.cut, enumerable: false });   // feed / cut path length: spots a program that mills air
    return ev;
  }
  var CONE = {};
  TOOLS.forEach(function (t) { if (/CHAMFER|SPOT/.test(t.name)) CONE[t.t] = true; });

  /* ---------------- TNC_STOCK: the height field stays a JS Float32Array; stamp copies the tool's window in and out ---------------- */
  var STOCK = {
    VICE: { on: true, axis: 'Y', grip: 6, minGrip: 1 / 3, jawT: 25, jawW: 160, below: 40 },   // only .on is a setting (the UI toggle)
    HEAD_LEN: 300
  };
  function sc() { return new Float64Array(ex.memory.buffer, ex.tnc_scratch(), 16); }
  STOCK.grid = function (st, segs) {
    var minR = Infinity;
    for (var i = 0; i < segs.length; i++) if (segs[i].kind === 'feed' && segs[i].toolR < minR) minR = segs[i].toolR;
    ex.tnc_grid(st.x0, st.y0, st.x1, st.y1, minR);
    var s = sc(); return { NX: s[0], NY: s[1], DX: s[2], DY: s[3] };
  };
  STOCK.field = function (st, g) { var hm = new Float32Array(g.NX * g.NY); hm.fill(st.z1); return hm; };
  STOCK.axis = function (s, u) {
    var a = s.a || {}, b = s.b || {};
    if (!ex.tnc_axis(s.a && s.a.a != null ? 1 : 0, +a.a, +a.b, s.b ? 1 : 0, +b.a, +b.b, u)) return null;
    var r = sc(); return [r[0], r[1], r[2]];
  };
  STOCK.vice = function (st) {
    var n = ex.tnc_vice(st.x0, st.y0, st.z0, st.x1, st.y1, st.z1, STOCK.VICE.on ? 1 : 0), s = sc(), out = [];
    for (var i = 0; i < n; i++) out.push({ x0: s[i * 6], x1: s[i * 6 + 1], y0: s[i * 6 + 2], y1: s[i * 6 + 3], z0: s[i * 6 + 4], z1: s[i * 6 + 5] });
    return out;
  };
  var win = 0, winCap = 0;
  STOCK.stamp = function (hm, st, g, s, p, ax, eps) {
    if (eps == null) eps = 0.05;
    var A = ax ? 1 : 0, ax0 = ax ? ax[0] : 0, ax1 = ax ? ax[1] : 0, ax2 = ax ? ax[2] : 0;
    var tr = +s.toolR, cone = s.cone ? 1 : 0, ball = s.ball ? 1 : 0, tr2 = +s.toolR2, stick = +s.stick;
    ex.tnc_stamp_range(st.x0, st.y0, st.z0, st.x1, st.y1, st.z1, g.NX, g.NY, g.DX, g.DY, tr, cone, ball, tr2, stick, p.x, p.y, p.z, A, ax0, ax1, ax2);
    var r = sc(), i0 = r[0], i1 = r[1], j0 = r[2], j1 = r[3];
    if (!(i0 <= i1 && j0 <= j1)) return false;
    var wnx = i1 - i0 + 1, wny = j1 - j0 + 1, n = wnx * wny, j;
    if (n > winCap) { if (win) ex.tnc_free(win, winCap * 4); winCap = n; win = ex.tnc_alloc(n * 4); }
    var w = new Float32Array(ex.memory.buffer, win, n);
    for (j = 0; j < wny; j++) w.set(hm.subarray((j0 + j) * g.NX + i0, (j0 + j) * g.NX + i1 + 1), j * wnx);
    var hit = ex.tnc_stamp_win(win, n, i0, j0, wnx, st.x0, st.y0, st.z0, st.x1, st.y1, st.z1, g.NX, g.NY, g.DX, g.DY, tr, cone, ball, tr2, stick, p.x, p.y, p.z, A, ax0, ax1, ax2, eps);
    if (hit) { w = new Float32Array(ex.memory.buffer, win, n); for (j = 0; j < wny; j++) hm.set(w.subarray(j * wnx, (j + 1) * wnx), (j0 + j) * g.NX + i0); }
    return !!hit;
  };

  var SIM = { expand: expand, grid: STOCK.grid, analyse: analyse, isCone: function (t) { return !!CONE[t]; } };
  var api = { init: init, load: load, ready: function () { return !!ex; }, run: run, parse: parse, TOOLS: TOOLS, SIM: SIM, STOCK: STOCK };
  /* node: load the module next to this file (tests, the server's build); TNC_WASM picks another build */
  if (typeof module !== 'undefined' && typeof require === 'function' && typeof process !== 'undefined') {
    try {
      var fs = require('fs'), file = process.env.TNC_WASM || require('path').join(__dirname, 'engine', 'tnc_core.wasm');
      if (fs.existsSync(file)) init(fs.readFileSync(file));
    } catch (e) { /* the caller sees "TNC engine not loaded" on first use */ }
  }
  return api;
})();
var TNC = { run: TNC_ENGINE.run, parse: TNC_ENGINE.parse, TOOLS: TNC_ENGINE.TOOLS };
var TNC_SIM = TNC_ENGINE.SIM, TNC_STOCK = TNC_ENGINE.STOCK;
if (typeof module !== 'undefined') module.exports = Object.assign(TNC_ENGINE, { TNC: TNC, TNC_SIM: TNC_SIM, TNC_STOCK: TNC_STOCK });
