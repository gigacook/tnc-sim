//! The simulator's interpreter and checks for the server: `tnc-core`, the same Rust the browser runs as
//! WebAssembly, so a program the server checks gets the same errors, crashes and cycle time the operator sees.
//!
//! A small pool of worker threads runs the checks off the async runtime. Every check has a wall-clock limit for
//! the caller; the interpreter's own guards (2,000,000 executed blocks, 400,000 moves) bound the work itself.

use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tnc_core::exec::{ToolEntry, J};
use tnc_core::val::Kind;
use tnc_formats::Tool;

/// Version of the interpreter compiled in (a hash of tnc-core's source and sim/machines.js).
/// Stored with every check so a stale report can be told apart from a fresh one.
pub fn interpreter_version() -> String { tnc_core::version() }

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("interpreter failed to load: {0}")]
    Load(String),
    #[error("program took longer than {0:?} to check")]
    Timeout(Duration),
    #[error("interpreter error: {0}")]
    Script(String),
    #[error("engine is shut down")]
    Closed,
}

/// What the interpreter is told besides the text.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Options {
    /// "426", "430", … — `sim/machines.js` keys. Unknown or empty: the 3-axis defaults.
    #[serde(default)]
    pub machine: String,
    /// The operator's tool table; merged over the built-in one as in `ui.js` `mtools`.
    #[serde(default)]
    pub tools: Vec<Tool>,
    /// "ISO50" (default) or "SK40": the holder gauge length for tools with L = 0.
    #[serde(default)]
    pub holder: Option<String>,
    /// Create tools a program calls but the table lacks, as an import would.
    #[serde(default)]
    pub auto_tools: bool,
    /// Also return the numbered listing (what "save .H" writes).
    #[serde(default)]
    pub listing: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    /// 1-based line in the stored text.
    pub line: u32,
    /// The TNC block number shown on the control, if the line is a block.
    pub block: Option<i64>,
    pub msg: String,
    pub raw: String,
}

/// A finding of the safety analysis: a crash (rapid into material, holder or vice hit, spindle off while
/// cutting…) or a warning (chip load…).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// "crash" or "warn"
    pub sev: String,
    pub line: u32,
    pub block: Option<i64>,
    pub msg: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolUse {
    pub t: i64,
    pub name: Option<String>,
    pub r: f64,
    pub moves: u64,
    pub time: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub move_count: u64,
    pub path_feed: f64,
    pub path_rapid: f64,
    /// Seconds, `sum(length / feed)` as in the simulator (no dwell, no tool change).
    pub cycle_time: f64,
    pub min_z: f64,
    pub max_z: f64,
    pub removed_volume: f64,
    pub tools_used: Vec<ToolUse>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stock {
    pub x0: f64,
    pub y0: f64,
    pub z0: f64,
    pub x1: f64,
    pub y1: f64,
    pub z1: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// No interpreter errors and no crashes — what the simulator's own verify calls a good program.
    pub ok: bool,
    pub errors: Vec<Diagnostic>,
    /// Safety analysis; empty when the program has errors (the simulator does not run a broken program).
    #[serde(default)]
    pub events: Vec<Event>,
    /// NC blocks (blank lines are not blocks).
    pub blocks: u32,
    pub stats: Stats,
    pub stock: Option<Stock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub listing: Option<String>,
    pub interpreter: String,
}

fn num(v: f64) -> f64 { if v.is_finite() { v } else { 0.0 } }

/// One check, as ui.js does it around TNC.run: the tool table merged over the built-ins (mtools), the machine
/// parameters, the holder gauge length, the default blank for an unusable BLK FORM, then expand + analyse.
pub fn check_now(text: &str, o: &Options) -> Report {
    let mut by: Vec<ToolEntry> = tnc_core::tools();
    for t in &o.tools {
        let e = ToolEntry { t: t.t as f64, name: J::Val(t.name.clone()), l: t.l, r: t.r };
        match by.iter_mut().find(|b| b.t == e.t) { Some(b) => *b = e, None => by.push(e) }
    }
    by.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
    let opts = tnc_core::exec::Opts {
        tools: Some(by), mach: tnc_core::machine(&o.machine),
        holder_a: Some(if o.holder.as_deref() == Some("SK40") { 70.0 } else { 100.0 }),   // tools3d.js HOLDERS[...].A
        auto_tools: o.auto_tools,
    };
    let r = tnc_core::run(text, &opts);
    let c = &r.compiled;
    let mut st = tnc_core::stock_of(&c.stock);
    if !(st.x1 > st.x0) || !(st.y1 > st.y0) || !(st.z1 > st.z0) { st = tnc_core::stock::St { x0: 0.0, y0: 0.0, z0: -20.0, x1: 100.0, y1: 80.0, z1: 0.0 }; }
    let bn = |i: usize| r.blocks.get(i).and_then(|b| b.n).map(|n| n as i64);
    let mut events = vec![];
    if r.errors.is_empty() {
        let (_, _, _, ev, _, _) = tnc_core::check(c, &st, opts.mach.s_max, true);
        for e in ev.iter().filter(|e| e.sev == "crash" || e.sev == "warn") {
            let i = e.block as usize;
            events.push(Event { sev: e.sev.into(), line: (i + 1) as u32, block: bn(i), msg: e.msg.clone() });
        }
    }
    let errors: Vec<Diagnostic> = r.errors.iter().map(|(i, m)| Diagnostic {
        line: (*i + 1) as u32, block: bn(*i), msg: m.clone(), raw: r.blocks.get(*i).map(|b| b.raw.clone()).unwrap_or_default(),
    }).collect();
    let blocks = r.blocks.iter().filter(|b| b.kind != Kind::Blank).filter_map(|b| b.n).fold(0.0f64, |m, n| m.max(n + 1.0)) as u32;
    let s = &c.stats;
    let listing = o.listing.then(|| {
        let lines: Vec<String> = r.blocks.iter().filter(|b| b.kind != Kind::Blank)
            .map(|b| if b.indent { format!("  {}", b.raw) } else { format!("{} {}", b.n.map(tnc_core::js::num_str).unwrap_or_default(), b.raw) }).collect();
        lines.join("\r\n") + "\r\n"
    });
    Report {
        ok: errors.is_empty() && !events.iter().any(|e| e.sev == "crash"),
        events, errors, blocks,
        stats: Stats {
            move_count: s.move_count as u64, path_feed: num(s.path_feed), path_rapid: num(s.path_rapid), cycle_time: num(s.cycle_time),
            min_z: num(s.min_z), max_z: num(s.max_z), removed_volume: num(s.removed),
            tools_used: s.tools_used.iter().map(|t| ToolUse { t: t.t as i64, name: t.name.val().filter(|n| !n.is_empty()), r: num(t.r), moves: t.moves as u64, time: num(t.time) }).collect(),
        },
        stock: Some(Stock { x0: num(st.x0), y0: num(st.y0), z0: num(st.z0), x1: num(st.x1), y1: num(st.y1), z1: num(st.z1) }),
        listing,
        interpreter: interpreter_version(),
    }
}

struct Job {
    text: String,
    opts: Options,
    reply: mpsc::Sender<Result<Report, EngineError>>,
}

/// A pool of interpreter threads. Cheap to clone; the threads stop when the last clone is dropped.
#[derive(Clone)]
pub struct Engine {
    tx: SyncSender<Job>,
    builtin: Arc<Vec<Tool>>,
    timeout: Duration,
}

#[derive(Debug, Clone, Copy)]
pub struct Config {
    pub workers: usize,
    pub timeout: Duration,
    /// Kept for configuration compatibility; the native interpreter has no separate heap to cap.
    pub memory_limit: usize,
}

impl Default for Config {
    fn default() -> Self {
        Config { workers: 2, timeout: Duration::from_secs(10), memory_limit: 512 << 20 }
    }
}

impl Engine {
    pub fn start(cfg: Config) -> Result<Engine, EngineError> {
        let builtin = Arc::new(tnc_core::TOOLS.iter().map(|&(t, n, l, r)| Tool { t: t as u32, name: n.into(), l, r }).collect::<Vec<_>>());
        let (tx, rx) = mpsc::sync_channel::<Job>(256);
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..cfg.workers.max(1) {
            let rx = Arc::clone(&rx);
            std::thread::Builder::new()
                .name(format!("tnc-engine-{i}"))
                .stack_size(16 << 20)                 // subprogram nesting recurses (30 levels at most)
                .spawn(move || worker(rx))
                .map_err(|e| EngineError::Load(e.to_string()))?;
        }
        Ok(Engine { tx, builtin, timeout: cfg.timeout })
    }

    /// The tool table built into the interpreter (`TNC.TOOLS`); the operator's table overrides it by number.
    pub fn builtin_tools(&self) -> &[Tool] {
        &self.builtin
    }

    pub async fn check(&self, text: String, opts: Options) -> Result<Report, EngineError> {
        let e = self.clone();
        tokio::task::spawn_blocking(move || e.check_blocking(text, opts)).await.map_err(|_| EngineError::Closed)?
    }

    /// For command-line use, outside any async runtime. A check that runs past the timeout is reported as one;
    /// its worker finishes it in the background and then takes the next job.
    pub fn check_blocking(&self, text: String, opts: Options) -> Result<Report, EngineError> {
        let (reply, rx) = mpsc::channel();
        self.tx.send(Job { text, opts, reply }).map_err(|_| EngineError::Closed)?;
        match rx.recv_timeout(self.timeout) {
            Ok(r) => r,
            Err(mpsc::RecvTimeoutError::Timeout) => Err(EngineError::Timeout(self.timeout)),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(EngineError::Closed),
        }
    }
}

fn worker(rx: Arc<Mutex<Receiver<Job>>>) {
    loop {
        let job = match rx.lock() {
            Ok(r) => match r.recv() { Ok(j) => j, Err(_) => return },
            Err(_) => return,
        };
        let (text, opts) = (job.text, job.opts);
        let res = std::panic::catch_unwind(move || check_now(&text, &opts))
            .map_err(|p| EngineError::Script(p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into())));
        let _ = job.reply.send(res);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::start(Config { workers: 1, timeout: Duration::from_secs(20), ..Config::default() }).unwrap()
    }

    const OK: &str = "BEGIN PGM T MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S3000\nL Z+50 R0 FMAX M3\nL X+10 Y+10 R0 FMAX\nL Z-2 R0 F200\nL X+90 F500\nL Z+50 R0 FMAX M2\nEND PGM T MM";

    #[test]
    fn runs_a_clean_program() {
        let r = engine().check_blocking(OK.into(), Options { listing: true, ..Default::default() }).unwrap();
        assert!(r.ok, "{:?}", r.errors);
        assert_eq!(r.blocks, 10);
        assert!(r.stats.cycle_time > 0.0);
        assert!((r.stats.path_feed - 132.0).abs() < 1e-6, "{}", r.stats.path_feed); // Z+50 -> Z-2, then 80 in X
        assert_eq!(r.stats.tools_used.len(), 1);
        assert_eq!(r.stats.tools_used[0].t, 5);
        let listing = r.listing.unwrap();
        assert!(listing.starts_with("0 BEGIN PGM T MM\r\n1 BLK FORM"), "{listing}");
        assert_eq!(r.stock.unwrap().x1, 100.0);
    }

    #[test]
    fn reports_errors_by_line_and_block() {
        let src = "BEGIN PGM T MM\nTOOL CALL 99 Z S3000\nL X+0 FMAX\nEND PGM T MM";
        let r = engine().check_blocking(src.into(), Options::default()).unwrap();
        assert!(!r.ok);
        let e = &r.errors[0];
        assert_eq!(e.line, 2);
        assert_eq!(e.block, Some(1));
        assert!(e.msg.contains("TOOL"), "{}", e.msg);
    }

    #[test]
    fn user_tools_and_auto_tools() {
        let src = "BEGIN PGM T MM\nTOOL CALL 99 Z S3000\nEND PGM T MM";
        let e = engine();
        let tools = vec![Tool { t: 99, name: "MINE".into(), l: 50.0, r: 2.0 }];
        assert!(e.check_blocking(src.into(), Options { tools, ..Default::default() }).unwrap().ok);
        assert!(e.check_blocking(src.into(), Options { auto_tools: true, ..Default::default() }).unwrap().ok);
    }

    #[test]
    fn machine_430_parameters_apply() {
        // the 430's rapid rates and feed cap (machines.js) change the cycle time of the same program
        let src = "BEGIN PGM T MM\nTOOL CALL 5 Z S1000\nL X-5000 Y-100 Z-100 R0 FMAX M3\nL X+10 F200\nEND PGM T MM";
        let e = engine();
        let a = e.check_blocking(src.into(), Options { machine: "430".into(), ..Default::default() }).unwrap();
        let b = e.check_blocking(src.into(), Options { machine: "426".into(), ..Default::default() }).unwrap();
        assert!((a.stats.cycle_time - b.stats.cycle_time).abs() > 1.0, "{} vs {}", a.stats.cycle_time, b.stats.cycle_time);
    }

    #[test]
    fn endless_loop_is_stopped() {
        // FN 9 jump back to itself: the interpreter stops it at 2,000,000 executed blocks
        let src = "BEGIN PGM T MM\nLBL 1\nFN 9: IF +0 EQU +0 GOTO LBL 1\nEND PGM T MM";
        let e = engine();
        let r = e.check_blocking(src.into(), Options::default()).unwrap();
        assert!(!r.ok);
        assert!(r.errors.iter().any(|d| d.msg == "EXCESSIVE SUBPROGRAM NESTING"), "{:?}", r.errors);
        // and the worker is still usable afterwards
        assert!(e.check_blocking(OK.into(), Options::default()).unwrap().ok);
    }

    #[test]
    fn a_slow_check_times_out_for_the_caller() {
        let src = "BEGIN PGM T MM\nLBL 1\nFN 9: IF +0 EQU +0 GOTO LBL 1\nEND PGM T MM";
        let e = Engine::start(Config { workers: 1, timeout: Duration::from_millis(1), ..Config::default() }).unwrap();
        assert!(matches!(e.check_blocking(src.into(), Options::default()), Err(EngineError::Timeout(_))));
    }

    #[test]
    fn crashes_come_from_the_checks() {
        // FMAX straight down into the blank: a crash in the simulator, so not ok here either
        let src = "BEGIN PGM T MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S3000\nL X+50 Y+50 Z+50 R0 FMAX M3\nL Z-10 R0 FMAX\nL Z+50 R0 FMAX M2\nEND PGM T MM";
        let r = engine().check_blocking(src.into(), Options::default()).unwrap();
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        assert!(r.events.iter().any(|e| e.sev == "crash" && e.line == 6), "{:?}", r.events);
        assert!(!r.ok);
    }

    #[test]
    fn builtin_tools_come_from_the_interpreter() {
        let e = engine();
        assert!(e.builtin_tools().iter().any(|t| t.t == 5 && t.r == 6.0));
    }

    #[tokio::test]
    async fn async_check_and_version() {
        let r = engine().check(OK.into(), Options::default()).await.unwrap();
        assert!(r.ok);
        assert_eq!(r.interpreter, interpreter_version());
        assert_eq!(r.interpreter.len(), 16);
    }
}
