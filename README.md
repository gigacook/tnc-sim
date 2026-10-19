# TNC 426 / 430 Simulator

A CNC simulator for HEIDENHAIN **Klartext**, the conversational programming language of the TNC 426 and 430
controls. You write or load a program, run it, and watch the tool remove material from the blank. It catches the
errors the control would raise.

It comes in three forms:
- **The simulator file** `index.html`: one self-contained HTML file. Open it in a browser; it works offline and needs
  no install. It is also online at https://gigacook.github.io/tnc-sim/.
- **The desktop app** (Windows, macOS, Linux): the simulator plus a program library, in its own window.
- **The server and web app**: the same library for several users over a network (optional).

Not affiliated with HEIDENHAIN. An educational simulator, not a way to verify programs for real machines.

## Contents
- [Key terms](#key-terms) · [Using the simulator](#using-the-simulator) · [Keys](#keys) · [AI programs](#ai-programs)
- [What is and isn't simulated](#what-is-and-isnt-simulated) · [Desktop app](#desktop-app) · [For developers](#for-developers)

## Key terms
- **Block**: one line of a program, e.g. `L X+10 Y+20 R0 FMAX` (a straight move at rapid speed).
- **Cycle**: a built-in machining routine (drilling, pocket milling) set up with `CYCL DEF` and run with `CYCL CALL`.
- **Blank**: the raw stock, set with `BLK FORM`.
- **Operating mode**: as on the control, PRG EDIT (write), TEST (check), SINGLE-BLOCK and FULL-RUN (run).
- **Profile**: your settings, programs and tool table, stored in this browser.

## Using the simulator
1. Open `index.html`. The program `NAMEPLATE.H` loads first; pick another under **Program**.
2. Press `SPACE` (NC START) to run it. The status column shows cycle time, path lengths and removed volume.
3. Press `1` for PRG EDIT to change blocks. Soft keys and dialogs build a block one question at a time, so you
   don't have to type raw Klartext.
4. Errors appear in the error register with the block they belong to, the way the control shows them.
5. To compare two versions: store a finished run as reference A, change the program, run again. The delta shows
   cycle time, feed and rapid path, move count, lowest Z and removed volume.

Programs load from `.H` / `.I` files (UTF-8 or Windows-1252), `.zip` archives, or drag-and-drop. `Ctrl+S` saves a
numbered TNC listing. A program that calls a tool missing from the tool table creates it, as an import on the control
would, so a mistyped tool number is not caught on upload.

Your profile saves itself. Export it as a `.zip` and import it elsewhere with **Merge** or **Replace**. The tool table
imports and exports as `TOOL.T`. The interface is English or Swedish (profile dialog).

On a phone (under 900 px wide) the screen splits into three workspaces, Program, Graphics and Status; switch with
the tabs or a sideways swipe. The soft keys stay in a dock at the bottom, and less-used functions are under **Menu**.

## Keys
| Key | What it does | | Key | What it does |
|---|---|---|---|---|
| `↑` `↓` | move the block cursor | | `E` `I` `D` `C` | edit, insert, delete, copy a block |
| `←` `→` | scrub the run back and forth (`Shift` = 5×) | | `TAB` | raw text editor |
| `ENTER` | step one block; edit in PRG EDIT | | `G` | 3D, TOP, FRONT, SIDE view |
| `ESC` | stop; cancel an edit | | `1`–`4` | operating mode |
| `SPACE` | NC START / NC STOP | | `5`–`9` | speed 1×, 4×, 16×, 64×, MAX |
| `S` / `R` | single block / reset | | `T` | tool table |
| `M` | programs | | `F` | focus view (listing + graphics) |
| `H` | help, lessons, manual | | `+` `−` | feed override |
| `Ctrl+S` / `Ctrl+O` | save / load `.H` | | `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |

In PRG EDIT: `Y` CYCL DEF, `W` TOOL CALL, `A` APPR/DEP, `Q` Q-parameter.

## AI programs
The AI button writes a program from a description. It needs your own OpenRouter key, which goes only to
`openrouter.ai`. The recommended model is DeepSeek V4.1 Flash; any OpenRouter model can be picked.

The AI first plans the part (faces, pockets, holes, text), writes the program, then the simulator runs it, measures
the result against the plan in mm and sends the differences back, up to 3 rounds. If a round makes things worse,
the best program so far is kept. Measured 2026-10-03: 96–100 % match with hand-written reference parts on four test
parts (`tests/ai/bench.mjs`).

## What is and isn't simulated
Simulated: lines, arcs, polar moves, helixes, radius compensation (RL / RR), corner rounding and chamfers,
approach and departure, Q parameters and jumps, subprograms and repeats, the tool table, two machines (426: X Y Z;
430: plus an A/B swivel head with cycle 19), a standard vice the tool can crash into.
Cycles: 1, 2, 4, 7–11, 14, 17, 18, 19, 20–25 (SL contour cycles), 32, 200–215, 220, 221, 230, 231, 247, 262–265,
267. Touch probe: 408–413, 417, 419 move; 30–33, 480–483, 562 are accepted without motion.

Not simulated:
- Cycles 3, 5, 12, 13, 26, 27, 28 report `CYCLE n NOT IMPLEMENTED IN SIMULATOR`.
- FK free contour programming: FK blocks (`FPOL`, `FL`, `FLT`, `FC`, `FCT`, `FSELECT`) report `FK NOT SIMULATED`.
- Undercuts: material is a height field, so the tool only removes what it sweeps along its axis.
- `F AUTO` uses the `TOOL CALL` feed. `INCH` programs are not converted; write in millimetres.
- Cycle time leaves out dwell, tool changes and acceleration, so it reads short against a real machine.
- Where the manual doesn't show a tool path (parts of SL cycles 21–24, thread milling, probing), the simulator's
  path is its own choice. These are listed in [CONTINUE.md](CONTINUE.md) under "Open placeholders".

## Desktop app
Build it from the repository (see below), then:
```sh
cd desktop && npx tauri dev      # opens a debug window
cd desktop && npx tauri build    # installers in desktop/src-tauri/target/release/bundle/
```
The app runs its own server on `127.0.0.1` (port 8427 if free), keeps its database in the system's app-data
folder, and signs you in automatically. A second launch brings the open window to the front. The installers are
not code-signed, so Windows and macOS warn on first open.

Needs: Windows, MSVC build tools and WebView2 (built into Windows 10/11); macOS, Xcode command-line tools;
Linux, WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev libxdo-dev
libssl-dev`).

## For developers
```sh
npm ci                                  # build and test tooling
python3 build.py                        # builds index.html
python3 build.py --wasm                 # rebuild the engine from Rust first (needs rustup target wasm32-unknown-unknown)
(cd server && cargo test)
(cd web && npm ci && npm run build)
```
Tests are listed in [CLAUDE.md](CLAUDE.md#tests). The manual and the real-program corpus (`research/`,
`search-heidenhain/`) are not in the repository; `tests/corpus.js` needs them. No API key is needed to build or
test: AI tests use a mocked OpenRouter. With `OPENROUTER_API_KEY=…` in `private/.env`, `build.py` also writes
`index.local.html` with the key (gitignored).

| Path | What it is |
|---|---|
| `server/crates/tnc-core` | the engine: interpreter, cycles, checks, material model (also built to `sim/engine/tnc_core.wasm`) |
| `sim/` | the simulator UI; `build.py` lists its modules |
| `server/` | the Rust server |
| `web/`, `desktop/` | the web app and the desktop app |
| `tests/` | all tests |
| `docs/` | FEATURES and HISTORY (shown in the DEV tab), programming-station plan |
| [CONTINUE.md](CONTINUE.md) | the task list toward the goal |

## Licence
MIT, see [LICENSE](LICENSE). Bundles three.js and three.quarks (MIT). "HEIDENHAIN" and "TNC" are trademarks of
DR. JOHANNES HEIDENHAIN GmbH.
