# TEST_REPORT: dual frontend (Business / Play)

Commands actually run, with their results. Nothing is listed here that was not executed.
Machine: Windows 11, Node 26.2.0, Python 3.14.5, Rust 1.98.1. Branch `feat/dual-frontend`, started from `c6e6e7d`.

Related: [BUILD_STATE.md](BUILD_STATE.md), [RESEARCH.md](RESEARCH.md), [FEATURE_MAP.md](FEATURE_MAP.md).

## 1. Baseline, before any change (2026-11-18, measured by the supervisor)

| Command | Result |
|---|---|
| `npm ci` | ok |
| `python build.py` | ok, prints `2,027,011 bytes`. The output differs from the checked-out `index.html` (2,043,911 bytes). Cause found, see 1.1 |
| `node tests/manual.js` | ALL MANUAL EXAMPLES PASS |
| `node tests/post.js` | 34 of 36 block shapes run, 2 correctly refused, 0 open |
| `node tests/parity.js` | 5550 / 5550 identical to the record |
| `node tests/part.js` | pass |
| `node tests/ai/loop.js` | pass (mocked OpenRouter) |
| `cargo test --manifest-path server/Cargo.toml` | all ok |
| `web`: `npm ci`, `npm run build` | ok |
| `node tests/ui/run.mjs` | could not start: the pinned Playwright browser was missing (install in progress at that time) |

### 1.1 Why `python build.py` "changed" `index.html` at the starting commit (investigated 2026-11-18)

The build is reproducible; the difference is line endings only.

| Check | Command | Result |
|---|---|---|
| Size of the committed file inside git | `git cat-file -s c6e6e7d:index.html` | 2,027,989 bytes |
| Lines in it | `git show c6e6e7d:index.html \| wc -l` | 15,922 |
| Line-ending setting of this checkout | `git config --get core.autocrlf` | `true`; there is no `.gitattributes` |
| Clean copy of the starting commit, rebuilt | `git archive c6e6e7d \| tar -x` into a temp folder, `.libcache` copied in, `python build.py` | prints `2,027,011 bytes`; the file on disk is 2,027,989 bytes |
| Rebuilt file against the committed blob | `git show c6e6e7d:index.html \| cmp - <rebuilt index.html>` | identical, byte for byte |
| Rebuilt `index.html` against rebuilt `docs/index.html` | `cmp` | identical |

- Git checks the file out with CRLF line endings on this machine: 2,027,989 + 15,922 = 2,043,911 bytes.
  `build.py` writes LF (`newline='\n'`), so the rebuilt file is 2,027,989 bytes and git shows it as modified until
  it is staged, although the content is the same.
- The number `build.py` prints (2,027,011) is the character count (`len(doc)`), not the byte count; the page has
  non-ASCII characters, so the UTF-8 file is 978 bytes longer.
- Not a build problem and not a dependency drift. A `.gitattributes` line `index.html text eol=lf` (and the same
  for `docs/index.html`) would stop the false "modified" state; not added here, the file belongs to another lane.

## 2. Showcase programs (2026-11-18, showcase lane)

Engine under test: `sim/engine/tnc_core.wasm` loaded by `sim/engine.js`
(sha256 `dd23cb13e4de38b0423d61d8bc7d1c856249111045b0494b292ecb5a2f112aa7`), the module `build.py` inlines into `index.html`.

| Command | Result |
|---|---|
| `node scripts/showcase-gen.mjs` | wrote 16 programs and `manifest.json` to `examples/showcase/` |
| `node scripts/showcase-gen.mjs --check` | 16 programs and the manifest match the generator |
| `node tests/showcase.js --native` | ALL PASS, exit 0: 10 checker fixtures, 8 file checks, 16 of 16 programs, native agrees with WASM on 31 of 31 runs, report written |
| `node tests/showcase.js` | ALL PASS, exit 0 (WASM only; the native comparison of the same programs and engine is carried over) |
| `node scripts/showcase-thumbs.mjs` | 16 thumbnails, 640 x 400 PNG, in `examples/showcase/thumbs/`; browser Chromium build 1243 from the shared Playwright cache (the pinned build 1194 was not installed yet) |
| `node tests/manual.js` | ALL MANUAL EXAMPLES PASS (re-run after the showcase work) |
| `node tests/post.js` | 34 of 36 run, 2 correctly refused, 0 open (re-run) |
| `node tests/parity.js` | 5550 / 5550 identical to the record (re-run) |
| `node tests/part.js` | ALL PART-SPEC CHECKS PASS (re-run) |

The showcase lane changed no engine, simulator, web or server file; the four re-runs above confirm the engine
behaves as at the baseline.

### 2.1 What `tests/showcase.js` checks

1. The checker itself: green on a known-good program, red on nine broken ones, each for its own reason (undeclared
   tool, rapid into material, air cutting, no M2, cut through the bottom, low rapid across the blank, tool change
   near the part, cut outside the expected envelope, declared tool never used).
2. The files: the sixteen names, each `.H` equal to the generator's output, manifest fields complete in Swedish and
   English, `05_POLAR_STAR` written with `CC` + `LP PR / PA`, `15_430_SWIVEL` using cycle 19 and listed for the 430
   only, `09_GEAR_OUTLINE` saying it is not a certified involute gear, a 640 x 400 PNG per program.
3. Each program on every machine it lists (01 to 14 and 16 on the 426 and the 430, 15 on the 430), with only the
   tools its manifest entry declares and auto-tools off: no engine error; M2 reached and the tool retracted;
   every used tool declared, every declared tool used and equal to the built-in table entry; no crash, warning or
   through-cut event from the engine's safety analysis with the vice on (rapid into material, holder, vice, spindle
   off, chip load, spindle maximum); no low rapid across the blank and no tool change near the part; cutting inside
   the blank's depth, at the expected lowest Z and inside the expected envelope; travel span inside the machine's;
   removed volume from the height field above the expected minimum; a finite cycle time.

### 2.2 Results per program (`artifacts/showcase/report.json`, copied into `examples/showcase/manifest.json`)

| Program | Machines | Cycle time 426 / 430 (s) | Removed (cm3) | Lowest cut Z | Tools |
|---|---|---|---|---|---|
| 01_NAMEPLATE.H | 426, 430 | 307.0 / 330.2 | 4.45 | -1.5 | T9, T4 |
| 02_STEPPED_POCKET.H | 426, 430 | 311.1 / 234.1 | 62.81 | -18 | T5 |
| 03_SPIRAL_POCKET.H | 426, 430 | 138.1 / 156.3 | 30.74 | -8 | T5 |
| 04_BOLT_CIRCLE.H | 426, 430 | 141.8 / 185.4 | 15.24 | -16 | T1, T2, T5 |
| 05_POLAR_STAR.H | 426, 430 | 162.6 / 170.8 | 10.83 | -3 | T4 |
| 06_ROUNDED_PLATE.H | 426, 430 | 131.7 / 149.1 | 27.74 | -12.5 | T6, T5, T2 |
| 07_HELIX_BORE.H | 426, 430 | 222.8 / 228.8 | 27.25 | -18 | T5 |
| 08_CONTOUR_ISLAND.H | 426, 430 | 508.5 / 659.2 | 42.92 | -8 | T5, T4 |
| 09_GEAR_OUTLINE.H | 426, 430 | 215.9 / 224.2 | 39.77 | -6 | T5, T4 |
| 10_COOLANT_SWEEP.H | 426, 430 | 90.1 / 96.4 | 10.62 | -3.5 | T6, T22 |
| 11_Q_PATTERN.H | 426, 430 | 130.0 / 139.0 | 1.73 | -1 | T9 |
| 12_SUBPROGRAM_GRID.H | 426, 430 | 107.4 / 121.4 | 9.00 | -3 | T4 |
| 13_RADIUS_COMP.H | 426, 430 | 65.4 / 70.5 | 8.52 | -6 | T4 |
| 14_MULTI_TOOL.H | 426, 430 | 249.5 / 264.3 | 34.25 | -18.5 | T6, T5, T4, T1, T2, T3, T8 |
| 15_430_SWIVEL.H | 430 | - / 205.7 | 30.73 | -21 | T15, T2 |
| 16_5511_SHOWCASE.H | 426, 430 | 292.6 / 318.1 | 19.37 | -4 | T5, T4, T9, T1 |

All sixteen: 0 errors, 0 crash events, 0 warnings, 0 through-cut notes on every listed machine.
Cycle times differ between the machines because the 430 profile has its own rapid rates, feed cap (1500 mm/min)
and pocket overlap factor (`sim/machines.js`). Cycle time leaves out dwell, tool changes and acceleration.

### 2.3 Native engine

`node tests/showcase.js --native` generates a small runner (`local/showcase-native/`, gitignored) that calls
`tnc_engine::check_now` from `server/crates/tnc-engine` with the same text, machine and tools, builds it with
`cargo build --release` and compares with the WASM run: move count, feed path, rapid path, cycle time, lowest and
highest Z, the engine's volume estimate, the error list and the crash / warning list.
Result 2026-11-18: 31 of 31 runs agree (15 programs on two machines, one on the 430); interpreter version
`261e506332f0f6dc`.

### 2.4 Thumbnails

`scripts/showcase-thumbs.mjs` opens the built `index.html`, loads each program with
`window.TNC_UI.open(name, text, {machine, tools})`, presses `4` (FULL-RUN), `9` (MAX) and `SPACE`, waits until
`TNC_UI.state.t` reaches `TNC_UI.state.total`, moves the simulator's own camera to frame the blank and copies the
WebGL canvas to 640 x 400. It fails when the simulator reports an error or a crash event, the run does not finish
or the picture is blank. All sixteen pictures were viewed on 2026-11-18. Two programs were changed after viewing:
`13_RADIUS_COMP` (the APPR / DEP lead-in cut marks into the part; each pass now plunges on its own offset path) and
`15_430_SWIVEL` (the sloped face was small and seen from behind; it is now 40 mm long and the manifest gives the
view direction).

The pictures were taken from the `index.html` of the working tree while the simulator was being redesigned;
re-run the script after the redesign so they show the final look.

### 2.5 Known limits of these checks

- No real control or programming station has run these programs; the checks are the simulator's own.
- Linear travel is checked as a span (the engine enforces limits for the rotary axes only).
- The engine's material model is a height field: the tilted holes of `15_430_SWIVEL` show without their undercut.
- `08_CONTOUR_ISLAND` relies on the simulator's own SL cycle paths (CONTINUE.md placeholders SL3, SL4, SL8, SL9,
  SL11, SL13, SL14); the manifest lists them.
- Chip-load and holder checks use the built-in tool table and the ISO 50 holder (A = 100 mm).

## 3. Records (2026-11-18)

| Command | Result |
|---|---|
| `git mv docs/BUILD-SPEC.MD docs/BUILD_SPEC.md`, then the public-safe edit | done; the working file has no personal names. The index still holds the old content until the file is staged again (`git add docs/BUILD_SPEC.md`) |
| `git grep -l -i -I -E "<the two personal names>"` (tracked files, working tree) | no file |
| `git grep --cached -l -i -I -E "<the two personal names>"` (index) | `docs/BUILD_SPEC.md` only (the staged rename, see above) |
| the same search over untracked, not ignored files | no file |
| `git log --oneline -S"<surname>" -i --all` | 8 commits in the history contain the surname, among them the starting commit `c6e6e7d` (the verbatim spec); history is not changed by this work |

## 4. This branch, final documentation pass (2026-11-18)

Tree: `feat/dual-frontend` at `a3d6591` plus the documentation and picture changes of this pass. No file under
`sim/`, `web/src/`, `server/`, `tests/` or `build.py` changed after these commands ran (newest source file 13:07,
first command 13:20). Machine as above; Chromium build 1243 from the shared Playwright cache
(`PW_CHROMIUM` set to its `chrome.exe`).

### 4.1 Commands run in this pass

| Command | Result |
|---|---|
| `python build.py` | ok, prints `2,210,441 bytes`, 21 modules, `showcase: 16 programs`; run again at the end: `index.html` and `docs/index.html` equal the committed files |
| `npm run build:business` | ok, `dist/business` written |
| `npm run build:play` | ok, `dist/play` written (one chunk-size note from Vite); run again after the comparison pictures changed |
| `node tests/manual.js` | ALL MANUAL EXAMPLES PASS |
| `node tests/post.js` | 34 of 36 block shapes run, 2 correctly refused, 0 open |
| `node tests/parity.js` | 5550 / 5550 identical to the record |
| `node tests/part.js` | ALL PART-SPEC CHECKS PASS |
| `node tests/polar.js` | ALL 195 POLAR CHECKS PASS |
| `node tests/i18n.js` | ALL 40 LANGUAGE CHECKS PASS (shell keys 229, control text 58, script text 109, patterns 56) |
| `node tests/bridge.js` | 75 passed, 0 failed: BRIDGE CONTRACT v2: ALL CHECKS PASS |
| `node tests/showcase.js` | ALL PASS, 16 of 16 programs; run twice, before and after the thumbnails were made again. The line "native engine agrees with WASM on 31 of 31 runs" is the carried-over comparison of section 2.3, not a new native run |
| `node tests/ai/loop.js` | ALL AI LOOP CHECKS PASS (mocked, no network) |
| `node tests/ai/dialog-state.js` | all passed |
| `node tests/ai/no-browser-key.js` | all 14 passed |
| `node --test tests/play/` | 36 passed, 0 failed |
| `cargo build --manifest-path server/Cargo.toml -p tnc-server` | ok (up to date); the binary was needed for the AI pictures |
| `node scripts/showcase-thumbs.mjs` | 16 thumbnails, 640 x 400, from the final `index.html`; all sixteen viewed, each shows its cut part |
| `node scripts/shots-before.mjs local/before-index.html artifacts/before` | four pictures; prints `run finished by the START soft key at speed MAX` with the run position at 1000 of 1000 and PROGRAM END |
| `node tests/e2e/capture-after.mjs` | four pictures written to `web/public/play/after/` |
| `node C:\Users\User\gigacook\core\conventions\lint\gc-lint.mjs` on the changed files | 0 FAIL, 0 WARN on README.md, the three manuals, FEATURE_MAP.md, TEST_REPORT.md, BUILD_STATE.md and scripts/shots-before.mjs |

### 4.2 Pictures made in this pass

All are captures of the running program; none is drawn or edited. No key and no personal data is in any of them.

| Pictures | Made from | How |
|---|---|---|
| `docs/shots/business-*.png` (15, not counting the two AI pictures below) | `dist/business` served on 127.0.0.1, 1440 x 900, Swedish; `business-phone.png` at 390 x 844; `business-serbian.png` with the language set to Srpski | a scratch Playwright script (`local/llm/docs-shots/capture2.mjs`, not tracked) that clicks and types as a user does |
| `docs/shots/business-ai-nokey.png`, `business-ai-done.png` | the built `index.html` served by the real `tnc-server` binary, with the MOCK provider of `tests/ai/server-mock-provider.mjs` | no key is typed in any picture: the no-key picture is taken first; for the finished job the mock key is sent to the server from script. The model names in the pictures are the mock's |
| `docs/shots/play-*` (12) | `dist/play` served on 127.0.0.1, 1440 x 900, Swedish; `play-phone-pad.jpg` at 390 x 844 with touch | the same script |
| `examples/showcase/thumbs/*.png` (16) | `index.html` | `scripts/showcase-thumbs.mjs` |
| `artifacts/before/*.png`, copied to `web/public/play/before/` (4) | `local/before-index.html`, the build of the starting commit | `scripts/shots-before.mjs`, see 4.3 |
| `web/public/play/after/after-{main,new-menu,run}.png` | `dist/play`, the plain simulator, English | `tests/e2e/capture-after.mjs` |
| `web/public/play/after/after-ai-dialog.png` | the built `index.html` served by `tnc-server` with the mock provider, English, 1920 x 1080, no key | the scratch script. `capture-after.mjs` serves static files only, where the AI tab is the one line "AI needs the local or hosted server"; that picture was replaced by this one, which shows the whole AI view. Running `capture-after.mjs` again puts the one-line picture back |

Each before / after pair was viewed side by side: NAMEPLATE.H in all eight, idle in main, new menu and AI dialog,
run to the end in the run pair (elapsed 17:08.5 of 17:08.5 in both).

### 4.3 What was wrong with `before-run.png`

The script hid the old build's profile dialog by setting `hidden` on the element. The old page still held the
dialog as open, kept the page behind it inert and ignored mode keys and soft keys, so the picture showed an idle
workspace in TEST mode. The script now closes the dialog with Escape, presses `4`, sets speed MAX, presses the
START soft key in `#sks` and waits for PROGRAM END with `#scrub` at its maximum (moving the slider to its end is
the fallback, and the script says which of the two happened). It stops with an error when the run does not reach
the end. The new menu and the AI dialog are now opened through the old page's own menu, before the run, and the
page is kept off the network, so the old AI dialog shows its built-in model list.

### 4.4 Reported by build lanes, to be re-run in the final pass

Not run in this pass. The figures are what the lanes left in the tree; treat them as unverified.

| Check | Figure on record | Where it is recorded |
|---|---|---|
| `node tests/ui/run.mjs` (browser suite) | 529 passed, 0 failed, 1 skipped (WebKit not installed) | `local/llm/ui-run-aigen.log`, written 13:17, not tracked |
| `cargo test --manifest-path server/Cargo.toml` | 33 + 9 + 13 passed, 0 failed | `local/llm/cargo-test-aigen.log`, written 12:49, not tracked; it may cover the server crate only |
| `node tests/ai/dialog-e2e.mjs`, `node tests/ai/server-job.mjs` | no figure on record | named in commits `408e14d` and `a3d6591` only |
| `tests/e2e/*.mjs` (core, play, play-keyboard, play-layout, play-axe, landing-contrast, business-isolation, sr-layout, sr-fallback) | no figure on record | named in commits `65d7bac` and `6f6230b` only |
| `npm run desktop:business`, `npm run desktop:play` | no figure on record | the desktop lane was still working during this pass |

### 4.5 Known failures

| Command | Failure | Since |
|---|---|---|
| `node tests/ui/autosave.mjs` | a tool name restored from a draft is lost when the page reloads within 300 ms | the same on the starting commit `c6e6e7d`; reported by the build lane, not re-run in this pass |
