//! The generation job: one explicit request that writes a program with a model, checks it with the
//! simulator's own interpreter, measures it, sends it back for repair when needed, and reports every
//! step as a typed server-sent event. `docs/AI_API.md` is the contract.
//!
//! This is the only code path that sends a prompt or program text to OpenRouter on the server's own
//! initiative, and it runs only when a signed-in client posts to `/ai/jobs`.
//!
//! Rules it keeps:
//! - no key -> a typed `no_key` answer and no upstream request at all;
//! - a cancel (the cancel endpoint, or the client closing the stream) drops the upstream connection
//!   and no further upstream request is made;
//! - an upstream request is retried only when it failed before an answer was committed (connection
//!   refused, HTTP 429 / 5xx), at most `policy::MAX_TRANSIENT_RETRIES` times, announced first;
//! - a stream that fails or is cut off midway is never retried on its own: the cut-off answer costs a
//!   visible repair round, a failure ends the job with the best draft so far.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tnc_formats::Tool;
use tokio::sync::{mpsc, oneshot, watch};

use super::{catalog, extract, policy, sse};
use crate::auth::CurrentUser;
use crate::state::AppState;
use crate::util;

/* ---------------- the running jobs ---------------- */

#[derive(Default)]
pub struct Jobs {
    map: Mutex<HashMap<String, Arc<Handle>>>,
}

pub struct Handle {
    user: String,
    cancel: watch::Sender<bool>,
    pending: Mutex<Option<Pending>>,
}

struct Pending {
    request_id: String,
    reply: oneshot::Sender<ClientMeasure>,
}

impl Jobs {
    /// Registers the job unless the user already has one running.
    fn insert(&self, id: &str, h: Arc<Handle>) -> bool {
        let mut m = self.map.lock().unwrap();
        if m.values().any(|x| x.user == h.user) {
            return false;
        }
        m.insert(id.to_owned(), h);
        true
    }
    fn of(&self, id: &str, user: &str) -> Option<Arc<Handle>> {
        self.map.lock().unwrap().get(id).filter(|h| h.user == user).cloned()
    }
    fn remove(&self, id: &str) {
        self.map.lock().unwrap().remove(id);
    }
    pub fn running(&self) -> usize {
        self.map.lock().unwrap().len()
    }
}

/// An error answer in the API's usual shape, `{"error": {"code", "message"}}`.
pub(super) fn fail(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": { "code": code, "message": message.into() } }))).into_response()
}

/* ---------------- request ---------------- */

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    /// What to make, in the operator's words.
    prompt: String,
    /// Routable model id from the catalog; the server's default model when absent.
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    machine: Option<String>,
    /// The operator's tool table (merged over the built-in one, as the simulator does).
    #[serde(default)]
    tools: Vec<Tool>,
    #[serde(default)]
    holder: Option<String>,
    /// The system prompt. The simulator sends `TNC_AI.system(tools, opts)`; without it a short built-in one is used.
    #[serde(default)]
    system: Option<String>,
    /// The client answers `measure-request` events (it has the part measurement, `sim/part.js`).
    #[serde(default)]
    client_measure: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ClientMeasure {
    #[serde(skip_serializing)]
    request_id: String,
    /// Match with the intended part, 0-100.
    #[serde(default)]
    score: Option<f64>,
    /// Decides acceptance when given; otherwise the score against the policy goal.
    #[serde(default)]
    pass: Option<bool>,
    /// The measurement in words, for the model (what is not cut, what should not be cut).
    #[serde(default)]
    text: Option<String>,
}

/* ---------------- what a job produces ---------------- */

#[derive(Debug, Clone, Serialize)]
struct Finding {
    line: u32,
    block: Option<i64>,
    message: String,
    raw: String,
}

impl Finding {
    fn quoted(&self) -> String {
        match (self.block, self.raw.trim()) {
            (Some(n), raw) if !raw.is_empty() => format!("BLOCK {n} `{raw}`: {}", self.message),
            (Some(n), _) => format!("BLOCK {n}: {}", self.message),
            _ => self.message.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct Validation {
    ok: bool,
    errors: Vec<Finding>,
    crashes: Vec<Finding>,
    warnings: Vec<Finding>,
    blocks: u32,
    summary: String,
}

impl Validation {
    fn failed(message: impl Into<String>) -> Validation {
        let f = Finding { line: 0, block: None, message: message.into(), raw: String::new() };
        let mut v = Validation { ok: false, errors: vec![f], crashes: vec![], warnings: vec![], blocks: 0, summary: String::new() };
        v.summary = v.summarize();
        v
    }
    fn summarize(&self) -> String {
        if self.ok {
            return match self.warnings.len() {
                0 => "passed".into(),
                n => format!("passed, {n} warning(s)"),
            };
        }
        let first = self.errors.first().or(self.crashes.first()).map(|f| f.quoted()).unwrap_or_default();
        let first: String = first.chars().take(160).collect();
        format!("{} error(s), {} crash(es): {first}", self.errors.len(), self.crashes.len())
    }
}

/// What the interpreter itself can say about the cut (no part spec needed).
#[derive(Debug, Clone, Serialize)]
struct NativeMeasure {
    /// mm³, the interpreter's estimate from feed moves below the blank top.
    removed_volume_mm3: f64,
    cycle_time_s: f64,
    path_feed_mm: f64,
    min_z: f64,
    max_z: f64,
    tools_used: usize,
}

#[derive(Debug, Clone, Serialize)]
struct Measurement {
    native: Option<NativeMeasure>,
    /// The client's answer to `measure-request`, null when not asked or not answered in time.
    client: Option<ClientMeasure>,
}

#[derive(Debug, Clone)]
struct Cand {
    program: String,
    round: u32,
    validation: Validation,
    measurement: Measurement,
    truncated: bool,
    spec: Option<Value>,
}

impl Cand {
    fn score(&self) -> Option<f64> {
        self.measurement.client.as_ref().and_then(|c| c.score)
    }
    /// As `rank` in sim/ai.js: checked clean first, then the match, then the fewest problems.
    fn rank(&self) -> f64 {
        let v = &self.validation;
        (if v.ok { 1000.0 } else { 0.0 }) + self.score().unwrap_or(0.0) - v.errors.len() as f64 * 10.0 - v.crashes.len() as f64 * 4.0 - v.warnings.len() as f64 * 0.1
            - if self.truncated { 5000.0 } else { 0.0 }
    }
    fn accepted(&self) -> bool {
        if !self.validation.ok || self.truncated {
            return false;
        }
        match &self.measurement.client {
            None => true,
            Some(c) => c.pass.unwrap_or_else(|| c.score.is_none_or(|s| s >= policy::MEASURE_GOAL)),
        }
    }
    fn draft(&self) -> Value {
        json!({ "program": self.program, "round": self.round, "truncated": self.truncated, "validation": self.validation, "measurement": self.measurement })
    }
}

#[derive(Debug, Clone, Default, Serialize)]
struct Usage {
    /// Upstream generation requests made by this job (retries included).
    requests: u32,
    prompt_tokens: i64,
    completion_tokens: i64,
    cost_usd: f64,
}

#[derive(Default)]
struct Shared {
    best: Option<Cand>,
    /// Program text of the round being streamed, for a draft when nothing better exists.
    partial: Option<(u32, String)>,
    usage: Usage,
}

#[derive(Debug)]
struct Fail {
    code: &'static str,
    message: String,
    retryable: bool,
}

impl Fail {
    fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Fail {
        Fail { code, message: message.into(), retryable }
    }
}

struct Ctx {
    st: AppState,
    user: String,
    key: String,
    model: catalog::Model,
    system: String,
    ask: String,
    opts: tnc_engine::Options,
    client_measure: bool,
    out: mpsc::Sender<Event>,
    handle: Arc<Handle>,
    shared: Mutex<Shared>,
}

impl Ctx {
    async fn emit(&self, kind: &str, data: Value) {
        let _ = self.out.send(Event::default().event(kind).data(data.to_string())).await;
    }
    async fn status(&self, code: &str, message: impl Into<String>) {
        self.emit("status", json!({ "code": code, "message": message.into() })).await;
    }
    fn usage(&self) -> Usage {
        self.shared.lock().unwrap().usage.clone()
    }
    /// The best program so far, else what was streamed of the current round.
    fn draft(&self) -> Value {
        let s = self.shared.lock().unwrap();
        if let Some(b) = &s.best {
            return b.draft();
        }
        match s.partial.as_ref().and_then(|(round, text)| extract::program(text).map(|p| (*round, p))) {
            Some((round, program)) => json!({ "program": program, "round": round, "truncated": true, "validation": null, "measurement": null }),
            None => Value::Null,
        }
    }
}

/* ---------------- endpoints ---------------- */

/// `POST /ai/jobs`: start a job; the answer is the event stream.
pub async fn start(State(st): State<AppState>, CurrentUser(u): CurrentUser, body: Bytes) -> Response {
    let b: Start = match serde_json::from_slice(&body) {
        Ok(b) => b,
        Err(e) => return fail(StatusCode::BAD_REQUEST, "bad_request", format!("the request body is not a valid job: {e}")),
    };
    let prompt = b.prompt.trim();
    if prompt.is_empty() || prompt.chars().count() > policy::MAX_PROMPT_CHARS {
        return fail(StatusCode::BAD_REQUEST, "bad_request", format!("prompt must be 1 to {} characters", policy::MAX_PROMPT_CHARS));
    }
    if b.system.as_deref().is_some_and(|s| s.chars().count() > policy::MAX_SYSTEM_CHARS) {
        return fail(StatusCode::BAD_REQUEST, "bad_request", format!("system must be at most {} characters", policy::MAX_SYSTEM_CHARS));
    }
    if b.tools.len() > 999 || b.tools.iter().any(|t| !t.l.is_finite() || !t.r.is_finite() || t.r < 0.0 || t.name.chars().count() > 200) {
        return fail(StatusCode::BAD_REQUEST, "bad_request", "tools must be at most 999 rows of {t, name, l, r} with finite numbers");
    }
    let machine = b.machine.clone().unwrap_or_default();
    if !machine.is_empty() && !tnc_formats::MACHINES.contains(&machine.as_str()) {
        return fail(StatusCode::BAD_REQUEST, "bad_request", format!("machine must be one of {}", tnc_formats::MACHINES.join(", ")));
    }

    // the key first: without one nothing below may reach OpenRouter
    let Some(key) = st.ai_key.get() else {
        return fail(StatusCode::CONFLICT, "no_key", "No OpenRouter key is set on this server. Set one, then generate again.");
    };
    let Some(engine) = st.engine.clone() else {
        return fail(StatusCode::SERVICE_UNAVAILABLE, "validator_unavailable", "The interpreter is not running on this server, so a generated program could not be checked.");
    };
    let model_id = b.model.clone().filter(|m| !m.trim().is_empty()).unwrap_or_else(|| st.cfg.ai_default_model.clone());
    let allow = st.cfg.ai_models();
    if !allow.is_empty() && !allow.contains(&model_id) {
        return fail(StatusCode::FORBIDDEN, "model_not_allowed", format!("Model {model_id} is not allowed on this server. Allowed: {}.", allow.join(", ")));
    }
    match crate::ai::spent(&st, &u.id).await {
        Ok((cost, _)) if cost >= st.cfg.ai_monthly_budget_usd => {
            return fail(StatusCode::PAYMENT_REQUIRED, "budget_exceeded", format!("Monthly AI budget used up (US${cost:.2} of US${:.2}). It resets on the 1st.", st.cfg.ai_monthly_budget_usd));
        }
        Ok(_) => {}
        Err(e) => return e.into_response(),
    }
    let cat = match catalog::get(&st).await {
        Ok(f) => f.catalog,
        Err(e) => return fail(StatusCode::BAD_GATEWAY, "catalog_unavailable", format!("{e}. The model's limits are unknown, so nothing was generated. Try again.")),
    };
    let Some(model) = cat.models.iter().find(|m| m.id == model_id).cloned() else {
        return fail(StatusCode::BAD_REQUEST, "model_unknown", format!("Model {model_id} is not in OpenRouter's list of models that can generate live. Pick one from the model list."));
    };

    let (cancel, _) = watch::channel(false);
    let handle = Arc::new(Handle { user: u.id.clone(), cancel, pending: Mutex::new(None) });
    let id = util::new_id();
    if !st.ai_jobs.insert(&id, handle.clone()) {
        return fail(StatusCode::TOO_MANY_REQUESTS, "busy", "A generation is already running for this account. Cancel it or wait for it to finish.");
    }

    let mut tools: Vec<Tool> = engine.builtin_tools().to_vec();
    for t in &b.tools {
        match tools.iter_mut().find(|x| x.t == t.t) {
            Some(x) => *x = t.clone(),
            None => tools.push(t.clone()),
        }
    }
    tools.sort_by_key(|t| t.t);
    let system = b.system.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| default_system(&tools));
    let ask = format!(
        "Write the program for this part:\n\n{prompt}{}",
        if b.client_measure { "\n\nIf the system prompt defines a PART SPEC format, put the finished part in one ```partspec fence before the program." } else { "" }
    );
    let (tx, rx) = mpsc::channel::<Event>(256);
    let ctx = Arc::new(Ctx {
        st: st.clone(),
        user: u.id,
        key,
        model,
        system,
        ask,
        opts: tnc_engine::Options { machine, tools: b.tools, holder: b.holder, auto_tools: false, listing: false },
        client_measure: b.client_measure,
        out: tx,
        handle,
        shared: Mutex::new(Shared::default()),
    });
    tokio::spawn(run(ctx, id.clone(), engine));

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(Ok::<_, Infallible>);
    let mut res = Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("keepalive")).into_response();
    let h = res.headers_mut();
    h.insert("x-job-id", HeaderValue::from_str(&id).unwrap());
    h.insert(axum::http::header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert("x-accel-buffering", HeaderValue::from_static("no"));
    res
}

/// `POST /ai/jobs/{id}/cancel`: stop the job. No further upstream request is made.
pub async fn cancel(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>) -> Response {
    match st.ai_jobs.of(&id, &u.id) {
        Some(h) => {
            h.cancel.send_replace(true);
            Json(json!({ "cancelled": true })).into_response()
        }
        None => fail(StatusCode::NOT_FOUND, "job_not_found", "No running generation with that id (it may have finished already)."),
    }
}

/// `POST /ai/jobs/{id}/measurement`: the client's answer to a `measure-request` event.
pub async fn measurement(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>, body: Bytes) -> Response {
    let mut m: ClientMeasure = match serde_json::from_slice(&body) {
        Ok(m) => m,
        Err(e) => return fail(StatusCode::BAD_REQUEST, "bad_request", format!("the request body is not a valid measurement: {e}")),
    };
    if m.score.is_some_and(|s| !(0.0..=100.0).contains(&s)) {
        return fail(StatusCode::BAD_REQUEST, "bad_request", "score must be a number from 0 to 100");
    }
    if let Some(t) = &m.text {
        m.text = Some(t.chars().take(policy::MAX_MEASURE_TEXT_CHARS).collect());
    }
    let Some(h) = st.ai_jobs.of(&id, &u.id) else {
        return fail(StatusCode::NOT_FOUND, "job_not_found", "No running generation with that id (it may have finished already).");
    };
    let pending = {
        let mut p = h.pending.lock().unwrap();
        if p.as_ref().is_some_and(|p| p.request_id == m.request_id) {
            p.take()
        } else {
            None
        }
    };
    match pending {
        Some(p) => {
            let _ = p.reply.send(m);
            Json(json!({ "accepted": true })).into_response()
        }
        None => fail(StatusCode::CONFLICT, "measurement_not_pending", "The job is not waiting for that measurement (it timed out, or the request_id is wrong)."),
    }
}

/* ---------------- the job ---------------- */

enum End {
    Done(Box<Cand>),
    Failed(Fail),
    /// The client closed the stream: nobody to tell.
    Gone,
}

async fn run(ctx: Arc<Ctx>, id: String, engine: tnc_engine::Engine) {
    ctx.emit(
        "job",
        json!({
            "id": id, "model": ctx.model.id, "max_rounds": policy::MAX_REFINEMENT_ROUNDS,
            "reasoning": ctx.model.reasoning, "client_measure": ctx.client_measure,
        }),
    )
    .await;
    let mut cancelled = ctx.handle.cancel.subscribe();
    let end = tokio::select! {
        e = drive(&ctx, &engine) => e,
        _ = async { let _ = cancelled.wait_for(|c| *c).await; } => End::Failed(Fail::new("cancelled", "Generation cancelled. Nothing was loaded.", false)),
        _ = ctx.out.closed() => End::Gone,
        _ = tokio::time::sleep(ctx.st.cfg.ai_job_timeout()) => End::Failed(Fail::new("timeout", format!("The generation took longer than {} s and was stopped.", ctx.st.cfg.ai_job_timeout().as_secs()), true)),
    };
    // from here on the upstream connection (owned by `drive`) is closed and no request can follow
    ctx.st.ai_jobs.remove(&id);
    match end {
        End::Gone => {}
        End::Done(c) => {
            ctx.emit("stage", json!({ "stage": "completion", "round": c.round, "max_rounds": policy::MAX_REFINEMENT_ROUNDS })).await;
            ctx.emit(
                "done",
                json!({
                    "program": c.program, "round": c.round, "accepted": true,
                    "validation": c.validation, "measurement": c.measurement, "usage": ctx.usage(), "model": ctx.model.id,
                }),
            )
            .await;
        }
        End::Failed(f) => {
            ctx.emit("error", json!({ "code": f.code, "message": f.message, "retryable": f.retryable, "draft": ctx.draft(), "usage": ctx.usage() })).await;
        }
    }
}

async fn drive(ctx: &Ctx, engine: &tnc_engine::Engine) -> End {
    let max = policy::MAX_REFINEMENT_ROUNDS;
    let total = max + 1;
    let mut hist: Vec<(u32, String)> = vec![];
    let mut spec: Option<Value> = None;
    // what goes back to the model next round: (assistant turn, user turn)
    let mut back: Option<(String, String)> = None;

    for round in 0..=max {
        let stage = if round == 0 { "generation" } else { "refinement" };
        ctx.emit("stage", json!({ "stage": stage, "round": round, "max_rounds": max })).await;
        let mut messages = vec![json!({ "role": "system", "content": ctx.system }), json!({ "role": "user", "content": ctx.ask })];
        if let Some((assistant, user)) = &back {
            messages.push(json!({ "role": "assistant", "content": assistant }));
            messages.push(json!({ "role": "user", "content": user }));
        }
        let answer = match call(ctx, round, &messages).await {
            Ok(a) => a,
            Err(f) => return End::Failed(f),
        };

        let program = extract::program(&answer.text);
        if ctx.client_measure {
            if let Some(s) = extract::part_spec(&answer.text, policy::MAX_SPEC_BYTES) {
                spec = Some(s);
            }
        }

        if answer.truncated {
            // never accepted: the normalizer closes a cut-off program, which can make it look complete
            let cap = answer.cap;
            let what = if program.is_some() { "The answer was cut off at the output limit" } else { "The output limit ran out before a program was written" };
            ctx.status("truncated", format!("{what} ({cap} tokens).")).await;
            if let Some(p) = &program {
                let cand = Cand {
                    program: p.clone(),
                    round,
                    validation: Validation::failed("THE ANSWER WAS CUT OFF AT THE OUTPUT LIMIT: the program is incomplete"),
                    measurement: Measurement { native: None, client: None },
                    truncated: true,
                    spec: spec.clone(),
                };
                keep_best(ctx, cand);
            }
            if round == max || !policy::AUTO_REPAIR {
                return End::Failed(Fail::new(
                    "truncated",
                    format!("The model's answer was cut off at the output limit ({cap} tokens) and the repair rounds are used up. Ask for a simpler part or pick a model with a larger output limit."),
                    true,
                ));
            }
            hist.push((round, "cut off at the output limit".into()));
            let assistant: String = answer.text.chars().take(4000).collect();
            let user = format!(
                "ROUND {} of {total}. Your answer was cut off at the output limit of {cap} tokens{}. Write the COMPLETE program again, shorter: \
                 use loops (LBL / CALL LBL REP, Q parameters) instead of long lists of blocks, few comments, less reasoning. One ```klartext fence, nothing else.",
                round + 1,
                if answer.reasoned { " (reasoning counts against it)" } else { "" }
            );
            back = Some((if assistant.trim().is_empty() { "(no visible answer)".into() } else { assistant }, user));
            continue;
        }

        ctx.emit("stage", json!({ "stage": "validation", "round": round, "max_rounds": max })).await;
        let (validation, native) = validate(ctx, engine, program.as_deref()).await;
        ctx.status("validated", format!("Check: {}", validation.summary)).await;

        ctx.emit("stage", json!({ "stage": "measurement", "round": round, "max_rounds": max })).await;
        let mut measurement = Measurement { native, client: None };
        if let (Some(p), true, true) = (&program, ctx.client_measure, validation.errors.is_empty()) {
            measurement.client = ask_client(ctx, round, p, spec.as_ref()).await;
        }
        match (&measurement.client, &measurement.native) {
            (Some(c), _) => ctx.status("measured", match c.score {
                Some(s) => format!("Measured: {s:.1} % match."),
                None => "Measured by the simulator.".into(),
            }).await,
            (None, Some(n)) => ctx.status("measured", format!("Measured: about {:.0} mm³ removed, cycle time {:.0} s.", n.removed_volume_mm3, n.cycle_time_s)).await,
            (None, None) => ctx.status("measured", "Nothing to measure: the program did not run.").await,
        }

        let cand = program.map(|p| Cand { program: p, round, validation: validation.clone(), measurement: measurement.clone(), truncated: false, spec: spec.clone() });
        hist.push((round, validation.summary.clone() + &cand.as_ref().and_then(Cand::score).map(|s| format!(", {s:.1} % match")).unwrap_or_default()));
        if let Some(c) = &cand {
            keep_best(ctx, c.clone());
            if c.accepted() {
                return End::Done(Box::new(c.clone()));
            }
        }
        if round == max || !policy::AUTO_REPAIR {
            break;
        }
        let best = ctx.shared.lock().unwrap().best.clone().filter(|b| !b.truncated);
        back = Some(match best {
            Some(b) => {
                let spec_text = b.spec.as_ref().map(|s| format!("```partspec\n{s}\n```\n")).unwrap_or_default();
                (format!("{spec_text}```klartext\n{}\n```", b.program), feedback(&b, cand.as_ref(), &hist, round + 1, total))
            }
            None => (
                { let t: String = answer.text.chars().take(4000).collect(); if t.trim().is_empty() { "(no visible answer)".into() } else { t } },
                format!("ROUND {} of {total}. Your answer contained no program. Reply with the complete program in one ```klartext fence, nothing else.", round + 1),
            ),
        });
    }

    let best = ctx.shared.lock().unwrap().best.clone();
    End::Failed(match best {
        Some(b) => Fail::new(
            "validation_failed",
            format!("The program still fails the check after {} repair round(s): {}. The draft is kept; nothing was loaded. Change the request or try another model.", max, short(&failure_line(&b), 200)),
            true,
        ),
        None => Fail::new("no_program", format!("The model returned no program in {total} answers. Rephrase the request or try another model."), true),
    })
}

fn short(s: &str, n: usize) -> String {
    let mut out: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        out.push('…');
    }
    out
}

fn failure_line(c: &Cand) -> String {
    if !c.validation.ok {
        return c.validation.summary.clone();
    }
    match &c.measurement.client {
        Some(m) => match m.score {
            Some(s) => format!("the cut matches the intended part to {s:.1} % (goal {:.0} %)", policy::MEASURE_GOAL),
            None => "the measurement did not pass".into(),
        },
        None => "it was not accepted".into(),
    }
}

fn keep_best(ctx: &Ctx, cand: Cand) {
    let mut s = ctx.shared.lock().unwrap();
    s.partial = None;
    if s.best.as_ref().is_none_or(|b| cand.rank() >= b.rank()) {
        s.best = Some(cand); // ties: the newer one
    }
}

/* ---------------- upstream ---------------- */

struct Answer {
    text: String,
    truncated: bool,
    reasoned: bool,
    cap: u64,
}

fn upstream_message(body: &[u8]) -> String {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let m = v.get("error").and_then(|e| e.get("message").or(Some(e))).and_then(Value::as_str).unwrap_or("");
    short(&m.chars().filter(|c| !c.is_control()).collect::<String>(), 200)
}

async fn call(ctx: &Ctx, round: u32, messages: &[Value]) -> Result<Answer, Fail> {
    let st = &ctx.st;
    // the budget is checked before every billable request
    match crate::ai::spent(st, &ctx.user).await {
        Ok((cost, _)) if cost >= st.cfg.ai_monthly_budget_usd => {
            return Err(Fail::new("budget_exceeded", format!("Monthly AI budget used up (US${cost:.2} of US${:.2}). It resets on the 1st.", st.cfg.ai_monthly_budget_usd), false));
        }
        Ok(_) => {}
        Err(_) => return Err(Fail::new("internal", "The AI usage record could not be read.", true)),
    }

    let prompt_chars: usize = messages.iter().map(|m| m["content"].as_str().map_or(0, str::len)).sum();
    let available = policy::available_context(ctx.model.context_length, prompt_chars);
    let mut cap = policy::effective_output_cap(policy::REQUESTED_OUTPUT_CEILING, ctx.model.max_completion_tokens, available);
    if st.cfg.ai_max_tokens > 0 {
        cap = cap.min(st.cfg.ai_max_tokens);
    }
    if cap < policy::MIN_OUTPUT_TOKENS {
        return Err(Fail::new("prompt_too_long", format!("The request leaves only {cap} tokens for the answer in this model's context window. Shorten the request or pick a model with a larger context."), false));
    }
    let mut body = json!({ "model": ctx.model.id, "messages": messages, "stream": true, "usage": { "include": true } });
    if let Some(p) = ctx.model.output.parameter {
        body[p] = json!(cap);
    }
    if let Some(r) = &ctx.model.reasoning.sent {
        body["reasoning"] = r.clone();
    }
    if ctx.model.supported_parameters.iter().any(|p| p == "temperature") {
        body["temperature"] = json!(0.2);
    }
    let referer = st.cfg.public_url.clone().unwrap_or_else(|| "https://gigacook.github.io/tnc426-simulator/".into());

    let mut retries = 0;
    let res = loop {
        ctx.shared.lock().unwrap().usage.requests += 1;
        let sent = st
            .http
            .post(format!("{}/chat/completions", st.cfg.openrouter_base))
            .bearer_auth(&ctx.key)
            .header("HTTP-Referer", &referer)
            .header("X-Title", "TNC 426 Simulator")
            .json(&body)
            .send()
            .await;
        // retried: only what failed before an answer was committed
        let transient = match sent {
            Ok(res) if res.status().is_success() => break res,
            Ok(res) => {
                let status = res.status().as_u16();
                let bytes = res.bytes().await.unwrap_or_default();
                let msg = upstream_message(&bytes[..bytes.len().min(8192)]);
                let detail = if msg.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {msg}") };
                crate::ai::record_usage(st, &ctx.user, &ctx.model.id, None, None, 0.0, status).await;
                match status {
                    401 | 403 => return Err(Fail::new("key_rejected", format!("OpenRouter refused the key ({detail}). Set a valid OpenRouter key."), false)),
                    402 => return Err(Fail::new("provider_credit", format!("OpenRouter reports too little credit ({detail}). Add credit at OpenRouter or use another key."), false)),
                    429 | 500..=599 => detail,
                    _ => return Err(Fail::new("upstream_rejected", format!("OpenRouter refused the request ({detail}). Pick another model or change the request."), false)),
                }
            }
            Err(e) if e.is_connect() => "could not connect to OpenRouter".to_owned(),
            Err(e) if e.is_timeout() => return Err(Fail::new("timeout", "OpenRouter did not answer in time. Nothing was retried, because the request may have been billed; try again.", true)),
            Err(_) => return Err(Fail::new("upstream_error", "The connection to OpenRouter failed while sending the request. Nothing was retried; try again.", true)),
        };
        if retries >= policy::MAX_TRANSIENT_RETRIES {
            return Err(Fail::new("upstream_unavailable", format!("The provider is not available ({transient}) after {retries} retry. Try again later or pick another model."), true));
        }
        retries += 1;
        let wait = st.cfg.ai_retry_delay();
        ctx.status("retry", format!("Provider not available ({transient}). Retry {retries} of {} in {:.1} s.", policy::MAX_TRANSIENT_RETRIES, wait.as_secs_f64())).await;
        tokio::time::sleep(wait).await;
    };

    // the answer is committed (HTTP 200): from here nothing is retried
    let idle = st.cfg.ai_idle_timeout();
    let mut stream = res.bytes_stream();
    let mut parser = sse::Parser::default();
    let mut program = extract::ProgramStream::default();
    let (mut text, mut finish, mut reasoned, mut waiting) = (String::new(), None::<String>, false, false);
    let (mut prompt_tokens, mut completion_tokens, mut cost) = (None::<i64>, None::<i64>, 0.0f64);
    let mut failure: Option<Fail> = None;
    let mut done = false;
    while !done && failure.is_none() {
        let items = match tokio::time::timeout(idle, stream.next()).await {
            Err(_) => {
                failure = Some(Fail::new("timeout", format!("The provider sent nothing for {} s and the request was stopped. Nothing was retried; try again.", idle.as_secs()), true));
                break;
            }
            Ok(None) => {
                done = true;
                parser.finish()
            }
            Ok(Some(Err(_))) => {
                failure = Some(Fail::new("upstream_error", "The connection to the provider broke off in the middle of the answer. Nothing was retried; try again.", true));
                break;
            }
            Ok(Some(Ok(bytes))) => parser.feed(&bytes),
        };
        for item in items {
            let data = match item {
                sse::Item::Comment(_) => {
                    // keepalive: the provider is working but has nothing to say yet
                    if !waiting && text.is_empty() {
                        waiting = true;
                        ctx.status("waiting", "The provider is working on the answer.").await;
                    }
                    continue;
                }
                sse::Item::Data(d) => d,
            };
            if data.trim() == "[DONE]" {
                done = true;
                break;
            }
            let Ok(v) = serde_json::from_str::<Value>(&data) else { continue };
            if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
                prompt_tokens = u.get("prompt_tokens").and_then(Value::as_i64).or(prompt_tokens);
                completion_tokens = u.get("completion_tokens").and_then(Value::as_i64).or(completion_tokens);
                cost = u.get("cost").and_then(Value::as_f64).filter(|c| c.is_finite() && *c >= 0.0).unwrap_or(cost);
            }
            if let Some(e) = v.get("error").filter(|e| !e.is_null()) {
                let code = e.get("code").map(|c| c.to_string().trim_matches('"').to_owned()).unwrap_or_default();
                let msg = short(&e.get("message").and_then(Value::as_str).unwrap_or("provider error").chars().filter(|c| !c.is_control()).collect::<String>(), 200);
                failure = Some(Fail::new("upstream_error", format!("The provider failed in the middle of the answer ({code}: {msg}). Nothing was retried; try again."), true));
                break;
            }
            let choice = v.get("choices").and_then(|c| c.get(0));
            if let Some(delta) = choice.and_then(|c| c.get("delta")) {
                let thinks = delta.get("reasoning").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
                    || delta.get("reasoning_details").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
                if thinks && !reasoned {
                    reasoned = true;
                    ctx.status("reasoning", "The model is reasoning.").await;
                }
                if let Some(c) = delta.get("content").and_then(Value::as_str).filter(|c| !c.is_empty()) {
                    text.push_str(c);
                    let shown = program.push(c);
                    if !shown.is_empty() {
                        ctx.emit("delta", json!({ "round": round, "text": shown })).await;
                    }
                    ctx.shared.lock().unwrap().partial = Some((round, text.clone()));
                }
            }
            match choice.and_then(|c| c.get("finish_reason")).and_then(Value::as_str) {
                Some("error") => {
                    failure = Some(Fail::new("upstream_error", "The provider ended the answer with an error. Nothing was retried; try again.", true));
                    break;
                }
                Some("content_filter") => {
                    failure = Some(Fail::new("content_filter", "The provider's content filter stopped the answer. Rephrase the request.", false));
                    break;
                }
                Some(f) => finish = Some(f.to_owned()),
                None => {}
            }
        }
    }
    drop(stream);
    {
        let mut s = ctx.shared.lock().unwrap();
        s.usage.prompt_tokens += prompt_tokens.unwrap_or(0);
        s.usage.completion_tokens += completion_tokens.unwrap_or(0);
        s.usage.cost_usd += cost;
    }
    crate::ai::record_usage(st, &ctx.user, &ctx.model.id, prompt_tokens, completion_tokens, cost, if failure.is_some() { 502 } else { 200 }).await;
    if let Some(f) = failure {
        return Err(f);
    }
    if finish.is_none() {
        return Err(Fail::new("upstream_error", "The provider's answer ended without a finish mark, so it may be incomplete. Nothing was retried; try again.", true));
    }
    Ok(Answer { text, truncated: finish.as_deref() == Some("length"), reasoned, cap })
}

/* ---------------- validation and measurement ---------------- */

async fn validate(ctx: &Ctx, engine: &tnc_engine::Engine, program: Option<&str>) -> (Validation, Option<NativeMeasure>) {
    let Some(src) = program else {
        return (Validation::failed("NO PROGRAM IN THE ANSWER"), None);
    };
    let r = match engine.check(src.to_owned(), ctx.opts.clone()).await {
        Ok(r) => r,
        Err(e) => return (Validation::failed(format!("THE PROGRAM COULD NOT BE CHECKED: {e}")), None),
    };
    let lines: Vec<&str> = src.split('\n').collect();
    let raw = |line: u32| lines.get((line as usize).wrapping_sub(1)).map(|l| l.trim().to_owned()).unwrap_or_default();
    let mut errors: Vec<Finding> = r.errors.iter().map(|e| Finding { line: e.line, block: e.block, message: e.msg.clone(), raw: e.raw.trim().to_owned() }).collect();
    let find = |sev: &str| r.events.iter().filter(|e| e.sev == sev).map(|e| Finding { line: e.line, block: e.block, message: e.msg.clone(), raw: raw(e.line) }).collect::<Vec<_>>();
    let (crashes, warnings) = (find("crash"), find("warn"));
    if errors.is_empty() && r.stats.path_feed > 0.0 && r.stats.removed_volume <= 0.0 {
        let b = r.stock.as_ref().map(|s| format!(" (X{}..{} Y{}..{} Z{}..{})", s.x0, s.x1, s.y0, s.y1, s.z0, s.z1)).unwrap_or_default();
        errors.push(Finding { line: 0, block: None, message: format!("THE PROGRAM REMOVES NO MATERIAL: no cutting move goes below the top of the blank{b}."), raw: String::new() });
    }
    let mut v = Validation { ok: errors.is_empty() && crashes.is_empty(), errors, crashes, warnings, blocks: r.blocks, summary: String::new() };
    v.summary = v.summarize();
    let native = r.errors.is_empty().then_some(NativeMeasure {
        removed_volume_mm3: r.stats.removed_volume,
        cycle_time_s: r.stats.cycle_time,
        path_feed_mm: r.stats.path_feed,
        min_z: r.stats.min_z,
        max_z: r.stats.max_z,
        tools_used: r.stats.tools_used.len(),
    });
    (v, native)
}

/// Sends `measure-request` and waits for the client's POST, at most the measurement timeout.
async fn ask_client(ctx: &Ctx, round: u32, program: &str, spec: Option<&Value>) -> Option<ClientMeasure> {
    let request_id = util::new_id();
    let (tx, rx) = oneshot::channel();
    *ctx.handle.pending.lock().unwrap() = Some(Pending { request_id: request_id.clone(), reply: tx });
    let wait = ctx.st.cfg.ai_measure_timeout();
    ctx.emit("measure-request", json!({ "request_id": request_id, "round": round, "program": program, "spec": spec, "timeout_ms": wait.as_millis() as u64 })).await;
    let got = tokio::time::timeout(wait, rx).await;
    ctx.handle.pending.lock().unwrap().take();
    match got {
        Ok(Ok(m)) => Some(m),
        _ => {
            ctx.status("measurement_timeout", format!("No measurement arrived in {:.0} s; continuing with the interpreter's check only.", wait.as_secs_f64())).await;
            None
        }
    }
}

/* ---------------- what the model is told ---------------- */

/// As HINTS in sim/ai.js: the fix that goes with a kind of finding.
const HINTS: &[(&[&str], &str)] = &[
    (&["RAPID TRAVERSE INTO MATERIAL"], "FMAX only at Z+2 or higher over the part (or beside it); go down and cut with a feed F."),
    (&["SPINDLE STOPPED"], "Every TOOL CALL stops the spindle: put M3 on the first move after it."),
    (&["HOLDER"], "Deeper than this tool reaches: use a longer tool from the table or cut less deep."),
    (&["VICE"], "The vice holds the Y- and Y+ faces up to 6 mm above the blank bottom: stay higher, leave a base."),
    (&["RADIUS TOO LARGE", "TOOL RADIUS"], "An inside corner or arc is smaller than the tool radius: use a smaller tool, a bigger radius, or R0 with your own offset."),
    (&["REMOVES NO MATERIAL", "CUTS AIR", "REMOVES MATERIAL"], "Milling removes material: the cuts belong inside the blank, below Z+0. Rebuild the shape by cutting away what is around it."),
    (&["CHIP LOAD"], "Lower F to the suggested value (or raise S)."),
    (&["LIMIT SWITCH"], "A rotary axis is out of its range."),
    (&["LABEL", "LBL"], "Every CALL LBL / GOTO LBL needs its LBL; subprograms go after M30 and end with LBL 0."),
    (&["FORMAT", "INCORRECT", "UNKNOWN", "NOT ALLOWED", "SYNTAX", "INVALID", "ENTRY"], "Not valid for this control: rewrite this line with the syntax from the system prompt only."),
    (&["NO PROGRAM"], "Reply with the complete program in one ```klartext fence."),
];

fn hint(msg: &str) -> Option<&'static str> {
    HINTS.iter().find(|(needles, _)| needles.iter().any(|n| msg.contains(n))).map(|(_, h)| *h)
}

fn listing(title: &str, items: &[Finding], max: usize) -> String {
    if items.is_empty() {
        return String::new();
    }
    let mut out = format!("{title} ({})\n", items.len());
    let mut seen: Vec<&str> = vec![];
    for (i, f) in items.iter().take(max).enumerate() {
        let q = f.quoted();
        out += &format!("{}. {q}\n", i + 1);
        if let Some(h) = hint(&q).filter(|h| !seen.contains(h)) {
            seen.push(h);
            out += &format!("   -> {h}\n");
        }
    }
    if items.len() > max {
        out += &format!("   ... and {} more of the same kinds\n", items.len() - max);
    }
    out + "\n"
}

/// The report that goes back with the best program so far (as `feedback` in sim/ai.js).
fn feedback(base: &Cand, last: Option<&Cand>, hist: &[(u32, String)], round: u32, total: u32) -> String {
    let v = &base.validation;
    let mut s = format!("ROUND {} of {total}. The simulator machined your program and found:\n\n", round + 1);
    s += &listing("ERRORS — the program is rejected until these are gone", &v.errors, 15);
    s += &listing("CRASHES", &v.crashes, 15);
    s += &listing("WARNINGS — fix if easy", &v.warnings, 6);
    if let Some(l) = last.filter(|l| l.round != base.round) {
        s += &format!("Your newest version (round {}) was worse ({}); the program above is your best one so far (round {}): continue from it.\n\n", l.round + 1, l.validation.summary, base.round + 1);
    }
    if hist.len() > 1 {
        let h: Vec<String> = hist.iter().map(|(r, sum)| format!("round {} {sum}", r + 1)).collect();
        s += &format!("Earlier rounds: {}. Do not bring back problems you fixed.\n\n", h.join(" | "));
    }
    if let Some(m) = &base.measurement.client {
        if let Some(t) = m.text.as_deref().filter(|t| !t.trim().is_empty()) {
            s += &format!("{t}\n\nChange the program so the cut matches the intended part: cut what is NOT CUT, stop cutting where it SHOULD NOT.\n\n");
        } else if let Some(score) = m.score {
            s += &format!("The cut matches the intended part to {score:.1} %; the goal is {:.0} %.\n\n", policy::MEASURE_GOAL);
        }
    }
    s + "Fix the cause of every item, keep what already works, and return the COMPLETE corrected program in one ```klartext fence."
}

/// The system prompt used when the client sends none: the output format, the essentials of the
/// dialect and the tool table. The simulator's own prompt (`TNC_AI.system` in sim/ai.js) is longer and
/// is what the dialog should send.
fn default_system(tools: &[Tool]) -> String {
    let table: Vec<String> = tools.iter().map(|t| format!("T{} {} — Ø{} (R{}), length {}", t.t, t.name, t.r * 2.0, t.r, t.l)).collect();
    format!(
        "You write HEIDENHAIN TNC 426 / TNC 430 conversational (Klartext) programs for a simulator that machines them on a virtual blank \
and checks every block. Units: mm.\n\n\
OUTPUT FORMAT\n\
- Reply with ONLY the complete program inside a single ```klartext fenced block.\n\
- No block numbers. One block per line. Upper case. A comment starts with ; and runs to the end of the line.\n\
- Line 1: BEGIN PGM <NAME> MM. Last line: END PGM <NAME> MM (same name; A-Z, 0-9, _; 16 characters at most).\n\
- Lines 2-3: BLK FORM 0.1 Z X+0 Y+0 Z-20 (MIN corner) and BLK FORM 0.2 X+100 Y+80 Z+0 (MAX corner). Top face Z+0.\n\n\
RULES\n\
- Milling only removes material: every cutting move is inside the blank, below Z+0.\n\
- TOOL CALL 5 Z S3000 selects a tool and stops the spindle: the next block carries M3, e.g. L Z+50 R0 FMAX M3.\n\
- L X+10 Y+20 Z-3 R0 F500 is a line; FMAX is rapid for that block only. Never FMAX into uncut stock: rapid over the part only at Z+2 or higher, then feed down.\n\
- Arcs: CC X.. Y.. then C X.. Y.. DR+/DR-; CR X.. Y.. R.. DR+/DR-. Loops: LBL n / CALL LBL n REP r, Q parameters (FN 0: Q1 = +5).\n\
- Drilling: CYCL DEF 200 with its Q lines, called with M99 on a positioning block.\n\
- End with M30 on its own line. Never use FK, INCH, TOOL DEF, PLANE, M128.\n\n\
TOOL TABLE — these tools and nothing else\n{}\n\n\
ERRORS\n\
If you get an error report from the simulator, fix the cause of every item, keep what already works, and return the COMPLETE corrected program in the same format.",
        table.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finding(block: i64, raw: &str, message: &str) -> Finding {
        Finding { line: block as u32 + 1, block: Some(block), message: message.into(), raw: raw.into() }
    }

    fn cand(round: u32, errors: Vec<Finding>, crashes: Vec<Finding>) -> Cand {
        let mut v = Validation { ok: errors.is_empty() && crashes.is_empty(), errors, crashes, warnings: vec![], blocks: 9, summary: String::new() };
        v.summary = v.summarize();
        Cand { program: "BEGIN PGM A MM\nEND PGM A MM".into(), round, validation: v, measurement: Measurement { native: None, client: None }, truncated: false, spec: None }
    }

    #[test]
    fn feedback_quotes_the_block_and_gives_one_hint_per_kind() {
        let c = cand(0, vec![], vec![finding(6, "L Z-2 R0 FMAX", "RAPID TRAVERSE INTO MATERIAL"), finding(7, "L X+80 R0 FMAX", "RAPID TRAVERSE INTO MATERIAL")]);
        let f = feedback(&c, Some(&c), &[(0, c.validation.summary.clone())], 1, 6);
        assert!(f.starts_with("ROUND 2 of 6."), "{f}");
        assert!(f.contains("1. BLOCK 6 `L Z-2 R0 FMAX`: RAPID TRAVERSE INTO MATERIAL"), "{f}");
        assert_eq!(f.matches("-> FMAX only at Z+2").count(), 1, "{f}");
        assert!(f.ends_with("in one ```klartext fence."));
        assert!(!f.contains("was worse"));
    }

    #[test]
    fn feedback_says_when_the_newest_round_was_worse_and_carries_the_measurement() {
        let mut best = cand(0, vec![], vec![]);
        best.measurement.client = Some(ClientMeasure { request_id: "r".into(), score: Some(61.5), pass: None, text: Some("S1 SLOT: NOT CUT from X50 to X80".into()) });
        let worse = cand(1, vec![finding(3, "L FOO", "SYNTAX ERROR")], vec![]);
        let f = feedback(&best, Some(&worse), &[(0, "passed, 61.5 % match".into()), (1, worse.validation.summary.clone())], 2, 6);
        assert!(f.contains("Your newest version (round 2) was worse"), "{f}");
        assert!(f.contains("Earlier rounds: round 1 passed, 61.5 % match | round 2 1 error(s)"), "{f}");
        assert!(f.contains("NOT CUT from X50 to X80"), "{f}");
    }

    #[test]
    fn acceptance_and_ranking() {
        let clean = cand(0, vec![], vec![]);
        assert!(clean.accepted());
        let mut low = clean.clone();
        low.measurement.client = Some(ClientMeasure { request_id: "r".into(), score: Some(80.0), pass: None, text: None });
        assert!(!low.accepted());
        let mut high = clean.clone();
        high.measurement.client = Some(ClientMeasure { request_id: "r".into(), score: Some(95.0), pass: None, text: None });
        assert!(high.accepted());
        let mut says_no = high.clone();
        says_no.measurement.client.as_mut().unwrap().pass = Some(false);
        assert!(!says_no.accepted());
        let mut cut = clean.clone();
        cut.truncated = true;
        assert!(!cut.accepted());
        let broken = cand(1, vec![finding(1, "L FOO", "SYNTAX ERROR")], vec![]);
        assert!(!broken.accepted());
        assert!(high.rank() > low.rank() && low.rank() > broken.rank() && broken.rank() > cut.rank());
    }

    #[test]
    fn default_system_lists_the_tools() {
        let s = default_system(&[Tool { t: 5, name: "ENDMILL_12".into(), l: 120.0, r: 6.0 }]);
        assert!(s.contains("T5 ENDMILL_12 — Ø12 (R6), length 120"), "{s}");
        assert!(s.contains("```klartext"));
    }

    #[test]
    fn the_measurement_body_is_strict() {
        assert!(serde_json::from_str::<ClientMeasure>(r#"{"request_id":"a","score":97.5,"text":"ok"}"#).is_ok());
        assert!(serde_json::from_str::<ClientMeasure>(r#"{"score":97.5}"#).is_err());
        assert!(serde_json::from_str::<ClientMeasure>(r#"{"request_id":"a","program":"x"}"#).is_err());
        let m: ClientMeasure = serde_json::from_str(r#"{"request_id":"a","pass":true}"#).unwrap();
        assert!(!serde_json::to_string(&m).unwrap().contains("request_id"));
    }
}
