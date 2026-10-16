/* The Rust engine for the parity check: the WASM build of server/crates/tnc-core behind sim/engine.js, the same glue
   the simulator ships (run, expand, grid, analyse all in the engine). TNC_WASM=<path> picks the module;
   default: sim/engine/tnc_core.wasm (what build.py inlines). */
const path = require('path');
module.exports = function () {
  const ROOT = path.join(__dirname, '..', '..');
  const E = require(path.join(ROOT, 'sim', 'engine.js'));
  if (!E.ready()) throw new Error('no engine: build it (python build.py --wasm) or set TNC_WASM');
  return { name: 'rust', run: E.run, TOOLS: E.TOOLS, MACHINES: require(path.join(ROOT, 'sim', 'machines.js')), expand: E.SIM.expand, grid: E.SIM.grid, analyse: E.SIM.analyse, STOCK: E.STOCK };
};
