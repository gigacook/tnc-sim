//! The model catalog: OpenRouter's `GET /models`, checked and reduced to what the generation dialog
//! and the generation job need. No price, context length or output limit is written in this code.
//!
//! Field meanings follow OpenRouter's models API reference (read 2026-11-18):
//! `id` is the routable identifier; `pricing.prompt` / `pricing.completion` are US$ per token as
//! strings; `top_provider.max_completion_tokens` is a ceiling for `max_tokens`; `supported_parameters`
//! lists the request parameters that work with the model; `endpoints` lists the request API paths that
//! serve it; the optional `reasoning` object describes effort selection.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};

use super::policy;
use crate::state::AppState;

/// The request path the generation job uses. A model whose `endpoints` lacks it cannot generate live.
pub const CHAT_ENDPOINT: &str = "/api/v1/chat/completions";
const MAX_MODELS: usize = 5000;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Pricing {
    /// US$ per input token, exactly the string OpenRouter sent.
    pub prompt: String,
    /// US$ per output token, exactly the string OpenRouter sent.
    pub completion: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Supports {
    pub reasoning: bool,
    pub tools: bool,
    /// Every model served by the chat-completions path streams (OpenRouter's streaming guide covers
    /// the path as a whole; there is no per-model streaming flag in the catalog).
    pub streaming: bool,
}

/// What the generation job does about reasoning for this model.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ReasoningPlan {
    /// The policy value.
    pub requested: &'static str,
    /// The `reasoning` request parameter the job sends, or null when it sends none.
    pub sent: Option<Value>,
    /// One of: "medium", "nearest-supported", "model-default", "none".
    pub effective: &'static str,
    pub note: String,
}

/// What the generation job does about the answer length for this model.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OutputPlan {
    pub requested: u64,
    /// min(requested, provider cap, context length): the cap before a prompt is subtracted.
    pub effective_cap: u64,
    /// The request parameter that carries the cap, or null when the model documents neither.
    pub parameter: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Model {
    /// Routable identifier, verbatim. Send this back as `model`; never the label.
    pub id: String,
    /// Short display name derived from `name`. Display only.
    pub label: String,
    /// OpenRouter's full display name.
    pub name: String,
    pub provider: String,
    pub context_length: Option<u64>,
    /// The provider's output cap (`top_provider.max_completion_tokens`), null when not given.
    pub max_completion_tokens: Option<u64>,
    pub pricing: Pricing,
    /// "$0.05 / $0.20 per 1M tokens", derived from `pricing`; null when a price is not a plain amount.
    pub price_per_million: Option<String>,
    pub supported_parameters: Vec<String>,
    pub supports: Supports,
    pub reasoning: ReasoningPlan,
    pub output: OutputPlan,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Excluded {
    /// Not usable for live generation: no chat-completions endpoint (batch / async-only), a batch
    /// variant id, or no text output.
    pub not_live: usize,
    /// Entries that did not have the documented shape.
    pub invalid: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    pub models: Vec<Model>,
    pub excluded: Excluded,
}

fn uint(v: Option<&Value>) -> Result<Option<u64>, ()> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => match n.as_u64() {
            Some(u) => Ok(Some(u)),
            None => match n.as_f64() {
                Some(f) if f.is_finite() && f >= 0.0 && f.fract() == 0.0 && f < 1e15 => Ok(Some(f as u64)),
                _ => Err(()),
            },
        },
        _ => Err(()),
    }
}

fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"/._:-~@".contains(&b))
}

fn price_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_digit() || b".-+eE".contains(&b))
}

/// "Anthropic: Claude Opus 5.5" -> "Claude Opus 5.5"; without a usable name, the id after the slash.
pub fn label(id: &str, name: &str) -> String {
    let name = name.trim();
    let short = match name.split_once(": ") {
        Some((provider, rest)) if provider.len() < 30 && !rest.trim().is_empty() => rest.trim(),
        _ => name,
    };
    let short = if short.is_empty() { id.rsplit('/').next().unwrap_or(id) } else { short };
    let mut out: String = short.chars().take(40).collect();
    if short.chars().count() > 40 {
        out.pop();
        out.push('…');
    }
    out
}

/// A US$-per-token string as US$ per million tokens, by moving the decimal point (no floating point):
/// "0.00000005" -> "$0.05", "0.00000020" -> "$0.20", "0.0000025" -> "$2.50", "0.0000000507" -> "$0.0507".
/// None for anything that is not a plain non-negative decimal (a variable price, an exponent).
pub fn per_million(per_token: &str) -> Option<String> {
    let s = per_token.trim();
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    if (int.is_empty() && frac.is_empty()) || !int.bytes().chain(frac.bytes()).all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut frac = frac.to_owned();
    while frac.len() < 6 {
        frac.push('0');
    }
    let whole = format!("{int}{}", &frac[..6]);
    let whole = whole.trim_start_matches('0');
    let mut rest = frac[6..].trim_end_matches('0').to_owned();
    while rest.len() < 2 {
        rest.push('0');
    }
    Some(format!("${}.{rest}", if whole.is_empty() { "0" } else { whole }))
}

/// "$0.05 / $0.20 per 1M tokens" (input / output).
pub fn price_text(prompt: &str, completion: &str) -> Option<String> {
    Some(format!("{} / {} per 1M tokens", per_million(prompt)?, per_million(completion)?))
}

fn reasoning_plan(params: &[String], info: Option<&Value>) -> ReasoningPlan {
    let requested = policy::REASONING_EFFORT;
    if !params.iter().any(|p| p == "reasoning") {
        let own = info.is_some_and(Value::is_object);
        return ReasoningPlan {
            requested,
            sent: None,
            effective: if own { "model-default" } else { "none" },
            note: if own {
                "The model reasons on its own settings; it does not accept an effort, so none is sent.".into()
            } else {
                "The model has no reasoning parameter; none is sent.".into()
            },
        };
    }
    let sent = Some(json!({ "effort": requested }));
    let efforts: Option<Vec<&str>> = info.and_then(|r| r.get("supported_efforts")).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect());
    match efforts {
        Some(list) if !list.contains(&requested) => ReasoningPlan {
            requested,
            sent,
            effective: "nearest-supported",
            note: format!("The model supports the efforts {}; OpenRouter maps medium to the nearest one.", list.join(", ")),
        },
        _ => ReasoningPlan { requested, sent, effective: "medium", note: "Reasoning effort medium is sent.".into() },
    }
}

fn reduce_one(m: &Value) -> Result<Option<Model>, ()> {
    let id = m.get("id").and_then(Value::as_str).filter(|s| id_ok(s)).ok_or(())?;
    let pricing = m.get("pricing").filter(|p| p.is_object()).ok_or(())?;
    let prompt = pricing.get("prompt").and_then(Value::as_str).filter(|s| price_ok(s)).ok_or(())?;
    let completion = pricing.get("completion").and_then(Value::as_str).filter(|s| price_ok(s)).ok_or(())?;
    let params: Vec<String> =
        m.get("supported_parameters").and_then(Value::as_array).ok_or(())?.iter().filter_map(Value::as_str).filter(|s| s.len() <= 64).map(str::to_owned).collect();
    let top = m.get("top_provider").filter(|t| t.is_object());
    let context_length = match uint(m.get("context_length"))? {
        Some(c) => Some(c),
        None => uint(top.and_then(|t| t.get("context_length")))?,
    };
    let max_completion_tokens = uint(top.and_then(|t| t.get("max_completion_tokens")))?.filter(|&n| n > 0);
    let name = m.get("name").and_then(Value::as_str).unwrap_or("");
    let name: String = name.chars().filter(|c| !c.is_control()).take(120).collect();

    // live generation needs the chat-completions path and text out; batch / async-only entries have neither
    let serves_chat = match m.get("endpoints") {
        None | Some(Value::Null) => true, // field absent: decided by the checks below
        Some(Value::Array(a)) => a.iter().any(|e| e.as_str() == Some(CHAT_ENDPOINT)),
        Some(_) => return Err(()),
    };
    let text_out = match m.get("architecture").and_then(|a| a.get("output_modalities")) {
        None | Some(Value::Null) => true,
        Some(Value::Array(a)) => a.iter().any(|e| e.as_str() == Some("text")),
        Some(_) => return Err(()),
    };
    let variant = id.rsplit_once(':').map(|(_, v)| v.to_ascii_lowercase());
    let batch_variant = variant.as_deref().is_some_and(|v| v == "batch" || v == "async");
    if !serves_chat || !text_out || batch_variant {
        return Ok(None);
    }

    let parameter = if params.iter().any(|p| p == "max_tokens") {
        Some("max_tokens")
    } else if params.iter().any(|p| p == "max_completion_tokens") {
        Some("max_completion_tokens")
    } else {
        None
    };
    Ok(Some(Model {
        id: id.to_owned(),
        label: label(id, &name),
        provider: id.split('/').next().unwrap_or("").to_owned(),
        context_length,
        max_completion_tokens,
        price_per_million: price_text(prompt, completion),
        pricing: Pricing { prompt: prompt.to_owned(), completion: completion.to_owned() },
        supports: Supports { reasoning: params.iter().any(|p| p == "reasoning"), tools: params.iter().any(|p| p == "tools"), streaming: true },
        reasoning: reasoning_plan(&params, m.get("reasoning")),
        output: OutputPlan { requested: policy::REQUESTED_OUTPUT_CEILING, effective_cap: policy::effective_output_cap(policy::REQUESTED_OUTPUT_CEILING, max_completion_tokens, context_length), parameter },
        supported_parameters: params,
        name,
    }))
}

/// Checks the upstream payload and reduces it. Err: the payload as a whole is not a model list.
pub fn reduce(payload: &Value) -> Result<Catalog, String> {
    let data = payload.get("data").and_then(Value::as_array).ok_or("the answer has no `data` list")?;
    if data.len() > MAX_MODELS {
        return Err(format!("the answer lists {} models, more than the {MAX_MODELS} accepted", data.len()));
    }
    let mut cat = Catalog { models: Vec::with_capacity(data.len()), excluded: Excluded::default() };
    for m in data {
        match reduce_one(m) {
            Ok(Some(model)) => {
                if !cat.models.iter().any(|x| x.id == model.id) {
                    cat.models.push(model);
                }
            }
            Ok(None) => cat.excluded.not_live += 1,
            Err(()) => cat.excluded.invalid += 1,
        }
    }
    if cat.models.is_empty() {
        return Err(format!("no usable model in the answer ({} entries not live, {} malformed)", cat.excluded.not_live, cat.excluded.invalid));
    }
    Ok(cat)
}

/// The reduced catalog in memory, with the time it was fetched.
#[derive(Default)]
pub struct Cache {
    slot: Mutex<Option<(Instant, Arc<Catalog>)>>,
}

pub struct Fetched {
    pub catalog: Arc<Catalog>,
    pub age_s: u64,
    /// True when OpenRouter could not be reached and an expired copy is served instead.
    pub stale: bool,
}

/// The catalog: from memory while fresh, else from OpenRouter. This request carries no program text
/// and no prompt; it sends the key only when one is set.
pub async fn get(st: &AppState) -> Result<Fetched, String> {
    let held = st.ai_catalog.slot.lock().unwrap().clone();
    if let Some((at, cat)) = &held {
        if at.elapsed() < policy::CATALOG_TTL {
            return Ok(Fetched { catalog: cat.clone(), age_s: at.elapsed().as_secs(), stale: false });
        }
    }
    match fetch(st).await {
        Ok(cat) => {
            let cat = Arc::new(cat);
            *st.ai_catalog.slot.lock().unwrap() = Some((Instant::now(), cat.clone()));
            Ok(Fetched { catalog: cat, age_s: 0, stale: false })
        }
        Err(e) => match held {
            Some((at, cat)) => Ok(Fetched { catalog: cat, age_s: at.elapsed().as_secs(), stale: true }),
            None => Err(e),
        },
    }
}

async fn fetch(st: &AppState) -> Result<Catalog, String> {
    let mut req = st.http.get(format!("{}/models", st.cfg.openrouter_base)).timeout(std::time::Duration::from_secs(30));
    if let Some(key) = st.ai_key.get() {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|_| "OpenRouter's model list could not be reached".to_owned())?;
    if !res.status().is_success() {
        return Err(format!("OpenRouter's model list answered {}", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|_| "OpenRouter's model list broke off".to_owned())?;
    if bytes.len() > 32 << 20 {
        return Err("OpenRouter's model list is larger than 32 MB".into());
    }
    let v: Value = serde_json::from_slice(&bytes).map_err(|_| "OpenRouter's model list is not JSON".to_owned())?;
    reduce(&v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> Value {
        json!({
            "id": id, "canonical_slug": id, "name": "Acme: Fast One", "created": 1,
            "context_length": 1_000_000,
            "pricing": { "prompt": "0.00000005", "completion": "0.00000020" },
            "architecture": { "modality": "text->text", "input_modalities": ["text"], "output_modalities": ["text"] },
            "top_provider": { "is_moderated": false, "context_length": 1_000_000, "max_completion_tokens": 32768 },
            "per_request_limits": null,
            "supported_parameters": ["max_tokens", "temperature", "tools", "reasoning", "include_reasoning"],
            "endpoints": ["/api/v1/chat/completions", "/api/v1/responses"],
        })
    }

    #[test]
    fn price_per_million_moves_the_decimal_point() {
        assert_eq!(per_million("0.00000005").as_deref(), Some("$0.05"));
        assert_eq!(per_million("0.00000020").as_deref(), Some("$0.20"));
        assert_eq!(price_text("0.00000005", "0.00000020").as_deref(), Some("$0.05 / $0.20 per 1M tokens"));
        assert_eq!(per_million("0.0000025").as_deref(), Some("$2.50"));
        assert_eq!(per_million("0.00001").as_deref(), Some("$10.00"));
        assert_eq!(per_million("0.0000000507").as_deref(), Some("$0.0507"));
        assert_eq!(per_million("0").as_deref(), Some("$0.00"));
        assert_eq!(per_million("1").as_deref(), Some("$1000000.00"));
        assert_eq!(per_million("-1"), None); // not a plain amount
        assert_eq!(per_million("5e-8"), None);
        assert_eq!(per_million(""), None);
        assert_eq!(per_million("."), None);
    }

    #[test]
    fn reduces_an_entry_and_keeps_strings_verbatim() {
        let cat = reduce(&json!({ "data": [entry("acme/fast-one-v2:free")] })).unwrap();
        let m = &cat.models[0];
        assert_eq!(m.id, "acme/fast-one-v2:free"); // routable id untouched
        assert_eq!(m.label, "Fast One");
        assert_eq!(m.name, "Acme: Fast One");
        assert_eq!(m.provider, "acme");
        assert_eq!(m.pricing.prompt, "0.00000005");
        assert_eq!(m.pricing.completion, "0.00000020");
        assert_eq!(m.price_per_million.as_deref(), Some("$0.05 / $0.20 per 1M tokens"));
        assert_eq!(m.context_length, Some(1_000_000));
        assert_eq!(m.max_completion_tokens, Some(32768));
        assert_eq!(m.output.effective_cap, 32768);
        assert_eq!(m.output.parameter, Some("max_tokens"));
        assert!(m.supports.reasoning && m.supports.tools && m.supports.streaming);
        assert_eq!(m.reasoning.sent, Some(json!({ "effort": "medium" })));
        assert_eq!(m.reasoning.effective, "medium");
    }

    #[test]
    fn reasoning_is_omitted_or_mapped_from_the_documented_parameters() {
        let mut plain = entry("acme/plain");
        plain["supported_parameters"] = json!(["max_completion_tokens", "temperature"]);
        let mut own = plain.clone();
        own["id"] = json!("acme/thinks-alone");
        own["reasoning"] = json!({ "mandatory": true, "default_effort": null });
        let mut limited = entry("acme/limited");
        limited["reasoning"] = json!({ "mandatory": false, "supported_efforts": ["low", "high"] });
        let cat = reduce(&json!({ "data": [plain, own, limited] })).unwrap();
        assert_eq!(cat.models[0].reasoning.sent, None);
        assert_eq!(cat.models[0].reasoning.effective, "none");
        assert!(!cat.models[0].supports.reasoning && !cat.models[0].supports.tools);
        assert_eq!(cat.models[0].output.parameter, Some("max_completion_tokens"));
        assert_eq!(cat.models[1].reasoning.sent, None);
        assert_eq!(cat.models[1].reasoning.effective, "model-default");
        assert_eq!(cat.models[2].reasoning.effective, "nearest-supported");
        assert_eq!(cat.models[2].reasoning.sent, Some(json!({ "effort": "medium" })));
        assert!(cat.models[2].reasoning.note.contains("low, high"));
    }

    #[test]
    fn batch_and_non_text_entries_are_left_out() {
        let mut batch_only = entry("acme/batch-only");
        batch_only["endpoints"] = json!(["/api/v1/batches"]);
        let batch_variant = entry("acme/fast-one:batch");
        let mut image = entry("acme/painter");
        image["architecture"]["output_modalities"] = json!(["image"]);
        let cat = reduce(&json!({ "data": [entry("acme/live"), batch_only, batch_variant, image] })).unwrap();
        assert_eq!(cat.models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["acme/live"]);
        assert_eq!(cat.excluded, Excluded { not_live: 3, invalid: 0 });
    }

    #[test]
    fn malformed_entries_are_counted_not_trusted() {
        let mut no_price = entry("acme/no-price");
        no_price["pricing"] = json!({ "prompt": 0.5, "completion": "0.1" }); // a number, not a string
        let mut bad_id = entry("acme/x");
        bad_id["id"] = json!("acme/<script>");
        let mut bad_ctx = entry("acme/ctx");
        bad_ctx["context_length"] = json!("big");
        let mut no_params = entry("acme/np");
        no_params.as_object_mut().unwrap().remove("supported_parameters");
        let mut null_caps = entry("acme/unknown-limits");
        null_caps["context_length"] = Value::Null;
        null_caps["top_provider"] = json!({ "is_moderated": false, "context_length": null, "max_completion_tokens": null });
        let cat = reduce(&json!({ "data": [no_price, bad_id, bad_ctx, no_params, json!("text"), null_caps, entry("acme/ok"), entry("acme/ok")] })).unwrap();
        assert_eq!(cat.excluded.invalid, 5);
        assert_eq!(cat.models.len(), 2); // the duplicate id is listed once
        assert_eq!(cat.models[0].max_completion_tokens, None);
        assert_eq!(cat.models[0].context_length, None);
        assert_eq!(cat.models[0].output.effective_cap, policy::REQUESTED_OUTPUT_CEILING);
    }

    #[test]
    fn a_payload_that_is_not_a_model_list_is_refused() {
        assert!(reduce(&json!({ "error": { "message": "nope" } })).is_err());
        assert!(reduce(&json!({ "data": {} })).is_err());
        assert!(reduce(&json!({ "data": [] })).is_err());
        assert!(reduce(&json!([])).is_err());
    }

    #[test]
    fn labels() {
        assert_eq!(label("a/b", "Anthropic: Claude Opus 5.5"), "Claude Opus 5.5");
        assert_eq!(label("a/model-x", ""), "model-x");
        assert_eq!(label("a/b", "Plain Name"), "Plain Name");
        assert_eq!(label("a/b", &"x".repeat(60)).chars().count(), 40);
    }
}
