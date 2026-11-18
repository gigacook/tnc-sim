// What can be done at each thing in the workshop, given the game state. One list feeds both the 3-D
// interaction (E does the first enabled action) and the text station list, so the two can never differ.
import { RACK, STATION_IDS, type Game, type GameEvent, type Item, type StationId } from './machine.ts';

export type TargetId = StationId | 'big' | 'rack' | 'wrench' | 'oil' | 'gauge' | 'computer' | 'cabinet' | 'arm';
export const TARGET_IDS: readonly TargetId[] = ['fil15', 'dmc125', 'big', 'rack', 'wrench', 'oil', 'gauge', 'computer', 'cabinet', 'arm'];

/** Things the shell does that are not game transitions. */
export type Intent =
  | { type: 'UI'; what: 'computer' | 'inspect-big' | 'inspect-arm' | 'norsk' }
  | { type: 'MEASURE'; station: StationId };

export interface Action {
  /** stable id, also the key of the label text */
  id: string;
  /** extra text for the label (a tool name) */
  arg?: string;
  do: GameEvent | Intent;
}

const isStation = (t: TargetId): t is StationId => (STATION_IDS as readonly string[]).includes(t);
const ITEM_TARGETS: readonly Item[] = ['wrench', 'oil', 'gauge'];

export function actionsFor(target: TargetId, g: Game): Action[] {
  if (isStation(target)) {
    const s = g.stations[target];
    const a: Action[] = [];
    const power: Action = s.power ? { id: 'powerOff', do: { type: 'POWER_OFF', station: target } } : { id: 'powerOn', do: { type: 'POWER_ON', station: target } };
    switch (s.phase) {
      case 'control':
        return [{ id: 'exitControl', do: { type: 'EXIT_CONTROL' } }];
      case 'floor':
        a.push({ id: 'enterControl', do: { type: 'ENTER_CONTROL', station: target } }, { id: 'openDoor', do: { type: 'OPEN_DOOR', station: target } }, power);
        break;
      case 'doorOpen':
        a.push({ id: 'isolate', do: { type: 'ISOLATE', station: target } }, { id: 'closeDoor', do: { type: 'CLOSE_DOOR', station: target } }, power);
        break;
      case 'isolated':
        a.push({ id: 'loosen', do: { type: 'LOOSEN', station: target } }, { id: 'restore', do: { type: 'RESTORE', station: target } }, power);
        break;
      case 'toolLoose':
        a.push({ id: 'remove', do: { type: 'REMOVE', station: target } });
        break;
      case 'spindleEmpty':
        a.push({ id: 'fit', do: { type: 'FIT', station: target } }, power);
        break;
      case 'toolSeated':
        a.push({ id: 'clamp', do: { type: 'CLAMP', station: target } });
        break;
    }
    if (g.held === 'oil') a.unshift({ id: 'refill', do: { type: 'REFILL', station: target } });
    if (g.held === 'gauge' && s.phase === 'floor') a.unshift({ id: 'measure', do: { type: 'MEASURE', station: target } });
    return a;
  }
  if (target === 'rack') {
    const a: Action[] = [];
    if (g.carrying) a.push({ id: 'rackPut', do: { type: 'RACK_PUT' } });
    // only what hangs on the rack: not the one in the hand, not the ones sitting in a spindle
    for (const t of RACK) if (t.id !== g.carrying && !STATION_IDS.some((k) => g.stations[k].equipped === t.id)) a.push({ id: 'rackTake', arg: t.id, do: { type: 'RACK_TAKE', tool: t.id } });
    return a;
  }
  if ((ITEM_TARGETS as readonly string[]).includes(target)) {
    const item = target as Item;
    return g.held === item ? [{ id: 'drop', do: { type: 'DROP' } }] : [{ id: 'pick', arg: item, do: { type: 'PICK', item } }];
  }
  if (target === 'computer') return [{ id: 'computer', do: { type: 'UI', what: 'computer' } }];
  if (target === 'cabinet') return [{ id: 'norsk', do: { type: 'UI', what: 'norsk' } }];
  if (target === 'arm') return [{ id: 'inspectArm', do: { type: 'UI', what: 'inspect-arm' } }];
  return [{ id: 'inspectBig', do: { type: 'UI', what: 'inspect-big' } }];
}
