//! Values as core.js kept them: block arguments are a small dynamic map (a key can be missing, null, a number,
//! a Q reference, a string, ...), expressions are the same nested arrays, and the JSON written back is what
//! JSON.stringify would write, except NaN / ±Infinity, which travel as marked strings the JS side revives.

use crate::js;
use std::fmt::Write;

/// A programmed value: a number or a Q-parameter reference.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NQ { N(f64), Q(f64, bool) }

#[derive(Clone, Debug)]
pub enum Ast {
    N(f64),
    Q(f64),
    U(Box<Ast>),
    F(&'static str, Box<Ast>),
    B(&'static str, Box<Ast>, Box<Ast>),
}

#[derive(Clone, Debug)]
pub enum V {
    Null,
    Num(f64),
    Q(f64, bool),
    Str(String),
    Bool(bool),
    Nums(Vec<f64>),
    Ast(Box<Ast>),
}
impl V {
    pub fn nq(v: Option<NQ>) -> V { match v { None => V::Null, Some(NQ::N(x)) => V::Num(x), Some(NQ::Q(q, n)) => V::Q(q, n) } }
    /// the value as resolve() sees it: number, Q reference, or null (anything else)
    pub fn as_nq(&self) -> Option<NQ> { match self { V::Num(x) => Some(NQ::N(*x)), V::Q(q, n) => Some(NQ::Q(*q, *n)), _ => None } }
    pub fn as_str(&self) -> Option<&str> { if let V::Str(s) = self { Some(s) } else { None } }
    pub fn as_num(&self) -> Option<f64> { if let V::Num(x) = self { Some(*x) } else { None } }
    pub fn truthy(&self) -> bool {
        match self { V::Null => false, V::Num(x) => js::truthy(*x), V::Q(..) => true, V::Str(s) => !s.is_empty(), V::Bool(b) => *b, V::Nums(_) => true, V::Ast(_) => true }
    }
}

/// Block arguments: insertion-ordered small map.
#[derive(Clone, Debug, Default)]
pub struct Args(pub Vec<(&'static str, V)>);
impl Args {
    pub fn get(&self, k: &str) -> Option<&V> { self.0.iter().find(|(kk, _)| *kk == k).map(|(_, v)| v) }
    pub fn has(&self, k: &str) -> bool { self.get(k).is_some() }
    pub fn set(&mut self, k: &'static str, v: V) {
        if let Some(e) = self.0.iter_mut().find(|(kk, _)| *kk == k) { e.1 = v; } else { self.0.push((k, v)); }
    }
    pub fn remove(&mut self, k: &str) { self.0.retain(|(kk, _)| *kk != k); }
    pub fn str(&self, k: &str) -> Option<&str> { self.get(k).and_then(|v| v.as_str()) }
    pub fn num(&self, k: &str) -> Option<f64> { self.get(k).and_then(|v| v.as_num()) }
    pub fn nq(&self, k: &str) -> Option<NQ> { self.get(k).and_then(|v| v.as_nq()) }
    pub fn ast(&self, k: &str) -> Option<&Ast> { if let Some(V::Ast(a)) = self.get(k) { Some(a) } else { None } }
    pub fn ms(&self) -> Option<&Vec<f64>> { if let Some(V::Nums(v)) = self.get("m") { Some(v) } else { None } }
    pub fn truthy(&self, k: &str) -> bool { self.get(k).map(|v| v.truthy()).unwrap_or(false) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Unknown, Comment, Blank, Begin, End, Blk1, Blk2, ToolDef, ToolCall, TchProbe, CyclParm, CyclDef, CyclCall, CallLbl, Lbl, LblEnd,
    Jump, FnErr, Fn, FnNop, Stop, Appr, Dep, Rnd, Chf, Lp, Cp, Ctp, Ct, Cc, Cr, C, L, QAssign, Formula,
}
impl Kind {
    pub fn as_str(self) -> &'static str {
        use Kind::*;
        match self {
            Unknown => "UNKNOWN", Comment => "COMMENT", Blank => "BLANK", Begin => "BEGIN", End => "END", Blk1 => "BLK1", Blk2 => "BLK2",
            ToolDef => "TOOLDEF", ToolCall => "TOOLCALL", TchProbe => "TCHPROBE", CyclParm => "CYCLPARM", CyclDef => "CYCLDEF",
            CyclCall => "CYCLCALL", CallLbl => "CALLLBL", Lbl => "LBL", LblEnd => "LBLEND", Jump => "JUMP", FnErr => "FNERR", Fn => "FN",
            FnNop => "FNNOP", Stop => "STOP", Appr => "APPR", Dep => "DEP", Rnd => "RND", Chf => "CHF", Lp => "LP", Cp => "CP", Ctp => "CTP",
            Ct => "CT", Cc => "CC", Cr => "CR", C => "C", L => "L", QAssign => "QASSIGN", Formula => "FORMULA",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Block {
    pub n: Option<f64>,
    pub raw: String,
    pub kind: Kind,
    pub args: Args,
    pub indent: bool,
    pub error: Option<String>,
    /// the parse error (core.js keeps it as a hidden __perr property): compile() restores `error` from it
    pub perr: Option<String>,
}

/* ------------------------------------------------------------------ JSON out */

pub fn num(out: &mut String, x: f64) {
    if x.is_nan() { out.push_str("\"\\u0001NaN\""); }
    else if x == f64::INFINITY { out.push_str("\"\\u0001Inf\""); }
    else if x == f64::NEG_INFINITY { out.push_str("\"\\u0001-Inf\""); }
    else if x == 0.0 { out.push_str(if x.is_sign_negative() { "-0" } else { "0" }); }
    else if x == x.trunc() && x.abs() < 1e15 { let _ = write!(out, "{}", x as i64); }
    else { let _ = write!(out, "{:?}", x); }
}
pub fn string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""), '\\' => out.push_str("\\\\"), '\n' => out.push_str("\\n"), '\r' => out.push_str("\\r"), '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => { let _ = write!(out, "\\u{:04x}", c as u32); }
            c => out.push(c),
        }
    }
    out.push('"');
}
pub fn ast(out: &mut String, a: &Ast) {
    match a {
        Ast::N(x) => { out.push_str("[\"n\","); num(out, *x); out.push(']'); }
        Ast::Q(q) => { out.push_str("[\"q\","); num(out, *q); out.push(']'); }
        Ast::U(x) => { out.push_str("[\"u\","); ast(out, x); out.push(']'); }
        Ast::F(f, x) => { out.push_str("[\"f\","); string(out, f); out.push(','); ast(out, x); out.push(']'); }
        Ast::B(op, x, y) => { out.push_str("[\"b\","); string(out, op); out.push(','); ast(out, x); out.push(','); ast(out, y); out.push(']'); }
    }
}
pub fn value(out: &mut String, v: &V) {
    match v {
        V::Null => out.push_str("null"),
        V::Num(x) => num(out, *x),
        V::Q(q, n) => { out.push_str("{\"q\":"); num(out, *q); out.push_str(",\"neg\":"); out.push_str(if *n { "true" } else { "false" }); out.push('}'); }
        V::Str(s) => string(out, s),
        V::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        V::Nums(v) => { out.push('['); for (i, x) in v.iter().enumerate() { if i > 0 { out.push(','); } num(out, *x); } out.push(']'); }
        V::Ast(a) => ast(out, a),
    }
}
pub fn block(out: &mut String, b: &Block) {
    out.push_str("{\"n\":");
    match b.n { Some(n) => num(out, n), None => out.push_str("null") }
    out.push_str(",\"raw\":"); string(out, &b.raw);
    out.push_str(",\"kind\":"); string(out, b.kind.as_str());
    out.push_str(",\"args\":{");
    for (i, (k, v)) in b.args.0.iter().enumerate() { if i > 0 { out.push(','); } string(out, k); out.push(':'); value(out, v); }
    out.push_str("},\"indent\":"); out.push_str(if b.indent { "true" } else { "false" });
    out.push_str(",\"error\":");
    match &b.error { Some(e) => string(out, e), None => out.push_str("null") }
    out.push('}');
}

/// Writes a JSON object field by field.
pub struct Obj<'a> { out: &'a mut String, first: bool }
impl<'a> Obj<'a> {
    pub fn new(out: &'a mut String) -> Self { out.push('{'); Obj { out, first: true } }
    fn key(&mut self, k: &str) -> &mut String { if !self.first { self.out.push(','); } self.first = false; string(self.out, k); self.out.push(':'); self.out }
    pub fn num(&mut self, k: &str, x: f64) -> &mut Self { let o = self.key(k); num(o, x); self }
    pub fn opt_num(&mut self, k: &str, x: Option<f64>) -> &mut Self { let o = self.key(k); match x { Some(x) => num(o, x), None => o.push_str("null") } self }
    pub fn str(&mut self, k: &str, s: &str) -> &mut Self { let o = self.key(k); string(o, s); self }
    pub fn opt_str(&mut self, k: &str, s: Option<&str>) -> &mut Self { let o = self.key(k); match s { Some(s) => string(o, s), None => o.push_str("null") } self }
    pub fn bool(&mut self, k: &str, b: bool) -> &mut Self { let o = self.key(k); o.push_str(if b { "true" } else { "false" }); self }
    pub fn raw(&mut self, k: &str, f: impl FnOnce(&mut String)) -> &mut Self { let o = self.key(k); f(o); self }
    pub fn end(&mut self) { self.out.push('}'); }
}
