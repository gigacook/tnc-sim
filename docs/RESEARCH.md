# RESEARCH — dual frontend (Business / Play)

Durable record of adopted versions and APIs, reference revisions, licences, decisions and rejected approaches.
Branch `feat/dual-frontend`. Every row carries its verification date. All facts below were read from this checkout
or from the named source on 2026-11-18; nothing is quoted from memory.

Related: [BUILD_STATE.md](BUILD_STATE.md), [../CONTINUE.md](../CONTINUE.md).

## 1. Adopted versions (installed, verified 2026-11-18)

Sources: root `package.json`, `package-lock.json`, `node_modules/<pkg>/package.json`; the same three under `web/`;
`desktop/src-tauri/Cargo.toml` + `Cargo.lock` + `tauri.conf.json`; `server/Cargo.toml`, `server/crates/*/Cargo.toml`,
`server/Cargo.lock`. Both lockfiles are `lockfileVersion` 3. `web/node_modules` is present in this checkout.
`desktop/` has no `package.json`; the Tauri CLI is the root dev dependency.

### npm packages

| Package | Declared (manifest) | Locked (lockfile) | Installed (node_modules) | Used for | Verified |
|---|---|---|---|---|---|
| three (root) | 0.186.1 | 0.186.1 | 0.186.1 | simulator renderer, bundled into `index.html` by `build.py` | 2026-11-18 |
| three (web) | 0.186.1 | 0.186.1 | 0.186.1 | 3D in the web shell | 2026-11-18 |
| three.quarks (root) | 0.17.1 | 0.17.1 | 0.17.1 | particle effects, bundled with three as `window.QUARKS` | 2026-11-18 |
| playwright (root) | 1.56.1 | 1.56.1 | 1.56.1 | browser suite `tests/ui/` | 2026-11-18 |
| @axe-core/playwright (root) | 4.13.0 | 4.13.0 | 4.13.0 | accessibility checks in the browser suite | 2026-11-18 |
| esbuild (root) | 0.28.2 | 0.28.2 | 0.28.2 | bundles three + addons + three.quarks into one classic script for `build.py` | 2026-11-18 |
| @tauri-apps/cli (root) | 2.12.1 | 2.12.1 | 2.12.1 | `npm run tauri` (desktop build and dev) | 2026-11-18 |
| react (web) | ^19.3.0 | 19.3.0 | 19.3.0 | web shell UI | 2026-11-18 |
| react-dom (web) | ^19.3.0 | 19.3.0 | 19.3.0 | web shell DOM renderer | 2026-11-18 |
| react-router (web) | ^8.4.0 | 8.4.0 | 8.4.0 | web shell routes (the router package is `react-router`; there is no `react-router-dom`) | 2026-11-18 |
| vite (web) | ^8.3.1 | 8.3.1 | 8.3.1 | web shell dev server and builds | 2026-11-18 |
| typescript (web) | ^7.0.2 | 7.0.2 | 7.0.2 | `tsc --noEmit` type check | 2026-11-18 |
| @vitejs/plugin-react (web) | ^6.1.1 | 6.1.1 | 6.1.1 | React support in Vite | 2026-11-18 |
| @tanstack/react-query (web) | ^5.104.0 | 5.104.0 | 5.104.0 | server data in the web shell | 2026-11-18 |
| @types/three (web) | 0.186.0 | 0.186.0 | 0.186.0 | three.js types | 2026-11-18 |

Note: `web/package.json` and `web/package-lock.json` had uncommitted changes when this was read (`git status`);
the values above are the working-tree values at that moment.

### Rust crates

| Crate | Declared (Cargo.toml) | Locked (Cargo.lock) | Used for | Verified |
|---|---|---|---|---|
| tauri | 2.12 (`desktop/src-tauri/Cargo.toml`) | 2.12.1 (`desktop/src-tauri/Cargo.lock`) | desktop shell | 2026-11-18 |
| tauri-build | 2.5 | 2.7.1 | desktop build script | 2026-11-18 |
| tauri-plugin-single-instance | 2.5 | 2.5.2 | one running desktop instance | 2026-11-18 |
| tauri-plugin-opener | 2.7 | 2.7.0 | open links outside the app | 2026-11-18 |
| wry | not declared (transitive) | 0.57.0 | WebView layer under Tauri | 2026-11-18 |
| axum | 0.8 (`server/crates/tnc-server/Cargo.toml`) | 0.8.9 (server and desktop lockfiles) | HTTP server | 2026-11-18 |
| tokio | 1 | 1.53.1 (`server/Cargo.lock`), 1.53.2 (`desktop/src-tauri/Cargo.lock`) | async runtime | 2026-11-18 |
| sqlx | 0.8 (features: runtime-tokio, sqlite, migrate, macros) | 0.8.6 | SQLite access; there is no `rusqlite` | 2026-11-18 |
| serde | 1 | 1.0.229 | serialisation | 2026-11-18 |
| serde_json | 1 | 1.0.151 | JSON | 2026-11-18 |
| tower-http | 0.6 | 0.6.11 | static files, gzip, headers | 2026-11-18 |
| reqwest | 0.12 | 0.12.28 | OpenRouter proxy | 2026-11-18 |

`desktop/src-tauri/tauri.conf.json`: schema `https://schema.tauri.app/config/2`, app version 0.1.0,
`frontendDist` `../splash`, bundles `web/dist/` as `web/` and the root `index.html` as `sim/index.html`,
`withGlobalTauri` false. The file carries no Tauri version of its own.
Declared minimum Rust: 1.90 (desktop), 1.80 (server workspace).

### Toolchain on this machine

| Tool | Command | Output | Verified |
|---|---|---|---|
| Node.js | `node --version` | v26.2.0 | 2026-11-18 |
| Python | `python --version` | Python 3.14.5 | 2026-11-18 |
| rustc | `rustc --version` | rustc 1.98.1 (48a229cea 2026-09-01) | 2026-11-18 |
| cargo | `cargo --version` | cargo 1.98.1 (797e8a9bc 2026-08-05) | 2026-11-18 |

### three.js revision and vendored libraries

| Item | Version | Where the version is visible | Verified |
|---|---|---|---|
| three.js revision string (`THREE.REVISION`) | `186` | `node_modules/three/build/three.core.js` line 6: `const REVISION = '186';`. The simulator reads `THREE.REVISION` in `sim/fx.js` and `sim/ui.js` | 2026-11-18 |
| three vendor bundle | 0.186.1 | `build.py` `T_VER = '0.186.1'`; cache file `.libcache/three-vendor-0.186.1.js` (945,842 bytes, contains the string `"186"`); built by esbuild from `sim/vendor/three-entry.mjs` | 2026-11-18 |
| JSZip | 3.10.1 | `build.py` LIBS URL `jszip@3.10.1/dist/jszip.min.js` and label "MIT"; banner `JSZip v3.10.1` and `version="3.10.1"` inside `.libcache/jszip.js`. The banner says dual licensed MIT or GPLv3 | 2026-11-18 |
| idb-keyval | 6.2.2 | only in `build.py` LIBS: URL `idb-keyval@6.2.2/dist/umd.js` and label "Apache-2.0". `.libcache/idb-keyval.js` (4,805 bytes) carries no version string or licence banner | 2026-11-18 |

`build.py` inlines, in this order: the three vendor bundle, then each LIBS entry (JSZip, idb-keyval). LIBS files
are fetched once from jsDelivr into `.libcache/` (gitignored) and reused.

## 2. Reference repositories (read-only)

Read through the GitHub API (`gh api`) on 2026-11-18. Nothing from these repositories has been copied into this
repository by this record. Their skill files and setup instructions were not run.

| Repository | Revision inspected (commit SHA, date) | Licence (as stated in the repository) | What was read | Use here | Verified |
|---|---|---|---|---|---|
| `nextlevelbuilder/ui-ux-pro-max-skill` | `7436a6e0b6dc3add7c12d5b6ef1ccd3d410dd7fd`, 2026-11-18 (branch `main`) | MIT (`LICENSE`: "MIT License, Copyright (c) 2024 Next Level Builder"; API field `MIT`). Exception inside the repository: `.claude/skills/ui-styling/LICENSE.txt` is Apache License 2.0 | repository metadata, `LICENSE`, the head of `ui-styling/LICENSE.txt`, the list of `SKILL.md` paths | design-system, compact-interface and accessibility review guidance | 2026-11-18 |
| `nabinkhair42/structural-grid-skill` | `357ea473b444e9ae065be1ec4fea3ec7435da21e`, 2026-02-19 (branch `main`) | MIT (`LICENSE`: "MIT License, Copyright (c) 2026 nabinkhair42"; API field `MIT`) | repository metadata, `LICENSE`, file list (`LICENSE`, `README.md`, `SKILL.md`) | landing page grid language | 2026-11-18 |
| `vercel-labs/agent-skills` (skill `react-best-practices`) | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`, 2026-10-27 (branch `main`); last commit touching the skill path: `dc8367e6f91c022d83361f03c3313fa05e848ee5`, 2026-04-14 | No licence file in the repository (API licence field is null, `/license` returns 404, no path matching licence/copying/notice in the tree). Stated in text only: root `README.md` section "License" says "MIT"; `skills/react-best-practices/SKILL.md` front matter says `license: MIT`. Full licence text: not verified | repository metadata, full tree listing, `README.md` licence section, the skill's `SKILL.md` front matter and `metadata.json` | rendering, bundle and data-flow guidance for the web shell | 2026-11-18 |
| `heygen-com/hyperframes` | `3b79b1858e2feb1ebc6b549d7e418f697ba1eabc`, 2026-11-18 (branch `main`) | Apache-2.0 (`LICENSE`: Apache License Version 2.0, "Copyright 2026 HeyGen, Inc."; API field `Apache-2.0`). Registry blocks carry their own third-party licence and notice files (fonts, shaders, GSAP, three.js) | repository metadata, `LICENSE`, `README.md` licence and requirements lines, `packages/cli/package.json`, list of licence and notice paths; npm registry | HTML-to-video rendering of the Play landing background (local render only) | 2026-11-18 |
| `shorepine/kenney` | `3694c6879e487c108f55677be7dd2ca75b07cc3b`, 2026-08-30 (branch `main`) | CC0 as stated for the art: `README.md` says "All art is Kenney's, released under Creative Commons Zero (see LICENSE.txt)". API field is `NOASSERTION`. `LICENSE.txt` is the only licence file in the tree and its heading names one kit, "Castle Kit (2.0)", with "License: (Creative Commons Zero, CC0)". Per-kit licence files for the other 48 kits: none in the repository | repository metadata, `LICENSE.txt`, `README.md`, top-level listing, `3d/` kit list, full tree searched for licence files (54,176 entries, not truncated) | candidate CC0 glTF props for the workshop; each asset file to be verified before use | 2026-11-18 |

Notes under the table:

- `vercel-labs/agent-skills`: the skill lives at `skills/react-best-practices/` (`SKILL.md`, `AGENTS.md`, `README.md`,
  `metadata.json`, `rules/`), with a zipped copy at `skills/react-best-practices.zip` and a build package at
  `packages/react-best-practices-build/`. The skill's own name in its front matter is `vercel-react-best-practices`,
  version "1.0.0". The licence is "MIT" by statement only; because no licence text is present, the copyright holder
  line and the exact terms are `not verified`. The API call `repos/vercel-labs/agent-skills/license` failed with
  HTTP 404, and `raw.githubusercontent.com/.../main/LICENSE` and `LICENSE.md` both returned 404.
- `heygen-com/hyperframes`: `npm view hyperframes version license engines --json` returned version 0.9.65, licence
  Apache-2.0, engines `node >=22` (2026-11-18). `packages/cli/package.json` in the repository gives the same three
  values under the name `@hyperframes/cli`. The README also lists FFmpeg as a requirement. Node on this machine is
  v26.2.0, which meets `>=22`. The package is not installed in this checkout.
  Later the same day: `hyperframes@0.9.65` is pinned exactly and installed project-locally in
  `media/landing-hyperframes/` (own `package.json` and `package-lock.json`; `npx hyperframes --version` there
  prints 0.9.65). 0.9.65 is the `latest` dist-tag, eleven patch releases after the 0.9.54 the brief had seen;
  same licence and engine range.
- `shorepine/kenney`: the repository is a re-organised copy of Kenney's asset library made by a third party
  (`README.md`: built by `tools/build_tree.py` from a Kenney all-in-1 dump; `3d/` holds 4,812 glTF-binary models in
  49 kits). The CC0 statement for all art comes from that README; the one licence file names a single kit. A code or
  repository licence does not cover a model by itself, so each file taken from here is checked against the original
  pack on kenney.nl before use and listed in the third-party notices. No asset has been taken yet.
- `nextlevelbuilder/ui-ux-pro-max-skill`: the tree also holds `google-font-licenses.json` data files; fonts named
  there keep their own licences. Only guidance is used, no fonts or data files.

## 3. Decisions

| Decision | Why | Verified / decided on |
|---|---|---|
| Keep Rust `tnc-core` as the single engine (native in the server, WASM in the browser). No second interpreter | One copy of the behaviour is what `tests/parity.js` freezes; the redesign does not touch the engine | 2026-11-18 |
| Keep the React + Vite web shell, the three.js renderer and the Tauri desktop shell | They are installed, locked and working (section 1); the redesign is about the frontends, not the stack | 2026-11-18 |
| Keep the same-origin iframe boundary; extend the `tnc:*` postMessage bridge instead of reading the iframe DOM | The bridge is a checked contract (origin, source, payload shape); v1 messages stay unchanged, v2 adds to them. See BUILD_STATE.md, "Bridge contract v2" | 2026-11-18 |
| One simulator with `?edition=business|play`; two Vite builds, `dist/business/` and `dist/play/` | One code base for the machine view; each build holds the shell plus a copy of the single-file simulator, so both run from a static host | 2026-11-18 |
| Keep the self-contained offline `index.html` | Project rule: the simulator always also ships as one HTML file that works without the server | 2026-11-18 |
| Showcase programs are generated deterministically by `scripts/showcase-gen.mjs` (no AI), verified through the browser's WASM engine path by `scripts/showcase-verify.mjs`, with thumbnails taken from the real simulator by `scripts/showcase-thumbs.mjs` | Same input gives the same program; what is shown is what the shipped engine actually runs and draws | 2026-11-18 |
| Showcase programs use only the built-in tool table | They run in a fresh simulator with no setup and no imported tool file | 2026-11-18 |
| Credentials are never stored in the browser | Keys stay in `private/.env` or on the server (project rule); browser storage holds settings and saves only | 2026-11-18 |
| HyperFrames is used only as an offline HTML-to-video tool, not as the live workshop engine | The live workshop is three.js in the web shell; HyperFrames renders a video file locally ahead of time | 2026-11-18 |

State of the showcase scripts in this checkout on 2026-11-18: `scripts/showcase-gen.mjs`,
`scripts/showcase-verify.mjs` and `scripts/showcase-thumbs.mjs` exist and were run; results are in
[TEST_REPORT.md](TEST_REPORT.md).

Showcase decisions taken while writing the programs (2026-11-18):

| Decision | Why | Verified / decided on |
|---|---|---|
| The verifier runs each program with only the tools its manifest entry declares, auto-tools off | A TOOL CALL for an undeclared tool becomes an engine error instead of a silently created tool | 2026-11-18, `node tests/showcase.js` |
| Removed volume is integrated from the height field, stamped as `sim/ui.js` `cutSeg` does | The engine's `stats.removedVolume` is a path-length estimate (2 x R x depth x length) and overstates overlapping passes | 2026-11-18, both values are in `artifacts/showcase/report.json` |
| Native comparison through a small runner over `tnc_engine::check_now`, generated into `local/showcase-native/` and built with cargo | The repository has no native command-line entry; `mcp/tnc-mcp.mjs` uses the WASM module | 2026-11-18, 31 of 31 runs agree |
| Linear travel is checked as a span against `sim/machines.js` limits, not as absolute positions | The engine enforces limits for the rotary axes only (`LIMIT SWITCH A / B`); the X / Y / Z limits are machine coordinates with no datum offset modelled | 2026-11-18, read in `server/crates/tnc-core/src/lib.rs` |
| Thumbnails move the simulator's own camera to frame the blank and copy the WebGL canvas | The default view frames the retracted tool as well, and the canvas shape depends on the layout being redesigned | 2026-11-18, 16 pictures viewed |

Hero film decisions (`media/landing-hyperframes/`, 2026-11-18):

| Decision | Why | Verified / decided on |
|---|---|---|
| The film is an original WebGL piece; no owner animation was reused | The owner's motion library (`motion-fx.html`, `motion-fx.js`, `motion.html` and the `fx` folder of the brand folder) holds interface effects (path draw, glare sweep, stagger, beams), no large industrial grid animation. Substitution: an original mechanical grid reveal, steel blocks locking in from the centre over a blue light well | 2026-11-18, those four places opened and read |
| No HyperFrames registry block is used | `hyperframes catalog --query "mechanical grid reveal blueprint lines industrial"` returned transition showcases (`transitions-mechanical`, `transitions-grid`) and UI reveals, nothing that is a 3D grid build | 2026-11-18, word-match tier |
| Five three.js shots drawn from the `hf-seek` time; the overlay is a HyperFrames sub-composition with GSAP | HyperFrames seeks frames out of order: every frame is a pure function of the time, random values come from a seeded generator, no timers or clocks | 2026-11-18, `hyperframes check` passes with 0 errors |
| The loop is closed by a wipe that ends on the last frame | Each shot is wiped in during the 0.5 s before its cut and already moves under the wipe, so the wipe into shot 1 runs out exactly where the film restarts | 2026-11-18, first and last frame compared side by side |
| GSAP, three.js and the JetBrains Mono files come from `node_modules` at render time and are not tracked | Nothing is fetched while rendering, and no third-party file enters the repository for the film | 2026-11-18, `npm ci` then `node render.mjs` from a fresh `node_modules` |
| Size limits decide the encoder quality: `render.mjs` raises the CRF until `hero.mp4` is under 6 MB and `hero.webm` under 5 MB | The film is dense (hard edges, moving highlights); a fixed quality would miss the limits | 2026-11-18, H.264 CRF 29 gives 5.55 MB, VP9 CRF 48 gives 4.59 MB; decoded frames viewed, text readable |
| The controller is a panel of its own design with generic key legends and conversational program text | No real product is copied; the program lines are plain NC text of the kind the simulator runs | 2026-11-18 |

## 4. Rejected approaches

| Decision | Why | Verified / decided on |
|---|---|---|
| Rewriting the engine or removing Rust | The Rust engine is the single frozen behaviour (parity record); a rewrite would put authenticity at risk for no gain | 2026-11-18 |
| A second JavaScript interpreter for the workshop view | Two interpreters drift apart; the workshop drives the one simulator through the bridge | 2026-11-18 |
| A `gh-pages` branch | The site stays in `/docs` on `main` | 2026-11-18 |
| Paid AI generation for showcase content | Showcase programs come from a deterministic script; no cost, repeatable | 2026-11-18 |
| Upgrading dependencies beyond the existing lockfiles without need | The locked versions are installed and working (section 1); an upgrade adds risk the redesign does not need | 2026-11-18 |
| Copying proprietary HEIDENHAIN or game assets | Not ours to ship; only original work or assets with a verified open licence | 2026-11-18 |
| Storing API keys in localStorage | Any script on the origin can read it; credentials never live in the browser | 2026-11-18 |
| Involute gear generation presented as certified | The gear showcase is a visual outline only, not a checked tooth form | 2026-11-18 |
| FK programming and cycles 27 / 28 in showcase programs | The engine does not simulate them: FK blocks report FK NOT SIMULATED (CONTINUE.md #7) and cycles 27 / 28 are refused as CYCLE n NEEDS A ROTARY TABLE (CONTINUE.md #13, placeholder CS1) | 2026-11-18 |
