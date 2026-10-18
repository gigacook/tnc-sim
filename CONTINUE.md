# CONTINUE.md — goal, tasks, open placeholders

**Goal:** a program written here runs the same on a real TNC 426/430 (moves, errors, timing).
**Finish line:** every task below checked. After that, only the programming station (#20) can prove more.

Agents: take the first unchecked, unblocked task. Check it off in the same commit as the work, with date, how it was
verified, where it ran, and the commit (pushed to main).

## Tasks

### 1. Interpreter: what the 426/430 manual describes
| ✓ | id | task | date | verified via | tested on | commit |
|---|---|---|---|---|---|---|
| x | #1 | SL: M functions in a contour subprogram ignored (M99 crashed the engine) | 10-18 | manual.js, parity | Win 11 | 811c947 |
| x | #2 | SL: datum shift / rotation / mirror inside a subcontour stays in the cycle | 10-18 | manual.js, parity | Win 11 | 6ceb646 |
| x | #3 | SL: channels just wider than the tool are cut | 10-18 | manual.js, parity | Win 11 | 6a13a4f |
| x | #4 | Cycles 1 and 21: advanced stop distance 0.6 mm / depth÷50 (p. 211) | 10-18 | manual.js, parity re-recorded | Win 11 | f9b38ba |
| x | #5 | SL 25: tool too big for an inside corner leaves the corner, no error, no gouge (p. 295) | 10-18 | manual.js, parity | Win 11 | 02ca566 |
| x | #6 | TOOL CALL X / Y: stops with TOOL AXIS n NOT SIMULATED instead of milling as Z (p. 205). Full X / Y spindle support moved to Later: all 3,564 corpus TOOL CALLs are Z | 10-18 | manual.js, parity | Win 11 | f35bd8c |
|   | #7 | FK free contour programming (also needed by the manual's SL example C20) | | manual.js | | |
|   | #8 | Cycle 3 slot milling | | manual.js | | |
|   | #9 | Cycle 5 circular pocket | | manual.js | | |
|   | #10 | Cycle 12 PGM CALL | | manual.js | | |
|   | #11 | Cycle 13 oriented spindle stop | | manual.js | | |
|   | #12 | Cycle 26 axis-specific scaling | | manual.js | | |
|   | #13 | Cycles 27 / 28 cylinder surface | | manual.js | | |
|   | #14 | F AUTO from a cutting-data table (today: the TOOL CALL feed) | | manual.js | | |

### 2. Shipping
| ✓ | id | task | date | verified via | tested on | commit |
|---|---|---|---|---|---|---|
| x | #15 | CI: index.html reproducible on Linux (zlib vs zlib-ng) | 10-18 | CI step green | ubuntu CI | bcebb94 |
|   | #16 | CI: browser suite I/O checks (Ctrl+O, CRLF listing, zip, profile zip) fail on Linux, pass on Windows | | CI green | | |
|   | #17 | CI: phone swipe check passes 3 runs in a row | | CI | | |
|   | #18 | GitHub Pages: site from `/docs` on main (today 404) | | the README link opens | | |
|   | #19 | Desktop app opens on macOS and Windows (CI only builds them) | | launched by hand | | |

### 3. Proof (needs the user)
| ✓ | id | task | date | verified via | tested on | commit |
|---|---|---|---|---|---|---|
|   | #20 | Programming station as the oracle: 15–25 programs compared (docs/PROGRAMMING-STATION.md). Blocked: user sets up the Windows VM + station demo | | tests/station.js | | |
|   | #21 | Phone layout on a real iPhone and Android phone | | user | | |

### Later (not on the finish line)
Horizontal spindle (TOOL CALL X / Y) · programs to the machine (USB stick, LSV-2 Ethernet, RS-232) · graphics realism · touch-probe soft key · undercuts (voxel stock) · AI part ghost in 3-D · GPU material removal · Tauri mobile.

## Decisions
- Rust engine `tnc-core`, one copy: native in the server, WebAssembly in the browser. Behaviour frozen by `tests/parity.js`.
- One simulator everywhere: the desktop app (Tauri 2) shows the same `index.html` in the system WebView, with the server running inside the app on 127.0.0.1.
- AI: OpenRouter only, DeepSeek V4.1 Flash recommended. Plan → write → check → measure → refine.
- Open: graphics engine. Today three.js; do the realism work first, switch only if that isn't enough (a native engine would end the single offline HTML file).
- Open, for the user: how does the operator move programs to the machine, and does his 430 have Ethernet?

## Open placeholders — NOT facts (each is marked in code; #20 settles them)
| id | where | placeholder |
|---|---|---|
| T-thread | exec.rs cycle_thread | 262–267: helix whole turns from +X; approach semicircle +½ pitch; 267 start R + pitch; 263 countersink circle not simulated; 264 countersink feed Q206; no M4 / spindle-off error |
| T6 / SL6 | exec.rs, sl.rs | a positive depth's sign is ignored (manual: it reverses the direction) |
| SL1 | sl.rs capture | a subcontour with R0 counts as a pocket |
| SL2 | sl.rs field | only islands: "SL CONTOUR WITHOUT POCKET NOT SIMULATED" |
| SL3 | sl.rs plan/centre | rough-out plunge = the point farthest from the walls; loops join at the nearest vertex |
| SL4 | sl.rs reposition | between passes: straight at depth if safe, else up to Q7, over, down at Q11 |
| SL5 | sl.rs tool_r | 21: Q13 = 0 means the current tool |
| SL7 | sl.rs run | tool too big: TOOL RADIUS TOO LARGE (message not in the manual) |
| SL8 | sl.rs run | 23: rough-out loops once at the floor, straight plunge (manual: tangential arc) |
| SL9 | sl.rs side_finish | 24: quarter-arc in/out of radius R, halved until it fits |
| SL10 | sl.rs train | 25: rapid to Q5 + 2 mm, then Q11 |
| SL11 | sl.rs run | not simulated: Q8, Q18 rest material, Q19, MP 7420 +4. MP 7420 default 0 (426), 8 (430) |
| SL12 | sl.rs train | 25: climb = RL assumes M3; Q15 ±1 goes up to Q7 between infeeds |
| SL13 | sl.rs run | 24: down to Q1 (Q4 not kept); p. 294 check Q14 + R < Q3 + rough-out R not made |
| SL14 | sl.rs field | 3+ subcontours each tested against the first one's start point; missing 14/20 = CYCL DEF INCOMPLETE |
| P1–P7 | exec.rs run_probe | MP 6140 = 2 mm; stylus placement; datum tables not simulated; presets translation-only; touch order from the figures |
| V1 | stock.rs | vice: jaws on Y, 160 × 25 mm, grips 6 mm (a guess, not the operator's vice) |
| V2 | stock.rs HEAD_LEN | tilted head = 300 mm cylinder |
| K1 | ui.js, dialogs.js | keypad details not in the manual (END takes the entry, I and −/+ toggles, CE twice, PC-keyboard bindings) |
| AI1 | part.js | engraving font is the simulator's own |
| AI2 | part.js compare | feature edges within half a grid cell not counted; Z tolerance 0.1 mm |
