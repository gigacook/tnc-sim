// Play game rules. Run: node --test tests/play/   (Node 24+ strips the TypeScript types itself; no build step)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEquipped,
  CuttingClock,
  drain,
  lockOf,
  matchRack,
  newGame,
  oilLevel,
  rackTool,
  step,
  type Effect,
  type Game,
  type GameEvent,
} from '../../web/src/play/game/machine.ts';
import { actionsFor, TARGET_IDS } from '../../web/src/play/game/actions.ts';
import { fromSave, loadPrefs, loadSave, parseSave, SAVE_KEY, storePrefs, storeSave, toSave, EDITION_KEY } from '../../web/src/play/game/save.ts';
import { newScheduler } from '../../web/src/play/game/scheduler.ts';

/** Run events in order; every one must be accepted. */
function run(g: Game, events: GameEvent[]): { game: Game; effects: Effect[] } {
  const effects: Effect[] = [];
  for (const e of events) {
    const r = step(g, e);
    assert.equal(r.refused, null, `${e.type} refused: ${r.refused}`);
    g = r.game;
    effects.push(...r.effects);
  }
  return { game: g, effects };
}
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test('oil fixture: 50 %, 2 points per minute, 120 s of cutting -> 46 %; paused wall time adds nothing; refill -> 100 %', () => {
  let g = newGame();
  g.stations.fil15.oil = 50;
  g = run(g, [{ type: 'ENTER_CONTROL', station: 'fil15' }]).game;
  const clock = new CuttingClock();
  let t = 0;
  const report = (running: boolean, cutting: boolean) => {
    g = step(g, { type: 'SIM', running, cutting }).game;
    g = step(g, { type: 'CUT', seconds: clock.feed({ running, cutting }, t) }).game;
  };
  report(true, true);
  for (let i = 0; i < 1200; i++) {
    t += 100; // the simulator reports 10 times a second
    report(true, true);
  }
  assert.ok(Math.abs(g.stations.fil15.oil - 46) < 1e-9, `after 120 s of cutting: ${g.stations.fil15.oil}`);

  report(false, false); // NC stop
  t += 10 * 60 * 1000; // ten minutes of wall time, paused
  report(false, false);
  t += 5 * 60 * 1000; // running but not cutting (a rapid move, a dwell)
  report(true, false);
  t += 100;
  report(true, false);
  assert.ok(Math.abs(g.stations.fil15.oil - 46) < 1e-9, `paused and non-cutting time must not drain: ${g.stations.fil15.oil}`);

  g = run(g, [{ type: 'SIM', running: false, cutting: false }, { type: 'EXIT_CONTROL' }, { type: 'PICK', item: 'oil' }, { type: 'REFILL', station: 'fil15' }]).game;
  assert.equal(g.stations.fil15.oil, 100);
  assert.equal(g.stations.dmc125.oil, 100, 'the other machine is untouched');
});

test('drain is the plain formula and never goes below zero', () => {
  assert.equal(drain(50, 120), 46);
  assert.equal(drain(50, 0), 50);
  assert.equal(drain(50, -5), 50);
  assert.equal(drain(1, 3600), 0);
  assert.equal(drain(50, 60, 6), 44);
});

test('the cutting clock caps a gap and ignores what nobody reported as cutting', () => {
  const c = new CuttingClock();
  assert.equal(c.feed({ running: true, cutting: true }, 0), 0, 'the first report has no past');
  assert.equal(c.feed({ running: true, cutting: true }, 100), 0.1);
  assert.equal(c.feed({ running: true, cutting: true }, 60_100), 1, 'a hidden tab: one capped second, not a minute');
  assert.equal(c.feed({ running: false, cutting: true }, 60_200), 0.1, 'the time up to the stop report was cutting');
  assert.equal(c.feed({ running: true, cutting: true }, 90_000), 0, 'stopped time is free');
  c.reset();
  assert.equal(c.feed({ running: true, cutting: true }, 95_000), 0);
});

test('oil levels: ok, low, empty; an empty tank locks NC start and stops a running machine', () => {
  assert.equal(oilLevel(100), 'ok');
  assert.equal(oilLevel(20.01), 'ok');
  assert.equal(oilLevel(20), 'low');
  assert.equal(oilLevel(0.5), 'low');
  assert.equal(oilLevel(0), 'empty');
  let g = newGame();
  g.stations.dmc125.oil = 0.01;
  g = run(g, [{ type: 'ENTER_CONTROL', station: 'dmc125' }, { type: 'SIM', running: true, cutting: true }]).game;
  const r = step(g, { type: 'CUT', seconds: 1 });
  assert.equal(r.game.stations.dmc125.oil, 0);
  assert.deepEqual(r.effects, [{ type: 'lock', locked: true, reason: 'oil' }, { type: 'stop' }]);
  assert.deepEqual(lockOf(r.game), { locked: true, reason: 'oil' });
});

test('the whole tool change: control -> open -> isolate -> loosen -> remove -> rack -> fit -> clamp -> control', () => {
  let g = newGame();
  let fx: Effect[];
  ({ game: g, effects: fx } = run(g, [{ type: 'ENTER_CONTROL', station: 'fil15' }]));
  assert.deepEqual(fx, [
    { type: 'machine', station: 'fil15' },
    { type: 'view', view: 'machine', station: 'fil15' },
    { type: 'lock', locked: false, reason: null },
  ]);
  assert.equal(g.active, 'fil15');
  ({ game: g, effects: fx } = run(g, [{ type: 'EXIT_CONTROL' }]));
  assert.deepEqual(fx, [{ type: 'view', view: 'workshop', station: 'fil15' }]);
  assert.equal(g.stations.fil15.phase, 'floor');

  ({ game: g, effects: fx } = run(g, [{ type: 'OPEN_DOOR', station: 'fil15' }]));
  assert.deepEqual(fx, [{ type: 'lock', locked: true, reason: 'door' }]);
  ({ game: g, effects: fx } = run(g, [{ type: 'ISOLATE', station: 'fil15' }]));
  assert.deepEqual(fx, [{ type: 'stop' }, { type: 'lock', locked: true, reason: 'isolated' }]);

  assert.equal(step(g, { type: 'LOOSEN', station: 'fil15' }).refused, 'needWrench');
  ({ game: g } = run(g, [{ type: 'PICK', item: 'wrench' }, { type: 'LOOSEN', station: 'fil15' }]));
  assert.equal(g.stations.fil15.phase, 'toolLoose');
  ({ game: g } = run(g, [{ type: 'REMOVE', station: 'fil15' }]));
  assert.equal(g.stations.fil15.equipped, null);
  assert.equal(g.carrying, 'em10', 'the removed tool is in the hand');
  assert.deepEqual(lockOf(g), { locked: true, reason: 'tool' });

  assert.equal(step(g, { type: 'RACK_TAKE', tool: 'em16' }).refused, 'inUse', 'em16 sits in the other spindle');
  assert.equal(step(g, { type: 'RACK_TAKE', tool: 'nope' }).refused, 'unknownTool');
  ({ game: g } = run(g, [{ type: 'RACK_TAKE', tool: 'face40' }]));
  assert.equal(g.carrying, 'face40', 'the old tool went back on the rack');

  ({ game: g } = run(g, [{ type: 'FIT', station: 'fil15' }]));
  assert.equal(g.stations.fil15.phase, 'toolSeated');
  assert.equal(g.carrying, null);
  ({ game: g, effects: fx } = run(g, [{ type: 'CLAMP', station: 'fil15' }]));
  assert.deepEqual(fx, [
    { type: 'tools', station: 'fil15', tool: rackTool('face40') },
    { type: 'lock', locked: true, reason: 'isolated' },
  ]);
  ({ game: g, effects: fx } = run(g, [
    { type: 'RESTORE', station: 'fil15' },
    { type: 'CLOSE_DOOR', station: 'fil15' },
    { type: 'ENTER_CONTROL', station: 'fil15' },
  ]));
  assert.deepEqual(fx.at(-1), { type: 'lock', locked: false, reason: null });
  assert.equal(fx.some((e) => e.type === 'machine'), false, 'same machine: no second machine select');
  assert.equal(g.stations.fil15.phase, 'control');
  assert.equal(g.stations.fil15.equipped, 'face40');
});

test('steps cannot be skipped', () => {
  const g = newGame();
  for (const e of [
    { type: 'ISOLATE', station: 'fil15' },
    { type: 'LOOSEN', station: 'fil15' },
    { type: 'REMOVE', station: 'fil15' },
    { type: 'FIT', station: 'fil15' },
    { type: 'CLAMP', station: 'fil15' },
    { type: 'RESTORE', station: 'fil15' },
    { type: 'CLOSE_DOOR', station: 'fil15' },
    { type: 'EXIT_CONTROL' },
    { type: 'POWER_ON', station: 'fil15' },
  ] satisfies GameEvent[]) {
    const r = step(g, e);
    assert.equal(r.refused, 'wrongPhase', e.type);
    assert.equal(r.game, g, 'a refused event changes nothing');
    assert.deepEqual(r.effects, []);
  }
  const open = run(g, [{ type: 'OPEN_DOOR', station: 'fil15' }]).game;
  assert.equal(step(open, { type: 'ENTER_CONTROL', station: 'fil15' }).refused, 'wrongPhase', 'no control with the door open');
  const loose = run(open, [{ type: 'ISOLATE', station: 'fil15' }, { type: 'PICK', item: 'wrench' }, { type: 'LOOSEN', station: 'fil15' }]).game;
  assert.equal(step(loose, { type: 'RESTORE', station: 'fil15' }).refused, 'wrongPhase', 'no restore with a loose tool');
  const empty = run(loose, [{ type: 'REMOVE', station: 'fil15' }, { type: 'RACK_PUT' }]).game;
  assert.equal(step(empty, { type: 'FIT', station: 'fil15' }).refused, 'handsEmpty');
});

test('door, tool and power are refused while the simulator reports running or cutting', () => {
  let g = run(newGame(), [{ type: 'ENTER_CONTROL', station: 'dmc125' }, { type: 'SIM', running: true, cutting: false }, { type: 'EXIT_CONTROL' }]).game;
  assert.equal(step(g, { type: 'OPEN_DOOR', station: 'dmc125' }).refused, 'running');
  assert.equal(step(g, { type: 'POWER_OFF', station: 'dmc125' }).refused, 'running');
  assert.equal(step(g, { type: 'ENTER_CONTROL', station: 'fil15' }).refused, 'otherRunning', 'one simulator: it is busy on dmc125');
  assert.equal(step(g, { type: 'OPEN_DOOR', station: 'fil15' }).refused, null, 'the idle machine is free');

  // cutting reported without running (a transition report): still busy
  g = step(g, { type: 'SIM', running: false, cutting: true }).game;
  assert.equal(step(g, { type: 'OPEN_DOOR', station: 'dmc125' }).refused, 'running');

  // a door opened while stopped, then the simulator starts anyway (v1 without tnc:lock): the tool stays put
  g = run(g, [{ type: 'SIM', running: false, cutting: false }, { type: 'OPEN_DOOR', station: 'dmc125' }, { type: 'ISOLATE', station: 'dmc125' }, { type: 'PICK', item: 'wrench' }]).game;
  g = step(g, { type: 'SIM', running: true, cutting: true }).game;
  assert.equal(step(g, { type: 'LOOSEN', station: 'dmc125' }).refused, 'running');
  g = step(g, { type: 'SIM', running: false, cutting: false }).game;
  assert.equal(step(g, { type: 'LOOSEN', station: 'dmc125' }).refused, null);
});

test('power off and on', () => {
  let g = newGame();
  let fx: Effect[];
  ({ game: g } = run(g, [{ type: 'ENTER_CONTROL', station: 'fil15' }]));
  assert.equal(step(g, { type: 'POWER_OFF', station: 'fil15' }).refused, 'wrongPhase', 'the switch is on the machine, not at the control');
  ({ game: g, effects: fx } = run(g, [{ type: 'EXIT_CONTROL' }, { type: 'POWER_OFF', station: 'fil15' }]));
  assert.deepEqual(fx.at(-1), { type: 'lock', locked: true, reason: 'power' });
  assert.equal(step(g, { type: 'POWER_OFF', station: 'fil15' }).refused, 'wrongPhase');
  ({ game: g, effects: fx } = run(g, [{ type: 'ENTER_CONTROL', station: 'fil15' }]));
  assert.deepEqual(fx.at(-1), { type: 'lock', locked: true, reason: 'power' }, 'a dead machine can be looked at but not started');
  ({ game: g, effects: fx } = run(g, [{ type: 'EXIT_CONTROL' }, { type: 'POWER_ON', station: 'fil15' }]));
  assert.deepEqual(fx.at(-1), { type: 'lock', locked: false, reason: null });
  // switching the machine the simulator is not bound to never locks the simulator
  ({ effects: fx } = run(g, [{ type: 'POWER_OFF', station: 'dmc125' }]));
  assert.deepEqual(fx, []);
});

test('the equipped tool goes into the tool table: slot replaced, other rows and columns kept', () => {
  const table = [
    { t: 1, name: 'OLD', l: 50, r: 5, dl: 0.1, doc: 'keep' },
    { t: 2, name: 'DRILL', l: 80, r: 4 },
  ];
  const next = applyEquipped(table, 1, rackTool('face40')!);
  assert.deepEqual(next, [
    { t: 1, name: 'PLANFRAES_D40', l: 45, r: 20, dl: 0.1, doc: 'keep' },
    { t: 2, name: 'DRILL', l: 80, r: 4 },
  ]);
  assert.equal(table[0].name, 'OLD', 'the input is not changed');
  assert.deepEqual(applyEquipped(table, 7, rackTool('em6')!).map((r) => r.t), [1, 2, 7]);
  assert.equal(matchRack({ l: 45, r: 20 })?.id, 'face40');
  assert.equal(matchRack({ l: 45, r: 19 }), null);
  assert.equal(matchRack(null), null);
});

test('hand tools: pick, swap, drop; refill needs the oil can', () => {
  let g = newGame();
  assert.equal(step(g, { type: 'DROP' }).refused, 'handsEmpty');
  assert.equal(step(g, { type: 'REFILL', station: 'fil15' }).refused, 'needOil');
  g = run(g, [{ type: 'PICK', item: 'wrench' }, { type: 'PICK', item: 'gauge' }]).game;
  assert.equal(g.held, 'gauge');
  g = run(g, [{ type: 'DROP' }]).game;
  assert.equal(g.held, null);
});

test('every target offers actions in every reachable state, and each offered game event is a known one', () => {
  const walk: GameEvent[] = [
    { type: 'OPEN_DOOR', station: 'fil15' },
    { type: 'ISOLATE', station: 'fil15' },
    { type: 'PICK', item: 'wrench' },
    { type: 'LOOSEN', station: 'fil15' },
    { type: 'REMOVE', station: 'fil15' },
    { type: 'RACK_TAKE', tool: 'em6' },
    { type: 'FIT', station: 'fil15' },
    { type: 'CLAMP', station: 'fil15' },
    { type: 'RESTORE', station: 'fil15' },
    { type: 'CLOSE_DOOR', station: 'fil15' },
    { type: 'ENTER_CONTROL', station: 'fil15' },
  ];
  let g = newGame();
  const expectFirst = ['openDoor', 'isolate', 'loosen', 'loosen', 'remove', 'fit', 'fit', 'clamp', 'restore', 'closeDoor', 'enterControl'];
  walk.forEach((e, i) => {
    for (const t of TARGET_IDS) assert.ok(actionsFor(t, g).length > 0, `${t} before ${e.type}`);
    const ids = actionsFor('fil15', g).map((a) => a.id);
    assert.ok(ids.includes(expectFirst[i]), `fil15 offers ${expectFirst[i]} before ${e.type}: ${ids}`);
    g = run(g, [e]).game;
  });
  assert.deepEqual(actionsFor('fil15', g).map((a) => a.id), ['exitControl']);
  // the list never offers a rack tool that is in the hand, and offers to put it back
  g = run(newGame(), [{ type: 'RACK_TAKE', tool: 'ball8' }]).game;
  const rack = actionsFor('rack', g);
  assert.equal(rack[0].id, 'rackPut');
  assert.equal(rack.some((a) => a.arg === 'ball8'), false);
  assert.deepEqual(rack.filter((a) => a.id === 'rackTake').map((a) => a.arg), ['em6', 'drill85', 'face40'], 'tools sitting in a spindle are not offered');
});

test('the save round-trips through tnc.play.save.v1 and rejects damage', () => {
  const store = memory();
  let g = run(newGame(), [{ type: 'PICK', item: 'oil' }, { type: 'POWER_OFF', station: 'dmc125' }]).game;
  g.stations.fil15.oil = 46;
  assert.equal(storeSave(store, toSave(g, ['norsk', '333'], { activeMs: 400_000, lastAtMs: 300_000, last: 'boss' })), true);
  assert.deepEqual(JSON.parse(store.m.get(SAVE_KEY)!).stations.fil15, { oil: 46, power: true, equipped: 'em10' });
  const s = loadSave(store)!;
  const back = fromSave(s);
  assert.equal(back.stations.fil15.oil, 46);
  assert.equal(back.stations.dmc125.power, false);
  assert.equal(back.held, 'oil');
  assert.deepEqual(s.secrets, ['norsk', '333']);
  assert.deepEqual(s.scheduler, { activeMs: 400_000, lastAtMs: 300_000, last: 'boss' });
  assert.equal(back.stations.fil15.phase, 'floor', 'phases are not saved: the player starts on the floor');

  // an empty spindle is kept: the machine comes back open, waiting for a tool, and locked
  const empty = run(newGame(), [
    { type: 'OPEN_DOOR', station: 'fil15' },
    { type: 'ISOLATE', station: 'fil15' },
    { type: 'PICK', item: 'wrench' },
    { type: 'LOOSEN', station: 'fil15' },
    { type: 'REMOVE', station: 'fil15' },
  ]).game;
  const e2 = fromSave(parseSave(JSON.parse(JSON.stringify(toSave(empty, [], newScheduler()))))!);
  assert.equal(e2.stations.fil15.phase, 'spindleEmpty');

  const good = toSave(newGame(), [], newScheduler());
  assert.ok(parseSave(good));
  assert.equal(parseSave(null), null);
  assert.equal(parseSave({ ...good, v: 2 }), null);
  assert.equal(parseSave({ ...good, stations: { ...good.stations, fil15: { oil: 'full', power: true, equipped: null } } }), null);
  assert.equal(parseSave({ ...good, stations: { ...good.stations, fil15: { oil: 50, power: true, equipped: 'laser' } } }), null);
  assert.equal(parseSave({ ...good, stations: { fil15: good.stations.fil15, dmc125: good.stations.fil15 } }), null, 'one tool cannot sit in two spindles');
  assert.equal(parseSave({ ...good, stations: { ...good.stations, fil15: { oil: 500, power: true, equipped: 'em10' } } })!.stations.fil15.oil, 100);
  assert.equal(parseSave({ ...good, held: 'hammer' })!.held, null);
  store.m.set(SAVE_KEY, '{not json');
  assert.equal(loadSave(store), null);
  assert.equal(loadSave(null), null);
});

test('edition preferences live in tnc.edition.play.v1 and fall back field by field', () => {
  const store = memory();
  assert.deepEqual(loadPrefs(store), { onboarded: false, captions: true, muted: false, npc: { boss: true, office: true } });
  storePrefs(store, { onboarded: true, captions: false, muted: true, npc: { boss: false, office: true } });
  assert.ok(store.m.has(EDITION_KEY));
  assert.deepEqual(loadPrefs(store), { onboarded: true, captions: false, muted: true, npc: { boss: false, office: true } });
  store.m.set(EDITION_KEY, JSON.stringify({ onboarded: 'yes', muted: true, npc: { boss: 0 } }));
  assert.deepEqual(loadPrefs(store), { onboarded: false, captions: true, muted: true, npc: { boss: true, office: true } });
});
