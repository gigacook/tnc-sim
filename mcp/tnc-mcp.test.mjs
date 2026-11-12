// tnc-mcp.test.mjs - node --test mcp/tnc-mcp.test.mjs. Starts the server as this test's own child, speaks JSON-RPC to it over stdio
// (server/discover, initialize, tools/list, tools/call) and stops it through the child handle. The demo program NAMEPLATE.H goes
// through the real pipe and its numbers are compared with the engine run directly in this process. Nothing is written.
// It also holds server.json to the live server: tool names, destructive list, run command and toolsHash.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toolsHash } from "./tnc-mcp.mjs"; // importing must not start the stdio loop

const SERVER = fileURLToPath(new URL("./tnc-mcp.mjs", import.meta.url));
const ENTRY = JSON.parse(readFileSync(new URL("./server.json", import.meta.url), "utf8"));
const TOOLS = ["tnc_check", "tnc_machines", "tnc_example"];
const require = createRequire(import.meta.url);
const ENGINE = require("../sim/engine.js"), MACHINES = require("../sim/machines.js"), PROGRAMS = require("../sim/programs.js");
const DEMO = [].concat(PROGRAMS["NAMEPLATE.H"]).join("\n");

// ---- the server, as this test's own child ------------------------------------------------------------------------------
const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const exited = new Promise((res) => child.once("exit", (code, signal) => res({ code, signal })));
const seen = [], waiting = new Map(); let nextId = 1, stderr = "";
child.stderr.on("data", (d) => { stderr += d; });
createInterface({ input: child.stdout }).on("line", (line) => {
  seen.push(line);
  let msg; try { msg = JSON.parse(line); } catch { return; }
  waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
});
const raw = (text) => child.stdin.write(text + "\n");
const answerTo = (id) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`no answer to ${id} in 30 s; stderr: ${stderr}`)), 30000); waiting.set(id, (m) => { clearTimeout(t); res(m); }); });
const request = (method, params) => { const id = nextId++; const p = answerTo(id); raw(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })); return p; };
const toolCall = async (name, args) => { const r = await request("tools/call", { name, arguments: args }); return { ...r.result, data: r.result?.isError ? null : JSON.parse(r.result.content[0].text) }; };
after(async () => { child.kill(); await exited; }); // through the handle, whatever a test did before

test("server/discover and initialize: the server names itself and answers both eras", async () => {
  const d = (await request("server/discover", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } })).result;
  assert.equal(d.supportedVersions[0], "2026-07-28"); assert.deepEqual(d.supportedVersions, ENTRY._meta["io.gigacook/entry"].protocol);
  assert.deepEqual(d.capabilities, { tools: {} }); assert.equal(d.serverInfo.name, "tnc-sim"); assert.equal(d.serverInfo.version, ENTRY.version);
  const i = (await request("initialize", { protocolVersion: "2025-06-18", capabilities: {} })).result;
  assert.equal(i.protocolVersion, "2025-06-18"); assert.equal(i.serverInfo.name, "tnc-sim");
  assert.ok((await request("initialize", { capabilities: {} })).result.protocolVersion < "2026-07-28");
  raw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })); // a notification gets no answer
  assert.deepEqual((await request("ping")).result, {});
});

test("tools/list: three read-only tools; server.json matches the live list, toolsHash included", async () => {
  const { tools } = (await request("tools/list")).result, e = ENTRY._meta["io.gigacook/entry"];
  assert.deepEqual(tools.map((t) => t.name), TOOLS);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object"); assert.equal(t.inputSchema.additionalProperties, false); assert.ok(t.description.length > 40, t.name);
    assert.deepEqual(t.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  }
  assert.deepEqual(tools[0].inputSchema.required, ["program"]);
  assert.equal(ENTRY.name, "io.gigacook/tnc-sim"); assert.match(ENTRY.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/[\d-]+\/server\.schema\.json$/);
  assert.deepEqual(e.tools, TOOLS); assert.deepEqual(e.destructive, []);
  assert.match(e.toolsHash, /^[0-9a-f]{64}$/);
  assert.equal(e.toolsHash, toolsHash(tools), `server.json toolsHash is stale: the live tools/list hashes to ${toolsHash(tools)}`);
  assert.equal(toolsHash([...tools].reverse()), toolsHash(tools));
  const core = join(homedir(), "gigacook", "core", "mcp", "gigacook-mcp.mjs"); // the one canonical rule: the template's export agrees
  if (existsSync(core)) { const m = await import(pathToFileURL(core).href); if (m.toolsHash) assert.equal(m.toolsHash(tools), e.toolsHash); }
  assert.deepEqual(e.run, { command: "node", args: ["%USERPROFILE%\\Developer\\tnc-sim\\mcp\\tnc-mcp.mjs"], transport: "stdio" });
  assert.equal(e.probe.method, "server/discover"); assert.equal(e.probe.fallback, "initialize");
  assert.equal(tools.find((t) => t.name === e.probe.tool).annotations.readOnlyHint, true);
  assert.deepEqual(e.clients, ["claude-code", "assgpt"]); assert.equal(e.live, false); assert.deepEqual(e.autofix, ["reregister", "restart"]);
  assert.doesNotMatch(JSON.stringify(ENTRY), /[A-Za-z]:(\\\\|\/)+Users(\\\\|\/)/i);
});

test("tnc_check runs the demo program through the real pipe: no errors, the engine's cycle time and path lengths", async () => {
  const ex = await toolCall("tnc_example", {});
  assert.equal(ex.data.name, "NAMEPLATE.H"); assert.equal(ex.data.program, DEMO); assert.deepEqual(ex.data.names, Object.keys(PROGRAMS));
  for (const machine of ["426", "430"]) {
    const r = await toolCall("tnc_check", { program: ex.data.program, machine });
    assert.equal(r.isError, false, r.content[0].text);
    const direct = ENGINE.TNC.run(DEMO, { tools: ENGINE.TOOLS, machine: MACHINES[machine] ?? null }).stats;
    assert.equal(r.data.ok, true); assert.deepEqual(r.data.errors, []); assert.equal(r.data.machine, machine);
    assert.ok(r.data.cycleTime > 60, String(r.data.cycleTime)); assert.equal(r.data.cycleTime, Math.round(direct.cycleTime * 10) / 10);
    assert.match(r.data.cycleTimeText, /^\d\d:\d\d\.\d$/);
    assert.equal(r.data.paths.feed, Math.round(direct.pathFeed * 10) / 10); assert.equal(r.data.paths.total, Math.round(direct.pathTotal * 10) / 10);
    assert.ok(r.data.paths.feed > 0 && r.data.paths.rapid > 0); assert.equal(r.data.blocks, direct.blockCount);
    assert.ok(r.data.toolsUsed.some((t) => t.t === 9));
  }
});

test("tnc_check returns the errors the control raises, with block number and text", async () => {
  const r = await toolCall("tnc_check", { program: "BEGIN PGM X MM\nL X+10 FOO\nCYCL DEF 99.0 NOPE\nEND PGM X MM" });
  assert.equal(r.isError, false); assert.equal(r.data.ok, false);
  assert.deepEqual(r.data.errors, [{ block: 1, msg: "BLOCK FORMAT INCORRECT", raw: "L X+10 FOO" }, { block: 2, msg: "CYCLE 99 NOT ON TNC 426/430", raw: "CYCL DEF 99.0 NOPE" }]);
});

test("tnc_machines lists both machines; bad input is a tool error, unknowns protocol errors", async () => {
  const m = await toolCall("tnc_machines", {});
  assert.deepEqual(m.data.machines.map((x) => [x.id, x.axes]), [["426", ["X", "Y", "Z"]], ["430", MACHINES["430"].axes]]);
  assert.equal(m.data.tools, ENGINE.TOOLS.length);
  assert.match((await toolCall("tnc_check", { program: DEMO, machine: "530" })).content[0].text, /^tnc_check: machine must be one of 426, 430/);
  assert.equal((await toolCall("tnc_check", {})).isError, true);
  assert.equal((await toolCall("tnc_check", { program: DEMO, extra: 1 })).isError, true);
  assert.match((await toolCall("tnc_example", { name: "NOPE.H" })).content[0].text, /^tnc_example: no bundled program/);
  assert.equal((await request("tools/call", { name: "tnc_nothing", arguments: {} })).error.code, -32602);
  assert.equal((await request("resources/list")).error.code, -32601);
  const parse = answerTo(null); raw("{ not json");
  assert.equal((await parse).error.code, -32700);
});

test("stdout carries protocol lines only, and the server ends when its input closes", async () => {
  for (const line of seen) assert.equal(JSON.parse(line).jsonrpc, "2.0");
  assert.ok(seen.length >= 15);
  child.stdin.end();
  let timer; const end = await Promise.race([exited, new Promise((res) => { timer = setTimeout(() => res(null), 10000); })]);
  clearTimeout(timer);
  assert.deepEqual(end, { code: 0, signal: null });
});
