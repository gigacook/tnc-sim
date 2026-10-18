# CONTINUE.md — machine-readable project state (read after CLAUDE.md)

<!-- FORMAT: every item has an ID, STATUS, SCOPE (the only files an agent may touch for it), CHECK (how "done" is proven).
     STATUS ∈ todo | doing | blocked(<reason>) | done | dropped. Update this file in the same commit as the work. -->

META
- updated: 2026-10-17
- branch: main (the Tauri / phone / AI-measure branch and main's AI repair loop merged 2026-10-16; interpreter moved to Rust 2026-10-17)
- entry: user says "continue" → read CLAUDE.md, then this file, then act on the top `todo` item in BACKLOG whose `blocked` is empty

## STATE (verified facts; how verified)
| key | value | check |
|---|---|---|
| interpreter manual tests | ALL PASS | `node tests/manual.js` |
| real-program corpus | 2,767 / 2,806 clean on the Rust engine (2026-10-17). The 39 left are malformed programs a real TNC also rejects. None of the corpus uses SL cycles | `AUTOTOOLS=1 node tests/corpus.js` |
| rust | 32 tests pass (tnc-core 3, tnc-engine 9, tnc-formats 6, tnc-server 14), 2026-10-18, Windows. `cargo clippy --all-targets`: 0 warnings | `cd server && cargo test` |
| engine parity | the Rust engine (native + WebAssembly) is identical to the record on 5,511 / 5,511 programs (both option sets, events, cut length, carved height field); it matched the retired JS engine live, in full | `node tests/parity.js` |
| browser UI suite | 305 pass, 0 fail (2 full runs), 2026-10-18, Windows, system Chrome via `PW_CHROMIUM` (Playwright's own Chromium not installed here). Includes the ported qa.mjs sections (I/O, tool table, profiles, single block), the current AI flow, and regression checks for framing, labels, overlays, sv text, web 360 px. A missing Chromium now fails the run. WebKit: SKIPPED (not installed) | `node tests/ui/run.mjs` |
| part spec / AI loop | pass (offline, mocked OpenRouter) | `node tests/part.js`, `node tests/ai/loop.js` |
| AI | live bench, DeepSeek V4.1 Flash, 2026-10-03: see README "AI accuracy" (old pipeline vs plan + measure + refine) | `node tests/ai/bench.mjs` (needs a key) |
| desktop | Linux: `cargo build` + `tauri build` (deb, rpm, AppImage) OK; debug binary launched under Xvfb: splash → server → one-time sign-in → web app signed in (server log + screenshot). macOS / Windows: CI job written, never run | `cd desktop && npx tauri build` |
| CI | first runs 2026-10-16: desktop builds pass on Linux, macOS, Windows; core job fails only on the phone swipe check (B17) | GitHub Actions |
| cycles | 1 2 4 7 8 9 10 11 14 17 18 19 20–25 32 200–215 220 221 230 231 247 262 263 264 265 267; TCH PROBE 408–413 417 419 (motion), 30–33 480–483 562 (no motion) | `tests/manual.js` |
| material model | `tnc-core` `stock.rs`: f32 height field; tilted tool cuts along its axis; no undercuts | — |
| vice | standard 160 mm vice, jaws on the Y faces, grips the bottom 6 mm; ON; toggle under Effects & view | — |
| holder | DIN 69871 ISO 50 (A=100) / SK40 (A=70), ER32 nut Ø50. The crash check uses nut R = max(25, toolR+6); L=0 → check skipped | `stock.rs` NUT_R |

## DECISIONS (don't re-litigate)
| id | date | decision |
|---|---|---|
| D-STACK | 10-17 | Rust interpreter `tnc-core` (one copy: native in the server, WebAssembly in the browser), three.js, Rust server, Tauri 2 desktop. Replaces 09-30 "JS interpreter, QuickJS in the server" (user decision 10-16: "we are breaking that September rule"). Behaviour frozen by `tests/parity.js`. |
| D-CSHARP | 09-30 | No C#. |
| D-REACT | 09-30 | Open: reasoned, awaiting the user. See the chat of 09-30; recommendation in ASK. |
| D-GFX | 09-30 | No new engine: stay on three.js r186. Realism via colour management, tone mapping, HDRI, AO and shadows. GPU = visuals only; the CPU stays authoritative for moves and checks (B13). |
| D-PROBE | 09-30 | TCH PROBE implemented ("future proof") although the 426/430 manual doesn't cover it; iTNC 530 semantics, labelled in code. |
| D-DROPPED | 09-30 | C rotary table, the single-block "line 19" report, new BREAK IT lessons. Never re-list. |
| D-AI | 09-30 | Recommend DeepSeek V4.1 Flash. Frontier models one click away; full searchable/sortable list and free typing too (B1). |
| D-DESKTOP | 10-03 | Tauri 2 shell runs `tnc-server` in-process on a remembered 127.0.0.1 port (browser storage is per origin), not a custom protocol (SSE streaming + cookies). Local operator signed in by a one-time link; Host allow-list + CSP; no Tauri IPC for the remote page. Same crate as the standalone server. |
| D-PHONE | 10-03 | ≤ 900 px: three workspaces in the page scroll (tabs + scoped swipes), soft keys + block line in a bottom dock (8 keys a row, paged like the control), secondary features in a MENU drawer. Nodes are moved between layouts, never duplicated. Desktop layout unchanged. |
| D-AI-LOOP | 10-03 | AI = plan (part spec) → expand (lettering → stroke paths, tool feasibility) → write → check → measure on the height field → refine (3 rounds default). Default 32k tokens/request, low reasoning, cut-off answers continued, one network retry, a failed refinement keeps the best program; server cap 64k. Bench 10-03: plate 73.8→99.2 %, letters 33.7→96.1 %, round 98.2→99.8 %, shoulder no-program→100 %. |

## BACKLOG (priority order)
| id | status | goal | scope | check |
|---|---|---|---|---|
| B1 | done | **AI model picker**: recommended (DeepSeek V4.1 Flash) + frontier quick picks computed from the live OpenRouter list (newest per major provider) + a sleek sortable, filterable table (name, provider, context, $/M in, $/M out) + free-text id. One source of truth for model lists; delete the stale `MODELS`/`AI_REC` lists. | `sim/ai.js`, the AI section of `sim/ui.js`, AI styles in `sim/sim-shell.html` | QA AI section passes; picks persist per profile. Done: `TNC_AI.listModels()` in ai.js is the one catalogue (live list, OFFLINE fallback of 6 ids); frontier = heuristic over names + prices (not a benchmark); pick stored in localStorage `tnc426.ormodel` (per browser, as before; not in the exported profile). |
| B2 | todo | **Graphics realism** ("no flat plastic"): colour management ON + AgX/ACES tone mapping, a real studio/workshop environment (procedural or small embedded HDR), soft shadows, SSAO/GTAO, machined-aluminium cut-surface material with tool-mark banding, blank/vice/table materials. Retune every colour after colour management. | `sim/look.js`, `sim/materials.js`, `sim/tools3d.js`, the renderer/light setup block of `sim/ui.js` | before/after screenshots; no page errors; fps ≥ 30 at default size on the swiftshader QA run |
| B3 | blocked(B4) | **Programs to the machine: all obvious paths.** (a) USB stick: export .H / TOOL.T with TNC-safe names and CRLF, Latin-1. (b) Ethernet LSV-2 (TNCremo protocol; 426/430 manual §12.5; check `pyLSV2` licence and 426/430 support before writing our own). (c) RS-232 serial (V.24; FE1 / FE2 / EXT blockwise per manual ch. 12). Both directions. | new `desktop/` (Tauri, Rust side), `server/crates/tnc-formats` | round-trip on the programming station (B5); later on the real machine |
| B4 | done (Linux) | **Tauri 2 desktop** shell (mac/Linux/Windows) hosting web + sim; local mode = the same server crates in-process with a local SQLite. Linux built + launched; macOS / Windows only via CI (not yet run). Signing / notarisation not set up. | `desktop/`, `server/crates/tnc-server/src/local.rs` | CI desktop job green on all three |
| B5 | blocked(user: Windows VM + HEIDENHAIN station demo) | **Programming-station oracle**: golden set 15–25 programs, capture moves/errors/timing, `tests/golden/*.json` + `tests/station.js`. Settles every OPEN item. | `tests/`, `docs/PROGRAMMING-STATION.md` | golden diff report |
| B6 | doing | Interpreter coverage. Done 2026-10-17: SL cycles 14, 20–25 (tool paths of 21–24 are placeholders SL3–SL13). Left: FK (the manual's SL example C20 needs it), 3, 5, 12 PGM CALL, 13, 26, 27/28, F AUTO. Manual-first; tests per cycle. | `server/crates/tnc-core`, `sim/dialogs.js`, `tests/` | manual.js pass; corpus not worse; parity re-recorded on purpose |
| B7 | doing | CI: GitHub Action = `node tests/manual.js` + `cargo test` + web type-check/build + `python3 build.py`; deploy Pages from CI instead of committing index.html. Written (+ part/AI-loop tests, UI suite with WebKit, desktop builds); never run; Pages deploy not done. | `.github/` | green run |
| B8 | done | Docs to reality: README (layout moved to sim/, fullstack), `docs/FEATURES.txt` (DEV tab; still says TCH PROBE/thread milling missing), `docs/HISTORY.txt`. Sonnet job. | `README.md`, `docs/` | no statement contradicts STATE |
| B9 | todo | Wire `probeSpec` to a TOUCH PROBE soft key; `TCHPROBE` node in flow.js. | `sim/ui.js` soft keys, `sim/flow.js` | manual click-through |
| B10 | todo | Live visual translation: `traceFor`/`traceTick` (ui.js) → `pathSVG` (flow.js). | `sim/ui.js`, `sim/flow.js` | — |
| B11 | todo | TNC 430 remainder: dexel/voxel stock for undercuts (GPU candidate, B13), radius comp in a tilted plane. | `server/crates/tnc-core` (stock.rs, exec.rs) | — |
| B12 | done | `.tools/qa/qa.mjs` was restored from a Mac copy and its sections 1–5, 7–10 ported into `tests/ui/run.mjs` (2026-10-18); its AI section was replaced by checks of the current plan → repair flow. GAGNING.H (an operator program) replaced by synthetic `tests/ui/fx/HOLES.H`. | `tests/ui/` | 305 pass |
| B14 | todo | Physical-device check of the phone layout: iOS Safari + VoiceOver, Android Chrome + TalkBack, software keyboard over the dock and dialogs, notch / home indicator. Emulation only so far. | `sim/sim-shell.html`, `sim/ui.js` | user on a phone |
| B15 | todo | AI: draw the planned part spec as a ghost in the 3-D view (the target the measurement uses), and let the operator edit the spec before the program is written. | `sim/ui.js`, `sim/part.js` | — |
| B16 | todo | Tauri mobile (iOS / Android) targets — only if wanted; the browser covers phones today. | `desktop/` | — |
| B17 | verify | FIXED 2026-10-18: `renderKV` rebuilt `#runkv` every 250 ms, replacing the touch target mid-swipe; it now updates text in place. Passes locally; CI 3-in-a-row not yet seen. Original note: Phone swipe Status → Graphics: the synthetic touch stops reaching `.main` after the first move (target replaced mid-swipe?), CI and sometimes locally, also before the merge. Find whether the Status pane re-renders under the finger; fix the app, not the test. | `sim/ui.js`, `tests/ui/run.mjs` | swipe checks pass 3 runs in a row in CI |
| B13 | todo | GPU offload design: material removal and previews on the GPU (three.js WebGPURenderer + compute, WebGL2 fallback), thumbnails in an OffscreenCanvas worker. Checks stay CPU (must match the server's tnc-core run). No custom drivers. | design note first, then `sim/stock.js` render side | — |

## OPEN — placeholders, NOT facts (settle via B5 or the operator; each is marked in code)
| id | where | placeholder |
|---|---|---|
| T1 | tnc-core exec.rs cycle_thread | helix = whole turns at thread depth, start on +X |
| T2 | tnc-core exec.rs cycle_thread | approach: semicircle from the centre, +½ pitch in Z; departure: flat semicircle; no small-tool side pre-positioning |
| T3 | tnc-core exec.rs cycle_thread | 267 start = R + pitch from the stud; ends above that point |
| T4 | tnc-core exec.rs cycle_thread | 263 countersink circle at the core Ø not simulated (plunge to Q356 only) |
| T5 | tnc-core exec.rs cycle_thread | 264 countersink feed = Q206 |
| T6 | tnc-core exec.rs cycles | positive depths: sign ignored (the manual says a positive depth reverses direction) |
| T7 | tnc-core exec.rs cycle_thread | no error for M4 / spindle off on 262/263/264/267 |
| SL1 | tnc-core sl.rs capture | a subcontour with R0 counts as a pocket |
| SL2 | tnc-core sl.rs field | only islands: sim error "SL CONTOUR WITHOUT POCKET NOT SIMULATED" |
| SL3 | tnc-core sl.rs plan/centre | rough-out plunges at the point of each innermost clearing loop farthest from the walls; channel loops start where the trace starts; clearing loops join at the nearest vertex |
| SL4 | tnc-core sl.rs reposition | between passes: straight at depth while the tool centre stays in the allowed area, else up to Q7, rapid to Q5+Q6, plunge at Q11 |
| SL5 | tnc-core sl.rs tool_r | 21: Q13 = 0 = the current tool |
| SL6 | tnc-core sl.rs run/train | sign of Q1 ignored (works into −Z), like T6 |
| SL7 | tnc-core sl.rs run | tool too big for the contour: TOOL RADIUS TOO LARGE (message not in the manual) |
| SL8 | tnc-core sl.rs run | 23: the rough-out loops once at the floor, straight plunge (manual: vertical tangential arc) |
| SL9 | tnc-core sl.rs side_finish | 24: quarter-arc in/out of radius R, halved until it fits; start at the first vertex where it fits best |
| SL10 | tnc-core sl.rs train | 25: rapid to Q5 + 2 mm, then Q11 |
| SL11 | tnc-core sl.rs run | channel direction by MP 7420 bit 0, clearing loops by Q9; Q8, Q18 (rest material), Q19, MP 7420 +4 not simulated; MP 7420 default 0 on the 426 profile, 8 on the 430 (operator's MP list) |
| SL12 | tnc-core sl.rs train | 25: climb = RL assumes M3; Q15 = ±1 goes up to Q7 between infeeds |
| SL13 | tnc-core sl.rs run | 24: down to Q1 (Q4 not kept); the p. 294 check Q14 + R < Q3 + rough-out R is not made |
| SL14 | tnc-core sl.rs field | more than two subcontours: each tested against the first one's start point (manual shows two); missing 14/20 = CYCL DEF INCOMPLETE |
| P1–P7 | tnc-core exec.rs run_probe | MP 6140 = 2 mm; Q261 tip = Q261 − stylus R; Q305=0 keeps cycle 7 on top; Q303=0 tables not simulated; presets translation-only; touch order from the figures; 419/Q381 write no results |
| V1 | tnc-core stock.rs vice | jaw axis Y, grip 6, jaw 160×25 — standard guess, not the operator's vice |
| K1 | ui.js coordinate keypad (wizPad/ck*), dialogs.js PAD | key list is the manual's (inside front cover, p. 66–67, 151, 357); NOT verified: END takes the typed entry before ending the dialog (p. 67 only says "end the dialog immediately"; p. 68 END = accept is about editing stored words), I and −/+ toggle the word being entered, I after a word with its value starts the next word (x10iy5 = X+10 IY+5), CE twice drops the axis, ACTUAL POSITION with no axis selected fills X Y Z (CC: X Y) = the MOD %00111 case, IV = B / V = A (machines.js order), CTP asks RC like CT, P during APPR/DEP coordinates → APPR P… / DEP PLCT keeping the form (block forms are the manual's, p. 155–157; the dialog route and the PLT/PLN forms rest on p. 134 "Cartesian or polar" only), PC-keyboard bindings (#, DELETE, ⇧ENTER) are sim-only |
| V2 | tnc-core stock.rs HEAD_LEN | tilted head = 300 mm cylinder of holder radius |

| AI1 | part.js FONT | the engraving capitals are the simulator's own single-stroke font (straight strokes, 45° corners), not a HEIDENHAIN or CAM font |
| AI2 | part.js compare | a feature-edge column (within half a grid cell of the outline) is not counted as a miss or gouge; tolerance 0.1 mm in Z |

## ASK — waiting on the user
- A1: React for the web app: keep as a thin shell, or replace? (D-REACT)
- A2: How does the operator move programs today, and does his 430 have the Ethernet card? (B3; user: "probably from a PC at his company, USB stick; Ethernet card should also be supported")
