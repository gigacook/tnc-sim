# CLAUDE.md — TNC 426/430 Simulator (rules; tasks live in CONTINUE.md)

## Goal
A program written here runs **the same** on a real HEIDENHAIN TNC 426/430: same moves, same errors, same timing.
Authority, in order:
1. `research/tnc426_430_280476_manual_en.txt` (426/430, NC SW 280 476; gitignored)
2. the programming station (`docs/PROGRAMMING-STATION.md`)
3. the operator's answers (`private/`)

The iTNC 530 manual counts only where the 426/430 sources are silent, labelled so in code.
Never present a guess as a fact: placeholders are marked in code and listed in CONTINUE.md → Open placeholders.

## Stack
| Part | What | Where |
|---|---|---|
| Engine | Rust `tnc-core`: parse, cycles, probing, radius compensation, checks, material model. One copy: native in the server, WebAssembly in the browser | `server/crates/tnc-core/` |
| Simulator | classic-script modules + three.js r186, built into one offline `index.html` by `python3 build.py` | `sim/`, `build.py` |
| Server | Rust: axum, SQLite, OpenRouter proxy | `server/` |
| Web app | React + Vite, hosts the simulator in an iframe | `web/` |
| Desktop | Tauri 2, runs the server in-process | `desktop/` |

`tests/parity.js` freezes the engine's behaviour (golden record). A change that alters it re-records the record in
the same commit and says why. A Rust change ships with `python3 build.py --wasm` (commits `sim/engine/tnc_core.wasm`).

## Rules
1. Authentic TNC behaviour, not "close enough".
2. Keyboard-first and fully interactive.
3. The simulator always also ships as one HTML file that works offline without the server.
4. AI = OpenRouter only, never Anthropic direct. Keys only in `private/.env` or on the server.
5. Name any install and ask first. Search GitHub, brew and npm before building something.
6. Keep `docs/FEATURES.txt` (the DEV tab) true.
7. No personal names or data in tracked files; that goes in `private/`.
8. No Claude attribution in commits or PRs.

## Working
- Main thread: engine, I/O, profiles, AI, server. Subagents: Sonnet for docs, Opus for anything judged by eye or by
  parity; worktree isolation, non-overlapping files.
- Don't build on an unconfirmed interpretation. Explain plainly.
- Every task: test, commit, push, then check it off in CONTINUE.md with date, verified via, tested on, commit.

## Tests
| Command | What it checks |
|---|---|
| `node tests/manual.js` | the 426/430 manual's examples and rules |
| `node tests/parity.js` | the behaviour freeze (`--record` to re-record on purpose) |
| `AUTOTOOLS=1 node tests/corpus.js` | 2,806 real programs from `search-heidenhain/clones` run without errors (not that the moves are right) |
| `node tests/part.js`, `node tests/ai/loop.js` | AI part measurement, AI loop (mocked) |
| `node tests/ui/run.mjs` | browser suite |
| `cd server && cargo test` | Rust |

Gitignored: `research/`, `search-heidenhain/`, `private/`, `local/` (scratch, logs), `node_modules/`, `.libcache/`.

## End-of-run report
```
SOLVED   - <what> — <why it mattered>
RISK     - <not verified against manual/station, or "none">
NEXT     - <one CONTINUE.md task #>
```
