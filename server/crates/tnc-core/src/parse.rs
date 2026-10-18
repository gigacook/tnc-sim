//! Section 3 of core.js: one line -> one block, then the program-level numbering. Rule for rule the same
//! regular expressions; after the line is normalised (`U`) its only whitespace is a plain space, so the
//! ASCII `\s` of regex-lite matches what JavaScript's `\s` matched.

use crate::js;
use crate::val::{Args, Ast, Block, Kind, NQ, V};
use regex_lite::Regex;
use std::sync::OnceLock;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        fn $name() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new($pat).unwrap()) }
    };
}

const NUM: &str = r"[+-]?(?:\d+\.?\d*|\.\d+)";

re!(re_num_or_q_q, r"^([+-])?Q(\d+)$");
re!(re_num_valid, r"^[+-]?(\d+\.?\d*|\.\d+)$");
re!(re_digits, r"^\d+$");
re!(re_expr_tok, r"^(\d+\.?\d*|\.\d+|Q[LR]?\d+|[A-Z]+|[-+*/^()])");
re!(re_q_tok, r"^Q\d+$");

/// numOrQ: a plain number, a Q reference, or null
pub fn num_or_q(s: &str) -> Option<NQ> {
    let s: String = js::trim(s).chars().filter(|c| !js::is_ws(*c)).collect();
    if s.is_empty() { return None; }
    if let Some(m) = re_num_or_q_q().captures(&s) {
        return Some(NQ::Q(parse_int(&m[2]), m.get(1).map(|x| x.as_str()) == Some("-")));
    }
    if !re_num_valid().is_match(&s) { return None; }
    let v = parse_float(&s);
    if v.is_nan() { None } else { Some(NQ::N(v)) }
}

/// parseFloat on a string the caller already validated as [+-]?(\d+\.?\d*|\.\d+)
pub fn parse_float(s: &str) -> f64 {
    let t = s.strip_prefix('+').unwrap_or(s);
    let t = t.strip_suffix('.').unwrap_or(t);
    let t2 = if t.starts_with("-.") { format!("-0{}", &t[1..]) } else if t.starts_with('.') { format!("0{}", t) } else { t.to_string() };
    t2.parse::<f64>().unwrap_or(f64::NAN)
}
/// parseInt(digits, 10)
pub fn parse_int(s: &str) -> f64 { s.parse::<f64>().unwrap_or(f64::NAN) }

/// lblKey: digits -> number, anything else the text (quotes removed)
#[derive(Clone, Debug, PartialEq)]
pub enum Lbl { N(f64), S(String) }
impl Lbl {
    pub fn key(&self) -> String { match self { Lbl::N(n) => js::num_str(*n), Lbl::S(s) => s.clone() } }
    pub fn to_v(&self) -> V { match self { Lbl::N(n) => V::Num(*n), Lbl::S(s) => V::Str(s.clone()) } }
    pub fn from_v(v: &V) -> Lbl { match v { V::Num(n) => Lbl::N(*n), V::Str(s) => Lbl::S(s.clone()), _ => Lbl::S("undefined".into()) } }
}
pub fn lbl_key(s: &str) -> Lbl {
    let s: String = s.chars().filter(|c| *c != '"').collect();
    if re_digits().is_match(&s) { Lbl::N(parse_int(&s)) } else { Lbl::S(s) }
}

/* ---- Q-parameter formulas ---- */
fn is_func(t: &str) -> Option<&'static str> {
    const F: [&str; 16] = ["SQ", "SQRT", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "LN", "LOG", "EXP", "NEG", "INT", "ABS", "FRAC", "SGN"];
    F.iter().find(|f| **f == t).copied()
}
pub fn compile_expr(src: &str) -> Option<Ast> {
    let up = src.to_uppercase();
    let src = js::trim(&up);
    let mut toks: Vec<&str> = Vec::new();
    let mut pos = 0;
    while pos < src.len() {
        let rest = &src[pos..];
        let lead = rest.len() - rest.trim_start_matches(js::is_ws).len();
        match re_expr_tok().captures(&rest[lead..]) {
            Some(m) => { let t = m.get(1).unwrap(); toks.push(&src[pos + lead..pos + lead + t.end()]); pos += lead + t.end(); }
            None => { if rest.chars().all(js::is_ws) { break; } return None; }
        }
    }
    struct P<'a> { t: Vec<&'a str>, i: usize }
    impl<'a> P<'a> {
        fn peek(&self) -> Option<&'a str> { self.t.get(self.i).copied() }
        fn expr(&mut self) -> Option<Ast> {
            let mut a = self.term()?;
            while matches!(self.peek(), Some("+") | Some("-")) {
                let op = if self.t[self.i] == "+" { "+" } else { "-" }; self.i += 1;
                let b = self.term()?; a = Ast::B(op, Box::new(a), Box::new(b));
            }
            Some(a)
        }
        fn term(&mut self) -> Option<Ast> {
            let mut a = self.pow()?;
            while matches!(self.peek(), Some("*") | Some("/") | Some("DIV") | Some("LEN") | Some("ANG")) {
                let op: &'static str = match self.t[self.i] { "*" => "*", "/" | "DIV" => "/", "LEN" => "LEN", _ => "ANG" }; self.i += 1;
                let b = self.pow()?; a = Ast::B(op, Box::new(a), Box::new(b));
            }
            Some(a)
        }
        fn pow(&mut self) -> Option<Ast> {
            let a = self.unary()?;
            if self.peek() == Some("^") { self.i += 1; let b = self.pow()?; return Some(Ast::B("^", Box::new(a), Box::new(b))); }
            Some(a)
        }
        fn unary(&mut self) -> Option<Ast> {
            let t = self.peek();
            if t == Some("+") { self.i += 1; return self.unary(); }
            if t == Some("-") { self.i += 1; let u = self.unary()?; return Some(Ast::U(Box::new(u))); }
            if let Some(f) = t.and_then(is_func) { self.i += 1; let x = self.unary()?; return Some(Ast::F(f, Box::new(x))); }
            self.prim()
        }
        fn prim(&mut self) -> Option<Ast> {
            let t = self.t.get(self.i).copied(); self.i += 1;
            let t = t?;
            if t == "(" { let e = self.expr(); let close = self.t.get(self.i).copied(); self.i += 1; if close != Some(")") { return None; } return e; }
            if t == "PI" { return Some(Ast::N(js::PI)); }
            if re_q_tok().is_match(t) { return Some(Ast::Q(parse_int(&t[1..]))); }
            if t.starts_with(|c: char| c.is_ascii_digit() || c == '.') { return Some(Ast::N(parse_float(t))); }
            None
        }
    }
    let mut p = P { t: toks, i: 0 };
    let ast = p.expr();
    if ast.is_some() && p.i == p.t.len() { ast } else { None }
}

const D2R: f64 = js::PI / 180.0;
pub const EPS: f64 = 1e-9;
pub fn eval_expr(n: &Ast, q: &crate::exec::QMap, err: &mut dyn FnMut(&'static str)) -> f64 {
    match n {
        Ast::N(x) => *x,
        Ast::Q(i) => { let v = q.get(*i); if v.is_finite() { v } else { 0.0 } }
        Ast::U(a) => -eval_expr(a, q, err),
        Ast::F(f, a) => {
            let x = eval_expr(a, q, err);
            match *f {
                "SQ" => x * x,
                "SQRT" => { if x < 0.0 { err("SQUARE ROOT OF NEGATIVE NUMBER"); return 0.0; } js::sqrt(x) }
                "SIN" => js::sin(x * D2R), "COS" => js::cos(x * D2R), "TAN" => js::tan(x * D2R),
                "ASIN" => { if x.abs() > 1.0 { err("ARITHMETICAL ERROR"); return 0.0; } js::asin(x) / D2R }
                "ACOS" => { if x.abs() > 1.0 { err("ARITHMETICAL ERROR"); return 0.0; } js::acos(x) / D2R }
                "ATAN" => js::atan(x) / D2R,
                "LN" => { if x <= 0.0 { err("ARITHMETICAL ERROR"); return 0.0; } js::log(x) }
                "LOG" => { if x <= 0.0 { err("ARITHMETICAL ERROR"); return 0.0; } js::log(x) / js::LN10 }
                "EXP" => js::exp(x), "NEG" => -x, "ABS" => x.abs(),
                "INT" => if x < 0.0 { js::ceil(x) } else { js::floor(x) },
                "FRAC" => x - if x < 0.0 { js::ceil(x) } else { js::floor(x) },
                "SGN" => if x > 0.0 { 1.0 } else if x < 0.0 { -1.0 } else { 0.0 },
                _ => 0.0,
            }
        }
        Ast::B(op, a, b) => {
            let a = eval_expr(a, q, err);
            let b = eval_expr(b, q, err);
            match *op {
                "+" => a + b, "-" => a - b, "*" => a * b,
                "/" => { if b.abs() < EPS { err("DIVISION BY ZERO"); return 0.0; } a / b }
                "^" => js::pow(a, b),
                "LEN" => js::sqrt(a * a + b * b),
                "ANG" => { let g = js::atan2(b, a) / D2R; if g < 0.0 { g + 360.0 } else { g } }
                _ => 0.0,
            }
        }
    }
}

/* ---- the line parser ---- */
fn mark_err(b: &mut Block, msg: &str) { b.error = Some(msg.into()); b.perr = Some(msg.into()); }

re!(re_scan_axis, r"^(I)?([XYZ])([+-]?\S+)$");
re!(re_scan_dr, r"^DR([+-])$");
re!(re_scan_m, r"^M(\d+)$");
re!(re_scan_f, r"^F(\S+)$");
re!(re_scan_r, r"^R(\S+)$");
re!(re_scan_polar, r"^(I)?P([RA])(\S+)$");
re!(re_scan_lencca, r"^(LEN|CCA)(\S+)$");
re!(re_scan_rot, r"^(I)?([ABC])([+-]?(?:\d+\.?\d*|\.\d+|Q\d+))$");

fn axis_key(i: bool, a: &str) -> &'static str {
    match (i, a) { (false, "X") => "x", (false, "Y") => "y", (false, "Z") => "z", (true, "X") => "ix", (true, "Y") => "iy", _ => "iz" }
}
fn scan_words(toks: &[&str], args: &mut Args) -> Vec<String> {
    let mut unknown = Vec::new();
    for &t in toks {
        if t == "R0" { args.set("rc", V::Str("R0".into())); continue; }
        if t == "RL" { args.set("rc", V::Str("RL".into())); continue; }
        if t == "RR" { args.set("rc", V::Str("RR".into())); continue; }
        if t == "FMAX" { args.set("fmax", V::Bool(true)); continue; }
        if t == "FAUTO" { args.set("fauto", V::Bool(true)); continue; }
        if let Some(m) = re_scan_dr().captures(t) { args.set("dr", V::Str(m[1].into())); continue; }
        if let Some(m) = re_scan_axis().captures(t) {
            match num_or_q(&m[3]) { Some(v) => { args.set(axis_key(m.get(1).is_some(), &m[2]), V::nq(Some(v))); continue; } None => { unknown.push(t.into()); continue; } }
        }
        if let Some(m) = re_scan_m().captures(t) {
            let n = parse_int(&m[1]);
            match args.0.iter_mut().find(|(k, _)| *k == "m") { Some((_, V::Nums(v))) => v.push(n), _ => args.set("m", V::Nums(vec![n])) }
            continue;
        }
        if let Some(m) = re_scan_f().captures(t) { match num_or_q(&m[1]) { Some(v) => { args.set("f", V::nq(Some(v))); continue; } None => { unknown.push(t.into()); continue; } } }
        if let Some(m) = re_scan_r().captures(t) { match num_or_q(&m[1]) { Some(v) => { args.set("r", V::nq(Some(v))); continue; } None => { unknown.push(t.into()); continue; } } }
        if let Some(m) = re_scan_polar().captures(t) {
            match num_or_q(&m[3]) {
                Some(v) => { let k = match (m.get(1).is_some(), &m[2]) { (false, "R") => "pr", (false, _) => "pa", (true, "R") => "ipr", _ => "ipa" }; args.set(k, V::nq(Some(v))); continue; }
                None => { unknown.push(t.into()); continue; }
            }
        }
        if let Some(m) = re_scan_lencca().captures(t) {
            match num_or_q(&m[2]) { Some(v) => { args.set(if &m[1] == "LEN" { "len" } else { "cca" }, V::nq(Some(v))); continue; } None => { unknown.push(t.into()); continue; } }
        }
        if let Some(m) = re_scan_rot().captures(t) {
            let k = match (m.get(1).is_some(), &m[2]) { (false, "A") => "axa", (false, "B") => "axb", (false, _) => "axc", (true, "A") => "iaxa", (true, "B") => "iaxb", _ => "iaxc" };
            args.set(k, V::nq(num_or_q(&m[3]))); continue;
        }
        unknown.push(t.into());
    }
    unknown
}

re!(re_blk_axis_x, &format!(r"(?:^|\s)X\s*({NUM}|[+-]?Q\d+)"));
re!(re_blk_axis_y, &format!(r"(?:^|\s)Y\s*({NUM}|[+-]?Q\d+)"));
re!(re_blk_axis_z, &format!(r"(?:^|\s)Z\s*({NUM}|[+-]?Q\d+)"));
fn blk_axis(rest: &str, letter: char) -> Option<NQ> {
    let re = match letter { 'X' => re_blk_axis_x(), 'Y' => re_blk_axis_y(), _ => re_blk_axis_z() };
    re.captures(rest).and_then(|m| num_or_q(&m[1]))
}

/// /^\d+\s+/ with JavaScript's \s: the byte index after the match
fn lead_num(s: &str) -> Option<usize> {
    let d = s.len() - s.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if d == 0 { return None; }
    let rest = &s[d..];
    let w = rest.len() - rest.trim_start_matches(js::is_ws).len();
    if w == 0 { None } else { Some(d + w) }
}
re!(re_mb, &format!(r"\bM140\s+MB\s*(MAX|{NUM})"));
re!(re_mb_strip, &format!(r"\s*\bMB\s*(MAX|{NUM})"));
re!(re_fmaxauto, r"\bF (MAX|AUTO)\b");
re!(re_lencca_sp, r"\b(LEN|CCA|IPR|IPA|PR|PA) ");
re!(re_begin, r"^BEGIN\s+PGM\s+(\S+)\s*(MM|INCH)?$");
re!(re_end, r"^END\s+PGM\s+(\S+)\s*(MM|INCH)?$");
re!(re_blk, r"^BLK\s+FORM\s+0\.([12])\s*(.*)$");
re!(re_blk_z, r"^Z\b");
re!(re_tooldef, r"^TOOL\s+DEF\s+(\S+)\s*(.*)$");
re!(re_tooldef_l, &format!(r"(?:^|\s)L\s*({NUM})"));
re!(re_tooldef_r, &format!(r"(?:^|\s)R\s*({NUM})"));
re!(re_toolcall, r"^TOOL\s+CALL\s*(.*)$");
re!(re_xyz1, r"^[XYZ]$");
re!(re_dlr, &format!(r"^D([LR])({NUM})$"));
re!(re_tch_dot, r"^TCH\s+PROBE\s+(\d+)\.(\d+)\s*(.*)$");
re!(re_qn, r"Q\d+");
re!(re_nums, NUM);
re!(re_tch, r"^TCH\s+PROBE\s+(\d+)\s*(.*)$");
re!(re_cycl_dot, r"^CYCL\s+DEF\s+(\d+)\.(\d+)\s*(.*)$");
re!(re_dr_any, r"DR([+-])");
re!(re_cycl, r"^CYCL\s+DEF\s+(\d+)\s*(.*)$");
re!(re_cyclcall, r"^CYCL\s+CALL(?:\s+M(\d+))?$");
re!(re_m99, r"^M99$");
re!(re_callpgm, r"^CALL\s+PGM\s+(\S+)$");
re!(re_calllbl, r#"^CALL\s+LBL\s*("?[A-Z0-9_]+"?)\s*(?:REP\s*(Q\d+|\d+)(?:\s*/\s*(\d+))?)?$"#);
re!(re_lbl, r#"^LBL\s*("?[A-Z0-9_]+"?)$"#);
re!(re_fn, r"^FN\s*(\d+)\s*:\s*(.*)$");
re!(re_jump, r#"^IF\s*(.+?)\s*(EQU|NE|GT|LT)\s*(.+?)\s*GOTO\s*LBL\s*("?[A-Z0-9_]+"?)$"#);
re!(re_fnerr, r"ERROR\s*=?\s*(\d+)");
re!(re_fnq, r"^Q(\d+)\s*=\s*(.*)$");
re!(re_stop, r"^STOP(\s|$)");
re!(re_appr, r"^APPR\s+(P?)(LT|LN|CT|LCT)\b\s*(.*)$");
re!(re_dep, r"^DEP\s+(P?)(LT|LN|CT|LCT)\b\s*(.*)$");
re!(re_rnd, r"^RND\s*(.*)$");
re!(re_chf, r"^CHF\s*([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))\s*(.*)$");
re!(re_polar, r"^(LP|CP|CTP|CT)\s+(.*)$");
re!(re_cc, r"^CC\s*(.*)$");
re!(re_cr, r"^CR\s+(.*)$");
re!(re_c, r"^C\s+(.*)$");
re!(re_l, r"^L\s+(.*)$");
re!(re_mwords, r"^(M\d+\s*)+$");
re!(re_qassign, r"^Q(\d+)\s*=\s*(.+)$");
re!(re_fmax_auto, r"^F?(MAX|AUTO)$");

fn word_tail(s: &str) -> Vec<&str> { js::words(s) }

pub fn parse_line(raw: &str, idx: usize) -> Block {
    // block.raw: trimmed, a listing's own leading number dropped when a word / comment follows
    let t = js::trim(raw);
    let mut raw_s = t.to_string();
    if let Some(e) = lead_num(t) {
        if t[e..].starts_with(|c: char| c.is_ascii_alphabetic() || c == ';' || c == '*') { raw_s = t[e..].to_string(); }
    }
    let mut b = Block { n: Some(idx as f64), raw: raw_s, kind: Kind::Unknown, args: Args::default(), indent: false, error: None, perr: None };

    let tabs = raw.replace('\t', " ");
    let mut line = js::trim(&tabs).to_string();
    if let Some(e) = lead_num(&line) { line = line[e..].to_string(); }

    let mut comment: Option<String> = None;
    if let Some(ci) = line.find(';') { comment = Some(js::trim(&line[ci + 1..]).to_string()); line = js::trim(&line[..ci]).to_string(); }

    // U: dashes, decimal comma, upper case, single spaces
    let dashed: String = line.chars().map(|c| if c == '\u{2013}' || c == '\u{2212}' { '-' } else { c }).collect();
    let mut dc = String::with_capacity(dashed.len());
    { let ch: Vec<char> = dashed.chars().collect(); let mut i = 0;
      while i < ch.len() {
          if i + 2 < ch.len() && ch[i].is_ascii_digit() && ch[i + 1] == ',' && ch[i + 2].is_ascii_digit() { dc.push(ch[i]); dc.push('.'); dc.push(ch[i + 2]); i += 3; }
          else { dc.push(ch[i]); i += 1; }
      } }
    let up = dc.to_uppercase();
    let mut u = String::with_capacity(up.len());
    { let mut in_ws = false; for c in up.chars() { if js::is_ws(c) { if !in_ws { u.push(' '); } in_ws = true; } else { u.push(c); in_ws = false; } } }
    let mut u = u.trim_matches(' ').to_string();
    if u.ends_with('~') { u.pop(); while u.ends_with(' ') { u.pop(); } }
    u = re_fmaxauto().replace_all(&u, "F$1").into_owned();
    // "CCA 180", "LEN 15": the space goes when a number / Q follows (a lookahead in JS)
    {
        let mut out = String::with_capacity(u.len()); let mut last = 0; let mut pos = 0;
        while let Some(m) = re_lencca_sp().find_at(&u, pos) {
            let after = &u[m.end()..];
            let a = after.strip_prefix(|c| c == '+' || c == '-').unwrap_or(after);
            if a.starts_with(|c: char| c.is_ascii_digit() || c == '.' || c == 'Q') {
                out.push_str(&u[last..m.end() - 1]); last = m.end(); pos = m.end();
            } else { pos = m.start() + 1; }
            if pos > u.len() { break; }
        }
        out.push_str(&u[last..]); u = out;
    }
    if let Some(c) = &comment { b.args.set("comment", V::Str(c.clone())); }

    if u.is_empty() { b.kind = if comment.is_some() { Kind::Comment } else { Kind::Blank }; return b; }

    if u.starts_with('*') {
        b.kind = Kind::Comment;
        let rest = line.strip_prefix('*').unwrap_or(&line);
        b.args.set("comment", V::Str(rest.trim_start_matches(js::is_ws).to_string()));
        b.args.set("structure", V::Bool(true));
        return b;
    }

    if let Some(m) = re_mb().captures(&u) {
        let v = if &m[1] == "MAX" { V::Str("MAX".into()) } else { V::Num(parse_float(&m[1])) };
        b.args.set("mb", v);
        u = re_mb_strip().replace(&u, "").into_owned();
    }

    if let Some(m) = re_begin().captures(&u) {
        b.kind = Kind::Begin; b.args.set("name", V::Str(m[1].into()));
        b.args.set("unit", V::Str(m.get(2).map(|x| x.as_str()).unwrap_or("MM").into()));
        if m.get(2).is_none() { mark_err(&mut b, "UNIT OF MEASURE MISSING"); }
        return b;
    }
    if let Some(m) = re_end().captures(&u) {
        b.kind = Kind::End; b.args.set("name", V::Str(m[1].into()));
        b.args.set("unit", V::Str(m.get(2).map(|x| x.as_str()).unwrap_or("MM").into()));
        return b;
    }

    if let Some(m) = re_blk().captures(&u) {
        let rest = format!(" {}", re_blk_z().replace(&m[2], " "));
        b.kind = if &m[1] == "1" { Kind::Blk1 } else { Kind::Blk2 };
        let (x, y, z) = (blk_axis(&rest, 'X'), blk_axis(&rest, 'Y'), blk_axis(&rest, 'Z'));
        b.args.set("x", V::nq(x)); b.args.set("y", V::nq(y)); b.args.set("z", V::nq(z));
        if x.is_none() || y.is_none() || z.is_none() { mark_err(&mut b, "BLK FORM DEFINITION INCORRECT"); }
        return b;
    }

    if let Some(m) = re_tooldef().captures(&u) {
        b.kind = Kind::ToolDef;
        let t = num_or_q(&m[1]);
        b.args.set("t", V::nq(t));
        let l = re_tooldef_l().captures(&m[2]).map(|x| parse_float(&x[1]));
        let r = re_tooldef_r().captures(&m[2]).map(|x| parse_float(&x[1]));
        b.args.set("l", l.map(V::Num).unwrap_or(V::Null));
        b.args.set("r", r.map(V::Num).unwrap_or(V::Null));
        if t.is_none() { mark_err(&mut b, "TOOL NUMBER MISSING"); }
        return b;
    }

    if let Some(m) = re_toolcall().captures(&u) {
        b.kind = Kind::ToolCall;
        let toks = word_tail(m.get(1).map(|x| x.as_str()).unwrap_or(""));
        let tn = if toks.is_empty() { None } else { num_or_q(toks[0]) };
        b.args.set("t", V::nq(tn));
        b.args.set("axis", V::Null); b.args.set("s", V::Null); b.args.set("dl", V::Num(0.0)); b.args.set("dr", V::Num(0.0));
        for tok in toks.iter().skip(if tn.is_none() { 0 } else { 1 }) {
            if re_xyz1().is_match(tok) { b.args.set("axis", V::Str(tok.to_string())); }
            else if let Some(v) = tok.strip_prefix('S') { b.args.set("s", V::nq(num_or_q(v))); }
            else if let Some(v) = tok.strip_prefix('F') { b.args.set("f", V::nq(num_or_q(v))); }
            else if let Some(d) = re_dlr().captures(tok) { b.args.set(if &d[1] == "L" { "dl" } else { "dr" }, V::Num(parse_float(&d[2]))); }
        }
        if tn.is_none() && !b.args.truthy("axis") && matches!(b.args.get("s"), Some(V::Null)) { mark_err(&mut b, "TOOL NUMBER MISSING"); }
        return b;
    }

    if let Some(m) = re_tch_dot().captures(&u) {
        if parse_int(&m[2]) == 0.0 {
            b.kind = Kind::TchProbe; b.args.set("num", V::Num(parse_int(&m[1]))); b.args.set("name", V::Str(m[3].trim().into())); b.args.set("dot", V::Bool(true));
            return b;
        }
        b.kind = Kind::CyclParm; b.indent = true; b.args.set("q", V::Num(parse_int(&m[2]))); b.args.set("dot", V::Bool(true)); b.args.set("body", V::Str(m[3].trim().into()));
        let stripped = re_qn().replace_all(&m[3], "");
        let values: Vec<f64> = re_nums().find_iter(&stripped).map(|x| parse_float(x.as_str())).collect();
        let first = values.first().copied();
        b.args.set("values", V::Nums(values));
        b.args.set("value", first.map(V::Num).unwrap_or(V::Null));
        return b;
    }
    if let Some(m) = re_tch().captures(&u) {
        b.kind = Kind::TchProbe; b.args.set("num", V::Num(parse_int(&m[1]))); b.args.set("name", V::Str(m[2].trim().into()));
        return b;
    }

    if let Some(m) = re_cycl_dot().captures(&u) {
        let cnum = parse_int(&m[1]); let sub = parse_int(&m[2]); let body = &m[3];
        if sub == 0.0 {
            b.kind = Kind::CyclDef; b.args.set("num", V::Num(cnum)); b.args.set("name", V::Str(body.trim().into()));
        } else {
            b.kind = Kind::CyclParm; b.indent = true;
            b.args.set("q", V::Num(sub)); b.args.set("dot", V::Bool(true)); b.args.set("body", V::Str(body.trim().into()));
            let values: Vec<f64> = re_nums().find_iter(body).map(|x| parse_float(x.as_str())).collect();
            let first = values.first().copied();
            b.args.set("values", V::Nums(values));
            b.args.set("value", first.map(V::Num).unwrap_or(V::Null));
            if let Some(d) = re_dr_any().captures(body) { b.args.set("dr", V::Str(d[1].into())); }
            if !b.args.has("comment") { b.args.set("comment", V::Str(re_nums().replace_all(body, "").trim().into())); }
        }
        return b;
    }
    if let Some(m) = re_cycl().captures(&u) {
        b.kind = Kind::CyclDef; b.args.set("num", V::Num(parse_int(&m[1])));
        b.args.set("name", V::Str(m.get(2).map(|x| x.as_str()).unwrap_or("").trim().into()));
        return b;
    }

    if let Some(m) = re_cyclcall().captures(&u) {
        b.kind = Kind::CyclCall;
        if let Some(mm) = m.get(1) { b.args.set("m", V::Nums(vec![parse_int(mm.as_str())])); }
        return b;
    }
    if re_m99().is_match(&u) { b.kind = Kind::CyclCall; return b; }

    // 9.4: CALL PGM name runs another program as a subprogram
    if let Some(m) = re_callpgm().captures(&u) { b.kind = Kind::CallPgm; b.args.set("pgm", V::Str(m[1].to_string())); return b; }
    if let Some(m) = re_calllbl().captures(&u) {
        b.kind = Kind::CallLbl;
        b.args.set("lbl", lbl_key(&m[1]).to_v());
        b.args.set("rep", match m.get(2) { Some(r) => V::nq(num_or_q(r.as_str())), None => V::Num(1.0) });
        b.args.set("repProg", V::Bool(m.get(2).is_some()));
        return b;
    }
    if let Some(m) = re_lbl().captures(&u) {
        let ln = lbl_key(&m[1]);
        b.kind = if ln == Lbl::N(0.0) { Kind::LblEnd } else { Kind::Lbl };
        b.args.set("lbl", ln.to_v());
        return b;
    }

    if let Some(m) = re_fn().captures(&u) {
        let fnum = parse_int(&m[1]); let rest2 = m[2].trim().to_string();
        b.args.set("fn", V::Num(fnum));
        if (9.0..=12.0).contains(&fnum) {
            b.kind = Kind::Jump;
            let jm = match re_jump().captures(&rest2) { Some(j) => j, None => { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); return b; } };
            let a = compile_expr(&jm[1]); let bb = compile_expr(&jm[3]);
            let bad = a.is_none() || bb.is_none();
            b.args.set("a", a.map(|x| V::Ast(Box::new(x))).unwrap_or(V::Null));
            b.args.set("b", bb.map(|x| V::Ast(Box::new(x))).unwrap_or(V::Null));
            b.args.set("op", V::Str(jm[2].into())); b.args.set("lbl", lbl_key(&jm[4]).to_v());
            if bad { mark_err(&mut b, "ARITHMETICAL ERROR"); }
            return b;
        }
        if fnum == 14.0 {
            b.kind = Kind::FnErr;
            let code = re_fnerr().captures(&rest2).map(|j| parse_int(&j[1])).unwrap_or(0.0);
            b.args.set("code", V::Num(code)); return b;
        }
        if let Some(jm) = re_fnq().captures(&rest2) {
            if fnum <= 8.0 || fnum == 13.0 {
                b.kind = Kind::Fn;
                b.args.set("target", V::Num(parse_int(&jm[1])));
                let e = compile_expr(&jm[2]);
                let bad = e.is_none();
                b.args.set("expr", e.map(|x| V::Ast(Box::new(x))).unwrap_or(V::Null));
                if bad { mark_err(&mut b, "ARITHMETICAL ERROR"); }
                return b;
            }
        }
        if (15.0..=20.0).contains(&fnum) { b.kind = Kind::FnNop; return b; }
        mark_err(&mut b, "BLOCK FORMAT INCORRECT");
        return b;
    }

    if re_stop().is_match(&u) {
        b.kind = Kind::Stop;
        let toks = js::words(&u);
        for t in toks.iter().skip(1) {
            if let Some(mm) = re_scan_m().captures(t) {
                let n = parse_int(&mm[1]);
                match b.args.0.iter_mut().find(|(k, _)| *k == "m") { Some((_, V::Nums(v))) => v.push(n), _ => b.args.set("m", V::Nums(vec![n])) }
            }
        }
        return b;
    }

    for (re, kind) in [(re_appr(), Kind::Appr), (re_dep(), Kind::Dep)] {
        if let Some(m) = re.captures(&u) {
            b.kind = kind; let form = m[2].to_string();
            b.args.set("form", V::Str(form.clone())); b.args.set("polar", V::Bool(!m[1].is_empty()));
            let bad = scan_words(&js::words(&m[3]), &mut b.args);
            if !bad.is_empty() { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); }
            else if ((form == "LT" || form == "LN") && !b.args.has("len"))
                || ((form == "CT" || form == "LCT") && !b.args.has("r"))
                || (form == "CT" && !b.args.has("cca")) { mark_err(&mut b, "ENTRY INCOMPLETE"); }
            return b;
        }
    }

    if let Some(m) = re_rnd().captures(&u) {
        b.kind = Kind::Rnd;
        let bad = scan_words(&js::words(&m[1]), &mut b.args);
        if !b.args.has("r") || matches!(b.args.get("r"), Some(V::Str(_))) { mark_err(&mut b, "ENTRY INCOMPLETE"); }
        else if !bad.is_empty() { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); }
        return b;
    }
    if let Some(m) = re_chf().captures(&u) {
        b.kind = Kind::Chf; b.args.set("len", V::nq(num_or_q(&m[1])));
        let bad = scan_words(&js::words(&m[2]), &mut b.args);
        if !bad.is_empty() { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); }
        return b;
    }

    if let Some(m) = re_polar().captures(&u) {
        b.kind = match &m[1] { "LP" => Kind::Lp, "CP" => Kind::Cp, "CTP" => Kind::Ctp, _ => Kind::Ct };
        let bad = scan_words(&js::words(&m[2]), &mut b.args);
        if !bad.is_empty() { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); }
        return b;
    }

    if let Some(m) = re_cc().captures(&u) {
        b.kind = Kind::Cc;
        let bad = scan_words(&js::words(&m[1]), &mut b.args);
        if !bad.is_empty() { mark_err(&mut b, "CIRCLE CENTER UNDEFINED"); }
        return b;
    }
    if let Some(m) = re_cr().captures(&u) {
        b.kind = Kind::Cr;
        let bad = scan_words(&js::words(&m[1]), &mut b.args);
        if !b.args.has("r") { mark_err(&mut b, "CIRCLE RADIUS MISSING"); }
        else if !bad.is_empty() { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); }
        return b;
    }
    if let Some(m) = re_c().captures(&u) {
        b.kind = Kind::C;
        let bad = scan_words(&js::words(&m[1]), &mut b.args);
        if !bad.is_empty() { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); }
        return b;
    }
    if let Some(m) = re_l().captures(&u) {
        b.kind = Kind::L;
        let bad = scan_words(&js::words(&m[1]), &mut b.args);
        if !bad.is_empty() { mark_err(&mut b, "BLOCK FORMAT INCORRECT"); }
        return b;
    }

    if re_mwords().is_match(&u) {
        b.kind = Kind::L;
        scan_words(&js::words(&u), &mut b.args);
        return b;
    }

    if let Some(m) = re_qassign().captures(&u) {
        b.kind = Kind::QAssign;
        b.args.set("q", V::Num(parse_int(&m[1])));
        let single: String = m[2].chars().filter(|c| !js::is_ws(*c)).collect();
        let mut value = V::nq(num_or_q(&single));
        if matches!(value, V::Null) && re_fmax_auto().is_match(&single) { value = V::Num(f64::NAN); }
        b.args.set("value", value);
        let e = compile_expr(&m[2]);
        b.args.set("expr", e.map(|x| V::Ast(Box::new(x))).unwrap_or(V::Null));
        return b;
    }

    // FK free contour programming (manual 6.6) is not simulated: say so instead of calling the block malformed
    if js::words(&u).first().is_some_and(|w| ["FPOL", "FL", "FLT", "FC", "FCT", "FSELECT"].contains(w)) { mark_err(&mut b, "FK NOT SIMULATED"); return b; }
    mark_err(&mut b, "BLOCK FORMAT INCORRECT");
    b
}

pub struct Parsed { pub blocks: Vec<Block>, pub errors: Vec<(usize, String)> }

pub fn parse(text: &str) -> Parsed {
    let mut blocks: Vec<Block> = Vec::new();
    let mut errors = Vec::new();
    let mut nc = 0.0f64; let mut owner = 0.0f64;
    let mut ctx: Option<&'static str> = None;
    let mut cyc = f64::NAN; // the cycle whose parameter lines may follow
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let mut b = parse_line(line, blocks.len());
        // a comment ending in ~ goes on in the next line (the TNC 430 post wraps long blocks that way)
        let cont = blocks.last().is_some_and(|p: &Block| p.kind == Kind::Comment && p.raw.trim_end().ends_with('~'));
        if cont { b.kind = Kind::Comment; b.error = None; b.perr = None; b.args = Args::default(); b.args.set("comment", V::Str(js::trim(line).to_string())); b.indent = true; }
        if b.kind == Kind::CyclDef || b.kind == Kind::TchProbe { cyc = b.args.num("num").unwrap_or(f64::NAN); }
        if b.kind == Kind::QAssign {
            let q = b.args.num("q").unwrap_or(0.0);
            // SL cycles 20-25 take Q1-Q19 (manual 8.6, p. 290-296); every other Q-style cycle Q200 and up
            let sl = (20.0..=25.0).contains(&cyc) && (1.0..=19.0).contains(&q);
            let in_cycle = matches!(ctx, Some("CYCLDEF") | Some("CYCLPARM") | Some("TCHPROBE")) && (q >= 200.0 || sl) && !matches!(b.args.get("value"), Some(V::Null));
            if in_cycle { b.kind = Kind::CyclParm; b.indent = true; b.args.remove("expr"); }
            else { b.kind = Kind::Formula; if !matches!(b.args.get("expr"), Some(V::Ast(_))) { mark_err(&mut b, "ARITHMETICAL ERROR"); } }
        }
        if b.kind != Kind::Blank && b.kind != Kind::Comment {
            ctx = Some(if b.kind == Kind::CyclParm && b.args.truthy("dot") { "DOT" } else { b.kind.as_str() });
        }
        if cont || (b.kind == Kind::CyclParm && !b.args.truthy("dot")) { b.n = Some(owner); }
        else if b.kind == Kind::Blank { b.n = None; }
        else { b.n = Some(nc); nc += 1.0; owner = b.n.unwrap(); }
        if let Some(e) = &b.error { errors.push((blocks.len(), e.clone())); }
        blocks.push(b);
    }
    Parsed { blocks, errors }
}
