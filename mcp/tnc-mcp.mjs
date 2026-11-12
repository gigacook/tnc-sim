#!/usr/bin/env node
// tnc-mcp.mjs - MCP server over stdio (JSON-RPC by hand, no dependency) that checks HEIDENHAIN Klartext programs with the simulator's engine.
// Copies the template %USERPROFILE%\gigacook\core\mcp\gigacook-mcp.mjs (rules: %USERPROFILE%\gigacook\core\conventions\mcp.md).
//   node tnc-mcp.mjs        one JSON-RPC message per line on stdin, one answer per line on stdout; ends when stdin closes
// Methods: server/discover (2026-07-28), initialize and ping (older clients), tools/list, tools/call (notifications get no answer).
// Tools: tnc_check, tnc_machines, tnc_example. The engine is ..\sim\engine.js loaded the way it documents for node: require() it and
// it instantiates ..\sim\engine\tnc_core.wasm next to itself (TNC_WASM picks another build). Machines come from ..\sim\machines.js,
// the demo programs from ..\sim\programs.js; nothing of the engine's logic is copied here. Nothing is written anywhere.
// Exports toolList() and toolsHash(tools); importing starts nothing.
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = JSON.parse(readFileSync(new URL("./server.json", import.meta.url), "utf8"));
export const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]; // newest first; the client's choice wins when it is one of these
const DISCOVER_ERA = "2026-07-28"; // from here on initialize is gone; initialize without a known version gets the newest version before it
const SERVER_INFO = { name: "tnc-sim", title: ENTRY.title, version: ENTRY.version };
const CAPABILITIES = { tools: {} };
const INSTRUCTIONS = "Checks HEIDENHAIN TNC 426/430 Klartext programs with the simulator's own engine: tnc_check runs a program and returns the errors the control would raise, the cycle time and the path lengths; tnc_machines lists the two machines; tnc_example returns a bundled demo program. An educational simulator, not a verification for a real machine.";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOLS = [
  { name: "tnc_check", description: "Run a Klartext program (BEGIN PGM ... END PGM) through the TNC 426/430 simulator engine and return the errors the control would raise (block number, message, block text), the cycle time in seconds, the feed, rapid and total path lengths in mm, the Z range, the tools used and the removed volume.",
    params: {
      program: { type: "string", description: "The whole program text, one block per line.", required: true },
      machine: { type: "string", description: "\"426\" (X Y Z, the default) or \"430\" (the operator's machine with the A/B swivel head and its machine parameters)." },
      autoTools: { type: "boolean", description: "Make up a tool for every TOOL CALL that is not in the tool table instead of raising an error (default false)." },
      programs: { type: "object", description: "Other programs on the control for CALL PGM and cycle 12, as { \"NAME.H\": text }." },
    } },
  { name: "tnc_machines", description: "List the simulated machines: id, label, axes and the machine parameters that change interpreter results (from sim\\machines.js), plus the tool table size.",
    params: {} },
  { name: "tnc_example", description: "Return a demo program bundled with the simulator (NAMEPLATE.H by default) with the names of all bundled programs, ready to pass to tnc_check.",
    params: { name: { type: "string", description: "Program name, for example NAMEPLATE.H or BRACKET.H." } } },
];
export const toolList = () => TOOLS.map((t) => ({
  name: t.name, description: t.description,
  inputSchema: { type: "object", properties: Object.fromEntries(Object.entries(t.params).map(([k, p]) => [k, { type: p.type, description: p.description }])),
    required: Object.entries(t.params).filter(([, p]) => p.required).map(([k]) => k), additionalProperties: false },
  annotations: READ,
}));

// sha256 of the canonical JSON (keys sorted at every level) of a tools/list result's tools, sorted by name (conventions\mcp.md).
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
export const toolsHash = (tools) => createHash("sha256").update(canonical([...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))).digest("hex");

// ---- the simulator's own modules, loaded on first use -----------------------------------------------------------------
const require = createRequire(import.meta.url);
let sim = null;
function load() {
  if (!sim) {
    const engine = require("../sim/engine.js");
    if (!engine.ready()) throw new Error("TNC engine not loaded: sim\\engine\\tnc_core.wasm is missing (python3 build.py --wasm)");
    sim = { engine, machines: require("../sim/machines.js"), programs: require("../sim/programs.js") };
  }
  return sim;
}
const MACHINE_IDS = ["426", "430"];
const LABEL = { 426: "TNC 426", 430: "TNC 430" };
const axesOf = (cfg) => cfg?.axes ?? ["X", "Y", "Z"]; // machines.js: a missing entry is the plain 426 default
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const fail = (msg) => { throw new Error(msg); };

function check(a) {
  const { engine, machines } = load();
  const program = typeof a.program === "string" && a.program.trim() ? a.program : fail("program is required");
  const machine = a.machine === undefined ? "426" : MACHINE_IDS.includes(String(a.machine)) ? String(a.machine) : fail(`machine must be one of ${MACHINE_IDS.join(", ")}`);
  if (a.autoTools !== undefined && typeof a.autoTools !== "boolean") fail("autoTools must be true or false");
  if (a.programs !== undefined && (!a.programs || typeof a.programs !== "object" || Array.isArray(a.programs) || Object.values(a.programs).some((v) => typeof v !== "string"))) fail("programs must be an object of name to program text");
  const cfg = machines[machine] ?? null;
  const r = engine.TNC.run(program, { tools: engine.TOOLS, machine: cfg, autoTools: a.autoTools === true, programs: a.programs ?? null });
  const raw = new Map(r.blocks.map((b) => [b.n, b.raw]));
  const errors = (r.errors ?? []).map((e) => ({ block: e.block, msg: e.msg, ...(raw.has(e.block) ? { raw: raw.get(e.block) } : {}) }));
  const s = r.stats ?? {};
  return {
    ok: errors.length === 0, machine, errors,
    cycleTime: round(s.cycleTime, 1), cycleTimeText: Number.isFinite(s.cycleTime) ? clock(s.cycleTime) : null,
    paths: { feed: round(s.pathFeed, 1), rapid: round(s.pathRapid, 1), total: round(s.pathTotal, 1), unit: "mm" },
    minZ: s.minZ, maxZ: s.maxZ, blocks: s.blockCount, moves: s.moveCount, rapidRate: s.rapidRate,
    toolsUsed: (s.toolsUsed ?? []).map((t) => ({ t: t.t, name: t.name, r: t.r, l: t.l, moves: t.moves, time: round(t.time, 1) })),
    removedVolume: round(s.removedVolume, 1),
  };
}

function callTool(name, a) {
  if (name === "tnc_check") return check(a);
  if (name === "tnc_machines") {
    const { engine, machines } = load();
    return { machines: MACHINE_IDS.map((id) => ({ id, label: LABEL[id], axes: axesOf(machines[id]), config: machines[id] ?? null })), tools: engine.TOOLS.length };
  }
  if (name === "tnc_example") {
    const { programs } = load(), names = Object.keys(programs);
    const pick = a.name === undefined ? names[0] : names.find((n) => n.toUpperCase() === String(a.name).toUpperCase()) ?? fail(`no bundled program ${a.name} (have ${names.join(", ")})`);
    const text = Array.isArray(programs[pick]) ? programs[pick].join("\n") : String(programs[pick]);
    return { name: pick, names, program: text };
  }
  return undefined;
}

const rpcError = (code, message) => Object.assign(new Error(message), { rpc: code });
export async function handle(method, params = {}) {
  if (method === "server/discover") return { supportedVersions: VERSIONS, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS };
  if (method === "initialize") return { protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS.find((v) => v < DISCOVER_ERA),
    capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS };
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: toolList() };
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) throw rpcError(-32602, `Unknown tool: ${params.name}`);
    const args = params.arguments ?? {};
    try {
      const extra = Object.keys(args).filter((k) => !(k in tool.params));
      if (extra.length) fail(`unknown argument ${extra.join(", ")}`);
      return { content: [{ type: "text", text: JSON.stringify(callTool(tool.name, args), null, 2) }], isError: false };
    } catch (e) { return { content: [{ type: "text", text: `${tool.name}: ${e.message}` }], isError: true }; } // a failed call is a tool result, not a protocol error
  }
  throw rpcError(-32601, `Method not found: ${method}`);
}

function serve() {
  console.log = (...a) => console.error(...a); // a stray log line must never land in the protocol stream
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  async function onMessage(msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      if (msg && typeof msg === "object" && ("result" in msg || "error" in msg)) return; // an answer to nothing we asked
      return send({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
    }
    const wantsAnswer = msg.id !== undefined && msg.id !== null;
    try { const result = await handle(msg.method, msg.params ?? {}); if (wantsAnswer) send({ jsonrpc: "2.0", id: msg.id, result }); }
    catch (e) { if (wantsAnswer) send({ jsonrpc: "2.0", id: msg.id, error: { code: e.rpc ?? -32603, message: e.message } }); }
  }
  const pending = new Set();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    for (const m of Array.isArray(msg) ? msg : [msg]) { const p = onMessage(m).finally(() => pending.delete(p)); pending.add(p); }
  });
  rl.on("close", async () => { await Promise.allSettled([...pending]); process.exit(0); });
}

const self = fileURLToPath(import.meta.url), entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (process.platform === "win32" ? self.toLowerCase() === entry.toLowerCase() : self === entry) serve();
