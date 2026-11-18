# Feature map: every user-visible function before the Business / Play redesign

This is the inventory for the dual-frontend redesign, so that nothing gets lost. One row is one function a user can
see or trigger.

- **Old location** and **Existing test coverage** describe the starting commit `c6e6e7d`, read with
  `git show c6e6e7d:<path>`. They do not describe the working tree.
- **New location** is filled in by the redesign lead at the end. Until then every row says `pending (lead)`.
- **Existing test coverage** names a test that was found by reading or grepping the test files. `none found` means
  no test was found for that function; it does not mean the function is broken.

Short names used in the coverage column:

| Short name | File |
|---|---|
| UI suite | [tests/ui/run.mjs](../tests/ui/run.mjs), named as `function`: "check name" |
| autosave test | [tests/ui/autosave.mjs](../tests/ui/autosave.mjs) |
| manual test | [tests/manual.js](../tests/manual.js), named by its printed section |
| post test | [tests/post.js](../tests/post.js), named by block shape |
| parity | [tests/parity.js](../tests/parity.js), the behaviour freeze over the golden record |
| part test | [tests/part.js](../tests/part.js) |
| AI loop test | [tests/ai/loop.js](../tests/ai/loop.js) |
| MCP test | [mcp/tnc-mcp.test.mjs](../mcp/tnc-mcp.test.mjs) |
| API test | [server/crates/tnc-server/tests/api.rs](../server/crates/tnc-server/tests/api.rs) |
| engine crate test | [server/crates/tnc-engine/src/lib.rs](../server/crates/tnc-engine/src/lib.rs) |
| formats crate test | [server/crates/tnc-formats/src/lib.rs](../server/crates/tnc-formats/src/lib.rs) |

Source files named in the old-location column: [sim/sim-shell.html](../sim/sim-shell.html),
[sim/ui.js](../sim/ui.js), [sim/dialogs.js](../sim/dialogs.js), [sim/flow.js](../sim/flow.js),
[sim/ai.js](../sim/ai.js), [sim/lessons.js](../sim/lessons.js), [sim/profile.js](../sim/profile.js),
[sim/autosave.js](../sim/autosave.js), [sim/bridge.js](../sim/bridge.js), [sim/fx.js](../sim/fx.js),
[sim/look.js](../sim/look.js), [sim/materials.js](../sim/materials.js), [sim/viz.js](../sim/viz.js),
[sim/callouts.js](../sim/callouts.js), [sim/i18n.js](../sim/i18n.js), [web/src](../web/src),
[desktop/src-tauri/src/lib.rs](../desktop/src-tauri/src/lib.rs), [mcp/tnc-mcp.mjs](../mcp/tnc-mcp.mjs).

## 1. Header / top bar

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Boot splash ("POWER INTERRUPTED", press CE) on the first visit of a session | `#boot` in sim/sim-shell.html; `dismissBoot()` in sim/ui.js; any key or tap | pending (lead) | UI suite `ioFlows`: "1: boot splash on the first visit", "1: no splash or name prompt after reload" |
| Logo and control title (machine label + NC software number) | `.logo`, `h1.ttlbox` (`.ttl`, `.sub-ttl`) in sim/sim-shell.html; label set by `setMachine()` in sim/ui.js | pending (lead) | none found |
| DEV button (opens the DEV dialog) | `#b-dev` in `#hmore`, sim/sim-shell.html | pending (lead) | UI suite `phoneFlows`: "profile, AI, help, lessons, DEV, new, focus are in the drawer" (presence only) |
| "+ New" menu: NEW PRG - MANUAL, NEW PRG - AI | `#b-new`, menu built by `openMenu()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "2: NEW PRG — MANUAL creates QA_PART.H in PRG EDIT with the block line open" |
| "Lessons" menu: LEARN list and BREAK IT list | `#b-lessons`, `openMenu()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: drawer presence check only |
| "AI" menu: change this program, new program from a description, AI setup | `#b-ai`, `openMenu()` in sim/ui.js | pending (lead) | UI suite `aiMocked`: "AI dialog opens from the drawer"; `aiFlow`: "modify request carries the current program and the wish" |
| Header menus: arrow keys move, Esc closes and returns focus, click outside closes | `.hmenu` (`role=menu`) built in `openMenu()`, sim/ui.js | pending (lead) | none found |
| Help button | `#b-help`, sim/sim-shell.html; key `H` | pending (lead) | UI suite `desktopFlows`: "Enter on a keyboard-focused button activates it", "focus returns to the opener"; `phoneFlows`: "HELP opens the dialog and closes the drawer" |
| Focus button | `#b-focus` (`aria-pressed`), sim/sim-shell.html; key `F` | pending (lead) | none found (presence in the drawer only) |
| Profile button: shows the profile name, tooltip with autosave time, warning style when storage is blocked | `#b-prof`, `profChip()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "1: header button shows the name", "1: header chip says autosaved" |
| Toast line for short messages | `#toast` (`role=status`), `say()` in sim/ui.js | pending (lead) | none found |
| Copyright and trademark note | `.copy` at the foot of the status column and on the boot screen, sim/sim-shell.html | pending (lead) | none found |

## 2. Operating modes and soft keys

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Mode PRG EDIT | `.mode[data-m=edit]` in `#modes`; `setMode()` in sim/ui.js; key `1` or `F1` | pending (lead) | UI suite `ioFlows`: "1: header modes", "1: keys 1–4 switch modes, aria-pressed follows" |
| Mode TEST | `.mode[data-m=test]`; key `2` or `F2` | pending (lead) | UI suite `desktopFlows`: "key 2 = TEST"; `ioFlows`: "1: keys 1–4 switch modes, aria-pressed follows" |
| Mode SINGLE-BLOCK | `.mode[data-m=single]`; key `3` or `F3` | pending (lead) | UI suite `ioFlows`: "7: key 3 → SINGLE-BLOCK" |
| Mode FULL-RUN | `.mode[data-m=full]`; key `4` or `F4` | pending (lead) | UI suite `ioFlows`: "7: FULL-RUN at MAX runs to the end" |
| Mode hint line under the 3-D view (what the mode and its keys do) | `#tp-state`, text set in `setMode()`, sim/ui.js | pending (lead) | none found |
| Soft-key row per mode, with the PC key printed on each key | `#sks`, table `SK` and `SKKEY`, `renderSK()` in sim/ui.js | pending (lead) | UI suite `layoutChecks`: "soft keys under the program column"; `phoneFlows`: "PRG EDIT shows 8 soft keys and a row switch" |
| PRG EDIT soft keys, path functions: L, CC, C, CR, CT, CP POLAR, RND, CHF | `SK.edit` row 1, actions `w:L` ... `w:CHF`, sim/ui.js | pending (lead) | manual test: "Coordinate dialog" sections (dialog logic only); UI clicks none found |
| PRG EDIT soft keys, program functions: APPR/DEP, TOOL DEF, TOOL CALL, CYCL DEF, CYCL CALL, LBL SET, LBL CALL, Q | `SK.edit` row 2, sim/ui.js; keys `A`, `W`, `Y`, `Q` | pending (lead) | none found |
| PRG EDIT soft keys, editing: EDIT, INSERT, DELETE, UNDO, REDO, TOOL LIST, RAW TEXT, CHECK | `SK.edit` row 3, sim/ui.js | pending (lead) | UI suite `phoneFlows`: "row 3 holds EDIT / INSERT / DELETE", "EDIT opens the block line in the dock" |
| CHECK soft key: recompile and report errors or a coming crash | action `chk` in `act()`, sim/ui.js | pending (lead) | none found |
| TEST soft keys: START, START SINGLE, STOP, RESET, 3-D VIEW, PLAN VIEW, FRONT, SIDE | `SK.test`, sim/ui.js | pending (lead) | UI suite `regressionChecks`: "3-D VIEW (reset) frames tool and blank fully inside the canvas"; `layoutChecks`: Swedish check names START SINGLE |
| SINGLE-BLOCK soft keys: NC START NEXT BLOCK, NC STOP, RESET, OVR -, OVR +, 3-D VIEW, TOOL LIST, PROGRAMS | `SK.single`, sim/ui.js | pending (lead) | UI suite `ioFlows` section 7 (NC START presses) |
| FULL-RUN soft keys: NC START, NC STOP, RESET, OVR -, OVR +, 3-D VIEW, TOOL LIST, PROGRAMS | `SK.full`, sim/ui.js | pending (lead) | UI suite `ioFlows`: "7: FULL-RUN at MAX runs to the end" |
| Soft-key path line when nested (PROGRAM > CYCL DEF > group; how to go back) | `#skpath`, `renderPath()` in sim/ui.js | pending (lead) | none found |
| Soft-key colours: NC START green, NC STOP red, active toggles lit | `skClass()` in sim/ui.js | pending (lead) | none found |

## 3. Program listing and block editing

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Program listing with block numbers and syntax colours | `#plist` in `#crt`; `renderList()`, `hl()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "2: new program = BEGIN / END only" |
| Program path label (`TNC:\NAME.H`) | `#pgm-path`, sim/sim-shell.html | pending (lead) | none found |
| Block cursor up / down | keys `ArrowUp` / `ArrowDown`, `moveCursor()` in sim/ui.js | pending (lead) | UI suite `desktopFlows`: "↑↓ move the block cursor" |
| First / last block, page up / down (12 blocks) | keys `Home`, `End`, `PageUp`, `PageDown` in the `keydown` switch, sim/ui.js | pending (lead) | none found |
| Click a block to select it; in run modes the machine moves to just before it | `plist` click, `followCursor()` in sim/ui.js | pending (lead) | none found |
| Double-click a block to edit it | `plist` dblclick, sim/ui.js | pending (lead) | none found |
| Highlight of the executing block and of lesson focus blocks | classes `cur`, `exec`, `focus` in `markRows()`, sim/ui.js | pending (lead) | UI suite `ioFlows`: "7: ... NC START presses: each advances one execution step, cursor and highlight follow" |
| Live trace: the cursor block's path with a moving comet in 3-D | `traceFor()`, `traceTick()` in sim/ui.js | pending (lead) | none found |
| Block line: edit the block under the cursor | `#dlg-in`, `#dlg-pr`, `#dlg-hint`; `beginEdit()`, `endEdit()`; key `E`, or `Enter` in PRG EDIT; `Enter` stores, `Esc` cancels | pending (lead) | UI suite `ioFlows`: "2: E edits an existing block (X+10 → X+15)", "2: typed block stored with Enter"; `phoneFlows`: "block edited from the phone" |
| Insert a block after the cursor (never after END PGM) | `insertBlock()`; key `I`; soft key INSERT | pending (lead) | UI suite `ioFlows`: "2: I inserts a line and opens the block line", "2: I / type / Enter adds the next block" |
| Delete the block | `deleteBlock()`; keys `D` or `Delete`; soft key DELETE | pending (lead) | none found |
| Copy the block below itself | `copyBlock()`; key `C` | pending (lead) | none found |
| Grey autosuggest for the rest of a block; Tab or ArrowRight at line end takes it | `ghostUpdate()`, `ghostAccept()` in sim/ui.js | pending (lead) | none found |
| Undo, per program | `undo()`; key `Ctrl+Z`; soft key UNDO | pending (lead) | UI suite `ioFlows`: "2: Ctrl+Z undoes the edit"; `aiFlow`: "Ctrl+Z undoes the AI change" |
| Redo, per program | `redo()`; keys `Ctrl+Shift+Z` or `Ctrl+Y`; soft key REDO | pending (lead) | UI suite `ioFlows`: "2: Ctrl+Shift+Z redoes" |
| Raw text editor for the whole program; Tab returns and recompiles; Ctrl+S saves from inside | `#raw` textarea, `toggleRaw()`; key `Tab`; soft key RAW TEXT | pending (lead) | UI suite `desktopFlows`: "typing "1" in the raw editor does not switch to PRG EDIT" |
| Programming dialog, one question per step, for a path function | `startWiz()`, `wizShow()`, `wizAccept()` in sim/ui.js; specs `PATH` in sim/dialogs.js | pending (lead) | manual test: "Coordinate dialog — P turns L / C / CT into LP / CP / CTP (6.5)" |
| Dialog keys: ENT accept, NO ENT skip, END finish, DEL abort | soft keys `wok`, `wskip`, `wend`, `wcancel`; keys `Enter`, `Shift+Enter`, `End`, `Esc`; `wizKey()` | pending (lead) | none found |
| Choice soft keys inside a dialog (RL/RR/R0, DR+/DR-, F MAX, F AUTO, tool list) | `wizSK()`, action `wv:` in sim/ui.js | pending (lead) | none found |
| CYCL DEF: group list, then cycle list, then one question per parameter | action `cycldef`, `cg:`, `cy:`; `GROUPS`, `cycleList()`, `cycleSpec()` in sim/dialogs.js; key `Y` in PRG EDIT | pending (lead) | none found |
| APPR / DEP chooser and dialogs | action `apprdep`; `PATH.APPR`, `PATH.DEP` in sim/dialogs.js; key `A` in PRG EDIT | pending (lead) | manual test: "Coordinate dialog — keypad words ..., APPR/DEP polar" |
| TOOL DEF and TOOL CALL dialogs | `PATH.TOOLDEF`, `PATH.TOOLCALL`; key `W` for TOOL CALL in PRG EDIT | pending (lead) | none found |
| CYCL CALL, LBL SET, LBL CALL, Q parameter (formula) dialogs | `PATH.CYCLCALL`, `PATH.LBLSET`, `PATH.LBLCALL`, `PATH.Q`; key `Q` in PRG EDIT | pending (lead) | none found |
| Coordinate keypad on COORDINATES ?: axis keys, digits, sign, I incremental, Q, CE | `wizPad()`, `ckAxis()`, `ckDigit()`, `ckSign()`, `ckInc()`, `ckQ()`, `ckCE()` in sim/ui.js; `PAD` in sim/dialogs.js; PC keys: axis letters, `I`, `+`, `-`, `Delete` = CE | pending (lead) | manual test: "Coordinate dialog — keypad words (PC keyboard + soft keys), whole polar words ..." |
| Actual-position capture into the dialog line | `ckActual()`, `actPos()`; soft key `wact`; key `#` | pending (lead) | none found |
| Polar forms through P: L to LP, C to CP, CT to CTP, APPR to APPR P..., DEP LCT to DEP PLCT | `ckPolar()` in sim/ui.js; `.polar` in `PATH`, sim/dialogs.js; key `P` | pending (lead) | manual test: both "Coordinate dialog" sections |
| PR / PA questions take bare values and whole words (PA-90, IPA+60) | `PAD` in sim/dialogs.js | pending (lead) | manual test: "Coordinate dialog — keypad words ..." (PR / PA part) |
| Cycle picked from the Reference list starts its dialog | `tr.cyc[data-cy]` in `#ref-body`, `renderRef()` in sim/ui.js | pending (lead) | none found |

## 4. Run controls, speed, scrub, feed override

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| NC START (does what the mode does) | `#b-start`, `ncStart()`; soft keys START / NC START; key `Space` | pending (lead) | UI suite `desktopFlows`: "SPACE = NC START"; `phoneFlows`: "NC START from the dock runs the program" |
| NC STOP (feed hold) | `#b-stop`, `stop()`; soft key STOP; keys `Space` while running, `Esc` | pending (lead) | none found |
| Single block: run exactly the highlighted block, in execution order | `#b-step`, `stepBlock()`; keys `S`, `Enter` outside PRG EDIT, `Space` in SINGLE-BLOCK | pending (lead) | UI suite `ioFlows`: "7: execution order runs the LP … M99 block 11×", "7: every LP … M99 press taps exactly one hole", "7: NC START after the end does nothing" |
| Reset to the program start | `#b-reset`, `reset()`; soft key RESET; key `R` | pending (lead) | UI suite `ioFlows`: "7: reset: step 0, cursor on the first executed block" |
| Speed 1x, 4x, 16x, 64x | `#spd` buttons `data-s`, `setSpeed()`; keys `5` `6` `7` `8` | pending (lead) | none found |
| Speed MAX: run to the end or the first crash | `#spd [data-s="0"]`, `runMax()`; key `9` | pending (lead) | UI suite `ioFlows`: "7: FULL-RUN at MAX runs to the end" |
| Scrub slider over the whole run | `#scrub`, `seek()` in sim/ui.js | pending (lead) | none found |
| Scrub by keys, 1 s or 5 s with Shift | keys `ArrowLeft` / `ArrowRight`, sim/ui.js | pending (lead) | none found |
| Feed override 0 to 150 % in steps of 10 | soft keys OVR - / OVR + (`ovrd`, `ovru`); keys `-` and `+` | pending (lead) | none found |
| Run state label (READY, FEED HOLD, PROGRAM END, EDITING, PROGRAMS) | `#run-state`, `setState()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "7: end: 12 holes (CYCL CALL + 11), PROGRAM END"; `regressionChecks`: "TEST runs to the end without an error or crash" |
| NC START refused in PRG EDIT with a message | `ncStart()` in sim/ui.js | pending (lead) | none found |
| Settings remembered between visits (speed, override, view, mode, toggles, machine, flow, focus, side tab, reference page) | cookie `tnc426_prefs`, `writePrefs()` / `readPrefs()` in sim/ui.js | pending (lead) | none found |

## 5. 3-D view

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| 3-D canvas: blank, tool in its holder, rapid and feed paths | `#gl` in `#gfx`; `buildScene()`, `setTool()` in sim/ui.js; tool geometry in sim/tools3d.js | pending (lead) | UI suite `layoutChecks`: "graphics canvas has a usable size"; `regressionChecks`: "3-D default view frames tool and blank fully inside the canvas" |
| Orbit by drag, zoom by wheel | `OrbitControls` on `#gl`, sim/ui.js | pending (lead) | UI suite `phoneFlows`: "a swipe on the 3-D view orbits, never switches" |
| View 3-D / PLAN (TOP) / FRONT / SIDE, refit to the part | soft keys `v3`, `vt`, `vf`, `vs`; `setView()`, `fitCamera()`; key `G` cycles | pending (lead) | UI suite `regressionChecks`: "3-D VIEW (reset) frames tool and blank fully inside the canvas"; key `G`: none found |
| View name label | `#gfx-rt`, `viewLabel()` in sim/ui.js | pending (lead) | none found |
| Legend: RAPID, FEED, drag and wheel hint | `.lgd` in sim/sim-shell.html | pending (lead) | none found |
| Position display (DRO) as an overlay: X Y Z, B A on the 430, S with M3/M4/M5, F or FMAX, T | `#dro`, `renderDro()` in sim/ui.js | pending (lead) | UI suite `regressionChecks`: "coordinate overlay covers ≤ 20 % of the 3-D view" |
| Info overlays top left and top right | `#ovl-l`, `#ovl-r`, sim/sim-shell.html | pending (lead) | none found |
| Callout labels with leader lines (TOOL, TOOL HOLDER, PART) | `#callouts`, sim/callouts.js; `calloutsFor()` in sim/ui.js | pending (lead) | UI suite `regressionChecks`: "callout labels fully inside the 3-D view", "callout labels clear of the soft keys" |
| Labels on / off | `#b-labels` in `#fxmenu`; key `L` | pending (lead) | none found |
| Click (not drag) picks a point: green marker and its program coordinates; click again or Esc removes | sim/viz.js (pointer handlers on the canvas); toggle `#b-pick` "Click to pick" | pending (lead) | none found |
| Axis vectors from the program zero to the tool, with values; A / B arcs on the 430 | sim/viz.js; toggle `#b-vec` "Axis vectors" | pending (lead) | none found |
| Flowchart view of the program in place of the listing; click a card to select the block | `#b-view` ("Flow" / "Listing"), `#flow`; `toggleFlow()` in sim/ui.js; sim/flow.js; key `V` | pending (lead) | none found |
| Flowchart highlight follows the cursor or the executing block | `flowHighlight()` in sim/ui.js; `highlight()` in sim/flow.js | pending (lead) | none found |
| Focus view: listing and graphics only, status column hidden | `toggleFocus()`, body class `focus`; `#b-focus`; key `F` | pending (lead) | none found |
| Alarm banner in the view for a crash or warning, CE acknowledges | `#alarm` (`role=alert`), `raise()`, `showAlarm()`; key `Esc` hides | pending (lead) | none found |
| Camera shake and beep on a crash (shake off with reduced motion) | `raise()`, `beep()`, `REDUCED` in sim/ui.js | pending (lead) | none found |

## 6. Status column, error register, checks, run comparison

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Status tabs: Diagnostics, Reference, Programs | `#stabs` (`role=tablist`), `setSideTab()` in sim/ui.js | pending (lead) | UI suite `desktopFlows`: "ArrowRight in the status tabs selects Reference" |
| Run card: elapsed / total, blocks, moves, feed path, rapid path, min Z, removed volume, active cycle, override, machine | `#runkv` in `.card-run`, `renderKV()` in sim/ui.js | pending (lead) | UI suite `layoutChecks`: "no English left in Swedish (Elapsed / total, ...)" (labels only) |
| Checks card: count of errors, crashes, warnings | `#errc`, `renderChecks()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "check count has a text name (not colour only)" |
| Checks list (the error register): one line per error, crash or warning with its block | `#elist`, `renderChecks()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "5: hand-typed TOOL CALL 77 → TOOL 77 NOT DEFINED", "7: depth below the blank = THROUGH_CUT note, no crash" |
| Click a check to jump to its block and to that moment of the run | `#elist` click handler in `renderChecks()` | pending (lead) | none found |
| Compare card: reference A against the current run with deltas (cycle time, feed path, rapid path, moves, min Z, removed volume) | `#cmp`, `#cmp-t`, `renderCompare()` in sim/ui.js | pending (lead) | none found |
| Store the finished run as reference A | `#b-snap` in sim/sim-shell.html | pending (lead) | none found |
| Open the reference program again | `#b-restore` in sim/sim-shell.html | pending (lead) | none found |
| Reference tab, page chooser | `#ref-sel`, `refOptions()`, `renderRef()` in sim/ui.js | pending (lead) | none found |
| Reference: key list | `KEYS` table in sim/ui.js, shown in `#ref-body` | pending (lead) | none found |
| Reference: cycle list by group | `renderRef()` with `GROUPS` from sim/dialogs.js | pending (lead) | none found |
| Reference: tool list (read only) | `renderRef()` option `tools` | pending (lead) | none found |
| Reference: machine data (axes, limits, spindle and feed maximum, rapids, head) | `renderRef()` option `machine`; data in sim/machines.js | pending (lead) | none found |
| Reference: manual sections | `renderRef()` options `man:n`; content `manual` in sim/lessons.js | pending (lead) | none found |
| Programs tab: the user's own programs with machine, created, edited, version; click opens | `#sp-progs`, `#uplist`, `renderUserPrograms()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "1: programs tab carries the profile name" |

## 7. Program manager, projects, load / save / import / export

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Open / close the program manager (file list with bytes, status, project) | `#b-mgt` "Programs", `#mgt`; `openMgt()`, `renderMgt()`; key `M`; soft key PROGRAMS | pending (lead) | none found |
| Manager: select with arrows or a click, open with Enter or a second click | `mgtKey()`, `#mgt` click handler in sim/ui.js | pending (lead) | none found |
| Manager soft keys: NEW, OPEN, LOAD FROM PC, SAVE .H, RESTORE ORIGINAL, DELETE, ADD TO PROJECT, END | `SK.mgt` in sim/ui.js; keys `N`, `Enter`, `L`, `R`, `Delete` / `Backspace` / `D`, `Esc` / `M` | pending (lead) | none found |
| Status letters: S selected, * modified, + yours | `renderMgt()` in sim/ui.js | pending (lead) | none found |
| Delete a program (asks first; built-in programs refuse) | `deletePgm()` in sim/ui.js | pending (lead) | none found |
| Restore a built-in program to its original text | `restoreOriginal()` in sim/ui.js | pending (lead) | none found |
| Built-in programs on the control (NAMEPLATE.H opens first, NAMEPLATE_V2.H, BRACKET.H) | sim/programs.js | pending (lead) | MCP test: "tnc_check runs the demo program through the real pipe: no errors, the engine's cycle time and path lengths" |
| New program dialog: name only, then block by block in PRG EDIT | `#m-new`, `#new-scratch`, `#ns-name`, `#ns-go` "Create & edit"; `openNew()`, `newGo()` | pending (lead) | UI suite `ioFlows`: "2: NEW PRG — MANUAL creates QA_PART.H in PRG EDIT with the block line open", "2: new program = BEGIN / END only" |
| Save as .H in the numbered TNC listing format with CRLF | `#b-save` "Save .H", `saveH()`, `listing()`; key `Ctrl+S` | pending (lead) | UI suite `ioFlows`: "3: Ctrl+S downloads ...USER-GEN_QA_PART.H", "3: numbered TNC listing with CRLF", "3: the Save .H button downloads too" |
| Load files from the computer (.H, .I, .txt, .nc, .zip, .T, .json) | `loadFromDisk()`, `importFiles()`; key `Ctrl+O`; soft key LOAD FROM PC | pending (lead) | UI suite `ioFlows`: "4: Ctrl+O loads two .H files", "4: lower.h loads as LOWER.H" |
| Decode UTF-8 or Windows-1252, normalise line ends, accept numbered listings | `decode()`, `readFile()` in sim/profile.js; `cleanPgm()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "4: Windows-1252 comment decoded", "4: CRLF line ends normalised", "4: numbered CRLF listing loads without errors"; formats crate test `decodes_cp1252_when_not_utf8` |
| Load a .zip of programs | `readFile()` in sim/profile.js | pending (lead) | UI suite `ioFlows`: "4: a zip of three .H loads all three" |
| Drag and drop files on the program column | `dragover` / `drop` on `.col-pgm`, sim/ui.js | pending (lead) | UI suite `ioFlows`: "4: drag-drop on the program column loads DROPME.H" |
| A name already taken gets `_2` (no overwrite) | `uniqueName()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "4: the same name again → PLAIN1_2.H (no overwrite)" |
| Loading a program adds the tools it calls that are missing (radius from a `;T5 D=+8` comment, else R3) | `toolsFor()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "5: T27.H auto-adds T27 R7 (from ;T27 D=+14) with L=0, no error", "7: HOLES.H loads without errors, T50 auto-added with L=0" |
| Downloads sorted into TNC-SIMULATOR/AI-GEN, USER-GEN, SETTINGS, TOOL-TABLES (or a name prefix) | `download()`, `dlDirGet()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: file names in "3: Ctrl+S downloads ...USER-GEN_QA_PART.H" and "3: profile export holds profile.json + programs/TNC426/QA_PART.H" |
| Projects: create a named folder, it becomes active | `#proj-name`, `#b-proj-new` in `#pj-box`; key `Enter` in the name box | pending (lead) | autosave test: "project name survives a reload", "Create project clears it" |
| Projects: choose the active project; new programs join it | radio `name=proj` in `#proj`; `addPgm()` in sim/ui.js | pending (lead) | none found |
| Projects: add the current program to the active project | `#b-proj-add`; manager soft key ADD TO PROJECT | pending (lead) | UI suite `ioFlows`: used in "3: project zip holds QA_PART.H + README.txt" |
| Projects: download a project as .zip with a README | `[data-zip]` button, `zipProject()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "3: project zip holds QA_PART.H + README.txt" |
| Projects: delete a project (programs stay) | `[data-del]` button in `#proj` | pending (lead) | none found |

## 8. Tool table

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Open / close the tool list in the program column | `#b-tools` "Tool list", `openTT()`, `renderTT()`, `closeTT()`; key `T`; soft key TOOL LIST; `Esc` / END closes | pending (lead) | UI suite `ioFlows`: "5: T opens the TOOL LIST", "5: Esc closes the TOOL LIST" |
| One tool table per machine; built-in tools plus the user's own (marked *) | `mtools()`, `S.tools[machine]` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "5: list shows T42 R6.250 and T27 L0.000" |
| Edit name, length L, radius R in place; the program recompiles | `.ttab` inputs, `wireToolTable()`, `mergeTools()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "5: editing the radius recompiles the program"; autosave test: "tool name typed and not blurred survives a reload" |
| Add a tool by number | `[data-tt=new]`, `[data-tt=add]` "Add tool" | pending (lead) | UI suite `ioFlows`: "5: add tool T88" |
| Remove one of your tools | `[data-del]` button in `.ttab` | pending (lead) | UI suite `ioFlows`: "5: remove T88" |
| Add the tools this program calls | `[data-tt=missing]`; soft key ADD MISSING (`ttmiss`); `addMissingTools()` | pending (lead) | UI suite `ioFlows`: "5: "Add tools this program calls" adds T77, the error goes" |
| Import TOOL.T | `[data-tt=import]`; soft key IMPORT TOOL.T; `parseToolT()` in sim/profile.js | pending (lead) | UI suite `ioFlows`: "4: TOOL.T merged into the tool table (T42 L75.5 R6.25, T43)"; formats crate test `tool_t_round_trip` |
| Export TOOL.T | `[data-tt=export]`; soft key EXPORT TOOL.T (`ttexp`); `toolT()` in sim/profile.js | pending (lead) | UI suite `ioFlows`: "5: export TOOL.T: name and T27 R+9.5" |
| Holder type per machine: ISO 50 (A = 100 mm) or SK40 (A = 70 mm) | `#tt-ht` select in `renderTT()` | pending (lead) | UI suite `ioFlows`: "5: holder defaults to ISO 50, A = 100 mm" |
| Tool table kept across reloads | `persist()` in sim/ui.js, sim/profile.js | pending (lead) | UI suite `ioFlows`: "5: tool table survives a reload" |
| The tool in the spindle is outlined in the list | `tr[data-cur]` in `renderTT()` | pending (lead) | none found |

## 9. Machine selection, vice, effects, materials and look

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Machine selector TNC 426 / TNC 430; each machine keeps its own programs, tools and last program | `#mach-sel` select created in sim/ui.js next to `#pgm-path`; `setMachine()` | pending (lead) | UI: none found. Engine side: manual test "TNC 430 (operator's machine) — limits, arc tolerance 0.006, F cap 1500, cycle 19 tilts the head"; engine crate test `machine_430_parameters_apply` |
| "Effects & view" disclosure | `#fxmenu` (`details`) in sim/sim-shell.html | pending (lead) | none found |
| Vice on / off (drawn and crash-checked; off = fixture plate) | `#b-vice` in `#fxmenu`; `tog('vice')` then `compile()` | pending (lead) | none found |
| Chips and sparks on / off | `#b-fx`; key `P`; sim/fx.js | pending (lead) | none found |
| Coolant spray on / off (shown on M8) | `#b-cool`; key `K`; sim/fx.js | pending (lead) | none found |
| Smoke and fire on / off (off by default) | `#b-fire`; key `B`; sim/fx.js | pending (lead) | none found |
| Crash burst effect | `FXO.crash()` called from `raise()`; sim/fx.js | pending (lead) | none found |
| Sound on / off | `#b-sound`; `beep()` in sim/ui.js | pending (lead) | none found |
| Stock material picker (6 alloys, 4 industry looks); sets chip and spark colour; remembered | `#mat-sel` select added by sim/materials.js after `#b-sound` | pending (lead) | none found |
| Metal look: room reflections, filmic tone mapping, anti-aliasing (no control) | sim/look.js | pending (lead) | none found |
| Material removal shown on the blank with a cut-depth tint; scrubbing back rebuilds it | `buildHeightField()`, `paintHM()`, `rewind()` in sim/ui.js | pending (lead) | UI suite `regressionChecks`: "the 3-D view shows the pocket cut to Z-6 around an uncut island" |

## 10. Profile

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Profile dialog | `#m-prof`, `#prof-body`; `openProfile()`, `renderProfile()` in sim/ui.js | pending (lead) | UI suite `ioFlows`: "1: Esc closes the profile dialog" |
| Name prompt on the first visit, after the splash | `dismissBoot()` then `openProfile()`; `#prof-name` | pending (lead) | UI suite `ioFlows`: "1: profile dialog asks for a name after the splash", "1: name field focused" |
| Name saved on every keystroke and kept in the browser (IndexedDB) | `#prof-name` input handler; `save()` in sim/profile.js | pending (lead) | UI suite `ioFlows`: "1: name persists after reload" |
| Autosave of programs, projects, tools and settings, with the save time shown | `persist()` in sim/ui.js; `#prof-saved` | pending (lead) | UI suite `ioFlows`: "2: program and edits survive a reload (autosave)", "1: header chip says autosaved" |
| Counts line: your programs, projects, tools, machines | `profCounts()` in sim/ui.js | pending (lead) | none found |
| Control language English / Swedish | `#prof-lang` select; `TNC_I18N.set()` in sim/i18n.js; stored under `tnc.lang` | pending (lead) | UI suite `layoutChecks`: "no English left in Swedish (Elapsed / total, MY PROGRAMS, START SINGLE, all clear)" |
| Choose the downloads folder once | `#prof-dldir`, `pickDlDir()` in sim/ui.js | pending (lead) | none found |
| Export the profile as .zip | `#prof-export`, `exportProfile()`; `exportZip()` in sim/profile.js | pending (lead) | UI suite `ioFlows`: "3: profile export holds profile.json + programs/TNC426/QA_PART.H" |
| Import a profile: Merge (clashes get `_IMP`) | `#prof-import`, `profImportAsk()`, `#imp-merge`; `merge()` in sim/profile.js | pending (lead) | UI suite `ioFlows`: "8: a profile zip offers Merge / Replace", "8: Merge reloads, keeps mine (HOLES, T27) + the imported" |
| Import a profile: Replace (asks first) | `#imp-replace`, `finishImport()` | pending (lead) | UI suite `ioFlows`: "8: Replace asks, reloads, profile = the export (no HOLES / ZIPA / T42)" |
| Cancel an import | `#imp-cancel` | pending (lead) | none found |
| Start a new, empty profile (wipe; asks first) | `#prof-new`, `newProfile()`; `wipe()` in sim/profile.js | pending (lead) | UI suite `ioFlows`: "9: asks before wiping", "9: programs, tools and name are gone", "9: the profile dialog asks for a name again" |
| Old browser data (pre-profile store) carried over on first load | `legacy()` in sim/profile.js | pending (lead) | none found |

## 11. Help, lessons, BREAK IT, manual, DEV

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Help dialog with tabs Learn, Break it, Manual, AI setup | `#m-help`, `#help-tabs`, `#help-body`; `openHelp()`, `renderHelp()`; key `H` | pending (lead) | UI suite `phoneFlows`: "HELP opens the dialog and closes the drawer", "dialog is a full-height sheet"; `axeScan`: "phone help dialog" state |
| Learn tab: 12 lesson cards; a card starts the lesson | `.lcard.learn` in `renderHelp()`; content `learn` in sim/lessons.js | pending (lead) | none found |
| Break it tab: 13 pitfall cards (crash safely, then the fix) | `.lcard.break`; content `breakit` in sim/lessons.js | pending (lead) | none found |
| Manual tab: sections that fold open, some with tables | `.help-manual` details; content `manual` in sim/lessons.js | pending (lead) | none found |
| Lesson coach panel under the 3-D view: step text, page count, Back, Next / Finish, close | `#coach`, `#coach-back`, `#coach-next`, `#coach-x`; `startLesson()`, `coachStep()`, `endLesson()`; key `N` = next step | pending (lead) | none found |
| A lesson loads its own program, highlights its blocks and runs the machine; the user's programs are left alone | `coachStep()` with the scratch program, sim/ui.js | pending (lead) | none found |
| BREAK IT flow: broken program, crash, why, the fix running, the rule | `stepsFor('breakit')` in sim/ui.js | pending (lead) | none found |
| "Lessons & pitfalls" entry in the New dialog | `#new-opts [data-go=learn]`, sim/sim-shell.html (the options block is hidden by `openNew()`) | pending (lead) | none found |
| DEV dialog: Features, Version history, Release plan | `#m-dev`, `#dev-tabs`, `#dev-pre`; `renderDev()`; text from docs/FEATURES.txt and docs/HISTORY.txt through build.py | pending (lead) | none found |
| The personal lesson set | not present in sim/ at c6e6e7d; only the hook `M().lessons` / `window.TNC_MACHINES` in sim/ui.js | pending (lead) | none found |

## 12. AI program generation

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| AI dialog, new program from a description | `#new-ai`, `#ai-prompt`, `#ai-go` "Generate"; `openAI('new')`, `aiGenerate()` in sim/ui.js | pending (lead) | UI suite `aiMocked`: "AI dialog opens from the drawer", "Generate button on screen without scrolling", "generated program opened" |
| AI dialog, change the program on screen (undoable) | `openAI('modify')`; AI menu "Change this program" | pending (lead) | UI suite `aiFlow`: "modify request carries the current program and the wish", "the AI change is applied to AITEST.H", "Ctrl+Z undoes the AI change" |
| Key status pill (no key / key set / key on the server / key from .env) | `#ai-keypill`, `keyPill()` in sim/ui.js | pending (lead) | none found |
| AI setup: paste the OpenRouter key, Remember, Save, Forget key, Test key (shows usage and limit) | Help tab "AI setup": `#ai-key`, `#ai-remember`, `#ai-savekey`, `#ai-forget`, `#ai-test`; `#ai-setup` button in the AI dialog; `testKey()` in sim/ai.js | pending (lead) | none found (the suites put the key into storage directly) |
| Requests go to OpenRouter only, with the user's own key | `headers()`, `api()` in sim/ai.js | pending (lead) | UI suite `aiMocked`: "plan + program = two requests to the mocked endpoint with the BYOK header"; `aiFlow`: "only /models and /chat/completions requested" |
| Model picker: recommended model card | `.mp-rec` in `mpTop()`, mounted in `#ai-mp` and `#ai-setup-mp` | pending (lead) | UI suite `aiFlow`: "AI dialog with the model picker" |
| Model picker: frontier quick picks from the live list | `.mp-chip`; `frontier()` in sim/ai.js | pending (lead) | UI suite `aiFlow`: "frontier chips computed from the live list" |
| Model picker: all-models table, sort by column, filter, provider filter, arrows / Enter / Esc | `.mp-all`, `.mp-t`, `.mp-q`, `.mp-prov`; `mpTable()`, `mpRows()` in sim/ui.js | pending (lead) | UI suite `aiFlow`: "All models opens the table, filter focused", "click $/M out sorts ascending", "fuzzy "qwn flsh" + arrows + Enter picks qwen/qwen3.8-flash and closes the table", "Esc closes the table, not the dialog" |
| Model picker: type any model id | `.mp-id`, `.mp-use` "Use id"; `mpUseId()` | pending (lead) | none found |
| Offline model list when OpenRouter cannot be reached | `listModels()` fallback in sim/ai.js; `.mp-src` label | pending (lead) | none found |
| Thinking effort (off / low / medium / high) | `#ai-think`, stored as `tnc426.aithink` | pending (lead) | none found |
| Max answer tokens, with the model's recommended ceiling as a hint | `#ai-maxtok`, `#ai-tokhint`; `aiTokHint()` | pending (lead) | autosave test: "AI max tokens typed and not blurred is saved after a reload"; AI loop test: "the requested token budget is sent" |
| Measure and refine rounds (0 to 6) | `#ai-rounds`, stored as `tnc426.airounds` | pending (lead) | AI loop test: "auto: 5 rounds at most, then the best program" |
| Auto-repair: run every round without asking | `#ai-auto`; `#ai-auto-live` in the live panel | pending (lead) | UI suite `aiRepairMocked`: "the Auto checkbox is stored" |
| Live panel: thinking / writing progress, log, Cancel, Close | `#ailive`, `aiLiveRender()`; `#ai-cancel`, `#ai-close`; key `Esc` cancels | pending (lead) | UI suite `aiFlow`: "live panel shows Round 2 and "Saved as AITEST.H"", "Close removes the live scratch program" |
| The program appears block by block and its path grows in 3-D while it is written | `aiPartial()`, `aiLiveProgram()` in sim/ui.js | pending (lead) | none found |
| Continue or Stop question between rounds | `#ai-more` (key `Enter`), `#ai-stop` (key `Esc`); `aiAsk()` | pending (lead) | UI suite `aiRepairMocked`: "a failing round asks Continue / Stop", "nothing is sent while the question is open", "Enter continues with round 2" |
| Request viewer: every round as sent, key not shown | `#ai-req` button, `#m-aireq`, `aiShowRequest()` | pending (lead) | none found |
| Plan step: the model writes a part spec first | `planStep()` in sim/ai.js; sim/part.js | pending (lead) | UI suite `aiFlow`: "the first request is the planning step"; AI loop test: "the first request asks for the part spec" |
| Check and repair: the simulator's errors go back to the model | `verifyProgram()` in sim/ui.js; `feedback()` in sim/ai.js | pending (lead) | UI suite `aiFlow`: "the second program request carries the simulator error"; `aiRepairMocked`: "the repaired program opened"; AI loop test: "every repair request = system + task + one program + report" |
| Part measurement: match %, not-cut and wrongly cut volume against the spec | `measureProgram()` in sim/ui.js; `compare()` in sim/part.js | pending (lead) | part test: "a correct program matches the spec (> 90 %)", "the misplaced hole is reported as missing"; AI loop test: "the half-length slot is measured short" |
| Best program wins; a failed refinement keeps the best so far | `generate()`, `rank()` in sim/ai.js | pending (lead) | AI loop test: "a failed refinement returns the best program so far", "round 3 continues from the best program (round 1), not the worse round 2" |
| Cut-off answers continued; a dropped connection retried once | `chatFull()` in sim/ai.js | pending (lead) | AI loop test: "a cut-off answer is continued", "a dropped connection is retried once" |
| A program that only cuts air is rejected | `cutCheck()` in sim/ai.js | pending (lead) | AI loop test: "a program that only cuts air is rejected and explained" |
| The tool table goes to the model as constraints | `toolSheet()`, `system()` in sim/ai.js | pending (lead) | AI loop test: "prompt: tools, 500 mm blanks, subtractive rule"; part test: "text spec is feasible with T9 Ø3" |
| Result saved as a program, downloaded to AI-GEN, then run; cost and time shown | end of `aiGenerate()` in sim/ui.js | pending (lead) | UI suite `aiFlow`: "AITEST.H open and valid"; AI loop test: "cost adds up over all requests" |
| Error messages for a rejected key, no credit, rate limit, unknown model | `aiErr()` in sim/ui.js | pending (lead) | none found |
| With the server: the AI goes through the server, which holds the key and a budget | `window.TNC_AI_API` set in sim/bridge.js; server `ai.rs` | pending (lead) | API test: `ai_proxy_keeps_the_key_and_the_budget`, `ai_off_without_key`, `ai_proxy_without_a_cap_passes_the_users_max_tokens` |

## 13. Autosave drafts

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Text typed into a marked box is kept and put back after a reload | `[data-autosave]` boxes; sim/autosave.js (`GCDraft`) | pending (lead) | autosave test: "new program name survives a reload", "AI prompt survives a reload", "project name survives a reload" |
| The draft is cleared when the action completes | `GCDraft.clear()` calls in sim/ui.js | pending (lead) | autosave test: "Create & edit clears the name draft", "Create project clears it" |
| Boxes saved on "change" are committed after a reload (max tokens, tool table cells) | `data-autosave-commit` in sim/ui.js | pending (lead) | autosave test: "AI max tokens typed and not blurred is saved after a reload", "...and it was committed to the tool table" |
| A draft typed over an older saved value is kept, with a note and "Use saved value" | `restore()` in sim/autosave.js | pending (lead) | none found |
| Note when storage is full or off; 1 MB cap per draft | `save()` in sim/autosave.js | pending (lead) | autosave test: D338-4 check matching "storage is full or off"; D338-7 "after Create the first-keystroke project name does not come back" |
| Draft keys carry host and path; old keys move over | `read()` in sim/autosave.js | pending (lead) | autosave test: "key carries host and path" |
| Every writable text box has autosave or a stated exemption | `data-autosave` / `data-autosave-exempt` in sim/sim-shell.html and sim/ui.js | pending (lead) | autosave test: "lint ...: every writable text box has autosave" |

## 14. Phone layout (900 px and narrower)

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Three workspaces: Program, Graphics, Status, one at a time | `#mtabs` tabs `#mt-pgm`, `#mt-gfx`, `#mt-side`; `showPane()` in sim/ui.js | pending (lead) | UI suite `layoutChecks`: "no overflow in workspace ...", "modes, workspace tabs, MENU, checks and NC START visible" |
| Workspace tabs by keyboard: arrows, Home, End | tablist `keydown` handler, `rove()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "ArrowLeft on the tabs selects Program", "End selects Status", "roving tabindex + aria-selected" |
| Sideways swipe switches workspace | `onSwipe(mainEl)`, `paneStep()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "swipe left goes to the next workspace", "swipe right goes to the previous workspace", "swipe past the last workspace does nothing"; `regressionChecks`: "a swipe right starting on the Status run list goes to Graphics" |
| Swipes never start on the 3-D view, sliders, text fields, soft keys or sideways scrollers, and never on a vertical drag | `swipeable()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "a swipe on the 3-D view orbits, never switches", "a vertical drag does not switch", "a real swipe never navigates the page away (history back)" |
| Each workspace keeps its scroll position and state; the canvas is not recreated | `paneScroll` in `showPane()` | pending (lead) | UI suite `phoneFlows`: "block cursor kept across workspaces", "Program scroll position restored", "same canvas, WebGL context not recreated", "canvas resized to its box after the switch" |
| Dock at the bottom with the soft keys and the block line | `#dock`, `layout()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "NC START from the dock runs the program", "block line visible in the dock" |
| Soft keys 8 at a time with a row switch | `#skpager`, `#sk-prev`, `#sk-next`, `#sk-page`; `pageSK()` | pending (lead) | UI suite `phoneFlows`: "PRG EDIT shows 8 soft keys and a row switch", "soft-key row 1 / 3" |
| Header shows program and run state | `#hdr-stat`, `hdrStat()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "header shows the program"; `regressionChecks`: "header shows the full program file name" |
| Header check count; a tap opens the checks | `#hdr-err`, `#hdr-err-t`, `checksBadge()` | pending (lead) | UI suite `phoneFlows`: "the check count opens the checks", "check count has a text name (not colour only)" |
| Check badge on the Status tab | `#mt-badge` | pending (lead) | none found |
| MENU drawer holding DEV, + New, Lessons, AI, Help, Focus, Profile | `#b-menu`, `#hmore`, `#hmore-x`, `#scrim`; `openDrawer()`, `closeDrawer()` | pending (lead) | UI suite `phoneFlows`: "MENU opens a modal drawer", "profile, AI, help, lessons, DEV, new, focus are in the drawer", "Esc closes the drawer", "swipe right closes the drawer" |
| Dialogs as full-height sheets that follow the on-screen keyboard | CSS in sim/sim-shell.html; `measure()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "dialog is a full-height sheet"; `aiMocked`: "Generate button on screen without scrolling" |
| Touch targets at least 44 px, no sideways page scroll | CSS in sim/sim-shell.html | pending (lead) | UI suite `layoutChecks`: "primary touch targets ≥ 44 px wide / ≥ 40 px tall", "no page-level horizontal overflow" |
| An alarm raised while the 3-D view is not showing is repeated as a toast | `showAlarm()` in sim/ui.js | pending (lead) | none found |
| Wide screens keep the three columns and inline header buttons | `layout()` in sim/ui.js | pending (lead) | UI suite `layoutChecks`: "header buttons stay inline on wide screens", "no drawer dialog role on wide screens" |

## 15. Accessibility

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Dialogs trap Tab, make the page behind inert, return focus to the opener | `openModal()`, `closeModal()`, `setInert()`, `restoreFocus()`, Tab handler in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "Tab is trapped in the dialog", "page behind the dialog is inert", "focus returns to MENU after the dialog"; `desktopFlows`: "focus returns to the opener" |
| Esc closes the open dialog; a click on the backdrop or Close closes it | global `keydown`, `.modal` click handler, `[data-close]` | pending (lead) | UI suite `phoneFlows`: "Esc closes the dialog"; `ioFlows`: "1: Esc closes the profile dialog" |
| Drawer as a modal dialog: focus inside, rest inert, Esc and focus return | `openDrawer()`, `drawerInert()`, `#hmore` `keydown` | pending (lead) | UI suite `phoneFlows`: "focus moves into the drawer", "workspace and dock are inert behind the drawer", "Tab stays inside the drawer", "focus returns to MENU", "MENU aria-expanded=true" |
| Tab lists follow the WAI-ARIA tabs pattern with roving tabindex | tablist `keydown` handler, `rove()`; `#mtabs`, `#stabs`, `#help-tabs`, `#dev-tabs` | pending (lead) | UI suite `phoneFlows`: "roving tabindex + aria-selected", "workspace is a labelled tabpanel"; `desktopFlows`: "ArrowRight in the status tabs selects Reference" |
| Shortcuts never take Enter / Space from a keyboard-focused control, or keys typed into a field | guards at the top of the global `keydown` handler, sim/ui.js | pending (lead) | UI suite `desktopFlows`: "Enter on a keyboard-focused button activates it", "typing "1" in the raw editor does not switch to PRG EDIT" |
| Polite announcements for run state and check counts only | `#sr-live`, `announce()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "run state announced in the polite live region (debounced)" |
| Labelled canvas, listing, DRO, soft-key group, main landmark | `aria-label` / `role` attributes in sim/sim-shell.html | pending (lead) | UI suite `axeScan`: "axe ...: no serious/critical violation anywhere", "axe ...: no serious/critical violation in the new shell controls" |
| Check count as text, not colour only | `checksBadge()` in sim/ui.js | pending (lead) | UI suite `phoneFlows`: "check count has a text name (not colour only)" |
| Page language attribute follows the chosen language | `TNC_I18N.set()` in sim/i18n.js | pending (lead) | none found |
| Reduced motion: no camera shake on a crash | `REDUCED` in sim/ui.js | pending (lead) | none found |
| No visible "undefined" and no stray errors on any screen | whole shell | pending (lead) | UI suite `layoutChecks`: "no visible "undefined" on any screen", "no page errors, console errors or failed requests" |

## 16. Bridge messages (simulator inside the web app)

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| The bridge wakes up only when the server served the page (`window.TNC_BACKEND`) | sim/bridge.js | pending (lead) | UI suite `serverChecks`: "simulator sees the server (bridge)"; API test `simulator_page_gets_the_backend_marker` |
| Embedded in the web app: no boot splash, no name prompt | `embedded` check in `boot()`, sim/ui.js | pending (lead) | none found |
| `tnc:open` (app to simulator): open or replace a program, with machine and tools | `message` listener in sim/bridge.js; `openExternal()` in sim/ui.js | pending (lead) | none found |
| `tnc:get` (app to simulator): ask for the program on screen | `message` listener in sim/bridge.js | pending (lead) | none found |
| `tnc:ready` (simulator to app) | `ui.on('ready')` in sim/bridge.js | pending (lead) | none found |
| `tnc:program` (simulator to app): answer to `tnc:get` | sim/bridge.js | pending (lead) | none found |
| `tnc:changed` (simulator to app): after an edit, 400 ms later | `ui.on('text')` in sim/bridge.js | pending (lead) | none found |
| `tnc:selected` (simulator to app): another program was opened | `ui.on('program')` in sim/bridge.js | pending (lead) | none found |
| Messages accepted only from the same origin and the parent frame | origin and source checks in sim/bridge.js and web/src/components/SimFrame.tsx | pending (lead) | none found |
| Plugin bus for add-on modules (scene, tool, tick, crash, resize, render, text, program, ready) | `window.TNC_UI`, `TNC_UI_PLUGINS`, `emit()` in sim/ui.js | pending (lead) | none found (the UI suite only uses the bus as a probe) |

## 17. Engine capabilities the user sees

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Klartext moves: L, C, CC, CR, CT, RND, CHF, APPR / DEP | engine `server/crates/tnc-core` (WebAssembly in the page) | pending (lead) | manual test: "LINEAR — APPR LT, CHF, DEP LT, RL outside a square, R10", "CIRCULAR — APPR LCT, RND, CR, CT, DEP LCT, R10", "C-CC — full circle C DR-, RL, R12.5"; parity |
| Polar moves and helix: LP, CP, CTP | engine | pending (lead) | manual test: "LINEARPO — polar LP hexagon, APPR/DEP PLCT, R7.5"; post test: "CP helix" |
| Arcs in the ZX and YZ planes | engine | pending (lead) | post test: "CC + C arc (XY, XZ, YZ planes)" |
| Radius compensation RL / RR as real offset paths, with its errors | engine | pending (lead) | manual test: "INSIDE — RL inside a CCW pocket contour: corners are intersections, no arcs", "ERRORS — radius too large, RL straight to RR" |
| Q parameters and formulas, jumps, REP Q | engine | pending (lead) | manual test: "FORMULAS — precedence, functions, FN 4 DIV, FN 8 LEN, FN 13 ANG, REP Q"; post test: "FN 0 / FN 17" |
| Subprograms and section repeats (LBL, CALL LBL, REP), CALL PGM | engine | pending (lead) | post test: "LBL sub + CALL LBL"; UI suite `ioFlows`: "7: execution order runs the LP … M99 block 11× (label once + REP 10)"; manual test: 9.4 CALL PGM and cycle 12 checks in the last section |
| Endless loops are stopped | engine | pending (lead) | engine crate test `endless_loop_is_stopped` |
| Drilling, tapping, pocket, slot, pattern and surface cycles (1, 2, 4, 17, 18, 200-215, 220, 221, 230, 231) | engine | pending (lead) | manual test: "CYCLE 203 — Q208=0 retracts at the plunging feed Q206", "CYCLES — 202 205 206 207 208 209 and old 1 / 2 / 17 ...", "CYCLES — 212/213/214/215 finishing, 210/211 slots, 220/221 patterns, 230/231 surfaces"; post test: "cycle 200" to "cycle 209" |
| Thread milling 262-265, 267 | engine | pending (lead) | manual test: "THREAD MILLING — 262 263 264 265 267 ..."; post test: "cycle 262" |
| Coordinate transformations: 7 datum shift, 8 mirror, 10 rotation, 11 scaling, 19 working plane, 247 datum setting; 9 dwell, 32 tolerance | engine | pending (lead) | manual test: "MIRROR — cycle 8 X mirrors the part and swaps RL to RR, arcs change direction"; post test: "cycle 7 datum shift + #", "cycle 9 dwell", "cycle 19 working plane + reset", "cycle 32 tolerance + cancel", "cycle 247 preset" |
| SL contour cycles 14, 20-25 (pockets with islands, contour train) | engine `sl.rs` | pending (lead) | manual test: "SL cycles 14, 20-25 (8.6, p. 284-307) ..."; UI suite `regressionChecks`: "SLPOCKET.H (CYCL DEF 14 / 20 / 22, pocket + island) loads without errors" |
| Touch probe cycles (408-413, 415, 417, 419 move; tool-measuring cycles accepted without motion) | engine | pending (lead) | manual test: "Touch probe cycles (iTNC 530 manual ch. 13/15/19 ...) — ideal blank, nominal results"; post test: "probe 400" to "probe 419" |
| Cycles that are not on the control or not simulated are refused with a message | engine | pending (lead) | post test: "cycle 241" and "cycle 252" refused as NOT ON TNC 426/430; manual test: cycles 27 / 28 and FK checks in the last section |
| M functions with block-start / block-end timing, M99, M128 / M129, M140 | engine | pending (lead) | post test: "tool def/call + M", "M128/M129", "M140 MB MAX", "L lines, R0/RL/RR, FMAX, M99" |
| Tool table through TOOL CALL; missing tool reported; automatic tools on request | engine | pending (lead) | engine crate test `user_tools_and_auto_tools`, `builtin_tools_come_from_the_interpreter`; API test `tool_table_changes_the_check` |
| TNC 430: A/B swivel head, limits, feed cap, tilted tool | engine with sim/machines.js | pending (lead) | manual test: "TNC 430 (operator's machine) — limits, arc tolerance 0.006, F cap 1500, cycle 19 tilts the head"; engine crate test `machine_430_parameters_apply` |
| Error register: errors by block in the control's wording | engine; shown in `#elist` | pending (lead) | engine crate test `reports_errors_by_line_and_block`; MCP test: "tnc_check returns the errors the control raises, with block number and text" |
| Collision and safety checks (crash into material at rapid, spindle stopped, holder, vice, through cut, chip load) | engine `sim.rs`, `stock.rs` | pending (lead) | engine crate test `crashes_come_from_the_checks`; UI suite `ioFlows`: "7: depth below the blank = THROUGH_CUT note, no crash" |
| Material removal on a height field, removed volume | engine `stock.rs` | pending (lead) | UI suite `regressionChecks`: "the 3-D view shows the pocket cut to Z-6 around an uncut island"; part test: "pocket and hole both at depth" |
| Statistics: cycle time, feed and rapid path, moves, min Z | engine | pending (lead) | MCP test: "tnc_check runs the demo program through the real pipe: no errors, the engine's cycle time and path lengths"; engine crate test `runs_a_clean_program` |
| Whole behaviour frozen against the golden record | engine | pending (lead) | parity (compares the engine with `tests/golden/golden.jsonl.gz`) |
| The operator's CAM post output runs without errors | engine | pending (lead) | post test: every block shape in its table |

## 18. Web app pages

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Route guard: connecting message, server-not-answering message, sign-in when signed out | `Private` in web/src/main.tsx | pending (lead) | none found |
| Sign in with e-mail and password | web/src/pages/SignIn.tsx (shown on any private route) | pending (lead) | API test `accounts_first_is_admin_then_signup_closes`, `cookie_writes_must_be_same_origin` |
| Create the first account (sign-up form; the first account is the admin) | web/src/pages/SignIn.tsx, mode switch link | pending (lead) | API test `accounts_first_is_admin_then_signup_closes` |
| Link to the simulator without an account (`/sim/`) | web/src/pages/SignIn.tsx | pending (lead) | none found |
| Top bar: brand link, page links (Programs, Simulator, Tool tables, Account, Users for admins), user name, Sign out | web/src/components/Layout.tsx | pending (lead) | none found |
| Phone: page links behind a Menu button, Esc closes | `.nav-toggle` in web/src/components/Layout.tsx | pending (lead) | UI suite `serverChecks`: "web menu button ≥ 44 px", "web ... has no horizontal overflow at 360 px" |
| Skip-to-content link; "interpreter off" badge | web/src/components/Layout.tsx | pending (lead) | none found |
| Library (`/`): program table with name, machine, project, check, cycle, version, size, age | web/src/pages/Library.tsx | pending (lead) | API test `programs_are_versioned_and_checked`; UI suite `serverChecks`: web overflow check |
| Library: search names and program text; filter by machine | search form and machine select in web/src/pages/Library.tsx | pending (lead) | none found |
| Library: projects list (all, no project, each project), add, rename, delete | sidebar in web/src/pages/Library.tsx | pending (lead) | API test `projects_group_programs` |
| Library: new program (name, machine) | "New program" form in web/src/pages/Library.tsx | pending (lead) | API test `programs_are_versioned_and_checked` |
| Library: import files with a machine choice, and an import summary | "Import" controls and `ImportSummary` in web/src/pages/Library.tsx | pending (lead) | API test `import_and_export_round_trip`; formats crate test `cleans_like_ui_js`, `names`, `reads_header` |
| Library: export everything | export link (`api.exportUrl()`) in web/src/pages/Library.tsx | pending (lead) | API test `import_and_export_round_trip` |
| Library: trash view and restore a deleted program | trash item and restore button in web/src/pages/Library.tsx | pending (lead) | none found |
| Program (`/programs/:id`): Klartext editor with highlighting and check marks in the gutter | web/src/pages/Program.tsx; web/src/components/Editor.tsx | pending (lead) | none found |
| Program: view switch Editor / Split / Simulator (remembered) | `.seg` buttons in web/src/pages/Program.tsx | pending (lead) | none found |
| Program: live check while typing | `api.check` effect in web/src/pages/Program.tsx | pending (lead) | engine crate test `async_check_and_version`, `a_slow_check_times_out_for_the_caller` |
| Program: save as a new version with an optional message; Ctrl/Cmd+S | Save button and message box in web/src/pages/Program.tsx | pending (lead) | API test `programs_are_versioned_and_checked` |
| Program: "changed elsewhere" conflict (load theirs or overwrite) | conflict banner in web/src/pages/Program.tsx | pending (lead) | none found |
| Program: warning before leaving with unsaved changes | `beforeunload` handler in web/src/pages/Program.tsx | pending (lead) | none found |
| Program, Check tab: errors and events (click jumps to the line), cycle time, blocks, moves, paths, Z range, blank, removed volume, per-tool table | web/src/components/ReportPanel.tsx | pending (lead) | none found |
| Program, Versions tab: list, load a version into the editor, restore, download | `Versions` in web/src/pages/Program.tsx | pending (lead) | API test `programs_are_versioned_and_checked` |
| Program, Share tab: create a link (pin to a version, expiry), copy, open, revoke | `Shares` in web/src/pages/Program.tsx | pending (lead) | API test `share_links` |
| Program, Details tab: rename, change machine or project, download (UTF-8 or Windows-1252), move to trash | `Details` in web/src/pages/Program.tsx | pending (lead) | API test `import_and_export_round_trip` (download side); rename / trash none found |
| Share page (`/s/:token`): read-only program, check report, downloads, copy to my library | web/src/pages/SharePage.tsx | pending (lead) | API test `share_links` |
| Simulator host (`/simulator`): the simulator in a frame, "On screen" line, Save to library | web/src/pages/Simulator.tsx; web/src/components/SimFrame.tsx | pending (lead) | UI suite `serverChecks`: "simulator iframe fills the phone", "web /simulator shows the simulator's soft keys", "web /simulator at 360×740 shows every soft-key row in full" |
| Tool tables (`/tools`): per machine, holder type, add / edit / remove rows, save, upload TOOL.T, download TOOL.T, show built-in tools | web/src/pages/Tools.tsx | pending (lead) | API test `tool_table_changes_the_check`; formats crate test `tool_t_round_trip`, `validates_tools` |
| Account (`/account`): change password | web/src/pages/Account.tsx | pending (lead) | none found |
| Account: AI usage this month against the budget, default model | web/src/pages/Account.tsx | pending (lead) | API test `ai_proxy_keeps_the_key_and_the_budget` |
| Account: server information (server, interpreter, machines) | web/src/pages/Account.tsx | pending (lead) | none found |
| Admin (`/admin`, admins only): user list, make admin / user, disable / enable, set password, add an account | web/src/pages/Admin.tsx; `AdminOnly` in web/src/main.tsx | pending (lead) | API test `accounts_first_is_admin_then_signup_closes` (accounts side); the page itself none found |
| Unknown paths go back to the library | `path: '*'` in web/src/main.tsx | pending (lead) | none found |

## 19. Desktop app

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Splash while the local server starts; start-up errors shown on it | desktop/splash/index.html, desktop/splash/splash.js | pending (lead) | none found |
| The server runs inside the app on 127.0.0.1 with a remembered port (so browser storage survives) | `bind()`, `read_port()`, `write_port()` in desktop/src-tauri/src/lib.rs | pending (lead) | none found |
| Database in the system's app-data folder | `start()` in desktop/src-tauri/src/lib.rs | pending (lead) | none found |
| Automatic sign-in of the local operator through a one-time link; no Sign out button | `start()` in desktop/src-tauri/src/lib.rs; `info.local` in web/src/components/Layout.tsx | pending (lead) | API test `local_mode_one_time_sign_in_link` |
| Only the app's own Host is accepted; content security policy on every response | `allowed_hosts`, `CSP` in desktop/src-tauri/src/lib.rs | pending (lead) | API test `host_allow_list_and_security_headers`; UI suite `serverChecks`: "/sim/ carries the desktop CSP", "simulator runs under the CSP (fonts aside)", "foreign Host header refused (421)" |
| Links to other sites open in the system browser | navigation handler in desktop/src-tauri/src/lib.rs | pending (lead) | none found |
| A second launch brings the open window to the front | `tauri_plugin_single_instance` in desktop/src-tauri/src/lib.rs | pending (lead) | none found |
| Optional start page (`TNC_DESKTOP_START=/simulator`) | `start()` in desktop/src-tauri/src/lib.rs | pending (lead) | none found |
| The page gets no desktop (Tauri) commands | empty `capabilities` in desktop/src-tauri/tauri.conf.json | pending (lead) | none found |

## 20. MCP server tools

| Function | Old location (c6e6e7d) | New location | Existing test coverage |
|---|---|---|---|
| Server start, discovery and tool list (three read-only tools, matching `server.json`) | mcp/tnc-mcp.mjs, mcp/server.json | pending (lead) | MCP test: "server/discover and initialize: the server names itself and answers both eras", "tools/list: three read-only tools; server.json matches the live list, toolsHash included", "stdout carries protocol lines only, and the server ends when its input closes" |
| `tnc_check`: run a program and return errors, cycle time and path lengths (options: machine, autoTools, other programs) | tool `tnc_check` in mcp/tnc-mcp.mjs | pending (lead) | MCP test: "tnc_check runs the demo program through the real pipe: no errors, the engine's cycle time and path lengths", "tnc_check returns the errors the control raises, with block number and text" |
| `tnc_machines`: list the machines with axes and parameters | tool `tnc_machines` in mcp/tnc-mcp.mjs | pending (lead) | MCP test: "tnc_machines lists both machines; bad input is a tool error, unknowns protocol errors" |
| `tnc_example`: return a bundled demo program and the list of names | tool `tnc_example` in mcp/tnc-mcp.mjs | pending (lead) | MCP test: used by "tnc_check runs the demo program through the real pipe ..." |
