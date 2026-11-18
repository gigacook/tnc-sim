//! `/api/v1/ai/…` — AI program generation, run by the server: the OpenRouter key kept server-side, the
//! model catalog, and the generation job with its event stream. `docs/AI_API.md` is the contract.
//!
//! Who may do what follows the server's account model: any signed-in user may see whether a key is
//! set, list models and run jobs (inside the per-user monthly budget); only an admin may set or delete
//! the key. In local mode (the desktop shell) the one local operator is an admin. Every route goes
//! through `CurrentUser` / `AdminUser`, so cookie-authenticated writes get the same-origin check.

pub mod catalog;
pub mod extract;
pub mod job;
pub mod keystore;
pub mod policy;
pub mod sse;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{AdminUser, CurrentUser};
use crate::state::AppState;
use job::fail;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ai/key", get(key_status).put(key_set).delete(key_delete))
        .route("/ai/models", get(models))
        .route("/ai/jobs", post(job::start))
        .route("/ai/jobs/{id}/cancel", post(job::cancel))
        .route("/ai/jobs/{id}/measurement", post(job::measurement))
}

fn key_state(st: &AppState) -> Json<Value> {
    Json(json!({ "present": st.ai_key.present(), "stored": st.ai_key.stored() }))
}

/// Whether a key is set. Two booleans; the key itself has no way out of the server.
async fn key_status(State(st): State<AppState>, _: CurrentUser) -> Json<Value> {
    key_state(&st)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetKey {
    key: String,
}

async fn key_set(State(st): State<AppState>, _: AdminUser, body: Bytes) -> Response {
    // parsed by hand: a rejection must never echo the body, which holds the key
    let Ok(b) = serde_json::from_slice::<SetKey>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "bad_request", "the body must be {\"key\": \"…\"}");
    };
    let key = match keystore::validate(&b.key) {
        Ok(k) => k,
        Err(e) => return fail(StatusCode::BAD_REQUEST, "bad_key", e.0),
    };
    if st.ai_key.set(key).is_err() {
        tracing::error!("the OpenRouter key could not be written to the data folder");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "key_not_stored", "The key could not be saved in the server's data folder. Check that the folder is writable.");
    }
    key_state(&st).into_response()
}

async fn key_delete(State(st): State<AppState>, _: AdminUser) -> Response {
    if st.ai_key.delete().is_err() {
        tracing::error!("the stored OpenRouter key could not be removed from the data folder");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "key_not_deleted", "The stored key could not be removed from the server's data folder.");
    }
    key_state(&st).into_response()
}

/// The reduced catalog plus the policy the job applies, so the dialog shows real limits.
async fn models(State(st): State<AppState>, _: CurrentUser) -> Response {
    let f = match catalog::get(&st).await {
        Ok(f) => f,
        Err(e) => return fail(StatusCode::BAD_GATEWAY, "catalog_unavailable", format!("{e}. Try again.")),
    };
    let allow = st.cfg.ai_models();
    let list: Vec<&catalog::Model> = f.catalog.models.iter().filter(|m| allow.is_empty() || allow.contains(&m.id)).collect();
    Json(json!({
        "models": list,
        "excluded": f.catalog.excluded,
        "default_model": st.cfg.ai_default_model,
        "age_s": f.age_s,
        "ttl_s": policy::CATALOG_TTL.as_secs(),
        "stale": f.stale,
        "policy": {
            "reasoning": policy::REASONING_EFFORT,
            "requested_output_ceiling": policy::REQUESTED_OUTPUT_CEILING,
            "auto_repair": policy::AUTO_REPAIR,
            "max_refinement_rounds": policy::MAX_REFINEMENT_ROUNDS,
            "measure_goal": policy::MEASURE_GOAL,
            "server_max_tokens": st.cfg.ai_max_tokens,
        },
    }))
    .into_response()
}
