# Programming station as the oracle (CONTINUE.md #20)

A HEIDENHAIN programming station is the control's software on a PC. Running the same programs on it and on the
simulator is the only way to prove behaviour the manual leaves open. It adds no features.

## What it can settle
1. Exact error messages and the block each is flagged on.
2. Machining time in TEST RUN (the simulator sums length ÷ feed).
3. Tool paths the manual doesn't draw: SL cycles 21–24, thread milling, probing (the placeholders in CONTINUE.md).
4. Dialog prompt order (L, TOOL CALL, BLK FORM, NEW PGM).
5. Cycle 19 and the tilted head.

## What it can't
- Which syntax the 426 accepts: the available stations are iTNC 530 / TNC 640, which accept more. The 426/430
  manual (`research/tnc426_430_280476_manual_en.txt`) decides validity.
- The 426 screen and soft keys (the iTNC UI differs).

## Steps
1. The user installs the station demo in a Windows VM (check first that HEIDENHAIN still offers a free demo and
   its block limit; ask before installing anything).
2. Golden set of 15–25 programs: BRACKET.H, NAMEPLATE.H, the `tests/manual.js` examples, SL and thread cycles.
3. Per program, from TEST RUN: accepted or error + block, machining time, end position.
4. Store as `tests/golden/station/*.json`; `tests/station.js` asserts the simulator matches, like `tests/manual.js`.
5. Raw captures and screenshots stay in `research/` (gitignored). Commit only numbers and our own descriptions.
