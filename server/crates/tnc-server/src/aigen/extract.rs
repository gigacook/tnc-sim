//! The program out of a model answer. A port of `extract` / `normalizeSrc` in `sim/ai.js`, so the
//! server reads an answer the way the simulator does: the LAST fenced block holding BEGIN PGM wins, an
//! unclosed fence counts, else the last BEGIN PGM .. END PGM in the raw text. Then the small slips are
//! repaired: block numbers, typographic minus signs, lower case, blank lines, the END PGM line.

/// Position just after "BEGIN<spaces>PGM" for the first match at or after `from` (ASCII case-insensitive).
fn find_begin_pgm(text: &str, from: usize) -> Option<(usize, usize)> {
    let b = text.as_bytes();
    let mut i = from;
    while i + 5 <= b.len() {
        if b[i..i + 5].eq_ignore_ascii_case(b"BEGIN") {
            let mut j = i + 5;
            while j < b.len() && b[j].is_ascii_whitespace() {
                j += 1;
            }
            if j > i + 5 && j + 3 <= b.len() && b[j..j + 3].eq_ignore_ascii_case(b"PGM") {
                return Some((i, j + 3));
            }
        }
        i += 1;
    }
    None
}

fn has_begin_pgm(text: &str) -> bool {
    find_begin_pgm(text, 0).is_some()
}

/// The bodies of the fenced blocks, with their info strings; a fence still open at the end counts.
fn fences(text: &str) -> Vec<(&str, &str)> {
    let mut out = vec![];
    let mut at = 0;
    while let Some(open) = text[at..].find("```").map(|i| i + at) {
        let Some(nl) = text[open..].find('\n').map(|i| i + open) else { break };
        let info = text[open + 3..nl].trim();
        if info.contains('`') {
            at = open + 3;
            continue;
        }
        let body_start = nl + 1;
        match text[body_start..].find("```").map(|i| i + body_start) {
            Some(close) => {
                out.push((info, &text[body_start..close]));
                at = close + 3;
            }
            None => {
                out.push((info, &text[body_start..]));
                break;
            }
        }
    }
    out
}

/// The program in the answer, normalized, or None when there is none.
pub fn program(answer: &str) -> Option<String> {
    let text = answer.replace('\r', "");
    let mut pick: Option<&str> = None;
    for (_, body) in fences(&text) {
        if has_begin_pgm(body) {
            pick = Some(body);
        }
    }
    if pick.is_none() {
        // the last BEGIN PGM in the raw text, to its END PGM line or to the end
        let mut last = None;
        let mut from = 0;
        while let Some((start, after)) = find_begin_pgm(&text, from) {
            last = Some(start);
            from = after;
        }
        pick = last.map(|s| &text[s..]);
    }
    pick.map(normalize).filter(|p| !p.is_empty())
}

/// The ```partspec block of the answer as JSON (the last one that parses to an object), if any.
pub fn part_spec(answer: &str, max_bytes: usize) -> Option<serde_json::Value> {
    let text = answer.replace('\r', "");
    let mut found = None;
    for (info, body) in fences(&text) {
        if info.eq_ignore_ascii_case("partspec") && body.len() <= max_bytes {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(body.trim()) {
                if v.is_object() {
                    found = Some(v);
                }
            }
        }
    }
    found
}

/// `^\s*N?\d+\s+(?=[A-Za-z;*])` removed: a block number in front of the block.
fn strip_block_number(line: &str) -> &str {
    let t = line.trim_start();
    let digits_from = usize::from(t.starts_with(['N', 'n']));
    let rest = &t[digits_from..];
    let n = rest.bytes().take_while(u8::is_ascii_digit).count();
    if n == 0 {
        return line;
    }
    let after = &rest[n..];
    let body = after.trim_start();
    if body.len() == after.len() || !body.starts_with(|c: char| c.is_ascii_alphabetic() || c == ';' || c == '*') {
        return line;
    }
    body
}

fn word_after<'a>(line: &'a str, first: &str, second: &str) -> Option<&'a str> {
    let t = line.trim_start();
    let t = t.strip_prefix(first)?;
    let u = t.trim_start();
    if u.len() == t.len() {
        return None;
    }
    let v = u.strip_prefix(second)?;
    if v.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some(v)
}

pub fn normalize(src: &str) -> String {
    let cleaned: String = src
        .chars()
        .filter(|&c| c != '\r')
        .map(|c| match c {
            '\u{2212}' | '\u{2013}' | '\u{2014}' => '-',
            '\u{a0}' | '\u{2009}' | '\u{202f}' => ' ',
            c => c,
        })
        .collect();
    let mut out: Vec<String> = vec![];
    let mut name: Option<String> = None;
    let mut closed = false;
    for raw in cleaned.split('\n') {
        let l = strip_block_number(raw).trim_end();
        if l.trim().is_empty() || l.trim_start().starts_with("```") {
            continue;
        }
        let (code, rest) = match l.find(';') {
            Some(c) => (&l[..c], &l[c..]),
            None => (l, ""),
        };
        let l = format!("{}{rest}", code.to_uppercase());
        if name.is_none() {
            if let Some(n) = word_after(&l, "BEGIN", "PGM").and_then(|after| after.split_whitespace().next()) {
                name = Some(n.to_owned());
                out.push(l.trim().to_owned());
                continue;
            }
        }
        if word_after(&l, "END", "PGM").is_some() {
            if let Some(n) = &name {
                out.push(format!("END PGM {n} MM"));
                closed = true;
                break;
            }
            continue;
        }
        out.push(l); // indentation kept: cycle Q lines are indented
    }
    if let (Some(n), false) = (&name, closed) {
        out.push(format!("END PGM {n} MM")); // the answer was cut off before END PGM
    }
    out.join("\n")
}

/// Turns the streamed answer into program text only, chunk by chunk: the fence lines, a ```partspec
/// block and any prose around the program are held back, so a `delta` event never carries them.
#[derive(Default)]
pub struct ProgramStream {
    state: State,
    /// text not yet decided on (an unfinished line, or the possible start of a closing fence)
    hold: String,
}

#[derive(Default, PartialEq)]
enum State {
    /// before the program: reading whole lines
    #[default]
    Before,
    /// inside a fenced block that is not the program
    Skip,
    Body,
    Done,
}

impl ProgramStream {
    /// Feed the next piece of the answer; returns the program text it releases (often empty).
    pub fn push(&mut self, chunk: &str) -> String {
        let mut out = String::new();
        self.hold.push_str(chunk);
        loop {
            match self.state {
                State::Done => {
                    self.hold.clear();
                    return out;
                }
                State::Before | State::Skip => {
                    let Some(nl) = self.hold.find('\n') else { return out };
                    let line: String = self.hold.drain(..=nl).collect();
                    let t = line.trim();
                    if self.state == State::Skip {
                        if t.starts_with("```") {
                            self.state = State::Before;
                        }
                    } else if let Some(info) = t.strip_prefix("```") {
                        self.state = if info.trim().eq_ignore_ascii_case("partspec") { State::Skip } else { State::Body };
                    } else if has_begin_pgm(t) {
                        out.push_str(&line); // a program without a fence
                        self.state = State::Body;
                    }
                }
                State::Body => {
                    if let Some(i) = self.hold.find("```") {
                        out.push_str(&self.hold[..i]);
                        self.state = State::Done;
                        continue;
                    }
                    // keep back a tail that may be the start of the closing fence
                    let keep = self.hold.bytes().rev().take(2).take_while(|&b| b == b'`').count();
                    let cut = self.hold.len() - keep;
                    out.push_str(&self.hold[..cut]);
                    self.hold.drain(..cut);
                    return out;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_results_as_the_simulator_side_extract() {
        // tests/ai/loop.js part 2, case 5
        let ex = program("old:\n```\nBEGIN PGM OLD MM\nEND PGM OLD MM\n```\nnew:\n```nc\n0 begin pgm new mm\n1 blk form 0.1 z x+0 y+0 z\u{2212}20 ; Keep\nM30\nEND PGM X MM\n```");
        assert_eq!(ex.as_deref(), Some("BEGIN PGM NEW MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20 ; Keep\nM30\nEND PGM NEW MM"));
        assert_eq!(program("```klartext\nBEGIN PGM CUT MM\nL X+1").as_deref(), Some("BEGIN PGM CUT MM\nL X+1\nEND PGM CUT MM"));
    }

    #[test]
    fn no_fence_prose_and_no_program() {
        assert_eq!(program("Here you go:\nBEGIN PGM A MM\r\nL X+1 R0 FMAX\r\nEND PGM A MM\nHope it helps").as_deref(), Some("BEGIN PGM A MM\nL X+1 R0 FMAX\nEND PGM A MM"));
        assert_eq!(program("I cannot write that."), None);
        assert_eq!(program(""), None);
        assert_eq!(program("```partspec\n{\"blank\":{}}\n```"), None);
    }

    #[test]
    fn block_numbers_and_indented_cycle_lines() {
        let p = program("```\nN10 BEGIN PGM C MM\n20 CYCL DEF 200 DRILLING\n  Q200=+2    ;SET-UP CLEARANCE\n30 L X+20 Y+20 R0 FMAX M99\n40 END PGM C MM\n```").unwrap();
        assert_eq!(p, "BEGIN PGM C MM\nCYCL DEF 200 DRILLING\n  Q200=+2    ;SET-UP CLEARANCE\nL X+20 Y+20 R0 FMAX M99\nEND PGM C MM");
    }

    #[test]
    fn part_spec_is_json_or_nothing() {
        let a = "```partspec\n{\"blank\":{\"x\":[0,100]},\"features\":[]}\n```\n```klartext\nBEGIN PGM A MM\nEND PGM A MM\n```";
        assert_eq!(part_spec(a, 1000).unwrap()["blank"]["x"][1], 100);
        assert_eq!(part_spec("```partspec\nnot json\n```", 1000), None);
        assert_eq!(part_spec("```partspec\n[1,2]\n```", 1000), None);
        assert_eq!(part_spec(a, 10), None); // over the size limit
        assert_eq!(part_spec("no fence", 1000), None);
    }

    fn stream(pieces: &[&str]) -> String {
        let mut s = ProgramStream::default();
        pieces.iter().map(|p| s.push(p)).collect()
    }

    #[test]
    fn stream_releases_only_program_text() {
        let whole = "Sure.\n```partspec\n{\"a\":1}\n```\n```klartext\nBEGIN PGM A MM\nL X+1 R0 FMAX\nEND PGM A MM\n```\nDone!";
        let want = "BEGIN PGM A MM\nL X+1 R0 FMAX\nEND PGM A MM\n";
        assert_eq!(stream(&[whole]), want);
        // any split point gives the same text
        for cut in 0..=whole.len() {
            assert_eq!(stream(&[&whole[..cut], &whole[cut..]]), want, "cut at {cut}");
        }
        let chars: Vec<String> = whole.chars().map(String::from).collect();
        assert_eq!(stream(&chars.iter().map(String::as_str).collect::<Vec<_>>()), want);
    }

    #[test]
    fn stream_without_a_fence_and_cut_off() {
        assert_eq!(stream(&["Here:\nBEGIN PGM A MM\nL X+1", " R0\n"]), "BEGIN PGM A MM\nL X+1 R0\n");
        assert_eq!(stream(&["```klartext\nBEGIN PGM A MM\nL X"]), "BEGIN PGM A MM\nL X");
        assert_eq!(stream(&["just talk, no program\n"]), "");
    }
}
