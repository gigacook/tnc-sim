//! The checks (formerly sim/sim.js): moves -> timed, arc-tessellated segments (expand), and the safety analysis
//! on the height field (analyse): rapids into material, cutting with the spindle stopped, the holder, the vice,
//! chip load, spindle limit, through cuts, and the cut / feed path lengths.

use crate::exec::{Move, Rot, J, MK};
use crate::js;
use crate::stock::{self, Full, Grid, Vice, P, St, Tool};
use crate::val::{num, string, Obj};

#[derive(Clone, Copy, Debug)]
pub struct Pt { pub x: f64, pub y: f64, pub z: f64, pub rot: Option<(f64, f64, f64)> }

#[derive(Clone, Debug)]
pub struct Seg {
    pub a: Pt, pub b: Pt, pub len: f64, pub f: f64, pub rapid: bool, pub block: f64, pub tool: f64, pub tool_r: f64,
    pub stick: J<f64>, pub tool_l: J<f64>, pub s_rpm: J<f64>, pub seq: J<f64>, pub cone: bool, pub ball: bool,
    pub spindle: f64, pub coolant: bool, pub cycle: Option<String>, pub probe: bool, pub t0: f64, pub t1: f64,
}
impl Seg {
    fn tool(&self) -> Tool { Tool { tool_r: self.tool_r, cone: self.cone, ball: self.ball, tool_r2: f64::NAN, stick: self.stick.val().unwrap_or(f64::NAN) } }
}

/// the built-in table decides cone / flutes (sim.js reads TNC.TOOLS)
fn is_cone_tool(t: f64) -> bool { crate::TOOLS.iter().any(|(n, name, _, _)| *n == t && (name.contains("CHAMFER") || name.contains("SPOT"))) }
fn flutes(t: f64) -> f64 {
    for (n, name, _, _) in crate::TOOLS { if *n == t { if name.contains("FACEMILL") { return 5.0; }
        if name.contains("ENDMILL") || name.contains("BALL") { return 3.0; } } }
    // a later entry with the same number would win in sim.js; the table has unique numbers
    f64::NAN
}
pub fn is_cone(t: f64) -> bool { is_cone_tool(t) }

fn upper_has(s: &J<String>, words: &[&str]) -> bool {
    match s { J::Val(n) => { let u = n.to_ascii_uppercase(); words.iter().any(|w| u.contains(w)) } _ => false }
}

fn tess_arc(mv: &Move, out: &mut Vec<(Pt, Pt)>) {
    let f = mv.from; let to = mv.to; let cx = mv.cx.unwrap(); let cy = mv.cy.unwrap();
    let r = js::hypot2(f.x - cx, f.y - cy);
    let a0 = js::atan2(f.y - cy, f.x - cx); let a1 = js::atan2(to.y - cy, to.x - cx);
    let mut sw = a1 - a0;
    if let Some(s) = mv.sweep { sw = s; }
    else if mv.ccw { while sw <= 1e-9 { sw += js::PI * 2.0; } }
    else { while sw >= -1e-9 { sw -= js::PI * 2.0; } }
    let n = js::max(6.0, js::ceil(sw.abs() / (js::PI / 36.0)));
    let mut prev = Pt { x: f.x, y: f.y, z: f.z, rot: None };
    let mut i = 1.0;
    while i <= n {
        let a = a0 + sw * (i / n);
        let p = Pt { x: cx + r * js::cos(a), y: cy + r * js::sin(a), z: f.z + (to.z - f.z) * (i / n), rot: None };
        out.push((prev, p)); prev = p;
        i += 1.0;
    }
}

pub fn expand(moves: &[Move], rapid_rate: f64) -> (Vec<Seg>, f64) {
    let mut segs = vec![]; let mut t = 0.0;
    let rapid = js::or(rapid_rate, 18000.0);
    for mv in moves {
        let mut pairs: Vec<(Pt, Pt)> = vec![];
        let from = Pt { x: mv.from.x, y: mv.from.y, z: mv.from.z, rot: None }; let to = Pt { x: mv.to.x, y: mv.to.y, z: mv.to.z, rot: None };
        if mv.kind == MK::Arc && mv.cx.is_some() { tess_arc(mv, &mut pairs); } else { pairs.push((from, to)); }
        let r0: Option<Rot> = mv.rot0; let r1: Option<Rot> = mv.rot1.or(mv.rot0);
        let mut total = 0.0;
        for (a, b) in &pairs { total += js::hypot3(b.x - a.x, b.y - a.y, b.z - a.z); }
        let mut done = 0.0;
        let rot_only = total < 1e-9 && r0.is_some() && r1.is_some() && { let (x, y) = (r0.unwrap(), r1.unwrap()); x.a != y.a || x.b != y.b || x.c != y.c };
        if rot_only { pairs = vec![(from, to)]; }
        for (pa, pb) in pairs {
            let (mut a, mut b) = (pa, pb);
            let len = js::hypot3(b.x - a.x, b.y - a.y, b.z - a.z);
            if len < 1e-9 && !rot_only { continue; }
            if let Some(r0) = r0 {
                let r1 = r1.unwrap();
                let u0 = if total > 1e-9 { done / total } else { 0.0 }; let u1 = if total > 1e-9 { (done + len) / total } else { 1.0 };
                a = Pt { x: a.x, y: a.y, z: a.z, rot: Some((r0.a + (r1.a - r0.a) * u0, r0.b + (r1.b - r0.b) * u0, r0.c + (r1.c - r0.c) * u0)) };
                b = Pt { x: b.x, y: b.y, z: b.z, rot: Some((r0.a + (r1.a - r0.a) * u1, r0.b + (r1.b - r0.b) * u1, r0.c + (r1.c - r0.c) * u1)) };
            }
            done += len;
            let f = if mv.kind == MK::Rapid { rapid } else { js::max(1.0, js::or(mv.feed, 500.0)) };
            let dt = match mv.dur { Some(d) => d * (if total > 1e-9 { len / total } else { 1.0 }), None => len / f * 60.0 };
            segs.push(Seg {
                a, b, len, f, rapid: mv.kind == MK::Rapid, block: mv.block, tool: mv.tool, tool_r: js::or(mv.tool_r, 3.0), stick: mv.stick.clone(), tool_l: mv.tool_l.clone(),
                s_rpm: mv.s_rpm.clone(), seq: mv.seq.clone(),
                cone: is_cone(mv.tool) || upper_has(&mv.tool_name, &["CHAMFER", "SPOT", "CENTER", "CENTRE"]), ball: upper_has(&mv.tool_name, &["BALL", "KUGEL", "KULFR"]),
                spindle: js::or(mv.spindle, 0.0), coolant: mv.coolant, cycle: mv.cycle.clone().filter(|c| !c.is_empty()), probe: mv.probe, t0: t, t1: t + dt,
            });
            t += dt;
        }
    }
    (segs, t)
}

pub fn grid_for(st: &St, segs: &[Seg]) -> Grid {
    let mut min_r = f64::INFINITY;
    for s in segs { if !s.rapid && s.tool_r < min_r { min_r = s.tool_r; } }
    stock::grid(st, min_r)
}

#[derive(Clone, Debug)]
pub struct Event { pub code: &'static str, pub sev: &'static str, pub msg: String, pub block: f64, pub seg: usize, pub t: f64, pub at: P, pub tool: f64 }

fn msg(code: &str) -> &'static str {
    match code {
        "RAPID_IN_MATERIAL" => "CRASH: RAPID TRAVERSE INTO MATERIAL",
        "SPINDLE_OFF" => "CRASH: CUTTING WITH SPINDLE STOPPED",
        "THROUGH_CUT" => "NOTE: TOOL BREAKS THROUGH THE BLANK BOTTOM — ASSUMES PARALLELS UNDER THE PART",
        "CHIP_LOAD" => "WARNING: CHIP LOAD HIGH FOR THIS CUTTER",
        "SPINDLE_MAX" => "WARNING: SPINDLE SPEED ABOVE THE MACHINE MAXIMUM",
        "HOLDER" => "CRASH: TOOL HOLDER COLLISION — THE HOLDER NOSE REACHES THE PART",
        "VICE_TOOL" => "CRASH: TOOL INTO THE VICE",
        _ => "CRASH: TOOL HOLDER COLLISION — HOLDER HITS THE VICE",
    }
}
pub const CODES: [&str; 8] = ["RAPID_IN_MATERIAL", "SPINDLE_OFF", "THROUGH_CUT", "CHIP_LOAD", "SPINDLE_MAX", "HOLDER", "VICE_TOOL", "VICE_HOLDER"];
pub fn msg_of(code: &str) -> &'static str { msg(code) }

pub fn seg_axis(s: &Seg, u: f64) -> stock::Ax { stock::axis(s.a.rot.map(|r| (r.0, r.1)), s.b.rot.map(|r| (r.0, r.1)), u) }

pub fn analyse(st: &St, segs: &[Seg], g: &Grid, s_max: f64, v: &Vice) -> (Vec<Event>, f64, f64) {
    let mut ev: Vec<Event> = vec![]; let mut seen: std::collections::HashSet<String> = Default::default();
    let (mut feed_len, mut cut_len) = (0.0, 0.0);
    let mut hmv = vec![st.z1 as f32; (g.nx * g.ny) as usize];
    let jaws = stock::vice(st, v);
    let mut add = |ev: &mut Vec<Event>, code: &'static str, sev: &'static str, s: &Seg, idx: usize, t: f64, p: &P, extra: &str| {
        let key = if code == "CHIP_LOAD" { format!("{}:{}:{}", code, js::num_str(s.tool), js::num_str(s.f)) }
            else if code == "THROUGH_CUT" { format!("{}:{}", code, js::num_str(s.tool)) } else { format!("{}:{}", code, js::num_str(s.block)) };
        if seen.contains(&key) || ev.len() >= 60 { return; }
        seen.insert(key);
        ev.push(Event { code, sev, msg: format!("{}{}", msg(code), extra), block: s.block, seg: idx, t, at: *p, tool: s.tool });
    };
    let inside = |p: &P, r: f64| p.x > st.x0 - r && p.x < st.x1 + r && p.y > st.y0 - r && p.y < st.y1 + r;
    let holder_x = |s: &Seg| format!(" — T{} STICK-OUT {} MM FROM L {} (TOOL LIST / TOOL HOLDER LENGTH)", js::num_str(s.tool),
        js::to_fixed(s.stick.val().unwrap_or(f64::NAN), 1), js::to_fixed(js::or(s.tool_l.val().unwrap_or(0.0), 0.0), 1));
    let nx = g.nx as usize;
    for (idx, s) in segs.iter().enumerate() {
        if s.probe { continue; }
        let tool = s.tool();
        let step = js::max(0.3, js::min(s.tool_r * 0.45, 1.5));
        let n = js::max(1.0, js::ceil(s.len / step));
        let mut i = 0.0;
        while i <= n {
            let u = i / n; let t = s.t0 + (s.t1 - s.t0) * u;
            let p = P { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u, z: s.a.z + (s.b.z - s.a.z) * u };
            let ax = seg_axis(s, u);
            if !jaws.is_empty() && idx > 0 {
                match stock::vice_hit(&tool, &p, &ax, &jaws) {
                    Some("tool") => { add(&mut ev, "VICE_TOOL", "crash", s, idx, t, &p, ""); break; }
                    Some(_) => { let x = holder_x(s); add(&mut ev, "VICE_HOLDER", "crash", s, idx, t, &p, &x); break; }
                    None => {}
                }
            }
            let mut hm = Full { hm: &mut hmv, nx };
            if s.rapid {
                if stock::probe(&mut hm, st, g, &tool, &p, &ax) { add(&mut ev, "RAPID_IN_MATERIAL", "crash", s, idx, t, &p, ""); break; }
                i += 1.0; continue;
            }
            if ax.is_some() || inside(&p, s.tool_r) {
                if stock::holder_hits(&mut hm, st, g, &tool, &p, &ax) { let x = holder_x(s); add(&mut ev, "HOLDER", "crash", s, idx, t, &p, &x); }
                if p.z < st.z0 - 0.01 && inside(&p, s.tool_r) { add(&mut ev, "THROUGH_CUT", "info", s, idx, t, &p, ""); }
            }
            let cut = stock::stamp(&mut hm, st, g, &tool, &p, &ax, 0.05); let w = js::or(s.len, 0.0) / (n + 1.0);
            feed_len += w; if cut { cut_len += w; }
            if cut {
                if s.spindle == 0.0 { add(&mut ev, "SPINDLE_OFF", "crash", s, idx, t, &p, ""); }
                let z = flutes(s.tool);
                let lateral = js::hypot2(s.b.x - s.a.x, s.b.y - s.a.y) > (s.b.z - s.a.z).abs();
                if js::truthy(z) && js::truthy(s.spindle) && lateral {
                    let d = 2.0 * s.tool_r; let fz = s.f / (s.spindle.abs() * z); let lim = 0.012 * d + 0.005;
                    if fz > lim {
                        let x = format!(" — fz {} MM/TOOTH, SUGGEST ≤ {} (F{} AT S{})", js::to_fixed(fz, 3), js::to_fixed(lim, 3), js::num_str(js::floor(lim * s.spindle.abs() * z)), js::num_str(s.spindle.abs()));
                        add(&mut ev, "CHIP_LOAD", "warn", s, idx, t, &p, &x);
                    }
                }
            }
            i += 1.0;
        }
    }
    if js::truthy(s_max) {
        for (k, sg) in segs.iter().enumerate() {
            if js::or(sg.spindle, 0.0).abs() > s_max + 1e-9 {
                let p = P { x: sg.a.x, y: sg.a.y, z: sg.a.z };
                let x = format!(" — S{} > {} RPM (MP 3515), THE CONTROL LIMITS IT", js::num_str(sg.spindle.abs()), js::num_str(s_max));
                add(&mut ev, "SPINDLE_MAX", "warn", sg, k, sg.t0, &p, &x);
            }
        }
    }
    (ev, feed_len, cut_len)
}

/* ---- JSON ---- */
fn pt(out: &mut String, p: &Pt) {
    let mut o = Obj::new(out); o.num("x", p.x).num("y", p.y).num("z", p.z);
    if let Some((a, b, c)) = p.rot { o.num("a", a).num("b", b).num("c", c); }
    o.end();
}
fn jn(o: &mut Obj, k: &str, v: &J<f64>) { match v { J::Absent => {}, J::Null => { o.opt_num(k, None); } J::Val(x) => { o.num(k, *x); } } }
pub fn segs_json(out: &mut String, segs: &[Seg], total: f64) {
    out.push_str("{\"segs\":[");
    for (i, s) in segs.iter().enumerate() {
        if i > 0 { out.push(','); }
        let mut o = Obj::new(out);
        o.raw("a", |w| pt(w, &s.a)).raw("b", |w| pt(w, &s.b)).num("len", s.len).num("f", s.f).str("kind", if s.rapid { "rapid" } else { "feed" })
            .num("block", s.block).num("tool", s.tool).num("toolR", s.tool_r);
        jn(&mut o, "stick", &s.stick); jn(&mut o, "toolL", &s.tool_l); jn(&mut o, "sRpm", &s.s_rpm); jn(&mut o, "seq", &s.seq);
        o.bool("cone", s.cone).bool("ball", s.ball).num("spindle", s.spindle).bool("coolant", s.coolant).opt_str("cycle", s.cycle.as_deref())
            .bool("probe", s.probe).num("t0", s.t0).num("t1", s.t1).end();
    }
    out.push_str("],\"total\":"); num(out, total); out.push('}');
}
pub fn events_json(out: &mut String, ev: &[Event], feed: f64, cut: f64) {
    out.push_str("{\"events\":[");
    for (i, e) in ev.iter().enumerate() {
        if i > 0 { out.push(','); }
        Obj::new(out).str("code", e.code).str("sev", e.sev).str("msg", &e.msg).num("block", e.block).num("seg", e.seg as f64).num("t", e.t)
            .raw("at", |w| Obj::new(w).num("x", e.at.x).num("y", e.at.y).num("z", e.at.z).end()).num("tool", e.tool).end();
    }
    out.push_str("],\"cut\":{\"feed\":"); num(out, feed); out.push_str(",\"cut\":"); num(out, cut); out.push_str("}}");
    let _ = string;
}
