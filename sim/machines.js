/* ============================================================
   TNC_MACHINE_CONFIGS — the machine parameters that change interpreter results.
   No DOM. Shared by ui.js (browser), the Rust engine (server/crates/tnc-core reads the JSON block below at
   build time) and tests, so a program compiles the same way everywhere. A new machine is one entry here.
   The block between the markers must stay strict JSON (quoted keys, no comments, no trailing commas).

   TNC 430: the operator's machine, from its machine-parameter list (vertical, A/B swivel head).
   Head: B (outer, near the body) carries A (inner, holds the spindle); at A0 B0 the tool points to Z-;
   A+ tilts the tip to Y+, B+ to X+; A-90 B0 = horizontal. Pivots ~250 mm (operator's estimate).
   sMax 3000: the operator's figure (MP 3515 lists 2500 for gear 2).
   ============================================================ */
var TNC_MACHINE_CONFIGS = (function () {
  'use strict';
  return /* JSON-BEGIN */ {
    "426": null,
    "430": { "arcTol": 0.006, "pocketK": 1.1, "fMax": 1500, "accel": 0.4, "sMax": 3000,
      "rapid": { "x": 9000, "y": 10000, "z": 5000, "a": 4000, "b": 1000 }, "axes": ["X", "Y", "Z", "B", "A"],
      "limits": { "X": [2, 1250.2], "Y": [-850.2, 0.2], "Z": [-500.2, 0.2], "B": [-180.1, 0.1], "A": [-195, 15] },
      "head": { "inner": "A", "outer": "B", "pivotA": 250, "pivotB": 250 } }
  } /* JSON-END */;
})();
if (typeof module !== 'undefined') module.exports = TNC_MACHINE_CONFIGS;
