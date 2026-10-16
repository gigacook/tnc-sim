//! The material model (formerly sim/stock.js): a height field of f32 columns (as the Float32Array was), the tool
//! body stamped into it, probes for rapids and the holder, and the vice. Same arithmetic, same order.

use crate::js;

pub const HEAD_LEN: f64 = 300.0;
const VICE_STEP: f64 = 1.0;
const BIG: f64 = 1e6;
const SHRINK: f64 = 0.02;
const NUT_R: f64 = 25.0;
pub struct Vice { pub on: bool }
const GRIP: f64 = 6.0;
const MIN_GRIP: f64 = 1.0 / 3.0;
const JAW_T: f64 = 25.0;
const JAW_W: f64 = 160.0;
const BELOW: f64 = 40.0;
fn flute_def(r: f64) -> f64 { js::max(30.0, r * 7.0) }

#[derive(Clone, Copy, Debug)]
pub struct St { pub x0: f64, pub y0: f64, pub z0: f64, pub x1: f64, pub y1: f64, pub z1: f64 }
#[derive(Clone, Copy, Debug)]
pub struct Grid { pub nx: f64, pub ny: f64, pub dx: f64, pub dy: f64 }
/// what the stock functions read from a segment
#[derive(Clone, Copy, Debug)]
pub struct Tool { pub tool_r: f64, pub cone: bool, pub ball: bool, pub tool_r2: f64, pub stick: f64 }
#[derive(Clone, Copy, Debug)]
pub struct P { pub x: f64, pub y: f64, pub z: f64 }
pub type Ax = Option<[f64; 3]>;

/// A height field, or a window of one: columns addressed by their grid (i, j).
pub trait Field {
    fn get(&self, i: usize, j: usize) -> f32;
    fn set(&mut self, i: usize, j: usize, v: f32);
}
pub struct Full<'a> { pub hm: &'a mut [f32], pub nx: usize }
impl Field for Full<'_> {
    fn get(&self, i: usize, j: usize) -> f32 { self.hm[j * self.nx + i] }
    fn set(&mut self, i: usize, j: usize, v: f32) { self.hm[j * self.nx + i] = v; }
}
/// rows j0.. of columns i0.. copied out of the JS field (the browser passes only what the tool can touch)
pub struct Window<'a> { pub w: &'a mut [f32], pub i0: usize, pub j0: usize, pub wnx: usize }
impl Field for Window<'_> {
    fn get(&self, i: usize, j: usize) -> f32 { self.w[(j - self.j0) * self.wnx + (i - self.i0)] }
    fn set(&mut self, i: usize, j: usize, v: f32) { self.w[(j - self.j0) * self.wnx + (i - self.i0)] = v; }
}

pub fn grid(st: &St, min_r: f64) -> Grid {
    let w = js::max(1.0, st.x1 - st.x0); let h = js::max(1.0, st.y1 - st.y0);
    let min_r = if min_r.is_finite() { min_r } else { 3.0 };
    let mut cell = js::max(0.3, js::min(0.8, min_r / 2.0));
    while (w / cell + 1.0) * (h / cell + 1.0) > 150000.0 { cell *= 1.08; }
    let nx = js::max(30.0, js::round(w / cell) + 1.0); let ny = js::max(30.0, js::round(h / cell) + 1.0);
    Grid { nx, ny, dx: w / (nx - 1.0), dy: h / (ny - 1.0) }
}

/* the column ranges a visit touches: shared by the stamp itself and the browser's window copy */
pub fn disc_range(st: &St, g: &Grid, cx: f64, cy: f64, r: f64) -> [f64; 4] {
    [js::max(0.0, js::floor((cx - r - st.x0) / g.dx)), js::min(g.nx - 1.0, js::ceil((cx + r - st.x0) / g.dx)),
     js::max(0.0, js::floor((cy - r - st.y0) / g.dy)), js::min(g.ny - 1.0, js::ceil((cy + r - st.y0) / g.dy))]
}
fn bbox(p: &P, ax: &[f64; 3], r: f64, t0: f64, t1: f64) -> [f64; 4] {
    let s = r;
    let xa = p.x + ax[0] * t0; let xb = p.x + ax[0] * t1; let ya = p.y + ax[1] * t0; let yb = p.y + ax[1] * t1;
    [js::min(xa, xb) - s, js::max(xa, xb) + s, js::min(ya, yb) - s, js::max(ya, yb) + s]
}
pub fn visit_range(st: &St, g: &Grid, p: &P, ax: &[f64; 3], r: f64, t0: f64, t1: f64) -> [f64; 4] {
    let bb = bbox(p, ax, r, t0, t1);
    [js::max(0.0, js::floor((bb[0] - st.x0) / g.dx)), js::min(g.nx - 1.0, js::ceil((bb[1] - st.x0) / g.dx)),
     js::max(0.0, js::floor((bb[2] - st.y0) / g.dy)), js::min(g.ny - 1.0, js::ceil((bb[3] - st.y0) / g.dy))]
}

#[allow(clippy::too_many_arguments)]
pub fn disc(hm: &mut dyn Field, st: &St, g: &Grid, cx: f64, cy: f64, z: f64, r: f64, cone: bool, stamp: bool, eps: f64) -> bool {
    let [i0, i1, j0, j1] = disc_range(st, g, cx, cy, r);
    let r2 = r * r; let mut hit = false;
    let mut j = j0;
    while j <= j1 {
        let dy = st.y0 + j * g.dy - cy;
        let mut i = i0;
        while i <= i1 {
            let dx = st.x0 + i * g.dx - cx; let d2 = dx * dx + dy * dy;
            if d2 > r2 { i += 1.0; continue; }
            let zz = if cone { z + js::sqrt(d2) } else { z };
            let (iu, ju) = (i as usize, j as usize);
            let h = hm.get(iu, ju) as f64;
            if h > zz + eps && h > st.z0 + 1e-6 {
                hit = true;
                if stamp { hm.set(iu, ju, js::max(st.z0, zz) as f32); } else { return true; }
            }
            i += 1.0;
        }
        j += 1.0;
    }
    hit
}

/// tool axis (tip -> spindle) from the head angles at u along the segment; None = vertical
pub fn axis(a: Option<(f64, f64)>, b: Option<(f64, f64)>, u: f64) -> Ax {
    let (aa, ab) = a?;
    let (ba, bb) = b.unwrap_or((f64::NAN, f64::NAN));
    let mut av = aa + (js::or(ba, 0.0) - aa) * u;
    let mut bv = js::or(ab, 0.0) + (js::or(bb, 0.0) - js::or(ab, 0.0)) * u;
    if av.abs() < 1e-6 && bv.abs() < 1e-6 { return None; }
    av *= js::PI / 180.0; bv *= js::PI / 180.0;
    Some([-js::sin(bv) * js::cos(av), -js::sin(av), js::cos(bv) * js::cos(av)])
}
pub fn is_ball(s: &Tool) -> bool { !s.cone && (s.ball || (s.tool_r2 > 0.0 && s.tool_r2 >= s.tool_r - 1e-9)) }
fn body_len(s: &Tool) -> f64 { if s.stick > 0.0 { s.stick } else { flute_def(s.tool_r) } }

fn qmin(a: f64, b: f64, c: f64, lo: f64, hi: f64) -> f64 {
    if lo > hi { return f64::NAN; }
    if a * lo * lo + b * lo + c <= 0.0 { return lo; }
    let (mut r0, mut r1);
    if a.abs() < 1e-12 { if b.abs() < 1e-12 { return f64::NAN; } r0 = -c / b; r1 = r0; }
    else {
        let mut d = b * b - 4.0 * a * c; if d < 0.0 { return f64::NAN; } d = js::sqrt(d);
        r0 = (-b - d) / (2.0 * a); r1 = (-b + d) / (2.0 * a); if r0 > r1 { std::mem::swap(&mut r0, &mut r1); }
    }
    if r0 >= lo && r0 <= hi { return r0; }
    if r1 >= lo && r1 <= hi { return r1; }
    f64::NAN
}
fn t_range(a: f64, uz: f64, t0: f64, t1: f64) -> Option<(f64, f64)> {
    if uz.abs() < 1e-12 { if a < t0 || a > t1 { return None; } return Some((-BIG, BIG)); }
    let h0 = (t0 - a) / uz; let h1 = (t1 - a) / uz; Some((js::min(h0, h1), js::max(h0, h1)))
}
fn cyl_low(dx: f64, dy: f64, ax: &[f64; 3], r: f64, t0: f64, t1: f64) -> f64 {
    let a = dx * ax[0] + dy * ax[1]; let uz = ax[2];
    match t_range(a, uz, t0, t1) { None => f64::NAN, Some((lo, hi)) => qmin(1.0 - uz * uz, -2.0 * a * uz, dx * dx + dy * dy - a * a - r * r, lo, hi) }
}
fn cone_low(dx: f64, dy: f64, ax: &[f64; 3], r: f64) -> f64 {
    let a = dx * ax[0] + dy * ax[1]; let uz = ax[2];
    match t_range(a, uz, 0.0, r) { None => f64::NAN, Some((lo, hi)) => qmin(1.0 - 2.0 * uz * uz, -4.0 * a * uz, dx * dx + dy * dy - 2.0 * a * a, lo, hi) }
}
fn body_low(kind: i32, dx: f64, dy: f64, ax: &[f64; 3], r: f64, l: f64) -> f64 {
    let mut h = f64::NAN; let c;
    if kind == 1 {
        let cx = dx - r * ax[0]; let cy = dy - r * ax[1]; let d2 = cx * cx + cy * cy;
        if d2 <= r * r { h = r * ax[2] - js::sqrt(r * r - d2); }
        c = cyl_low(dx, dy, ax, r, r, js::max(r, l));
    } else if kind == 2 {
        h = cone_low(dx, dy, ax, r);
        c = cyl_low(dx, dy, ax, r, r, js::max(r, l));
    } else { c = cyl_low(dx, dy, ax, r, 0.0, l); }
    if h == h && !(c < h) { h } else { c }
}
#[allow(clippy::too_many_arguments)]
fn visit(hm: &mut dyn Field, st: &St, g: &Grid, p: &P, ax: &[f64; 3], kind: i32, r: f64, t0: f64, t1: f64, l: f64, stamp: bool, eps: f64) -> bool {
    let [i0, i1, j0, j1] = visit_range(st, g, p, ax, r, t0, t1);
    let mut hit = false;
    let mut j = j0;
    while j <= j1 {
        let dy = st.y0 + j * g.dy - p.y;
        let mut i = i0;
        while i <= i1 {
            let (iu, ju) = (i as usize, j as usize);
            let hv = hm.get(iu, ju) as f64;
            if !(hv > st.z0 + 1e-6) { i += 1.0; continue; }
            let dx = st.x0 + i * g.dx - p.x;
            let h = if kind < 0 { cyl_low(dx, dy, ax, r, t0, t1) } else { body_low(kind, dx, dy, ax, r, l) };
            if h != h { i += 1.0; continue; }
            let zz = p.z + h;
            if hv > zz + eps { hit = true; if stamp { hm.set(iu, ju, js::max(st.z0, zz) as f32); } else { return true; } }
            i += 1.0;
        }
        j += 1.0;
    }
    hit
}
fn kind_of(s: &Tool) -> i32 { if s.cone { 2 } else if is_ball(s) { 1 } else { 0 } }

/// the columns stamp() will visit: [i0, i1, j0, j1]
pub fn stamp_range(st: &St, g: &Grid, s: &Tool, p: &P, ax: &Ax) -> [f64; 4] {
    match ax {
        None => if is_ball(s) { visit_range(st, g, p, &[0.0, 0.0, 1.0], s.tool_r, 0.0, body_len(s)) } else { disc_range(st, g, p.x, p.y, s.tool_r) },
        Some(a) => visit_range(st, g, p, a, s.tool_r, 0.0, body_len(s)),
    }
}
pub fn stamp(hm: &mut dyn Field, st: &St, g: &Grid, s: &Tool, p: &P, ax: &Ax, eps: f64) -> bool {
    match ax {
        None => {
            if is_ball(s) { return visit(hm, st, g, p, &[0.0, 0.0, 1.0], 1, s.tool_r, 0.0, body_len(s), body_len(s), true, eps); }
            disc(hm, st, g, p.x, p.y, p.z, s.tool_r, s.cone, true, eps)
        }
        Some(a) => visit(hm, st, g, p, a, kind_of(s), s.tool_r, 0.0, body_len(s), body_len(s), true, eps),
    }
}
pub fn probe(hm: &mut dyn Field, st: &St, g: &Grid, s: &Tool, p: &P, ax: &Ax) -> bool {
    match ax {
        None => {
            if is_ball(s) { return visit(hm, st, g, p, &[0.0, 0.0, 1.0], 1, s.tool_r - SHRINK, 0.0, body_len(s), body_len(s), false, 0.05); }
            disc(hm, st, g, p.x, p.y, p.z, s.tool_r, s.cone, false, 0.05)
        }
        Some(a) => visit(hm, st, g, p, a, kind_of(s), s.tool_r - SHRINK, 0.0, body_len(s), body_len(s), false, 0.05),
    }
}
fn holder_r(s: &Tool) -> f64 { js::max(NUT_R, s.tool_r + 6.0) }
pub fn holder_hits(hm: &mut dyn Field, st: &St, g: &Grid, s: &Tool, p: &P, ax: &Ax) -> bool {
    if !(s.stick > 0.0) { return false; }
    let hr = holder_r(s);
    match ax {
        None => { let zn = p.z + s.stick; zn < st.z1 && disc(hm, st, g, p.x, p.y, zn, hr, false, false, 0.05) }
        Some(a) => visit(hm, st, g, p, a, -1, hr - SHRINK, s.stick, s.stick + HEAD_LEN, 0.0, false, 0.05),
    }
}

#[derive(Clone, Copy, Debug)]
pub struct BoxB { pub x0: f64, pub x1: f64, pub y0: f64, pub y1: f64, pub z0: f64, pub z1: f64 }
pub fn vice(st: &St, v: &Vice) -> Vec<BoxB> {
    if !v.on { return vec![]; }
    let h = st.z1 - st.z0; let top = st.z0 + js::min(GRIP, h * MIN_GRIP); let bot = st.z0 - BELOW;
    let cx = (st.x0 + st.x1) / 2.0; let hw = js::max(JAW_W, st.x1 - st.x0) / 2.0;
    vec![BoxB { x0: cx - hw, x1: cx + hw, y0: st.y0 - JAW_T, y1: st.y0, z0: bot, z1: top },
         BoxB { x0: cx - hw, x1: cx + hw, y0: st.y1, y1: st.y1 + JAW_T, z0: bot, z1: top }]
}
#[allow(clippy::too_many_arguments)]
fn box_hit(bx: &BoxB, p: &P, ax: &Ax, kind: i32, r: f64, t0: f64, t1: f64, l: f64) -> bool {
    let a = ax.unwrap_or([0.0, 0.0, 1.0]);
    let zlo = js::min(p.z + a[2] * t0, p.z + a[2] * t1) - if ax.is_some() { r * js::sqrt(js::max(0.0, 1.0 - a[2] * a[2])) } else { 0.0 };
    if zlo >= bx.z1 - 1e-6 { return false; }
    let bb = bbox(p, &a, r, t0, t1);
    let x0 = js::max(bb[0], bx.x0); let x1 = js::min(bb[1], bx.x1); let y0 = js::max(bb[2], bx.y0); let y1 = js::min(bb[3], bx.y1);
    if x0 > x1 || y0 > y1 { return false; }
    let nx = js::max(1.0, js::ceil((x1 - x0) / VICE_STEP)); let ny = js::max(1.0, js::ceil((y1 - y0) / VICE_STEP));
    let mut j = 0.0;
    while j <= ny {
        let dy = y0 + (y1 - y0) * j / ny - p.y;
        let mut i = 0.0;
        while i <= nx {
            let dx = x0 + (x1 - x0) * i / nx - p.x;
            let h = if kind < 0 { cyl_low(dx, dy, &a, r, t0, t1) } else { body_low(kind, dx, dy, &a, r, l) };
            if h == h && p.z + h < bx.z1 - 1e-6 && p.z + h > bx.z0 { return true; }
            i += 1.0;
        }
        j += 1.0;
    }
    false
}
pub fn vice_hit(s: &Tool, p: &P, ax: &Ax, jaws: &[BoxB]) -> Option<&'static str> {
    if jaws.is_empty() { return None; }
    let l = body_len(s); let kind = kind_of(s); let hr = holder_r(s);
    for bx in jaws {
        if box_hit(bx, p, ax, kind, s.tool_r, 0.0, l, l) { return Some("tool"); }
        if s.stick > 0.0 && box_hit(bx, p, ax, -1, hr, s.stick, s.stick + HEAD_LEN, 0.0) { return Some("holder"); }
    }
    None
}
