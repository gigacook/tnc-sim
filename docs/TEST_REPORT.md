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
