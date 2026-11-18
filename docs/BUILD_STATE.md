# BUILD_STATE — dual frontend (Business / Play)

Branch `feat/dual-frontend`, started from `c6e6e7dc3bbfbd034aad64f711b9f35aca34a3f3` (main, 2026-11-16).
Spec: [BUILD_SPEC.md](BUILD_SPEC.md) (public-safe). Private extensions live outside the checkout.

## Architecture facts (verified 2026-11-18)
- Engine: Rust `server/crates/tnc-core`, native in the server, WASM in `sim/engine/tnc_core.wasm`. Not touched by the redesign.
- Simulator: classic-script modules in `sim/`, bundled by `python build.py` into `index.html` + `docs/index.html`.
  Plugin bus in `sim/ui.js` (`TNC_UI_PLUGINS`, `ui.on(event)`): scene, tool, tick, crash, resize, program, text, ready.
- Web: React 19 + Vite 8 in `web/`, hosts the simulator in a same-origin iframe (`/sim/`), `web/src/components/SimFrame.tsx`.
- Desktop: Tauri 2 in `desktop/`, bundles `web/dist` and `index.html`, runs the server in-process on 127.0.0.1.
- Machines: ids `"426"` (X Y Z) and `"430"` (swivel head A/B), `sim/machines.js`.

## Baseline (before any change, Windows 11, Node 26.2, Python 3.14.5, Rust 1.98.1)
See [TEST_REPORT.md](TEST_REPORT.md).

## Edition model
- One simulator. The redesigned machine workspace is the default everywhere (offline `index.html` too).
- `?edition=business|play` on the simulator URL (validated; anything else = `core`) sets `<html data-edition>`.
  `play` only adds: an "exit to workshop" control and the parent-driven interlock. No game logic inside `sim/`.
- Web shell: `/work` (Business) and `/play` (Play). Two Vite builds: `dist/business/`, `dist/play/` (repo root).
  Each contains the shell plus `sim/index.html` (a copy of the single-file build), so both run from a static host.
  Business must not import or request anything under `web/src/play/` or `media/`.
- Scripts (root `package.json`): `dev:business`, `dev:play`, `build:business`, `build:play`.
- Storage keys (localStorage, same origin): shared `tnc.settings.v1` (language, decimal character, skin, environment, quality, motion, sound, setup, tips);
  per edition `tnc.edition.business.v1`, `tnc.edition.play.v1`; game save `tnc.play.save.v1`. Existing keys are kept
  and migrated without deleting them. Credentials are never stored in the browser.

## Bridge contract v2 (`sim/bridge.js` <-> `web/src/lib/bridge.ts`)
Active when the simulator is in a same-origin iframe (with or without a server). Both sides check `origin`,
`source` and the payload shape; unknown types and malformed payloads are dropped. v1 messages are unchanged.

app -> sim
| type | payload | meaning |
|---|---|---|
| `tnc:open` | `{name, text, machine, tools?}` | v1: open / replace a program |
| `tnc:get` | `{id}` | v1: ask for the program on screen |
| `tnc:hello` | `{v:2}` | handshake; answered with `tnc:ready` |
| `tnc:present` | `{lang?:'sv'|'en'|'sr', skin?:'426'|'430', env?:'cold-steel'|'workshop-night', quality?:'low'|'medium'|'high', motion?:'full'|'reduced', sound?:boolean}` | presentation only |
| `tnc:machine` | `{machine:'426'|'430'}` | select the machine profile |
| `tnc:exec` | `{cmd:'start'|'stop'|'step'|'reset'}` | uses the simulator's own run controls |
| `tnc:camera` | `{view:'orbit'|'pov'|'tool'|'part'|'plan'}` | camera preset |
| `tnc:lock` | `{locked:boolean, reason?:string}` | Play interlock: NC start refused with `reason` while locked |
| `tnc:inspect` | `{panel:'compare'|'diag'|'ref'|'progs'}` | open the inspector on that tab |
| `tnc:tools:get` | `{id}` | ask for the tool table |
| `tnc:tools:set` | `{tools:[{t,name?,l,r,...}]}` | replace the tool table (same schema as `tnc:open` tools) |

sim -> app
| type | payload | meaning |
|---|---|---|
| `tnc:ready` | `{v:2, edition, machine, lang}` | v1 fields absent before; extra fields are additive |
| `tnc:program` | `{id, name, machine, text}` | v1 |
| `tnc:changed` | `{name, machine, text}` | v1 |
| `tnc:selected` | `{name, machine}` | v1 |
| `tnc:state` | `{running, cutting, mode, machine, tool:{t,r,l}|null, pos:{x,y,z,a,b}|null, spindle:{on,rpm}, coolant, progress, errors, done}` | at most 10 per second, and at once on a transition |
| `tnc:tools` | `{id, tools}` | answer to `tnc:tools:get` |
| `tnc:exit` | `{}` | Play: the user asked to leave the machine view |
| `tnc:settings` | `{lang, skin, env, quality, motion, sound}` | a setting changed inside the simulator |

## File ownership (lanes never edit each other's files)
| Lane | Owns |
|---|---|
| Lead (simulator) | `sim/**`, `build.py`, `tests/ui/**`, `tests/polar.js`, `tests/bridge.js`, `index.html`, `docs/index.html`, `docs/FEATURES.txt` |
| Web shell + Play | `web/**`, root `package.json` scripts, `desktop/**`, `tests/play/**`, `tests/e2e/**` |
| Showcase + media + docs | `examples/**`, `scripts/showcase-*.mjs`, `tests/showcase.js`, `media/**`, `docs/*.md`, `README.md`, `THIRD_PARTY_NOTICES.md` |
| Supervisor | this file, commits, `artifacts/` layout |

## Phases (state on 2026-11-18, HEAD `a3d6591`)
| Phase | State |
|---|---|
| 1 Baseline and risk proof | done: baseline in [TEST_REPORT.md](TEST_REPORT.md) section 1; the browser suite ran later (lane figure, section 4.4) |
| 2 Business vertical slice | built and committed (`0d2b033`, `408e14d`, `a3d6591`): workspace with the Inspector closed, settings, two skins, two environments, three languages, decimal character, polar editing, the AI view on the server API with New / Change current. Engine, polar, i18n, bridge and AI state checks re-run on the final tree (section 4.1) |
| 3 Play integration | built and committed (`65d7bac`, `2e7fcd7`, `6f6230b`): landing, workshop, both controls, tool change, power, oil, characters, measuring tool, walk pad, 333 comparison. Game rules re-run (`node --test tests/play/`); the browser checks are lane figures |
| 4 Visual production | the landing film source is in `media/landing-hyperframes/`; showcase thumbnails and all manual pictures were made again from the final build (section 4.2) |
| 5 Release checks | in progress: manuals (sv, en, sr), README, feature map, test report and pictures are final. Open: the items below |

## Open items (each can be checked in the tree)
| Item | Evidence | Next step |
|---|---|---|
| Browser suite, e2e scripts, cargo tests not re-run on the final tree | TEST_REPORT section 4.4 | run them in the final pass and replace the lane figures |
| Desktop apps not built or started in this pass | no build record in the tree | `npm run desktop:business`, `npm run desktop:play`, start each once |
| No live provider test of the AI | docs/AI_API.md: "No test calls the real OpenRouter" | owner decision: needs a key and credit |
| `node tests/ui/autosave.mjs` fails on one check | TEST_REPORT section 4.5 | fix in `sim/autosave.js` or accept; same on the starting commit |
| Four pictures in `docs/shots/` are referenced nowhere | `plan-view.png`, `prg-edit.png`, `run-3d.png`, `tool-table.png` (from before the redesign) | delete in the prune step |
| `after-ai-dialog.png` is not what `tests/e2e/capture-after.mjs` writes | TEST_REPORT section 4.2 | teach the script to start the server with the mock provider, or keep the picture and do not overwrite it |
| The page "The TNC server does not answer" and its button "Open the machine" are English only | `web/src/app.tsx` | add the three languages or leave as is |
| The old AI pass-through and `sim/ai.js` are still shipped | docs/AI_API.md, first section; `build.py` module list | decide whether `sim/ai.js` stays (the AI view takes its system prompt from it) |
| WebKit is not installed for Playwright | lane log: "SKIP [webkit] all checks" | install it or record Chromium only |
| No `.gitattributes` | TEST_REPORT section 1.1 | add `index.html text eol=lf` and the same for `docs/index.html` |
| Untracked files in `artifacts/business/`: `dbg.png`, `first-run-1920.png`, `shell-1440x900.png`, `shell-5120x1440.png`, `t-430-night.png`, `t-phone.png`, `t-polar.png`, `t-settings.png` | `git status` | commit the ones that are evidence, delete `dbg.png` |
| Feature map: seven old functions not found in the new interface | [FEATURE_MAP.md](FEATURE_MAP.md), section NOT FOUND | decide per row: restore or record as removed |

## Blockers
none

## Resume
1. `git -C <checkout> status` and read this file.
2. `npm ci`, `python build.py`, then the commands in TEST_REPORT.md.
3. Take the first open item above.
