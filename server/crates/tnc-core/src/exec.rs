//! Sections 4-8 of core.js: machine state, transformations, emit, cycles, touch probe cycles, execution, the
//! contour (radius compensation) pass and the statistics. A line-by-line transliteration: same order of floating
//! point operations, same guards, same quirks, so the moves and errors come out identical.

use crate::js::{self, PI};
use crate::parse::{self, lbl_key, num_or_q, Lbl, EPS};
use crate::val::{Ast, Block, Kind, NQ, V};
use regex_lite::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

pub const RAPID_RATE: f64 = 18000.0;
const DEFAULT_FEED: f64 = 500.0;
const MAX_MOVES: usize = 400000;
const MAX_DEPTH: i32 = 30;
const MAX_STEPS: usize = 2000000;
const ARC_TOL: f64 = 0.05;
const PROBE_F: f64 = 500.0;
const PROBE_RAPID: f64 = 5000.0;
const PROBE_CLR: f64 = 2.0;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        fn $name() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new($pat).unwrap()) }
    };
}

fn implemented(n: f64) -> bool { [1., 2., 4., 17., 18., 21., 22., 23., 24., 25., 200., 201., 202., 203., 204., 205., 206., 207., 208., 209., 210., 211., 212., 213., 214., 215., 230., 231., 262., 263., 264., 265., 267.].contains(&n) }
fn pattern_cycle(n: f64) -> bool { n == 220.0 || n == 221.0 }
fn nomotion(n: f64) -> bool { [7., 8., 9., 10., 11., 14., 19., 20., 32., 247.].contains(&n) }
fn probe_cycle(n: f64) -> bool { [408., 409., 410., 411., 412., 413., 417., 419.].contains(&n) }
fn tt_cycle(n: f64) -> bool { [30., 31., 32., 33., 480., 481., 482., 483., 562.].contains(&n) }

/* ------------------------------------------------------------------ small types */

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct P3 { pub x: f64, pub y: f64, pub z: f64 }
fn p3(x: f64, y: f64, z: f64) -> P3 { P3 { x, y, z } }

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rot { pub a: f64, pub b: f64, pub c: f64 }

/// A JS property that can be missing (undefined), null, or a value.
#[derive(Clone, Debug, PartialEq)]
pub enum J<T> { Absent, Null, Val(T) }
impl<T: Clone> J<T> {
    pub fn val(&self) -> Option<T> { if let J::Val(v) = self { Some(v.clone()) } else { None } }
}

/// Q parameters: a JS object keyed by the parameter number.
#[derive(Default, Clone)]
pub struct QMap(HashMap<u64, f64>);
impl QMap {
    fn k(q: f64) -> u64 { if q == 0.0 { 0f64.to_bits() } else { q.to_bits() } }
    /// NaN when the parameter was never written (reads treat non-finite as 0)
    pub fn get(&self, q: f64) -> f64 { *self.0.get(&Self::k(q)).unwrap_or(&f64::NAN) }
    pub fn set(&mut self, q: f64, v: f64) { self.0.insert(Self::k(q), v); }
}

pub fn resolve(v: Option<NQ>, q: &QMap) -> Option<f64> {
    match v {
        None => None,
        Some(NQ::N(x)) => Some(x),
        Some(NQ::Q(i, neg)) => { let x = q.get(i); let x = if x.is_finite() { x } else { 0.0 }; Some(if neg { -x } else { x }) }
    }
}
fn resolve_v(v: Option<&V>, q: &QMap) -> Option<f64> {
    match v { Some(V::Num(x)) => Some(*x), Some(V::Q(i, n)) => resolve(Some(NQ::Q(*i, *n)), q), _ => None }
}

#[derive(Clone, Debug)]
pub struct ToolEntry { pub t: f64, pub name: J<String>, pub l: f64, pub r: f64 }

#[derive(Clone, Debug, Default)]
pub struct Mach {
    pub arc_tol: f64, pub pocket_k: f64, pub f_max: f64, pub accel: f64, pub s_max: f64,
    pub rapid: Option<[f64; 6]>, // x y z a b c (NaN = missing)
    pub limits: HashMap<char, [f64; 2]>,
    pub axes: Vec<String>,
    pub c19pos_false: bool,
    /// MP 7420 (SL cycles), NaN = 0
    pub mp7420: f64,
    pub probe: Option<[f64; 3]>, // f rapid clr (NaN = missing)
}

#[derive(Clone, Debug)]
pub struct Opts { pub tools: Option<Vec<ToolEntry>>, pub mach: Mach, pub holder_a: Option<f64>, pub auto_tools: bool }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MK { Rapid, Feed, Arc }
impl MK { pub fn as_str(self) -> &'static str { match self { MK::Rapid => "rapid", MK::Feed => "feed", MK::Arc => "arc" } } }

#[derive(Clone, Debug)]
pub struct Move {
    pub kind: MK, pub from: P3, pub to: P3, pub cx: Option<f64>, pub cy: Option<f64>, pub ccw: bool, pub sweep: Option<f64>,
    pub feed: f64, pub tool: f64, pub tool_r: f64, pub tool_dr: f64, pub tool_l: J<f64>, pub stick: J<f64>, pub tool_name: J<String>,
    pub spindle: f64, pub s_rpm: J<f64>, pub coolant: bool, pub block: f64, pub cycle: Option<String>, pub rc: Option<String>, pub rc_act: bool,
    pub seq: J<f64>, pub rot0: Option<Rot>, pub rot1: Option<Rot>, pub dur: Option<f64>, pub len: f64, pub probe: bool, pub touch: bool,
}

#[derive(Clone, Debug)]
pub struct Mark {
    pub mark: &'static str, pub r: f64, pub len: f64, pub feed: Option<f64>, pub block: f64, pub seq: f64,
    pub form: String, pub side: Option<String>, pub cca: f64, pub entry_feed: f64, pub from: P3, pub to: Option<P3>, pub has_z: bool,
    pub rc: Option<String>, pub tool: f64, pub tool_r: f64, pub tool_dr: f64, pub tool_name: J<String>, pub spindle: f64, pub coolant: bool,
}

#[derive(Clone, Debug)]
pub enum Item { M(Move), K(Mark) }
impl Item {
    fn is_mark(&self) -> bool { matches!(self, Item::K(_)) }
    fn rc(&self) -> Option<&str> { match self { Item::M(m) => m.rc.as_deref(), Item::K(k) => k.rc.as_deref() } }
    fn rc_act(&self) -> bool { match self { Item::M(m) => m.rc_act, Item::K(_) => false } }
    fn mv(&self) -> &Move { if let Item::M(m) = self { m } else { panic!("mark") } }
    fn mv_mut(&mut self) -> &mut Move { if let Item::M(m) = self { m } else { panic!("mark") } }
}

#[derive(Clone, Debug)]
struct Arc { cx: f64, cy: f64, ccw: bool, sweep: Option<f64> }

#[derive(Clone, Debug, Default)]
struct Xf { on: bool, px: f64, py: f64, pz: f64, dx: f64, dy: f64, dz: f64, mx: bool, my: bool, mz: bool, rot: f64, s: f64, flip: bool, tilt: Option<[f64; 9]> }

#[derive(Clone, Copy, Debug, PartialEq)]
enum Plane { XY, ZX, YZ }
#[derive(Clone, Debug)]
struct Cc { x: f64, y: f64, z: Option<f64>, plane: Option<Plane> }
impl Cc {
    fn ax(&self, k: char) -> f64 { match k { 'x' => self.x, 'y' => self.y, _ => self.z.unwrap_or(f64::NAN) } }
}
fn pget(p: &P3, k: char) -> f64 { match k { 'x' => p.x, 'y' => p.y, _ => p.z } }
fn pset(p: &mut P3, k: char, v: f64) { match k { 'x' => p.x = v, 'y' => p.y = v, _ => p.z = v } }

/// A cycle as gatherCycle() builds it. Params / order values are None where JSON.stringify would have made them null.
#[derive(Clone, Debug)]
pub struct Cycle {
    num: f64, name: String, params: HashMap<u64, Option<f64>>, order: Vec<Option<f64>>, subs: HashMap<u64, Vec<f64>>,
    bodies: Option<Vec<(f64, String)>>, dot: bool, dr: String, label: String,
}
fn qk(n: f64) -> u64 { if n == 0.0 { 0f64.to_bits() } else { n.to_bits() } }
fn qp(cy: &Cycle, n: f64, dflt: f64) -> f64 { match cy.params.get(&qk(n)) { Some(Some(v)) if v.is_finite() => *v, _ => dflt } }
fn sub(cy: &Cycle, s: f64, i: usize, dflt: f64) -> f64 { match cy.subs.get(&qk(s)) { Some(a) => match a.get(i) { Some(v) if v.is_finite() => *v, _ => dflt }, None => dflt } }
fn body(cy: &Cycle, q: f64) -> Option<&str> { cy.bodies.as_ref().and_then(|b| b.iter().rev().find(|(k, _)| *k == q).map(|(_, s)| s.as_str())) }
fn params_lit(label: &str, kv: &[(f64, f64)]) -> Cycle {
    Cycle { num: f64::NAN, name: String::new(), params: kv.iter().map(|(k, v)| (qk(*k), Some(*v))).collect(), order: vec![], subs: HashMap::new(), bodies: None, dot: false, dr: "+".into(), label: label.into() }
}

#[derive(Clone, Debug, Default)]
pub struct Stock { pub x0: f64, pub y0: f64, pub z0: f64, pub x1: f64, pub y1: f64, pub z1: f64 }

#[derive(Clone, Debug)]
pub struct ToolStat { pub t: f64, pub name: J<String>, pub r: f64, pub l: f64, pub moves: f64, pub time: f64 }

#[derive(Clone, Debug)]
struct Tool { t: f64, name: J<String>, r: f64, l: f64, dr: f64 }

pub struct St<'a> {
    blocks: &'a mut Vec<Block>,
    pos: P3, mpos: P3, xf: Xf, steps: usize, pub exec: Vec<usize>, seq: f64,
    rot: Rot, rot_to: Option<[Option<f64>; 3]>,
    feed: f64, tool: Tool, spindle: f64, s_rpm: f64, spin_dir: f64, coolant: bool,
    cc: Option<Cc>, rc: String, rc_act: bool, last_tan: Option<(f64, f64)>,
    tool_defs: HashMap<String, ToolEntry>, presets: HashMap<String, Vec<(char, f64)>>, q: QMap, cycle: Option<Cycle>,
    pub moves: Vec<Item>, pub errors: Vec<(usize, String)>, pub stock: Stock, abort: bool, done: bool,
    tool_order: Vec<f64>, tool_stat: HashMap<String, ToolStat>,
    tool_table: Vec<ToolEntry>, mach: Mach, arc_tol: f64, holder: Option<f64>, auto_tools: bool,
    labels: HashMap<String, usize>, comment_tools: HashMap<String, f64>, auto_feed: f64,
    /// SL cycles: capturing a contour subprogram (emit records program coordinates only); cycle 14 labels; cycle 20 data
    cap: bool, sl_labels: Option<Vec<f64>>, sl_data: Option<Cycle>,
}

fn fail(st: &mut St, bi: usize, msg: &str) {
    if st.errors.iter().any(|(b, m)| *b == bi && m == msg) { return; }
    st.errors.push((bi, msg.to_string()));
    if let Some(b) = st.blocks.get_mut(bi) { if b.error.as_deref().map(|e| e.is_empty()).unwrap_or(true) { b.error = Some(msg.to_string()); } }
}

/* ------------------------------------------------------------------ transformations */

fn to_m(st: &St, p: P3) -> P3 {
    let f = &st.xf; if !f.on { return p; }
    let mut x = if f.mx { -p.x } else { p.x }; let mut y = if f.my { -p.y } else { p.y }; let mut z = if f.mz { -p.z } else { p.z };
    x *= f.s; y *= f.s; z *= f.s;
    let c = js::cos(f.rot * PI / 180.0); let sn = js::sin(f.rot * PI / 180.0);
    let mut xx = x * c - y * sn; let mut yy = x * sn + y * c;
    if let Some(t) = f.tilt { let x2 = t[0] * xx + t[1] * yy + t[2] * z; let y2 = t[3] * xx + t[4] * yy + t[5] * z; let z2 = t[6] * xx + t[7] * yy + t[8] * z; xx = x2; yy = y2; z = z2; }
    p3(xx + f.dx + f.px, yy + f.dy + f.py, z + f.dz + f.pz)
}
fn from_m(st: &St, p: P3) -> P3 {
    let f = &st.xf; if !f.on { return p; }
    let mut x = p.x - f.dx - f.px; let mut y = p.y - f.dy - f.py; let mut z = p.z - f.dz - f.pz;
    if let Some(t) = f.tilt { let x2 = t[0] * x + t[3] * y + t[6] * z; let y2 = t[1] * x + t[4] * y + t[7] * z; let z2 = t[2] * x + t[5] * y + t[8] * z; x = x2; y = y2; z = z2; }
    let c = js::cos(f.rot * PI / 180.0); let sn = js::sin(f.rot * PI / 180.0);
    let mut xr = x * c + y * sn; let mut yr = -x * sn + y * c;
    xr /= f.s; yr /= f.s; z /= f.s;
    p3(if f.mx { -xr } else { xr }, if f.my { -yr } else { yr }, if f.mz { -z } else { z })
}
fn xf_on(f: &Xf) -> bool {
    js::truthy(f.px) || js::truthy(f.py) || js::truthy(f.pz) || js::truthy(f.dx) || js::truthy(f.dy) || js::truthy(f.dz) || f.mx || f.my || f.mz || js::truthy(f.rot) || f.s != 1.0 || f.tilt.is_some()
}
fn flip_rc(st: &St, rc: Option<&str>) -> Option<String> {
    match rc { Some("RL") if st.xf.flip => Some("RR".into()), Some("RR") if st.xf.flip => Some("RL".into()), r => r.map(|s| s.to_string()) }
}

re!(re_c7, r"^(I)?([XYZ])(\S+)$");
re!(re_noent, r"NO\s*ENT|^\s*$");
re!(re_mx, r"(^|\s)X\b");
re!(re_my, r"(^|\s)Y\b");
re!(re_mz, r"(^|\s)Z\b");
re!(re_rot10, r"(I)?ROT\s*([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))");
re!(re_abc, r"^([ABC])(\S+)$");
re!(re_scl, r"SCL\s*([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))");

fn apply_transform(st: &mut St, cy: &Cycle, bi: usize) {
    let all = match &cy.bodies {
        None => String::new(),
        Some(b) => {
            // Object.keys(subs).sort(): integer keys, then sorted as strings
            let mut keys: Vec<(String, f64)> = Vec::new();
            for (k, _) in b { let ks = js::num_str(*k); if !keys.iter().any(|(s, _)| *s == ks) { keys.push((ks, *k)); } }
            keys.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
            keys.iter().map(|(_, k)| body(cy, *k).unwrap_or("").to_string()).collect::<Vec<_>>().join(" ")
        }
    };
    if cy.num == 7.0 {
        for t in js::words(&all) {
            if let Some(m) = re_c7().captures(t) {
                let v = resolve(num_or_q(&m[3]), &st.q);
                let v = match v { None => { fail(st, bi, "CYCL DEF INCOMPLETE"); continue; } Some(v) => v };
                let inc = m.get(1).is_some();
                let f = &mut st.xf;
                match &m[2] { "X" => f.dx = if inc { f.dx + v } else { v }, "Y" => f.dy = if inc { f.dy + v } else { v }, _ => f.dz = if inc { f.dz + v } else { v } }
            }
        }
    } else if cy.num == 8.0 {
        if re_noent().is_match(&all) { st.xf.mx = false; st.xf.my = false; st.xf.mz = false; }
        else { st.xf.mx = re_mx().is_match(&all); st.xf.my = re_my().is_match(&all); st.xf.mz = re_mz().is_match(&all); }
    } else if cy.num == 10.0 {
        if let Some(m) = re_rot10().captures(&all) {
            let v = js::or(resolve(num_or_q(&m[2]), &st.q).unwrap_or(0.0), 0.0);
            st.xf.rot = if m.get(1).is_some() { st.xf.rot + v } else { v };
        } else { fail(st, bi, "CYCL DEF INCOMPLETE"); }
    } else if cy.num == 19.0 {
        let mut ang = [0.0f64; 3]; let mut any = false;
        for w in js::words(&all) {
            if let Some(mm) = re_abc().captures(w) {
                if let Some(vv) = resolve(num_or_q(&mm[2]), &st.q) { ang[match &mm[1] { "A" => 0, "B" => 1, _ => 2 }] = vv; any = true; }
            }
        }
        if !any || (!js::truthy(ang[0]) && !js::truthy(ang[1]) && !js::truthy(ang[2])) { st.xf.tilt = None; }
        else {
            let a = ang[0] * PI / 180.0; let b = -ang[1] * PI / 180.0;
            let (ca, sa, cb, sb) = (js::cos(a), js::sin(a), js::cos(b), js::sin(b));
            st.xf.tilt = Some([cb, sb * sa, sb * ca, 0.0, ca, -sa, -sb, cb * sa, cb * ca]);
        }
        if !st.mach.c19pos_false && st.mach.axes.iter().any(|x| x == "A" || x == "B") {
            st.rot_to = Some([Some(ang[0]), Some(ang[1]), None]);
            st.xf.on = true; st.pos = from_m(st, st.mpos);
            let p = st.pos;
            emit(st, MK::Rapid, p, RAPID_RATE, bi, None, None);
        }
    } else if cy.num == 11.0 {
        if let Some(m) = re_scl().captures(&all) {
            let v = resolve(num_or_q(&m[1]), &st.q);
            match v { Some(v) if v > 0.0 => st.xf.s = v, _ => fail(st, bi, "CYCL DEF INCOMPLETE") }
        } else { fail(st, bi, "CYCL DEF INCOMPLETE"); }
    }
    st.xf.flip = st.xf.mx != st.xf.my;
    st.xf.on = xf_on(&st.xf);
    st.pos = from_m(st, st.mpos);
}

/* ------------------------------------------------------------------ geometry + emit */

fn dist3(a: P3, b: P3) -> f64 { let dx = b.x - a.x; let dy = b.y - a.y; let dz = b.z - a.z; js::sqrt(dx * dx + dy * dy + dz * dz) }
fn sweep_angle(p1: P3, p2: P3, cx: f64, cy: f64, ccw: bool) -> f64 {
    let a1 = js::atan2(p1.y - cy, p1.x - cx); let a2 = js::atan2(p2.y - cy, p2.x - cx);
    let mut d = a2 - a1;
    if ccw { while d <= EPS { d += 2.0 * PI; } } else { while d >= -EPS { d -= 2.0 * PI; } }
    d
}
fn arc_sweep(from: P3, to: P3, arc: &Arc) -> f64 { match arc.sweep { Some(s) => s, None => sweep_angle(from, to, arc.cx, arc.cy, arc.ccw) } }

fn stick_of(st: &St) -> Option<f64> {
    let l = st.tool.l;
    let h = st.holder?;
    if !(l > 0.0) || !js::truthy(st.tool.t) { return None; }
    Some(js::max(l - h, 0.25 * l))
}

fn emit(st: &mut St, kind: MK, to: P3, feed: f64, bi: usize, cycle: Option<&str>, arc: Option<&Arc>) {
    if st.abort { return; }
    if st.cap { sl::capture_move(st, kind, to, feed, bi, arc); return; }
    if kind == MK::Arc && st.xf.tilt.is_some() {
        let arc = arc.unwrap();
        let p0 = st.pos; let sw0 = arc_sweep(p0, to, arc); let r0_ = js::hypot2(p0.x - arc.cx, p0.y - arc.cy); let a00 = js::atan2(p0.y - arc.cy, p0.x - arc.cx);
        let nch = js::max(8.0, js::ceil(sw0.abs() / (PI / 36.0))); let z0_ = p0.z;
        let mut ci = 1.0;
        while ci <= nch {
            let an = a00 + sw0 * ci / nch;
            let t = if ci == nch { to } else { p3(arc.cx + r0_ * js::cos(an), arc.cy + r0_ * js::sin(an), z0_ + (to.z - z0_) * ci / nch) };
            emit(st, MK::Feed, t, feed, bi, cycle, None);
            ci += 1.0;
        }
        return;
    }
    let pfrom = st.pos; let from = st.mpos; let pto = to;
    let to = to_m(st, pto);
    let psw = if kind == MK::Arc { arc_sweep(pfrom, pto, arc.unwrap()) } else { 0.0 };
    let sw = if st.xf.flip { -psw } else { psw };
    let mut mc: Option<P3> = None;
    let len = if kind == MK::Arc {
        let a = arc.unwrap();
        let c = to_m(st, p3(a.cx, a.cy, 0.0)); mc = Some(c);
        let rr = js::sqrt((from.x - c.x) * (from.x - c.x) + (from.y - c.y) * (from.y - c.y));
        js::sqrt(rr * sw * rr * sw + (to.z - from.z) * (to.z - from.z))
    } else { dist3(from, to) };
    let tag_rc = if cycle.is_some() { None } else { flip_rc(st, if st.rc == "RL" || st.rc == "RR" { Some(st.rc.as_str()) } else { None }) };
    let r0 = st.rot; let mut r1 = r0; let mut d_rot = 0.0;
    if let Some(rt) = st.rot_to.take() {
        r1 = Rot { a: rt[0].unwrap_or(r0.a), b: rt[1].unwrap_or(r0.b), c: rt[2].unwrap_or(r0.c) };
        for (i, k) in ['A', 'B', 'C'].iter().enumerate() {
            let l = match st.mach.limits.get(k) { Some(l) => *l, None => continue };
            let v = match i { 0 => &mut r1.a, 1 => &mut r1.b, _ => &mut r1.c };
            if *v > l[1] + 1e-9 { let msg = format!("LIMIT SWITCH {}+", k); *v = l[1]; let vv = *v; let _ = vv; fail(st, bi, &msg); }
            let v = match i { 0 => &mut r1.a, 1 => &mut r1.b, _ => &mut r1.c };
            if *v < l[0] - 1e-9 { let msg = format!("LIMIT SWITCH {}-", k); *v = l[0]; fail(st, bi, &msg); }
        }
        d_rot = js::max_n(&[(r1.a - r0.a).abs(), (r1.b - r0.b).abs(), (r1.c - r0.c).abs()]);
        st.rot = r1;
    }
    if !(len > EPS) && !(tag_rc.is_some() && st.rc_act) && !(d_rot > EPS) { st.pos = pto; st.mpos = to; return; }
    let mut feed = feed; let mut dur = None;
    let m = &st.mach;
    if kind != MK::Rapid && js::truthy(m.f_max) && feed > m.f_max { feed = m.f_max; }
    if m.rapid.is_some() || js::truthy(m.accel) {
        let r = m.rapid.unwrap_or([f64::NAN; 6]);
        let tmin = if kind == MK::Rapid {
            js::max_n(&[(to.x - from.x).abs() / js::or(r[0], RAPID_RATE), (to.y - from.y).abs() / js::or(r[1], RAPID_RATE), (to.z - from.z).abs() / js::or(r[2], RAPID_RATE),
                (r1.a - r0.a).abs() / js::or(r[3], 3600.0), (r1.b - r0.b).abs() / js::or(r[4], 3600.0), (r1.c - r0.c).abs() / js::or(r[5], 3600.0)])
        } else { js::max_n(&[len / js::max(feed, 1.0), (r1.a - r0.a).abs() / 800.0, (r1.b - r0.b).abs() / 720.0]) };
        let mut sec = tmin * 60.0;
        if js::truthy(m.accel) && len > EPS {
            let v = len / js::max(sec, 1e-9); let acc = m.accel * 1000.0;
            sec = if len >= v * v / acc { len / v + v / acc } else { 2.0 * js::sqrt(len / acc) };
        }
        dur = Some(sec);
    }
    let rot_truthy = |r: &Rot| js::truthy(r.a) || js::truthy(r.b) || js::truthy(r.c);
    let mv = Move {
        kind, from, to, cx: mc.map(|c| c.x), cy: mc.map(|c| c.y), ccw: if arc.is_some() { sw > 0.0 } else { false }, sweep: if arc.is_some() { Some(sw) } else { None },
        feed: if kind == MK::Rapid { RAPID_RATE } else { feed }, tool: st.tool.t, tool_r: st.tool.r, tool_dr: js::or(st.tool.dr, 0.0),
        tool_l: J::Val(if st.tool.l > 0.0 { st.tool.l } else { 0.0 }), stick: match stick_of(st) { Some(s) => J::Val(s), None => J::Null },
        tool_name: st.tool.name.clone(), spindle: st.spindle, s_rpm: J::Val(st.s_rpm), coolant: st.coolant, block: bi as f64,
        cycle: cycle.map(|s| s.to_string()).filter(|s| !s.is_empty()), rc: tag_rc.clone(), rc_act: tag_rc.is_some() && st.rc_act, seq: J::Val(st.seq),
        rot0: if d_rot > EPS || rot_truthy(&r0) { Some(r0) } else { None }, rot1: if d_rot > EPS || rot_truthy(&r1) { Some(r1) } else { None },
        dur, len, probe: false, touch: false,
    };
    st.moves.push(Item::M(mv));
    if tag_rc.is_some() { st.rc_act = false; }
    if kind == MK::Arc {
        let a = arc.unwrap();
        let ea = js::atan2(pto.y - a.cy, pto.x - a.cx); let d = if psw > 0.0 { 1.0 } else { -1.0 };
        st.last_tan = Some((-js::sin(ea) * d, js::cos(ea) * d));
    } else {
        let dx = pto.x - pfrom.x; let dy = pto.y - pfrom.y; let l = js::sqrt(dx * dx + dy * dy);
        if l > EPS { st.last_tan = Some((dx / l, dy / l)); }
    }
    st.pos = pto; st.mpos = to;
    if st.moves.len() >= MAX_MOVES { st.abort = true; fail(st, bi, "EXCESSIVE SUBPROGRAM NESTING"); }
}

fn mark(st: &mut St, mut m: Mark) { m.seq = st.seq; st.moves.push(Item::K(m)); }
fn new_mark(mark: &'static str, block: usize) -> Mark {
    Mark { mark, r: 0.0, len: 0.0, feed: None, block: block as f64, seq: 0.0, form: String::new(), side: None, cca: 0.0, entry_feed: 0.0,
        from: p3(0., 0., 0.), to: None, has_z: false, rc: None, tool: 0.0, tool_r: 0.0, tool_dr: 0.0, tool_name: J::Absent, spindle: 0.0, coolant: false }
}

fn apply_m(st: &mut St, list: Option<&Vec<f64>>, start: bool) {
    if let Some(list) = list {
        for &m in list {
            if start {
                if m == 3.0 || m == 13.0 { st.spin_dir = 1.0; } else if m == 4.0 || m == 14.0 { st.spin_dir = -1.0; }
                if m == 8.0 || m == 13.0 || m == 14.0 { st.coolant = true; }
            } else {
                if m == 5.0 || m == 2.0 || m == 30.0 { st.spin_dir = 0.0; }
                if m == 9.0 || m == 2.0 || m == 30.0 { st.coolant = false; }
            }
        }
    }
    st.spindle = st.s_rpm * st.spin_dir;
}
fn has_m99(l: Option<&Vec<f64>>) -> bool { l.map(|l| l.contains(&99.0)).unwrap_or(false) }
fn has_end_m(l: Option<&Vec<f64>>) -> bool { l.map(|l| l.iter().any(|m| *m == 2.0 || *m == 30.0)).unwrap_or(false) }

/* ------------------------------------------------------------------ cycles */

fn gather_cycle(st: &St, def: usize) -> Cycle {
    let b = &st.blocks[def];
    let num = b.args.num("num").unwrap_or(f64::NAN);
    let name = b.args.str("name").unwrap_or("").to_string();
    let mut cy = Cycle { num, name, params: HashMap::new(), order: vec![], subs: HashMap::new(), bodies: None, dot: false, dr: "+".into(), label: String::new() };
    for j in def + 1..st.blocks.len() {
        let p = &st.blocks[j];
        if p.kind == Kind::Blank || p.kind == Kind::Comment { continue; }
        if p.kind != Kind::CyclParm { break; }
        let q = p.args.num("q").unwrap_or(f64::NAN);
        if p.args.truthy("dot") {
            cy.dot = true;
            cy.bodies.get_or_insert_with(Vec::new).push((q, p.args.str("body").unwrap_or("").to_string()));
            let vals = if let Some(V::Nums(v)) = p.args.get("values") { v.clone() } else { vec![] };
            cy.subs.insert(qk(q), vals.clone());
            if let Some(V::Str(d)) = p.args.get("dr") { if !d.is_empty() { cy.dr = d.clone(); } }
            if !vals.is_empty() { cy.order.push(Some(vals[0])); }
        } else {
            let v = resolve_v(p.args.get("value"), &st.q);
            cy.params.insert(qk(q), v);
            cy.order.push(v);
        }
    }
    cy.label = format!("{}{}", if cy.name.is_empty() { String::new() } else { format!("{} ", cy.name) }, js::num_str(cy.num));
    cy
}

fn cycle_drill(st: &mut St, cy: &Cycle, bi: usize, universal: bool) {
    let clr = qp(cy, 200.0, 2.0);
    let dep = -qp(cy, 201.0, 0.0).abs();
    let fpl = js::or(qp(cy, 206.0, st.feed), st.feed);
    let peck = qp(cy, 202.0, 0.0).abs();
    let surf = qp(cy, 203.0, 0.0);
    let clr2 = qp(cy, 204.0, clr);
    let decr = if universal { qp(cy, 212.0, 0.0).abs() } else { 0.0 };
    let brks = if universal { js::max(0.0, js::round(qp(cy, 213.0, 0.0))) } else { 0.0 };
    let minp = if universal { qp(cy, 205.0, 0.0).abs() } else { 0.0 };
    let fret = if universal { if qp(cy, 208.0, RAPID_RATE) == 0.0 { fpl } else { qp(cy, 208.0, RAPID_RATE) } } else { RAPID_RATE };
    let chip_d = if universal { qp(cy, 256.0, 0.2).abs() } else { 0.2 };
    let total = dep.abs(); let safe = surf + clr; let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.as_str();
    if total <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    if fpl <= 0.0 { fail(st, bi, "FEED RATE MISSING"); return; }
    emit(st, MK::Rapid, p3(x, y, safe), RAPID_RATE, bi, Some(lab), None);
    let mut step = if peck > EPS { peck } else { total };
    if universal && minp > EPS && step < minp { step = minp; }
    let mut d = 0.0; let mut guard = 0; let mut breaks_left = brks;
    while d < total - 1e-6 && { guard += 1; guard - 1 < 2000 } && !st.abort {
        d = js::min(d + step, total);
        let zt = surf - d;
        emit(st, MK::Feed, p3(x, y, zt), fpl, bi, Some(lab), None);
        if d >= total - 1e-6 { break; }
        if universal && breaks_left > 0.0 { breaks_left -= 1.0; emit(st, MK::Rapid, p3(x, y, zt + chip_d), RAPID_RATE, bi, Some(lab), None); }
        if universal { emit(st, MK::Feed, p3(x, y, safe), fret, bi, Some(lab), None); } else { emit(st, MK::Rapid, p3(x, y, safe), RAPID_RATE, bi, Some(lab), None); }
        emit(st, MK::Rapid, p3(x, y, zt + 0.2), RAPID_RATE, bi, Some(lab), None);
        if universal && decr > EPS { step = js::max(step - decr, if minp > EPS { minp } else { decr }); }
        if step <= EPS { step = total; }
    }
    if universal { emit(st, MK::Feed, p3(x, y, safe), fret, bi, Some(lab), None); }
    emit(st, MK::Rapid, p3(x, y, surf + clr2), RAPID_RATE, bi, Some(lab), None);
}

fn cycle_ream(st: &mut St, cy: &Cycle, bi: usize) {
    let clr = qp(cy, 200.0, 2.0); let dep = -qp(cy, 201.0, 0.0).abs(); let fpl = js::or(qp(cy, 206.0, st.feed), st.feed);
    let fret = if qp(cy, 208.0, RAPID_RATE) == 0.0 { fpl } else { qp(cy, 208.0, RAPID_RATE) };
    let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr); let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.as_str();
    if dep.abs() <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    if fpl <= 0.0 { fail(st, bi, "FEED RATE MISSING"); return; }
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x, y, surf + dep), fpl, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x, y, surf + clr), fret, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, surf + clr2), RAPID_RATE, bi, Some(lab), None);
}

fn cycle_pocket(st: &mut St, cy: &Cycle, bi: usize) {
    let (mut clr, mut dep, mut peck, mut fpl, mut sx, mut sy, mut feed);
    if cy.dot {
        clr = sub(cy, 1.0, 0, 2.0); dep = sub(cy, 2.0, 0, 0.0); peck = sub(cy, 3.0, 0, 0.0); fpl = sub(cy, 3.0, 1, st.feed);
        sx = sub(cy, 4.0, 0, 0.0); sy = sub(cy, 5.0, 0, 0.0); feed = sub(cy, 6.0, 0, st.feed);
    } else {
        let o = &cy.order; let g = |i: usize| o.get(i).copied().flatten();
        clr = g(0).unwrap_or_else(|| qp(cy, 200.0, 2.0)); dep = g(1).unwrap_or_else(|| qp(cy, 201.0, 0.0)); peck = g(2).unwrap_or_else(|| qp(cy, 202.0, 0.0));
        fpl = g(3).unwrap_or_else(|| qp(cy, 206.0, st.feed)); sx = g(4).unwrap_or(0.0); sy = g(5).unwrap_or(0.0); feed = g(6).unwrap_or(st.feed);
    }
    clr = clr.abs(); dep = -dep.abs(); sx = sx.abs(); sy = sy.abs(); peck = peck.abs();
    if !(fpl > 0.0) { fpl = st.feed; }
    if !(feed > 0.0) { feed = st.feed; }
    let lab = cy.label.clone();
    if sx <= EPS || sy <= EPS || dep.abs() <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    let r = st.tool.r;
    let mut hx = sx / 2.0 - r; let mut hy = sy / 2.0 - r;
    if hx < -EPS || hy < -EPS { fail(st, bi, "TOOL TOO LARGE"); return; }
    hx = js::max(hx, 0.0); hy = js::max(hy, 0.0);
    let (cxp, cyp) = (st.pos.x, st.pos.y);
    let surf = st.pos.z - clr; let bottom = surf + dep;
    let mut step_over = js::or(st.mach.pocket_k, 0.7) * r; if !(step_over > EPS) { step_over = 1.0; }
    let mut rects: Vec<(f64, f64)> = vec![]; let (mut rx, mut ry) = (hx, hy); let mut g = 0;
    while { g += 1; g - 1 < 500 } {
        rects.push((rx, ry));
        if rx <= EPS && ry <= EPS { break; }
        let nrx = js::max(rx - step_over, 0.0); let nry = js::max(ry - step_over, 0.0);
        if nrx == rx && nry == ry { break; }
        rx = nrx; ry = nry;
    }
    rects.reverse();
    let ccw = cy.dr != "-";
    let mut levels = vec![]; let mut zc = surf; let mut gp = 0;
    let dz = if peck > EPS { peck } else { dep.abs() };
    while { gp += 1; gp - 1 < 1000 } { zc = js::max(zc - dz, bottom); levels.push(zc); if zc <= bottom + 1e-6 { break; } }
    emit(st, MK::Rapid, p3(cxp, cyp, surf + clr), RAPID_RATE, bi, Some(&lab), None);
    let mut li = 0;
    while li < levels.len() && !st.abort {
        let z = levels[li];
        emit(st, MK::Rapid, p3(cxp, cyp, (if li == 0 { surf } else { levels[li - 1] }) + 0.2), RAPID_RATE, bi, Some(&lab), None);
        emit(st, MK::Feed, p3(cxp, cyp, z), fpl, bi, Some(&lab), None);
        for &(ax, ay) in &rects {
            let corners: [(f64, f64); 5] = if ccw { [(-ax, -ay), (ax, -ay), (ax, ay), (-ax, ay), (-ax, -ay)] } else { [(-ax, -ay), (-ax, ay), (ax, ay), (ax, -ay), (-ax, -ay)] };
            for c in corners { emit(st, MK::Feed, p3(cxp + c.0, cyp + c.1, z), feed, bi, Some(&lab), None); }
        }
        emit(st, MK::Rapid, p3(cxp, cyp, z), RAPID_RATE, bi, Some(&lab), None);
        li += 1;
    }
    emit(st, MK::Rapid, p3(cxp, cyp, surf + clr), RAPID_RATE, bi, Some(&lab), None);
}

fn spin(st: &mut St, dir: f64) { st.spin_dir = dir; st.spindle = st.s_rpm * st.spin_dir; }

fn cycle_bore(st: &mut St, cy: &Cycle, bi: usize) {
    let clr = qp(cy, 200.0, 2.0); let dep = -qp(cy, 201.0, 0.0).abs(); let fpl = js::or(qp(cy, 206.0, st.feed), st.feed);
    let fret = js::or(qp(cy, 208.0, 0.0), fpl); let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr); let dirn = js::round(qp(cy, 214.0, 0.0));
    let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.as_str(); let keep = st.spin_dir;
    if dep.abs() <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x, y, surf + dep), fpl, bi, Some(lab), None);
    let off = if dirn == 1.0 { (-0.2, 0.0) } else if dirn == 2.0 { (0.0, -0.2) } else if dirn == 3.0 { (0.2, 0.0) } else if dirn == 4.0 { (0.0, 0.2) } else { (0.0, 0.0) };
    spin(st, 0.0);
    emit(st, MK::Feed, p3(x + off.0, y + off.1, surf + dep), fpl, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x + off.0, y + off.1, surf + clr), fret, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, surf + clr2), RAPID_RATE, bi, Some(lab), None);
    spin(st, keep);
}

fn cycle_back_bore(st: &mut St, cy: &Cycle, bi: usize) {
    let clr = qp(cy, 200.0, 2.0); let cb = qp(cy, 249.0, 0.0); let thick = qp(cy, 250.0, 0.0).abs(); let offc = qp(cy, 251.0, 0.0).abs(); let edge = qp(cy, 252.0, 0.0).abs();
    let fpre = js::or(qp(cy, 253.0, RAPID_RATE), RAPID_RATE); let fcb = js::or(qp(cy, 254.0, st.feed), st.feed); let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr);
    let dirn = js::round(qp(cy, 214.0, 1.0)); let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.as_str(); let keep = st.spin_dir;
    if thick <= EPS || cb.abs() <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    let off = if dirn == 1.0 { (-offc, 0.0) } else if dirn == 2.0 { (0.0, -offc) } else if dirn == 3.0 { (offc, 0.0) } else if dirn == 4.0 { (0.0, offc) } else { (-offc, 0.0) };
    let z_start = surf - thick - edge - clr; let z_end = surf - thick - edge + cb.abs();
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    spin(st, 0.0);
    emit(st, MK::Rapid, p3(x + off.0, y + off.1, surf + clr), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x + off.0, y + off.1, z_start), fpre, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x, y, z_start), fpre, bi, Some(lab), None);
    spin(st, js::or(keep, 1.0));
    emit(st, MK::Feed, p3(x, y, z_end), fcb, bi, Some(lab), None);
    spin(st, 0.0);
    emit(st, MK::Feed, p3(x, y, z_start), fpre, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x + off.0, y + off.1, z_start), fpre, bi, Some(lab), None);
    emit(st, MK::Feed, p3(x + off.0, y + off.1, surf + clr), fpre, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, surf + clr2), RAPID_RATE, bi, Some(lab), None);
    spin(st, keep);
}

fn cycle_peck205(st: &mut St, cy: &Cycle, bi: usize) {
    let clr = qp(cy, 200.0, 2.0); let total = qp(cy, 201.0, 0.0).abs(); let fpl = js::or(qp(cy, 206.0, st.feed), st.feed); let peck = qp(cy, 202.0, 0.0).abs();
    let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr); let decr = qp(cy, 212.0, 0.0).abs(); let minp = qp(cy, 205.0, 0.0).abs();
    let up = qp(cy, 258.0, 0.2).abs(); let lo = qp(cy, 259.0, up).abs(); let cbd = qp(cy, 257.0, 0.0).abs(); let cbr = qp(cy, 256.0, 0.2).abs();
    let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.as_str();
    if total <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    let mut step = if peck > EPS { peck } else { total }; let mut d = 0.0; let mut g = 0; let mut since_break = 0.0;
    while d < total - 1e-6 && { g += 1; g - 1 < 2000 } && !st.abort {
        let target = js::min(d + step, total);
        if cbd > EPS {
            while d < target - 1e-6 && { g += 1; g - 1 < 4000 } {
                let nd = js::min(d + cbd - since_break, target); since_break = 0.0;
                emit(st, MK::Feed, p3(x, y, surf - nd), fpl, bi, Some(lab), None); d = nd;
                if d < target - 1e-6 {
                    emit(st, MK::Rapid, p3(x, y, surf - d + cbr), RAPID_RATE, bi, Some(lab), None);
                    emit(st, MK::Feed, p3(x, y, surf - d), fpl, bi, Some(lab), None);
                }
            }
        } else { emit(st, MK::Feed, p3(x, y, surf - target), fpl, bi, Some(lab), None); d = target; }
        if d >= total - 1e-6 { break; }
        let adv = if total > EPS { up + (lo - up) * (d / total) } else { up };
        emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
        emit(st, MK::Rapid, p3(x, y, surf - d + adv), RAPID_RATE, bi, Some(lab), None);
        emit(st, MK::Feed, p3(x, y, surf - d), fpl, bi, Some(lab), None);
        if decr > EPS { step = js::max(step - decr, if minp > EPS { minp } else { decr }); }
    }
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, surf + clr2), RAPID_RATE, bi, Some(lab), None);
}

fn cycle_tap(st: &mut St, cy: &Cycle, bi: usize, kind: f64) {
    let clr = qp(cy, 200.0, 2.0); let dep = qp(cy, 201.0, 0.0).abs(); let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr);
    let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.as_str(); let keep = st.spin_dir; let f;
    if dep <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    let mut pitch = f64::NAN;
    if kind == 206.0 { f = js::or(qp(cy, 206.0, st.feed), st.feed); }
    else { pitch = qp(cy, 239.0, 0.0); f = pitch.abs() * st.s_rpm; if !(f > 0.0) { fail(st, bi, "CYCL DEF INCOMPLETE"); return; } }
    if !js::truthy(keep) && kind == 206.0 { fail(st, bi, "SPINDLE ?"); }
    let dir = if kind == 206.0 { js::or(keep, 1.0) } else if pitch < 0.0 { -1.0 } else { 1.0 };
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    spin(st, dir);
    if kind == 209.0 {
        let inf = js::or(qp(cy, 257.0, dep).abs(), dep); let back = qp(cy, 256.0, 0.0).abs(); let mut d = 0.0; let mut g = 0;
        while d < dep - 1e-6 && { g += 1; g - 1 < 1000 } {
            d = js::min(d + inf, dep);
            emit(st, MK::Feed, p3(x, y, surf - d), f, bi, Some(lab), None);
            if d >= dep - 1e-6 { break; }
            spin(st, -dir);
            emit(st, MK::Feed, p3(x, y, if back > EPS { surf - d + back } else { surf + clr }), f, bi, Some(lab), None);
            spin(st, dir);
            emit(st, MK::Feed, p3(x, y, surf - d), f, bi, Some(lab), None);
        }
    } else { emit(st, MK::Feed, p3(x, y, surf - dep), f, bi, Some(lab), None); }
    spin(st, -dir);
    emit(st, MK::Feed, p3(x, y, surf + clr), f, bi, Some(lab), None);
    spin(st, if kind == 206.0 { dir } else { 0.0 });
    emit(st, MK::Rapid, p3(x, y, surf + clr2), RAPID_RATE, bi, Some(lab), None);
}

fn cycle_bore_mill(st: &mut St, cy: &Cycle, bi: usize) {
    let clr = qp(cy, 200.0, 2.0); let dep = qp(cy, 201.0, 0.0).abs(); let f = js::or(qp(cy, 206.0, st.feed), st.feed); let pitch = qp(cy, 334.0, 0.25).abs();
    let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr); let dia = qp(cy, 335.0, 0.0).abs(); let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.as_str();
    let r = dia / 2.0 - st.tool.r;
    if dep <= EPS || dia <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    if r < -EPS { fail(st, bi, "TOOL RADIUS TOO LARGE"); return; }
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    if r <= EPS { emit(st, MK::Feed, p3(x, y, surf - dep), f, bi, Some(lab), None); }
    else {
        emit(st, MK::Feed, p3(x + r, y, surf + clr), f, bi, Some(lab), None);
        let drop = dep + clr; let turns = drop / js::max(pitch, 1e-3);
        emit(st, MK::Arc, p3(x + r * js::cos(turns * 2.0 * PI), y + r * js::sin(turns * 2.0 * PI), surf - dep), f, bi, Some(lab), Some(&Arc { cx: x, cy: y, ccw: true, sweep: Some(turns * 2.0 * PI) }));
        let p = st.pos;
        emit(st, MK::Arc, p3(p.x, p.y, surf - dep), f, bi, Some(lab), Some(&Arc { cx: x, cy: y, ccw: true, sweep: Some(2.0 * PI) }));
        emit(st, MK::Feed, p3(x, y, surf - dep), f, bi, Some(lab), None);
    }
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, surf + clr2), RAPID_RATE, bi, Some(lab), None);
}

#[allow(clippy::too_many_arguments)]
fn semi(st: &mut St, cx: f64, cy: f64, r0: f64, r1: f64, z1: f64, ccw: bool, f: f64, bi: usize, lab: &str) {
    if (r1 - r0).abs() <= EPS { emit(st, MK::Feed, p3(cx + r1, cy, z1), f, bi, Some(lab), None); return; }
    emit(st, MK::Arc, p3(cx + r1, cy, z1), f, bi, Some(lab), Some(&Arc { cx: cx + (r0 + r1) / 2.0, cy, ccw, sweep: Some(if ccw { PI } else { -PI }) }));
}

fn cycle_thread(st: &mut St, cy: &Cycle, bi: usize) {
    let n = cy.num; let clr = qp(cy, 200.0, 2.0); let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr); let d_ = qp(cy, 335.0, 0.0).abs(); let pit = qp(cy, 239.0, 0.0); let p_ = pit.abs();
    let dep = qp(cy, 201.0, 0.0).abs(); let fpre = js::or(qp(cy, 253.0, st.feed), st.feed); let fm = js::or(qp(cy, 207.0, st.feed), st.feed);
    let fcs = js::or(qp(cy, if n == 264.0 { 206.0 } else { 254.0 }, fm), fm);
    let (x, y) = (st.pos.x, st.pos.y); let lab = cy.label.clone(); let rt = st.tool.r + js::or(st.tool.dr, 0.0); let ext = n == 267.0;
    let r_ = d_ / 2.0 + if ext { rt } else { -rt };
    let rh = pit >= 0.0; let clb = qp(cy, 351.0, 1.0) >= 0.0; let ccw = if n == 265.0 { !rh } else if ext { !clb } else { clb }; let up = n != 265.0 && ccw == rh; let sz = if up { 1.0 } else { -1.0 };
    let zb = surf - dep; let rs = if ext { r_ + p_ } else { 0.0 }; let fs = qp(cy, 358.0, 0.0).abs(); let off = qp(cy, 359.0, 0.0).abs();
    if n == 262.0 && dep <= EPS { return; }
    if d_ <= EPS || (dep > EPS && p_ <= EPS) { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    if r_ <= EPS { fail(st, bi, "TOOL RADIUS TOO LARGE"); return; }
    let front = |st: &mut St, fz: f64| {
        if fs <= EPS { return; }
        emit(st, MK::Feed, p3(x + rs, y, surf - fs), fz, bi, Some(&lab), None);
        if off <= EPS { return; }
        let sn = ccw != (rs > off);
        semi(st, x, y, rs, off, surf - fs, sn, fcs, bi, &lab);
        emit(st, MK::Arc, p3(x + off, y, surf - fs), fcs, bi, Some(&lab), Some(&Arc { cx: x, cy: y, ccw, sweep: Some(if ccw { 2.0 * PI } else { -2.0 * PI }) }));
        semi(st, x, y, off, rs, surf - fs, sn, fcs, bi, &lab);
    };
    emit(st, MK::Rapid, p3(x, y, surf + clr), RAPID_RATE, bi, Some(&lab), None);
    if ext { emit(st, MK::Rapid, p3(x + rs, y, surf + clr), RAPID_RATE, bi, Some(&lab), None); }
    if n == 264.0 && qp(cy, 356.0, 0.0).abs() > EPS {
        let fake = params_lit(&lab, &[(200.0, clr), (201.0, qp(cy, 356.0, 0.0)), (206.0, qp(cy, 206.0, st.feed)), (202.0, qp(cy, 202.0, 0.0)), (203.0, surf), (204.0, clr),
            (258.0, qp(cy, 258.0, 0.2)), (259.0, qp(cy, 258.0, 0.2)), (257.0, qp(cy, 257.0, 0.0)), (256.0, qp(cy, 256.0, 0.2))]);
        cycle_peck205(st, &fake, bi);
    }
    let cs = if n == 263.0 { qp(cy, 356.0, 0.0).abs() } else { 0.0 };
    if cs > EPS {
        if !(qp(cy, 357.0, 0.0).abs() > EPS) { emit(st, MK::Feed, p3(x, y, surf - cs + clr), fpre, bi, Some(&lab), None); }
        emit(st, MK::Feed, p3(x, y, surf - cs), if qp(cy, 357.0, 0.0).abs() > EPS { fpre } else { fcs }, bi, Some(&lab), None);
    }
    let q360 = n == 265.0 && js::round(qp(cy, 360.0, 0.0)) == 1.0;
    if n != 262.0 && !q360 { front(st, if n == 265.0 { fcs } else { fpre }); }
    if dep > EPS {
        let q355 = js::round(qp(cy, 355.0, 0.0).abs()); let nn = js::ceil(dep / p_ - 1e-9); let mut passes: Vec<(f64, f64)> = vec![];
        if n == 265.0 || ((n == 262.0 || ext) && q355 == 1.0) { passes.push((if up { zb } else { zb + nn * p_ }, nn)); }
        else if (n == 262.0 || ext) && q355 > 1.0 {
            let k = js::ceil(dep / (q355 * p_) - 1e-9); let mut i = 0.0;
            while i < k { passes.push((zb + (if up { i } else { k - 1.0 - i }) * q355 * p_ + (if up { 0.0 } else { p_ }), 1.0)); i += 1.0; }
        } else { passes.push((if up { zb } else { zb + p_ }, 1.0)); }
        let fh = fm * r_ / (d_ / 2.0); let sa = ccw != (rs > r_);
        for (zs, t) in passes {
            let ze = zs + sz * p_ * t;
            emit(st, MK::Feed, p3(x + rs, y, zs), fpre, bi, Some(&lab), None);
            emit(st, MK::Feed, p3(x + rs, y, zs - sz * p_ / 2.0), fpre, bi, Some(&lab), None);
            semi(st, x, y, rs, r_, zs, sa, fm, bi, &lab);
            emit(st, MK::Arc, p3(x + r_, y, ze), fh, bi, Some(&lab), Some(&Arc { cx: x, cy: y, ccw, sweep: Some((if ccw { 2.0 } else { -2.0 }) * PI * t) }));
            semi(st, x, y, r_, rs, ze, sa, fm, bi, &lab);
        }
    }
    if q360 { front(st, fpre); }
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, surf + clr), RAPID_RATE, bi, Some(&lab), None);
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, surf + clr2), RAPID_RATE, bi, Some(&lab), None);
}

fn cycle_old(st: &mut St, cy: &Cycle, bi: usize) {
    let (x, y, z0) = (st.pos.x, st.pos.y, st.pos.z); let lab = cy.label.as_str(); let mut keep = js::or(st.spin_dir, 1.0); let n = cy.num;
    if n == 18.0 {
        let d18 = sub(cy, 1.0, 0, 0.0); let p18 = sub(cy, 2.0, 0, 0.0); let f18 = p18.abs() * st.s_rpm; let s18 = (if p18 < 0.0 { -1.0 } else { 1.0 }) * (if d18 < 0.0 { 1.0 } else { -1.0 });
        if !js::truthy(d18) || !(f18 > 0.0) { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
        spin(st, s18);
        emit(st, MK::Feed, p3(x, y, z0 + d18), f18, bi, Some(lab), None); spin(st, 0.0); return;
    }
    let set = sub(cy, 1.0, 0, 2.0).abs(); let dep = -sub(cy, 2.0, 0, 0.0).abs(); let surf = z0 - set;
    if dep.abs() <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    if n == 1.0 {
        let peck = js::or(sub(cy, 3.0, 0, 0.0).abs(), dep.abs()); let f1 = js::or(sub(cy, 5.0, 0, st.feed), st.feed); let mut d = 0.0;
        while d < dep.abs() - 1e-6 {
            d = js::min(d + peck, dep.abs());
            emit(st, MK::Feed, p3(x, y, surf - d), f1, bi, Some(lab), None);
            emit(st, MK::Rapid, p3(x, y, z0), RAPID_RATE, bi, Some(lab), None);
            if d < dep.abs() - 1e-6 { emit(st, MK::Rapid, p3(x, y, surf - d + 0.2), RAPID_RATE, bi, Some(lab), None); }
        }
        return;
    }
    let f = if n == 2.0 { js::or(sub(cy, 4.0, 0, st.feed), st.feed) } else { sub(cy, 3.0, 0, 0.0).abs() * st.s_rpm };
    if !(f > 0.0) { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    if n == 17.0 { keep = if sub(cy, 3.0, 0, 0.0) < 0.0 { -1.0 } else { 1.0 }; spin(st, keep); }
    emit(st, MK::Feed, p3(x, y, surf + dep), f, bi, Some(lab), None); spin(st, -keep);
    emit(st, MK::Feed, p3(x, y, z0), f, bi, Some(lab), None); spin(st, if n == 17.0 { 0.0 } else { keep });
}

fn levels(surf: f64, total: f64, peck: f64) -> Vec<f64> {
    let mut out = vec![]; let mut d = 0.0; let mut g = 0; let step = if peck > EPS { peck } else { total };
    while d < total - 1e-6 && { g += 1; g - 1 < 1000 } { d = js::min(d + step, total); out.push(surf - d); }
    out
}
#[derive(Clone, Debug)]
enum PE { L(f64, f64), A { cx: f64, cy: f64, sw: f64, x: f64, y: f64 } }
fn rrect_path(cx: f64, cy: f64, hx: f64, hy: f64, rc: f64, ccw: bool) -> Vec<PE> {
    let rc = js::max(0.0, js::min_n(&[rc, hx, hy]));
    let mut p = vec![]; let ex = hx - rc; let ey = hy - rc;
    let corners = [(ex, ey, 0.0), (-ex, ey, 90.0), (-ex, -ey, 180.0), (ex, -ey, 270.0)];
    p.push(PE::L(cx + hx, cy + if ccw { ey } else { -ey }));
    let order = if ccw { [0, 1, 2, 3] } else { [3, 2, 1, 0] };
    for k in 0..4 {
        let c = corners[order[k]]; let a0 = (if ccw { c.2 } else { c.2 + 90.0 }) * PI / 180.0; let sw = (if ccw { 90.0 } else { -90.0 }) * PI / 180.0;
        if rc > EPS { p.push(PE::A { cx: cx + c.0, cy: cy + c.1, sw, x: cx + c.0 + rc * js::cos(a0 + sw), y: cy + c.1 + rc * js::sin(a0 + sw) }); }
        let n = corners[order[(k + 1) % 4]]; let na = (if ccw { n.2 } else { n.2 + 90.0 }) * PI / 180.0;
        p.push(PE::L(cx + n.0 + rc * js::cos(na), cy + n.1 + rc * js::sin(na)));
    }
    p.pop(); p.push(PE::L(cx + hx, cy));
    p
}
fn run_path(st: &mut St, p: &[PE], z: f64, f: f64, bi: usize, lab: &str) {
    for e in p {
        match e {
            PE::A { cx, cy, sw, x, y } => emit(st, MK::Arc, p3(*x, *y, z), f, bi, Some(lab), Some(&Arc { cx: *cx, cy: *cy, ccw: *sw > 0.0, sweep: Some(*sw) })),
            PE::L(x, y) => emit(st, MK::Feed, p3(*x, *y, z), f, bi, Some(lab), None),
        }
    }
}
#[allow(clippy::too_many_arguments)]
fn to_clear(st: &mut St, x: f64, y: f64, clr_z: f64, _clr2_z: f64, bi: usize, lab: &str) {
    let z = js::max(st.pos.z, clr_z);
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, z), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, z), RAPID_RATE, bi, Some(lab), None);
    emit(st, MK::Rapid, p3(x, y, clr_z), RAPID_RATE, bi, Some(lab), None);
}

fn cycle_finish(st: &mut St, cy: &Cycle, bi: usize, at: Option<(f64, f64)>) {
    let n = cy.num; let clr = qp(cy, 200.0, 2.0); let total = qp(cy, 201.0, 0.0).abs(); let fpl = js::or(qp(cy, 206.0, st.feed), st.feed); let peck = qp(cy, 202.0, 0.0).abs();
    let fm = js::or(qp(cy, 207.0, st.feed), st.feed); let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr); let lab = cy.label.clone(); let r = st.tool.r;
    let cx = match at { Some(a) => a.0, None => qp(cy, 216.0, st.pos.x) }; let cyy = match at { Some(a) => a.1, None => qp(cy, 217.0, st.pos.y) };
    let pocket = n == 212.0 || n == 214.0; let round = n == 214.0 || n == 215.0;
    let (hx, hy, rc);
    if round { let d = qp(cy, 223.0, 0.0).abs() / 2.0; let h = if pocket { d - r } else { d + r }; hx = h; hy = h; rc = h; }
    else {
        hx = qp(cy, 218.0, 0.0).abs() / 2.0 + if pocket { -r } else { r }; hy = qp(cy, 219.0, 0.0).abs() / 2.0 + if pocket { -r } else { r };
        rc = js::max(0.0, qp(cy, 220.0, 0.0).abs() + if pocket { -r } else { r });
    }
    if total <= EPS || !(hx > 0.0) || !(hy > 0.0) { fail(st, bi, if hx <= 0.0 || hy <= 0.0 { "TOOL RADIUS TOO LARGE" } else { "CYCL DEF INCOMPLETE" }); return; }
    if pocket && !round && qp(cy, 220.0, 0.0).abs() < r - EPS { fail(st, bi, "TOOL RADIUS TOO LARGE"); }
    let ra = if pocket { js::min(hx, hy) / 2.0 } else { js::max(r, 2.0) };
    let s = (cx + hx, cyy); let ccw = pocket;
    let path = if round { vec![PE::A { cx, cy: cyy, sw: if ccw { 2.0 * PI } else { -2.0 * PI }, x: s.0, y: s.1 }] } else { rrect_path(cx, cyy, hx, hy, rc, ccw) };
    let a1 = if pocket { (s.0 - ra, s.1 - ra) } else { (s.0 + ra, s.1 + ra) };
    let a2 = if pocket { (s.0 - ra, s.1 + ra) } else { (s.0 + ra, s.1 - ra) };
    let ac = if pocket { (s.0 - ra, s.1) } else { (s.0 + ra, s.1) };
    let start = if pocket { (cx, cyy) } else { a1 };
    to_clear(st, start.0, start.1, surf + clr, surf + clr2, bi, &lab);
    let l = levels(surf, total, peck);
    let mut i = 0;
    while i < l.len() && !st.abort {
        emit(st, MK::Feed, p3(start.0, start.1, l[i]), fpl, bi, Some(&lab), None);
        if pocket { emit(st, MK::Feed, p3(a1.0, a1.1, l[i]), fm, bi, Some(&lab), None); }
        emit(st, MK::Arc, p3(s.0, s.1, l[i]), fm, bi, Some(&lab), Some(&Arc { cx: ac.0, cy: ac.1, ccw: pocket, sweep: Some(1.0 * PI / 2.0 * 1.0 * 1.0) }));
        run_path(st, &path, l[i], fm, bi, &lab);
        emit(st, MK::Arc, p3(a2.0, a2.1, l[i]), fm, bi, Some(&lab), Some(&Arc { cx: ac.0, cy: ac.1, ccw: pocket, sweep: Some(PI / 2.0) }));
        if pocket { emit(st, MK::Feed, p3(cx, cyy, l[i]), fm, bi, Some(&lab), None); } else { emit(st, MK::Feed, p3(a1.0, a1.1, l[i]), fm, bi, Some(&lab), None); }
        i += 1;
    }
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, surf + clr), RAPID_RATE, bi, Some(&lab), None);
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, surf + clr2), RAPID_RATE, bi, Some(&lab), None);
}

fn cycle_slot(st: &mut St, cy: &Cycle, bi: usize, at: Option<(f64, f64)>) {
    let clr = qp(cy, 200.0, 2.0); let total = qp(cy, 201.0, 0.0).abs(); let fm = js::or(qp(cy, 207.0, st.feed), st.feed); let peck = qp(cy, 202.0, 0.0).abs();
    let op = js::round(qp(cy, 215.0, 0.0)); let surf = qp(cy, 203.0, 0.0); let clr2 = qp(cy, 204.0, clr); let lab = cy.label.clone(); let r = st.tool.r;
    let cx = match at { Some(a) => a.0, None => qp(cy, 216.0, st.pos.x) }; let cyy = match at { Some(a) => a.1, None => qp(cy, 217.0, st.pos.y) };
    let w = qp(cy, 219.0, 0.0).abs(); let mut rs = w / 2.0 - r;
    if total <= EPS || w <= EPS { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
    if rs < -EPS || w > 3.0 * 2.0 * r + EPS { fail(st, bi, if rs < -EPS { "TOOL RADIUS TOO LARGE" } else { "SLOT WIDTH TOO LARGE" }); if rs < -EPS { return; } }
    rs = js::max(rs, 0.0);
    let (a, b); let mut pr = 0.0; let mut a0 = 0.0; let mut sw = 0.0;
    if cy.num == 210.0 {
        let ang = qp(cy, 224.0, 0.0) * PI / 180.0; let half = qp(cy, 218.0, 0.0).abs() / 2.0 - w / 2.0;
        if half < 0.0 { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
        a = (cx - half * js::cos(ang), cyy - half * js::sin(ang)); b = (cx + half * js::cos(ang), cyy + half * js::sin(ang));
    } else {
        pr = qp(cy, 244.0, 0.0).abs() / 2.0; a0 = qp(cy, 245.0, 0.0) * PI / 180.0; sw = qp(cy, 248.0, 0.0) * PI / 180.0;
        a = (cx + pr * js::cos(a0), cyy + pr * js::sin(a0)); b = (cx + pr * js::cos(a0 + sw), cyy + pr * js::sin(a0 + sw));
    }
    let num = cy.num;
    let go = |st: &mut St, to_b: bool, z: f64| {
        let p = if to_b { b } else { a };
        if num == 210.0 { emit(st, MK::Feed, p3(p.0, p.1, z), fm, bi, Some(&lab), None); }
        else { let sgn = if to_b { 1.0 } else { -1.0 }; emit(st, MK::Arc, p3(p.0, p.1, z), fm, bi, Some(&lab), Some(&Arc { cx, cy: cyy, ccw: sgn * sw > 0.0, sweep: Some(sgn * sw) })); }
    };
    to_clear(st, a.0, a.1, surf + clr, surf + clr2, bi, &lab);
    emit(st, MK::Feed, p3(a.0, a.1, surf), fm, bi, Some(&lab), None);
    let l = levels(surf, total, peck); let mut at_a = true;
    if op != 2.0 {
        let mut i = 0;
        while i < l.len() && !st.abort { go(st, at_a, l[i]); at_a = !at_a; go(st, at_a, l[i]); at_a = !at_a; i += 1; }
    }
    if op != 1.0 && rs > EPS {
        let z = surf - total;
        if !at_a { go(st, false, z); }
        if cy.num == 210.0 {
            let mut ux = b.0 - a.0; let mut uy = b.1 - a.1; let l = js::or(js::hypot2(ux, uy), 1.0); ux /= l; uy /= l;
            let nx = -uy * rs; let ny = ux * rs;
            emit(st, MK::Feed, p3(a.0 - nx, a.1 - ny, z), fm, bi, Some(&lab), None);
            emit(st, MK::Feed, p3(b.0 - nx, b.1 - ny, z), fm, bi, Some(&lab), None);
            emit(st, MK::Arc, p3(b.0 + nx, b.1 + ny, z), fm, bi, Some(&lab), Some(&Arc { cx: b.0, cy: b.1, ccw: true, sweep: Some(PI) }));
            emit(st, MK::Feed, p3(a.0 + nx, a.1 + ny, z), fm, bi, Some(&lab), None);
            emit(st, MK::Arc, p3(a.0 - nx, a.1 - ny, z), fm, bi, Some(&lab), Some(&Arc { cx: a.0, cy: a.1, ccw: true, sweep: Some(PI) }));
            emit(st, MK::Feed, p3(a.0, a.1, z), fm, bi, Some(&lab), None);
        } else {
            let d1 = pr - rs; let d2 = pr + rs; let e0 = a0; let e1 = a0 + sw; let dirn = if sw >= 0.0 { 1.0 } else { -1.0 };
            emit(st, MK::Feed, p3(cx + d1 * js::cos(e0), cyy + d1 * js::sin(e0), z), fm, bi, Some(&lab), None);
            emit(st, MK::Arc, p3(cx + d1 * js::cos(e1), cyy + d1 * js::sin(e1), z), fm, bi, Some(&lab), Some(&Arc { cx, cy: cyy, ccw: dirn > 0.0, sweep: Some(sw) }));
            emit(st, MK::Arc, p3(cx + d2 * js::cos(e1), cyy + d2 * js::sin(e1), z), fm, bi, Some(&lab), Some(&Arc { cx: b.0, cy: b.1, ccw: dirn > 0.0, sweep: Some(dirn * PI) }));
            emit(st, MK::Arc, p3(cx + d2 * js::cos(e0), cyy + d2 * js::sin(e0), z), fm, bi, Some(&lab), Some(&Arc { cx, cy: cyy, ccw: dirn < 0.0, sweep: Some(-sw) }));
            emit(st, MK::Arc, p3(cx + d1 * js::cos(e0), cyy + d1 * js::sin(e0), z), fm, bi, Some(&lab), Some(&Arc { cx: a.0, cy: a.1, ccw: dirn > 0.0, sweep: Some(dirn * PI) }));
            emit(st, MK::Feed, p3(a.0, a.1, z), fm, bi, Some(&lab), None);
        }
    }
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, surf + clr), RAPID_RATE, bi, Some(&lab), None);
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, surf + clr2), RAPID_RATE, bi, Some(&lab), None);
}

fn cycle_surface(st: &mut St, cy: &Cycle, bi: usize) {
    let lab = cy.label.clone(); let n = js::max(1.0, js::round(qp(cy, 240.0, 1.0))); let fm = js::or(qp(cy, 207.0, st.feed), st.feed); let clr = qp(cy, 200.0, 2.0);
    if cy.num == 230.0 {
        let x0 = qp(cy, 225.0, 0.0); let y0 = qp(cy, 226.0, 0.0); let z0 = qp(cy, 227.0, 0.0); let l1 = qp(cy, 218.0, 0.0); let l2 = qp(cy, 219.0, 0.0);
        let fpl = js::or(qp(cy, 206.0, st.feed), st.feed); let fst = js::or(qp(cy, 209.0, fm), fm);
        if !js::truthy(l1) || !js::truthy(l2) { fail(st, bi, "CYCL DEF INCOMPLETE"); return; }
        to_clear(st, x0, y0, z0 + clr, z0 + clr, bi, &lab);
        emit(st, MK::Feed, p3(x0, y0, z0), fpl, bi, Some(&lab), None);
        let mut i = 0.0;
        while i < n && !st.abort {
            let y = y0 + if n > 1.0 { l2 * i / (n - 1.0) } else { 0.0 }; let xe = if (i % 2.0) != 0.0 { x0 } else { x0 + l1 };
            if i != 0.0 { let px = st.pos.x; emit(st, MK::Feed, p3(px, y, z0), fst, bi, Some(&lab), None); }
            emit(st, MK::Feed, p3(xe, y, z0), fm, bi, Some(&lab), None);
            i += 1.0;
        }
        let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, z0 + clr), RAPID_RATE, bi, Some(&lab), None);
        return;
    }
    let pts: Vec<P3> = (1..=4).map(|k| { let k = k as f64; p3(qp(cy, 225.0 + 3.0 * (k - 1.0), 0.0), qp(cy, 226.0 + 3.0 * (k - 1.0), 0.0), qp(cy, 227.0 + 3.0 * (k - 1.0), 0.0)) }).collect();
    let lerp = |a: P3, b: P3, t: f64| p3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    let top = js::max_n(&[pts[0].z, pts[1].z, pts[2].z, pts[3].z]) + clr;
    to_clear(st, pts[0].x, pts[0].y, top, top, bi, &lab);
    emit(st, MK::Feed, pts[0], fm, bi, Some(&lab), None);
    let mut i = 0.0;
    while i <= n && !st.abort {
        let t = i / n; let a = lerp(pts[0], pts[3], t); let b = lerp(pts[1], pts[2], t);
        if i != 0.0 { emit(st, MK::Feed, if (i % 2.0) != 0.0 { b } else { a }, fm, bi, Some(&lab), None); }
        emit(st, MK::Feed, if (i % 2.0) != 0.0 { a } else { b }, fm, bi, Some(&lab), None);
        i += 1.0;
    }
    let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, top), RAPID_RATE, bi, Some(&lab), None);
}

fn cycle_pattern(st: &mut St, pat: &Cycle, bi: usize) {
    let mc = match &st.cycle { Some(c) if implemented(c.num) => c.clone(), _ => { fail(st, bi, "CYCL DEF INCOMPLETE"); return; } };
    let mut pts: Vec<(f64, f64)> = vec![];
    if pat.num == 220.0 {
        let cx = qp(pat, 216.0, 0.0); let cy0 = qp(pat, 217.0, 0.0); let r = qp(pat, 244.0, 0.0).abs() / 2.0; let a0 = qp(pat, 245.0, 0.0); let a1 = qp(pat, 246.0, 360.0);
        let mut stp = qp(pat, 247.0, 0.0); let nn = js::max(1.0, js::round(qp(pat, 241.0, 1.0)));
        if !js::truthy(stp) { stp = if (a1 - a0).abs() >= 360.0 - 1e-9 { (a1 - a0) / nn } else if nn > 1.0 { (a1 - a0) / (nn - 1.0) } else { 0.0 }; }
        let mut i = 0.0;
        while i < nn { let a = (a0 + stp * i) * PI / 180.0; pts.push((cx + r * js::cos(a), cy0 + r * js::sin(a))); i += 1.0; }
    } else {
        let sx = qp(pat, 225.0, 0.0); let sy = qp(pat, 226.0, 0.0); let dx = qp(pat, 237.0, 0.0); let dy = qp(pat, 238.0, 0.0);
        let nc = js::max(1.0, js::round(qp(pat, 242.0, 1.0))); let nl = js::max(1.0, js::round(qp(pat, 243.0, 1.0))); let rot = qp(pat, 224.0, 0.0) * PI / 180.0;
        let mut j = 0.0;
        while j < nl {
            let mut i = 0.0;
            while i < nc {
                let ii = if (j % 2.0) != 0.0 { nc - 1.0 - i } else { i }; let u = ii * dx; let v = j * dy;
                pts.push((sx + u * js::cos(rot) - v * js::sin(rot), sy + u * js::sin(rot) + v * js::cos(rot)));
                i += 1.0;
            }
            j += 1.0;
        }
    }
    // JSON.parse(JSON.stringify(mc)): NaN / Infinity become null
    let mut run = mc.clone();
    for v in run.params.values_mut() { if let Some(x) = v { if !x.is_finite() { *v = None; } } }
    for v in run.order.iter_mut() { if let Some(x) = v { if !x.is_finite() { *v = None; } } }
    run.label = format!("{} @{}", mc.label, js::num_str(pat.num));
    for k in [200.0, 203.0, 204.0] { if let Some(Some(v)) = pat.params.get(&qk(k)) { if v.is_finite() { run.params.insert(qk(k), Some(*v)); } } }
    let surf = qp(&run, 203.0, 0.0); let travel = surf + if js::truthy(js::round(qp(pat, 301.0, 1.0))) { qp(&run, 204.0, 50.0) } else { qp(&run, 200.0, 2.0) };
    let mut i = 0;
    while i < pts.len() && !st.abort {
        let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, js::max(p.z, travel)), RAPID_RATE, bi, Some(&run.label), None);
        let p = st.pos; emit(st, MK::Rapid, p3(pts[i].0, pts[i].1, p.z), RAPID_RATE, bi, Some(&run.label), None);
        exec_cycle(st, &run, bi, Some(pts[i]));
        let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, travel), RAPID_RATE, bi, Some(&run.label), None);
        i += 1;
    }
}

fn run_cycle(st: &mut St, bi: usize) {
    let cy = match &st.cycle { None => { fail(st, bi, "CYCL DEF INCOMPLETE"); return; } Some(c) => c.clone() };
    if !implemented(cy.num) { return; }
    exec_cycle(st, &cy, bi, None);
}
fn exec_cycle(st: &mut St, cy: &Cycle, bi: usize, at: Option<(f64, f64)>) {
    let n = cy.num;
    if n == 200.0 { cycle_drill(st, cy, bi, false); }
    else if n == 203.0 { cycle_drill(st, cy, bi, true); }
    else if n == 201.0 { cycle_ream(st, cy, bi); }
    else if n == 4.0 { cycle_pocket(st, cy, bi); }
    else if n == 202.0 { cycle_bore(st, cy, bi); }
    else if n == 204.0 { cycle_back_bore(st, cy, bi); }
    else if n == 205.0 { cycle_peck205(st, cy, bi); }
    else if n == 206.0 || n == 207.0 || n == 209.0 { cycle_tap(st, cy, bi, n); }
    else if n == 208.0 { cycle_bore_mill(st, cy, bi); }
    else if (262.0..=267.0).contains(&n) && n != 266.0 { cycle_thread(st, cy, bi); }
    else if (212.0..=215.0).contains(&n) { cycle_finish(st, cy, bi, at); }
    else if n == 210.0 || n == 211.0 { cycle_slot(st, cy, bi, at); }
    else if n == 230.0 || n == 231.0 { cycle_surface(st, cy, bi); }
    else if n == 1.0 || n == 2.0 || n == 17.0 || n == 18.0 { cycle_old(st, cy, bi); }
    else if (21.0..=25.0).contains(&n) { sl::run(st, cy, bi); }
}

#[path = "sl.rs"]
mod sl;

/* ------------------------------------------------------------------ touch probe */

#[derive(Clone, Copy)]
enum PK { Rapid, Touch, Arc }
fn pmv(st: &mut St, kind: PK, to: P3, bi: usize, lab: &str, arc: Option<&Arc>) {
    let n0 = st.moves.len();
    let pr = st.mach.probe.unwrap_or([f64::NAN; 3]);
    let f = if matches!(kind, PK::Touch) { js::or(pr[0], PROBE_F) } else { js::or(pr[1], PROBE_RAPID) };
    let mk = match kind { PK::Touch => MK::Feed, PK::Rapid => MK::Rapid, PK::Arc => MK::Arc };
    emit(st, mk, to, f, bi, Some(lab), arc);
    for m in st.moves[n0..].iter_mut() {
        if let Item::M(m) = m { m.probe = true; if matches!(kind, PK::Touch) { m.touch = true; } m.feed = f; m.dur = Some(m.len / f * 60.0); }
    }
}
fn probe_pre(st: &mut St, x: f64, y: f64, zs: f64, h: f64, bi: usize, lab: &str) {
    if st.pos.z < h { let p = st.pos; pmv(st, PK::Rapid, p3(p.x, p.y, h), bi, lab, None); }
    let p = st.pos; pmv(st, PK::Rapid, p3(x, y, p.z), bi, lab, None);
    pmv(st, PK::Rapid, p3(x, y, zs), bi, lab, None);
}
struct PPt { s: (f64, f64), e: (f64, f64), c: Option<(f64, f64)> }
struct Circ { cx: f64, cy: f64, ccw: bool, arc: bool }
#[allow(clippy::too_many_arguments)]
fn probe_pts(st: &mut St, p: &[PPt], z: f64, h: f64, via: bool, bi: usize, lab: &str, circ: Option<&Circ>) {
    let mut i = 0;
    while i < p.len() && !st.abort {
        let s = p[i].s; let zz = if via { h } else { z }; let same = js::hypot2(s.0 - st.pos.x, s.1 - st.pos.y) < 1e-9;
        if i == 0 { probe_pre(st, s.0, s.1, z, h, bi, lab); }
        else if !same {
            if via { let q = st.pos; pmv(st, PK::Rapid, p3(q.x, q.y, h), bi, lab, None); }
            if let (Some(c), true) = (circ, circ.map(|c| !via || c.arc).unwrap_or(false)) {
                pmv(st, PK::Arc, p3(s.0, s.1, zz), bi, lab, Some(&Arc { cx: c.cx, cy: c.cy, ccw: c.ccw, sweep: None }));
            } else {
                if !via { if let Some(c) = p[i].c { pmv(st, PK::Rapid, p3(c.0, c.1, zz), bi, lab, None); } }
                pmv(st, PK::Rapid, p3(s.0, s.1, zz), bi, lab, None);
            }
            if via { pmv(st, PK::Rapid, p3(s.0, s.1, z), bi, lab, None); }
        }
        pmv(st, PK::Touch, p3(p[i].e.0, p[i].e.1, z), bi, lab, None);
        pmv(st, PK::Rapid, p3(s.0, s.1, z), bi, lab, None);
        i += 1;
    }
}
#[allow(clippy::too_many_arguments)]
fn probe_z(st: &mut St, x: f64, y: f64, z_surf: f64, sc: f64, h: f64, bi: usize, lab: &str) {
    probe_pre(st, x, y, z_surf + sc, h, bi, lab);
    pmv(st, PK::Touch, p3(x, y, z_surf), bi, lab, None);
    pmv(st, PK::Rapid, p3(x, y, z_surf + sc), bi, lab, None);
}
type Axes = Vec<(char, f64)>;
fn ax_set(m: &mut Axes, k: char, v: f64) { if let Some(e) = m.iter_mut().find(|(kk, _)| *kk == k) { e.1 = v; } else { m.push((k, v)); } }
fn probe_datum(st: &mut St, cy: &Cycle, meas: &Axes, tgt: &Axes) {
    let n = js::round(qp(cy, 305.0, 0.0));
    let mut p = p3(0.0, 0.0, 0.0); for (k, v) in meas { pset(&mut p, *k, *v); }
    let mut q = p; for (k, v) in tgt { pset(&mut q, *k, *v); }
    let mp = to_m(st, p); let mq = to_m(st, q);
    if n == 0.0 {
        st.xf.px += mp.x - mq.x; st.xf.py += mp.y - mq.y; st.xf.pz += mp.z - mq.z; st.xf.on = xf_on(&st.xf); st.pos = from_m(st, st.mpos);
    } else if js::round(qp(cy, 303.0, -1.0)) == 1.0 {
        let row = st.presets.entry(js::num_str(n)).or_default();
        for (k, v) in tgt { let val = pget(&mp, *k) - v; if let Some(e) = row.iter_mut().find(|(kk, _)| kk == k) { e.1 = val; } else { row.push((*k, val)); } }
    }
}
fn activate_preset(st: &mut St, cy: &Cycle) {
    let row = match st.presets.get(&js::num_str(js::round(qp(cy, 339.0, -1.0)))) { Some(r) => r.clone(), None => return };
    for (k, v) in row { match k { 'x' => st.xf.px = v, 'y' => st.xf.py = v, _ => st.xf.pz = v } }
    st.xf.on = xf_on(&st.xf); st.pos = from_m(st, st.mpos);
}

re!(re_check, r"CHECK:?\s*\S+\s+Q(\d+)");

fn run_probe(st: &mut St, cy: &Cycle, bi: usize) {
    let n = cy.num; let lab = format!("TCH PROBE {}", js::num_str(n));
    if tt_cycle(n) {
        if n == 31.0 || n == 33.0 || n == 481.0 || n == 483.0 { st.q.set(115.0, 0.0); }
        if n == 32.0 || n == 33.0 || n == 482.0 || n == 483.0 { st.q.set(116.0, 0.0); }
        if (481.0..=483.0).contains(&n) { st.q.set(199.0, 0.0); }
        let b1 = body(cy, 1.0).unwrap_or("").to_string();
        if let Some(m) = re_check().captures(&b1) { if n < 40.0 { st.q.set(parse::parse_int(&m[1]), 0.0); } }
        return;
    }
    if !probe_cycle(n) { fail(st, bi, &format!("TCH PROBE {} NOT IMPLEMENTED IN SIMULATOR", js::num_str(n))); return; }
    let r = js::max(js::or(st.tool.r, 0.0), 0.0);
    let pr = st.mach.probe.unwrap_or([f64::NAN; 3]);
    let sc = js::or(pr[2], PROBE_CLR) + js::max(qp(cy, 320.0, 0.0), 0.0);
    let h = qp(cy, 260.0, st.pos.z); let z = qp(cy, 261.0, 0.0) - r; let mut via = js::round(qp(cy, 301.0, 1.0)) == 1.0; let cx = qp(cy, 321.0, 0.0); let cyy = qp(cy, 322.0, 0.0);
    let mut p: Vec<PPt> = vec![]; let mut meas: Axes = vec![]; let mut tgt: Axes = vec![];
    if n == 408.0 || n == 409.0 {
        let ax = if js::round(qp(cy, 272.0, 1.0)) == 2.0 { 'y' } else { 'x' }; let w = qp(cy, 311.0, 0.0).abs() / 2.0; let c0 = if ax == 'x' { cx } else { cyy };
        let inside = n == 408.0; let e = if inside { w - r } else { w + r }; let mut s0 = if inside { e - sc } else { e + sc };
        if n == 409.0 { via = true; }
        if s0 < 0.0 { s0 = 0.0; via = false; }
        for d in [-1.0, 1.0] { let a1 = c0 + d * s0; let a0 = c0 + d * e; if ax == 'x' { p.push(PPt { s: (a1, cyy), e: (a0, cyy), c: None }); } else { p.push(PPt { s: (cx, a1), e: (cx, a0), c: None }); } }
        probe_pts(st, &p, z, h, via, bi, &lab, None);
        ax_set(&mut meas, ax, c0); ax_set(&mut tgt, ax, qp(cy, 405.0, 0.0)); st.q.set(166.0, 2.0 * w); st.q.set(157.0, c0);
    } else if n == 410.0 || n == 411.0 {
        let hx = qp(cy, 323.0, 0.0).abs() / 2.0; let hy = qp(cy, 324.0, 0.0).abs() / 2.0; let sg = if n == 410.0 { -1.0 } else { 1.0 };
        let ex = hx + sg * r; let ey = hy + sg * r; let mut sx = ex + sg * sc; let mut sy = ey + sg * sc;
        if n == 410.0 && (sx < 0.0 || sy < 0.0) { sx = 0.0; sy = 0.0; via = false; }
        let s = [[-sx, 0.0, -ex, 0.0], [0.0, -sy, 0.0, -ey], [sx, 0.0, ex, 0.0], [0.0, sy, 0.0, ey]];
        for i in 0..4 {
            let prv = s[(i + 3) % 4]; let cu = s[i]; let xs = if cu[1] == 0.0 { cu[0] } else { prv[0] }; let ys = if cu[1] == 0.0 { prv[1] } else { cu[1] };
            p.push(PPt { s: (cx + cu[0], cyy + cu[1]), e: (cx + cu[2], cyy + cu[3]), c: if i != 0 { Some((cx + xs, cyy + ys)) } else { None } });
        }
        probe_pts(st, &p, z, h, via, bi, &lab, None);
        meas = vec![('x', cx), ('y', cyy)]; tgt = vec![('x', qp(cy, 331.0, 0.0)), ('y', qp(cy, 332.0, 0.0))];
        st.q.set(151.0, cx); st.q.set(152.0, cyy); st.q.set(154.0, 2.0 * hx); st.q.set(155.0, 2.0 * hy);
    } else if n == 412.0 || n == 413.0 {
        let rr = qp(cy, 262.0, 0.0).abs() / 2.0; let a0d = qp(cy, 325.0, 0.0); let stp = qp(cy, 247.0, 90.0); let nn = if js::round(qp(cy, 423.0, 4.0)) == 3.0 { 3 } else { 4 };
        let er = if n == 412.0 { rr - r } else { rr + r }; let mut sr = if n == 412.0 { er - sc } else { er + sc };
        if sr < 0.0 { sr = 0.0; via = false; }
        for i in 0..nn { let an = (a0d + i as f64 * stp) * PI / 180.0; let co = js::cos(an); let si = js::sin(an); p.push(PPt { s: (cx + sr * co, cyy + sr * si), e: (cx + er * co, cyy + er * si), c: None }); }
        let circ = Circ { cx, cy: cyy, ccw: stp > 0.0, arc: js::round(qp(cy, 365.0, 1.0)) == 1.0 };
        probe_pts(st, &p, z, h, via, bi, &lab, if sr > 0.0 { Some(&circ) } else { None });
        meas = vec![('x', cx), ('y', cyy)]; tgt = vec![('x', qp(cy, 331.0, 0.0)), ('y', qp(cy, 332.0, 0.0))];
        st.q.set(151.0, cx); st.q.set(152.0, cyy); st.q.set(153.0, 2.0 * rr);
    } else if n == 417.0 {
        probe_z(st, qp(cy, 263.0, 0.0), qp(cy, 264.0, 0.0), qp(cy, 294.0, 0.0), sc, h, bi, &lab);
        meas = vec![('z', qp(cy, 294.0, 0.0))]; tgt = vec![('z', qp(cy, 333.0, 0.0))]; st.q.set(160.0, qp(cy, 294.0, 0.0));
    } else if n == 419.0 {
        let a = js::round(qp(cy, 272.0, 1.0)); let d = if qp(cy, 267.0, 1.0) < 0.0 { -1.0 } else { 1.0 }; let x0 = qp(cy, 263.0, 0.0); let y0 = qp(cy, 264.0, 0.0);
        if a == 3.0 {
            let zt = qp(cy, 261.0, 0.0); probe_pre(st, x0, y0, zt - d * sc, h, bi, &lab);
            pmv(st, PK::Touch, p3(x0, y0, zt), bi, &lab, None); pmv(st, PK::Rapid, p3(x0, y0, zt - d * sc), bi, &lab, None);
            meas = vec![('z', zt)]; tgt = vec![('z', qp(cy, 333.0, 0.0))];
        } else {
            if a == 2.0 { p.push(PPt { s: (x0, y0 - d * (r + sc)), e: (x0, y0 - d * r), c: None }); } else { p.push(PPt { s: (x0 - d * (r + sc), y0), e: (x0 - d * r, y0), c: None }); }
            probe_pts(st, &p, z, h, true, bi, &lab, None);
            let k = if a == 2.0 { 'y' } else { 'x' };
            ax_set(&mut meas, k, if a == 2.0 { y0 } else { x0 }); ax_set(&mut tgt, k, qp(cy, 333.0, 0.0));
        }
    }
    if n != 417.0 && n != 419.0 && js::round(qp(cy, 381.0, 0.0)) == 1.0 {
        let q = st.pos; pmv(st, PK::Rapid, p3(q.x, q.y, h), bi, &lab, None);
        probe_z(st, qp(cy, 382.0, 0.0), qp(cy, 383.0, 0.0), qp(cy, 384.0, 0.0), sc, h, bi, &lab);
        ax_set(&mut meas, 'z', qp(cy, 384.0, 0.0)); ax_set(&mut tgt, 'z', qp(cy, 333.0, 0.0));
    }
    let q = st.pos; pmv(st, PK::Rapid, p3(q.x, q.y, h), bi, &lab, None);
    probe_datum(st, cy, &meas, &tgt);
}

/* ------------------------------------------------------------------ execution */

fn arg_nq(st: &St, bi: usize, k: &str) -> Option<Option<NQ>> {
    // Some(..) when the key exists (value may be null), None when undefined
    st.blocks[bi].args.get(k).map(|v| v.as_nq())
}

fn target_of(st: &mut St, bi: usize) -> P3 {
    let mut p = st.pos;
    for (i, k) in ["a", "b", "c"].iter().enumerate() {
        let (ka, kia) = match *k { "a" => ("axa", "iaxa"), "b" => ("axb", "iaxb"), _ => ("axc", "iaxc") };
        if let Some(v) = arg_nq(st, bi, ka) {
            if let Some(v2) = resolve(v, &st.q) { let rt = st.rot_to.get_or_insert([None; 3]); rt[i] = Some(v2); }
        }
        if let Some(v) = arg_nq(st, bi, kia) {
            if let Some(v2) = resolve(v, &st.q) {
                let base = match st.rot_to.as_ref().and_then(|r| r[i]) { Some(b) => b, None => match i { 0 => st.rot.a, 1 => st.rot.b, _ => st.rot.c } };
                let rt = st.rot_to.get_or_insert([None; 3]); rt[i] = Some(base + v2);
            }
        }
    }
    for k in ['x', 'y', 'z'] {
        let (ka, ki) = match k { 'x' => ("x", "ix"), 'y' => ("y", "iy"), _ => ("z", "iz") };
        if let Some(v) = arg_nq(st, bi, ka) { if let Some(v) = resolve(v, &st.q) { pset(&mut p, k, v); } }
        if let Some(v) = arg_nq(st, bi, ki) { if let Some(v) = resolve(v, &st.q) { let c = pget(&p, k); pset(&mut p, k, c + v); } }
    }
    p
}

fn set_rc(st: &mut St, bi: usize) -> bool {
    st.rc_act = false;
    let a = match st.blocks[bi].args.str("rc") { Some(s) if !s.is_empty() => s.to_string(), _ => return true };
    let prev = st.rc.clone();
    if (prev == "RL" && a == "RR") || (prev == "RR" && a == "RL") { fail(st, bi, "RADIUS COMP. UNDEFINED"); return false; }
    st.rc = a.clone();
    st.rc_act = prev == "R0" && a != "R0";
    true
}
fn feed_of(st: &mut St, bi: usize) -> bool {
    let a = &st.blocks[bi].args;
    if a.truthy("fauto") {
        if st.auto_feed > 0.0 { st.feed = st.auto_feed; }
        if st.feed > 0.0 { return true; }
        fail(st, bi, "FEED RATE MISSING"); return false;
    }
    let f = match a.get("f") { None => return true, Some(v) => v.as_nq() };
    let fv = resolve(f, &st.q);
    match fv { Some(v) if v > 0.0 => { st.feed = v; true } _ => { fail(st, bi, "FEED RATE MISSING"); false } }
}
fn ms(st: &St, bi: usize) -> Option<Vec<f64>> { st.blocks[bi].args.ms().cloned() }

fn do_line(st: &mut St, bi: usize) {
    if !set_rc(st, bi) { return; }
    let m = ms(st, bi);
    apply_m(st, m.as_ref(), true);
    feed_of(st, bi);
    let a = &st.blocks[bi].args;
    let moves = ["x", "y", "z", "ix", "iy", "iz", "axa", "axb", "axc", "iaxa", "iaxb", "iaxc"].iter().any(|k| a.has(k));
    let fmax = a.truthy("fmax");
    let mb = a.get("mb").cloned();
    if moves {
        let to = target_of(st, bi);
        if fmax { emit(st, MK::Rapid, to, RAPID_RATE, bi, None, None); }
        else {
            if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); return; }
            let f = st.feed; emit(st, MK::Feed, to, f, bi, None, None);
        }
    }
    apply_m(st, m.as_ref(), false);
    if let Some(mb) = mb {
        let zr = match mb { V::Str(s) if s == "MAX" => js::max(st.pos.z, js::max(st.stock.z1, st.stock.z0) + 100.0), V::Num(v) => st.pos.z + v, _ => f64::NAN };
        let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, zr), RAPID_RATE, bi, None, None);
    }
}

fn do_cc(st: &mut St, bi: usize) {
    let mut c = st.pos;
    for k in ['x', 'y', 'z'] {
        let (ka, ki) = match k { 'x' => ("x", "ix"), 'y' => ("y", "iy"), _ => ("z", "iz") };
        if let Some(v) = arg_nq(st, bi, ka) { if let Some(v) = resolve(v, &st.q) { pset(&mut c, k, v); } }
        if let Some(v) = arg_nq(st, bi, ki) { if let Some(v) = resolve(v, &st.q) { pset(&mut c, k, pget(&st.pos, k) + v); } }
    }
    let a = &st.blocks[bi].args;
    let hx = a.has("x") || a.has("ix"); let hy = a.has("y") || a.has("iy"); let hz = a.has("z") || a.has("iz");
    let plane = if hz && hx && !hy { Plane::ZX } else if hz && hy && !hx { Plane::YZ } else { Plane::XY };
    st.cc = Some(Cc { x: c.x, y: c.y, z: Some(c.z), plane: Some(plane) });
}

fn plane_axes(p: Plane) -> [char; 3] { match p { Plane::XY => ['x', 'y', 'z'], Plane::ZX => ['z', 'x', 'y'], Plane::YZ => ['y', 'z', 'x'] } }
fn plane_arc(st: &mut St, bi: usize, sweep: Option<f64>, end_uv: Option<(f64, f64, bool)>, w_end: f64) {
    let cc = st.cc.clone().unwrap();
    let ax = plane_axes(cc.plane.unwrap_or(Plane::XY)); let (u, v, w) = (ax[0], ax[1], ax[2]); let from = st.pos;
    let cu = cc.ax(u); let cv = cc.ax(v); let r = js::sqrt((pget(&from, u) - cu) * (pget(&from, u) - cu) + (pget(&from, v) - cv) * (pget(&from, v) - cv));
    if r < EPS { fail(st, bi, "ARC END POS. INCORRECT"); return; }
    let a0 = js::atan2(pget(&from, v) - cv, pget(&from, u) - cu); let w0 = pget(&from, w);
    let sweep = match sweep {
        Some(s) => s,
        None => {
            let e = end_uv.unwrap();
            let a1 = js::atan2(e.1 - cv, e.0 - cu); let r2 = js::sqrt((e.0 - cu) * (e.0 - cu) + (e.1 - cv) * (e.1 - cv));
            if (r2 - r).abs() > st.arc_tol { fail(st, bi, "ARC END POS. INCORRECT"); return; }
            if e.2 { js::or(dir_angle(a0, a1, 1.0), 2.0 * PI) } else { js::or(dir_angle(a0, a1, -1.0), -2.0 * PI) }
        }
    };
    let n = js::max(4.0, js::ceil(sweep.abs() / (PI / 36.0)));
    let mut i = 1.0;
    while i <= n {
        let an = a0 + sweep * i / n; let mut p = p3(0.0, 0.0, 0.0);
        pset(&mut p, u, cu + r * js::cos(an)); pset(&mut p, v, cv + r * js::sin(an)); pset(&mut p, w, w0 + (w_end - w0) * i / n);
        let f = st.feed; emit(st, MK::Feed, p, f, bi, None, None);
        i += 1.0;
    }
}

fn do_arc_c(st: &mut St, bi: usize) {
    if !set_rc(st, bi) { return; }
    let m = ms(st, bi); apply_m(st, m.as_ref(), true);
    if let Some(f) = st.blocks[bi].args.get("f").map(|v| v.as_nq()) { if let Some(fv) = resolve(f, &st.q) { if fv > 0.0 { st.feed = fv; } } }
    let cc = match &st.cc { None => { fail(st, bi, "CIRCLE CENTER UNDEFINED"); return; } Some(c) => c.clone() };
    let to = target_of(st, bi);
    let ccw = st.blocks[bi].args.str("dr") != Some("-");
    if let Some(pl) = cc.plane { if pl != Plane::XY {
        if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); return; }
        let ax = plane_axes(pl);
        plane_arc(st, bi, None, Some((pget(&to, ax[0]), pget(&to, ax[1]), ccw)), pget(&to, ax[2])); apply_m(st, m.as_ref(), false); return;
    } }
    let from = st.pos;
    let r1 = js::sqrt(js::pow(from.x - cc.x, 2.0) + js::pow(from.y - cc.y, 2.0));
    let r2 = js::sqrt(js::pow(to.x - cc.x, 2.0) + js::pow(to.y - cc.y, 2.0));
    if r1 < EPS || (r1 - r2).abs() > st.arc_tol { fail(st, bi, "ARC END POS. INCORRECT"); return; }
    if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); return; }
    let f = st.feed; emit(st, MK::Arc, to, f, bi, None, Some(&Arc { cx: cc.x, cy: cc.y, ccw, sweep: None }));
    apply_m(st, m.as_ref(), false);
}

fn do_arc_cr(st: &mut St, bi: usize) {
    if !set_rc(st, bi) { return; }
    let m = ms(st, bi); apply_m(st, m.as_ref(), true);
    if let Some(f) = st.blocks[bi].args.get("f").map(|v| v.as_nq()) { if let Some(fv) = resolve(f, &st.q) { if fv > 0.0 { st.feed = fv; } } }
    let r = resolve(st.blocks[bi].args.nq("r"), &st.q);
    let r = match r { Some(r) if r.abs() >= EPS => r, _ => { fail(st, bi, "ARC END POS. INCORRECT"); return; } };
    let to = target_of(st, bi); let from = st.pos;
    let dx = to.x - from.x; let dy = to.y - from.y; let l = js::sqrt(dx * dx + dy * dy);
    if l < EPS { fail(st, bi, "ARC END POS. INCORRECT"); return; }
    let h2 = r * r - l * l / 4.0;
    if h2 < -st.arc_tol { fail(st, bi, "ARC END POS. INCORRECT"); return; }
    let h = js::sqrt(js::max(h2, 0.0));
    let mx = (from.x + to.x) / 2.0; let my = (from.y + to.y) / 2.0; let ux = dx / l; let uy = dy / l;
    let cands = [(mx - h * uy, my + h * ux), (mx + h * uy, my - h * ux)];
    let ccw = st.blocks[bi].args.str("dr") != Some("-");
    let want_long = r < 0.0; let mut pick = None;
    for c in cands { let sw = sweep_angle(from, to, c.0, c.1, ccw).abs(); if if want_long { sw > PI - 1e-6 } else { sw <= PI + 1e-6 } { pick = Some(c); break; } }
    let pick = pick.unwrap_or(cands[0]);
    if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); return; }
    st.cc = Some(Cc { x: pick.0, y: pick.1, z: None, plane: None });
    let f = st.feed; emit(st, MK::Arc, to, f, bi, None, Some(&Arc { cx: pick.0, cy: pick.1, ccw, sweep: None }));
    apply_m(st, m.as_ref(), false);
}

fn ct_to(st: &mut St, to: P3, bi: usize) -> bool {
    let t = match st.last_tan { None => { fail(st, bi, "TANGENTIAL CONNECTION NOT POSSIBLE"); return false; } Some(t) => t };
    let from = st.pos; let dx = to.x - from.x; let dy = to.y - from.y; let d2 = dx * dx + dy * dy;
    if d2 < EPS { fail(st, bi, "ARC END POS. INCORRECT"); return false; }
    let dn = -t.1 * dx + t.0 * dy;
    if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); return false; }
    if dn.abs() < 1e-9 * js::sqrt(d2) {
        if dx * t.0 + dy * t.1 < 0.0 { fail(st, bi, "TANGENTIAL CONNECTION NOT POSSIBLE"); return false; }
        let f = st.feed; emit(st, MK::Feed, to, f, bi, None, None); return true;
    }
    let rho = d2 / (2.0 * dn);
    let cx = from.x - t.1 * rho; let cy = from.y + t.0 * rho;
    st.cc = Some(Cc { x: cx, y: cy, z: None, plane: None });
    let f = st.feed; emit(st, MK::Arc, to, f, bi, None, Some(&Arc { cx, cy, ccw: rho > 0.0, sweep: None }));
    true
}
fn do_ct(st: &mut St, bi: usize) {
    if !set_rc(st, bi) { return; }
    let m = ms(st, bi); apply_m(st, m.as_ref(), true); feed_of(st, bi);
    let to = target_of(st, bi); ct_to(st, to, bi);
    apply_m(st, m.as_ref(), false);
}

fn polar_target(st: &mut St, bi: usize) -> Option<P3> {
    let cc = match &st.cc { None => { fail(st, bi, "CIRCLE CENTER UNDEFINED"); return None; } Some(c) => c.clone() };
    let px = st.pos.x - cc.x; let py = st.pos.y - cc.y;
    let mut pr = js::sqrt(px * px + py * py); let mut pa = js::atan2(py, px) * 180.0 / PI;
    let a = &st.blocks[bi].args;
    if let Some(v) = a.get("pr").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { pr = v; } }
    if let Some(v) = a.get("ipr").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { pr += v; } }
    if let Some(v) = a.get("pa").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { pa = v; } }
    if let Some(v) = a.get("ipa").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { pa += v; } }
    let mut p = p3(cc.x + pr * js::cos(pa * PI / 180.0), cc.y + pr * js::sin(pa * PI / 180.0), st.pos.z);
    if let Some(v) = a.get("z").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { p.z = v; } }
    if let Some(v) = a.get("iz").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { p.z += v; } }
    Some(p)
}
fn do_lp(st: &mut St, bi: usize) {
    if !set_rc(st, bi) { return; }
    let m = ms(st, bi); apply_m(st, m.as_ref(), true); feed_of(st, bi);
    if let Some(to) = polar_target(st, bi) {
        if st.blocks[bi].args.truthy("fmax") { emit(st, MK::Rapid, to, RAPID_RATE, bi, None, None); }
        else if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); }
        else { let f = st.feed; emit(st, MK::Feed, to, f, bi, None, None); }
    }
    apply_m(st, m.as_ref(), false);
}
fn do_ctp(st: &mut St, bi: usize) {
    if !set_rc(st, bi) { return; }
    let m = ms(st, bi); apply_m(st, m.as_ref(), true); feed_of(st, bi);
    if let Some(to) = polar_target(st, bi) { ct_to(st, to, bi); }
    apply_m(st, m.as_ref(), false);
}
fn do_cp(st: &mut St, bi: usize) {
    if !set_rc(st, bi) { return; }
    let m = ms(st, bi); apply_m(st, m.as_ref(), true); feed_of(st, bi);
    let cc = match &st.cc { None => { fail(st, bi, "CIRCLE CENTER UNDEFINED"); return; } Some(c) => c.clone() };
    let ccw = st.blocks[bi].args.str("dr") != Some("-");
    if let Some(pl) = cc.plane { if pl != Plane::XY {
        let ax = plane_axes(pl); let (pu, pv, pw) = (ax[0], ax[1], ax[2]); let pf = st.pos;
        let pa0 = js::atan2(pget(&pf, pv) - cc.ax(pv), pget(&pf, pu) - cc.ax(pu));
        let a = st.blocks[bi].args.clone();
        let psw = if a.has("ipa") { resolve(a.nq("ipa"), &st.q).map(|v| v.abs()).unwrap_or(0.0) * PI / 180.0 * (if ccw { 1.0 } else { -1.0 }) }
        else if a.has("pa") {
            let pa = resolve(a.nq("pa"), &st.q).unwrap_or(0.0);
            let mut s = dir_angle(pa0, pa * PI / 180.0, if ccw { 1.0 } else { -1.0 }); if s.abs() < EPS { s = if ccw { 2.0 * PI } else { -2.0 * PI }; } s
        } else { fail(st, bi, "ARC END POS. INCORRECT"); return; };
        let mut wz = pget(&pf, pw);
        let (kw, kiw) = match pw { 'x' => ("x", "ix"), 'y' => ("y", "iy"), _ => ("z", "iz") };
        if let Some(v) = a.get(kw).map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { wz = v; } }
        if let Some(v) = a.get(kiw).map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { wz += v; } }
        if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); return; }
        plane_arc(st, bi, Some(psw), None, wz); apply_m(st, m.as_ref(), false); return;
    } }
    let (cx, cy) = (cc.x, cc.y); let from = st.pos;
    let r = js::sqrt((from.x - cx) * (from.x - cx) + (from.y - cy) * (from.y - cy));
    if r < EPS { fail(st, bi, "ARC END POS. INCORRECT"); return; }
    let a0 = js::atan2(from.y - cy, from.x - cx); let mut sw;
    let a = st.blocks[bi].args.clone();
    if a.has("ipa") {
        let v = match resolve(a.nq("ipa"), &st.q) { None => { fail(st, bi, "ARC END POS. INCORRECT"); return; } Some(v) => v };
        sw = v.abs() * PI / 180.0 * (if ccw { 1.0 } else { -1.0 });
    } else if a.has("pa") {
        let v = resolve(a.nq("pa"), &st.q).map(|v| v * PI / 180.0).unwrap_or(0.0);
        sw = v - a0;
        if ccw { while sw <= EPS { sw += 2.0 * PI; } while sw > 2.0 * PI + EPS { sw -= 2.0 * PI; } }
        else { while sw >= -EPS { sw -= 2.0 * PI; } while sw < -2.0 * PI - EPS { sw += 2.0 * PI; } }
    } else { fail(st, bi, "ARC END POS. INCORRECT"); return; }
    if sw.abs() < EPS { return; }
    let mut to = p3(cx + r * js::cos(a0 + sw), cy + r * js::sin(a0 + sw), from.z);
    if let Some(v) = a.get("z").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { to.z = v; } }
    if let Some(v) = a.get("iz").map(|v| v.as_nq()) { if let Some(v) = resolve(v, &st.q) { to.z += v; } }
    if !(st.feed > 0.0) { fail(st, bi, "FEED RATE MISSING"); return; }
    let f = st.feed; emit(st, MK::Arc, to, f, bi, None, Some(&Arc { cx, cy, ccw, sweep: Some(sw) }));
    apply_m(st, m.as_ref(), false);
}

fn do_corner(st: &mut St, bi: usize) {
    let a = st.blocks[bi].args.clone();
    let mut f: Option<f64> = None;
    if a.has("f") { f = resolve(a.nq("f"), &st.q); if !matches!(f, Some(v) if v > 0.0) { f = None; } }
    if st.blocks[bi].kind == Kind::Rnd {
        let v = resolve(a.nq("r"), &st.q);
        let v = match v { Some(v) if v > 0.0 => v, _ => { fail(st, bi, "ENTRY INCOMPLETE"); return; } };
        let mut m = new_mark("RND", bi); m.r = v; m.feed = f; mark(st, m);
    } else {
        let v = resolve(a.nq("len"), &st.q);
        let v = match v { Some(v) if v > 0.0 => v, _ => { fail(st, bi, "ENTRY INCOMPLETE"); return; } };
        let mut m = new_mark("CHF", bi); m.len = v; m.feed = f; mark(st, m);
    }
}

fn do_appr(st: &mut St, bi: usize) {
    let a = st.blocks[bi].args.clone();
    let side = match a.str("rc") { Some(s) if !s.is_empty() => s.to_string(), _ => "R0".to_string() };
    if st.rc == "RL" || st.rc == "RR" { fail(st, bi, "RADIUS COMP. UNDEFINED"); return; }
    let entry_feed = st.feed;
    let m = a.ms().cloned(); apply_m(st, m.as_ref(), true);
    if !feed_of(st, bi) { return; }
    let to = if a.truthy("polar") { polar_target(st, bi) } else { Some(target_of(st, bi)) };
    let to = match to { Some(t) => t, None => return };
    let has_z = a.has("z") || a.has("iz");
    let mside = flip_rc(st, Some(&side));
    let mut k = new_mark("APPR", bi);
    k.form = a.str("form").unwrap_or("").to_string(); k.side = mside.clone();
    k.len = if a.has("len") { resolve(a.nq("len"), &st.q).map(|v| v.abs()).unwrap_or(0.0) } else { 0.0 };
    k.r = if a.has("r") { resolve(a.nq("r"), &st.q).unwrap_or(0.0) } else { 0.0 };
    k.cca = if a.has("cca") { resolve(a.nq("cca"), &st.q).map(|v| v.abs()).unwrap_or(0.0) } else { 0.0 };
    k.feed = Some(st.feed); k.entry_feed = if entry_feed > 0.0 { entry_feed } else { st.feed };
    k.from = st.mpos; k.to = Some(to_m(st, to)); k.has_z = has_z;
    k.rc = mside.filter(|s| s == "RL" || s == "RR");
    k.tool = st.tool.t; k.tool_r = st.tool.r; k.tool_dr = js::or(st.tool.dr, 0.0); k.tool_name = st.tool.name.clone(); k.spindle = st.spindle; k.coolant = st.coolant;
    mark(st, k);
    st.rc = side; st.rc_act = false;
    st.pos = to; st.mpos = to_m(st, to);
    st.last_tan = None;
    apply_m(st, m.as_ref(), false);
}
fn do_dep(st: &mut St, bi: usize) {
    let a = st.blocks[bi].args.clone();
    let side = st.rc.clone();
    let m = a.ms().cloned(); apply_m(st, m.as_ref(), true);
    if !feed_of(st, bi) { return; }
    let form = a.str("form").unwrap_or("").to_string();
    let mut pn = None;
    if form == "LCT" { pn = if a.truthy("polar") { polar_target(st, bi) } else { Some(target_of(st, bi)) }; if pn.is_none() { return; } }
    let t = st.last_tan.unwrap_or((1.0, 0.0)); let s = if side == "RL" { 1.0 } else { -1.0 };
    let len = if a.has("len") { resolve(a.nq("len"), &st.q).map(|v| v.abs()).unwrap_or(0.0) } else { 0.0 };
    let mut k = new_mark("DEP", bi);
    k.form = form.clone(); k.side = flip_rc(st, Some(&side)); k.len = len;
    k.r = if a.has("r") { resolve(a.nq("r"), &st.q).unwrap_or(0.0) } else { 0.0 };
    k.cca = if a.has("cca") { resolve(a.nq("cca"), &st.q).map(|v| v.abs()).unwrap_or(0.0) } else { 0.0 };
    k.feed = Some(st.feed); k.to = pn.map(|p| to_m(st, p)); k.from = st.mpos;
    k.tool = st.tool.t; k.tool_r = st.tool.r; k.tool_dr = js::or(st.tool.dr, 0.0); k.tool_name = st.tool.name.clone(); k.spindle = st.spindle; k.coolant = st.coolant;
    mark(st, k);
    if form == "LT" { st.pos = p3(st.pos.x + t.0 * len, st.pos.y + t.1 * len, st.pos.z); }
    else if form == "LN" { st.pos = p3(st.pos.x - t.1 * s * len, st.pos.y + t.0 * s * len, st.pos.z); }
    else if form == "LCT" { st.pos = pn.unwrap(); }
    st.mpos = to_m(st, st.pos);
    st.rc = "R0".into(); st.rc_act = false; st.last_tan = None;
    apply_m(st, m.as_ref(), false);
}

fn do_tool_def(st: &mut St, bi: usize) {
    let a = &st.blocks[bi].args;
    let t = match resolve(a.nq("t"), &st.q) { None => return, Some(t) => js::round(t) };
    let l = a.num("l"); let r = a.num("r");
    if r.is_some() || l.is_some() {
        st.tool_defs.insert(js::num_str(t), ToolEntry { t, name: J::Val(format!("TOOL DEF {}", js::num_str(t))), l: js::or(l.unwrap_or(0.0), 0.0), r: js::or(r.unwrap_or(0.0), 0.0) });
    }
}

fn do_tool_call(st: &mut St, bi: usize) {
    let a = st.blocks[bi].args.clone();
    let t = match a.get("t") { None | Some(V::Null) => Some(st.tool.t), Some(v) => resolve(v.as_nq(), &st.q) };
    let t = match t { None => 0.0, Some(t) => js::round(t) };
    if !a.truthy("axis") { fail(st, bi, "TOOL AXIS MISSING"); }
    if st.tool.t != t { st.spin_dir = 0.0; }
    if let Some(s) = a.get("s") { if !matches!(s, V::Null) { if let Some(s) = resolve(s.as_nq(), &st.q) { st.s_rpm = s.abs(); } } }
    st.spindle = st.s_rpm * st.spin_dir;
    if let Some(f) = a.get("f") { if !matches!(f, V::Null) { if let Some(tf) = resolve(f.as_nq(), &st.q) { if tf > 0.0 { st.auto_feed = tf; } } } }
    let dr = js::or(a.num("dr").unwrap_or(0.0), 0.0);
    if t == 0.0 { st.tool = Tool { t: 0.0, name: J::Val(String::new()), r: 0.0, l: 0.0, dr }; return; }
    let key = js::num_str(t);
    let mut e = st.tool_defs.get(&key).cloned().or_else(|| st.tool_table.iter().find(|x| x.t == t).cloned());
    if e.is_none() && st.auto_tools {
        let g2 = st.comment_tools.get(&key).copied();
        let ne = ToolEntry { t, name: J::Val(format!("T{}{}", js::num_str(t), if g2.is_some() { " (FROM COMMENT)" } else { " (AUTO)" })), r: g2.unwrap_or(3.0), l: 0.0 };
        st.tool_defs.insert(key.clone(), ne.clone());
        e = Some(ne);
    }
    match e {
        None => {
            let guess = st.comment_tools.get(&key).copied();
            fail(st, bi, &format!("TOOL {} NOT DEFINED", js::num_str(t)));
            st.tool = Tool { t, name: J::Val(if guess.is_some() { format!("T{} (FROM COMMENT)", js::num_str(t)) } else { "UNDEFINED".into() }), r: guess.unwrap_or(3.0), l: 0.0, dr };
        }
        Some(e) => st.tool = Tool { t: e.t, name: e.name.clone(), r: e.r, l: e.l, dr },
    }
    let tk = js::num_str(st.tool.t);
    if !st.tool_stat.contains_key(&tk) {
        st.tool_stat.insert(tk, ToolStat { t: st.tool.t, name: st.tool.name.clone(), r: st.tool.r, l: st.tool.l, moves: 0.0, time: 0.0 });
        st.tool_order.push(st.tool.t);
    }
}

fn do_fn(st: &mut St, bi: usize) {
    let b = &st.blocks[bi];
    let target = if b.kind == Kind::Formula { b.args.num("q") } else { b.args.num("target") }.unwrap_or(f64::NAN);
    let mut bad: Option<&'static str> = None;
    let v = match b.args.ast("expr") { Some(e) => parse::eval_expr(e, &st.q, &mut |m| bad = Some(m)), None => 0.0 };
    if let Some(m) = bad { fail(st, bi, m); return; }
    st.q.set(target, v);
}
fn jump_taken(st: &mut St, bi: usize) -> bool {
    let b = &st.blocks[bi];
    let mut bad: Option<&'static str> = None;
    let op = b.args.str("op").unwrap_or("").to_string();
    let ea: Option<Ast> = b.args.ast("a").cloned(); let eb: Option<Ast> = b.args.ast("b").cloned();
    let av = ea.map(|e| parse::eval_expr(&e, &st.q, &mut |m| bad = Some(m))).unwrap_or(0.0);
    let bv = eb.map(|e| parse::eval_expr(&e, &st.q, &mut |m| bad = Some(m))).unwrap_or(0.0);
    if let Some(m) = bad { fail(st, bi, m); return false; }
    match op.as_str() { "EQU" => (av - bv).abs() < 1e-9, "NE" => (av - bv).abs() >= 1e-9, "GT" => av > bv, "LT" => av < bv, _ => false }
}

fn exec_range(st: &mut St, from: usize, to: isize, depth: i32) {
    if depth > MAX_DEPTH { st.abort = true; fail(st, from, "EXCESSIVE SUBPROGRAM NESTING"); return; }
    let mut i = from as isize;
    while i <= to && !st.abort && !st.done {
        let iu = i as usize;
        if iu >= st.blocks.len() { i += 1; continue; }
        st.steps += 1;
        if st.steps > MAX_STEPS { st.abort = true; fail(st, iu, "EXCESSIVE SUBPROGRAM NESTING"); return; }
        let kind = st.blocks[iu].kind;
        if !(kind == Kind::CyclParm && !st.blocks[iu].args.truthy("dot")) && st.exec.len() < 400000 { st.seq = st.exec.len() as f64; st.exec.push(iu); }
        if kind == Kind::Blank || kind == Kind::Comment { i += 1; continue; }
        if st.blocks[iu].error.as_deref().map(|e| !e.is_empty()).unwrap_or(false) { i += 1; continue; }
        let m = ms(st, iu);
        match kind {
            Kind::Begin => {}
            Kind::End => return,
            Kind::Blk1 | Kind::Blk2 => {
                let a = &st.blocks[iu].args;
                let x = js::or(resolve(a.nq("x"), &st.q).unwrap_or(0.0), 0.0); let y = js::or(resolve(a.nq("y"), &st.q).unwrap_or(0.0), 0.0); let z = js::or(resolve(a.nq("z"), &st.q).unwrap_or(0.0), 0.0);
                if kind == Kind::Blk1 { st.stock.x0 = x; st.stock.y0 = y; st.stock.z0 = z; } else { st.stock.x1 = x; st.stock.y1 = y; st.stock.z1 = z; }
            }
            Kind::ToolCall => do_tool_call(st, iu),
            Kind::L => {
                do_line(st, iu);
                if has_m99(m.as_ref()) { run_cycle(st, iu); }
                if has_end_m(m.as_ref()) { st.done = true; return; }
            }
            Kind::Cc => do_cc(st, iu),
            Kind::Ct | Kind::Cp | Kind::Lp | Kind::Ctp => {
                match kind { Kind::Ct => do_ct(st, iu), Kind::Cp => do_cp(st, iu), Kind::Lp => do_lp(st, iu), _ => do_ctp(st, iu) }
                if has_m99(m.as_ref()) { run_cycle(st, iu); }
                if has_end_m(m.as_ref()) { st.done = true; return; }
            }
            Kind::Rnd | Kind::Chf => do_corner(st, iu),
            Kind::Appr => do_appr(st, iu),
            Kind::Dep => { do_dep(st, iu); if has_end_m(m.as_ref()) { st.done = true; return; } }
            Kind::ToolDef => do_tool_def(st, iu),
            Kind::C => {
                do_arc_c(st, iu);
                if has_m99(m.as_ref()) { run_cycle(st, iu); }
                if has_end_m(m.as_ref()) { st.done = true; return; }
            }
            Kind::Cr => {
                do_arc_cr(st, iu);
                if has_m99(m.as_ref()) { run_cycle(st, iu); }
                if has_end_m(m.as_ref()) { st.done = true; return; }
            }
            Kind::CyclDef => {
                let num = st.blocks[iu].args.num("num").unwrap_or(f64::NAN);
                if pattern_cycle(num) { let g = gather_cycle(st, iu); cycle_pattern(st, &g, iu); }
                else {
                    let c = gather_cycle(st, iu); let cn = c.num;
                    if (20.0..=25.0).contains(&cn) { sl::def_q(st, &c); }
                    if cn == 14.0 { st.sl_labels = Some(sl::labels_of(&c)); i += 1; continue; }
                    if cn == 20.0 { st.sl_data = Some(c); i += 1; continue; }
                    st.cycle = Some(c);
                    if !implemented(cn) && !nomotion(cn) { fail(st, iu, &format!("CYCLE {} NOT IMPLEMENTED IN SIMULATOR", js::num_str(cn))); }
                    if cn == 247.0 { let c = st.cycle.clone().unwrap(); activate_preset(st, &c); }
                    if cn == 7.0 || cn == 8.0 || cn == 10.0 || cn == 11.0 || cn == 19.0 { let c = st.cycle.clone().unwrap(); apply_transform(st, &c, iu); st.cycle = None; }
                }
            }
            Kind::CyclParm => {}
            Kind::TchProbe => { let g = gather_cycle(st, iu); run_probe(st, &g, iu); }
            Kind::CyclCall => { apply_m(st, m.as_ref(), true); run_cycle(st, iu); apply_m(st, m.as_ref(), false); }
            Kind::Lbl => {}
            Kind::LblEnd => { if depth > 0 { return; } }
            Kind::CallLbl => {
                let a = st.blocks[iu].args.clone();
                let lbl = Lbl::from_v(a.get("lbl").unwrap_or(&V::Null));
                let target = match st.labels.get(&lbl.key()) { None => { fail(st, iu, "LABEL NUMBER NOT FOUND"); i += 1; continue; } Some(t) => *t };
                let rep_v = match a.get("rep") { Some(V::Num(x)) => Some(*x), Some(v) => resolve(v.as_nq(), &st.q), None => None };
                let mut rep = js::round(js::or(rep_v.unwrap_or(0.0), 0.0));
                let rep_prog = a.truthy("repProg");
                if rep_prog && rep < 0.0 { fail(st, iu, "ARITHMETICAL ERROR"); i += 1; continue; }
                if !rep_prog { rep = 1.0; }
                if rep_prog && target < iu {
                    let mut k = 0.0;
                    while k < rep && !st.abort && !st.done { exec_range(st, target + 1, iu as isize - 1, depth + 1); k += 1.0; }
                } else {
                    let mut end = st.blocks.len() as isize - 1;
                    for j in target + 1..st.blocks.len() { if st.blocks[j].kind == Kind::LblEnd { end = j as isize; break; } }
                    let n = js::max(1.0, rep);
                    let mut k2 = 0.0;
                    while k2 < n && !st.abort && !st.done { exec_range(st, target + 1, end, depth + 1); k2 += 1.0; }
                }
            }
            Kind::Fn | Kind::Formula => do_fn(st, iu),
            Kind::Jump => {
                if jump_taken(st, iu) {
                    let lbl = Lbl::from_v(st.blocks[iu].args.get("lbl").unwrap_or(&V::Null));
                    match st.labels.get(&lbl.key()).copied() {
                        None => fail(st, iu, "LABEL NUMBER NOT FOUND"),
                        Some(jt) => {
                            if (jt as isize) < from as isize || (jt as isize) > to { fail(st, iu, "JUMP TO LABEL NOT PERMITTED"); st.abort = true; return; }
                            i = jt as isize;
                        }
                    }
                }
            }
            Kind::FnErr => { let c = st.blocks[iu].args.num("code").unwrap_or(0.0); fail(st, iu, &format!("FN 14: ERROR {}", js::num_str(c))); st.done = true; return; }
            Kind::FnNop => {}
            Kind::Stop => { apply_m(st, m.as_ref(), true); apply_m(st, m.as_ref(), false); if has_end_m(m.as_ref()) { st.done = true; return; } }
            _ => {}
        }
        i += 1;
    }
}

/* ------------------------------------------------------------------ contour pass */

#[derive(Clone, Debug)]
enum Prim { Line { s: P3, e: P3 }, Arc { cx: f64, cy: f64, r: f64, a0: f64, sw: f64, z0: f64, z1: f64 }, Invalid }
fn p_start(p: &Prim) -> P3 { match p { Prim::Line { s, .. } => *s, Prim::Arc { cx, cy, r, a0, z0, .. } => p3(cx + r * js::cos(*a0), cy + r * js::sin(*a0), *z0), Prim::Invalid => p3(f64::NAN, f64::NAN, f64::NAN) } }
fn p_end(p: &Prim) -> P3 { match p { Prim::Line { e, .. } => *e, Prim::Arc { cx, cy, r, a0, sw, z1, .. } => { let a = a0 + sw; p3(cx + r * js::cos(a), cy + r * js::sin(a), *z1) } Prim::Invalid => p3(f64::NAN, f64::NAN, f64::NAN) } }
fn p_tan(p: &Prim, at_end: bool) -> Option<(f64, f64)> {
    match p {
        Prim::Line { s, e } => { let dx = e.x - s.x; let dy = e.y - s.y; let l = js::sqrt(dx * dx + dy * dy); if l > 1e-12 { Some((dx / l, dy / l)) } else { None } }
        Prim::Arc { a0, sw, .. } => { let a = a0 + if at_end { *sw } else { 0.0 }; let d = if *sw >= 0.0 { 1.0 } else { -1.0 }; Some((-js::sin(a) * d, js::cos(a) * d)) }
        Prim::Invalid => None,
    }
}
fn planar(p: &Prim) -> bool { match p { Prim::Arc { .. } => true, Prim::Line { s, e } => (e.x - s.x).abs() + (e.y - s.y).abs() > 1e-9, Prim::Invalid => false } }
pub fn dir_angle(a0: f64, a1: f64, dir: f64) -> f64 {
    let mut d = a1 - a0;
    if dir > 0.0 { while d < 0.0 { d += 2.0 * PI; } while d >= 2.0 * PI { d -= 2.0 * PI; } }
    else { while d > 0.0 { d -= 2.0 * PI; } while d <= -2.0 * PI { d += 2.0 * PI; } }
    d
}
fn prim_of(mv: &Move) -> Prim {
    if mv.kind == MK::Arc { if let (Some(cx), Some(cy)) = (mv.cx, mv.cy) {
        let r = js::sqrt((mv.from.x - cx) * (mv.from.x - cx) + (mv.from.y - cy) * (mv.from.y - cy));
        let sw = match mv.sweep { Some(s) => s, None => sweep_angle(mv.from, mv.to, cx, cy, mv.ccw) };
        return Prim::Arc { cx, cy, r, a0: js::atan2(mv.from.y - cy, mv.from.x - cx), sw, z0: mv.from.z, z1: mv.to.z };
    } }
    Prim::Line { s: mv.from, e: mv.to }
}
fn set_end_p(p: &mut Prim, pt: P3) {
    match p {
        Prim::Line { e, .. } => *e = pt,
        Prim::Arc { cx, cy, a0, sw, z1, .. } => {
            let d = if *sw >= 0.0 { 1.0 } else { -1.0 }; let old = *sw; let rem = dir_angle(*a0, js::atan2(pt.y - *cy, pt.x - *cx), d);
            let turns = js::max(0.0, js::round((old - rem) / (d * 2.0 * PI)));
            *sw = rem + d * 2.0 * PI * turns; *z1 = pt.z;
        }
        Prim::Invalid => {}
    }
}
fn set_start_p(p: &mut Prim, pt: P3) {
    match p {
        Prim::Line { s, .. } => *s = pt,
        Prim::Arc { cx, cy, a0, sw, z0, .. } => {
            let end_a = *a0 + *sw; let d = if *sw >= 0.0 { 1.0 } else { -1.0 }; let old = *sw;
            *a0 = js::atan2(pt.y - *cy, pt.x - *cx);
            let rem = dir_angle(*a0, end_a, d); let turns = js::max(0.0, js::round((old - rem) / (d * 2.0 * PI)));
            *sw = rem + d * 2.0 * PI * turns; *z0 = pt.z;
        }
        Prim::Invalid => {}
    }
}
fn offset_p(p: &Prim, s: f64, r: f64) -> Option<Prim> {
    match p {
        Prim::Line { s: ps, e } => {
            let t = p_tan(p, false)?;
            let nx = -t.1 * s * r; let ny = t.0 * s * r;
            Some(Prim::Line { s: p3(ps.x + nx, ps.y + ny, ps.z), e: p3(e.x + nx, e.y + ny, e.z) })
        }
        Prim::Arc { cx, cy, r: pr, a0, sw, z0, z1 } => {
            let d = if *sw >= 0.0 { 1.0 } else { -1.0 }; let rr = pr - s * d * r;
            if rr < -1e-9 { return Some(Prim::Invalid); }
            Some(Prim::Arc { cx: *cx, cy: *cy, r: js::max(rr, 0.0), a0: *a0, sw: *sw, z0: *z0, z1: *z1 })
        }
        Prim::Invalid => None,
    }
}
fn on_p(pt: P3, p: &Prim, tol: f64) -> bool {
    match p {
        Prim::Line { s, e } => {
            let dx = e.x - s.x; let dy = e.y - s.y; let l2 = dx * dx + dy * dy;
            if l2 < 1e-18 { return js::hypot2(pt.x - s.x, pt.y - s.y) <= tol; }
            let u = ((pt.x - s.x) * dx + (pt.y - s.y) * dy) / l2;
            u >= -tol / js::sqrt(l2) && u <= 1.0 + tol / js::sqrt(l2) && js::hypot2(s.x + dx * u - pt.x, s.y + dy * u - pt.y) <= tol
        }
        Prim::Arc { cx, cy, r, a0, sw, .. } => {
            if (js::hypot2(pt.x - cx, pt.y - cy) - r).abs() > tol { return false; }
            if sw.abs() >= 2.0 * PI - 1e-9 { return true; }
            let d = if *sw >= 0.0 { 1.0 } else { -1.0 }; let rel = dir_angle(*a0, js::atan2(pt.y - cy, pt.x - cx), d);
            rel.abs() <= sw.abs() + tol / js::max(*r, 1e-9)
        }
        Prim::Invalid => false,
    }
}
fn isect(a: &Prim, b: &Prim) -> Vec<P3> {
    let mut out = vec![];
    match (a, b) {
        (Prim::Arc { .. }, Prim::Line { .. }) => isect(b, a),
        (Prim::Line { s: as_, e: ae }, Prim::Line { s: bs, e: be }) => {
            let rx = ae.x - as_.x; let ry = ae.y - as_.y; let sx = be.x - bs.x; let sy = be.y - bs.y; let den = rx * sy - ry * sx;
            if den.abs() < 1e-12 { return out; }
            let t = ((bs.x - as_.x) * sy - (bs.y - as_.y) * sx) / den;
            out.push(p3(as_.x + rx * t, as_.y + ry * t, ae.z)); out
        }
        (Prim::Line { s: as_, e: ae }, Prim::Arc { cx, cy, r, .. }) => {
            let dx = ae.x - as_.x; let dy = ae.y - as_.y; let fx = as_.x - cx; let fy = as_.y - cy;
            let qa = dx * dx + dy * dy; let qb = 2.0 * (fx * dx + fy * dy); let qc = fx * fx + fy * fy - r * r; let mut disc = qb * qb - 4.0 * qa * qc;
            if qa < 1e-18 || disc < -1e-9 { return out; }
            disc = js::sqrt(js::max(0.0, disc));
            for u in [(-qb - disc) / (2.0 * qa), (-qb + disc) / (2.0 * qa)] { out.push(p3(as_.x + dx * u, as_.y + dy * u, ae.z)); }
            out
        }
        (Prim::Arc { cx: acx, cy: acy, r: ar, z1: az1, .. }, Prim::Arc { cx: bcx, cy: bcy, r: br, .. }) => {
            let ddx = bcx - acx; let ddy = bcy - acy; let d = js::hypot2(ddx, ddy);
            if d < 1e-12 || d > ar + br + 1e-9 || d < (ar - br).abs() - 1e-9 { return out; }
            let x = (ar * ar - br * br + d * d) / (2.0 * d); let h = js::sqrt(js::max(0.0, ar * ar - x * x));
            let ux = ddx / d; let uy = ddy / d; let px = acx + ux * x; let py = acy + uy * x;
            out.push(p3(px - uy * h, py + ux * h, *az1)); out.push(p3(px + uy * h, py - ux * h, *az1));
            out
        }
        _ => out,
    }
}
fn nearest(c: &[P3], rf: P3, p: Option<&Prim>, q: Option<&Prim>) -> Option<P3> {
    let mut best = None; let mut bd = f64::INFINITY;
    for &x in c {
        if let Some(p) = p { if !on_p(x, p, 1e-5) { continue; } }
        if let Some(q) = q { if !on_p(x, q, 1e-5) { continue; } }
        let d = js::hypot2(x.x - rf.x, x.y - rf.y);
        if d < bd { bd = d; best = Some(x); }
    }
    best
}
fn foot(c: P3, p: &Prim) -> Option<P3> {
    match p {
        Prim::Line { s, e } => {
            let dx = e.x - s.x; let dy = e.y - s.y; let l2 = dx * dx + dy * dy; if l2 < 1e-18 { return None; }
            let u = ((c.x - s.x) * dx + (c.y - s.y) * dy) / l2;
            Some(p3(s.x + dx * u, s.y + dy * u, s.z))
        }
        Prim::Arc { cx, cy, r, z0, .. } => {
            let vx = c.x - cx; let vy = c.y - cy; let l = js::hypot2(vx, vy); if l < 1e-12 { return None; }
            Some(p3(cx + vx / l * r, cy + vy / l * r, *z0))
        }
        Prim::Invalid => None,
    }
}

/// what moveFrom() copies from its template (a move, a mark, or an object literal)
#[derive(Clone, Debug)]
struct Tpl {
    kind: &'static str, feed: f64, tool: f64, tool_r: f64, tool_dr: f64, tool_l: J<f64>, stick: J<f64>, tool_name: J<String>, spindle: f64, coolant: bool,
    block: f64, cycle: Option<String>, rot0: Option<Rot>, rot1: Option<Rot>, seq: J<f64>,
}
fn tpl_move(m: &Move) -> Tpl {
    Tpl { kind: m.kind.as_str(), feed: m.feed, tool: m.tool, tool_r: m.tool_r, tool_dr: m.tool_dr, tool_l: m.tool_l.clone(), stick: m.stick.clone(), tool_name: m.tool_name.clone(),
        spindle: m.spindle, coolant: m.coolant, block: m.block, cycle: m.cycle.clone(), rot0: m.rot0, rot1: m.rot1, seq: m.seq.clone() }
}
fn tpl_mark(k: &Mark) -> Tpl {
    Tpl { kind: "mark", feed: k.feed.unwrap_or(f64::NAN), tool: k.tool, tool_r: k.tool_r, tool_dr: k.tool_dr, tool_l: J::Absent, stick: J::Absent, tool_name: k.tool_name.clone(),
        spindle: k.spindle, coolant: k.coolant, block: k.block, cycle: None, rot0: None, rot1: None, seq: J::Val(k.seq) }
}
#[derive(Default)]
struct Extra { kind: Option<&'static str>, feed: Option<f64>, block: Option<f64>, rc: Option<Option<String>>, rc_act: Option<bool> }

fn move_from(p: &Prim, tpl: &Tpl, extra: Extra) -> Move {
    let from = p_start(p); let to = p_end(p);
    let mut kind_s: &'static str = if tpl.kind == "arc" { "feed" } else { tpl.kind };
    let mut mv = Move {
        kind: MK::Feed, from, to, cx: None, cy: None, ccw: false, sweep: None, feed: tpl.feed, tool: tpl.tool, tool_r: tpl.tool_r, tool_dr: js::or(tpl.tool_dr, 0.0),
        tool_l: tpl.tool_l.clone(), stick: tpl.stick.clone(), tool_name: tpl.tool_name.clone(), spindle: tpl.spindle, s_rpm: J::Absent, coolant: tpl.coolant, block: tpl.block,
        cycle: tpl.cycle.clone(), rc: None, rc_act: false, seq: tpl.seq.clone(), rot0: tpl.rot1.or(tpl.rot0), rot1: tpl.rot1, dur: None, len: 0.0, probe: false, touch: false,
    };
    if let Prim::Arc { cx, cy, r, sw, z0, z1, .. } = p {
        kind_s = "arc"; mv.cx = Some(*cx); mv.cy = Some(*cy); mv.ccw = *sw > 0.0; mv.sweep = Some(*sw);
        if tpl.kind == "rapid" { mv.feed = RAPID_RATE; }
        mv.len = js::sqrt(r * sw * r * sw + (z1 - z0) * (z1 - z0));
    } else { mv.len = dist3(mv.from, mv.to); }
    if let Some(k) = extra.kind { kind_s = k; }
    if let Some(f) = extra.feed { mv.feed = f; }
    if let Some(b) = extra.block { mv.block = b; }
    if let Some(rc) = extra.rc { mv.rc = rc; }
    if let Some(a) = extra.rc_act { mv.rc_act = a; }
    if matches!(p, Prim::Arc { .. }) { kind_s = "arc"; }
    mv.kind = match kind_s { "rapid" => MK::Rapid, "arc" => MK::Arc, _ => MK::Feed };
    mv
}
fn line_p(a: P3, b: P3) -> Prim { Prim::Line { s: a, e: b } }
#[allow(clippy::too_many_arguments)]
fn arc_p(cx: f64, cy: f64, r: f64, a0: f64, sw: f64, z0: f64, z1: f64) -> Prim { Prim::Arc { cx, cy, r, a0, sw, z0, z1 } }

fn resolve_corners(st: &mut St) {
    let mut k: isize = 0;
    while (k as usize) < st.moves.len() {
        let ku = k as usize;
        let m = match &st.moves[ku] { Item::K(m) if m.mark == "RND" || m.mark == "CHF" => m.clone(), _ => { k += 1; continue; } };
        let bad_msg = if m.mark == "CHF" { "CHAMFER NOT PERMITTED" } else { "ROUNDING-OFF NOT PERMITTED" };
        let a = if ku >= 1 { st.moves.get(ku - 1).cloned() } else { None };
        let b = st.moves.get(ku + 1).cloned();
        let (a, b) = match (a, b) { (Some(Item::M(a)), Some(Item::M(b))) => (a, b), _ => { fail(st, m.block as usize, bad_msg); st.moves.remove(ku); k -= 1; k += 1; continue; } };
        let mut p = prim_of(&a); let mut q = prim_of(&b);
        if !planar(&p) || !planar(&q) { fail(st, m.block as usize, bad_msg); st.moves.remove(ku); continue; }
        let t1 = p_tan(&p, true).unwrap(); let t2 = p_tan(&q, false).unwrap(); let cross = t1.0 * t2.1 - t1.1 * t2.0; let pp = p_end(&p);
        let feed = js::or(m.feed.unwrap_or(0.0), a.feed);
        let ins = if m.mark == "CHF" {
            let (ps, pe, qs, qe) = match (&p, &q) { (Prim::Line { s: ps, e: pe }, Prim::Line { s: qs, e: qe }) => (*ps, *pe, *qs, *qe), _ => { fail(st, m.block as usize, "CHAMFER NOT PERMITTED"); st.moves.remove(ku); continue; } };
            let l1 = js::hypot2(pe.x - ps.x, pe.y - ps.y); let l2 = js::hypot2(qe.x - qs.x, qe.y - qs.y);
            if m.len > l1 + 1e-9 || m.len > l2 + 1e-9 { fail(st, m.block as usize, "CHAMFER NOT PERMITTED"); st.moves.remove(ku); continue; }
            let tt1 = p3(pp.x - t1.0 * m.len, pp.y - t1.1 * m.len, ps.z + (pe.z - ps.z) * (1.0 - m.len / l1));
            let tt2 = p3(pp.x + t2.0 * m.len, pp.y + t2.1 * m.len, pp.z);
            set_end_p(&mut p, tt1); set_start_p(&mut q, tt2);
            line_p(tt1, tt2)
        } else {
            if cross.abs() < 1e-9 { st.moves.remove(ku); continue; }
            let s = if cross > 0.0 { 1.0 } else { -1.0 };
            let op = offset_p(&p, s, m.r); let oq = offset_p(&q, s, m.r);
            let c = match (&op, &oq) { (Some(o1), Some(o2)) if !matches!(o1, Prim::Invalid) && !matches!(o2, Prim::Invalid) => nearest(&isect(o1, o2), pp, None, None), _ => None };
            let f1 = c.and_then(|c| foot(c, &p)); let f2 = c.and_then(|c| foot(c, &q));
            let ok = match (c, f1, f2) { (Some(_), Some(f1), Some(f2)) => on_p(f1, &p, 1e-5) && on_p(f2, &q, 1e-5), _ => false };
            if !ok { fail(st, m.block as usize, "ROUNDING-OFF RADIUS TOO LARGE"); st.moves.remove(ku); continue; }
            let c = c.unwrap(); let mut f1 = f1.unwrap(); let mut f2 = f2.unwrap();
            f1.z = pp.z; f2.z = pp.z;
            set_end_p(&mut p, f1); set_start_p(&mut q, f2);
            let a0 = js::atan2(f1.y - c.y, f1.x - c.x); let a1 = js::atan2(f2.y - c.y, f2.x - c.x);
            arc_p(c.x, c.y, m.r, a0, dir_angle(a0, a1, s), pp.z, pp.z)
        };
        let n_a = move_from(&p, &tpl_move(&a), Extra { rc: Some(a.rc.clone()), rc_act: Some(a.rc_act), ..Default::default() });
        let n_b = move_from(&q, &tpl_move(&b), Extra { rc: Some(b.rc.clone()), rc_act: Some(b.rc_act), ..Default::default() });
        let lit = Tpl { kind: if a.kind == MK::Rapid && b.kind == MK::Rapid { "rapid" } else { "feed" }, feed, tool: a.tool, tool_r: a.tool_r, tool_dr: a.tool_dr,
            tool_l: J::Absent, stick: J::Absent, tool_name: a.tool_name.clone(), spindle: a.spindle, coolant: a.coolant, block: m.block, cycle: None, rot0: None, rot1: None, seq: J::Absent };
        let n_i = move_from(&ins, &lit, Extra { rc: Some(b.rc.clone()), ..Default::default() });
        st.moves.splice(ku - 1..ku + 2, [Item::M(n_a), Item::M(n_i), Item::M(n_b)]);
        k += 1;
    }
}

fn lct_arc(ext: P3, cp: P3, t: (f64, f64), r: f64, cs: f64, approach: bool) -> Option<(P3, Prim)> {
    let cx = cp.x - t.1 * cs * r; let cy = cp.y + t.0 * cs * r;
    let vx = ext.x - cx; let vy = ext.y - cy; let d2 = vx * vx + vy * vy;
    if d2 < r * r - 1e-9 { return None; }
    let base = r * r / d2; let sc = r * js::sqrt(js::max(0.0, d2 - r * r)) / d2;
    let cands = [(cx + base * vx - sc * vy, cy + base * vy + sc * vx), (cx + base * vx + sc * vy, cy + base * vy - sc * vx)];
    for h in cands {
        let lx = if approach { h.0 - ext.x } else { ext.x - h.0 }; let ly = if approach { h.1 - ext.y } else { ext.y - h.1 }; let ll = js::hypot2(lx, ly);
        let rx = (h.0 - cx) / r; let ry = (h.1 - cy) / r; let tx = -ry * cs; let ty = rx * cs;
        if ll < 1e-9 || (lx * tx + ly * ty) / ll > 1.0 - 1e-6 {
            let ha = js::atan2(h.1 - cy, h.0 - cx); let ca = js::atan2(cp.y - cy, cp.x - cx);
            let sw = if approach { dir_angle(ha, ca, cs) } else { dir_angle(ca, ha, cs) };
            return Some((p3(h.0, h.1, cp.z), arc_p(cx, cy, r, if approach { ha } else { ca }, sw, cp.z, cp.z)));
        }
    }
    None
}
fn appr_plan(m: &Mark, pa: P3, t: (f64, f64), side: &str) -> Option<(&'static str, P3, Prim)> {
    let s = if side == "RL" { 1.0 } else { -1.0 }; let ps = m.from;
    match m.form.as_str() {
        "LT" => { let h = p3(pa.x - t.0 * m.len, pa.y - t.1 * m.len, pa.z); Some(("entry", h, line_p(h, pa))) }
        "LN" => { let h = p3(pa.x - t.1 * s * m.len, pa.y + t.0 * s * m.len, pa.z); Some(("entry", h, line_p(h, pa))) }
        "CT" => {
            let r = m.r.abs(); let d = s * if m.r < 0.0 { -1.0 } else { 1.0 };
            let cx = pa.x - t.1 * d * r; let cy = pa.y + t.0 * d * r; let ea = js::atan2(pa.y - cy, pa.x - cx);
            let sw = d * m.cca * PI / 180.0; let sa = ea - sw;
            let h = p3(cx + r * js::cos(sa), cy + r * js::sin(sa), pa.z);
            Some(("entry", h, arc_p(cx, cy, r, sa, sw, pa.z, pa.z)))
        }
        "LCT" => { let (h, arc) = lct_arc(p3(ps.x, ps.y, pa.z), pa, t, m.r.abs(), s, true)?; Some(("lct", h, arc)) }
        _ => None,
    }
}
fn emit_appr(out: &mut Vec<Move>, m: &Mark, plan: &(&'static str, P3, Prim), tpl: &Tpl) {
    let ps = m.from; let h = plan.1;
    let entry_feed = if plan.0 == "lct" { m.feed.unwrap_or(f64::NAN) } else { m.entry_feed };
    out.push(move_from(&line_p(ps, p3(h.x, h.y, ps.z)), tpl, Extra { kind: Some("feed"), feed: Some(entry_feed), block: Some(m.block), ..Default::default() }));
    if (ps.z - h.z).abs() > 1e-9 { out.push(move_from(&line_p(p3(h.x, h.y, ps.z), h), tpl, Extra { kind: Some("feed"), feed: m.feed, block: Some(m.block), ..Default::default() })); }
    out.push(move_from(&plan.2, tpl, Extra { kind: Some("feed"), feed: m.feed, block: Some(m.block), ..Default::default() }));
}
fn dep_plan(m: &Mark, pe: P3, t: (f64, f64), side: &str) -> Option<Vec<Prim>> {
    let s = if side == "RL" { 1.0 } else { -1.0 }; let mut prims = vec![];
    match m.form.as_str() {
        "LT" => prims.push(line_p(pe, p3(pe.x + t.0 * m.len, pe.y + t.1 * m.len, pe.z))),
        "LN" => prims.push(line_p(pe, p3(pe.x - t.1 * s * m.len, pe.y + t.0 * s * m.len, pe.z))),
        "CT" => {
            let r = m.r.abs(); let d = s * if m.r < 0.0 { -1.0 } else { 1.0 };
            let cx = pe.x - t.1 * d * r; let cy = pe.y + t.0 * d * r; let a0 = js::atan2(pe.y - cy, pe.x - cx);
            prims.push(arc_p(cx, cy, r, a0, d * m.cca * PI / 180.0, pe.z, pe.z));
        }
        "LCT" => {
            let to = m.to.unwrap();
            let (h, arc) = lct_arc(p3(to.x, to.y, pe.z), pe, t, m.r.abs(), s, false)?;
            prims.push(arc); prims.push(line_p(h, p3(to.x, to.y, pe.z)));
            if (to.z - pe.z).abs() > 1e-9 { prims.push(line_p(p3(to.x, to.y, pe.z), to)); }
        }
        _ => return None,
    }
    Some(prims)
}
fn carry_xy(mv: &mut [Item], j: usize, end: P3) {
    let nx = match mv.get(j) { Some(Item::M(m)) => m.clone(), _ => return };
    let pure_z = (nx.to.x - nx.from.x).abs() < 1e-9 && (nx.to.y - nx.from.y).abs() < 1e-9 && nx.kind != MK::Arc;
    let (ox, oy) = (nx.from.x, nx.from.y);
    { let m = mv[j].mv_mut(); m.from = end; }
    if pure_z {
        { let m = mv[j].mv_mut(); m.to.x = end.x; m.to.y = end.y; }
        let mut k = j + 1;
        while k < mv.len() {
            let f = match &mut mv[k] { Item::M(f) if f.kind != MK::Arc => f, _ => break };
            if (f.from.x - ox).abs() > 1e-9 || (f.from.y - oy).abs() > 1e-9 { break; }
            f.from.x = end.x; f.from.y = end.y;
            if (f.to.x - ox).abs() < 1e-9 && (f.to.y - oy).abs() < 1e-9 { f.to.x = end.x; f.to.y = end.y; f.len = dist3(f.from, f.to); } else { f.len = dist3(f.from, f.to); break; }
            k += 1;
        }
    }
    let cur = mv[j].mv().clone();
    if cur.kind == MK::Arc { let mut p = prim_of(&cur); set_start_p(&mut p, end); mv[j] = Item::M(move_from(&p, &tpl_move(&cur), Extra { rc: Some(cur.rc.clone()), ..Default::default() })); }
    else { let m = mv[j].mv_mut(); m.len = dist3(m.from, m.to); }
}

struct RunOut { out: Vec<Move>, end: P3, tan: Option<(f64, f64)> }
fn comp_run(st: &mut St, a: usize, b: usize) -> Option<RunOut> {
    let head = st.moves[a].clone();
    let side = head.rc().unwrap_or("").to_string(); let s = if side == "RL" { 1.0 } else { -1.0 };
    let appr = if let Item::K(k) = &head { Some(k.clone()) } else { None };
    let (h_tr, h_tdr, h_block) = match &head { Item::M(m) => (m.tool_r, m.tool_dr, m.block), Item::K(k) => (k.tool_r, k.tool_dr, k.block) };
    let r = js::or(h_tr, 0.0) + js::or(h_tdr, 0.0);
    let body: Vec<Move> = st.moves[a + 1..b + 1].iter().map(|i| i.mv().clone()).collect();
    if !(r >= 0.0) { fail(st, h_block as usize, "TOOL RADIUS TOO LARGE"); return None; }
    struct It { m: Move, nom: Prim, off: Option<Prim> }
    let mut items: Vec<It> = body.into_iter().map(|m| { let p = prim_of(&m); let off = if planar(&p) { offset_p(&p, s, r) } else { None }; It { m, nom: p, off } }).collect();
    let xy: Vec<usize> = (0..items.len()).filter(|&i| items[i].off.is_some()).collect();
    for &i in &xy { if matches!(items[i].off, Some(Prim::Invalid)) { let blk = items[i].m.block; fail(st, blk as usize, "TOOL RADIUS TOO LARGE"); return None; } }
    if xy.is_empty() { if appr.is_some() { fail(st, h_block as usize, "TANGENTIAL CONNECTION NOT POSSIBLE"); } return None; }
    let mut trans: HashMap<usize, Prim> = HashMap::new();
    for i in 0..xy.len().saturating_sub(1) {
        let (li, ri) = (xy[i], xy[i + 1]);
        let corner = p_end(&items[li].nom);
        let t1 = p_tan(&items[li].nom, true).unwrap(); let t2 = p_tan(&items[ri].nom, false).unwrap();
        let cross = t1.0 * t2.1 - t1.1 * t2.0; let dot = t1.0 * t2.0 + t1.1 * t2.1;
        if cross.abs() < 1e-9 && dot > 0.0 {
            let sn = p_end(items[li].off.as_ref().unwrap());
            set_end_p(items[li].off.as_mut().unwrap(), sn); set_start_p(items[ri].off.as_mut().unwrap(), sn); continue;
        }
        if s * cross < 0.0 || (cross.abs() < 1e-9 && dot < 0.0) {
            let f = p_end(items[li].off.as_ref().unwrap()); let g = p_start(items[ri].off.as_ref().unwrap());
            let aa0 = js::atan2(f.y - corner.y, f.x - corner.x); let aa1 = js::atan2(g.y - corner.y, g.x - corner.x);
            let dir = if cross.abs() < 1e-9 { -s } else if cross > 0.0 { 1.0 } else { -1.0 };
            if r > 1e-9 { trans.insert(i, arc_p(corner.x, corner.y, r, aa0, dir_angle(aa0, aa1, dir), f.z, g.z)); }
        } else {
            let p = items[li].off.clone().unwrap(); let q = items[ri].off.clone().unwrap();
            let x = nearest(&isect(&p, &q), p_end(&p), Some(&p), Some(&q));
            let mut x = match x { None => { let blk = items[ri].m.block; fail(st, blk as usize, "TOOL RADIUS TOO LARGE"); return None; } Some(x) => x };
            x.z = corner.z; set_end_p(items[li].off.as_mut().unwrap(), x); set_start_p(items[ri].off.as_mut().unwrap(), x);
        }
    }
    let mut out = vec![]; let first = p_start(items[xy[0]].off.as_ref().unwrap()); let mut cur;
    if let Some(ap) = &appr {
        let t0 = p_tan(items[xy[0]].off.as_ref().unwrap(), false);
        let plan = t0.and_then(|t| appr_plan(ap, first, t, &side));
        let plan = match plan { None => { fail(st, ap.block as usize, "TANGENTIAL CONNECTION NOT POSSIBLE"); return None; } Some(p) => p };
        emit_appr(&mut out, ap, &plan, &tpl_mark(ap));
        cur = first;
    } else {
        let hm = head.mv();
        let act = p3(first.x, first.y, hm.to.z);
        out.push(move_from(&line_p(hm.from, act), &tpl_move(hm), Extra { rc: Some(Some(side.clone())), ..Default::default() }));
        cur = act;
    }
    let mut xi = 0;
    for it in items.iter_mut() {
        if it.off.is_none() {
            let ez = if let Prim::Line { e, .. } = &it.nom { e.z } else { f64::NAN };
            let vz = p3(cur.x, cur.y, ez);
            if (vz.z - cur.z).abs() > 1e-9 { out.push(move_from(&line_p(cur, vz), &tpl_move(&it.m), Extra { rc: Some(Some(side.clone())), ..Default::default() })); }
            cur = vz; continue;
        }
        let mut op = it.off.clone().unwrap();
        if (p_start(&op).z - cur.z).abs() > 1e-9 { if let Prim::Line { s, .. } = &mut op { s.z = cur.z; } }
        out.push(move_from(&op, &tpl_move(&it.m), Extra { rc: Some(Some(side.clone())), ..Default::default() })); cur = p_end(&op);
        if let Some(tr) = trans.get(&xi) { out.push(move_from(tr, &tpl_move(&it.m), Extra { rc: Some(Some(side.clone())), ..Default::default() })); cur = p_end(tr); }
        xi += 1;
    }
    let tan = p_tan(items[*xy.last().unwrap()].off.as_ref().unwrap(), true);
    Some(RunOut { out, end: cur, tan })
}

fn contour_pass(st: &mut St) {
    if !st.moves.iter().any(|m| m.is_mark() || m.rc().map(|r| !r.is_empty()).unwrap_or(false)) { return; }
    resolve_corners(st);
    let mut i: isize = 0;
    while (i as usize) < st.moves.len() {
        let iu = i as usize;
        let m = st.moves[iu].clone();
        let m_rc = m.rc().map(|s| s.to_string());
        let is_appr = matches!(&m, Item::K(k) if k.mark == "APPR");
        let run_head = matches!(m_rc.as_deref(), Some("RL") | Some("RR")) && (m.rc_act() || is_appr);
        let r0appr = is_appr && m_rc.as_deref().map(|s| s.is_empty()).unwrap_or(true);
        if run_head {
            let mut j = iu + 1;
            while j < st.moves.len() && !st.moves[j].is_mark() && st.moves[j].rc().map(|s| s.to_string()) == m_rc && !st.moves[j].rc_act() { j += 1; }
            let res = comp_run(st, iu, j - 1);
            let res = match res { None => { if m.is_mark() { st.moves.remove(iu); i -= 1; } i += 1; continue; } Some(r) => r };
            let dep = match st.moves.get(j) { Some(Item::K(k)) if k.mark == "DEP" => Some(k.clone()), _ => None };
            let mut dep_out: Vec<Move> = vec![]; let mut end = res.end;
            if let Some(d) = &dep {
                let dp = res.tan.and_then(|t| dep_plan(d, res.end, t, m_rc.as_deref().unwrap()));
                match dp {
                    None => fail(st, d.block as usize, "TANGENTIAL CONNECTION NOT POSSIBLE"),
                    Some(dp) => { for p in &dp { dep_out.push(move_from(p, &tpl_mark(d), Extra { kind: Some("feed"), feed: d.feed, ..Default::default() })); } end = p_end(dp.last().unwrap()); }
                }
            }
            let mut repl: Vec<Item> = res.out.into_iter().map(Item::M).collect();
            repl.extend(dep_out.into_iter().map(Item::M));
            let n = repl.len();
            st.moves.splice(iu..j + if dep.is_some() { 1 } else { 0 }, repl);
            carry_xy(&mut st.moves, iu + n, end);
            i += n as isize - 1;
        } else if r0appr {
            let k = if let Item::K(k) = &m { k.clone() } else { unreachable!() };
            let nx = match st.moves.get(iu + 1) { Some(Item::M(n)) => Some(n.clone()), _ => None };
            let t = nx.as_ref().and_then(|n| p_tan(&prim_of(n), false));
            let plan = t.and_then(|t| appr_plan(&k, k.to.unwrap(), t, "RR"));
            let plan = match plan { None => { fail(st, k.block as usize, "TANGENTIAL CONNECTION NOT POSSIBLE"); st.moves.remove(iu); i -= 1; i += 1; continue; } Some(p) => p };
            let mut o = vec![]; emit_appr(&mut o, &k, &plan, &tpl_mark(&k));
            let n = o.len();
            st.moves.splice(iu..iu + 1, o.into_iter().map(Item::M));
            i += n as isize - 1;
        } else if let Item::K(k) = &m {
            if k.mark == "DEP" {
                let pv = if iu > 0 { match &st.moves[iu - 1] { Item::M(p) => Some(p.clone()), _ => None } } else { None };
                let tt = pv.as_ref().and_then(|p| p_tan(&prim_of(p), true));
                let dq = tt.and_then(|t| dep_plan(k, pv.as_ref().unwrap().to, t, if k.side.as_deref() == Some("RL") { "RL" } else { "RR" }));
                let dq = match dq { None => { fail(st, k.block as usize, "TANGENTIAL CONNECTION NOT POSSIBLE"); st.moves.remove(iu); i -= 1; i += 1; continue; } Some(d) => d };
                let o2: Vec<Move> = dq.iter().map(|p| move_from(p, &tpl_mark(k), Extra { kind: Some("feed"), feed: k.feed, ..Default::default() })).collect();
                let n = o2.len(); let end = p_end(dq.last().unwrap());
                st.moves.splice(iu..iu + 1, o2.into_iter().map(Item::M));
                carry_xy(&mut st.moves, iu + n, end);
                i += n as isize - 1;
            }
        }
        i += 1;
    }
    st.moves.retain(|m| match m { Item::K(_) => false, Item::M(m) => m.len > EPS || m.rc_act });
    st.moves.retain(|m| match m { Item::M(m) => m.len > EPS, _ => false });
}

/* ------------------------------------------------------------------ compile */

re!(re_comment_tool, &format!(r"(?i)^T(\d+){ws}+D={ws}*([+-]?\d+\.?\d*)", ws = js::WS));

pub struct Stats { pub block_count: f64, pub move_count: f64, pub path_feed: f64, pub path_rapid: f64, pub cycle_time: f64, pub min_z: f64, pub max_z: f64, pub tools_used: Vec<ToolStat>, pub removed: f64 }
pub struct Compiled { pub moves: Vec<Move>, pub stock: Stock, pub stats: Stats, pub errors: Vec<(usize, String)>, pub exec: Vec<usize> }

pub fn compile(blocks: &mut Vec<Block>, opts: &Opts) -> Compiled {
    for b in blocks.iter_mut() { b.error = b.perr.clone(); }
    let builtin = crate::tools();
    let mut st = St {
        blocks, pos: p3(0., 0., 0.), mpos: p3(0., 0., 0.), xf: Xf { s: 1.0, ..Default::default() }, steps: 0, exec: vec![], seq: 0.0,
        rot: Rot { a: 0., b: 0., c: 0. }, rot_to: None, feed: DEFAULT_FEED, tool: Tool { t: 0.0, name: J::Val(String::new()), r: 3.0, l: 0.0, dr: 0.0 },
        spindle: 0.0, s_rpm: 0.0, spin_dir: 0.0, coolant: false, cc: None, rc: "R0".into(), rc_act: false, last_tan: None,
        tool_defs: HashMap::new(), presets: HashMap::new(), q: QMap::default(), cycle: None, moves: vec![], errors: vec![], stock: Stock::default(),
        abort: false, done: false, tool_order: vec![], tool_stat: HashMap::new(),
        tool_table: opts.tools.clone().unwrap_or(builtin), mach: opts.mach.clone(), arc_tol: js::or(opts.mach.arc_tol, ARC_TOL), holder: opts.holder_a, auto_tools: opts.auto_tools,
        labels: HashMap::new(), comment_tools: HashMap::new(), auto_feed: f64::NAN,
        cap: false, sl_labels: None, sl_data: None,
    };
    for i in 0..st.blocks.len() {
        if st.blocks[i].kind == Kind::Lbl {
            let k = Lbl::from_v(st.blocks[i].args.get("lbl").unwrap_or(&V::Null)).key();
            st.labels.entry(k).or_insert(i);
        }
    }
    for i in 0..st.blocks.len() {
        if let Some(cm) = st.blocks[i].args.str("comment") {
            if cm.is_empty() { continue; }
            if let Some(m) = re_comment_tool().captures(cm) {
                let t = parse::parse_int(&m[1]);
                let r = parse::parse_float(&m[2]).abs() / 2.0;
                st.comment_tools.insert(js::num_str(t), r);
            }
        }
    }
    let last = st.blocks.len() as isize - 1;
    exec_range(&mut st, 0, last, 0);
    contour_pass(&mut st);

    let mut first: isize = -1;
    for i in 0..st.blocks.len() { let k = st.blocks[i].kind; if k == Kind::Blank || k == Kind::Comment { continue; } first = i as isize; break; }
    if first < 0 || st.blocks[first as usize].kind != Kind::Begin { fail(&mut st, if first < 0 { 0 } else { first as usize }, "PROGRAM START UNDEFINED"); }

    let stock = st.stock.clone();
    let stock_top = js::max(stock.z0, stock.z1);
    let (mut path_feed, mut path_rapid, mut cycle_time, mut removed) = (0.0, 0.0, 0.0, 0.0);
    let mut min_z = f64::INFINITY; let mut max_z = f64::NEG_INFINITY;
    let moves: Vec<Move> = st.moves.drain(..).map(|i| if let Item::M(m) = i { m } else { unreachable!() }).collect();
    for mv in &moves {
        let f = if mv.kind == MK::Rapid { RAPID_RATE } else { mv.feed };
        let t = match mv.dur { Some(d) => d, None => if f > 0.0 { (mv.len / f) * 60.0 } else { 0.0 } };
        cycle_time += t;
        if mv.kind == MK::Rapid { path_rapid += mv.len; } else { path_feed += mv.len; }
        min_z = js::min_n(&[min_z, mv.from.z, mv.to.z]); max_z = js::max_n(&[max_z, mv.from.z, mv.to.z]);
        if mv.kind != MK::Rapid && !mv.probe {
            let depth = stock_top - (mv.from.z + mv.to.z) / 2.0;
            if depth > 0.0 { removed += 2.0 * mv.tool_r * depth * mv.len; }
        }
        let tk = js::num_str(mv.tool);
        let ts = st.tool_stat.entry(tk).or_insert_with(|| { st.tool_order.push(mv.tool); ToolStat { t: mv.tool, name: mv.tool_name.clone(), r: mv.tool_r, l: 0.0, moves: 0.0, time: 0.0 } });
        ts.moves += 1.0; ts.time += t;
    }
    if !min_z.is_finite() { min_z = 0.0; max_z = 0.0; }
    let mut tools_used = vec![];
    for t in &st.tool_order { if let Some(e) = st.tool_stat.get(&js::num_str(*t)) { if e.t != 0.0 { tools_used.push(e.clone()); } } }
    Compiled {
        stats: Stats { block_count: st.blocks.len() as f64, move_count: moves.len() as f64, path_feed, path_rapid, cycle_time, min_z, max_z, tools_used, removed },
        moves, stock, errors: st.errors, exec: st.exec,
    }
}

pub fn lbl_of(s: &str) -> Lbl { lbl_key(s) }
