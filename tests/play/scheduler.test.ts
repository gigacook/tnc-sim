// Interruption scheduler, content-pack validator, bridge validator and shared settings. Run: node --test tests/play/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_GAP_MS, newScheduler, tick, type Npc, type SchedulerContext } from '../../web/src/play/game/scheduler.ts';
import { loadPack, packText, validatePack } from '../../web/src/play/pack/loader.ts';
import { createBridge, parseSimMessage } from '../../web/src/lib/bridge.ts';
import { readSettings, SETTINGS_KEY, simFellBack, writeSettings } from '../../web/src/lib/settings.ts';

const free: SchedulerContext = { active: true, setup: false, modal: false, recovering: false, showing: false, enabled: { boss: true, office: true } };

/** Simulate `minutes` of play in 1 s ticks; returns the active-time stamps (ms) at which someone came. */
function play(minutes: number, ctx: (activeMs: number) => SchedulerContext, s = newScheduler()) {
  const fired: { at: number; who: Npc }[] = [];
  for (let i = 0; i < minutes * 60; i++) {
    const r = tick(s, 1000, ctx(s.activeMs));
    s = r.state;
    if (r.fire) fired.push({ at: s.activeMs, who: r.fire });
  }
  return { fired, state: s };
}

test('at most one interruption per five active minutes, and the two take turns', () => {
  const { fired } = play(31, () => free);
  assert.deepEqual(fired.map((f) => f.at), [5, 10, 15, 20, 25, 30].map((m) => m * 60_000));
  assert.deepEqual(fired.map((f) => f.who), ['boss', 'office', 'boss', 'office', 'boss', 'office']);
  for (let i = 1; i < fired.length; i++) assert.ok(fired[i].at - fired[i - 1].at >= MIN_GAP_MS);
});

test('never during setup, modal editing, error recovery or while one is showing; it comes when the player is free again', () => {
  for (const key of ['setup', 'modal', 'recovering', 'showing'] as const) {
    const busyUntil = 9 * 60_000;
    const { fired } = play(12, (ms) => ({ ...free, [key]: ms < busyUntil }));
    assert.equal(fired.length, 1, key);
    assert.ok(fired[0].at > busyUntil, `${key}: fired at ${fired[0].at}`);
  }
  assert.equal(play(60, () => ({ ...free, modal: true })).fired.length, 0);
});

test('inactive time does not count, and a stalled tab counts one second per tick at most', () => {
  const idle = play(60, () => ({ ...free, active: false }));
  assert.equal(idle.fired.length, 0);
  assert.equal(idle.state.activeMs, 0);
  const r = tick(newScheduler(), 60 * 60 * 1000, free); // one frame after an hour asleep
  assert.equal(r.state.activeMs, 1000);
  assert.equal(r.fire, null);
  assert.equal(tick(newScheduler(), -5, free).state.activeMs, 0);
});

test('characters can be switched off one by one', () => {
  assert.deepEqual(new Set(play(21, () => ({ ...free, enabled: { boss: false, office: true } })).fired.map((f) => f.who)), new Set(['office']));
  assert.deepEqual(new Set(play(21, () => ({ ...free, enabled: { boss: true, office: false } })).fired.map((f) => f.who)), new Set(['boss']));
  const none = play(21, () => ({ ...free, enabled: { boss: false, office: false } }));
  assert.equal(none.fired.length, 0);
  // switching one back on after a long quiet spell brings one visit, not a backlog
  const after = play(10, () => free, none.state);
  assert.deepEqual(after.fired.map((f) => f.at - none.state.activeMs), [1000, 1000 + MIN_GAP_MS]);
});

const figure = { name: 'Operator A', height: 1.78, build: 1, skin: '#c99a7a', hair: '#8a8a8a', hairStyle: 'short', beard: false, glasses: true, top: '#2f4a66', bottom: '#2b2f36' };
const pack = {
  v: 1,
  id: 'example-greeting',
  completion: { figures: [figure, { ...figure, name: 'Operator B', beard: true }], lines: [{ who: 0, sv: 'Hej!', en: 'Hello!' }, { who: 1, sv: 'Tack.', en: 'Thanks.' }], gesture: 'highfive' },
};

test('a valid content pack is rebuilt, unknown fields are dropped', () => {
  const r = validatePack({ ...pack, script: 'alert(1)', completion: { ...pack.completion, onload: 'x', figures: [{ ...figure, model: 'http://x/y.glb' }, pack.completion.figures[1]] } });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.pack), ['v', 'id', 'completion']);
  assert.deepEqual(Object.keys(r.pack.completion!), ['figures', 'lines', 'gesture']);
  assert.equal('model' in r.pack.completion!.figures[0], false);
  assert.equal(r.pack.completion!.figures[1].name, 'Operator B');
  assert.deepEqual(validatePack({ v: 1, id: 'empty' }), { ok: true, pack: { v: 1, id: 'empty' } });
});

test('a content pack with anything out of range is rejected with the reason', () => {
  const bad = (patch: (p: any) => void) => {
    const p = structuredClone(pack);
    patch(p);
    const r = validatePack(p);
    assert.equal(r.ok, false);
    return r.ok ? [] : r.errors;
  };
  assert.match(bad((p) => (p.v = 2))[0], /^v/);
  assert.match(bad((p) => (p.id = 'Has Space'))[0], /^id/);
  assert.match(bad((p) => (p.completion.figures[0].skin = 'red'))[0], /skin/);
  assert.match(bad((p) => (p.completion.figures[0].skin = 'url(x)'))[0], /skin/);
  assert.match(bad((p) => (p.completion.figures[1].height = 9))[0], /height/);
  assert.match(bad((p) => (p.completion.figures.length = 1))[0], /two figures/);
  assert.match(bad((p) => (p.completion.lines[0].sv = '<img src=x onerror=alert(1)>'))[0], /lines\[0\]\.sv/);
  assert.match(bad((p) => (p.completion.lines[0].en = 'x'.repeat(121)))[0], /lines\[0\]\.en/);
  assert.match(bad((p) => (p.completion.lines[1].sr = '<b>Hvala</b>'))[0], /lines\[1\]\.sr/);
  assert.match(bad((p) => (p.completion.lines[1].sr = ''))[0], /lines\[1\]\.sr/);
  assert.match(bad((p) => (p.completion.lines[1].sr = 7))[0], /lines\[1\]\.sr/);
  assert.match(bad((p) => (p.completion.lines = []))[0], /1 to 6/);
  assert.match(bad((p) => (p.completion.gesture = 'explode'))[0], /gesture/);
  assert.equal(validatePack('x').ok, false);
  assert.equal(validatePack([]).ok, false);
});

test('a content pack may carry Serbian text beside Swedish and English; without it a Serbian reader gets the English', () => {
  const withSr = structuredClone(pack) as typeof pack & { completion: { lines: { sr?: string }[] } };
  withSr.completion.lines[0].sr = 'Zdravo! Lepo odrađeno.';
  const r = validatePack(withSr);
  assert.ok(r.ok);
  if (!r.ok) return;
  const [first, second] = r.pack.completion!.lines;
  assert.deepEqual(first, { who: 0, sv: 'Hej!', en: 'Hello!', sr: 'Zdravo! Lepo odrađeno.' });
  assert.equal('sr' in second, false, 'a line without sr stays without it');
  assert.deepEqual(['sv', 'en', 'sr'].map((l) => packText(first, l as 'sv')), ['Hej!', 'Hello!', 'Zdravo! Lepo odrađeno.']);
  assert.deepEqual(['sv', 'en', 'sr'].map((l) => packText(second, l as 'sv')), ['Tack.', 'Thanks.', 'Thanks.']);
});

test('loadPack: missing, wrong type, invalid and oversized packs all give null; a good one loads', async () => {
  const res = (body: string, type = 'application/json', ok = true) => (async () => ({ ok, headers: { get: () => type }, text: async () => body })) as unknown as typeof fetch;
  assert.deepEqual((await loadPack(res(JSON.stringify(pack))))?.id, 'example-greeting');
  assert.equal(await loadPack(res('', 'text/html', false)), null);
  assert.equal(await loadPack(res('<!doctype html>', 'text/html')), null, 'a static host answering 200 with its index page');
  assert.equal(await loadPack(res('{not json')), null);
  assert.equal(await loadPack(res(JSON.stringify({ ...pack, v: 3 }))), null);
  assert.equal(await loadPack(res(' '.repeat(70_000) + JSON.stringify(pack))), null);
  assert.equal(await loadPack((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch), null);
});

const state = { type: 'tnc:state', running: true, cutting: false, mode: 'run', machine: '430', tool: { t: 1, r: 5, l: 60 }, pos: { x: 1, y: 2, z: 3, a: 0, b: 0 }, spindle: { on: true, rpm: 3000 }, coolant: true, progress: 0.5, errors: 0, done: false };

test('bridge: valid messages are rebuilt, malformed and unknown ones are dropped', () => {
  assert.deepEqual(parseSimMessage({ type: 'tnc:ready' }), { type: 'tnc:ready', v: 1 });
  assert.deepEqual(parseSimMessage({ type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'sv', extra: 1 }), { type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'sv' });
  assert.equal(parseSimMessage({ type: 'tnc:ready', v: 3 }), null);
  assert.deepEqual(parseSimMessage({ ...state, evil: '<x>' }), state);
  assert.deepEqual(parseSimMessage({ ...state, tool: null, pos: null }), { ...state, tool: null, pos: null });
  assert.equal(parseSimMessage({ ...state, running: 'yes' }), null);
  assert.equal(parseSimMessage({ ...state, pos: { x: 1, y: 2, z: NaN, a: 0, b: 0 } }), null);
  assert.equal(parseSimMessage({ ...state, spindle: null }), null);
  assert.deepEqual(parseSimMessage({ type: 'tnc:tools', id: 'a', tools: [{ t: 1, l: 60, r: 5, name: 'X', dl: 0.1, nested: { a: 1 } }] }), { type: 'tnc:tools', id: 'a', tools: [{ t: 1, l: 60, r: 5, name: 'X', dl: 0.1 }] });
  assert.equal(parseSimMessage({ type: 'tnc:tools', id: 'a', tools: [{ t: 1, l: 60 }] }), null);
  assert.equal(parseSimMessage({ type: 'tnc:tools', id: 'a', tools: 'all' }), null);
  assert.deepEqual(parseSimMessage({ type: 'tnc:settings', lang: 'en', quality: 'low' }), { type: 'tnc:settings', lang: 'en', quality: 'low' });
  assert.deepEqual(parseSimMessage({ type: 'tnc:settings', lang: 'sr' }), { type: 'tnc:settings', lang: 'sr' });
  assert.equal(parseSimMessage({ type: 'tnc:settings', lang: 'de' }), null);
  assert.equal(parseSimMessage({ type: 'tnc:settings', lang: 'sr-Latn' }), null);
  assert.deepEqual(parseSimMessage({ type: 'tnc:exit', anything: 1 }), { type: 'tnc:exit' });
  assert.equal(parseSimMessage({ type: 'tnc:program', id: 'x', name: 'A.H', machine: '426' }), null);
  assert.equal(parseSimMessage({ type: 'tnc:eval', code: '1' }), null);
  for (const junk of [null, undefined, 'tnc:ready', 7, [], { type: 5 }]) assert.equal(parseSimMessage(junk), null);
});

test('bridge: only the simulator frame on our own origin is heard; v1 and v2 are told apart; asks time out', async () => {
  const sent: unknown[] = [];
  const frame = { postMessage: (m: unknown, origin: string) => sent.push([m, origin]) } as unknown as Window;
  let listener: ((e: MessageEvent) => void) | null = null;
  const host = {
    addEventListener: (_: 'message', fn: (e: MessageEvent) => void) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const b = createBridge(() => frame, 'http://127.0.0.1:5400', host);
  const say = (data: unknown, origin = 'http://127.0.0.1:5400', source: unknown = frame) => listener!({ data, origin, source } as MessageEvent);
  const seen: string[] = [];
  b.on('tnc:exit', () => seen.push('exit'));
  b.on('tnc:state', (m) => seen.push('state ' + m.machine));

  say({ type: 'tnc:exit' }, 'http://evil.example');
  say({ type: 'tnc:exit' }, undefined, {});
  say({ type: 'tnc:nope' });
  assert.deepEqual(seen, []);
  assert.equal(b.level, 0);

  b.hello();
  assert.deepEqual(sent.slice(0, 2), [[{ type: 'tnc:hello', v: 2 }, 'http://127.0.0.1:5400'], [{ type: 'tnc:get', id: 'hello' }, 'http://127.0.0.1:5400']]);
  say({ type: 'tnc:program', id: 'hello', name: 'A.H', machine: '426', text: '' });
  assert.equal(b.level, 1, 'an answer to tnc:get alone means a v1 simulator');
  const levels: number[] = [];
  b.onLevel((l) => levels.push(l));
  say({ type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'sv' });
  assert.equal(b.level, 2);
  assert.deepEqual(levels, [2]);
  assert.equal(b.ready?.edition, 'play');
  say({ type: 'tnc:ready' });
  assert.equal(b.level, 2, 'the level never goes down');

  say(state);
  say({ type: 'tnc:exit' });
  assert.deepEqual(seen, ['state 430', 'exit']);

  const p = b.current(1000);
  const id = (sent.at(-1) as [{ id: string }])[0].id;
  say({ type: 'tnc:program', id, name: 'B.H', machine: '430', text: 'BEGIN PGM B MM' });
  assert.deepEqual(await p, { name: 'B.H', machine: '430', text: 'BEGIN PGM B MM' });
  await assert.rejects(b.tools(20), /did not answer/);

  b.lock(true, 'door');
  b.lock(false);
  b.machine('430');
  b.camera('tool');
  b.exec('stop');
  b.inspect('compare');
  b.setTools([{ t: 1, l: 60, r: 5 }]);
  b.present({ lang: 'en', skin: '430' });
  assert.deepEqual(sent.slice(-10).map((s) => (s as [unknown])[0]), [
    { type: 'tnc:lock', locked: true, reason: 'door' },
    { type: 'tnc:lock', locked: false },
    { type: 'tnc:machine', machine: '430' },
    { type: 'tnc:camera', view: 'tool' },
    { type: 'tnc:exec', cmd: 'stop' },
    { type: 'tnc:inspect', panel: 'compare' },
    { type: 'tnc:tools:set', tools: [{ t: 1, l: 60, r: 5 }] },
    // the language travels alone, so a simulator that does not know it still takes the rest ...
    { type: 'tnc:present', skin: '430' },
    { type: 'tnc:present', lang: 'en' },
    // ... and is asked which language it shows now
    { type: 'tnc:hello', v: 2 },
  ]);
  b.dispose();
  assert.equal(listener, null);
});

/** a bridge wired to a fake simulator frame: what was posted to it, and a way to speak as it */
function wired() {
  const sent: Record<string, unknown>[] = [];
  const frame = { postMessage: (m: Record<string, unknown>) => sent.push(m) } as unknown as Window;
  let listener: ((e: MessageEvent) => void) | null = null;
  const host = {
    addEventListener: (_: 'message', fn: (e: MessageEvent) => void) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const b = createBridge(() => frame, 'http://127.0.0.1:5400', host);
  const say = (data: unknown) => listener!({ data, origin: 'http://127.0.0.1:5400', source: frame } as MessageEvent);
  return { b, sent, say };
}

test('bridge: a simulator that does not know Serbian keeps its language and does not rename the shell', () => {
  const { b, sent, say } = wired();
  const heard: (string | undefined)[] = [];
  b.on('tnc:settings', (m) => heard.push(m.lang));
  // the shell shows Serbian; this simulator read "sr" from the shared key, did not know it and fell back
  say({ type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'sv' });
  assert.equal(b.simLang, 'sv');
  b.present({ lang: 'sr', quality: 'low' });
  assert.deepEqual(sent, [{ type: 'tnc:present', quality: 'low' }, { type: 'tnc:present', lang: 'sr' }, { type: 'tnc:hello', v: 2 }]);
  say({ type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'sv' }); // it dropped the language: still Swedish
  b.present({ lang: 'sr' }); // what the shell does on every tnc:ready
  assert.equal(sent.length, 4, 'asked once per language: no hello/ready loop');
  // the user changes the graphics inside the simulator: every field is repeated, the language is not a choice
  say({ type: 'tnc:settings', lang: 'sv', skin: '426', env: 'cold-steel', quality: 'high', motion: 'full', sound: true });
  assert.deepEqual(heard, [undefined]);
  // the user picks English inside the simulator: that is a choice
  say({ type: 'tnc:settings', lang: 'en', quality: 'high' });
  assert.deepEqual(heard, [undefined, 'en']);
  assert.equal(b.simLang, 'en');
  // the shell goes back to Serbian: since the simulator moved on its own, it is asked again what it shows
  b.present({ lang: 'sr' });
  assert.deepEqual(sent.slice(-2), [{ type: 'tnc:present', lang: 'sr' }, { type: 'tnc:hello', v: 2 }]);
  say({ type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'en' });
  say({ type: 'tnc:settings', lang: 'en', quality: 'low' }); // a repeat again
  say({ type: 'tnc:settings', lang: 'sv', quality: 'low' }); // a choice
  assert.deepEqual(heard, [undefined, 'en', undefined, 'sv']);
  b.dispose();
});

test('bridge: a simulator that knows Serbian is followed both ways', () => {
  const { b, sent, say } = wired();
  const heard: (string | undefined)[] = [];
  b.on('tnc:settings', (m) => heard.push(m.lang));
  say({ type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'sv' });
  b.present({ lang: 'sr' });
  say({ type: 'tnc:ready', v: 2, edition: 'play', machine: '426', lang: 'sr' }); // the answer to the hello
  assert.equal(b.simLang, 'sr');
  b.present({ lang: 'sr' });
  assert.equal(sent.filter((m) => m.type === 'tnc:hello').length, 1);
  say({ type: 'tnc:settings', lang: 'sv', quality: 'high' }); // back to Swedish inside the simulator
  say({ type: 'tnc:settings', lang: 'sr', quality: 'high' }); // and to Serbian again
  assert.deepEqual(heard, ['sv', 'sr']);
  // a v1 simulator never says its language: what it sends is taken as it is
  const old = wired();
  old.b.present({ lang: 'sr' });
  assert.deepEqual(old.sent, [{ type: 'tnc:present', lang: 'sr' }], 'no hello before the simulator is known to speak v2');
  b.dispose();
  old.b.dispose();
});

test('shared settings: Swedish by default, bad fields fall back one by one, unknown fields survive a write', () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(readSettings(store).lang, 'sv');
  assert.equal(readSettings(null).lang, 'sv');
  m.set(SETTINGS_KEY, JSON.stringify({ lang: 'en', quality: 'ultra', future: { a: 1 } }));
  assert.deepEqual(readSettings(store), { lang: 'en', skin: '426', env: 'cold-steel', quality: 'medium', motion: 'full', sound: true });
  const next = writeSettings(store, { motion: 'reduced', sound: false });
  assert.equal(next.motion, 'reduced');
  assert.equal(next.lang, 'en');
  assert.deepEqual(JSON.parse(m.get(SETTINGS_KEY)!).future, { a: 1 });
  m.set(SETTINGS_KEY, '][');
  assert.equal(readSettings(store).lang, 'sv');
});

test('shared settings: Serbian is stored as sr, anything else falls back to Swedish; a simulator fallback is told from a choice', () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(writeSettings(store, { lang: 'sr' }).lang, 'sr');
  assert.equal(JSON.parse(m.get(SETTINGS_KEY)!).lang, 'sr');
  assert.equal(readSettings(store).lang, 'sr');
  for (const bad of ['sr-Latn', 'SR', 'de', '', 5, null]) {
    m.set(SETTINGS_KEY, JSON.stringify({ lang: bad, quality: 'high' }));
    assert.deepEqual([readSettings(store).lang, readSettings(store).quality], ['sv', 'high'], String(bad));
  }
  // an invalid language in a patch changes nothing (the stored one stays)
  m.set(SETTINGS_KEY, JSON.stringify({ lang: 'sr' }));
  assert.equal(writeSettings(store, { lang: 'de' as 'sr' }).lang, 'sr');

  // the simulator shows Swedish and saved the key: Swedish in the store is its own, not a choice
  assert.equal(simFellBack('sr', 'sv', 'sv'), true);
  // the user picked English in the simulator (it showed Swedish before) or in another tab
  assert.equal(simFellBack('sr', 'sv', 'en'), false);
  assert.equal(simFellBack('sv', 'sv', 'en'), false);
  // nothing changed, or nothing is known about the simulator
  assert.equal(simFellBack('sr', 'sr', 'sr'), false);
  assert.equal(simFellBack('sr', undefined, 'sv'), false);
});
