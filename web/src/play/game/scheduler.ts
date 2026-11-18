// Bounded scheduling of character interruptions. Plain TypeScript, unit-tested in tests/play/.
// Rule: at most one interruption per five ACTIVE minutes (time the player is actually in the workshop with the
// tab visible), never during setup, modal editing or error recovery, never a character the player switched off.

export type Npc = 'boss' | 'office';
export const NPCS: readonly Npc[] = ['boss', 'office'];

export interface SchedulerState {
  /** active play time so far, ms */
  activeMs: number;
  /** activeMs when the last interruption fired (or play began) */
  lastAtMs: number;
  /** who came last, so the two take turns */
  last: Npc | null;
}

export interface SchedulerContext {
  /** the player is playing: tab visible, in the workshop or at a machine */
  active: boolean;
  /** onboarding or first-run setup is open */
  setup: boolean;
  /** a dialog, the workshop computer or an editor has the player's attention */
  modal: boolean;
  /** the simulator shows an error or an alarm the player is dealing with */
  recovering: boolean;
  /** an interruption is on screen right now */
  showing: boolean;
  enabled: Record<Npc, boolean>;
}

export const MIN_GAP_MS = 5 * 60 * 1000;
/** one frame of a stalled or throttled tab never counts for more than this */
export const MAX_TICK_MS = 1000;

export const newScheduler = (): SchedulerState => ({ activeMs: 0, lastAtMs: 0, last: null });

export function tick(s: SchedulerState, dtMs: number, c: SchedulerContext, minGapMs = MIN_GAP_MS): { state: SchedulerState; fire: Npc | null } {
  if (!c.active || !(dtMs > 0)) return { state: s, fire: null };
  const state = { ...s, activeMs: s.activeMs + Math.min(dtMs, MAX_TICK_MS) };
  if (c.setup || c.modal || c.recovering || c.showing) return { state, fire: null };
  if (state.activeMs - state.lastAtMs < minGapMs) return { state, fire: null };
  const on = NPCS.filter((n) => c.enabled[n]);
  if (!on.length) return { state, fire: null };
  const fire = on.find((n) => n !== s.last) ?? on[0];
  return { state: { ...state, lastAtMs: state.activeMs, last: fire }, fire };
}
