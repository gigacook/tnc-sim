// The workshop as one object the React shell talks to through plain method calls. The render loop, the
// player, the cameras and every per-frame value live here, outside React: nothing in this file sets React
// state per frame, and React never re-renders because a frame was drawn.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Kit, type Solid } from './kit.ts';
import { buildDmc125, buildFil15, buildPortal, type Drive, type Rig } from './machines.ts';
import { buildFigure, type Figure, type FigureSpec } from './people.ts';
import { buildWorld, CORRIDOR, HALL, OFFICE, type World } from './world.ts';
import { RACK, rackTool, STATION_IDS, STATION_MACHINE, type Game, type StationId } from '../game/machine.ts';
import type { TargetId } from '../game/actions.ts';
import type { SimState } from '../../lib/bridge.ts';

export type View = 'walk' | 'overview' | 'orbit';
export type QualityTier = 'low' | 'medium' | 'high';

export interface WorkshopOptions {
  canvas: HTMLCanvasElement;
  quality: QualityTier;
  env: 'cold-steel' | 'workshop-night';
  reducedMotion: boolean;
  /** the thing the player is looking at changed (null = nothing in reach) */
  onTarget(t: TargetId | null): void;
  /** E was pressed on a target */
  onInteract(t: TargetId): void;
  /** pointer lock was taken or released */
  onLock(locked: boolean): void;
}

export interface FrameStats {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface Workshop {
  setGame(g: Game): void;
  setSim(s: SimState | null): void;
  setView(v: View, station?: StationId): void;
  /** sweep the camera to the station's control; `done` runs when it gets there (at once under reduced motion) */
  flyTo(station: StationId, done: () => void): void;
  /** the reverse: start at the control's screen and step back onto the floor */
  flyBack(station: StationId): void;
  /** the list alternative to walking: stand in front of a target, facing it */
  goTo(t: TargetId): void;
  /** stop or resume drawing (machine view on top, tab hidden) */
  setRunning(on: boolean): void;
  /** keyboard and mouse belong to the scene, or to a dialog */
  setInput(on: boolean): void;
  setEnv(env: 'cold-steel' | 'workshop-night'): void;
  setReducedMotion(on: boolean): void;
  setCabinetOpen(open: boolean): void;
  /** put characters in front of the player; `talking` is who speaks, `cheer` raises their arms (0..1) */
  showFigures(specs: FigureSpec[], talking: number, cheer: boolean): void;
  hideFigures(): void;
  lock(): void;
  /** where the player stands and looks (floor coordinates in metres, yaw in radians) */
  pose(): { x: number; z: number; yaw: number };
  stats(): FrameStats;
  resetStats(): void;
  dispose(): void;
}

const PARTICLES: Record<QualityTier, number> = { low: 40, medium: 120, high: 240 };
const EYE = 1.66;
const RADIUS = 0.38;
const OPEN_PHASES = new Set(['doorOpen', 'isolated', 'toolLoose', 'spindleEmpty', 'toolSeated']);
const inside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, m = 0) => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m;

export function createWorkshop(o: WorkshopOptions): Workshop {
  const { canvas } = o;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: o.quality !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.quality === 'low' ? 1 : o.quality === 'medium' ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = o.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 1, 0.08, 80);
  camera.rotation.order = 'YXZ';
  const kit = new Kit(renderer.capabilities.getMaxAnisotropy());
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04);
  scene.environment = envMap.texture;
  scene.environmentIntensity = 0.32;
  room.dispose();

  const world: World = buildWorld(kit, scene, RACK);
  const rigs: Record<StationId, Rig> = { fil15: buildFil15(kit, scene, -6.3, -9.6), dmc125: buildDmc125(kit, scene, -1.7, -9.3) };
  const portal = buildPortal(kit, scene, 5.8, -5.5);
  const solids: Solid[] = [...world.solids, ...rigs.fil15.solids, ...rigs.dmc125.solids, ...portal.solids];
  let env = o.env;
  let still = o.reducedMotion;
  world.setEnv(env, o.quality !== 'low');
  const sun = scene.children.find((c): c is THREE.DirectionalLight => (c as THREE.DirectionalLight).isDirectionalLight);
  if (sun) sun.shadow.mapSize.setScalar(o.quality === 'high' ? 2048 : 1024);

  /* ---- outline, label and floor bracket on the two usable stations ---- */
  const marks = {} as Record<StationId, { lines: THREE.LineSegments; hull: THREE.Mesh; label: THREE.Sprite }>;
  for (const id of STATION_IDS) {
    const b = rigs[id].bounds;
    const size = b.getSize(new THREE.Vector3());
    const mid = b.getCenter(new THREE.Vector3());
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: kit.pal.accent, transparent: true, opacity: 0.5 }));
    lines.position.copy(mid);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(size.x + 0.06, size.y + 0.06, size.z + 0.06), new THREE.MeshBasicMaterial({ color: kit.pal.accent, transparent: true, opacity: 0.1, side: THREE.BackSide, depthWrite: false }));
    hull.position.copy(mid);
    hull.visible = false;
    const tex = kit.plate([id, `TNC ${STATION_MACHINE[id]}`], { w: 512, h: 256, bg: 'hsl(215 30% 8% / 0.86)' });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    label.scale.set(1.5, 0.75, 1);
    label.position.set(mid.x, b.max.y + 0.75, mid.z + size.z / 2);
    label.renderOrder = 5;
    scene.add(lines, hull, label);
    marks[id] = { lines, hull, label };
  }

  /* ---- coolant: a capped pool of points that fall from the nozzle to the tool ---- */
  const N = PARTICLES[o.quality];
  const pPos = new Float32Array(N * 3).fill(-999);
  const pVel = new Float32Array(N * 3);
  const pLife = new Float32Array(N);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: new THREE.Color().setHSL(0.53, 0.5, 0.86), size: 0.022, transparent: true, opacity: 0.85, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  let pNext = 0;
  let pDebt = 0;

  /* ---- state pushed in from the shell ---- */
  let game: Game | null = null;
  let sim: SimState | null = null;
  const drives = {} as Record<StationId, Drive>;
  for (const id of STATION_IDS) drives[id] = { x: 50, y: 50, z: 100, a: 0, b: 0, spindle: false, rpm: 0, door: 0, power: true, tool: true, toolR: 5, toolL: 60, oil: 100, lamp: 'amber' };

  function refreshDrives() {
    if (!game) return;
    for (const id of STATION_IDS) {
      const s = game.stations[id];
      const d = drives[id];
      const live = game.active === id && sim !== null && sim.machine === STATION_MACHINE[id];
      const t = rackTool(s.equipped);
      d.door = OPEN_PHASES.has(s.phase) ? 1 : 0;
      d.power = s.power;
      d.oil = s.oil;
      d.tool = s.equipped !== null && s.phase !== 'spindleEmpty';
      d.toolR = t?.r ?? 5;
      d.toolL = t?.l ?? 60;
      d.spindle = false;
      if (live && sim) {
        if (sim.pos) Object.assign(d, sim.pos);
        d.spindle = sim.spindle.on && s.power;
        d.rpm = sim.spindle.rpm;
      }
      d.lamp = !s.power ? 'off' : d.door > 0 || s.oil <= 0 ? 'red' : live && sim?.running ? 'green' : 'amber';
    }
    for (const [id, node] of world.rackTools) node.visible = game.carrying !== id && !STATION_IDS.some((k) => game!.stations[k].equipped === id);
    world.items.wrench.visible = game.held !== 'wrench';
    world.items.oil.visible = game.held !== 'oil';
    world.items.gauge.visible = game.held !== 'gauge';
  }

  /* ---- player ---- */
  const player = { x: 0.9, z: 5.6, yaw: 0, pitch: -0.04 };
  const keys = new Set<string>();
  let inputOn = true;
  let locked = false;
  let view: View = 'walk';
  let orbitOf: StationId = 'fil15';
  let target: TargetId | null = null;
  let running = true;
  let raf = 0;
  let last = performance.now();
  let clock = 0;

  const walkable = (x: number, z: number) => {
    if (!(inside(HALL, x, z, RADIUS) || inside(OFFICE, x, z, RADIUS) || (x > CORRIDOR.x0 + RADIUS && x < CORRIDOR.x1 - RADIUS && z > HALL.z1 - RADIUS - 0.01 && z < OFFICE.z0 + RADIUS + 0.01))) return false;
    for (const s of solids) if (x > s.x0 - RADIUS && x < s.x1 + RADIUS && z > s.z0 - RADIUS && z < s.z1 + RADIUS) return false;
    return true;
  };
  function move(dx: number, dz: number) {
    // each axis on its own, so the player slides along a wall or a machine instead of stopping dead
    if (walkable(player.x + dx, player.z)) player.x += dx;
    if (walkable(player.x, player.z + dz)) player.z += dz;
  }

  const anchorOf = (t: TargetId): THREE.Vector3 => {
    if (t === 'fil15' || t === 'dmc125') return rigs[t].screen;
    if (t === 'big') return portal.anchor;
    return world.anchors[t];
  };
  const TARGETS: TargetId[] = ['fil15', 'dmc125', 'big', 'rack', 'wrench', 'oil', 'gauge', 'computer', 'cabinet', 'arm'];
  const fwd = new THREE.Vector3();
  const to = new THREE.Vector3();
  function pickTarget(): TargetId | null {
    camera.getWorldDirection(fwd);
    let best: TargetId | null = null;
    let score = 0;
    for (const t of TARGETS) {
      const a = anchorOf(t);
      to.set(a.x - player.x, (a.y - EYE) * 0.35, a.z - player.z);
      const dist = Math.hypot(a.x - player.x, a.z - player.z);
      const reach = t === 'big' || t === 'arm' ? 4.2 : t === 'fil15' || t === 'dmc125' ? 3.2 : 2.6;
      if (dist > reach) continue;
      const facing = to.normalize().dot(fwd);
      if (facing < 0.72) continue;
      const sc = facing * 2 - dist / reach;
      if (sc > score || best === null) {
        best = t;
        score = sc;
      }
    }
    return best;
  }

  /* ---- camera moves ---- */
  type Pose = { p: THREE.Vector3; q: THREE.Quaternion };
  let fly: { from: Pose; to: Pose; t: number; dur: number; done?: () => void } | null = null;
  const lookPose = (p: THREE.Vector3, at: THREE.Vector3): Pose => {
    const m = new THREE.Matrix4().lookAt(p, at, new THREE.Vector3(0, 1, 0));
    return { p: p.clone(), q: new THREE.Quaternion().setFromRotationMatrix(m) };
  };
  const playerPose = (): Pose => ({ p: new THREE.Vector3(player.x, EYE, player.z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')) });
  const overviewPose = () => lookPose(new THREE.Vector3(3.1, 4.05, 7.3), new THREE.Vector3(-2.4, 0.4, -6.0));
  function orbitPose(): Pose {
    const b = rigs[orbitOf].bounds;
    const mid = b.getCenter(new THREE.Vector3());
    const ang = still ? 0.35 : Math.sin(clock * 0.22) * 0.75;
    const r = 4.6;
    const p = new THREE.Vector3(mid.x + Math.sin(ang) * r, 2.5, mid.z + Math.cos(ang) * r);
    p.x = Math.min(HALL.x1 - 0.5, Math.max(HALL.x0 + 0.5, p.x));
    p.z = Math.min(HALL.z1 - 0.5, Math.max(HALL.z0 + 0.5, p.z));
    return lookPose(p, new THREE.Vector3(mid.x, 1.5, mid.z));
  }
  const controlPose = (id: StationId) => lookPose(rigs[id].eye, rigs[id].screen);
  function startFly(toPose: Pose, done?: () => void, dur = 1.1) {
    if (still) {
      camera.position.copy(toPose.p);
      camera.quaternion.copy(toPose.q);
      fly = null;
      done?.();
      return;
    }
    fly = { from: { p: camera.position.clone(), q: camera.quaternion.clone() }, to: toPose, t: 0, dur, done };
  }
  function facePlayer(at: THREE.Vector3) {
    player.yaw = Math.atan2(-(at.x - player.x), -(at.z - player.z));
    player.pitch = Math.max(-0.5, Math.min(0.4, Math.atan2(at.y - EYE, Math.hypot(at.x - player.x, at.z - player.z))));
  }
  /** a free floor spot near `at`, on the side the aisle is */
  function spotNear(at: THREE.Vector3, want: number): { x: number; z: number } {
    for (const r of [want, want + 0.5, want + 1, want + 1.6])
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = at.x + Math.sin(a) * r * (i % 2 ? -1 : 1);
        const z = at.z + Math.cos(a) * r;
        if (walkable(x, z)) return { x, z };
      }
    return { x: player.x, z: player.z };
  }

  /* ---- figures ---- */
  let figures: Figure[] = [];
  let talking = 0;
  let cheer = false;
  let cheerT = 0;
  function clearFigures() {
    for (const f of figures) f.dispose();
    figures = [];
  }

  /* ---- input ---- */
  const typing = (e: Event) => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!inputOn || !running || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    // buttons and links keep their own keys; the scene only listens when the page body or the canvas has focus
    const el = document.activeElement;
    const free = !el || el === document.body || el === canvas;
    if (MOVE_KEYS.has(e.code)) {
      if (!free && e.code.startsWith('Arrow')) return;
      keys.add(e.code);
      if (e.code.startsWith('Arrow') && free) e.preventDefault();
    } else if (e.code === 'KeyE' && !e.repeat && view === 'walk' && !fly && target && (free || locked)) {
      o.onInteract(target);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onMouseMove = (e: MouseEvent) => {
    if (!inputOn || view !== 'walk' || fly) return;
    if (!locked && !dragging) return;
    player.yaw -= e.movementX * 0.0023;
    player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - e.movementY * 0.0023));
  };
  let dragging = false;
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button === 0 && view === 'walk' && inputOn) {
      canvas.focus({ preventScroll: true });
      // a click takes the pointer; if the browser refuses (no gesture, a sandbox), dragging still looks around
      Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
    }
    dragging = true;
  };
  const onPointerUp = () => (dragging = false);
  let touch: { x: number; y: number } | null = null;
  const onTouchMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !dragging || view !== 'walk') return;
    if (touch) {
      player.yaw -= (e.clientX - touch.x) * 0.005;
      player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - (e.clientY - touch.y) * 0.005));
    }
    touch = { x: e.clientX, y: e.clientY };
  };
  const onTouchEnd = () => (touch = null);
  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) keys.clear();
    o.onLock(locked);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onTouchMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerup', onTouchEnd);
  canvas.addEventListener('pointercancel', onTouchEnd);

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 82 : 68; // a phone held upright sees more of the room
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  /* ---- frame statistics: a ring of the last frame times, for the measured numbers in the test report ---- */
  const ring = new Float32Array(1200);
  let ringN = 0;

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const rawMs = now - last;
    last = now;
    const dt = Math.min(rawMs / 1000, 0.1);
    clock += dt;
    ring[ringN++ % ring.length] = rawMs;

    if (view === 'walk' && !fly && inputOn) {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5.2 : 3.1) * dt;
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
      player.yaw += turn * dt * 1.9;
      if (f || s) {
        const n = 1 / Math.hypot(f, s);
        const sin = Math.sin(player.yaw);
        const cos = Math.cos(player.yaw);
        move((-sin * f + cos * s) * n * speed, (-cos * f - sin * s) * n * speed);
      }
    }

    if (fly) {
      fly.t = Math.min(1, fly.t + dt / fly.dur);
      const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
      camera.position.lerpVectors(fly.from.p, fly.to.p, e);
      camera.quaternion.slerpQuaternions(fly.from.q, fly.to.q, e);
      if (fly.t >= 1) {
        const done = fly.done;
        fly = null;
        done?.();
      }
    } else if (view === 'walk') {
      camera.position.set(player.x, EYE, player.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
    } else if (view === 'orbit') {
      const p = orbitPose();
      camera.position.copy(p.p);
      camera.quaternion.copy(p.q);
    }

    const t = view === 'walk' && !fly ? pickTarget() : null;
    if (t !== target) {
      target = t;
      o.onTarget(t);
    }
    for (const id of STATION_IDS) {
      rigs[id].drive(drives[id], dt);
      const m = marks[id];
      const hot = target === id;
      m.hull.visible = hot;
      (m.lines.material as THREE.LineBasicMaterial).opacity = hot ? 1 : still ? 0.5 : 0.38 + Math.sin(clock * 2.2) * 0.14;
    }
    world.update(dt, clock, still);

    // coolant particles: only while the simulator says coolant is on and the program runs
    const act = game?.active ?? null;
    const wet = !!act && !!sim && sim.coolant && sim.running && sim.machine === STATION_MACHINE[act] && game!.stations[act].power;
    if (wet && act) {
      rigs[act].nozzle.getWorldPosition(tmp);
      rigs[act].tip.getWorldPosition(tmp2);
      pDebt += dt * N * 1.6;
      tmp2.sub(tmp).multiplyScalar(4.5); // toward the tool, fast enough to arrive within a particle's life
      while (pDebt >= 1) {
        pDebt -= 1;
        const i = pNext++ % N;
        pPos.set([tmp.x, tmp.y, tmp.z], i * 3);
        pVel.set([tmp2.x + (kit.rnd() - 0.5) * 0.5, tmp2.y, tmp2.z + (kit.rnd() - 0.5) * 0.5], i * 3);
        pLife[i] = 0.55;
      }
    }
    let alive = false;
    for (let i = 0; i < N; i++) {
      if (pLife[i] <= 0) continue;
      alive = true;
      pLife[i] -= dt;
      pVel[i * 3 + 1] -= 6 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pLife[i] <= 0) pPos[i * 3 + 1] = -999;
    }
    if (alive || wet) pGeo.attributes.position.needsUpdate = true;

    if (figures.length) {
      cheerT += ((cheer ? 1 : 0) - cheerT) * Math.min(1, dt * (still ? 60 : 5));
      figures.forEach((f, i) => {
        f.pose(clock + i * 1.7, { talking: i === talking, cheer: cheerT, still });
      });
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  const api: Workshop = {
    setGame(g) {
      game = g;
      refreshDrives();
    },
    setSim(s) {
      sim = s;
      refreshDrives();
    },
    setView(v, station) {
      if (station) orbitOf = station;
      else if (v === 'orbit') orbitOf = Math.hypot(player.x - rigs.fil15.stand.x, player.z - rigs.fil15.stand.z) < Math.hypot(player.x - rigs.dmc125.stand.x, player.z - rigs.dmc125.stand.z) ? 'fil15' : 'dmc125';
      if (v !== 'walk' && document.pointerLockElement === canvas) document.exitPointerLock();
      keys.clear();
      const prev = view;
      view = v;
      if (prev === v && v !== 'orbit') return;
      startFly(v === 'walk' ? playerPose() : v === 'overview' ? overviewPose() : orbitPose(), undefined, 0.9);
    },
    flyTo(station, done) {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      keys.clear();
      const r = rigs[station];
      player.x = r.stand.x;
      player.z = r.stand.z;
      facePlayer(r.screen);
      view = 'walk';
      startFly(controlPose(station), done, 1.1);
    },
    flyBack(station) {
      const r = rigs[station];
      const c = controlPose(station);
      camera.position.copy(c.p);
      camera.quaternion.copy(c.q);
      player.x = r.stand.x;
      player.z = r.stand.z;
      facePlayer(r.screen);
      view = 'walk';
      startFly(playerPose(), undefined, 1.0);
    },
    goTo(t) {
      const a = anchorOf(t);
      const st = t === 'fil15' || t === 'dmc125' ? { x: rigs[t].stand.x, z: rigs[t].stand.z } : spotNear(a, t === 'big' || t === 'arm' ? 2.6 : 1.5);
      player.x = st.x;
      player.z = st.z;
      facePlayer(a);
      view = 'walk';
      startFly(playerPose(), undefined, 0.8);
    },
    setRunning(on) {
      if (on === running) return;
      running = on;
      keys.clear();
      cancelAnimationFrame(raf);
      if (on) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    setInput(on) {
      inputOn = on;
      if (!on) {
        keys.clear();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }
    },
    setEnv(e) {
      env = e;
      world.setEnv(env, o.quality !== 'low');
    },
    setReducedMotion(on) {
      still = on;
    },
    setCabinetOpen: (open) => world.setCabinetOpen(open),
    showFigures(specs, who, hi) {
      talking = who;
      cheer = hi;
      if (figures.length === specs.length) return; // the same scene, only the speaker changed
      clearFigures();
      cheerT = 0;
      const ahead = new THREE.Vector3(player.x - Math.sin(player.yaw) * 2.3, 0, player.z - Math.cos(player.yaw) * 2.3);
      const near = spotNear(new THREE.Vector3(player.x, 0, player.z), 1.9);
      const spot = walkable(ahead.x, ahead.z) ? ahead : new THREE.Vector3(near.x, 0, near.z);
      const side = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      specs.forEach((sp, i) => {
        const f = buildFigure(sp);
        const off = specs.length > 1 ? (i === 0 ? -0.42 : 0.42) : 0;
        f.root.position.set(spot.x + side.x * off, 0, spot.z + side.z * off);
        // one figure faces the player; two stand turned toward each other
        const face = Math.atan2(player.x - f.root.position.x, player.z - f.root.position.z);
        f.root.rotation.y = specs.length > 1 ? face + (i === 0 ? -1 : 1) * 0.9 : face;
        scene.add(f.root);
        figures.push(f);
      });
      // turn to them, also when the camera is still on its way back from a control
      if (view === 'walk') {
        facePlayer(new THREE.Vector3(spot.x, 1.45, spot.z));
        startFly(playerPose(), undefined, 0.6);
      }
    },
    hideFigures: clearFigures,
    lock() {
      canvas.focus({ preventScroll: true });
      Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
    },
    pose: () => ({ x: player.x, z: player.z, yaw: player.yaw }),
    stats() {
      const n = Math.min(ringN, ring.length);
      const a = Array.from(ring.subarray(0, n)).sort((x, y) => x - y);
      return { frames: n, avgMs: n ? a.reduce((s, v) => s + v, 0) / n : 0, p95Ms: n ? a[Math.min(n - 1, Math.floor(n * 0.95))] : 0, maxMs: n ? a[n - 1] : 0 };
    },
    resetStats() {
      ringN = 0;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onTouchMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerup', onTouchEnd);
      canvas.removeEventListener('pointercancel', onTouchEnd);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      clearFigures();
      kit.dispose(scene);
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
  return api;
}
