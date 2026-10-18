//! SL cycles (426/430 manual 8.6, p. 284-307): 14 CONTOUR GEOMETRY, 20 CONTOUR DATA, 21 PILOT DRILLING,
//! 22 ROUGH-OUT, 23 FLOOR FINISHING, 24 SIDE FINISHING, 25 CONTOUR TRAIN.
//!
//! From the manual: 14 and 20 are DEF active; Q1-Q19 are the cycle parameters and are written as Q parameters (p. 290);
//! subcontours are subprograms, F and M in them are ignored, the TNC closes them; pocket or island from the
//! direction + RL/RR (p. 285); overlapping pockets/islands by the rules on p. 288-289; MP 7420 bits (machine parameter
//! list: channel direction, channel or rough-out first, combine compensated contours, per-infeed order, end position);
//! 21 drills like cycle 1 at the infeed points of the rough-out tool Q13 (no DR); 25 uses only the first label, sign of
//! Q15 = climb / up-cut / alternate, DEPTH 0 = not executed.
//!
//! The manual does not draw the tool paths of 21-24. Everything below marked `SL<n>` is the simulator's own choice,
//! listed in CONTINUE.md -> OPEN, until the programming station (B5) settles it.
//!
//! Geometry: each subcontour gives an exact signed distance (lines + arcs, + inside). The combined contour is the
//! min/max combination of those, whose level set at R is exactly "combine compensated contours" (MP 7420 bit 2 = 0).
//! Tool-centre loops are that level set, traced on a grid and refined on the exact function (error < 1e-6 mm at the
//! vertices, chords between vertices <= h^2/8R, h = extent / 300). Loops are traced 3 um inside the exact offset, so
//! a chord never touches the wall: the path stays within about 0.003 mm of the exact one, always on the free side.

use super::*;
use std::collections::HashSet;

type P2 = (f64, f64);

/* ------------------------------------------------------------------ definitions */

/// cycle 14: every number on the 14.x lines ("CONTOUR LABEL 1 /2 /3")
pub(super) fn labels_of(cy: &Cycle) -> Vec<f64> {
    let mut out = vec![];
    if let Some(b) = &cy.bodies { for (k, _) in b { if let Some(v) = cy.subs.get(&qk(*k)) { for x in v { out.push(x.abs()); } } } }
    out
}
/// cycles 20-25: the parameters are Q1-Q19 themselves (manual p. 290: "cannot be used as program parameters")
pub(super) fn def_q(st: &mut St, cy: &Cycle) {
    for (k, v) in &cy.params { if let Some(v) = v { let q = f64::from_bits(*k); if (1.0..=19.0).contains(&q) { st.q.set(q, *v); } } }
}

/// emit() while a contour subprogram is captured: record the move, nothing else. Coordinates are those of the
/// transformation active at the cycle call: a datum shift etc. programmed inside the subcontour moves only the
/// contours from there on (p. 285), so the recorded move is converted machine-wise into the call's frame.
pub(super) fn capture_move(st: &mut St, kind: MK, to: P3, feed: f64, bi: usize, arc: Option<&Arc>) {
    let from = st.pos;
    let rec = |st: &St, p: P3| from_xf(&st.cap_xf, to_m(st, p));
    let flip = st.xf.flip != st.cap_xf.flip;
    let sw0 = if kind == MK::Arc { arc.map(|a| arc_sweep(from, to, a)) } else { None };
    let sw = sw0.map(|s| if flip { -s } else { s });
    let rc = match st.rc.as_str() { "RL" => Some(if flip { "RR" } else { "RL" }.to_string()), "RR" => Some(if flip { "RL" } else { "RR" }.to_string()), _ => None };
    let c = arc.map(|a| rec(st, p3(a.cx, a.cy, from.z)));
    let (f0, t0) = (rec(st, from), rec(st, to));
    st.moves.push(Item::M(Move {
        kind, from: f0, to: t0, cx: c.map(|c| c.x), cy: c.map(|c| c.y), ccw: sw.map(|s| s > 0.0).unwrap_or(false), sweep: sw,
        feed, tool: st.tool.t, tool_r: st.tool.r, tool_dr: 0.0, tool_l: J::Absent, stick: J::Absent, tool_name: J::Absent, spindle: 0.0, s_rpm: J::Absent,
        coolant: false, block: bi as f64, cycle: None, rc, rc_act: false, seq: J::Absent, rot0: None, rot1: None, dur: None, len: dist3(f0, t0), probe: false, touch: false,
    }));
    if let (MK::Arc, Some(a), Some(s)) = (kind, arc, sw0) {
        let ea = js::atan2(to.y - a.cy, to.x - a.cx); let d = if s > 0.0 { 1.0 } else { -1.0 };
        st.last_tan = Some((-js::sin(ea) * d, js::cos(ea) * d));
    } else {
        let dx = to.x - from.x; let dy = to.y - from.y; let l = js::sqrt(dx * dx + dy * dy);
        if l > EPS { st.last_tan = Some((dx / l, dy / l)); }
    }
    st.pos = to; st.mpos = to_m(st, to);
}

/* ------------------------------------------------------------------ subcontours */

struct Sub { prims: Vec<Prim>, side: String, start: P2, poly: Vec<P2>, island: bool }

/// run LBL n with emit() recording; RND / CHF resolved. The first straight move only reaches the start point.
fn capture(st: &mut St, bi: usize, lbl: f64, close: bool) -> Option<Sub> {
    let target = match st.labels.get(&Lbl::N(lbl).key()) { Some(t) => *t, None => { fail(st, bi, "LABEL NUMBER NOT FOUND"); return None; } };
    let mut end = st.blocks.len() as isize - 1;
    for j in target + 1..st.blocks.len() { if st.blocks[j].kind == Kind::LblEnd { end = j as isize; break; } }
    let save = (st.pos, st.mpos, st.rc.clone(), st.rc_act, st.last_tan, st.feed, st.spin_dir, st.spindle, st.coolant, st.done);
    st.rc = "R0".into(); st.rc_act = false;
    let n0 = st.moves.len();
    st.cap = true;
    exec_range(st, target + 1, end, 1);
    st.cap = false;
    let mut items = st.moves.split_off(n0);
    // the TNC ignores F and M in contour subprograms (p. 285)
    (st.pos, st.mpos, st.rc, st.rc_act, st.last_tan, st.feed, st.spin_dir, st.spindle, st.coolant, st.done) = save;
    std::mem::swap(&mut st.moves, &mut items); resolve_corners(st); std::mem::swap(&mut st.moves, &mut items);
    let mv: Vec<Move> = items.into_iter().filter_map(|i| if let Item::M(m) = i { Some(m) } else { None }).collect();
    if mv.is_empty() { fail(st, bi, "CYCL DEF INCOMPLETE"); return None; }
    let side = mv.iter().find_map(|m| m.rc.clone()).unwrap_or_else(|| "R0".into());
    let skip = if mv[0].kind != MK::Arc { 1 } else { 0 };
    let start = if skip == 1 { (mv[0].to.x, mv[0].to.y) } else { (mv[0].from.x, mv[0].from.y) };
    // the subprograms must not hold tool-axis coordinates (p. 285): the contour is taken flat
    let mut prims: Vec<Prim> = mv[skip..].iter().map(prim_of).filter(|p| match p { Prim::Line { s, e } => js::hypot2(e.x - s.x, e.y - s.y) > 1e-9, Prim::Arc { r, sw, .. } => (r * sw).abs() > 1e-9, _ => false }).collect();
    if prims.is_empty() { fail(st, bi, "CYCL DEF INCOMPLETE"); return None; }
    if close {
        let e = p_end(prims.last().unwrap());
        if js::hypot2(e.x - start.0, e.y - start.1) > 1e-6 { prims.push(line_p(e, p3(start.0, start.1, e.z))); }
    }
    let poly = poly_of(&prims);
    let area: f64 = (0..poly.len()).map(|i| { let a = poly[i]; let b = poly[(i + 1) % poly.len()]; a.0 * b.1 - b.0 * a.1 }).sum();
    // pocket: the tool path lies inside (CW + RR, CCW + RL); island: outside (p. 285). SL1: R0 is taken as a pocket
    let island = match side.as_str() { "RL" => area < 0.0, "RR" => area > 0.0, _ => false };
    Some(Sub { prims, side, start, poly, island })
}

/// transformations programmed inside the subcontours "need not be reset after the cycle call" (p. 285)
fn begin_capture(st: &mut St) { st.cap_xf = st.xf.clone(); }
fn end_capture(st: &mut St) { st.xf = st.cap_xf.clone(); st.pos = from_m(st, st.mpos); }

fn poly_of(prims: &[Prim]) -> Vec<P2> {
    let mut v = vec![];
    for p in prims {
        match p {
            Prim::Line { s, .. } => v.push((s.x, s.y)),
            Prim::Arc { cx, cy, r, a0, sw, .. } => {
                let n = js::max(8.0, js::ceil(sw.abs() / (PI / 90.0))) as usize;
                for i in 0..n { let a = a0 + sw * i as f64 / n as f64; v.push((cx + r * js::cos(a), cy + r * js::sin(a))); }
            }
            Prim::Invalid => {}
        }
    }
    v
}
fn dist_prim(p: &Prim, x: f64, y: f64) -> f64 {
    match p {
        Prim::Line { s, e } => {
            let dx = e.x - s.x; let dy = e.y - s.y; let l2 = dx * dx + dy * dy;
            let u = if l2 > 0.0 { (((x - s.x) * dx + (y - s.y) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
            js::hypot2(s.x + dx * u - x, s.y + dy * u - y)
        }
        Prim::Arc { cx, cy, r, a0, sw, .. } => {
            let d = if *sw >= 0.0 { 1.0 } else { -1.0 };
            if sw.abs() >= 2.0 * PI - 1e-9 || dir_angle(*a0, js::atan2(y - cy, x - cx), d).abs() <= sw.abs() { return (js::hypot2(x - cx, y - cy) - r).abs(); }
            let a1 = a0 + sw;
            js::min(js::hypot2(cx + r * js::cos(*a0) - x, cy + r * js::sin(*a0) - y), js::hypot2(cx + r * js::cos(a1) - x, cy + r * js::sin(a1) - y))
        }
        Prim::Invalid => f64::INFINITY,
    }
}
fn inside(poly: &[P2], x: f64, y: f64) -> bool {
    let mut c = false; let n = poly.len();
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        if (a.1 > y) != (b.1 > y) && x < a.0 + (y - a.1) * (b.0 - a.0) / (b.1 - a.1) { c = !c; }
    }
    c
}
/// signed distance to one subcontour: + inside its outline
fn sd(s: &Sub, x: f64, y: f64) -> f64 {
    let d = s.prims.iter().fold(f64::INFINITY, |m, p| js::min(m, dist_prim(p, x, y)));
    if inside(&s.poly, x, y) { d } else { -d }
}

/// the combined contour: f > 0 inside the area to machine, f = distance to the nearest wall where that wall alone decides
struct Field { subs: Vec<Sub>, ops: Vec<u8> }
impl Field {
    fn f(&self, x: f64, y: f64) -> f64 {
        let s0 = &self.subs[0];
        let mut f = if s0.island { -sd(s0, x, y) } else { sd(s0, x, y) };
        for (i, s) in self.subs.iter().enumerate().skip(1) {
            let d = sd(s, x, y);
            f = match self.ops[i] { 1 => js::max(f, d), 2 => js::min(f, d), _ => js::min(f, -d) };
        }
        f
    }
}

/// p. 288-289: pockets add (the first starts outside the other) or intersect (it starts inside); islands cut away.
/// SL14: the manual shows two subcontours; with more, each one is tested against the first one's start point, in order.
/// Missing 14 / 20 or an empty subcontour: CYCL DEF INCOMPLETE (the control's message is not in the manual).
fn field(st: &mut St, bi: usize) -> Option<Field> {
    let labels = match st.sl_labels.clone() { Some(l) if !l.is_empty() => l, _ => { fail(st, bi, "CYCL DEF INCOMPLETE"); return None; } };
    begin_capture(st);
    let subs: Option<Vec<Sub>> = labels.iter().take(12).map(|l| capture(st, bi, *l, true)).collect();
    end_capture(st);
    let subs = subs?;
    if subs.iter().all(|s| s.island) { fail(st, bi, "SL CONTOUR WITHOUT POCKET NOT SIMULATED"); return None; } // SL2
    let s0 = subs[0].start;
    let ops = subs.iter().enumerate().map(|(i, s)| if i == 0 { 0 } else if s.island { 3 } else if sd(s, s0.0, s0.1) > 0.0 { 2 } else { 1 }).collect();
    Some(Field { subs, ops })
}

/* ------------------------------------------------------------------ level sets */

struct Grid { x0: f64, y0: f64, h: f64, nx: usize, ny: usize, v: Vec<f64> }
/// The grid for the tool-centre level lv: h = extent / 300, halved while a band of f >= lv lies between the nodes
/// (a channel only a little wider than the tool), so such a channel is traced instead of silently left uncut.
/// shortcut: bands narrower than about h / 8 at the 4M-node cap are still missed; upgrade to an adaptive grid if that matters.
fn grid(fl: &Field, lv: f64) -> Grid {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for s in fl.subs.iter().filter(|s| !s.island) { for p in &s.poly { x0 = x0.min(p.0); y0 = y0.min(p.1); x1 = x1.max(p.0); y1 = y1.max(p.1); } }
    let mut h = js::max(js::max(x1 - x0, y1 - y0) / 300.0, 0.02);
    loop {
        let g = grid_h(fl, (x0, y0, x1, y1), h);
        if g.nx * g.ny * 4 > 4_000_000 || !hidden(&g, fl, lv + 0.003) { return g; }
        h /= 2.0;
    }
}
/// f is 1-Lipschitz: a cell whose corners are all below lv can only hold f >= lv if a corner is within h / sqrt 2 of lv
fn hidden(g: &Grid, fl: &Field, lv: f64) -> bool {
    let nx = g.nx;
    for j in 0..g.ny - 1 { for i in 0..nx - 1 {
        let c = [g.v[j * nx + i], g.v[j * nx + i + 1], g.v[(j + 1) * nx + i], g.v[(j + 1) * nx + i + 1]];
        if c.iter().any(|&v| v >= lv) || c.iter().all(|&v| v < lv - g.h * 0.7072) { continue; }
        for a in 1..8 { for b in 1..8 {
            if fl.f(g.x0 + (i as f64 + a as f64 / 8.0) * g.h, g.y0 + (j as f64 + b as f64 / 8.0) * g.h) >= lv { return true; }
        } }
    } }
    false
}
fn grid_h(fl: &Field, (x0, y0, x1, y1): (f64, f64, f64, f64), h: f64) -> Grid {
    let (gx, gy) = (x0 - 2.0 * h, y0 - 2.0 * h);
    let nx = ((x1 - x0) / h).ceil() as usize + 5; let ny = ((y1 - y0) / h).ceil() as usize + 5;
    let mut v = vec![0.0; nx * ny];
    for j in 0..ny { for i in 0..nx {
        v[j * nx + i] = if i == 0 || j == 0 || i == nx - 1 || j == ny - 1 { -1e9 } else { fl.f(gx + i as f64 * h, gy + j as f64 * h) };
    } }
    Grid { x0: gx, y0: gy, h, nx, ny, v }
}

/// closed loops of f = lv, the area f >= lv on the left (outer loops counterclockwise, holes clockwise)
/// The traced level is 3 um inside the asked one: a chord between two vertices then never reaches the wall.
fn iso(g: &Grid, fl: &Field, lv: f64) -> Vec<Vec<P2>> {
    let lv = lv + 0.003;
    let nx = g.nx;
    let node = |i: usize, j: usize| g.v[j * nx + i];
    let hk = |i: usize, j: usize| ((j * nx + i) * 2) as u64; let vk = |i: usize, j: usize| ((j * nx + i) * 2 + 1) as u64;
    let mut next: HashMap<u64, u64> = HashMap::new(); let mut order = vec![];
    for j in 0..g.ny - 1 { for i in 0..nx - 1 {
        let c = [node(i, j), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)];
        let ek = [hk(i, j), vk(i + 1, j), hk(i, j + 1), vk(i, j)];
        let inn = c.map(|x| x >= lv);
        let cr: Vec<(usize, bool)> = (0..4).filter(|&k| inn[k] != inn[(k + 1) % 4]).map(|k| (k, inn[k])).collect();
        if cr.is_empty() { continue; }
        let centre = (c[0] + c[1] + c[2] + c[3]) / 4.0 >= lv;
        for p in 0..cr.len() {
            if !cr[p].1 { continue; }
            let q = if cr.len() == 2 { 1 - p } else if centre { (p + 1) % 4 } else { (p + 3) % 4 };
            next.insert(ek[cr[p].0], ek[cr[q].0]); order.push(ek[cr[p].0]);
        }
    } }
    let at = |k: u64| -> P2 {
        let idx = (k / 2) as usize; let (i, j) = (idx % nx, idx / nx);
        let (i2, j2) = if k.is_multiple_of(2) { (i + 1, j) } else { (i, j + 1) };
        let pa = (g.x0 + i as f64 * g.h, g.y0 + j as f64 * g.h); let pb = (g.x0 + i2 as f64 * g.h, g.y0 + j2 as f64 * g.h);
        let (va, vb) = (node(i, j) - lv, node(i2, j2) - lv);
        let (mut ta, mut tb) = (0.0, 1.0); let a_in = va >= 0.0;
        let mut t = if (va - vb).abs() > 1e-300 { (va / (va - vb)).clamp(0.0, 1.0) } else { 0.5 };
        if va > -1e8 && vb > -1e8 {
            for _ in 0..40 {
                let fv = fl.f(pa.0 + (pb.0 - pa.0) * t, pa.1 + (pb.1 - pa.1) * t) - lv;
                if fv.abs() < 1e-9 { break; }
                if (fv >= 0.0) == a_in { ta = t; } else { tb = t; }
                t = (ta + tb) / 2.0;
            }
        }
        (pa.0 + (pb.0 - pa.0) * t, pa.1 + (pb.1 - pa.1) * t)
    };
    let mut seen = HashSet::new(); let mut loops = vec![];
    for &s in &order {
        if seen.contains(&s) { continue; }
        let mut lp = vec![]; let mut k = s;
        loop {
            seen.insert(k); lp.push(at(k));
            match next.get(&k) { Some(&n) if n != s && !seen.contains(&n) => k = n, _ => break }
        }
        let lp = sharpen(simplify(lp, 0.0005), fl, lv, g.h);
        if lp.len() >= 3 { loops.push(lp); }
    }
    loops
}
/// A grid cell cuts a sharp corner of the path (offset of a pocket corner) as a short chamfer. Where the two long
/// sides meet on the level itself (f there = lv: a true corner, not a chord of an arc), put the corner back.
fn sharpen(mut l: Vec<P2>, fl: &Field, lv: f64, h: f64) -> Vec<P2> {
    let len = |a: P2, b: P2| js::hypot2(b.0 - a.0, b.1 - a.1);
    let mut i = 0;
    while i < l.len() && l.len() > 4 {
        let n = l.len();
        let mut done = false;
        for k in 1..=3usize {
            if k + 3 > n { break; }
            // a=l[i] b=l[i+1] ... c=l[i+1+k] d=l[i+2+k]: short segments between b and c
            let at = |j: usize| l[(i + j) % n];
            let (a, b, c, d) = (at(0), at(1), at(1 + k), at(2 + k));
            if len(a, b) < 2.0 * h || len(c, d) < 2.0 * h || (1..=k).any(|j| len(at(j), at(j + 1)) >= 2.0 * h) { continue; }
            let (r, s) = ((b.0 - a.0, b.1 - a.1), (d.0 - c.0, d.1 - c.1)); let den = r.0 * s.1 - r.1 * s.0;
            if den.abs() < 1e-12 * len(a, b) * len(c, d) { continue; }
            let t = ((c.0 - a.0) * s.1 - (c.1 - a.1) * s.0) / den; let x = (a.0 + r.0 * t, a.1 + r.1 * t);
            if len(x, b) > 2.0 * h || len(x, c) > 2.0 * h || (fl.f(x.0, x.1) - lv).abs() > 1e-6 { continue; }
            let idx: Vec<usize> = (1..=1 + k).map(|j| (i + j) % n).collect();
            let first = idx[0];
            l[first] = x;
            let mut rm: Vec<usize> = idx[1..].to_vec(); rm.sort_unstable(); for j in rm.into_iter().rev() { l.remove(j); }
            done = true; break;
        }
        if !done { i += 1; }
    }
    l
}
/// Douglas-Peucker on a closed loop (the first point stays)
fn simplify(mut lp: Vec<P2>, tol: f64) -> Vec<P2> {
    if lp.len() < 4 { return lp; }
    lp.push(lp[0]);
    let n = lp.len(); let mut keep = vec![false; n]; keep[0] = true; keep[n - 1] = true;
    let mut stack = vec![(0, n - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 { continue; }
        let (p, q) = (lp[a], lp[b]); let (dx, dy) = (q.0 - p.0, q.1 - p.1); let l = js::hypot2(dx, dy);
        let mut best = (0.0, a);
        for (i, &r) in lp.iter().enumerate().take(b).skip(a + 1) {
            let d = if l < 1e-12 { js::hypot2(r.0 - p.0, r.1 - p.1) } else { ((r.0 - p.0) * dy - (r.1 - p.1) * dx).abs() / l };
            if d > best.0 { best = (d, i); }
        }
        if best.0 > tol { keep[best.1] = true; stack.push((a, best.1)); stack.push((best.1, b)); }
    }
    let mut out: Vec<P2> = (0..n - 1).filter(|&i| keep[i]).map(|i| lp[i]).collect();
    if out.len() < 3 { out = lp[..n - 1].to_vec(); }
    out
}

/* ------------------------------------------------------------------ the rough-out plan */

struct Plan { chan: Vec<Vec<P2>>, clear: Vec<(Vec<P2>, Option<P2>)> }
/// channel = the loops at R + allowance; clearing loops every Q2 x R inward, deepest first ("from inside outward")
fn plan(g: &Grid, fl: &Field, d0: f64, step: f64, chan_rev: bool, clear_rev: bool) -> Plan {
    let rev = |mut l: Vec<P2>, r: bool| { if r { l.reverse(); l.rotate_right(1); } l };
    let chan: Vec<Vec<P2>> = iso(g, fl, d0).into_iter().map(|l| rev(l, chan_rev)).collect();
    let gmax = g.v.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let mut lv: Vec<Vec<Vec<P2>>> = vec![];
    let step = js::max(step, 0.05);
    let mut m = 1.0;
    while d0 + m * step < gmax && lv.len() < 2000 { let l = iso(g, fl, d0 + m * step); if l.is_empty() { break; } lv.push(l); m += 1.0; }
    let mut clear = vec![];
    for k in (0..lv.len()).rev() {
        let level = d0 + (k + 1) as f64 * step;
        for l in &lv[k] {
            let deeper = lv.get(k + 1).map(|n| n.iter().any(|x| inside(l, x[0].0, x[0].1))).unwrap_or(false);
            let entry = if deeper { None } else { centre(g, l, level) };
            clear.push((rev(l.clone(), clear_rev), entry));
        }
    }
    Plan { chan, clear }
}
/// SL3: the plunge point of an innermost loop = the grid node inside it farthest from every wall
fn centre(g: &Grid, l: &[P2], level: f64) -> Option<P2> {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in l { x0 = x0.min(p.0); y0 = y0.min(p.1); x1 = x1.max(p.0); y1 = y1.max(p.1); }
    let i0 = ((x0 - g.x0) / g.h).floor().max(0.0) as usize; let i1 = (((x1 - g.x0) / g.h).ceil() as usize).min(g.nx - 1);
    let j0 = ((y0 - g.y0) / g.h).floor().max(0.0) as usize; let j1 = (((y1 - g.y0) / g.h).ceil() as usize).min(g.ny - 1);
    let mut best: Option<(f64, P2)> = None;
    for j in j0..=j1 { for i in i0..=i1 {
        let v = g.v[j * g.nx + i]; if v <= level { continue; }
        let p = (g.x0 + i as f64 * g.h, g.y0 + j as f64 * g.h);
        if best.map(|b| v > b.0).unwrap_or(true) && inside(l, p.0, p.1) { best = Some((v, p)); }
    } }
    best.map(|b| b.1)
}

/* ------------------------------------------------------------------ moving */

struct Ctx<'a> { dry: bool, pos: P3, plunges: Vec<P2>, lab: String, bi: usize, q7: f64, zc: f64, f_pl: f64, f_mill: f64, fl: &'a Field, d0: f64, h: f64, started: bool }
fn out(st: &mut St, c: &mut Ctx, kind: MK, to: P3, feed: f64, arc: Option<&Arc>) {
    if !c.dry { emit(st, kind, to, feed, c.bi, Some(&c.lab), arc); }
    c.pos = to;
}
/// SL4: intermediate positioning at the clearance height Q7 (p. 290), rapid to the set-up clearance, plunge at Q11
fn reposition(st: &mut St, c: &mut Ctx, p: P2, z: f64) {
    if c.pos.z < c.q7 { let q = c.pos; out(st, c, MK::Rapid, p3(q.x, q.y, c.q7), RAPID_RATE, None); }
    let zz = c.pos.z; out(st, c, MK::Rapid, p3(p.0, p.1, zz), RAPID_RATE, None);
    if c.pos.z > c.zc { out(st, c, MK::Rapid, p3(p.0, p.1, c.zc), RAPID_RATE, None); }
    let f = c.f_pl; out(st, c, MK::Feed, p3(p.0, p.1, z), f, None);
    c.plunges.push(p);
}
/// a straight move at depth only while the tool centre stays in the allowed area; otherwise up and over
fn safe(c: &Ctx, a: P2, b: P2) -> bool {
    let l = js::hypot2(b.0 - a.0, b.1 - a.1); let n = js::ceil(l / (c.h / 2.0)).max(1.0) as usize;
    (0..=n).all(|i| { let t = i as f64 / n as f64; c.fl.f(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t) >= c.d0 - 1e-3 })
}
fn go_to(st: &mut St, c: &mut Ctx, p: P2, z: f64) {
    let here = js::hypot2(c.pos.x - p.0, c.pos.y - p.1) < 1e-6;
    if here && c.pos.z >= z - 1e-9 && c.pos.z <= c.zc + 1e-9 {
        if c.pos.z > z + 1e-9 { let f = c.f_pl; out(st, c, MK::Feed, p3(p.0, p.1, z), f, None); c.plunges.push(p); }
        return;
    }
    if (c.pos.z - z).abs() < 1e-9 && safe(c, (c.pos.x, c.pos.y), p) { let f = c.f_mill; out(st, c, MK::Feed, p3(p.0, p.1, z), f, None); return; }
    reposition(st, c, p, z);
}
fn run_loop(st: &mut St, c: &mut Ctx, l: &[P2], z: f64) {
    go_to(st, c, l[0], z);
    let f = c.f_mill;
    for p in l.iter().skip(1).chain(std::iter::once(&l[0])) { if st.abort { return; } out(st, c, MK::Feed, p3(p.0, p.1, z), f, None); }
    c.started = true;
}
fn nearest_first(l: &[P2], to: P2) -> Vec<P2> {
    let k = (0..l.len()).min_by(|&a, &b| js::hypot2(l[a].0 - to.0, l[a].1 - to.1).total_cmp(&js::hypot2(l[b].0 - to.0, l[b].1 - to.1))).unwrap_or(0);
    let mut v = l.to_vec(); v.rotate_left(k); v
}
fn do_chan(st: &mut St, c: &mut Ctx, p: &Plan, z: f64) { for l in &p.chan { run_loop(st, c, l, z); } }
fn do_clear(st: &mut St, c: &mut Ctx, p: &Plan, z: f64) {
    for (l, e) in &p.clear {
        if st.abort { return; }
        let l = match e {
            Some(e) => { go_to(st, c, *e, z); nearest_first(l, *e) }
            None if c.started => nearest_first(l, (c.pos.x, c.pos.y)),
            None => l.clone(),
        };
        run_loop(st, c, &l, z);
    }
}
/// MP 7420: bit 1 rough-out before the channel, bit 3 both per infeed depth (else one process for all depths first)
fn rough(st: &mut St, c: &mut Ctx, p: &Plan, zs: &[f64], mp: u32) {
    let rough_first = mp & 2 != 0;
    if mp & 8 != 0 {
        for &z in zs { if rough_first { do_clear(st, c, p, z); do_chan(st, c, p, z); } else { do_chan(st, c, p, z); do_clear(st, c, p, z); } }
    } else {
        for k in 0..2 { for &z in zs { if (k == 0) != rough_first { do_chan(st, c, p, z); } else { do_clear(st, c, p, z); } } }
    }
}
/// end of 21-24: clearance height, then MP 7420 bit 4: back to the position before the call (+0) or stay (+16)
fn finish(st: &mut St, c: &mut Ctx, pre: P3, mp: u32) {
    let q = c.pos; out(st, c, MK::Rapid, p3(q.x, q.y, js::max(q.z, c.q7)), RAPID_RATE, None);
    if mp & 16 != 0 { return; }
    if pre.z > c.pos.z { let q = c.pos; out(st, c, MK::Rapid, p3(q.x, q.y, pre.z), RAPID_RATE, None); }
    let zz = c.pos.z; out(st, c, MK::Rapid, p3(pre.x, pre.y, zz), RAPID_RATE, None);
    out(st, c, MK::Rapid, pre, RAPID_RATE, None);
}

/* ------------------------------------------------------------------ the cycles */

fn tool_r(st: &mut St, bi: usize, t: f64) -> Option<f64> {
    if t == 0.0 || t == st.tool.t { return Some(st.tool.r); } // SL5: Q13 = 0 = the current tool
    let k = js::num_str(t);
    let r = st.tool_defs.get(&k).or_else(|| st.tool_table.iter().find(|x| x.t == t)).map(|e| e.r);
    match r {
        Some(r) => Some(r),
        None => { fail(st, bi, &format!("TOOL {} NOT DEFINED", k)); None }
    }
}
fn depths(top: f64, total: f64, peck: f64) -> Vec<f64> { if total <= EPS { vec![] } else { levels(top, total, peck) } }

pub(super) fn run(st: &mut St, cy: &Cycle, bi: usize) {
    if cy.num == 25.0 { train(st, cy, bi); return; }
    let d = match st.sl_data.clone() { Some(d) => d, None => { fail(st, bi, "CYCL DEF INCOMPLETE"); return; } };
    let q1 = qp(&d, 1.0, 0.0);
    if q1 == 0.0 { return; } // p. 290: depth 0 = the cycle is not executed
    let total = q1.abs(); // T6 / SL6: the sign is ignored, the cycle always works into -Z
    let (q2, q3, q4, q5, q6) = (qp(&d, 2.0, 1.0), qp(&d, 3.0, 0.0), qp(&d, 4.0, 0.0).abs(), qp(&d, 5.0, 0.0), qp(&d, 6.0, 2.0).abs());
    let q7 = qp(&d, 7.0, q5 + q6); let q9 = qp(&d, 9.0, 1.0);
    let mp = js::or(st.mach.mp7420, 0.0) as u32;
    let n = cy.num;
    let fl = match field(st, bi) { Some(f) => f, None => return };
    let r = if n == 21.0 { match tool_r(st, bi, qp(cy, 13.0, 0.0)) { Some(r) => r, None => return } } else { st.tool.r + js::or(st.tool.dr, 0.0) };
    let g = grid(&fl, r + if n == 24.0 { qp(cy, 14.0, 0.0) } else { q3 });
    let pre = st.pos;
    let mut c = Ctx { dry: false, pos: st.pos, plunges: vec![], lab: cy.label.clone(), bi, q7, zc: q5 + q6, f_pl: js::or(qp(cy, 11.0, st.feed), st.feed),
        f_mill: js::or(qp(cy, 12.0, st.feed), st.feed), fl: &fl, d0: 0.0, h: g.h, started: false };
    if n == 24.0 {
        let d = r + qp(cy, 14.0, 0.0);
        c.d0 = d;
        let loops = iso(&g, &fl, d);
        if loops.is_empty() { fail(st, bi, "TOOL RADIUS TOO LARGE"); return; } // SL7
        // SL13: down to Q1 (Q4 not kept); the p. 294 check Q14 + R < Q3 + rough-out R is not made
        let (zs, rev, tr) = (depths(q5, total, qp(cy, 10.0, 0.0).abs()), qp(cy, 9.0, 1.0) < 0.0, st.tool.r);
        side_finish(st, &mut c, &loops, &zs, rev, tr);
        finish(st, &mut c, pre, mp);
        return;
    }
    c.d0 = r + q3;
    // SL11: the channel turns by MP 7420 bit 0, the clearing loops by Q9. Not simulated: Q8 corner rounding, Q18 rest
    // material only (the whole area is roughed again), Q19 reciprocating plunge, MP 7420 +4 (combine uncompensated contours)
    let p = plan(&g, &fl, c.d0, q2 * r, mp & 1 != 0, q9 < 0.0);
    if p.chan.is_empty() { fail(st, bi, "TOOL RADIUS TOO LARGE"); return; } // SL7
    if n == 22.0 {
        let zs = depths(q5, total - q4, qp(cy, 10.0, 0.0).abs()); rough(st, &mut c, &p, &zs, mp);
    } else if n == 23.0 {
        // SL8: floor finishing = the rough-out paths once at the floor, straight plunge (manual: a vertical tangential arc)
        let zs = [q5 - total]; rough(st, &mut c, &p, &zs, mp | 8);
    } else {
        // 21: the infeed points of a rough-out with tool Q13, drilled like cycle 1 (p. 291) to the rough-out floor
        c.dry = true; let zs = depths(q5, total - q4, qp(cy, 10.0, 0.0).abs()); rough(st, &mut c, &p, &zs, mp);
        let mut pts: Vec<P2> = vec![];
        for q in &c.plunges { if !pts.iter().any(|x| js::hypot2(x.0 - q.0, x.1 - q.1) < 1e-4) { pts.push(*q); } }
        c.dry = false; c.pos = st.pos;
        let peck = js::or(qp(cy, 10.0, 0.0).abs(), total - q4); let bottom = total - q4;
        for q in pts {
            if st.abort { break; }
            if c.pos.z < q7 { let k = c.pos; out(st, &mut c, MK::Rapid, p3(k.x, k.y, q7), RAPID_RATE, None); }
            let zz = c.pos.z; out(st, &mut c, MK::Rapid, p3(q.0, q.1, zz), RAPID_RATE, None);
            out(st, &mut c, MK::Rapid, p3(q.0, q.1, q5 + q6), RAPID_RATE, None);
            let mut dd = 0.0; let f = c.f_pl;
            while dd < bottom - 1e-6 {
                dd = js::min(dd + peck, bottom);
                out(st, &mut c, MK::Feed, p3(q.0, q.1, q5 - dd), f, None);
                out(st, &mut c, MK::Rapid, p3(q.0, q.1, q5 + q6), RAPID_RATE, None);
                if dd < bottom - 1e-6 { out(st, &mut c, MK::Rapid, p3(q.0, q.1, q5 - dd + stop_t(bottom)), RAPID_RATE, None); }
            }
        }
    }
    finish(st, &mut c, pre, mp);
}

/// 24: each loop of the finished contour on its own, in and out on a tangential arc (p. 294), all depths per loop
fn side_finish(st: &mut St, c: &mut Ctx, loops: &[Vec<P2>], zs: &[f64], rev: bool, tool_r: f64) {
    for l in loops {
        if st.abort { return; }
        let mut l = l.clone(); if rev { l.reverse(); }
        let s = if rev { -1.0 } else { 1.0 }; // the free side: left of the natural direction
        // SL9: arc radius = tool radius, halved until the arc's circle stays in the free area; start = the first vertex where it fits best
        let n = l.len(); let mut best = (0.0, 0usize);
        for k in 0..n {
            let (a, b) = (l[k], l[(k + 1) % n]); let len = js::hypot2(b.0 - a.0, b.1 - a.1); if len < 1e-9 { continue; }
            let t = ((b.0 - a.0) / len, (b.1 - a.1) / len); let nf = (-t.1 * s, t.0 * s);
            let mut rho = tool_r;
            while rho >= 0.05 { if c.fl.f(a.0 + nf.0 * rho, a.1 + nf.1 * rho) >= c.d0 + rho - 1e-3 { break; } rho /= 2.0; }
            if rho >= 0.05 && rho > best.0 + 1e-9 { best = (rho, k); }
            if best.0 >= tool_r - 1e-9 { break; }
        }
        l.rotate_left(best.1);
        let (rho, sp) = (best.0, l[0]);
        let b = l[1 % n]; let len = js::hypot2(b.0 - sp.0, b.1 - sp.1).max(1e-12);
        let t = ((b.0 - sp.0) / len, (b.1 - sp.1) / len); let nf = (-t.1 * s, t.0 * s);
        let cc = (sp.0 + nf.0 * rho, sp.1 + nf.1 * rho);
        let a = (cc.0 - t.0 * rho, cc.1 - t.1 * rho); let dp = (cc.0 + t.0 * rho, cc.1 + t.1 * rho);
        let arc = Arc { cx: cc.0, cy: cc.1, ccw: !rev, sweep: Some(s * PI / 2.0) };
        let f = c.f_mill;
        for (i, &z) in zs.iter().enumerate() {
            if st.abort { return; }
            if rho > 0.0 {
                if i == 0 { reposition(st, c, a, z); } else { out(st, c, MK::Feed, p3(a.0, a.1, c.pos.z), f, None); let fp = c.f_pl; out(st, c, MK::Feed, p3(a.0, a.1, z), fp, None); }
                out(st, c, MK::Arc, p3(sp.0, sp.1, z), f, Some(&arc));
            } else if i == 0 { reposition(st, c, sp, z); } else { let fp = c.f_pl; out(st, c, MK::Feed, p3(sp.0, sp.1, z), fp, None); }
            for p in l.iter().skip(1).chain(std::iter::once(&l[0])) { out(st, c, MK::Feed, p3(p.0, p.1, z), f, None); }
            if rho > 0.0 { out(st, c, MK::Arc, p3(dp.0, dp.1, z), f, Some(&arc)); }
        }
        let q = c.pos; out(st, c, MK::Rapid, p3(q.x, q.y, c.q7), RAPID_RATE, None);
    }
}

fn reversed(p: &Prim) -> Prim {
    match p {
        Prim::Line { s, e } => Prim::Line { s: *e, e: *s },
        Prim::Arc { cx, cy, r, a0, sw, z0, z1 } => Prim::Arc { cx: *cx, cy: *cy, r: *r, a0: a0 + sw, sw: -sw, z0: *z1, z1: *z0 },
        Prim::Invalid => Prim::Invalid,
    }
}

/// 25 CONTOUR TRAIN: the open contour of the first label, offset by R + Q3 through the radius compensation pass
fn train(st: &mut St, cy: &Cycle, bi: usize) {
    let lbl = match st.sl_labels.as_ref().and_then(|l| l.first().copied()) { Some(l) => l, None => { fail(st, bi, "CYCL DEF INCOMPLETE"); return; } };
    let q1 = qp(cy, 1.0, 0.0);
    if q1 == 0.0 { return; } // p. 295: depth 0 = not executed
    let (q3, q5) = (qp(cy, 3.0, 0.0), qp(cy, 5.0, 0.0)); let q7 = qp(cy, 7.0, js::max(st.pos.z, q5 + 2.0));
    let q10 = qp(cy, 10.0, 0.0).abs(); let f_pl = js::or(qp(cy, 11.0, st.feed), st.feed); let f_mill = js::or(qp(cy, 12.0, st.feed), st.feed);
    let q15 = js::round(qp(cy, 15.0, 1.0));
    begin_capture(st);
    let sub = capture(st, bi, lbl, false);
    end_capture(st);
    let sub = match sub { Some(s) => s, None => return };
    let zs = depths(q5, q1.abs(), q10); // SL6: sign ignored
    let side = sub.side.clone();
    // climb milling with M3 = RL (tool left of the material); "remains effective when the contours are mirrored" (p. 295).
    // SL12: M4 is not looked at; with Q15 = +1 / -1 the tool goes up to Q7 and back to the start between infeeds
    let climb = flip_rc(st, Some(&side)).as_deref() == Some("RL");
    let swap = |s: &str| if s == "RL" { "RR".to_string() } else if s == "RR" { "RL".to_string() } else { s.to_string() };
    let rr = st.tool.r + js::or(st.tool.dr, 0.0) + q3;
    let (rc0, dr0, n0) = (st.rc.clone(), st.tool.dr, st.moves.len());
    st.tool.dr = js::or(dr0, 0.0) + q3; // the allowance rides on DR so the compensation pass offsets by R + DR + Q3
    let alt = q15 == 0.0 && side != "R0";
    for (i, &z) in zs.iter().enumerate() {
        if st.abort { break; }
        let rev = side != "R0" && if q15 > 0.0 { !climb } else if q15 < 0.0 { climb } else { i % 2 == 1 };
        let ps: Vec<Prim> = if rev { sub.prims.iter().rev().map(reversed).collect() } else { sub.prims.clone() };
        let sd = if rev { swap(&side) } else { side.clone() };
        let s0 = p_start(&ps[0]);
        if alt && i > 0 {
            // Q15 = 0: back and forth; the plunge at the end of the last pass starts the new compensated run
            st.rc = sd.clone(); st.rc_act = true; emit(st, MK::Feed, p3(s0.x, s0.y, z), f_pl, bi, None, None);
        } else {
            st.rc = "R0".into(); st.rc_act = false;
            if st.pos.z < q7 { let p = st.pos; emit(st, MK::Rapid, p3(p.x, p.y, q7), RAPID_RATE, bi, None, None); }
            st.rc = sd.clone(); st.rc_act = sd != "R0";
            let zz = st.pos.z; emit(st, MK::Rapid, p3(s0.x, s0.y, zz), RAPID_RATE, bi, None, None);
            st.rc_act = false;
            emit(st, MK::Rapid, p3(s0.x, s0.y, q5 + 2.0), RAPID_RATE, bi, None, None); // SL10: 2 mm above the surface, then Q11
            emit(st, MK::Feed, p3(s0.x, s0.y, z), f_pl, bi, None, None);
        }
        st.rc_act = false;
        for p in &ps {
            if st.abort { break; }
            match p {
                Prim::Arc { cx, cy, sw, .. } => { let e = p_end(p); emit(st, MK::Arc, p3(e.x, e.y, z), f_mill, bi, None, Some(&Arc { cx: *cx, cy: *cy, ccw: *sw > 0.0, sweep: Some(*sw) })); }
                _ => { let e = p_end(p); emit(st, MK::Feed, p3(e.x, e.y, z), f_mill, bi, None, None); }
            }
        }
        // p. 295: incremental positions after the cycle refer to where the tool really is: the compensated end
        let last = ps.last().unwrap(); let mut e = p_end(last);
        if sd != "R0" { if let Some(o) = offset_p(last, if sd == "RL" { 1.0 } else { -1.0 }, rr) { if !matches!(o, Prim::Invalid) { e = p_end(&o); } } }
        st.rc = "R0".into(); st.pos = p3(e.x, e.y, z); st.mpos = to_m(st, st.pos);
        if !(alt && i + 1 < zs.len()) { emit(st, MK::Rapid, p3(e.x, e.y, q7), RAPID_RATE, bi, None, None); }
    }
    st.rc = rc0; st.tool.dr = dr0;
    let lab = cy.label.clone();
    for m in st.moves[n0..].iter_mut() { if let Item::M(m) = m { m.cycle = Some(lab.clone()); } }
}
