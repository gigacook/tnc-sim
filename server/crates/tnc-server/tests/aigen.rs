//! `/api/v1/ai/…` in process, against a MOCK PROVIDER (a fake OpenRouter on 127.0.0.1): no real
//! network, no API credit. The wider scenarios (cancel, disconnect, timeouts, the real binary) are in
//! `tests/ai/server-job.mjs`.

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tnc_server::{AppState, Config};
use tower::ServiceExt;

const MOCK_KEY: &str = "MOCK-PROVIDER-KEY-not-real";
const GOOD: &str = "BEGIN PGM T MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S3000\nL Z+50 R0 FMAX M3\nL X+10 Y+10 R0 FMAX\nL Z-2 R0 F200\nL X+90 F500\nL Z+50 R0 FMAX M2\nEND PGM T MM";
/// every feed move stays above the blank: it runs clean and cuts nothing
const AIR: &str = "BEGIN PGM T MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S3000\nL Z+50 R0 FMAX M3\nL X+10 Y+10 R0 FMAX\nL Z+10 R0 F200\nL X+90 F500\nL Z+50 R0 FMAX M2\nEND PGM T MM";

/// What the mock provider saw: (path, Authorization, body).
type Seen = Arc<Mutex<Vec<(String, Option<String>, Value)>>>;

/// The mock provider: `/models` in OpenRouter's documented shape and `/chat/completions` playing the
/// scripted answers in order as an event stream.
async fn mock_provider(answers: Vec<&'static str>) -> (String, Seen) {
    let seen: Seen = Arc::default();
    let script = Arc::new(Mutex::new(answers.into_iter().collect::<std::collections::VecDeque<_>>()));
    let (s1, s2) = (seen.clone(), seen.clone());
    let app = Router::new()
        .route(
            "/models",
            get(move |headers: HeaderMap| {
                let seen = s1.clone();
                async move {
                    let auth = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).map(str::to_owned);
                    seen.lock().unwrap().push(("/models".into(), auth, Value::Null));
                    axum::Json(json!({ "data": [{
                        "id": "mock/fast-one", "name": "MOCK: Fast One", "context_length": 1000000,
                        "pricing": { "prompt": "0.00000005", "completion": "0.00000020" },
                        "architecture": { "output_modalities": ["text"] },
                        "top_provider": { "context_length": 1000000, "max_completion_tokens": 32768, "is_moderated": false },
                        "supported_parameters": ["max_tokens", "reasoning", "tools"],
                        "endpoints": ["/api/v1/chat/completions"],
                    }, {
                        "id": "mock/fast-one:batch", "name": "MOCK: Fast One (batch)", "context_length": 1000000,
                        "pricing": { "prompt": "0.00000002", "completion": "0.00000010" },
                        "top_provider": { "max_completion_tokens": 32768 },
                        "supported_parameters": ["max_tokens"],
                        "endpoints": ["/api/v1/batches"],
                    }] }))
                }
            }),
        )
        .route(
            "/chat/completions",
            post(move |headers: HeaderMap, axum::Json(body): axum::Json<Value>| {
                let (seen, script) = (s2.clone(), script.clone());
                async move {
                    let auth = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).map(str::to_owned);
                    seen.lock().unwrap().push(("/chat/completions".into(), auth, body));
                    let Some(text) = script.lock().unwrap().pop_front() else {
                        return (StatusCode::INTERNAL_SERVER_ERROR, "mock: no scripted answer left").into_response();
                    };
                    let chunk = json!({ "choices": [{ "index": 0, "delta": { "content": text }, "finish_reason": "stop" }] });
                    let usage = json!({ "choices": [], "usage": { "prompt_tokens": 10, "completion_tokens": 5, "cost": 0.002 } });
                    let sse = format!(": OPENROUTER PROCESSING\n\ndata: {chunk}\n\ndata: {usage}\n\ndata: [DONE]\n\n");
                    ([(header::CONTENT_TYPE, "text/event-stream")], sse).into_response()
                }
            }),
        );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (format!("http://{addr}"), seen)
}

struct T {
    app: Router,
    st: AppState,
    dir: tempfile::TempDir,
}

struct Res {
    status: StatusCode,
    body: Vec<u8>,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
    /// The event stream as (event name, data).
    fn events(&self) -> Vec<(String, Value)> {
        self.text()
            .split("\n\n")
            .filter_map(|block| {
                let name = block.lines().find_map(|l| l.strip_prefix("event: "))?;
                let data = block.lines().find_map(|l| l.strip_prefix("data: "))?;
                Some((name.to_owned(), serde_json::from_str(data).unwrap()))
            })
            .collect()
    }
}

async fn setup_with(f: impl FnOnce(&mut Config)) -> T {
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = Config::minimal(dir.path().to_path_buf());
    f(&mut cfg);
    let st = AppState::new(cfg).await.unwrap();
    T { app: tnc_server::router(st.clone()), st, dir }
}

impl T {
    async fn call(&self, method: Method, uri: &str, token: Option<&str>, body: Option<Value>) -> Res {
        let mut b = Request::builder().method(method).uri(uri);
        if let Some(t) = token {
            b = b.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let body = match body {
            Some(v) => {
                b = b.header(header::CONTENT_TYPE, "application/json");
                Body::from(v.to_string())
            }
            None => Body::empty(),
        };
        let res = self.app.clone().oneshot(b.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        Res { status, body }
    }
    async fn signup(&self, email: &str) -> String {
        let r = self.call(Method::POST, "/api/v1/auth/signup", None, Some(json!({ "email": email, "name": "Op", "password": "correct horse" }))).await;
        assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
        r.json()["token"].as_str().unwrap().to_owned()
    }
}

#[tokio::test]
async fn key_is_admin_only_boolean_only_and_off_the_database() {
    let t = setup_with(|c| c.allow_signup = true).await;
    let admin = t.signup("admin@shop.test").await;
    let user = t.signup("op@shop.test").await;

    assert_eq!(t.call(Method::GET, "/api/v1/ai/key", None, None).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(t.call(Method::GET, "/api/v1/ai/key", Some(&user), None).await.json(), json!({ "present": false, "stored": false }));
    let r = t.call(Method::PUT, "/api/v1/ai/key", Some(&user), Some(json!({ "key": MOCK_KEY }))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(t.call(Method::DELETE, "/api/v1/ai/key", Some(&user), None).await.status, StatusCode::FORBIDDEN);
    assert!(!t.st.ai_key.present());

    // a cookie-authenticated write from another site is refused (the server's CSRF rule applies here too)
    let cross = Request::builder()
        .method(Method::PUT)
        .uri("/api/v1/ai/key")
        .header(header::COOKIE, format!("tnc_session={admin}"))
        .header(header::HOST, "tnc.example")
        .header(header::ORIGIN, "https://evil.example")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "key": MOCK_KEY }).to_string()))
        .unwrap();
    assert_eq!(t.app.clone().oneshot(cross).await.unwrap().status(), StatusCode::FORBIDDEN);
    assert!(!t.st.ai_key.present());

    let bad = t.call(Method::PUT, "/api/v1/ai/key", Some(&admin), Some(json!({ "key": "has a space SECRETPART" }))).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.json()["error"]["code"], "bad_key");
    assert!(!bad.text().contains("SECRETPART"));
    let not_json = Request::builder().method(Method::PUT).uri("/api/v1/ai/key").header(header::AUTHORIZATION, format!("Bearer {admin}")).body(Body::from("key=SECRETPART")).unwrap();
    let res = t.app.clone().oneshot(not_json).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert!(!String::from_utf8_lossy(&res.into_body().collect().await.unwrap().to_bytes()).contains("SECRETPART"));

    let set = t.call(Method::PUT, "/api/v1/ai/key", Some(&admin), Some(json!({ "key": MOCK_KEY }))).await;
    assert_eq!(set.status, StatusCode::OK, "{}", set.text());
    assert_eq!(set.json(), json!({ "present": true, "stored": true }));
    assert!(!set.text().contains(MOCK_KEY));
    for uri in ["/api/v1/ai/key", "/api/v1/info", "/api/v1/me", "/api/ai/v1/usage"] {
        assert!(!t.call(Method::GET, uri, Some(&admin), None).await.text().contains(MOCK_KEY), "{uri}");
    }
    assert_eq!(t.call(Method::GET, "/api/v1/info", None, None).await.json()["ai"]["enabled"], true);
    assert!(!format!("{:?}", t.st.ai_key).contains(MOCK_KEY));

    // one file in the data folder; no database file holds the key
    assert_eq!(std::fs::read_to_string(t.dir.path().join("openrouter.key")).unwrap(), MOCK_KEY);
    for f in std::fs::read_dir(t.dir.path()).unwrap().flatten().filter(|f| f.file_name().to_string_lossy().starts_with("tnc.db")) {
        let bytes = std::fs::read(f.path()).unwrap();
        assert!(!bytes.windows(MOCK_KEY.len()).any(|w| w == MOCK_KEY.as_bytes()), "{:?}", f.file_name());
    }

    let del = t.call(Method::DELETE, "/api/v1/ai/key", Some(&admin), None).await;
    assert_eq!(del.json(), json!({ "present": false, "stored": false }));
    assert!(!t.dir.path().join("openrouter.key").exists());
}

#[cfg(windows)]
#[tokio::test]
async fn key_file_does_not_inherit_the_folder_permissions_on_windows() {
    let t = setup_with(|_| {}).await;
    t.st.ai_key.set(MOCK_KEY).unwrap();
    let out = std::process::Command::new("icacls").arg(t.dir.path().join("openrouter.key")).output().unwrap();
    let acl = String::from_utf8_lossy(&out.stdout).into_owned();
    assert!(out.status.success(), "{acl}");
    assert!(!acl.contains("(I)"), "an inherited entry is left: {acl}");
    let entries = acl.lines().filter(|l| l.contains(":(")).count();
    assert_eq!(entries, 1, "only the current user: {acl}");
}

#[tokio::test]
async fn environment_key_still_works_and_a_stored_key_wins() {
    let (base, seen) = mock_provider(vec![]).await;
    let t = setup_with(|c| {
        c.openrouter_api_key = Some("MOCK-ENV-KEY".into());
        c.openrouter_base = base;
    })
    .await;
    let admin = t.signup("admin@shop.test").await;
    assert_eq!(t.call(Method::GET, "/api/v1/ai/key", Some(&admin), None).await.json(), json!({ "present": true, "stored": false }));
    assert_eq!(t.call(Method::GET, "/api/v1/ai/models", Some(&admin), None).await.status, StatusCode::OK);
    assert_eq!(seen.lock().unwrap()[0].1.as_deref(), Some("Bearer MOCK-ENV-KEY"));
    t.call(Method::PUT, "/api/v1/ai/key", Some(&admin), Some(json!({ "key": MOCK_KEY }))).await;
    assert_eq!(t.st.ai_key.get().as_deref(), Some(MOCK_KEY));
    // deleting the stored key falls back to the environment's
    assert_eq!(t.call(Method::DELETE, "/api/v1/ai/key", Some(&admin), None).await.json(), json!({ "present": true, "stored": false }));
}

#[tokio::test]
async fn local_mode_operator_stores_the_key_in_process() {
    // what the desktop shell does: local mode, the one local operator, a session from a one-time link
    let t = setup_with(|c| c.local_mode = true).await;
    let user = tnc_server::local::ensure_local_user(&t.st).await.unwrap();
    let token = tnc_server::auth::create_session(&t.st, &user.id, None).await.unwrap();
    let r = t.call(Method::PUT, "/api/v1/ai/key", Some(&token), Some(json!({ "key": MOCK_KEY }))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(t.call(Method::GET, "/api/v1/ai/key", Some(&token), None).await.json(), json!({ "present": true, "stored": true }));
    // a restart of the in-process server finds it again
    let again = AppState::new(Config::minimal(t.dir.path().to_path_buf())).await.unwrap();
    assert_eq!(again.ai_key.get().as_deref(), Some(MOCK_KEY));
}

#[tokio::test]
async fn no_key_is_typed_and_nothing_goes_upstream() {
    let (base, seen) = mock_provider(vec![GOOD]).await;
    let t = setup_with(|c| c.openrouter_base = base).await;
    let admin = t.signup("admin@shop.test").await;
    assert_eq!(t.call(Method::POST, "/api/v1/ai/jobs", None, Some(json!({ "prompt": "a slot" }))).await.status, StatusCode::UNAUTHORIZED);
    let r = t.call(Method::POST, "/api/v1/ai/jobs", Some(&admin), Some(json!({ "prompt": "a slot", "model": "mock/fast-one" }))).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert_eq!(r.json()["error"]["code"], "no_key");
    assert!(seen.lock().unwrap().is_empty(), "no upstream request of any kind");
    assert_eq!(t.st.ai_jobs.running(), 0);
}

#[tokio::test]
async fn catalog_passes_prices_through_and_leaves_batch_out() {
    let (base, seen) = mock_provider(vec![]).await;
    let t = setup_with(|c| c.openrouter_base = base).await;
    let admin = t.signup("admin@shop.test").await;
    let r = t.call(Method::GET, "/api/v1/ai/models", Some(&admin), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let j = r.json();
    assert_eq!(j["models"].as_array().unwrap().len(), 1);
    let m = &j["models"][0];
    assert_eq!(m["id"], "mock/fast-one");
    assert_eq!(m["label"], "Fast One");
    assert_eq!(m["pricing"], json!({ "prompt": "0.00000005", "completion": "0.00000020" }));
    assert_eq!(m["price_per_million"], "$0.05 / $0.20 per 1M tokens");
    assert_eq!(m["output"]["effective_cap"], 32768);
    assert_eq!(j["excluded"], json!({ "not_live": 1, "invalid": 0 }));
    assert_eq!(j["policy"]["max_refinement_rounds"], 5);
    // without a key the list is fetched without an Authorization header; once, then from memory
    t.call(Method::GET, "/api/v1/ai/models", Some(&admin), None).await;
    let s = seen.lock().unwrap();
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].1, None);
}

#[tokio::test]
async fn catalog_refuses_a_payload_that_is_not_a_model_list() {
    let app = Router::new().route("/models", get(|| async { axum::Json(json!({ "data": "nope" })) }));
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    let t = setup_with(|c| c.openrouter_base = format!("http://{addr}")).await;
    let admin = t.signup("admin@shop.test").await;
    let r = t.call(Method::GET, "/api/v1/ai/models", Some(&admin), None).await;
    assert_eq!(r.status, StatusCode::BAD_GATEWAY);
    assert_eq!(r.json()["error"]["code"], "catalog_unavailable");
    // and a job cannot start on unknown limits
    t.st.ai_key.set(MOCK_KEY).unwrap();
    let r = t.call(Method::POST, "/api/v1/ai/jobs", Some(&admin), Some(json!({ "prompt": "a slot", "model": "mock/fast-one" }))).await;
    assert_eq!(r.json()["error"]["code"], "catalog_unavailable");
}

#[tokio::test]
async fn job_streams_typed_events_in_order_and_repairs_a_program_that_cuts_air() {
    let (base, seen) = mock_provider(vec![AIR, GOOD]).await;
    let t = setup_with(|c| c.openrouter_base = base).await;
    let admin = t.signup("admin@shop.test").await;
    t.st.ai_key.set(MOCK_KEY).unwrap();
    let r = t.call(Method::POST, "/api/v1/ai/jobs", Some(&admin), Some(json!({ "prompt": "a slot 80 long", "model": "mock/fast-one", "machine": "426" }))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let ev = r.events();
    let stages: Vec<String> = ev.iter().filter(|(n, _)| n == "stage").map(|(_, d)| format!("{}:{}", d["stage"].as_str().unwrap(), d["round"])).collect();
    assert_eq!(stages, ["generation:0", "validation:0", "measurement:0", "refinement:1", "validation:1", "measurement:1", "completion:1"]);
    assert_eq!(ev[0].0, "job");
    let (last, done) = ev.last().unwrap();
    assert_eq!(last, "done");
    assert_eq!(done["program"], GOOD);
    assert_eq!(done["accepted"], true);
    assert_eq!(done["usage"]["requests"], 2);
    assert!((done["usage"]["cost_usd"].as_f64().unwrap() - 0.004).abs() < 1e-9);

    {
        let s = seen.lock().unwrap();
        let chats: Vec<&(String, Option<String>, Value)> = s.iter().filter(|x| x.0 == "/chat/completions").collect();
        assert_eq!(chats.len(), 2);
        assert_eq!(chats[0].1.as_deref(), Some("Bearer MOCK-PROVIDER-KEY-not-real"));
        assert_eq!(chats[0].2["max_tokens"], 32768);
        assert_eq!(chats[0].2["reasoning"], json!({ "effort": "medium" }));
        assert_eq!(chats[0].2["stream"], true);
        assert!(chats[0].2.get("temperature").is_none(), "temperature is not in the model's supported parameters");
        let report = chats[1].2["messages"][3]["content"].as_str().unwrap();
        assert!(report.contains("THE PROGRAM REMOVES NO MATERIAL"), "{report}");
        assert!(report.contains("-> Milling removes material"), "{report}");
    }
    assert_eq!(t.st.ai_jobs.running(), 0);
    // both upstream requests are in the usage record, and count against the budget
    let u = t.call(Method::GET, "/api/ai/v1/usage", Some(&admin), None).await.json();
    assert_eq!(u["calls"], 2);
}

#[tokio::test]
async fn job_respects_the_allow_list_and_the_monthly_budget() {
    let (base, seen) = mock_provider(vec![GOOD, GOOD]).await;
    let t = setup_with(|c| {
        c.openrouter_base = base;
        c.ai_models = vec!["mock/fast-one".into()];
        c.ai_monthly_budget_usd = 0.002;
    })
    .await;
    let admin = t.signup("admin@shop.test").await;
    t.st.ai_key.set(MOCK_KEY).unwrap();
    let r = t.call(Method::POST, "/api/v1/ai/jobs", Some(&admin), Some(json!({ "prompt": "x", "model": "other/model" }))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.json()["error"]["code"], "model_not_allowed");
    let r = t.call(Method::POST, "/api/v1/ai/jobs", Some(&admin), Some(json!({ "prompt": "x", "model": "mock/fast-one" }))).await;
    assert_eq!(r.events().last().unwrap().0, "done");
    // that one request used the whole budget
    let r = t.call(Method::POST, "/api/v1/ai/jobs", Some(&admin), Some(json!({ "prompt": "x", "model": "mock/fast-one" }))).await;
    assert_eq!(r.status, StatusCode::PAYMENT_REQUIRED);
    assert_eq!(r.json()["error"]["code"], "budget_exceeded");
    assert_eq!(seen.lock().unwrap().iter().filter(|x| x.0 == "/chat/completions").count(), 1);
}
