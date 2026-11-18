import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createBridge, htmlLang, LANG_NAMES, LANGS, type Bridge, type BridgeLevel, type CameraView, type InspectPanel, type Present, type SimState } from '../lib/bridge';
import { browserStore, type Settings } from '../lib/settings';
import { actionsFor, TARGET_IDS, type Action, type TargetId } from './game/actions';
import { applyEquipped, CuttingClock, lockOf, newGame, oilLevel, rackTool, step, STATION_IDS, STATION_MACHINE, type Effect, type Game, type GameEvent, type StationId } from './game/machine';
import { fromSave, loadPrefs, loadSave, parseSave, storePrefs, storeSave, toSave, type Prefs } from './game/save';
import { newScheduler, tick, type Npc } from './game/scheduler';
import { loadPack, packText, type Pack } from './pack/loader';
import { BOSS, OFFICE_WORKER, specFromPack } from './scene/people';
import { createWorkshop, type View, type Workshop } from './scene/workshop';
import { Compare } from './Compare';
import { Pad } from './Pad';
import { Panel } from './Panel';
import { SECRETS, type SecretId } from './secrets';
import type { Key, T } from './strings';

interface Props {
  settings: Settings;
  change(p: Present): void;
  reduced: boolean;
  t: T;
  /** set here to a way of asking which language the simulator shows (it can differ from the shell's) */
  simLang: RefObject<() => string | undefined>;
}

type PanelId = 'stations' | 'computer' | 'onboarding' | 'compare' | 'views' | null;
type Scene = { who: Npc | 'pack'; line: number };
const NPC_LINES = 3;
const VIEWS: readonly (View | 'pov' | 'tool' | 'part')[] = ['walk', 'overview', 'orbit', 'pov', 'tool', 'part'];

/** The workshop: the 3-D floor, the one simulator kept mounted behind it, the game and every panel. */
export function Shop({ settings, change, reduced, t, simLang }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scene = useRef<Workshop | null>(null);
  const bridge = useRef<Bridge | null>(null);
  const store = useMemo(browserStore, []);
  const saved = useMemo(() => loadSave(store), [store]);

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(store));
  const [game, setGame] = useState<Game>(() => (saved ? fromSave(saved) : newGame()));
  const [secrets, setSecrets] = useState<string[]>(() => saved?.secrets ?? []);
  const [mode, setMode] = useState<'floor' | 'machine'>('floor');
  const [panel, setPanel] = useState<PanelId>(() => (loadPrefs(store).onboarded ? null : 'onboarding'));
  const [step_, setStep] = useState(0);
  const [target, setTarget] = useState<TargetId | null>(null);
  const [locked, setLocked] = useState(false);
  const [walking, setWalking] = useState(true); // the scene's view is the walking one (not the overview or the orbit)
  const [toast, setToast] = useState('');
  const [npc, setNpc] = useState<Scene | null>(null);
  const [level, setLevel] = useState<BridgeLevel>(0);
  const [simOwnsExit, setSimOwnsExit] = useState(false);
  const [liveBox, setLiveBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const liveCompare = liveBox !== null;

  // values the long-lived callbacks read; refs so the bridge and the scene are wired once
  const gameRef = useRef(game);
  const tRef = useRef(t);
  tRef.current = t;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sim = useRef<SimState | null>(null);
  const sched = useRef(saved?.scheduler ?? newScheduler());
  const clock = useRef(new CuttingClock());
  const cutDebt = useRef(0);
  const pendingCamera = useRef<CameraView | null>(null);
  const pendingInspect = useRef<InspectPanel | null>(null);
  const pack = useRef<Pack | null>(null);
  const packDue = useRef(false);
  const wasDone = useRef(false);
  const live = useRef({ mode, panel, npc, prefs });
  live.current = { mode, panel, npc, prefs };

  const say = useCallback((text: string) => {
    setToast('');
    // an empty beat first, so the same sentence twice is announced twice
    window.setTimeout(() => setToast(text), 30);
  }, []);
  const find = useCallback(
    (id: SecretId) =>
      setSecrets((s) => {
        if (s.includes(id)) return s;
        if (id !== '333') say(tRef.current('i.secret'));
        return [...s, id];
      }),
    [say],
  );

  /* ---------- effects of a game step: the only place the game talks to the simulator ---------- */
  const runEffect = useCallback(
    (e: Effect) => {
      const b = bridge.current;
      switch (e.type) {
        case 'lock':
          b?.lock(e.locked, e.reason ? tRef.current(`l.${e.reason}`) : undefined);
          break;
        case 'stop':
          b?.exec('stop');
          break;
        case 'machine': {
          const machine = STATION_MACHINE[e.station];
          if (!b) break;
          if (b.level === 2) {
            b.machine(machine);
            b.present({ skin: machine });
          } else if (b.level === 1) {
            // a v1 simulator has no machine message: reopen what is on its screen on the other machine
            void b.current().then((p) => p.machine !== machine && b.open({ ...p, machine })).catch(() => {});
          }
          break;
        }
        case 'tools': {
          if (!b) break;
          const slot = sim.current?.tool?.t ?? 1;
          b.tools()
            .then((table) => {
              b.setTools(applyEquipped(table, slot, e.tool));
              say(`${tRef.current('i.toolSet')} T${slot} ${e.tool.name} L${e.tool.l} R${e.tool.r}`);
            })
            .catch(() => say(tRef.current('i.toolNotSet')));
          break;
        }
        case 'view':
          if (e.view === 'machine') {
            setPanel(null);
            setWalking(true);
            scene.current?.flyTo(e.station, () => {
              setMode('machine');
              if (pendingCamera.current) bridge.current?.camera(pendingCamera.current);
              pendingCamera.current = null;
              if (pendingInspect.current) bridge.current?.inspect(pendingInspect.current);
              pendingInspect.current = null;
              frame.current?.focus();
            });
          } else {
            setMode('floor');
            scene.current?.setRunning(true);
            scene.current?.flyBack(e.station);
            canvas.current?.focus({ preventScroll: true });
          }
          break;
      }
    },
    [say],
  );

  /** One game event. Returns true when it was accepted; a refusal is said out loud. */
  const dispatch = useCallback(
    (e: GameEvent, quiet = false): boolean => {
      const r = step(gameRef.current, e);
      if (r.refused) {
        if (!quiet) say(tRef.current(`r.${r.refused}`));
        return false;
      }
      if (r.game !== gameRef.current) {
        const before = gameRef.current;
        gameRef.current = r.game;
        setGame(r.game);
        scene.current?.setGame(r.game);
        const a = r.game.active;
        if (a && e.type === 'CUT') {
          const was = oilLevel(before.stations[a].oil);
          const now = oilLevel(r.game.stations[a].oil);
          if (now !== was && now !== 'ok') say(tRef.current(now === 'empty' ? 'i.oilEmpty' : 'i.oilLow'));
        }
      }
      r.effects.forEach(runEffect);
      return true;
    },
    [runEffect, say],
  );

  /* ---------- the bridge to the one simulator ---------- */
  useEffect(() => {
    const b = createBridge(() => frame.current?.contentWindow, location.origin);
    bridge.current = b;
    simLang.current = () => b.simLang;
    b.onLevel(setLevel);
    b.on('tnc:ready', (m) => {
      setSimOwnsExit(m.v === 2 && m.edition === 'play');
      const s = settingsRef.current;
      b.present({ lang: s.lang, quality: s.quality, motion: s.motion, sound: s.sound, env: s.env });
      const g = gameRef.current;
      if (g.active) {
        b.machine(STATION_MACHINE[g.active]);
        b.present({ skin: STATION_MACHINE[g.active] });
      }
      const l = lockOf(g);
      b.lock(l.locked, l.reason ? tRef.current(`l.${l.reason}`) : undefined);
    });
    b.on('tnc:state', (s) => {
      sim.current = s;
      scene.current?.setSim(s);
      cutDebt.current += clock.current.feed(s, performance.now());
      const g = gameRef.current.sim;
      if (s.running !== g.running || s.cutting !== g.cutting) dispatch({ type: 'SIM', running: s.running, cutting: s.cutting }, true);
      if (s.done && !wasDone.current && s.errors === 0) packDue.current = true;
      wasDone.current = s.done;
    });
    b.on('tnc:exit', () => dispatch({ type: 'EXIT_CONTROL' }, true));
    b.on('tnc:settings', ({ type: _type, ...p }) => change(p));
    void loadPack().then((p) => (pack.current = p));
    return () => {
      b.dispose();
      bridge.current = null;
      simLang.current = () => undefined;
    };
  }, [dispatch, change, simLang]);

  /* ---------- the scene ---------- */
  // the quality tier decides renderer options that cannot change later: a new tier is a new scene;
  // environment and motion are pushed into the running scene by the effects below
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the tier rebuilds the scene
  useEffect(() => {
    const w = createWorkshop({
      canvas: canvas.current!,
      quality: settings.quality,
      env: settingsRef.current.env,
      reducedMotion: reduced,
      onTarget: setTarget,
      onInteract: (id) => interactRef.current(id),
      onLock: setLocked,
    });
    scene.current = w;
    w.setGame(gameRef.current);
    w.setSim(sim.current);
    (window as unknown as { __tncPlay?: unknown }).__tncPlay = {
      // diagnostics for the measured frame times in the test report, and a way to call a character in a test
      stats: () => w.stats(),
      resetStats: () => w.resetStats(),
      visit: (who: Npc | 'pack') => setNpc({ who, line: 0 }),
      game: () => gameRef.current,
      pose: () => w.pose(),
    };
    return () => {
      scene.current = null;
      w.dispose();
      delete (window as unknown as { __tncPlay?: unknown }).__tncPlay;
    };
  }, [settings.quality]);
  // `settings.quality` in the lists below: a new tier builds a new scene, which needs the same values again
  // biome-ignore lint/correctness/useExhaustiveDependencies: quality is the rebuild trigger
  useEffect(() => scene.current?.setEnv(settings.env), [settings.env, settings.quality]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: quality is the rebuild trigger
  useEffect(() => scene.current?.setReducedMotion(reduced), [reduced, settings.quality]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: quality is the rebuild trigger
  useEffect(() => scene.current?.setInput(mode === 'floor' && panel === null && npc === null), [mode, panel, npc, settings.quality]);
  // draw only when the floor is what the player sees and the tab is visible
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode and quality are the triggers; the body reads them through refs
  useEffect(() => {
    const apply = () => scene.current?.setRunning(!document.hidden && (live.current.mode === 'floor' || liveCompare));
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, [mode, liveCompare, settings.quality]);

  // The focus follows the view, after the change is on screen: into the simulator when its control opens, back to
  // the floor when it closes. (The side being left is inert until then, and an inert element cannot take the focus.)
  const modeBefore = useRef(mode);
  useEffect(() => {
    if (modeBefore.current === mode) return;
    modeBefore.current = mode;
    if (mode === 'machine') frame.current?.focus();
    else canvas.current?.focus({ preventScroll: true });
  }, [mode]);

  /* ---------- once a second: oil, the interruption scheduler, the pack scene ---------- */
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (cutDebt.current > 0) {
        const seconds = cutDebt.current;
        cutDebt.current = 0;
        dispatch({ type: 'CUT', seconds }, true);
      }
      const c = live.current;
      const free = c.mode === 'floor' && c.panel === null && c.npc === null;
      if (packDue.current && free && pack.current?.completion) {
        packDue.current = false;
        setNpc({ who: 'pack', line: 0 });
        return;
      }
      const r = tick(sched.current, dt, {
        active: !document.hidden,
        setup: c.panel === 'onboarding',
        modal: c.panel !== null || c.mode === 'machine',
        recovering: (sim.current?.errors ?? 0) > 0,
        showing: c.npc !== null,
        enabled: c.prefs.npc,
      });
      sched.current = r.state;
      if (r.fire) setNpc({ who: r.fire, line: 0 });
    }, 1000);
    return () => window.clearInterval(id);
  }, [dispatch]);

  /* ---------- persistence ---------- */
  useEffect(() => {
    storeSave(store, toSave(game, secrets, sched.current));
  }, [store, game, secrets]);
  const updatePrefs = useCallback(
    (p: Partial<Prefs>) =>
      setPrefs((old) => {
        const next = { ...old, ...p, npc: { ...old.npc, ...p.npc } };
        storePrefs(store, next);
        return next;
      }),
    [store],
  );
  const setting = useCallback(
    (p: Present) => {
      change(p);
      bridge.current?.present(p);
    },
    [change],
  );

  /* ---------- doing things ---------- */
  const act = useCallback(
    (_id: TargetId, a: Action) => {
      const d = a.do;
      if (d.type === 'UI') {
        if (d.what === 'computer') setPanel('computer');
        else if (d.what === 'inspect-big') {
          say(tRef.current('i.big'));
          find('5511');
        } else if (d.what === 'inspect-arm') {
          say(tRef.current('i.arm'));
          find('plat');
        } else {
          scene.current?.setCabinetOpen(true);
          say(tRef.current('i.norsk'));
          find('norsk');
        }
        return;
      }
      if (d.type === 'MEASURE') {
        // the measuring tool opens the simulator's own part view on that machine, with its comparison panel
        pendingCamera.current = 'part';
        pendingInspect.current = 'compare';
        if (!dispatch({ type: 'ENTER_CONTROL', station: d.station })) {
          pendingCamera.current = null;
          pendingInspect.current = null;
        }
        return;
      }
      if (dispatch(d) && d.type === 'REFILL') say(tRef.current('i.refilled'));
    },
    [dispatch, find, say],
  );
  const interactRef = useRef<(id: TargetId) => void>(() => {});
  interactRef.current = (id) => {
    const a = actionsFor(id, gameRef.current)[0];
    if (a) act(id, a);
  };

  const chooseView = (v: (typeof VIEWS)[number]) => {
    setPanel(null);
    if (v === 'walk' || v === 'overview' || v === 'orbit') {
      setWalking(v === 'walk');
      scene.current?.setView(v);
      return;
    }
    // the three machine cameras are the simulator's own: go to the control and ask it for that view
    const g = gameRef.current;
    const station: StationId = g.active ?? 'fil15';
    pendingCamera.current = v;
    if (g.stations[station].phase === 'control') {
      bridge.current?.camera(v);
      pendingCamera.current = null;
    } else if (!dispatch({ type: 'ENTER_CONTROL', station })) pendingCamera.current = null;
  };

  const openSecret = (id: SecretId) => {
    const s = SECRETS.find((x) => x.id === id)!;
    if (!s.program) {
      setPanel('compare');
      return;
    }
    const b = bridge.current;
    if (!b || b.level === 0) {
      say(t('i.cannotOpen'));
      return;
    }
    const g = gameRef.current;
    b.open({ name: s.program.name, text: s.program.text, machine: STATION_MACHINE[g.active ?? 'fil15'] });
    say(`${t('i.opened')} ${s.program.name}`);
  };

  /* ---------- 333, typed anywhere outside a text field ---------- */
  useEffect(() => {
    let typed = '';
    let at = 0;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // when the key was pressed, not when this page got to it: a slow frame between two keys does not split them
      const now = e.timeStamp;
      typed = now - at > 2000 ? '' : typed;
      at = now;
      typed = /^\d$/.test(e.key) ? (typed + e.key).slice(-3) : '';
      if (typed === '333') {
        typed = '';
        find('333');
        if (document.pointerLockElement) document.exitPointerLock();
        setPanel('compare');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [find]);

  /* ---------- characters ---------- */
  const lines = npc ? (npc.who === 'pack' ? (pack.current?.completion?.lines.length ?? 0) : NPC_LINES) : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: quality is the rebuild trigger
  useEffect(() => {
    const w = scene.current;
    if (!w) return;
    if (!npc) {
      w.hideFigures();
      return;
    }
    if (npc.who === 'pack') {
      const c = pack.current?.completion;
      if (!c) return;
      w.showFigures(c.figures.map(specFromPack), c.lines[npc.line]?.who ?? 0, c.gesture === 'highfive' && npc.line === c.lines.length - 1);
    } else w.showFigures([npc.who === 'boss' ? BOSS : OFFICE_WORKER], 0, false);
  }, [npc, settings.quality]);
  const npcNext = useRef<HTMLButtonElement>(null);
  const npcOn = npc !== null;
  // the caption's first button takes the focus when a character arrives, so Enter moves the scene on
  useEffect(() => {
    if (npcOn) npcNext.current?.focus({ preventScroll: true });
  }, [npcOn]);
  const endNpc = useCallback(() => {
    setNpc(null);
    canvas.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!npc) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && endNpc();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [npc, endNpc]);
  let caption: { who: string; text: string } | null = null;
  if (npc) {
    if (npc.who === 'pack') {
      const c = pack.current?.completion;
      const l = c?.lines[npc.line];
      if (c && l) caption = { who: c.figures[l.who].name, text: packText(l, settings.lang) };
    } else caption = { who: t(`n.${npc.who}`), text: t(`n.${npc.who}.${npc.line}` as Key) };
  }

  /* ---------- save and load from the computer ---------- */
  const fileIn = useRef<HTMLInputElement>(null);
  const adopt = (raw: unknown): boolean => {
    const s = parseSave(raw);
    if (!s) return false;
    const g = fromSave(s);
    gameRef.current = g;
    setGame(g);
    scene.current?.setGame(g);
    setSecrets(s.secrets);
    sched.current = s.scheduler;
    const l = lockOf(g);
    bridge.current?.lock(l.locked, l.reason ? t(`l.${l.reason}`) : undefined);
    return true;
  };
  const exportSave = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(toSave(gameRef.current, secrets, sched.current), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tnc-5511-save.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const importSave = async (f: File | undefined) => {
    if (!f || f.size > 100_000) return say(t('i.badSave'));
    try {
      say(adopt(JSON.parse(await f.text())) ? t('i.loaded') : t('i.badSave'));
    } catch {
      say(t('i.badSave'));
    }
  };

  const hand = [game.held ? t(`t.${game.held}`) : null, game.carrying ? rackTool(game.carrying)?.name : null].filter(Boolean).join(' + ');
  const prompt = target && mode === 'floor' && !panel && !npc ? actionsFor(target, game)[0] : null;
  const label = (a: Action) => (a.id === 'rackTake' ? `${t('a.rackTake')} ${rackTool(a.arg ?? '')?.name ?? ''}` : a.id === 'pick' ? `${t('a.pick')}: ${t(`t.${a.arg}` as Key)}` : t(`a.${a.id}` as Key));
  const show = mode === 'machine' ? 'full' : liveCompare ? 'compare' : 'no';
  const seg = <K extends string>(name: Key, value: K, options: readonly K[], text: (k: K) => string, set: (k: K) => void) => (
    <fieldset className="seg">
      <legend>{t(name)}</legend>
      {options.map((k) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)}>
          {text(k)}
        </button>
      ))}
    </fieldset>
  );
  const onOff = (name: Key, value: boolean, set: (v: boolean) => void) => seg(name, value ? 'on' : 'off', ['on', 'off'] as const, (k) => t(`c.${k}`), (k) => set(k === 'on'));

  return (
    <div className="shop" data-mode={mode} data-env={settings.env}>
      <div className="shop-sim" data-show={show} inert={show === 'no'} style={show === 'compare' && liveBox ? liveBox : undefined}>
        <iframe ref={frame} src="/sim/?edition=play" title={t('hud.simTitle')} allow="fullscreen; clipboard-read; clipboard-write" onLoad={() => bridge.current?.hello()} />
        {mode === 'machine' && !simOwnsExit && (
          <div className="shop-simbar">
            <button type="button" className="hud-btn hud-primary" onClick={() => dispatch({ type: 'EXIT_CONTROL' })}>
              ← {t('hud.exit')}
            </button>
            {level === 0 && <span role="status">{t('hud.noBridge')}</span>}
          </div>
        )}
      </div>

      <div className="shop-floor" inert={mode === 'machine'} aria-hidden={mode === 'machine'}>
        <canvas ref={canvas} className="shop-canvas" tabIndex={0} aria-label={`${t('land.kicker')}. ${t('hud.click')}. ${t('hud.stations')}.`} />
        <span className="shop-cross" aria-hidden="true" />
        {mode === 'floor' && walking && !panel && !npc && <Pad onMove={(x, y) => scene.current?.setStick(x, y)} />}

        <nav className="hud hud-rail" aria-label="5511">
          <span className="hud-badge" aria-hidden="true">
            5511
          </span>
          <button type="button" className="hud-btn" onClick={() => setPanel('stations')}>
            {t('hud.stations')}
          </button>
          <button type="button" className="hud-btn" onClick={() => setPanel('views')}>
            {t('hud.view')}
          </button>
          <button type="button" className="hud-btn" onClick={() => setPanel('computer')}>
            {t('hud.computer')}
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => {
              setStep(0);
              setPanel('onboarding');
            }}
          >
            {t('hud.help')}
          </button>
          <button type="button" className="hud-btn" aria-pressed={!settings.sound} onClick={() => setting({ sound: !settings.sound })}>
            {settings.sound ? t('hud.mute') : t('hud.unmute')}
          </button>
          <fieldset className="hud-lang" aria-label={t('c.lang')}>
            {LANGS.map((l) => (
              <button key={l} type="button" className="hud-btn" aria-pressed={settings.lang === l} aria-label={LANG_NAMES[l]} title={LANG_NAMES[l]} onClick={() => setting({ lang: l })} lang={htmlLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </fieldset>
        </nav>

        <section className="hud hud-status" aria-label="Status">
          {STATION_IDS.map((id) => {
            const s = game.stations[id];
            const lvl = oilLevel(s.oil);
            const state = !s.power ? 'hud.powerOff' : game.active === id && game.sim.running ? 'hud.running' : s.phase !== 'floor' && s.phase !== 'control' ? 'hud.locked' : lvl === 'empty' ? 'hud.locked' : 'hud.ready';
            return (
              <div key={id} className="hud-st" data-state={state.slice(4)}>
                <b>{id}</b>
                <span className="hud-state">{t(state)}</span>
                <meter className="hud-oil" aria-label={`${t('hud.oil')} ${id}`} min={0} max={100} low={20} value={Math.round(s.oil)} data-level={lvl} />
                <span className="hud-pct">
                  {t('hud.oil')} {Math.round(s.oil)} %{lvl !== 'ok' && <strong> {t(lvl === 'empty' ? 'hud.oilEmpty' : 'hud.oilLow')}</strong>}
                </span>
              </div>
            );
          })}
          <div className="hud-hand">
            {t('hud.hand')}: <b>{hand || t('hud.nothing')}</b>
          </div>
        </section>

        <div className="hud hud-bottom">
          <p className="hud-toast" role="status" aria-live="polite">
            {panel ? '' : toast}
          </p>
          {prompt && target && (
            <button type="button" className="hud-prompt" onClick={() => act(target, prompt)}>
              <kbd>{t('hud.interact')}</kbd>
              <span>
                {label(prompt)} <small>{t(`t.${target}`)}</small>
              </span>
            </button>
          )}
          {!prompt && !npc && !panel && <p className="hud-hint">{locked ? t('hud.esc') : t('hud.click')}</p>}
        </div>

        {npc && caption && (
          <section className="npc" aria-live="polite" aria-label={caption.who}>
            <b>{caption.who}</b>
            <p>{prefs.captions ? caption.text : t('n.capOff')}</p>
            <div className="npc-btns">
              <button ref={npcNext} type="button" className="hud-btn hud-primary" onClick={() => (npc.line + 1 < lines ? setNpc({ ...npc, line: npc.line + 1 }) : endNpc())}>
                {t('n.next')}
              </button>
              <button type="button" className="hud-btn" onClick={endNpc}>
                {t('n.skip')} <kbd>Esc</kbd>
              </button>
              {npc.who !== 'pack' && (
                <button
                  type="button"
                  className="hud-btn"
                  onClick={() => {
                    updatePrefs({ npc: { ...prefs.npc, [npc.who]: false } });
                    endNpc();
                  }}
                >
                  {t('n.never')}
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {panel === 'stations' && (
        <Panel title={t('hud.stations')} closeLabel={t('hud.close')} onClose={() => setPanel(null)} place="side">
          <ul className="st-list">
            {TARGET_IDS.map((id) => {
              const s = id === 'fil15' || id === 'dmc125' ? game.stations[id] : null;
              return (
                <li key={id}>
                  <h3>{t(`t.${id}`)}</h3>
                  {s && (
                    <p>
                      {t(`p.${s.phase}`)} · {t('hud.oil')} {Math.round(s.oil)} % · {rackTool(s.equipped)?.name ?? '—'}
                      {!s.power && ` · ${t('hud.powerOff')}`}
                    </p>
                  )}
                  <div className="st-acts">
                    {actionsFor(id, game).map((a) => (
                      <button
                        key={a.id + (a.arg ?? '')}
                        type="button"
                        className="hud-btn"
                        onClick={() => {
                          if (a.id !== 'exitControl' && a.id !== 'enterControl' && a.id !== 'measure') {
                            setWalking(true);
                            scene.current?.goTo(id);
                          }
                          act(id, a);
                        }}
                      >
                        {label(a)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="hud-btn hud-quiet"
                      onClick={() => {
                        setWalking(true);
                        scene.current?.goTo(id);
                        setPanel(null);
                      }}
                    >
                      {t('hud.goThere')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="pp-live" role="status" aria-live="polite">
            {toast}
          </p>
        </Panel>
      )}

      {panel === 'views' && (
        <Panel title={t('hud.view')} closeLabel={t('hud.close')} onClose={() => setPanel(null)} place="side">
          <div className="view-list">
            {VIEWS.map((v) => (
              <button key={v} type="button" className="hud-btn" onClick={() => chooseView(v)}>
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {panel === 'computer' && (
        <Panel title={t('c.title')} closeLabel={t('hud.close')} onClose={() => setPanel(null)} className="pc">
          <section>
            <h3>{t('c.save')}</h3>
            <div className="st-acts">
              <button type="button" className="hud-btn" onClick={() => say(storeSave(store, toSave(gameRef.current, secrets, sched.current)) ? t('i.saved') : t('i.noSave'))}>
                {t('c.saveNow')}
              </button>
              <button type="button" className="hud-btn" onClick={() => say(adopt(loadSave(store)) ? t('i.loaded') : t('i.noSave'))}>
                {t('c.load')}
              </button>
              <button type="button" className="hud-btn" onClick={exportSave}>
                {t('c.export')}
              </button>
              <button type="button" className="hud-btn" onClick={() => fileIn.current?.click()}>
                {t('c.import')}
              </button>
              <input ref={fileIn} type="file" accept="application/json,.json" hidden onChange={(e) => {
                  void importSave(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="hud-btn"
                onClick={() => {
                  adopt(toSave(newGame(), [], newScheduler()));
                  say(t('i.loaded'));
                }}
              >
                {t('c.reset')}
              </button>
            </div>
          </section>
          <section>
            <h3>{t('c.settings')}</h3>
            <div className="pc-grid">
              {seg('c.lang', settings.lang, LANGS, (k) => LANG_NAMES[k], (lang) => setting({ lang }))}
              {seg('c.quality', settings.quality, ['low', 'medium', 'high'] as const, (k) => t(`c.q.${k}`), (quality) => setting({ quality }))}
              {seg('c.motion', settings.motion, ['full', 'reduced'] as const, (k) => t(`c.m.${k}`), (motion) => setting({ motion }))}
              {seg('c.env', settings.env, ['cold-steel', 'workshop-night'] as const, (k) => t(`c.e.${k}`), (env) => setting({ env }))}
              {onOff('c.sound', settings.sound, (sound) => setting({ sound }))}
              {onOff('c.captions', prefs.captions, (captions) => updatePrefs({ captions }))}
              {onOff('c.boss', prefs.npc.boss, (boss) => updatePrefs({ npc: { ...prefs.npc, boss } }))}
              {onOff('c.office', prefs.npc.office, (office) => updatePrefs({ npc: { ...prefs.npc, office } }))}
            </div>
            <button
              type="button"
              className="hud-btn"
              onClick={() => {
                setStep(0);
                setPanel('onboarding');
              }}
            >
              {t('c.replay')}
            </button>
          </section>
          <section>
            <h3>{t('c.secrets')}</h3>
            <ul className="sec-list">
              {SECRETS.map((s) => {
                const found = s.always || secrets.includes(s.id);
                return (
                  <li key={s.id} data-found={found}>
                    <span>
                      <b>{found ? t(s.title) : '? ? ?'}</b>
                      <small>{found && s.program ? s.program.text.split('\n')[3].replace('; ', '') : t(s.hint)}</small>
                    </span>
                    {found ? (
                      <button type="button" className="hud-btn" onClick={() => openSecret(s.id)}>
                        {t('c.open')}
                      </button>
                    ) : (
                      <em>{t('c.locked')}</em>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <p className="pp-live" role="status" aria-live="polite">
            {toast}
          </p>
        </Panel>
      )}

      {panel === 'onboarding' && (
        <Panel
          title={t('o.title')}
          closeLabel={t('o.skip')}
          onClose={() => {
            updatePrefs({ onboarded: true });
            setPanel(null);
          }}
          className="ob"
        >
          <ol className="ob-steps" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} data-on={i === step_} />
            ))}
          </ol>
          <h3>
            {step_ + 1}/3 · {t(`o.${step_ + 1}h` as Key)}
          </h3>
          <p>{t(`o.${step_ + 1}` as Key)}</p>
          <div className="st-acts">
            {step_ > 0 && (
              <button type="button" className="hud-btn" onClick={() => setStep(step_ - 1)}>
                {t('o.back')}
              </button>
            )}
            <button
              type="button"
              className="hud-btn hud-primary"
              data-autofocus=""
              onClick={() => {
                if (step_ < 2) return setStep(step_ + 1);
                updatePrefs({ onboarded: true });
                setPanel(null);
              }}
            >
              {step_ < 2 ? t('o.next') : t('o.done')}
            </button>
            <button
              type="button"
              className="hud-btn hud-quiet"
              onClick={() => {
                updatePrefs({ onboarded: true });
                setPanel(null);
              }}
            >
              {t('o.skip')}
            </button>
          </div>
        </Panel>
      )}

      {panel === 'compare' && <Compare t={t} onClose={() => setPanel(null)} onLive={setLiveBox} />}
    </div>
  );
}
