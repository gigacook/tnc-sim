// The Play game as one explicit state machine. Plain TypeScript: no React, no Three, no DOM.
// `step(game, event)` returns the next game, the effects the shell must carry out (bridge messages)
// and, when the event is not allowed in this state, why. Nothing here touches the CNC interpreter:
// the only thing that reaches the simulator from an interlock is `tnc:lock`.

import type { MachineId } from '../../lib/bridge.ts';

export type StationId = 'fil15' | 'dmc125';
export const STATION_IDS: readonly StationId[] = ['fil15', 'dmc125'];
/** Fictional shop machines and the controller each one carries. */
export const STATION_MACHINE: Record<StationId, MachineId> = { fil15: '426', dmc125: '430' };

/**
 * Where a station is in the tool-change walk:
 *   control -> floor -> doorOpen -> isolated -> toolLoose -> spindleEmpty -> toolSeated -> isolated -> doorOpen -> floor -> control
 */
export type Phase = 'control' | 'floor' | 'doorOpen' | 'isolated' | 'toolLoose' | 'spindleEmpty' | 'toolSeated';
export type Item = 'wrench' | 'oil' | 'gauge';
export const ITEMS: readonly Item[] = ['wrench', 'oil', 'gauge'];

export interface RackTool {
  id: string;
  name: string;
  /** length and radius in mm, the tool-table columns L and R */
  l: number;
  r: number;
}

/** The shop's tool rack. Game values for a fictional shop, not a catalogue. */
export const RACK: readonly RackTool[] = [
  { id: 'em6', name: 'FRAES_D6', l: 50, r: 3 },
  { id: 'em10', name: 'FRAES_D10', l: 60, r: 5 },
  { id: 'em16', name: 'FRAES_D16', l: 75, r: 8 },
  { id: 'ball8', name: 'KULFRAES_D8', l: 60, r: 4 },
  { id: 'drill85', name: 'BORR_D8_5', l: 90, r: 4.25 },
  { id: 'face40', name: 'PLANFRAES_D40', l: 45, r: 20 },
];
export const rackTool = (id: string | null): RackTool | null => RACK.find((t) => t.id === id) ?? null;

export interface Station {
  phase: Phase;
  power: boolean;
  /** service oil, 0..100 % */
  oil: number;
  /** rack tool id clamped (or seated) in the spindle */
  equipped: string | null;
}

export interface Game {
  stations: Record<StationId, Station>;
  /** the station the one simulator is bound to (its machine is selected there) */
  active: StationId | null;
  /** what the simulator last reported */
  sim: { running: boolean; cutting: boolean };
  /** the hand tool being carried */
  held: Item | null;
  /** a rack tool being carried between rack and spindle */
  carrying: string | null;
}

const OIL_RATE_PP_PER_MIN = 2;
const OIL_LOW = 20;

export function newGame(): Game {
  return {
    stations: {
      fil15: { phase: 'floor', power: true, oil: 100, equipped: 'em10' },
      dmc125: { phase: 'floor', power: true, oil: 100, equipped: 'em16' },
    },
    active: null,
    sim: { running: false, cutting: false },
    held: null,
    carrying: null,
  };
}

export type GameEvent =
  | { type: 'ENTER_CONTROL'; station: StationId }
  | { type: 'EXIT_CONTROL' }
  | { type: 'OPEN_DOOR'; station: StationId }
  | { type: 'CLOSE_DOOR'; station: StationId }
  | { type: 'ISOLATE'; station: StationId }
  | { type: 'RESTORE'; station: StationId }
  | { type: 'LOOSEN'; station: StationId }
  | { type: 'REMOVE'; station: StationId }
  | { type: 'FIT'; station: StationId }
  | { type: 'CLAMP'; station: StationId }
  | { type: 'POWER_OFF'; station: StationId }
  | { type: 'POWER_ON'; station: StationId }
  | { type: 'REFILL'; station: StationId }
  | { type: 'RACK_TAKE'; tool: string }
  | { type: 'RACK_PUT' }
  | { type: 'PICK'; item: Item }
  | { type: 'DROP' }
  /** the simulator's own report (tnc:state) */
  | { type: 'SIM'; running: boolean; cutting: boolean }
  /** simulated cutting time that passed on the active station, in seconds */
  | { type: 'CUT'; seconds: number };

/** Why an event was refused; the shell shows the matching sentence. */
export type Refusal =
  | 'running' // the simulator is running or cutting
  | 'otherRunning' // the simulator is busy on the other machine
  | 'wrongPhase'
  | 'needWrench'
  | 'needOil'
  | 'handsFull'
  | 'handsEmpty'
  | 'inUse' // that rack tool sits in a spindle
  | 'unknownTool';

export type LockReason = 'power' | 'oil' | 'door' | 'isolated' | 'tool';

/** What the shell does after a step. Only `lock` is an interlock; the rest use the simulator's own contracts. */
export type Effect =
  | { type: 'lock'; locked: boolean; reason: LockReason | null }
  | { type: 'stop' } // tnc:exec stop
  | { type: 'machine'; station: StationId } // tnc:machine + tnc:present skin
  | { type: 'tools'; station: StationId; tool: RackTool } // tnc:tools:get -> tnc:tools:set
  | { type: 'view'; view: 'machine' | 'workshop'; station: StationId };

export interface StepResult {
  game: Game;
  effects: Effect[];
  refused: Refusal | null;
}

/** Is NC start to be refused for the station the simulator is bound to, and why. */
export function lockOf(g: Game): { locked: boolean; reason: LockReason | null } {
  const s = g.active ? g.stations[g.active] : null;
  if (!s) return { locked: false, reason: null };
  if (!s.power) return { locked: true, reason: 'power' };
  if (s.phase === 'doorOpen') return { locked: true, reason: 'door' };
  if (s.phase === 'toolLoose' || s.phase === 'spindleEmpty' || s.phase === 'toolSeated') return { locked: true, reason: 'tool' };
  if (s.phase === 'isolated') return { locked: true, reason: 'isolated' };
  if (s.oil <= 0) return { locked: true, reason: 'oil' };
  return { locked: false, reason: null };
}

export const oilLevel = (oil: number): 'ok' | 'low' | 'empty' => (oil <= 0 ? 'empty' : oil <= OIL_LOW ? 'low' : 'ok');

/** Oil after `seconds` of simulated cutting. Wall time that is not cutting time never reaches this function. */
export function drain(oil: number, seconds: number, ratePerMin = OIL_RATE_PP_PER_MIN): number {
  if (!(seconds > 0)) return oil;
  return Math.max(0, oil - (ratePerMin * seconds) / 60);
}

/** The simulator is busy on this station: no door, no tool, no power switch. */
const busyOn = (g: Game, id: StationId) => g.active === id && (g.sim.running || g.sim.cutting);

export function step(g: Game, e: GameEvent): StepResult {
  const before = lockOf(g);
  const effects: Effect[] = [];
  const refuse = (refused: Refusal): StepResult => ({ game: g, effects: [], refused });
  const same: StepResult = { game: g, effects: [], refused: null };
  const withStation = (id: StationId, patch: Partial<Station>, rest: Partial<Game> = {}): Game => ({
    ...g,
    ...rest,
    stations: { ...g.stations, [id]: { ...g.stations[id], ...patch } },
  });
  let next: Game = g;

  switch (e.type) {
    case 'ENTER_CONTROL': {
      const s = g.stations[e.station];
      if (s.phase !== 'floor') return refuse('wrongPhase');
      if (STATION_IDS.some((k) => g.stations[k].phase === 'control')) return refuse('wrongPhase');
      if (g.active && g.active !== e.station && (g.sim.running || g.sim.cutting)) return refuse('otherRunning');
      next = withStation(e.station, { phase: 'control' }, { active: e.station });
      if (g.active !== e.station) effects.push({ type: 'machine', station: e.station });
      effects.push({ type: 'view', view: 'machine', station: e.station });
      break;
    }
    case 'EXIT_CONTROL': {
      const id = STATION_IDS.find((k) => g.stations[k].phase === 'control');
      if (!id) return refuse('wrongPhase');
      next = withStation(id, { phase: 'floor' });
      effects.push({ type: 'view', view: 'workshop', station: id });
      break;
    }
    case 'OPEN_DOOR': {
      if (g.stations[e.station].phase !== 'floor') return refuse('wrongPhase');
      if (busyOn(g, e.station)) return refuse('running');
      next = withStation(e.station, { phase: 'doorOpen' });
      break;
    }
    case 'CLOSE_DOOR': {
      if (g.stations[e.station].phase !== 'doorOpen') return refuse('wrongPhase');
      next = withStation(e.station, { phase: 'floor' });
      break;
    }
    case 'ISOLATE': {
      if (g.stations[e.station].phase !== 'doorOpen') return refuse('wrongPhase');
      next = withStation(e.station, { phase: g.stations[e.station].equipped ? 'isolated' : 'spindleEmpty' });
      if (g.active === e.station) effects.push({ type: 'stop' });
      break;
    }
    case 'RESTORE': {
      if (g.stations[e.station].phase !== 'isolated') return refuse('wrongPhase');
      next = withStation(e.station, { phase: 'doorOpen' });
      break;
    }
    case 'LOOSEN': {
      if (g.stations[e.station].phase !== 'isolated') return refuse('wrongPhase');
      if (busyOn(g, e.station)) return refuse('running');
      if (g.held !== 'wrench') return refuse('needWrench');
      next = withStation(e.station, { phase: 'toolLoose' });
      break;
    }
    case 'REMOVE': {
      const s = g.stations[e.station];
      if (s.phase !== 'toolLoose') return refuse('wrongPhase');
      if (g.carrying) return refuse('handsFull');
      next = withStation(e.station, { phase: 'spindleEmpty', equipped: null }, { carrying: s.equipped });
      break;
    }
    case 'FIT': {
      if (g.stations[e.station].phase !== 'spindleEmpty') return refuse('wrongPhase');
      if (!g.carrying) return refuse('handsEmpty');
      next = withStation(e.station, { phase: 'toolSeated', equipped: g.carrying }, { carrying: null });
      break;
    }
    case 'CLAMP': {
      const s = g.stations[e.station];
      if (s.phase !== 'toolSeated') return refuse('wrongPhase');
      if (g.held !== 'wrench') return refuse('needWrench');
      const tool = rackTool(s.equipped);
      if (!tool) return refuse('unknownTool');
      next = withStation(e.station, { phase: 'isolated' });
      effects.push({ type: 'tools', station: e.station, tool });
      break;
    }
    case 'POWER_OFF': {
      const s = g.stations[e.station];
      if (!s.power || s.phase === 'control') return refuse('wrongPhase');
      if (busyOn(g, e.station)) return refuse('running');
      next = withStation(e.station, { power: false });
      break;
    }
    case 'POWER_ON': {
      const s = g.stations[e.station];
      if (s.power || s.phase === 'control') return refuse('wrongPhase');
      next = withStation(e.station, { power: true });
      break;
    }
    case 'REFILL': {
      if (g.stations[e.station].phase === 'control') return refuse('wrongPhase');
      if (g.held !== 'oil') return refuse('needOil');
      next = withStation(e.station, { oil: 100 });
      break;
    }
    case 'RACK_TAKE': {
      if (!rackTool(e.tool)) return refuse('unknownTool');
      if (STATION_IDS.some((k) => g.stations[k].equipped === e.tool)) return refuse('inUse');
      // taking another one puts the one in the hand back: "choose another from the rack"
      next = { ...g, carrying: e.tool };
      break;
    }
    case 'RACK_PUT': {
      if (!g.carrying) return refuse('handsEmpty');
      next = { ...g, carrying: null };
      break;
    }
    case 'PICK': {
      next = { ...g, held: e.item };
      break;
    }
    case 'DROP': {
      if (!g.held) return refuse('handsEmpty');
      next = { ...g, held: null };
      break;
    }
    case 'SIM': {
      if (g.sim.running === e.running && g.sim.cutting === e.cutting) return same;
      next = { ...g, sim: { running: e.running, cutting: e.cutting } };
      break;
    }
    case 'CUT': {
      if (!g.active || !(e.seconds > 0)) return same;
      next = withStation(g.active, { oil: drain(g.stations[g.active].oil, e.seconds) });
      break;
    }
  }

  const after = lockOf(next);
  // entering a control always restates the lock: the simulator was just pointed at another machine
  if (after.locked !== before.locked || after.reason !== before.reason || e.type === 'ENTER_CONTROL') effects.push({ type: 'lock', ...after });
  // an empty oil tank stops a running machine: a game penalty, sent through the simulator's own stop
  if (e.type === 'CUT' && after.reason === 'oil' && before.reason !== 'oil' && next.sim.running) effects.push({ type: 'stop' });
  return { game: next, effects, refused: null };
}

/**
 * Turns the stream of simulator reports into simulated cutting seconds. A report says what is true from
 * that moment on, so the time between two reports counts only when the earlier one said running and cutting.
 * Reports come at most 10 times a second and at once on a transition; a longer gap (a hidden tab, a stalled
 * frame) is capped so wall time that nobody reported as cutting adds nothing.
 */
export class CuttingClock {
  private last: { t: number; on: boolean } | null = null;
  private readonly capMs: number;
  constructor(capMs = 1000) {
    this.capMs = capMs;
  }
  /** @returns seconds of cutting to charge for this report */
  feed(s: { running: boolean; cutting: boolean }, tMs: number): number {
    const prev = this.last;
    this.last = { t: tMs, on: s.running && s.cutting };
    if (!prev || !prev.on) return 0;
    return Math.min(Math.max(0, tMs - prev.t), this.capMs) / 1000;
  }
  reset(): void {
    this.last = null;
  }
}

/** The tool table with the rack tool written into slot `t` (name, L, R); every other column and row is kept. */
export function applyEquipped<T extends { t: number; l: number; r: number; name?: string }>(table: readonly T[], t: number, tool: RackTool): T[] {
  const row = { t, name: tool.name, l: tool.l, r: tool.r };
  if (table.some((x) => x.t === t)) return table.map((x) => (x.t === t ? { ...x, ...row } : x));
  return [...table, row as T].sort((a, b) => a.t - b.t);
}

/** The rack tool that matches a tool-table row (same L and R), if any. */
export function matchRack(row: { l: number; r: number } | null | undefined): RackTool | null {
  if (!row) return null;
  return RACK.find((x) => Math.abs(x.l - row.l) < 1e-6 && Math.abs(x.r - row.r) < 1e-6) ?? null;
}
