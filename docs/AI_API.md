# AI generation API (server side)

The contract between the simulator's New program dialog and the TNC server. Everything here is under
`/api/v1` (in the simulator page: `window.TNC_BACKEND.api`). Code: `server/crates/tnc-server/src/aigen/`.

OpenRouter is the only provider. The OpenRouter key lives on the server and has no way back out. A program
or prompt is sent to OpenRouter only by `POST /ai/jobs`, which a signed-in client must call explicitly.
(The older pass-through at `/api/ai/v1/chat/completions` still exists for `sim/ai.js`; it forwards what the
client itself sends and now also uses the stored key.)

Tested against a mock provider only (`tests/ai/server-job.mjs`, `server/crates/tnc-server/tests/aigen.rs`).
No test calls the real OpenRouter.

## Rules that hold for every route

| Rule | Detail |
|---|---|
| Sign-in | Session cookie `tnc_session` or `Authorization: Bearer <token>`. Missing or bad: `401 unauthorized`. |
| Cross-site writes | A cookie-authenticated `POST`/`PUT`/`DELETE` from another origin: `403 forbidden`. |
| Error shape | `{"error": {"code": "<code>", "message": "<one or two plain sentences>"}}` |
| Browser call | `fetch(..., {credentials: "same-origin"})`. The job stream is read with `response.body` (it is a `POST`, so `EventSource` cannot be used). |

## Endpoints

| Method and path | Who | What |
|---|---|---|
| `GET /ai/key` | any user | Is a key set |
| `PUT /ai/key` | admin | Store the key |
| `DELETE /ai/key` | admin | Remove the stored key |
| `GET /ai/models` | any user | Model catalog and the policy |
| `POST /ai/jobs` | any user | Start a generation; the answer is the event stream |
| `POST /ai/jobs/{id}/cancel` | the job's owner | Stop the job |
| `POST /ai/jobs/{id}/measurement` | the job's owner | Answer a `measure-request` |

In the desktop app the one local operator is an admin, so the key routes work there without extra steps.

### Key

`GET /ai/key` → `200 {"present": true, "stored": true}`

- `present`: a key is available (stored, or from the server's `OPENROUTER_API_KEY`).
- `stored`: a key was stored through this API (the one `DELETE` removes).

`PUT /ai/key` with `{"key": "<the key>"}` → `200 {"present": true, "stored": true}`

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | Body is not exactly `{"key": "..."}` |
| 400 | `bad_key` | Empty, longer than 512 characters, or holds spaces / control characters |
| 403 | `forbidden` | Not an admin |
| 500 | `key_not_stored` | The data folder is not writable |

`DELETE /ai/key` → `200 {"present": false, "stored": false}` (`present` stays `true` when the server has an
environment key). `500 key_not_deleted` when the file cannot be removed.

The key is not checked against OpenRouter when it is stored. A wrong key shows up on the first job as the
`key_rejected` error event. After a `200`, clear the input field.

Storage: file `openrouter.key` in the server's data folder (`TNC_DATA_DIR`), readable by the owner only
(mode 0600 on Unix; on Windows inherited permissions are removed and only the current user is granted
access). Plain text, not encrypted. It is not in the SQLite database, so a copy of `tnc.db` holds no key.
It is never written to a response or a log line.

### Model catalog

`GET /ai/models` → `200`

```json
{
  "models": [ { "...": "see below" } ],
  "excluded": { "not_live": 3, "invalid": 1 },
  "default_model": "deepseek/deepseek-v4.1-flash",
  "age_s": 0,
  "ttl_s": 600,
  "stale": false,
  "policy": {
    "reasoning": "medium",
    "requested_output_ceiling": 131072,
    "auto_repair": true,
    "max_refinement_rounds": 5,
    "measure_goal": 95.0,
    "server_max_tokens": 0
  }
}
```

One model:

```json
{
  "id": "acme/fast-one-v2",
  "label": "Fast One v2",
  "name": "Acme: Fast One v2",
  "provider": "acme",
  "context_length": 1000000,
  "max_completion_tokens": 32768,
  "pricing": { "prompt": "0.00000005", "completion": "0.00000020" },
  "price_per_million": "$0.05 / $0.20 per 1M tokens",
  "supported_parameters": ["max_tokens", "temperature", "tools", "reasoning"],
  "supports": { "reasoning": true, "tools": true, "streaming": true },
  "reasoning": { "requested": "medium", "sent": { "effort": "medium" }, "effective": "medium", "note": "Reasoning effort medium is sent." },
  "output": { "requested": 131072, "effective_cap": 32768, "parameter": "max_tokens" }
}
```

| Field | Meaning |
|---|---|
| `id` | Routable identifier, exactly as OpenRouter gives it. Send this as `model`. Never send the label. |
| `label` | Short display name, derived from `name` (provider prefix removed, 40 characters at most). Display only. |
| `context_length`, `max_completion_tokens` | From the catalog; `null` when OpenRouter gives none. |
| `pricing.prompt`, `pricing.completion` | US$ per token, the strings OpenRouter sent, unchanged. |
| `price_per_million` | The same two prices per million tokens (input / output), made by moving the decimal point. `null` when a price is not a plain amount. |
| `supports.streaming` | Always `true`: only models served by OpenRouter's chat-completions path are listed, and that path streams. |
| `reasoning.sent` | The `reasoning` parameter the job sends for this model, or `null` when it sends none. |
| `reasoning.effective` | `medium`; `nearest-supported` (the model lists efforts without medium, OpenRouter maps it; see `note`); `model-default` (the model reasons but takes no effort); `none`. |
| `output.effective_cap` | min(requested, `max_completion_tokens`, `context_length`). The job subtracts the prompt on top of this. |
| `output.parameter` | `max_tokens`, `max_completion_tokens`, or `null` when the model documents neither (then no cap is sent). |
| `excluded.not_live` | Entries left out: no chat-completions endpoint (batch / async only), an id ending in `:batch` or `:async`, or no text output. |
| `excluded.invalid` | Entries without the documented shape (no id, prices not strings, ...). |
| `stale` | `true` when OpenRouter could not be reached and an expired copy is shown. |
| `policy.server_max_tokens` | The operator's own cap (`TNC_AI_MAX_TOKENS`), `0` = none. |

The list is kept in memory for `ttl_s` seconds. When the server has a model allow-list (`TNC_AI_MODELS`),
only those models are listed.

| Status | Code | When |
|---|---|---|
| 502 | `catalog_unavailable` | OpenRouter's list could not be fetched or is not a model list, and no earlier copy exists |

### Start a job

`POST /ai/jobs`

```json
{
  "prompt": "A 100 x 60 plate with a slot 80 long, 6 wide, 2 deep",
  "model": "acme/fast-one-v2",
  "machine": "426",
  "tools": [ { "t": 5, "name": "ENDMILL_12", "l": 120, "r": 6 } ],
  "holder": "ISO50",
  "system": "<TNC_AI.system(tools, {plan: true})>",
  "client_measure": true
}
```

| Field | Required | Meaning |
|---|---|---|
| `prompt` | yes | 1 to 20000 characters |
| `model` | no | A catalog `id`; the server's `default_model` when absent |
| `machine` | no | `"426"` or `"430"` |
| `tools` | no | The operator's tool table, merged over the built-in one for the check |
| `holder` | no | `"ISO50"` (default) or `"SK40"` |
| `system` | no | The system prompt, 100000 characters at most. Send `TNC_AI.system(tools, opts)` from `sim/ai.js`; without it the server uses a much shorter built-in prompt |
| `client_measure` | no | `true`: the client answers `measure-request` events |

Unknown fields are refused. No reasoning, token or round settings exist: those are the policy.

Answers before the stream starts (ordinary JSON, in this order of checking):

| Status | Code | When | Upstream requests made |
|---|---|---|---|
| 401 | `unauthorized` | Not signed in | none |
| 400 | `bad_request` | Body or a field is not valid | none |
| 409 | `no_key` | No key is set | none |
| 503 | `validator_unavailable` | The interpreter is not running on this server | none |
| 403 | `model_not_allowed` | The model is not on the server's allow-list | none |
| 402 | `budget_exceeded` | The account's monthly AI budget is used up | none |
| 502 | `catalog_unavailable` | The model's limits cannot be read | the model list only |
| 400 | `model_unknown` | The model is not in the catalog of live models | the model list only |
| 429 | `busy` | This account already has a job running | the model list only |

Otherwise: `200`, `Content-Type: text/event-stream`, header `X-Job-Id: <id>`.

### The event stream

Each event is `event: <type>` and one `data:` line of JSON. Lines starting with `:` are keepalives (one
every 15 s); skip them. The stream ends after exactly one `done` or one `error`.

| Event | Data | Meaning |
|---|---|---|
| `job` | `{id, model, max_rounds, reasoning, client_measure}` | Always first. `id` is for cancel and measurement. `reasoning` is the catalog's reasoning object. |
| `stage` | `{stage, round, max_rounds}` | `stage` is `generation`, `validation`, `measurement`, `refinement` or `completion`. |
| `delta` | `{round, text}` | The next piece of program text. Program text only: no code fence, no prose, no reasoning. |
| `status` | `{code, message}` | One short line for the user. |
| `measure-request` | `{request_id, round, program, spec, timeout_ms}` | Only with `client_measure`. See Measurement. |
| `done` | see below | The program passed. The only event after which Load may be offered. |
| `error` | see below | The job ended without an accepted program. |

Stage order. `round` is 0 for the first generation and 1 to 5 for refinement rounds (`max_rounds` is 5):

```
generation (round 0) → validation → measurement → completion → done
generation (round 0) → validation → measurement
  → refinement (round 1) → validation → measurement → ... → completion → done
```

- A `refinement` stage is the model writing again; its `delta` events carry the new `round`. Clear the
  shown text when a `generation` or `refinement` stage arrives.
- A round whose answer was cut off has no `validation` or `measurement` stage: `status truncated`, then
  the next `refinement`.
- `completion` is sent only before `done`.
- Show progress as stage plus "round n of max_rounds". There are no percentages.

`status` codes:

| Code | When |
|---|---|
| `waiting` | The provider sent a keepalive before any text (once per request) |
| `reasoning` | The model started reasoning (once per request). The reasoning text is never forwarded |
| `retry` | A request failed before any answer; the one allowed retry is about to be made |
| `truncated` | The answer was cut off at the output limit |
| `validated` | The interpreter's verdict for this round |
| `measured` | The measurement for this round |
| `measurement_timeout` | The client did not answer a `measure-request` in time |

`done`:

```json
{
  "program": "BEGIN PGM SLOT MM\n...\nEND PGM SLOT MM",
  "round": 1,
  "accepted": true,
  "model": "acme/fast-one-v2",
  "validation": { "ok": true, "errors": [], "crashes": [], "warnings": [], "blocks": 11, "summary": "passed" },
  "measurement": {
    "native": { "removed_volume_mm3": 1920.0, "cycle_time_s": 14.2, "path_feed_mm": 132.0, "min_z": -2.0, "max_z": 50.0, "tools_used": 1 },
    "client": { "score": 97.0, "pass": null, "text": null }
  },
  "usage": { "requests": 2, "prompt_tokens": 5200, "completion_tokens": 900, "cost_usd": 0.0004 }
}
```

- `program` is the normalized text (block numbers removed, upper case, `END PGM` fixed). It can differ in
  small ways from the joined `delta` text; load `program`.
- A finding in `errors`, `crashes`, `warnings`: `{line, block, message, raw}` (`line` 1-based, 0 when the
  finding is about the whole program; `block` is the TNC block number or `null`).
- `measurement.client` is `null` when no measurement was asked for or none arrived in time.
- `usage.requests` counts every generation request sent to OpenRouter, retries included.

`error`:

```json
{
  "code": "validation_failed",
  "message": "The program still fails the check after 5 repair round(s): 0 error(s), 1 crash(es): BLOCK 5 `L Z-10 R0 FMAX`: RAPID TRAVERSE INTO MATERIAL. The draft is kept; nothing was loaded. Change the request or try another model.",
  "retryable": true,
  "draft": { "program": "BEGIN PGM ...", "round": 3, "truncated": false, "validation": { "...": "as in done" }, "measurement": { "...": "as in done" } },
  "usage": { "requests": 6, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0 }
}
```

- `draft` is the best program the job has (`null` when there is none). Keep it for the user to open as a
  draft; never load it automatically and never show the job as ready. When `draft.truncated` is `true`
  the text is incomplete (cut off, or the stream failed midway); then `validation` and `measurement` can
  be `null`.
- `retryable`: starting the same job again can work. `false`: something must change first.

`error` codes:

| Code | Retryable | What happened | What the user can do |
|---|---|---|---|
| `validation_failed` | yes | Six answers, none passed the check or the measurement | Change the request or the model; open the draft |
| `no_program` | yes | No answer held a program | Rephrase |
| `truncated` | yes | The answer was cut off at the output limit and the rounds are used up | Simpler part, or a model with a larger output limit |
| `cancelled` | no | The cancel endpoint was called | Nothing |
| `timeout` | yes | The provider sent nothing for the idle time, or the job ran past its limit | Try again |
| `upstream_error` | yes | The provider failed, or the connection broke, in the middle of an answer | Try again |
| `upstream_unavailable` | yes | HTTP 429 or 5xx before any answer, also after the one retry | Later, or another model |
| `upstream_rejected` | no | OpenRouter refused the request (other 4xx) | Another model or request |
| `key_rejected` | no | OpenRouter refused the key (401 / 403) | Set a valid key |
| `provider_credit` | no | OpenRouter reports too little credit (402) | Add credit or change the key |
| `content_filter` | no | The provider's filter stopped the answer | Rephrase |
| `prompt_too_long` | no | Fewer than 1024 tokens are left for the answer | Shorten the request, or a model with more context |
| `budget_exceeded` | no | The monthly budget ran out during the job | Wait for the 1st, or ask the admin |
| `internal` | yes | The usage record could not be read | Try again |

### Cancel

`POST /ai/jobs/{id}/cancel` → `200 {"cancelled": true}`. The stream then ends with `error` code
`cancelled` (with the draft so far). `404 job_not_found` when the job is not running or belongs to
someone else.

Closing the stream (aborting the `fetch`) stops the job the same way. In both cases the connection to
OpenRouter is closed at once and no further request is made.

### Measurement

The server measures what the interpreter can measure natively: `measurement.native` (removed volume as
the interpreter estimates it, cycle time, feed path, Z range, tools used), and it rejects a program whose
cutting moves never go below the top of the blank.

Comparing the cut with the intended part (`TNC_PART.compare` in `sim/part.js`) exists only in JavaScript.
For that the job has a hook. With `"client_measure": true`, after a round whose program has no
interpreter errors:

1. The job sends `measure-request`: `{"request_id": "...", "round": 0, "program": "...", "spec": {...} | null, "timeout_ms": 30000}`.
   `spec` is the JSON of the model's ```` ```partspec ```` block when its answer had one (unchecked JSON:
   run it through `TNC_PART.parse` / `expand` before use), else `null`.
2. The client measures and posts `POST /ai/jobs/{id}/measurement`:

```json
{ "request_id": "<from the event>", "score": 61.5, "pass": false, "text": "S1 SLOT: NOT CUT from X50 to X90" }
```

| Field | Required | Meaning |
|---|---|---|
| `request_id` | yes | From the event |
| `score` | no | 0 to 100, the match with the intended part |
| `pass` | no | Decides acceptance when given. Otherwise: no score, or a score of at least 95 (`policy.measure_goal`), passes |
| `text` | no | The measurement in words; it goes to the model in the next round. Cut to 8000 characters |

3. `200 {"accepted": true}`. No answer within `timeout_ms`: `status measurement_timeout`, and the round is
   judged by the interpreter's check alone.

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | Body not valid, unknown field, score outside 0 to 100 |
| 404 | `job_not_found` | Job not running, or not yours |
| 409 | `measurement_not_pending` | The job is not waiting for that `request_id` |

A client that cannot measure posts nothing, or leaves `client_measure` out.

## What the job does (the policy)

One place: `server/crates/tnc-server/src/aigen/policy.rs`.

| Decision | Value |
|---|---|
| Reasoning | `medium`, sent only when the model lists the `reasoning` parameter |
| Requested output | 131072 tokens |
| Output cap sent | min(131072, the model's `max_completion_tokens`, `context_length` minus the prompt, the operator's `TNC_AI_MAX_TOKENS` when set). Example: requested 131072, provider cap 32768, 50000 left in the context → 32768 |
| Prompt size | Estimated as characters / 3 plus 512 tokens of margin (no tokenizer runs on the server) |
| Repair | Automatic |
| Rounds | The first generation plus at most 5 refinement rounds; stops at the first program that passes |
| Accepted | No interpreter error, no crash, cuts material, not cut off, and the client measurement (when there is one) passes |
| Retries | One, only for a request that failed before any answer (connection refused, HTTP 429 / 5xx), announced by `status retry` first. Nothing is retried once an answer has started |
| Cut-off answer | Costs one visible refinement round that asks for a shorter complete program. Never continued silently |
| `temperature` | 0.2, sent only when the model lists the parameter |
| Budget | The account's monthly budget is checked before every request; every request is written to the usage record |

Timeouts are server settings (`server/.env.example`): idle 120 s, measurement 30 s, whole job 30 min.

## Minimal client

```js
const res = await fetch(TNC_BACKEND.api + '/ai/jobs', {
  method: 'POST', credentials: 'same-origin', signal: abort.signal,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, model, machine, tools, system: TNC_AI.system(tools, { plan: true }), client_measure: true }),
});
if (!res.headers.get('content-type').startsWith('text/event-stream')) {
  const { error } = await res.json();        // error.code: no_key, busy, model_unknown, ...
  return show(error);
}
const jobId = res.headers.get('x-job-id');   // cancel: POST /ai/jobs/<jobId>/cancel
let buf = '';
const dec = new TextDecoder();
for await (const part of res.body) {
  buf += dec.decode(part, { stream: true });
  let end;
  while ((end = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, end); buf = buf.slice(end + 2);
    let type = null, data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (type) handle(type, JSON.parse(data));  // blocks without an event line are keepalives
  }
}
```
