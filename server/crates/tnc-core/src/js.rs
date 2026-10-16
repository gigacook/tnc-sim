//! JavaScript semantics the interpreter was written against: Math.* (fdlibm via `libm`, V8's hypot and round),
//! Number -> String, toFixed, String.prototype.trim and the `\s` class. Every place the JS engine and this one could
//! disagree by a rounding or a format goes through here.

pub const PI: f64 = std::f64::consts::PI;

pub fn sin(x: f64) -> f64 { libm::sin(x) }
pub fn cos(x: f64) -> f64 { libm::cos(x) }
pub fn tan(x: f64) -> f64 { libm::tan(x) }
pub fn asin(x: f64) -> f64 { libm::asin(x) }
pub fn acos(x: f64) -> f64 { libm::acos(x) }
pub fn atan(x: f64) -> f64 { libm::atan(x) }
pub fn atan2(y: f64, x: f64) -> f64 { libm::atan2(y, x) }
pub fn exp(x: f64) -> f64 { libm::exp(x) }
pub fn log(x: f64) -> f64 { libm::log(x) }
pub fn sqrt(x: f64) -> f64 { x.sqrt() }
pub fn floor(x: f64) -> f64 { libm::floor(x) }
pub fn ceil(x: f64) -> f64 { libm::ceil(x) }
pub fn abs(x: f64) -> f64 { x.abs() }
pub const LN10: f64 = std::f64::consts::LN_10;

/// Math.pow: the ES spec special cases on top of the C pow (1 ** NaN and ±1 ** ±Infinity are NaN in JS).
pub fn pow(b: f64, e: f64) -> f64 {
    if e.is_nan() { return f64::NAN; }
    if e.is_infinite() && b.abs() == 1.0 { return f64::NAN; }
    libm::pow(b, e)
}

/// Math.round: the nearest integer, halves toward +Infinity; -0 and (-0.5, 0) give -0.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 { return x; }
    if x > 0.0 && x < 0.5 { return 0.0; }
    if x < 0.0 && x >= -0.5 { return -0.0; }
    let f = floor(x);
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// Math.max / Math.min: NaN wins, +0 > -0.
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == 0.0 && b == 0.0 { return if a.is_sign_negative() && b.is_sign_negative() { -0.0 } else { 0.0 }; }
    if a > b { a } else { b }
}
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == 0.0 && b == 0.0 { return if a.is_sign_negative() || b.is_sign_negative() { -0.0 } else { 0.0 }; }
    if a < b { a } else { b }
}
pub fn max_n(v: &[f64]) -> f64 { v.iter().fold(f64::NEG_INFINITY, |m, &x| max(m, x)) }
pub fn min_n(v: &[f64]) -> f64 { v.iter().fold(f64::INFINITY, |m, &x| min(m, x)) }

/// Math.hypot as V8 computes it (builtins-math: scale by the largest magnitude, Kahan-summed squares).
pub fn hypot(v: &[f64]) -> f64 {
    let mut maxv = 0.0f64;
    let mut one_nan = false;
    for &x in v {
        let a = x.abs();
        if a.is_infinite() { return f64::INFINITY; }
        if a.is_nan() { one_nan = true; } else if a > maxv { maxv = a; }
    }
    if one_nan { return f64::NAN; }
    if maxv == 0.0 { return 0.0; }
    let mut sum = 0.0f64;
    let mut comp = 0.0f64;
    for &x in v {
        let n = x.abs() / maxv;
        let s = n * n - comp;
        let p = sum + s;
        comp = (p - sum) - s;
        sum = p;
    }
    sqrt(sum) * maxv
}
pub fn hypot2(a: f64, b: f64) -> f64 { hypot(&[a, b]) }
pub fn hypot3(a: f64, b: f64, c: f64) -> f64 { hypot(&[a, b, c]) }

/// JS truthiness of a number.
pub fn truthy(x: f64) -> bool { !(x == 0.0 || x.is_nan()) }
/// `a || b` for numbers.
pub fn or(a: f64, b: f64) -> f64 { if truthy(a) { a } else { b } }

/// JS whitespace (the `\s` class and String.prototype.trim): ECMAScript WhiteSpace + LineTerminator.
pub fn is_ws(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
        | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}
pub fn trim(s: &str) -> &str { s.trim_matches(is_ws) }
/// The `\s` character class for regex-lite patterns (its own `\s` is ASCII only).
pub const WS: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";
pub const NWS: &str = r"[^\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// `s.split(/\s+/).filter(w => w.length > 0)`
pub fn words(s: &str) -> Vec<&str> { s.split(is_ws).filter(|w| !w.is_empty()).collect() }

/// Number.prototype.toString() (radix 10): the shortest round-trip digits in ECMAScript's layout.
pub fn num_str(x: f64) -> String {
    if x.is_nan() { return "NaN".into(); }
    if x == 0.0 { return "0".into(); }
    if x.is_infinite() { return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() }; }
    let neg = x < 0.0;
    // shortest digits and exponent from Rust's {:e} (shortest round-trip, e.g. "1.2345e-7")
    let e = format!("{:e}", x.abs());
    let (mant, exp) = e.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1; // decimal point position
    let mut s = String::new();
    if neg { s.push('-'); }
    if k <= n && n <= 21 {
        s.push_str(&digits);
        for _ in 0..(n - k) { s.push('0'); }
    } else if 0 < n && n <= 21 {
        s.push_str(&digits[..n as usize]);
        s.push('.');
        s.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        s.push_str("0.");
        for _ in 0..(-n) { s.push('0'); }
        s.push_str(&digits);
    } else {
        let e1 = n - 1;
        s.push_str(&digits[..1]);
        if k > 1 { s.push('.'); s.push_str(&digits[1..]); }
        s.push('e');
        s.push(if e1 >= 0 { '+' } else { '-' });
        s.push_str(&e1.abs().to_string());
    }
    s
}

/// Number.prototype.toFixed(f): exact decimal value, ties to the larger n (away from zero for the magnitude).
pub fn to_fixed(x: f64, f: usize) -> String {
    if x.is_nan() { return "NaN".into(); }
    if x.abs() >= 1e21 || x.is_infinite() { return num_str(x); }
    let neg = x < 0.0;
    let a = x.abs();
    // 40 extra digits are exact for any tie: a tie has at most f + 1 fractional digits
    let long = format!("{:.*}", f + 40, a);
    let (ip, fp) = long.split_once('.').unwrap();
    let keep = &fp[..f];
    let rest = &fp[f..];
    let tie = rest.starts_with('5') && rest[1..].chars().all(|c| c == '0');
    let mut s = if tie {
        // round up the magnitude
        let mut digits: Vec<u8> = format!("{}{}", ip, keep).into_bytes();
        let mut i = digits.len();
        loop {
            if i == 0 { digits.insert(0, b'1'); break; }
            i -= 1;
            if digits[i] == b'9' { digits[i] = b'0'; } else { digits[i] += 1; break; }
        }
        let d = String::from_utf8(digits).unwrap();
        let il = d.len() - f;
        if f > 0 { format!("{}.{}", &d[..il], &d[il..]) } else { d }
    } else {
        format!("{:.*}", f, a)
    };
    // JS keeps the sign of a negative number even when it rounds to zero ("-0.00")
    if neg && s.chars().any(|c| c != '0' && c != '.') { s.insert(0, '-'); }
    else if neg { s.insert(0, '-'); }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn number_strings_match_js() {
        let cases: &[(f64, &str)] = &[(0.0, "0"), (-0.0, "0"), (1.0, "1"), (-1.5, "-1.5"), (0.1, "0.1"), (1e21, "1e+21"), (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"), (1e-7, "1e-7"), (1.5e-7, "1.5e-7"), (0.000001, "0.000001"), (2.5e-6, "0.0000025"),
            (1.7976931348623157e308, "1.7976931348623157e+308"), (5e-324, "5e-324"), (100.0, "100"), (0.3 - 0.1, "0.19999999999999998")];
        for (x, s) in cases { assert_eq!(num_str(*x), *s, "{x}"); }
    }
    #[test]
    fn to_fixed_matches_js() {
        assert_eq!(to_fixed(0.125, 2), "0.13");
        assert_eq!(to_fixed(1.005, 2), "1.00");          // 1.005 is 1.00499999999999989...
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(-2.5, 0), "-3");
        assert_eq!(to_fixed(-0.001, 2), "-0.00");
        assert_eq!(to_fixed(1.45, 1), "1.4");            // 1.4499999999999999556
        assert_eq!(to_fixed(9.995, 2), "9.99");
        assert_eq!(to_fixed(99.5, 0), "100");
        assert_eq!(to_fixed(12.0, 3), "12.000");
    }
    #[test]
    fn round_and_hypot() {
        assert_eq!(round(2.5), 3.0); assert_eq!(round(-2.5), -2.0); assert!(round(-0.4).is_sign_negative());
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(hypot2(3.0, 4.0), 5.0);
        assert!(max(f64::NAN, 1.0).is_nan());
    }
}
