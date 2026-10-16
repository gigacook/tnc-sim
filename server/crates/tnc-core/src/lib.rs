//! The simulator's Klartext interpreter (formerly sim/core.js), one implementation for the browser (WASM) and the
//! server (native). `run(text, opts)` returns what `TNC.run` returned, as JSON; the browser glue turns it back into
//! the same objects, so the UI cannot tell the engines apart. Parity with the old JS engine: tests/parity.js.

pub mod exec;
pub mod js;
pub mod parse;
pub mod sim;
pub mod stock;
pub mod val;

use exec::{Compiled, Mach, Move, Opts, ToolEntry, ToolStat, J};
use serde_json::Value;
use val::{num, string, Obj};

/// The built-in tool table (TNC.TOOLS): t, name, l, r
pub const TOOLS: &[(f64, &str, f64, f64)] = &[
    (1.0, "SPOT_DRILL_90", 72.400, 3.000), (2.0, "DRILL_8.5", 118.20, 4.250), (3.0, "TAP_M10", 96.000, 5.000), (4.0, "ENDMILL_6", 64.100, 3.000),
    (5.0, "ENDMILL_12", 88.750, 6.000), (6.0, "FACEMILL_50", 52.300, 25.00), (7.0, "BORE_HEAD", 142.00, 16.00), (8.0, "CHAMFER_45", 58.900, 5.000),
    (9.0, "ENDMILL_3", 58.000, 1.500), (11.0, "PROBE_TS640", 155.00, 3.000), (42.0, "REAMER_H7", 101.30, 5.000),
    // sculpting set: small cutters for detail, ball mills for 3-D surfaces, long-reach cutters for deep blanks (not from the operator's table)
    (10.0, "ENDMILL_2", 120.00, 1.000), (12.0, "ENDMILL_1", 110.00, 0.500), (13.0, "ENDMILL_4", 125.00, 2.000), (14.0, "ENDMILL_8", 140.00, 4.000),
    (15.0, "ENDMILL_16", 180.00, 8.000), (16.0, "ENDMILL_25_LONG", 400.00, 12.50), (17.0, "ENDMILL_32_XLONG", 620.00, 16.00),
    (20.0, "BALL_2", 120.00, 1.000), (21.0, "BALL_4", 130.00, 2.000), (22.0, "BALL_6", 150.00, 3.000), (23.0, "BALL_10", 200.00, 5.000),
    (24.0, "BALL_16_LONG", 400.00, 8.000), (25.0, "BALL_20_XLONG", 620.00, 10.00),
];
pub fn tools() -> Vec<ToolEntry> { TOOLS.iter().map(|&(t, n, l, r)| ToolEntry { t, name: J::Val(n.to_string()), l, r }).collect() }

fn f(v: Option<&Value>) -> f64 { v.and_then(|x| x.as_f64()).unwrap_or(f64::NAN) }

/// Options as JSON: {tools: [{t, name, l, r}] | null, machine: {...} | null, holder_a: number | null, auto_tools: bool}
pub fn opts_from_json(s: &str) -> Opts {
    let v: Value = serde_json::from_str(s).unwrap_or(Value::Null);
    let tools = v.get("tools").and_then(|t| t.as_array()).map(|a| a.iter().map(|t| ToolEntry {
        t: f(t.get("t")), name: match t.get("name") { Some(Value::String(s)) => J::Val(s.clone()), Some(Value::Null) => J::Null, _ => J::Absent }, l: f(t.get("l")), r: f(t.get("r")),
    }).collect());
    let mut mach = Mach { arc_tol: f64::NAN, pocket_k: f64::NAN, f_max: f64::NAN, accel: f64::NAN, s_max: f64::NAN, ..Default::default() };
    if let Some(m) = v.get("machine").filter(|m| m.is_object()) {
        mach.arc_tol = f(m.get("arcTol")); mach.pocket_k = f(m.get("pocketK")); mach.f_max = f(m.get("fMax")); mach.accel = f(m.get("accel")); mach.s_max = f(m.get("sMax"));
        if let Some(r) = m.get("rapid").filter(|r| r.is_object()) { mach.rapid = Some(["x", "y", "z", "a", "b", "c"].map(|k| f(r.get(k)))); }
        if let Some(l) = m.get("limits").and_then(|l| l.as_object()) {
            for k in ['A', 'B', 'C'] { if let Some(a) = l.get(&k.to_string()).and_then(|a| a.as_array()) { mach.limits.insert(k, [f(a.first()), f(a.get(1))]); } }
        }
        if let Some(a) = m.get("axes").and_then(|a| a.as_array()) { mach.axes = a.iter().filter_map(|x| x.as_str().map(String::from)).collect(); }
        mach.c19pos_false = m.get("c19pos") == Some(&Value::Bool(false));
        if let Some(p) = m.get("probe").filter(|p| p.is_object()) { mach.probe = Some([f(p.get("f")), f(p.get("rapid")), f(p.get("clr"))]); }
    }
    Opts { tools, mach, holder_a: v.get("holder_a").and_then(|x| x.as_f64()), auto_tools: v.get("auto_tools").and_then(|x| x.as_bool()).unwrap_or(false) }
}

fn jnum(o: &mut Obj, k: &str, v: &J<f64>) { match v { J::Absent => {}, J::Null => { o.opt_num(k, None); } J::Val(x) => { o.num(k, *x); } } }
fn jstr(o: &mut Obj, k: &str, v: &J<String>) { match v { J::Absent => {}, J::Null => { o.opt_str(k, None); } J::Val(s) => { o.str(k, s); } } }
fn p3(out: &mut String, p: &exec::P3) { Obj::new(out).num("x", p.x).num("y", p.y).num("z", p.z).end(); }
fn rot(out: &mut String, r: &Option<exec::Rot>) { match r { None => out.push_str("null"), Some(r) => Obj::new(out).num("a", r.a).num("b", r.b).num("c", r.c).end() } }

pub fn move_json(out: &mut String, m: &Move) {
    let mut o = Obj::new(out);
    o.str("kind", m.kind.as_str()).raw("from", |w| p3(w, &m.from)).raw("to", |w| p3(w, &m.to)).opt_num("cx", m.cx).opt_num("cy", m.cy).bool("ccw", m.ccw).opt_num("sweep", m.sweep)
        .num("feed", m.feed).num("tool", m.tool).num("toolR", m.tool_r).num("toolDR", m.tool_dr);
    jnum(&mut o, "toolL", &m.tool_l); jnum(&mut o, "stick", &m.stick); jstr(&mut o, "toolName", &m.tool_name);
    o.num("spindle", m.spindle); jnum(&mut o, "sRpm", &m.s_rpm);
    o.bool("coolant", m.coolant).num("block", m.block).opt_str("cycle", m.cycle.as_deref()).opt_str("rc", m.rc.as_deref()).bool("rcAct", m.rc_act);
    jnum(&mut o, "seq", &m.seq);
    o.raw("rot0", |w| rot(w, &m.rot0)).raw("rot1", |w| rot(w, &m.rot1)).opt_num("dur", m.dur).num("len", m.len);
    if m.probe { o.bool("probe", true); }
    if m.touch { o.bool("touch", true); }
    o.end();
}
fn tool_stat_json(out: &mut String, t: &ToolStat) {
    let mut o = Obj::new(out);
    o.num("t", t.t); jstr(&mut o, "name", &t.name);
    o.num("r", t.r).num("l", t.l).num("moves", t.moves).num("time", t.time);
    o.end();
}

/// TNC.run(text, opts) as JSON (without `machine`: the caller passes its own object back)
pub fn run_json(text: &str, opts: &Opts) -> String { run_full(text, opts, None).0 }

/// TNC.run as JSON plus the compiled moves and stock (kept for expand / analyse); `h` adds the retained handle
pub fn run_full(text: &str, opts: &Opts, h: Option<u32>) -> (String, Compiled) {
    let mut p = parse::parse(text);
    let c: Compiled = exec::compile(&mut p.blocks, opts);
    let mut out = String::with_capacity(256 + c.moves.len() * 420 + p.blocks.len() * 160);
    out.push_str("{\"blocks\":[");
    for (i, b) in p.blocks.iter().enumerate() { if i > 0 { out.push(','); } val::block(&mut out, b); }
    out.push_str("],\"moves\":[");
    for (i, m) in c.moves.iter().enumerate() { if i > 0 { out.push(','); } move_json(&mut out, m); }
    out.push_str("],\"stock\":");
    let s = &c.stock;
    Obj::new(&mut out).num("x0", s.x0).num("y0", s.y0).num("z0", s.z0).num("x1", s.x1).num("y1", s.y1).num("z1", s.z1).end();
    out.push_str(",\"stats\":");
    let t = &c.stats;
    Obj::new(&mut out).num("blockCount", t.block_count).num("moveCount", t.move_count).num("rapidRate", exec::RAPID_RATE).num("pathFeed", t.path_feed)
        .num("pathRapid", t.path_rapid).num("pathTotal", t.path_feed + t.path_rapid).num("cycleTime", t.cycle_time).num("minZ", t.min_z).num("maxZ", t.max_z)
        .raw("toolsUsed", |w| { w.push('['); for (i, x) in t.tools_used.iter().enumerate() { if i > 0 { w.push(','); } tool_stat_json(w, x); } w.push(']'); })
        .num("removedVolume", t.removed).end();
    out.push_str(",\"exec\":[");
    for (i, e) in c.exec.iter().enumerate() { if i > 0 { out.push(','); } num(&mut out, *e as f64); }
    out.push_str("],\"errors\":[");
    let all = p.errors.iter().chain(c.errors.iter());
    for (i, (b, m)) in all.enumerate() { if i > 0 { out.push(','); } out.push_str("{\"block\":"); num(&mut out, *b as f64); out.push_str(",\"msg\":"); string(&mut out, m); out.push('}'); }
    out.push(']');
    if let Some(h) = h { out.push_str(",\"h\":"); num(&mut out, h as f64); }
    out.push('}');
    (out, c)
}

/// The checks on a compiled run: expand, the height-field grid, analyse (what ui.js verifyProgram and the server do)
pub fn check(c: &Compiled, s_max: f64, vice_on: bool) -> (Vec<sim::Seg>, f64, stock::Grid, Vec<sim::Event>, f64, f64) {
    let (segs, total) = sim::expand(&c.moves, exec::RAPID_RATE);
    let st = stock_of(&c.stock);
    let g = sim::grid_for(&st, &segs);
    let (ev, feed, cut) = sim::analyse(&st, &segs, &g, s_max, &stock::Vice { on: vice_on });
    (segs, total, g, ev, feed, cut)
}
pub fn stock_of(s: &exec::Stock) -> stock::St { stock::St { x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1 } }

/// TNC.parse(text) as JSON: {blocks, errors}
pub fn parse_json(text: &str) -> String {
    let p = parse::parse(text);
    let mut out = String::from("{\"blocks\":[");
    for (i, b) in p.blocks.iter().enumerate() { if i > 0 { out.push(','); } val::block(&mut out, b); }
    out.push_str("],\"errors\":[");
    for (i, (b, m)) in p.errors.iter().enumerate() { if i > 0 { out.push(','); } out.push_str("{\"block\":"); num(&mut out, *b as f64); out.push_str(",\"msg\":"); string(&mut out, m); out.push('}'); }
    out.push_str("]}");
    out
}

/* ---- WebAssembly: JSON in, JSON out through linear memory ---- */
static mut OUT: Vec<u8> = Vec::new();

/// # Safety
/// Called by the JS glue only: returns a buffer of `n` bytes the caller fills and passes back.
#[no_mangle]
pub unsafe extern "C" fn tnc_alloc(n: usize) -> *mut u8 { let mut v = Vec::<u8>::with_capacity(n); let p = v.as_mut_ptr(); std::mem::forget(v); p }
/// # Safety
/// `p` / `n` must come from `tnc_alloc`.
#[no_mangle]
pub unsafe extern "C" fn tnc_free(p: *mut u8, n: usize) { drop(Vec::from_raw_parts(p, 0, n)); }
/// # Safety
/// Both buffers must be valid UTF-8 written into memory from `tnc_alloc`. The result stays valid until the next call.
#[no_mangle]
pub unsafe extern "C" fn tnc_run(tp: *const u8, tl: usize, op: *const u8, ol: usize) -> usize {
    let text = std::str::from_utf8_unchecked(std::slice::from_raw_parts(tp, tl));
    let opts = opts_from_json(std::str::from_utf8_unchecked(std::slice::from_raw_parts(op, ol)));
    let runs = &mut *std::ptr::addr_of_mut!(RUNS);
    let h = runs.last().map(|r| r.0 + 1).unwrap_or(1);
    let (s, c) = run_full(text, &opts, Some(h));
    runs.push((h, c, opts.mach.s_max));
    if runs.len() > KEEP { runs.remove(0); }
    put_out(s)
}
/* the last few runs, by handle: TNC_SIM.expand / analyse work on them (no move list travels back in) */
const KEEP: usize = 6;
static mut RUNS: Vec<(u32, Compiled, f64)> = Vec::new();
unsafe fn retained(h: u32) -> Option<&'static (u32, Compiled, f64)> { (*std::ptr::addr_of!(RUNS)).iter().find(|r| r.0 == h) }
unsafe fn put_out(s: String) -> usize { let out = &mut *std::ptr::addr_of_mut!(OUT); *out = s.into_bytes(); out.len() }
/// # Safety
/// TNC_SIM.expand for a retained run: {segs, total}; 0 = the handle is gone.
#[no_mangle]
pub unsafe extern "C" fn tnc_expand(h: u32) -> usize {
    let Some(r) = retained(h) else { return 0 };
    let (segs, total) = sim::expand(&r.1.moves, exec::RAPID_RATE);
    let mut s = String::with_capacity(segs.len() * 300 + 32);
    sim::segs_json(&mut s, &segs, total);
    put_out(s)
}
/// # Safety
/// TNC_SIM.analyse for a retained run on grid (nx, ny, dx, dy): {events, cut}; 0 = the handle is gone.
#[no_mangle]
pub unsafe extern "C" fn tnc_analyse(h: u32, nx: f64, ny: f64, dx: f64, dy: f64, vice_on: u32) -> usize {
    let Some(r) = retained(h) else { return 0 };
    let (segs, _) = sim::expand(&r.1.moves, exec::RAPID_RATE);
    let st = stock_of(&r.1.stock);
    let (ev, feed, cut) = sim::analyse(&st, &segs, &stock::Grid { nx, ny, dx, dy }, r.2, &stock::Vice { on: vice_on != 0 });
    let mut s = String::new();
    sim::events_json(&mut s, &ev, feed, cut);
    put_out(s)
}
/* numbers out of the stock calls go through a small scratch buffer */
static mut SCRATCH: [f64; 16] = [0.0; 16];
/// # Safety
/// Pointer to the scratch buffer (16 f64).
#[no_mangle]
pub unsafe extern "C" fn tnc_scratch() -> *const f64 { std::ptr::addr_of!(SCRATCH) as *const f64 }
unsafe fn scratch() -> &'static mut [f64; 16] { &mut *std::ptr::addr_of_mut!(SCRATCH) }
/// # Safety
/// TNC_STOCK.grid: NX NY DX DY into the scratch buffer.
#[no_mangle]
pub unsafe extern "C" fn tnc_grid(x0: f64, y0: f64, x1: f64, y1: f64, min_r: f64) {
    let g = stock::grid(&stock::St { x0, y0, z0: 0.0, x1, y1, z1: 0.0 }, min_r);
    let s = scratch();
    s[0] = g.nx; s[1] = g.ny; s[2] = g.dx; s[3] = g.dy;
}
/// # Safety
/// TNC_STOCK.axis: 1 and the axis in scratch[0..3], or 0 (vertical).
#[no_mangle]
pub unsafe extern "C" fn tnc_axis(has_a: u32, aa: f64, ab: f64, has_b: u32, ba: f64, bb: f64, u: f64) -> u32 {
    match stock::axis(if has_a != 0 { Some((aa, ab)) } else { None }, if has_b != 0 { Some((ba, bb)) } else { None }, u) {
        None => 0,
        Some(a) => { let s = scratch(); s[0] = a[0]; s[1] = a[1]; s[2] = a[2]; 1 }
    }
}
/// # Safety
/// TNC_STOCK.vice: the jaw boxes (x0 x1 y0 y1 z0 z1 each) into scratch; returns how many.
#[no_mangle]
pub unsafe extern "C" fn tnc_vice(x0: f64, y0: f64, z0: f64, x1: f64, y1: f64, z1: f64, on: u32) -> u32 {
    let b = stock::vice(&stock::St { x0, y0, z0, x1, y1, z1 }, &stock::Vice { on: on != 0 });
    let s = scratch();
    for (i, j) in b.iter().enumerate() { s[i * 6] = j.x0; s[i * 6 + 1] = j.x1; s[i * 6 + 2] = j.y0; s[i * 6 + 3] = j.y1; s[i * 6 + 4] = j.z0; s[i * 6 + 5] = j.z1; }
    b.len() as u32
}
#[allow(clippy::too_many_arguments)]
fn stamp_args(x0: f64, y0: f64, z0: f64, x1: f64, y1: f64, z1: f64, nx: f64, ny: f64, dx: f64, dy: f64, tool_r: f64, cone: u32, ball: u32, tool_r2: f64, stick: f64,
              px: f64, py: f64, pz: f64, has_ax: u32, ax: f64, ay: f64, az: f64) -> (stock::St, stock::Grid, stock::Tool, stock::P, stock::Ax) {
    (stock::St { x0, y0, z0, x1, y1, z1 }, stock::Grid { nx, ny, dx, dy }, stock::Tool { tool_r, cone: cone != 0, ball: ball != 0, tool_r2, stick },
     stock::P { x: px, y: py, z: pz }, if has_ax != 0 { Some([ax, ay, az]) } else { None })
}
/// # Safety
/// TNC_STOCK.stamp, step 1: the columns it can touch (i0 i1 j0 j1) into scratch.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn tnc_stamp_range(x0: f64, y0: f64, z0: f64, x1: f64, y1: f64, z1: f64, nx: f64, ny: f64, dx: f64, dy: f64, tool_r: f64, cone: u32, ball: u32, tool_r2: f64, stick: f64,
                                         px: f64, py: f64, pz: f64, has_ax: u32, ax: f64, ay: f64, az: f64) {
    let (st, g, t, p, a) = stamp_args(x0, y0, z0, x1, y1, z1, nx, ny, dx, dy, tool_r, cone, ball, tool_r2, stick, px, py, pz, has_ax, ax, ay, az);
    let r = stock::stamp_range(&st, &g, &t, &p, &a);
    let s = scratch();
    s[0] = r[0]; s[1] = r[1]; s[2] = r[2]; s[3] = r[3];
}
/// # Safety
/// TNC_STOCK.stamp, step 2: stamp into the window (columns i0.., rows j0.., wnx wide) the caller copied in.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn tnc_stamp_win(win: *mut f32, wlen: usize, i0: f64, j0: f64, wnx: f64, x0: f64, y0: f64, z0: f64, x1: f64, y1: f64, z1: f64, nx: f64, ny: f64, dx: f64, dy: f64,
                                       tool_r: f64, cone: u32, ball: u32, tool_r2: f64, stick: f64, px: f64, py: f64, pz: f64, has_ax: u32, ax: f64, ay: f64, az: f64, eps: f64) -> u32 {
    let (st, g, t, p, a) = stamp_args(x0, y0, z0, x1, y1, z1, nx, ny, dx, dy, tool_r, cone, ball, tool_r2, stick, px, py, pz, has_ax, ax, ay, az);
    let w = std::slice::from_raw_parts_mut(win, wlen);
    let mut f = stock::Window { w, i0: i0 as usize, j0: j0 as usize, wnx: wnx as usize };
    stock::stamp(&mut f, &st, &g, &t, &p, &a, eps) as u32
}

/// # Safety
/// As tnc_run, for TNC.parse.
#[no_mangle]
pub unsafe extern "C" fn tnc_parse(tp: *const u8, tl: usize) -> usize {
    let text = std::str::from_utf8_unchecked(std::slice::from_raw_parts(tp, tl));
    let out = &mut *std::ptr::addr_of_mut!(OUT);
    *out = parse_json(text).into_bytes();
    out.len()
}
/// # Safety
/// Pointer to the last result.
#[no_mangle]
pub unsafe extern "C" fn tnc_out() -> *const u8 { (*std::ptr::addr_of!(OUT)).as_ptr() }
