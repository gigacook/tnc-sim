// The Play save: `tnc.play.save.v1` in localStorage. Read back through a validator, so a hand-edited or
// damaged save can never put the game in a state the state machine does not know. Business never reads it.
import { isObj, num } from '../../lib/bridge.ts';
import type { KV } from '../../lib/settings.ts';
import { ITEMS, newGame, rackTool, STATION_IDS, type Game, type Item, type StationId } from './machine.ts';
import { newScheduler, type Npc, type SchedulerState } from './scheduler.ts';

export const SAVE_KEY = 'tnc.play.save.v1';
export const EDITION_KEY = 'tnc.edition.play.v1';

export interface Prefs {
  onboarded: boolean;
  captions: boolean;
  muted: boolean;
  npc: Record<Npc, boolean>;
}

export interface Save {
  v: 1;
  stations: Record<StationId, { oil: number; power: boolean; equipped: string | null }>;
  held: Item | null;
  secrets: string[];
  scheduler: SchedulerState;
}

const DEFAULT_PREFS: Prefs = { onboarded: false, captions: true, muted: false, npc: { boss: true, office: true } };

export function toSave(g: Game, secrets: readonly string[], scheduler: SchedulerState): Save {
  const stations = {} as Save['stations'];
  for (const id of STATION_IDS) {
    const s = g.stations[id];
    stations[id] = { oil: s.oil, power: s.power, equipped: s.equipped };
  }
  return { v: 1, stations, held: g.held, secrets: [...secrets], scheduler };
}

/** A whole, valid save or null. Unknown fields are ignored, numbers are clamped. */
export function parseSave(raw: unknown): Save | null {
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.stations)) return null;
  const stations = {} as Save['stations'];
  for (const id of STATION_IDS) {
    const s = raw.stations[id];
    if (!isObj(s) || !num(s.oil) || typeof s.power !== 'boolean') return null;
    if (s.equipped !== null && !(typeof s.equipped === 'string' && rackTool(s.equipped))) return null;
    stations[id] = { oil: Math.min(100, Math.max(0, s.oil)), power: s.power, equipped: s.equipped as string | null };
  }
  if (stations.fil15.equipped && stations.fil15.equipped === stations.dmc125.equipped) return null;
  const held = ITEMS.includes(raw.held as Item) ? (raw.held as Item) : null;
  const secrets = Array.isArray(raw.secrets) ? raw.secrets.filter((x): x is string => typeof x === 'string' && x.length <= 32).slice(0, 64) : [];
  let scheduler = newScheduler();
  const sc = raw.scheduler;
  if (isObj(sc) && num(sc.activeMs) && num(sc.lastAtMs) && sc.activeMs >= 0 && sc.lastAtMs >= 0 && sc.lastAtMs <= sc.activeMs) {
    scheduler = { activeMs: sc.activeMs, lastAtMs: sc.lastAtMs, last: sc.last === 'boss' || sc.last === 'office' ? sc.last : null };
  }
  return { v: 1, stations, held, secrets, scheduler };
}

/** The game a save describes. A spindle saved empty comes back open and isolated, waiting for a tool. */
export function fromSave(s: Save): Game {
  const g = newGame();
  for (const id of STATION_IDS) {
    const st = s.stations[id];
    g.stations[id] = { phase: st.equipped ? 'floor' : 'spindleEmpty', power: st.power, oil: st.oil, equipped: st.equipped };
  }
  g.held = s.held;
  return g;
}

function parsePrefs(raw: unknown): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS, npc: { ...DEFAULT_PREFS.npc } };
  if (!isObj(raw)) return p;
  if (typeof raw.onboarded === 'boolean') p.onboarded = raw.onboarded;
  if (typeof raw.captions === 'boolean') p.captions = raw.captions;
  if (typeof raw.muted === 'boolean') p.muted = raw.muted;
  if (isObj(raw.npc)) {
    if (typeof raw.npc.boss === 'boolean') p.npc.boss = raw.npc.boss;
    if (typeof raw.npc.office === 'boolean') p.npc.office = raw.npc.office;
  }
  return p;
}

function readJson(store: KV | null, key: string): unknown {
  try {
    return JSON.parse(store?.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function writeJson(store: KV | null, key: string, v: unknown): boolean {
  try {
    store?.setItem(key, JSON.stringify(v));
    return !!store;
  } catch {
    return false;
  }
}
export const loadSave = (store: KV | null): Save | null => parseSave(readJson(store, SAVE_KEY));
export const storeSave = (store: KV | null, s: Save): boolean => writeJson(store, SAVE_KEY, s);
export const loadPrefs = (store: KV | null): Prefs => parsePrefs(readJson(store, EDITION_KEY));
export const storePrefs = (store: KV | null, p: Prefs): boolean => writeJson(store, EDITION_KEY, p);
