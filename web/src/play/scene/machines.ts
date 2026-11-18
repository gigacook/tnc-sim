// The three shop machines, built from original procedural geometry. They are fictional: "fil15" is an old
// knee mill with a TNC 426, "dmc125" an enclosed swivel-head machining centre with a TNC 430, "PORTAL 9" a
// larger portal mill that only stands there. No dimension here describes a real machine.
// A rig is moved by `drive()`, whose numbers come from the one simulator (tnc:state), never from a baked animation.
import * as THREE from 'three';
import { hsl, solid, type Kit, type Solid } from './kit.ts';

/** What a usable station shows; the values come from the simulator's state and the game state. */
export interface Drive {
  /** programmed position, mm and degrees */
  x: number;
  y: number;
  z: number;
  a: number;
  b: number;
  spindle: boolean;
  rpm: number;
  /** 0 closed .. 1 open */
  door: number;
  power: boolean;
  /** a tool is in the spindle */
  tool: boolean;
  toolR: number;
  toolL: number;
  /** service oil 0..100 */
  oil: number;
  /** stack light: which lamp is lit */
  lamp: 'green' | 'amber' | 'red' | 'off';
}

export interface Rig {
  root: THREE.Group;
  solids: Solid[];
  /** floor spot in front of the control, and where the eyes go to read the screen (world) */
  stand: THREE.Vector3;
  eye: THREE.Vector3;
  screen: THREE.Vector3;
  /** what the outline wraps */
  bounds: THREE.Box3;
  /** where coolant leaves the nozzle (a node; read its world position) */
  nozzle: THREE.Object3D;
  /** tool tip node (world position = where the coolant goes) */
  tip: THREE.Object3D;
  drive(d: Drive, dt: number): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** move `cur` toward `to` with a time constant; the simulator reports 10 times a second, the picture runs at 60 */
const ease = (cur: number, to: number, dt: number, rate = 12) => cur + (to - cur) * Math.min(1, dt * rate);
const RAD = Math.PI / 180;

/** green / amber / red stack light with a non-colour cue: only one lamp is lit and they sit in a fixed order */
function stackLight(k: Kit, parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = k.group(parent, x, y, z);
  k.cyl(g, 0.018, 0.018, 0.3, k.darkSteel, 0, -0.15, 0, 'y', 8);
  const lamps = (['red', 'amber', 'green'] as const).map((name, i) => {
    const c = name === 'red' ? k.pal.danger : name === 'amber' ? k.pal.warning : k.pal.success;
    const m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.35), emissive: c, emissiveIntensity: 0, roughness: 0.3 });
    const mesh = k.cyl(g, 0.045, 0.045, 0.07, m, 0, 0.26 - i * 0.08, 0, 'y', 12);
    mesh.castShadow = false;
    return { name, m };
  });
  k.cyl(g, 0.05, 0.05, 0.02, k.darkSteel, 0, 0.31, 0, 'y', 12);
  return (lit: Drive['lamp']) => {
    for (const l of lamps) l.m.emissiveIntensity = l.name === lit ? 2.2 : 0;
  };
}

/** rotary main switch: the handle turns a quarter when the power is off */
function mainSwitch(k: Kit, parent: THREE.Object3D, x: number, y: number, z: number, ry: number) {
  const g = k.group(parent, x, y, z);
  g.rotation.y = ry;
  k.box(g, 0.3, 0.44, 0.12, k.shellDark);
  k.box(g, 0.16, 0.16, 0.02, k.std('switchPlate', k.pal.warning, 0.6, 0.1), 0, 0.04, 0.07);
  const h = k.group(g, 0, 0.04, 0.09);
  k.box(h, 0.05, 0.15, 0.04, k.std('switchHandle', k.pal.danger, 0.5, 0.1));
  return (on: boolean, dt: number) => (h.rotation.z = ease(h.rotation.z, on ? 0 : Math.PI / 2, dt, 10));
}

/** a small oil unit with a sight glass whose column follows the service-oil level */
function oilUnit(k: Kit, parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = k.group(parent, x, y, z);
  k.box(g, 0.26, 0.36, 0.22, k.darkSteel);
  k.cyl(g, 0.035, 0.035, 0.05, k.std('oilCap', k.pal.warning, 0.5, 0.2), 0.06, 0.2, 0, 'y', 10);
  k.box(g, 0.05, 0.26, 0.012, k.plastic, -0.05, 0, 0.115);
  const col = k.box(g, 0.036, 0.24, 0.012, k.std('oilAmber', hsl(38, 90, 48), 0.3, 0, { emissive: hsl(38, 90, 30), emissiveIntensity: 0.6 }), -0.05, 0, 0.12);
  col.castShadow = false;
  return (oil: number) => {
    const f = clamp(oil / 100, 0.02, 1);
    col.scale.y = f;
    col.position.y = -0.12 + 0.12 * f;
  };
}

/** holder + cutter; the cutter takes the equipped tool's radius and length */
function toolGroup(k: Kit, parent: THREE.Object3D) {
  const g = k.group(parent);
  k.cyl(g, 0.045, 0.03, 0.09, k.darkSteel, 0, -0.045, 0, 'y', 16);
  const cutter = k.cyl(g, 1, 1, 1, k.ground, 0, -0.14, 0, 'y', 12);
  const tip = k.group(g, 0, -0.19, 0);
  return {
    g,
    tip,
    set(d: Drive, dt: number) {
      g.visible = d.tool;
      const len = clamp(d.toolL / 1000, 0.03, 0.12);
      const r = clamp(d.toolR / 1000, 0.003, 0.03);
      cutter.scale.set(r, len, r);
      cutter.position.y = -0.09 - len / 2;
      tip.position.y = -0.09 - len;
      if (d.spindle && d.tool) g.rotation.y += dt * clamp(d.rpm, 300, 6000) * 0.0105; // rad/s = rpm * 2pi/60, shown at a tenth so it does not strobe
    },
  };
}

function pendant(k: Kit, parent: THREE.Object3D, title: string, rows: string[]) {
  const g = k.group(parent);
  k.box(g, 0.62, 0.74, 0.12, k.shellDark);
  k.box(g, 0.66, 0.78, 0.06, k.plastic, 0, 0, -0.04);
  const screen = k.sign(g, 0.5, 0.375, k.screen(title, rows), 0, 0.13, 0.062, 0.85);
  const keys = k.canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = 'hsl(215 12% 16%)';
    c.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++)
      for (let i = 0; i < 10; i++) {
        c.fillStyle = i > 7 && r > 1 ? 'hsl(36 80% 50%)' : i === 9 && r === 0 ? 'hsl(3 70% 50%)' : 'hsl(210 8% 68%)';
        c.fillRect(8 + i * 24.4, 8 + r * 29, 19, 23);
      }
  });
  k.sign(g, 0.5, 0.22, keys, 0, -0.22, 0.062);
  return { g, screen };
}

/* ------------------------------------------------------------------ fil15 */
export function buildFil15(k: Kit, parent: THREE.Object3D, x: number, z: number): Rig {
  const root = k.group(parent, x, 0, z);
  k.box(root, 1.5, 0.3, 1.9, k.castDark, 0, 0.15, 0);
  k.box(root, 1.3, 0.12, 1.7, k.cast, 0, 0.36, 0);
  k.box(root, 0.9, 2.0, 0.85, k.cast, 0, 1.4, -0.5);
  k.box(root, 0.7, 0.5, 0.18, k.castDark, 0, 0.75, -0.02); // dovetail the knee rides on
  k.box(root, 0.8, 0.52, 1.0, k.cast, 0, 0.84, 0.36);
  k.cyl(root, 0.045, 0.045, 0.5, k.ground, 0, 0.5, 0.5, 'y', 12);
  // ram, head, motor
  k.box(root, 0.52, 0.36, 1.5, k.cast, 0, 2.56, 0.1);
  k.box(root, 0.46, 0.72, 0.5, k.cast, 0, 2.24, 0.8);
  k.box(root, 0.5, 0.16, 0.9, k.castDark, 0, 2.82, 0.6);
  k.cyl(root, 0.17, 0.17, 0.46, k.darkSteel, 0, 3.12, 0.3, 'y', 18);
  k.cyl(root, 0.19, 0.19, 0.05, k.cast, 0, 3.36, 0.3, 'y', 18);
  k.sign(root, 0.4, 0.14, k.plate(['fil15'], { w: 384, h: 128 }), 0, 2.38, 1.052);
  k.sign(root, 0.3, 0.1, k.plate(['FIL 15  ·  5511'], { w: 384, h: 128, mono: true }), 0, 0.2, 0.952);

  // saddle (Y axis: toward / away from the operator) and table (X axis)
  const saddle = k.group(root, 0, 1.17, 0.36);
  k.box(saddle, 0.75, 0.14, 0.86, k.castDark);
  const table = k.group(saddle, 0, 0.13, 0);
  k.box(table, 1.7, 0.12, 0.42, k.ground);
  for (const tz of [-0.12, 0, 0.12]) k.box(table, 1.7, 0.012, 0.03, k.darkSteel, 0, 0.061, tz);
  k.box(table, 0.34, 0.07, 0.22, k.castDark, 0, 0.095, 0);
  k.box(table, 0.05, 0.09, 0.2, k.steel, -0.1, 0.17, 0);
  k.box(table, 0.05, 0.09, 0.2, k.steel, 0.1, 0.17, 0);
  k.box(table, 0.15, 0.08, 0.12, k.std('alu', hsl(210, 6, 80), 0.3, 0.9), 0, 0.17, 0); // the clamped workpiece: never rotated
  for (const sx of [-1, 1]) {
    const wheel = new THREE.Mesh(k.geo('wheel', () => new THREE.TorusGeometry(0.11, 0.014, 8, 20)), k.ground);
    wheel.position.set(sx * 0.93, 0, 0);
    wheel.rotation.y = Math.PI / 2;
    table.add(wheel);
    k.cyl(table, 0.02, 0.02, 0.12, k.darkSteel, sx * 0.88, 0, 0, 'x', 8);
  }
  // splash guard: sheet-metal tray and walls on the knee, a polycarbonate front that swings open
  const guard = k.group(root, 0, 1.08, 0.36);
  k.box(guard, 2.1, 0.03, 1.3, k.shellDark, 0, 0, 0);
  k.box(guard, 2.1, 0.7, 0.025, k.shell, 0, 0.36, -0.64);
  k.box(guard, 0.025, 0.7, 1.3, k.shell, -1.05, 0.36, 0);
  k.box(guard, 0.025, 0.7, 1.3, k.shell, 1.05, 0.36, 0);
  const door = k.group(guard, -1.05, 0.02, 0.65);
  k.box(door, 2.1, 0.7, 0.02, k.glass, 1.05, 0.35, 0).castShadow = false;
  k.box(door, 2.1, 0.04, 0.03, k.steel, 1.05, 0.7, 0);
  k.box(door, 0.04, 0.2, 0.05, k.darkSteel, 1.98, 0.4, 0.03);

  // quill (Z axis) and tool
  const quill = k.group(root, 0, 1.92, 0.8);
  k.cyl(quill, 0.075, 0.075, 0.52, k.ground, 0, 0.14, 0, 'y', 18);
  k.cyl(quill, 0.09, 0.07, 0.07, k.darkSteel, 0, -0.14, 0, 'y', 18);
  const tool = toolGroup(k, k.group(quill, 0, -0.17, 0));

  // coolant: tank at the base, hose up the column, a jointed nozzle at the head
  k.box(root, 0.5, 0.42, 0.7, k.shellDark, -1.05, 0.21, -0.4);
  k.cyl(root, 0.06, 0.06, 0.16, k.darkSteel, -1.05, 0.5, -0.5, 'y', 12);
  k.tube(root, [[-1.05, 0.56, -0.5], [-0.75, 1.3, -0.3], [-0.5, 2.2, 0.2], [-0.3, 2.05, 0.7], [-0.14, 1.72, 0.82]], 0.016, k.coolantBlue);
  const nozzle = k.group(root, -0.14, 1.7, 0.82);
  k.cyl(nozzle, 0.012, 0.018, 0.1, k.accent, 0.02, -0.04, 0, 'y', 8).rotation.z = -0.5;

  // control on a post to the right, switch and oil unit on the column side
  k.cyl(root, 0.035, 0.035, 1.5, k.darkSteel, 1.45, 0.75, 0.75, 'y', 10);
  k.cyl(root, 0.16, 0.16, 0.03, k.darkSteel, 1.45, 0.015, 0.75, 'y', 14);
  const pend = pendant(k, root, 'TNC 426', ['0 BEGIN PGM FIL15 MM', '1 BLK FORM 0.1 Z', '2 TOOL CALL 1 Z S2500', '3 L Z+100 R0 FMAX', '4 L X+0 Y+0 FMAX M3', '5 L Z-5 F200', '6 END PGM FIL15 MM']);
  pend.g.position.set(1.45, 1.52, 0.78);
  pend.g.rotation.set(-0.12, -0.35, 0);
  const lamp = stackLight(k, root, 1.45, 2.05, 0.75);
  const sw = mainSwitch(k, root, 0.46, 1.25, -0.5, Math.PI / 2);
  const oil = oilUnit(k, root, 0.6, 0.55, 0.2);
  k.tube(root, [[0.2, 2.4, -0.9], [0.5, 3.6, -1.2], [0.3, 4.7, -1.6]], 0.02, k.rubber); // supply cable to the tray above

  root.updateMatrixWorld(true);
  const screen = pend.screen.getWorldPosition(new THREE.Vector3());
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(pend.g.getWorldQuaternion(new THREE.Quaternion()));
  const eye = screen.clone().addScaledVector(facing, 0.75);
  const cur = { x: 0, y: 0, z: 0, door: 0 };
  return {
    root,
    solids: [solid(x, z - 0.05, 2.3, 2.0), solid(x + 1.45, z + 0.75, 0.5, 0.4), solid(x - 1.05, z - 0.4, 0.6, 0.8)],
    stand: new THREE.Vector3(eye.x + facing.x * 0.9, 0, eye.z + facing.z * 0.9),
    eye,
    screen,
    bounds: new THREE.Box3(new THREE.Vector3(x - 1.2, 0, z - 1.0), new THREE.Vector3(x + 1.75, 3.4, z + 1.1)),
    nozzle,
    tip: tool.tip,
    drive(d, dt) {
      // a knee mill moves the work under the tool: the table goes the other way, 1 mm on the control = 1 mm here
      cur.x = ease(cur.x, clamp(-(d.x - 50) / 1000, -0.35, 0.35), dt);
      cur.y = ease(cur.y, clamp((d.y - 50) / 1000, -0.2, 0.2), dt);
      cur.z = ease(cur.z, clamp(d.z / 1000, -0.06, 0.2), dt);
      cur.door = ease(cur.door, d.door, dt, 5);
      table.position.x = cur.x;
      saddle.position.z = 0.36 + cur.y;
      quill.position.y = 1.92 + cur.z;
      door.rotation.y = -cur.door * 1.9;
      tool.set(d, dt);
      lamp(d.lamp);
      sw(d.power, dt);
      oil(d.oil);
      (pend.screen.material as THREE.MeshStandardMaterial).emissiveIntensity = d.power ? 0.85 : 0.02;
    },
  };
}

/* ------------------------------------------------------------------ dmc125 */
export function buildDmc125(k: Kit, parent: THREE.Object3D, x: number, z: number): Rig {
  const root = k.group(parent, x, 0, z);
  const W = 3.2;
  const D = 3.0;
  k.box(root, W, 0.3, D, k.shellDark, 0, 0.15, 0);
  // enclosure
  k.box(root, W, 2.4, 0.05, k.shell, 0, 1.5, -D / 2 + 0.025);
  k.box(root, 0.05, 2.4, D, k.shell, -W / 2 + 0.025, 1.5, 0);
  k.box(root, 0.05, 2.4, D, k.shell, W / 2 - 0.025, 1.5, 0);
  k.box(root, W, 0.06, D, k.shell, 0, 2.73, 0);
  k.box(root, W + 0.04, 0.22, 0.08, k.accent, 0, 2.6, D / 2 + 0.01); // fascia stripe
  k.box(root, W, 0.62, 0.05, k.shell, 0, 0.61, D / 2 - 0.025); // apron under the door
  k.box(root, 1.1, 1.6, 0.05, k.shell, -1.05, 1.7, D / 2 - 0.025);
  k.box(root, 0.6, 1.6, 0.05, k.shell, 1.3, 1.7, D / 2 - 0.025);
  k.sign(root, 0.8, 0.26, k.plate(['dmc125'], { w: 512, h: 160 }), -1.05, 2.1, D / 2 + 0.002);
  k.sign(root, 0.5, 0.12, k.plate(['DMC 125  ·  5511'], { w: 512, h: 128, mono: true }), -1.05, 1.82, D / 2 + 0.002);
  // sliding door with a window
  const door = k.group(root, 0.25, 1.7, D / 2 + 0.03);
  k.box(door, 1.5, 1.6, 0.04, k.glass).castShadow = false;
  for (const [w, h, px, py] of [[1.5, 0.08, 0, 0.76], [1.5, 0.08, 0, -0.76], [0.08, 1.6, -0.71, 0], [0.08, 1.6, 0.71, 0]] as const) k.box(door, w, h, 0.06, k.shellDark, px, py, 0);
  k.box(door, 0.04, 0.5, 0.06, k.steel, 0.6, 0, 0.05);

  // inside: bed, table with a vice and the clamped workpiece
  k.box(root, 2.6, 0.55, 2.2, k.castDark, 0, 0.58, -0.1);
  k.cyl(root, 0.55, 0.6, 0.14, k.ground, 0, 0.93, 0.35, 'y', 28);
  for (const tx of [-0.25, 0, 0.25]) k.box(root, 0.03, 0.012, 1.0, k.darkSteel, tx, 1.004, 0.35);
  k.box(root, 0.34, 0.07, 0.22, k.castDark, 0, 1.04, 0.35);
  k.box(root, 0.05, 0.09, 0.2, k.steel, -0.1, 1.11, 0.35);
  k.box(root, 0.05, 0.09, 0.2, k.steel, 0.1, 1.11, 0.35);
  k.box(root, 0.15, 0.08, 0.12, k.std('alu', hsl(210, 6, 80), 0.3, 0.9), 0, 1.11, 0.35);
  // travelling column (X), ram (Y), slide (Z), swivel head: B outer yoke carries A inner cartridge
  const col = k.group(root, 0, 0, -0.95);
  k.box(col, 0.75, 1.75, 0.6, k.cast, 0, 1.72, 0);
  const ram = k.group(col, 0, 2.2, 0.2);
  k.box(ram, 0.46, 0.44, 1.5, k.cast, 0, 0, 0.3);
  const slide = k.group(ram, 0, -0.1, 1.1);
  k.box(slide, 0.4, 0.62, 0.36, k.castDark, 0, 0, 0);
  const yokeB = k.group(slide, 0, -0.42, 0);
  k.cyl(yokeB, 0.2, 0.2, 0.14, k.darkSteel, 0, 0.06, 0, 'y', 20);
  k.box(yokeB, 0.06, 0.34, 0.22, k.cast, -0.17, -0.14, 0);
  k.box(yokeB, 0.06, 0.34, 0.22, k.cast, 0.17, -0.14, 0);
  const cartA = k.group(yokeB, 0, -0.2, 0);
  k.cyl(cartA, 0.11, 0.11, 0.3, k.shell, 0, 0, 0, 'y', 18);
  k.cyl(cartA, 0.09, 0.06, 0.08, k.darkSteel, 0, -0.19, 0, 'y', 18);
  const tool = toolGroup(k, k.group(cartA, 0, -0.23, 0));
  const nozzle = k.group(cartA, 0.12, -0.16, 0.06);
  k.cyl(nozzle, 0.01, 0.016, 0.1, k.accent, 0, -0.03, 0, 'y', 8).rotation.z = 0.5;
  k.tube(col, [[0.3, 2.5, 0], [0.5, 2.9, 0.4], [0.2, 2.5, 1.0]], 0.02, k.coolantBlue);

  // chip conveyor and bin on the right, coolant tank with pump on the left, electrical cabinet behind
  const conv = k.box(root, 0.5, 0.3, 1.9, k.shellDark, W / 2 + 0.75, 0.75, -0.3);
  conv.rotation.z = -0.55;
  conv.rotation.y = Math.PI / 2;
  k.box(root, 0.7, 0.6, 0.7, k.std('bin', hsl(213, 30, 28), 0.6, 0.3), W / 2 + 1.45, 0.3, -0.3);
  k.box(root, 0.7, 0.5, 1.4, k.shellDark, -W / 2 - 0.4, 0.25, -0.5);
  k.cyl(root, 0.09, 0.09, 0.36, k.accent, -W / 2 - 0.4, 0.68, -0.9, 'y', 14);
  k.tube(root, [[-W / 2 - 0.4, 0.86, -0.9], [-W / 2 - 0.2, 1.8, -1.2], [-W / 2 + 0.3, 2.8, -1.1], [-0.4, 2.85, -1.0]], 0.022, k.coolantBlue);
  k.box(root, 1.3, 2.3, 0.5, k.shellDark, 0.6, 1.15, -D / 2 - 0.27);
  k.tube(root, [[0.6, 2.3, -D / 2 - 0.3], [0.9, 3.5, -D / 2 - 0.6], [0.8, 4.7, -D / 2 - 0.9]], 0.03, k.rubber);

  // control on a swing arm at the right of the door
  k.box(root, 0.5, 0.06, 0.06, k.darkSteel, W / 2 + 0.2, 2.0, D / 2 + 0.1);
  k.box(root, 0.06, 0.5, 0.06, k.darkSteel, W / 2 + 0.42, 1.78, D / 2 + 0.1);
  const pend = pendant(k, root, 'TNC 430', ['0 BEGIN PGM DMC125 MM', '1 BLK FORM 0.1 Z', '2 TOOL CALL 3 Z S3000', '3 L Z+150 R0 FMAX', '4 L B+30 A-20 FMAX', '5 CYCL DEF 19.0', '6 END PGM DMC125 MM']);
  pend.g.position.set(W / 2 + 0.42, 1.5, D / 2 + 0.2);
  pend.g.rotation.set(-0.1, -0.5, 0);
  const lamp = stackLight(k, root, W / 2 - 0.2, 3.06, D / 2 - 0.2);
  const sw = mainSwitch(k, root, W / 2 + 0.06, 1.3, 0.6, Math.PI / 2);
  const oil = oilUnit(k, root, -W / 2 - 0.16, 0.6, 1.1);

  root.updateMatrixWorld(true);
  const screen = pend.screen.getWorldPosition(new THREE.Vector3());
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(pend.g.getWorldQuaternion(new THREE.Quaternion()));
  const eye = screen.clone().addScaledVector(facing, 0.75);
  const cur = { x: 0, y: 0, z: 0, a: 0, b: 0, door: 0 };
  return {
    root,
    solids: [solid(x, z, W + 0.1, D + 0.1), solid(x + W / 2 + 1.0, z - 0.3, 1.7, 0.8), solid(x - W / 2 - 0.4, z - 0.5, 0.8, 1.5), solid(x + 0.6, z - D / 2 - 0.27, 1.4, 0.6), solid(x + W / 2 + 0.42, z + D / 2 + 0.2, 0.5, 0.3)],
    stand: new THREE.Vector3(eye.x + facing.x * 0.9, 0, eye.z + facing.z * 0.9),
    eye,
    screen,
    bounds: new THREE.Box3(new THREE.Vector3(x - W / 2 - 0.05, 0, z - D / 2 - 0.05), new THREE.Vector3(x + W / 2 + 0.75, 2.8, z + D / 2 + 0.3)),
    nozzle,
    tip: tool.tip,
    drive(d, dt) {
      cur.x = ease(cur.x, clamp((d.x - 50) / 1000, -0.6, 0.6), dt);
      cur.y = ease(cur.y, clamp(-(d.y - 50) / 1000, -0.35, 0.35), dt);
      cur.z = ease(cur.z, clamp(d.z / 1000, -0.08, 0.3), dt);
      cur.a = ease(cur.a, clamp(d.a, -120, 30) * RAD, dt, 8);
      cur.b = ease(cur.b, clamp(d.b, -120, 120) * RAD, dt, 8);
      cur.door = ease(cur.door, d.door, dt, 5);
      col.position.x = cur.x;
      ram.position.z = 0.2 + cur.y;
      slide.position.y = -0.1 + cur.z;
      // B+ tips the tool toward X+, A+ toward Y+ (away from the operator), as on the 430 profile
      yokeB.rotation.z = cur.b;
      cartA.rotation.x = cur.a;
      door.position.x = 0.25 - cur.door * 1.2;
      tool.set(d, dt);
      lamp(d.lamp);
      sw(d.power, dt);
      oil(d.oil);
      (pend.screen.material as THREE.MeshStandardMaterial).emissiveIntensity = d.power ? 0.85 : 0.02;
    },
  };
}

/* ------------------------------------------------------------------ PORTAL 9 (background, not a simulator) */
export function buildPortal(k: Kit, parent: THREE.Object3D, x: number, z: number): { root: THREE.Group; solids: Solid[]; anchor: THREE.Vector3 } {
  const root = k.group(parent, x, 0, z);
  root.rotation.y = -Math.PI / 2; // its long side lies along the aisle, its front faces the aisle
  const L = 6.6;
  k.box(root, L, 0.7, 1.9, k.castDark, 0, 0.35, 0);
  k.box(root, L - 0.8, 0.18, 1.5, k.ground, 0, 0.79, 0);
  for (const tz of [-0.5, -0.25, 0, 0.25, 0.5]) k.box(root, L - 0.8, 0.012, 0.035, k.darkSteel, 0, 0.885, tz);
  const bellows = k.std('bellows', hsl(215, 10, 14), 0.8, 0.1, { map: k.cladding(14, [10, 1]) });
  k.box(root, 1.2, 0.3, 1.7, bellows, -L / 2 + 0.7, 0.95, 0);
  k.box(root, 1.2, 0.3, 1.7, bellows, L / 2 - 0.7, 0.95, 0);
  // the portal: two columns, a crossbeam, a saddle and a long ram with a face mill
  const portal = k.group(root, 0.9, 0, 0);
  for (const s of [-1, 1]) {
    k.box(portal, 0.7, 3.3, 0.75, k.cast, 0, 1.65, s * 1.5);
    k.box(portal, 0.9, 0.25, 0.95, k.castDark, 0, 0.12, s * 1.5);
  }
  k.box(portal, 0.85, 0.85, 3.8, k.cast, 0, 3.6, 0);
  k.box(portal, 0.2, 0.5, 3.6, k.ground, -0.5, 3.6, 0);
  k.box(portal, 0.75, 1.0, 0.8, k.castDark, -0.72, 3.5, 0.3);
  k.box(portal, 0.5, 1.9, 0.5, k.cast, -0.72, 2.6, 0.3);
  k.cyl(portal, 0.16, 0.16, 0.26, k.darkSteel, -0.72, 1.55, 0.3, 'y', 20);
  k.cyl(portal, 0.24, 0.24, 0.1, k.ground, -0.72, 1.38, 0.3, 'y', 24);
  k.tube(portal, [[0, 4.05, -1.6], [-0.3, 4.6, -0.6], [-0.6, 4.3, 0.2], [-0.72, 4.0, 0.3]], 0.05, k.rubber);
  // a welded frame waiting on the table
  const part = k.std('weldment', hsl(25, 18, 30), 0.7, 0.6);
  k.box(root, 2.2, 0.14, 0.14, part, -1.3, 0.96, -0.45);
  k.box(root, 2.2, 0.14, 0.14, part, -1.3, 0.96, 0.45);
  for (const px of [-2.33, -1.3, -0.27]) k.box(root, 0.14, 0.14, 0.9, part, px, 0.96, 0);
  // cabinets behind, steps at one end, a guard fence toward the aisle with posts in the warning colour
  for (let i = 0; i < 3; i++) k.box(root, 1.05, 2.3, 0.6, k.shellDark, -2.2 + i * 1.1, 1.15, -1.75);
  k.sign(root, 0.9, 0.3, k.plate(['PORTAL 9'], { w: 512, h: 170 }), -1.1, 1.95, -1.445);
  for (let i = 0; i < 3; i++) k.box(root, 0.9, 0.06, 0.3, k.darkSteel, -L / 2 - 0.2 - 0.0, 0.2 + i * 0.2, 1.2 - i * 0.3);
  const post = k.std('post', k.pal.warning, 0.6, 0.2);
  const mesh = k.mat('mesh', () => new THREE.MeshStandardMaterial({ color: hsl(215, 10, 20), roughness: 0.7, metalness: 0.6, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  for (let i = 0; i <= 4; i++) {
    k.box(root, 0.07, 1.5, 0.07, post, -L / 2 + 0.2 + i * 1.55, 0.75, 2.0);
    if (i < 4 && i !== 2) k.box(root, 1.48, 1.2, 0.02, mesh, -L / 2 + 0.975 + i * 1.55, 0.8, 2.0).castShadow = false;
  }
  const pend = pendant(k, root, 'PORTAL 9', ['AVSTÄLLD', '', 'VÄNTAR PÅ SERVICE']);
  pend.g.position.set(2.75, 1.5, 2.05);
  (pend.screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
  k.cyl(root, 0.03, 0.03, 1.5, k.darkSteel, 2.75, 0.75, 1.98, 'y', 8);
  stackLight(k, root, 2.75, 2.1, 1.98)('amber');
  return {
    root,
    // the footprint in world axes (the group is turned a quarter): local x -> world z, local z -> world -x
    solids: [solid(x - 0.1, z, 4.3, L + 0.8)],
    anchor: new THREE.Vector3(x - 2.0, 1.6, z),
  };
}
