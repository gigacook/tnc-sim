// The typed side of the simulator bridge (sim/bridge.js is the other side; contract in docs/BUILD_STATE.md).
// Every incoming message is checked three ways before anyone sees it: origin, source window and payload shape.
// Unknown types and malformed payloads are dropped. Nothing here reads the iframe's DOM.
// No DOM access at import time, so the validators also run under `node --test`.

export type MachineId = '426' | '430';
export type Lang = 'sv' | 'en';
export type Skin = '426' | '430';
export type Env = 'cold-steel' | 'workshop-night';
export type Quality = 'low' | 'medium' | 'high';
export type Motion = 'full' | 'reduced';
export type ExecCmd = 'start' | 'stop' | 'step' | 'reset';
export type CameraView = 'orbit' | 'pov' | 'tool' | 'part' | 'plan';

/** A tool-table row, the same shape `tnc:open` takes. Extra numeric/string columns pass through. */
export interface BridgeTool {
  t: number;
  name?: string;
  l: number;
  r: number;
  [k: string]: unknown;
}

export interface Present {
  lang?: Lang;
  skin?: Skin;
  env?: Env;
  quality?: Quality;
  motion?: Motion;
  sound?: boolean;
}

export interface SimState {
  running: boolean;
  cutting: boolean;
  mode: string;
  machine: string;
  tool: { t: number; r: number; l: number } | null;
  pos: { x: number; y: number; z: number; a: number; b: number } | null;
  spindle: { on: boolean; rpm: number };
  coolant: boolean;
  progress: number;
  errors: number;
  done: boolean;
}

/** sim -> app */
export type SimMessage =
  | { type: 'tnc:ready'; v: 1 | 2; edition?: string; machine?: string; lang?: string }
  | { type: 'tnc:program'; id: string; name: string; machine: string; text: string }
  | { type: 'tnc:changed'; name: string; machine: string; text: string }
  | { type: 'tnc:selected'; name: string; machine: string }
  | ({ type: 'tnc:state' } & SimState)
  | { type: 'tnc:tools'; id: string; tools: BridgeTool[] }
  | { type: 'tnc:exit' }
  | ({ type: 'tnc:settings' } & Present);

/** app -> sim */
export type AppMessage =
  | { type: 'tnc:open'; name: string; text: string; machine: string; tools?: BridgeTool[] }
  | { type: 'tnc:get'; id: string }
  | { type: 'tnc:hello'; v: 2 }
  | ({ type: 'tnc:present' } & Present)
  | { type: 'tnc:machine'; machine: MachineId }
  | { type: 'tnc:exec'; cmd: ExecCmd }
  | { type: 'tnc:camera'; view: CameraView }
  | { type: 'tnc:lock'; locked: boolean; reason?: string }
  | { type: 'tnc:tools:get'; id: string }
  | { type: 'tnc:tools:set'; tools: BridgeTool[] };

/* ---------- validation ---------- */
const MAX_TEXT = 4_000_000; // a program far beyond any real one; stops a hostile frame from flooding the app
const MAX_TOOLS = 1000;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === 'string' && (set as readonly string[]).includes(v);

export const LANGS = ['sv', 'en'] as const;
export const SKINS = ['426', '430'] as const;
export const ENVS = ['cold-steel', 'workshop-night'] as const;
export const QUALITIES = ['low', 'medium', 'high'] as const;
export const MOTIONS = ['full', 'reduced'] as const;

/** A valid tool row or null. Only plain numbers, strings and booleans survive. */
export function parseTool(v: unknown): BridgeTool | null {
  if (!isObj(v) || !num(v.t) || !num(v.l) || !num(v.r)) return null;
  if (v.name !== undefined && !str(v.name, 64)) return null;
  const out: BridgeTool = { t: v.t, l: v.l, r: v.r };
  for (const [k, x] of Object.entries(v)) {
    if (k.length > 24 || k === '__proto__' || k === 'constructor') continue;
    if (num(x) || bool(x) || str(x, 64)) out[k] = x;
  }
  return out;
}

export function parseTools(v: unknown): BridgeTool[] | null {
  if (!Array.isArray(v) || v.length > MAX_TOOLS) return null;
  const out: BridgeTool[] = [];
  for (const row of v) {
    const t = parseTool(row);
    if (!t) return null;
    out.push(t);
  }
  return out;
}

/** The presentation fields that are present and valid; an invalid field makes the whole payload invalid. */
export function parsePresent(v: Record<string, unknown>): Present | null {
  const p: Present = {};
  if (v.lang !== undefined) {
    if (!oneOf(v.lang, LANGS)) return null;
    p.lang = v.lang;
  }
  if (v.skin !== undefined) {
    if (!oneOf(v.skin, SKINS)) return null;
    p.skin = v.skin;
  }
  if (v.env !== undefined) {
    if (!oneOf(v.env, ENVS)) return null;
    p.env = v.env;
  }
  if (v.quality !== undefined) {
    if (!oneOf(v.quality, QUALITIES)) return null;
    p.quality = v.quality;
  }
  if (v.motion !== undefined) {
    if (!oneOf(v.motion, MOTIONS)) return null;
    p.motion = v.motion;
  }
  if (v.sound !== undefined) {
    if (!bool(v.sound)) return null;
    p.sound = v.sound;
  }
  return p;
}

function parseState(v: Record<string, unknown>): SimState | null {
  if (!bool(v.running) || !bool(v.cutting) || !str(v.mode, 32) || !str(v.machine, 16)) return null;
  if (!bool(v.coolant) || !num(v.progress) || !num(v.errors) || !bool(v.done)) return null;
  if (!isObj(v.spindle) || !bool(v.spindle.on) || !num(v.spindle.rpm)) return null;
  let tool: SimState['tool'] = null;
  if (v.tool !== null) {
    if (!isObj(v.tool) || !num(v.tool.t) || !num(v.tool.r) || !num(v.tool.l)) return null;
    tool = { t: v.tool.t, r: v.tool.r, l: v.tool.l };
  }
  let pos: SimState['pos'] = null;
  if (v.pos !== null) {
    const p = v.pos;
    if (!isObj(p) || !num(p.x) || !num(p.y) || !num(p.z) || !num(p.a) || !num(p.b)) return null;
    pos = { x: p.x, y: p.y, z: p.z, a: p.a, b: p.b };
  }
  return {
    running: v.running,
    cutting: v.cutting,
    mode: v.mode,
    machine: v.machine,
    tool,
    pos,
    spindle: { on: v.spindle.on, rpm: v.spindle.rpm },
    coolant: v.coolant,
    progress: v.progress,
    errors: v.errors,
    done: v.done,
  };
}

/** A checked, rebuilt copy of a simulator message, or null. The returned object never aliases the input. */
export function parseSimMessage(data: unknown): SimMessage | null {
  if (!isObj(data) || !str(data.type, 32)) return null;
  const d = data;
  switch (d.type) {
    case 'tnc:ready': {
      // v1 sends a bare {type}; v2 adds v, edition, machine, lang
      if (d.v === undefined) return { type: 'tnc:ready', v: 1 };
      if (d.v !== 2) return null;
      if ((d.edition !== undefined && !str(d.edition, 16)) || (d.machine !== undefined && !str(d.machine, 16)) || (d.lang !== undefined && !str(d.lang, 8))) return null;
      return { type: 'tnc:ready', v: 2, edition: d.edition as string | undefined, machine: d.machine as string | undefined, lang: d.lang as string | undefined };
    }
    case 'tnc:program':
      if (!str(d.id, 64) || !str(d.name, 64) || !str(d.machine, 16) || !str(d.text, MAX_TEXT)) return null;
      return { type: 'tnc:program', id: d.id, name: d.name, machine: d.machine, text: d.text };
    case 'tnc:changed':
      if (!str(d.name, 64) || !str(d.machine, 16) || !str(d.text, MAX_TEXT)) return null;
      return { type: 'tnc:changed', name: d.name, machine: d.machine, text: d.text };
    case 'tnc:selected':
      if (!str(d.name, 64) || !str(d.machine, 16)) return null;
      return { type: 'tnc:selected', name: d.name, machine: d.machine };
    case 'tnc:state': {
      const s = parseState(d);
      return s ? { type: 'tnc:state', ...s } : null;
    }
    case 'tnc:tools': {
      const tools = parseTools(d.tools);
      if (!str(d.id, 64) || !tools) return null;
      return { type: 'tnc:tools', id: d.id, tools };
    }
    case 'tnc:exit':
      return { type: 'tnc:exit' };
    case 'tnc:settings': {
      const p = parsePresent(d);
      return p ? { type: 'tnc:settings', ...p } : null;
    }
    default:
      return null;
  }
}

/* ---------- the bridge ---------- */
type Of<T extends SimMessage['type']> = Extract<SimMessage, { type: T }>;
type Handler<T extends SimMessage['type']> = (m: Of<T>) => void;

/** What the simulator on the other side can do: none = no answer (a plain page without the bridge), 1 = v1, 2 = contract v2. */
export type BridgeLevel = 0 | 1 | 2;

export interface Bridge {
  /** 0 until the simulator answered. */
  readonly level: BridgeLevel;
  readonly ready: Of<'tnc:ready'> | null;
  on<T extends SimMessage['type']>(type: T, fn: Handler<T>): () => void;
  onLevel(fn: (level: BridgeLevel) => void): () => void;
  /** Say hello (v2) and poke v1; call when the iframe has loaded. Safe to repeat. */
  hello(): void;
  open(p: { name: string; text: string; machine: string; tools?: BridgeTool[] }): void;
  /** The program on the simulator's screen (v1 and v2). */
  current(timeoutMs?: number): Promise<{ name: string; machine: string; text: string }>;
  present(p: Present): void;
  machine(machine: MachineId): void;
  exec(cmd: ExecCmd): void;
  camera(view: CameraView): void;
  lock(locked: boolean, reason?: string): void;
  tools(timeoutMs?: number): Promise<BridgeTool[]>;
  setTools(tools: BridgeTool[]): void;
  dispose(): void;
}

interface Host {
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

/**
 * @param target the simulator's window (the iframe's contentWindow), looked up on every use because it changes on reload
 * @param origin the only origin accepted and posted to (the page's own)
 */
export function createBridge(target: () => Window | null | undefined, origin: string, host: Host = window): Bridge {
  const handlers = new Map<string, Set<(m: SimMessage) => void>>();
  const levelFns = new Set<(l: BridgeLevel) => void>();
  const pending = new Map<string, { ok: (m: SimMessage) => void; timer: ReturnType<typeof setTimeout> }>();
  let level: BridgeLevel = 0;
  let ready: Of<'tnc:ready'> | null = null;
  let seq = 0;

  const post = (m: AppMessage) => {
    try {
      target()?.postMessage(m, origin);
    } catch {
      /* the frame is gone; the next load says hello again */
    }
  };
  const raise = (l: BridgeLevel) => {
    if (l <= level) return;
    level = l;
    for (const fn of levelFns) fn(l);
  };

  function listen(e: MessageEvent) {
    const w = target();
    if (e.origin !== origin || !w || e.source !== w) return;
    const m = parseSimMessage(e.data);
    if (!m) return;
    if (m.type === 'tnc:ready') {
      ready = m;
      raise(m.v);
    } else {
      raise(m.type === 'tnc:program' || m.type === 'tnc:changed' || m.type === 'tnc:selected' ? 1 : 2);
    }
    if (m.type === 'tnc:program' || m.type === 'tnc:tools') {
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        p.ok(m);
      }
    }
    for (const fn of handlers.get(m.type) ?? []) fn(m);
  }
  host.addEventListener('message', listen);

  function ask<T extends 'tnc:program' | 'tnc:tools'>(send: (id: string) => AppMessage, timeoutMs: number): Promise<Of<T>> {
    return new Promise((resolve, reject) => {
      const id = `b${++seq}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('the simulator did not answer'));
      }, timeoutMs);
      pending.set(id, { ok: (m) => resolve(m as Of<T>), timer });
      post(send(id));
    });
  }

  return {
    get level() {
      return level;
    },
    get ready() {
      return ready;
    },
    on(type, fn) {
      const set = handlers.get(type) ?? new Set<(m: SimMessage) => void>();
      handlers.set(type, set);
      const f = fn as (m: SimMessage) => void;
      set.add(f);
      return () => void set.delete(f);
    },
    onLevel(fn) {
      levelFns.add(fn);
      return () => void levelFns.delete(fn);
    },
    hello() {
      post({ type: 'tnc:hello', v: 2 });
      post({ type: 'tnc:get', id: 'hello' }); // a v1 simulator answers this one
    },
    open: (p) => post({ type: 'tnc:open', ...p }),
    current: (timeoutMs = 3000) => ask<'tnc:program'>((id) => ({ type: 'tnc:get', id }), timeoutMs).then((m) => ({ name: m.name, machine: m.machine, text: m.text })),
    present: (p) => post({ type: 'tnc:present', ...p }),
    machine: (machine) => post({ type: 'tnc:machine', machine }),
    exec: (cmd) => post({ type: 'tnc:exec', cmd }),
    camera: (view) => post({ type: 'tnc:camera', view }),
    lock: (locked, reason) => post(reason ? { type: 'tnc:lock', locked, reason } : { type: 'tnc:lock', locked }),
    tools: (timeoutMs = 3000) => ask<'tnc:tools'>((id) => ({ type: 'tnc:tools:get', id }), timeoutMs).then((m) => m.tools),
    setTools: (tools) => post({ type: 'tnc:tools:set', tools }),
    dispose() {
      host.removeEventListener('message', listen);
      for (const p of pending.values()) clearTimeout(p.timer);
      pending.clear();
      handlers.clear();
      levelFns.clear();
    },
  };
}
