//! A Server-Sent Events reader for the upstream answer: bytes in, whole events out.
//!
//! Handles what OpenRouter's stream really does: chunks that end anywhere (inside a line, inside a
//! multi-byte character), CRLF line ends, comment lines used as keepalives (`: OPENROUTER PROCESSING`),
//! and a last event without the closing blank line.

#[derive(Debug, PartialEq, Eq)]
pub enum Item {
    /// A `:` line. Carries no data; proof the connection is alive.
    Comment(String),
    /// The `data:` payload of one event (several data lines are joined with a newline).
    Data(String),
}

#[derive(Default)]
pub struct Parser {
    buf: Vec<u8>,
    data: Vec<String>,
}

impl Parser {
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<Item> {
        let mut out = vec![];
        self.buf.extend_from_slice(chunk);
        while let Some(i) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=i).collect();
            self.line(&line[..line.len() - 1], &mut out);
        }
        out
    }

    /// The stream ended: whatever is buffered is the last line and the last event.
    pub fn finish(&mut self) -> Vec<Item> {
        let mut out = vec![];
        let rest = std::mem::take(&mut self.buf);
        if !rest.is_empty() {
            self.line(&rest, &mut out);
        }
        self.flush(&mut out);
        out
    }

    fn flush(&mut self, out: &mut Vec<Item>) {
        if !self.data.is_empty() {
            out.push(Item::Data(std::mem::take(&mut self.data).join("\n")));
        }
    }

    fn line(&mut self, raw: &[u8], out: &mut Vec<Item>) {
        let raw = raw.strip_suffix(b"\r").unwrap_or(raw);
        if raw.is_empty() {
            self.flush(out);
            return;
        }
        let s = String::from_utf8_lossy(raw);
        if let Some(c) = s.strip_prefix(':') {
            out.push(Item::Comment(c.trim().to_owned()));
            return;
        }
        let (field, value) = s.split_once(':').unwrap_or((&s, ""));
        if field == "data" {
            self.data.push(value.strip_prefix(' ').unwrap_or(value).to_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(s: &str) -> Item {
        Item::Data(s.into())
    }

    #[test]
    fn whole_events() {
        let mut p = Parser::default();
        assert_eq!(p.feed(b"data: {\"a\":1}\n\ndata: [DONE]\n\n"), vec![data("{\"a\":1}"), data("[DONE]")]);
        assert!(p.finish().is_empty());
    }

    #[test]
    fn keepalive_comments_are_not_data() {
        let mut p = Parser::default();
        let items = p.feed(b": OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\ndata: {\"x\":2}\n\n");
        assert_eq!(items, vec![Item::Comment("OPENROUTER PROCESSING".into()), Item::Comment("OPENROUTER PROCESSING".into()), data("{\"x\":2}")]);
    }

    #[test]
    fn a_chunk_may_end_anywhere() {
        let whole = "data: {\"t\":\"Ø12 \u{2212} ok\"}\r\n\r\n: ping\r\n\r\ndata: [DONE]\r\n\r\n".as_bytes();
        // every split point, including inside the two multi-byte characters and between \r and \n
        for cut in 0..=whole.len() {
            let mut p = Parser::default();
            let mut items = p.feed(&whole[..cut]);
            items.extend(p.feed(&whole[cut..]));
            items.extend(p.finish());
            assert_eq!(items, vec![data("{\"t\":\"Ø12 \u{2212} ok\"}"), Item::Comment("ping".into()), data("[DONE]")], "cut at {cut}");
        }
        // and byte by byte
        let mut p = Parser::default();
        let mut items = vec![];
        for b in whole {
            items.extend(p.feed(&[*b]));
        }
        assert_eq!(items.len(), 3);
    }

    #[test]
    fn last_event_without_a_blank_line_and_multi_line_data() {
        let mut p = Parser::default();
        assert!(p.feed(b"event: x\ndata: one\ndata: two").is_empty());
        assert_eq!(p.finish(), vec![data("one\ntwo")]);
    }

    #[test]
    fn data_without_a_space_and_unknown_fields() {
        let mut p = Parser::default();
        assert_eq!(p.feed(b"id: 7\nretry: 100\ndata:{\"k\":1}\n\n"), vec![data("{\"k\":1}")]);
    }
}
