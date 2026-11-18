// The shop itself: hall, corridor, office, lights, floor markings and everything that stands in it
// except the machines. Original procedural geometry; metres, Y up. The player spawns at the hall's
// front looking down the floor (-Z); the corridor to the office is behind them (+Z).
import * as THREE from 'three';
import { hsl, solid, type Kit, type Solid } from './kit.ts';

export const HALL = { x0: -9, x1: 9, z0: -12, z1: 8, h: 5.2 };
export const CORRIDOR = { x0: -1.5, x1: 1.5, z0: 8, z1: 15, h: 2.9 };
export const OFFICE = { x0: -4, x1: 4, z0: 15, z1: 21, h: 2.9 };

export interface World {
  solids: Solid[];
  /** where each non-machine target is looked at (world) */
  anchors: Record<'rack' | 'wrench' | 'oil' | 'gauge' | 'computer' | 'cabinet' | 'arm', THREE.Vector3>;
  /** the hand tools lying in the shop; hidden while carried */
  items: Record<'wrench' | 'oil' | 'gauge', THREE.Object3D>;
  /** rack tool id -> its holder on the rack; hidden while it is in a hand or a spindle */
  rackTools: Map<string, THREE.Object3D>;
  setCabinetOpen(open: boolean): void;
  setEnv(env: 'cold-steel' | 'workshop-night', shadows: boolean): void;
  /** decorative motion (the sheet-metal arm, the cabinet door); `still` freezes it for reduced motion */
  update(dt: number, t: number, still: boolean): void;
}

export function buildWorld(k: Kit, scene: THREE.Scene, rack: readonly { id: string; l: number; r: number }[]): World {
  const solids: Solid[] = [];
  const root = k.group(scene);
  const wallMat = k.std('wall', hsl(212, 8, 60), 0.72, 0.35, { map: k.cladding(34, [1, 1]) });
  const wallLow = k.std('wallLow', hsl(214, 10, 26), 0.85, 0.1);
  const paint = (c: THREE.Color) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lineMat = paint(k.pal.warning.clone().multiplyScalar(0.85));
  const laneMat = paint(hsl(210, 8, 70));
  const accentPaint = paint(k.pal.accent.clone().multiplyScalar(0.8));

  /* ---- floors and ceilings ---- */
  const slab = (r: { x0: number; x1: number; z0: number; z1: number }, m: THREE.Material, y = 0) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), m);
    mesh.rotation.x = y > 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  slab(HALL, k.std('floor', hsl(210, 6, 66), 0.42, 0.05, { map: k.concrete([6, 7]) }));
  slab(CORRIDOR, k.std('lino', hsl(205, 12, 30), 0.5, 0));
  slab(OFFICE, k.std('carpet', hsl(215, 22, 22), 0.95, 0));
  const ceil = k.std('ceil', hsl(214, 12, 16), 0.9, 0.2);
  slab(HALL, ceil, HALL.h);
  slab(CORRIDOR, k.std('ceilLow', hsl(210, 6, 62), 0.9, 0), CORRIDOR.h);
  slab(OFFICE, k.std('ceilLow', hsl(210, 6, 62), 0.9, 0), OFFICE.h);

  /* ---- walls: a wall is a box and a solid ---- */
  const wall = (x0: number, x1: number, z0: number, z1: number, h: number, m: THREE.Material, y0 = 0) => {
    const w = Math.max(x1 - x0, 0.2);
    const d = Math.max(z1 - z0, 0.2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    root.add(mesh);
    if (y0 < 1.8) solids.push({ x0: (x0 + x1) / 2 - w / 2, x1: (x0 + x1) / 2 + w / 2, z0: (z0 + z1) / 2 - d / 2, z1: (z0 + z1) / 2 + d / 2 });
  };
  const hallWall = (x0: number, x1: number, z0: number, z1: number) => {
    wall(x0, x1, z0, z1, 1.1, wallLow);
    wall(x0, x1, z0, z1, HALL.h - 1.1, wallMat, 1.1);
  };
  hallWall(HALL.x0 - 0.2, HALL.x1 + 0.2, HALL.z0 - 0.2, HALL.z0);
  hallWall(HALL.x0 - 0.2, HALL.x0, HALL.z0, HALL.z1);
  hallWall(HALL.x1, HALL.x1 + 0.2, HALL.z0, HALL.z1);
  hallWall(HALL.x0 - 0.2, CORRIDOR.x0, HALL.z1, HALL.z1 + 0.2);
  hallWall(CORRIDOR.x1, HALL.x1 + 0.2, HALL.z1, HALL.z1 + 0.2);
  wall(CORRIDOR.x0, CORRIDOR.x1, HALL.z1, HALL.z1 + 0.2, HALL.h - CORRIDOR.h, wallMat, CORRIDOR.h); // above the corridor mouth
  const plaster = k.std('plaster', hsl(205, 10, 66), 0.9, 0);
  wall(CORRIDOR.x0 - 0.2, CORRIDOR.x0, CORRIDOR.z0 + 0.2, CORRIDOR.z1, CORRIDOR.h, plaster);
  wall(CORRIDOR.x1, CORRIDOR.x1 + 0.2, CORRIDOR.z0 + 0.2, CORRIDOR.z1, CORRIDOR.h, plaster);
  wall(OFFICE.x0 - 0.2, CORRIDOR.x0, OFFICE.z0 - 0.2, OFFICE.z0, OFFICE.h, plaster);
  wall(CORRIDOR.x1, OFFICE.x1 + 0.2, OFFICE.z0 - 0.2, OFFICE.z0, OFFICE.h, plaster);
  wall(OFFICE.x0 - 0.2, OFFICE.x0, OFFICE.z0, OFFICE.z1, OFFICE.h, plaster);
  wall(OFFICE.x1, OFFICE.x1 + 0.2, OFFICE.z0, OFFICE.z1, OFFICE.h, plaster);
  wall(OFFICE.x0 - 0.2, OFFICE.x1 + 0.2, OFFICE.z1, OFFICE.z1 + 0.2, OFFICE.h, plaster);
  // the corridor mouth: a steel frame and a sign
  for (const fx of [CORRIDOR.x0 + 0.06, CORRIDOR.x1 - 0.06]) k.box(root, 0.12, CORRIDOR.h, 0.3, k.darkSteel, fx, CORRIDOR.h / 2, HALL.z1 + 0.1);
  k.box(root, 3.0, 0.14, 0.3, k.darkSteel, 0, CORRIDOR.h - 0.07, HALL.z1 + 0.1);
  k.sign(root, 1.5, 0.36, k.plate(['KONTOR  →'], { w: 512, h: 128 }), 0, CORRIDOR.h + 0.35, HALL.z1 - 0.01).rotation.y = Math.PI;

  /* ---- structure: columns, roof beams, cable trays, lamps ---- */
  for (const cx of [HALL.x0 + 0.15, HALL.x1 - 0.15]) for (let cz = HALL.z0 + 2; cz < HALL.z1; cz += 6) k.box(root, 0.3, HALL.h, 0.3, k.darkSteel, cx, HALL.h / 2, cz);
  for (let cz = HALL.z0 + 2; cz < HALL.z1; cz += 6) {
    k.box(root, HALL.x1 - HALL.x0, 0.36, 0.2, k.darkSteel, 0, HALL.h - 0.3, cz);
    k.box(root, HALL.x1 - HALL.x0, 0.05, 0.34, k.darkSteel, 0, HALL.h - 0.5, cz);
  }
  const tray = k.std('tray', hsl(210, 8, 48), 0.5, 0.8);
  k.box(root, 0.5, 0.08, HALL.z1 - HALL.z0 - 1, tray, -4.6, 4.7, -2);
  k.box(root, 12, 0.08, 0.5, tray, 0.5, 4.7, -11);
  k.box(root, 0.5, 0.08, 9, tray, 6.2, 4.7, -6);
  for (let i = 0; i < 5; i++) k.tube(root, [[-4.75 + i * 0.07, 4.76, 6], [-4.7 + i * 0.07, 4.78, -2], [-4.75 + i * 0.07, 4.76, -10.8]], 0.016, i === 2 ? k.coolantBlue : k.rubber);
  const lampMat = new THREE.MeshStandardMaterial({ color: hsl(205, 30, 92), emissive: hsl(205, 60, 85), emissiveIntensity: 1.6 });
  for (const lx of [-5.2, 0.6, 5.6])
    for (const lz of [-9, -3.5, 2, 6.5]) {
      const lamp = k.box(root, 0.22, 0.06, 2.2, lampMat, lx, HALL.h - 0.62, lz);
      lamp.castShadow = lamp.receiveShadow = false;
      k.box(root, 0.3, 0.05, 2.3, k.darkSteel, lx, HALL.h - 0.57, lz).castShadow = false;
    }
  for (const lz of [9.5, 12, 14.5, 17, 19.5]) k.box(root, lz > 15 ? 2.4 : 1.2, 0.04, 0.3, lampMat, 0, CORRIDOR.h - 0.03, lz).castShadow = false;

  /* ---- floor markings: a walkway, a zone around every machine, the shop number ---- */
  const mark = (x0: number, x1: number, z0: number, z1: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  const zone = (x0: number, x1: number, z0: number, z1: number, m: THREE.Material, t = 0.09) => {
    mark(x0, x1, z0, z0 + t, m);
    mark(x0, x1, z1 - t, z1, m);
    mark(x0, x0 + t, z0, z1, m);
    mark(x1 - t, x1, z0, z1, m);
  };
  mark(1.0, 1.1, -6.6, 7.6, laneMat); // walkway edges
  mark(2.6, 2.7, -11.4, 7.6, laneMat);
  mark(-8.4, 1.1, -6.7, -6.6, laneMat);
  for (let z = -6; z < 7.5; z += 1.6) mark(1.45, 2.25, z, z + 0.1, laneMat);
  zone(-8.6, -4.1, -11.6, -7.0, lineMat);
  zone(-3.9, 0.9, -11.6, -7.0, lineMat);
  zone(3.0, 8.6, -9.6, -1.4, lineMat);
  const hz = new THREE.MeshStandardMaterial({ map: k.hazard([14, 1]), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mark(3.0, 8.6, -1.4, -1.2, hz);
  zone(-8.7, -6.9, -5.2, -0.6, accentPaint, 0.06);
  const stencil = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.3), new THREE.MeshStandardMaterial({ map: k.plate(['5511'], { w: 512, h: 208, bg: 'hsl(0 0% 0% / 0)', border: 'hsl(0 0% 0% / 0)' }), transparent: true, opacity: 0.5, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  stencil.rotation.x = -Math.PI / 2;
  stencil.position.set(-3.2, 0.005, 3.2);
  root.add(stencil);
  k.sign(root, 4.6, 1.3, k.plate(['VERKSTAD 5511'], { w: 1024, h: 290, bg: 'hsl(214 14% 10%)' }), 1.8, 4.0, HALL.z0 + 0.01);

  /* ---- workbench with a vice, the wrench and the measuring tool (left wall) ---- */
  const bench = k.group(root, -8.25, 0, -2.9);
  k.box(bench, 0.9, 0.07, 3.6, k.wood, 0, 0.92, 0);
  k.box(bench, 0.86, 0.5, 3.5, k.shellDark, 0, 0.62, 0);
  for (const bz of [-1.7, 0, 1.7]) for (const bx of [-0.38, 0.38]) k.box(bench, 0.06, 0.9, 0.06, k.darkSteel, bx, 0.45, bz);
  for (let i = 0; i < 3; i++) k.box(bench, 0.02, 0.36, 1.05, k.steel, 0.44, 0.62, -1.15 + i * 1.15); // drawer fronts
  k.box(bench, 0.3, 0.1, 0.2, k.castDark, 0.1, 1.0, -1.3);
  k.box(bench, 0.1, 0.16, 0.18, k.cast, 0.02, 1.1, -1.3);
  k.box(bench, 0.1, 0.16, 0.18, k.cast, 0.2, 1.1, -1.3);
  k.cyl(bench, 0.012, 0.012, 0.3, k.ground, 0.3, 1.08, -1.3, 'z', 8);
  k.box(bench, 0.02, 1.3, 3.6, k.std('peg', hsl(212, 10, 30), 0.8, 0.3), -0.44, 1.6, 0); // back board
  solids.push(solid(-8.25, -2.9, 1.0, 3.7));
  const wrench = k.group(bench, 0.12, 0.97, 0.2);
  k.box(wrench, 0.34, 0.016, 0.04, k.ground);
  const jaw = new THREE.Mesh(k.geo('jaw', () => new THREE.TorusGeometry(0.035, 0.012, 6, 14, Math.PI * 1.5)), k.ground);
  jaw.rotation.x = Math.PI / 2;
  jaw.position.x = 0.19;
  wrench.add(jaw);
  const ring = new THREE.Mesh(k.geo('ring', () => new THREE.TorusGeometry(0.028, 0.012, 6, 14)), k.ground);
  ring.rotation.x = Math.PI / 2;
  ring.position.x = -0.19;
  wrench.add(ring);
  const gauge = k.group(bench, 0.1, 0.97, 1.0);
  k.box(gauge, 0.3, 0.012, 0.03, k.ground); // a caliper: beam, two jaws, a slider with a dial
  k.box(gauge, 0.012, 0.012, 0.09, k.ground, -0.14, 0, 0.04);
  k.box(gauge, 0.012, 0.012, 0.09, k.ground, -0.06, 0, 0.04);
  k.box(gauge, 0.07, 0.02, 0.05, k.darkSteel, -0.04, 0.004, 0);
  k.cyl(gauge, 0.03, 0.03, 0.012, k.accent, -0.04, 0.02, -0.02, 'y', 16);

  /* ---- tool rack on the left wall: one holder per rack tool ---- */
  const rackG = k.group(root, -8.82, 0, 1.2);
  k.box(rackG, 0.08, 1.5, 2.4, k.shellDark, 0, 1.45, 0);
  k.box(rackG, 0.3, 0.05, 2.4, k.steel, 0.16, 1.0, 0);
  k.box(rackG, 0.3, 0.05, 2.4, k.steel, 0.16, 1.55, 0);
  k.sign(rackG, 0.9, 0.2, k.plate(['VERKTYG'], { w: 512, h: 128 }), 0.05, 2.05, 0).rotation.y = Math.PI / 2;
  const rackTools = new Map<string, THREE.Object3D>();
  rack.forEach((t, i) => {
    const g = k.group(rackG, 0.18, i < 3 ? 1.03 : 1.58, -0.75 + (i % 3) * 0.75);
    k.cyl(g, 0.045, 0.03, 0.09, k.darkSteel, 0, 0.045, 0, 'y', 14);
    const r = Math.min(0.03, Math.max(0.004, t.r / 1000));
    const len = Math.min(0.12, t.l / 1000);
    k.cyl(g, r, r, len, k.ground, 0, 0.09 + len / 2, 0, 'y', 12);
    k.cyl(g, 0.055, 0.055, 0.012, k.accent, 0, 0.004, 0, 'y', 14);
    rackTools.set(t.id, g);
  });
  solids.push(solid(-8.75, 1.2, 0.5, 2.5));

  /* ---- coolant corner: a tote in a cage, drums, the oil can ---- */
  const tote = k.group(root, -8.2, 0, 5.4);
  k.box(tote, 1.1, 0.14, 1.1, k.wood, 0, 0.07, 0);
  k.box(tote, 1.0, 0.95, 1.0, k.milky, 0, 0.64, 0);
  const cage = k.std('cage', hsl(210, 8, 60), 0.4, 0.9);
  for (const cx of [-0.52, 0, 0.52]) for (const cz of [-0.52, 0.52]) k.box(tote, 0.03, 1.0, 0.03, cage, cx, 0.64, cz);
  for (const cy of [0.3, 0.64, 1.0]) {
    k.box(tote, 1.07, 0.03, 0.03, cage, 0, cy, 0.52);
    k.box(tote, 0.03, 0.03, 1.07, cage, 0.52, cy, 0);
  }
  k.cyl(tote, 0.09, 0.09, 0.05, k.rubber, 0, 1.14, 0, 'y', 12);
  k.sign(tote, 0.5, 0.2, k.plate(['KYLVÄTSKA'], { w: 512, h: 190, bg: 'hsl(204 60% 24%)' }), 0.53, 0.7, 0).rotation.y = Math.PI / 2;
  solids.push(solid(-8.2, 5.4, 1.2, 1.2));
  for (const [dx, dz, m] of [[-8.3, 3.9, k.coolantBlue], [-7.55, 4.1, k.std('drum2', hsl(213, 14, 30), 0.5, 0.6)]] as const) {
    k.cyl(root, 0.29, 0.29, 0.88, m, dx, 0.44, dz, 'y', 20);
    k.cyl(root, 0.3, 0.3, 0.03, k.darkSteel, dx, 0.3, dz, 'y', 20);
    k.cyl(root, 0.3, 0.3, 0.03, k.darkSteel, dx, 0.6, dz, 'y', 20);
    solids.push(solid(dx, dz, 0.62, 0.62));
  }
  k.tube(root, [[-8.3, 0.9, 3.9], [-8.6, 1.5, 3.5], [-8.75, 3.0, 2.8], [-8.7, 4.6, 2.6]], 0.02, k.coolantBlue);
  const oilCan = k.group(root, -7.0, 0, 3.2);
  k.cyl(oilCan, 0.13, 0.15, 0.3, k.std('oilCan', k.pal.warning, 0.5, 0.3), 0, 0.15, 0, 'y', 14);
  k.cyl(oilCan, 0.015, 0.03, 0.26, k.steel, 0.1, 0.38, 0, 'y', 8).rotation.z = -0.7;
  const handle = new THREE.Mesh(k.geo('canHandle', () => new THREE.TorusGeometry(0.08, 0.012, 6, 12, Math.PI)), k.darkSteel);
  handle.position.set(-0.04, 0.3, 0);
  oilCan.add(handle);
  k.sign(oilCan, 0.16, 0.1, k.plate(['OLJA'], { w: 256, h: 128, bg: 'hsl(220 10% 8%)' }), 0, 0.16, 0.146);

  /* ---- right wall: shelving with boxes and sheet stock, the computer, the cabinet ---- */
  const shelf = k.group(root, 8.55, 0, 0.6);
  for (const sz of [-1.2, 0, 1.2]) for (const sx of [-0.3, 0.3]) k.box(shelf, 0.05, 2.4, 0.05, k.accent, sx, 1.2, sz);
  for (const sy of [0.3, 0.95, 1.6, 2.25]) k.box(shelf, 0.7, 0.04, 2.5, k.steel, 0, sy, 0);
  const crate = k.std('crate', hsl(213, 20, 30), 0.7, 0.1);
  const card = k.std('card', hsl(32, 34, 46), 0.9, 0);
  [[0.5, -0.8, crate], [0.5, 0.1, card], [0.5, 0.85, crate], [1.15, -0.6, card], [1.15, 0.5, crate], [1.8, -0.2, card], [1.8, 0.8, card]].forEach(([y, zz, m], i) => {
    k.box(shelf, 0.5, 0.34 + (i % 3) * 0.05, 0.55, m as THREE.Material, 0, (y as number) + 0.01, zz as number);
  });
  solids.push(solid(8.55, 0.6, 0.8, 2.6));
  const desk = k.group(root, 8.35, 0, 3.6);
  k.box(desk, 0.9, 0.05, 1.6, k.wood, 0, 0.76, 0);
  for (const dz of [-0.75, 0.75]) k.box(desk, 0.85, 0.74, 0.04, k.shellDark, 0, 0.37, dz);
  k.box(desk, 0.03, 0.5, 0.74, k.plastic, 0.2, 1.22, 0);
  const monitor = k.sign(desk, 0.68, 0.44, k.screen('5511 · VERKSTADSDATOR', ['> SPARA / LADDA', '> INSTÄLLNINGAR', '> HEMLIGHETER', '', 'TRYCK E']), 0.18, 1.22, 0, 0.9);
  monitor.rotation.y = -Math.PI / 2;
  k.box(desk, 0.06, 0.2, 0.2, k.plastic, 0.2, 0.88, 0);
  k.box(desk, 0.18, 0.02, 0.46, k.plastic, -0.15, 0.795, 0);
  k.box(desk, 0.4, 0.42, 0.2, k.plastic, 0.1, 0.22, 0.5);
  k.tube(desk, [[0.3, 0.3, 0.5], [0.42, 0.1, 0.2], [0.44, 0.05, -0.6], [0.44, 2.0, -0.8]], 0.012, k.rubber);
  const stool = k.group(root, 7.45, 0, 3.6);
  k.cyl(stool, 0.2, 0.2, 0.06, k.rubber, 0, 0.55, 0, 'y', 16);
  k.cyl(stool, 0.025, 0.025, 0.5, k.steel, 0, 0.28, 0, 'y', 8);
  k.cyl(stool, 0.22, 0.22, 0.03, k.darkSteel, 0, 0.02, 0, 'y', 16);
  solids.push(solid(8.35, 3.6, 1.0, 1.7), solid(7.45, 3.6, 0.45, 0.45));
  const cab = k.group(root, 8.6, 0, 6.2);
  k.box(cab, 0.6, 2.0, 1.1, k.std('cabinet', hsl(213, 26, 30), 0.55, 0.4), 0, 1.0, 0);
  const cabDoor = k.group(cab, -0.31, 1.0, 0.55);
  k.box(cabDoor, 0.03, 1.94, 1.08, k.std('cabinetDoor', hsl(213, 26, 36), 0.5, 0.45), 0, 0, -0.54);
  k.box(cabDoor, 0.03, 0.14, 0.03, k.steel, -0.03, 0, -1.0);
  k.sign(cabDoor, 0.6, 0.2, k.plate(['norsk'], { w: 384, h: 128 }), -0.017, 0.55, -0.54).rotation.y = -Math.PI / 2;
  // inside: a shelf of tins and a small flag-less pennant strip in the accent colour
  for (let i = 0; i < 4; i++) k.cyl(cab, 0.06, 0.06, 0.14, i % 2 ? k.accent : k.steel, -0.1, 1.17, -0.3 + i * 0.2, 'y', 12);
  k.box(cab, 0.5, 0.03, 1.0, k.steel, 0, 1.08, 0);
  solids.push(solid(8.6, 6.2, 0.7, 1.2));

  /* ---- sheet-metal panels against the back wall, a fixture cart, floor cable cover ---- */
  const sheets = k.group(root, 4.4, 0, -11.55);
  const sheetMat = k.std('sheet', hsl(210, 8, 70), 0.3, 0.95, { map: k.brushed(70, [1, 2]) });
  for (let i = 0; i < 5; i++) {
    const s = k.box(sheets, 2.0 - i * 0.12, 1.3 + (i % 2) * 0.25, 0.012, sheetMat, -0.2 + i * 0.1, 0.72 + (i % 2) * 0.12, 0.1 + i * 0.06);
    s.rotation.x = -0.16;
  }
  k.box(sheets, 2.4, 0.1, 0.5, k.wood, 0, 0.05, 0.2);
  for (const sx of [-1.15, 1.15]) k.box(sheets, 0.06, 1.2, 0.06, k.accent, sx, 0.6, 0.45);
  solids.push(solid(4.4, -11.35, 2.6, 0.9));
  const cart = k.group(root, -4.3, 0, -4.4);
  k.box(cart, 1.0, 0.05, 0.6, k.steel, 0, 0.8, 0);
  k.box(cart, 1.0, 0.05, 0.6, k.steel, 0, 0.3, 0);
  for (const cx of [-0.47, 0.47]) for (const cz of [-0.27, 0.27]) {
    k.box(cart, 0.04, 0.8, 0.04, k.darkSteel, cx, 0.42, cz);
    k.cyl(cart, 0.05, 0.05, 0.04, k.rubber, cx, 0.05, cz, 'x', 10);
  }
  k.box(cart, 0.34, 0.08, 0.22, k.castDark, -0.25, 0.87, 0); // a spare vice, clamps, a fixture plate with a hole grid
  k.box(cart, 0.05, 0.1, 0.2, k.steel, -0.35, 0.96, 0);
  k.box(cart, 0.05, 0.1, 0.2, k.steel, -0.15, 0.96, 0);
  k.box(cart, 0.36, 0.03, 0.36, k.ground, 0.25, 0.84, 0);
  for (let i = 0; i < 9; i++) k.cyl(cart, 0.012, 0.012, 0.032, k.darkSteel, 0.14 + (i % 3) * 0.11, 0.842, -0.11 + Math.floor(i / 3) * 0.11, 'y', 6);
  for (let i = 0; i < 3; i++) k.box(cart, 0.07, 0.06, 0.16, k.cast, -0.3 + i * 0.3, 0.36, 0.1);
  solids.push(solid(-4.3, -4.4, 1.1, 0.7));
  const cover = k.box(root, 0.5, 0.04, 0.24, new THREE.MeshStandardMaterial({ map: k.hazard([2, 1]), roughness: 0.8 }), 2.85, 0.02, -6.5);
  cover.castShadow = false;
  k.tube(root, [[0.2, 0.03, -7.2], [1.6, 0.03, -6.6], [2.85, 0.05, -6.5], [3.4, 0.03, -6.4]], 0.02, k.rubber);

  /* ---- the "plåt" arm: riveted sheet-metal links, two joints and a turning base, cables and coolant nozzles ---- */
  const armBase = k.group(root, 2.2, 0, -10.2);
  const hzPlate = new THREE.MeshStandardMaterial({ map: k.hazard([4, 4]), roughness: 0.7 });
  k.box(armBase, 1.1, 0.03, 1.1, hzPlate, 0, 0.015, 0);
  k.box(armBase, 0.8, 0.05, 0.8, k.darkSteel, 0, 0.05, 0);
  k.cyl(armBase, 0.2, 0.26, 0.85, k.shellDark, 0, 0.5, 0, 'y', 16);
  k.sign(armBase, 0.34, 0.12, k.plate(['PLÅT'], { w: 384, h: 128 }), 0, 0.6, 0.262);
  const yaw = k.group(armBase, 0, 0.95, 0);
  k.cyl(yaw, 0.24, 0.24, 0.1, k.steel, 0, 0, 0, 'y', 20);
  k.box(yaw, 0.36, 0.34, 0.36, k.shell, 0, 0.22, 0);
  const link = (parent: THREE.Object3D, len: number, y: number) => {
    const g = k.group(parent, 0, y, 0);
    const plate = k.std('plat', hsl(210, 8, 72), 0.34, 0.9, { map: k.brushed(72, [2, 1]) });
    for (const s of [-1, 1]) {
      k.box(g, len, 0.2, 0.012, plate, len / 2, 0, s * 0.1);
      k.box(g, len, 0.012, 0.05, plate, len / 2, 0.106, s * 0.08); // folded flange
      for (let i = 0; i < 6; i++) k.cyl(g, 0.012, 0.012, 0.018, k.darkSteel, 0.1 + (i * (len - 0.2)) / 5, -0.06, s * 0.108, 'z', 6);
    }
    for (let i = 0; i < 3; i++) k.cyl(g, 0.016, 0.016, 0.2, k.darkSteel, 0.2 + (i * (len - 0.4)) / 2, 0, 0, 'z', 8);
    k.cyl(g, 0.11, 0.11, 0.26, k.darkSteel, 0, 0, 0, 'z', 18);
    k.tube(g, [[0.05, 0.14, 0.04], [len * 0.5, 0.17, 0.05], [len - 0.05, 0.14, 0.04]], 0.014, k.rubber);
    k.tube(g, [[0.05, 0.14, -0.04], [len * 0.5, 0.16, -0.05], [len - 0.05, 0.14, -0.04]], 0.016, k.coolantBlue);
    return g;
  };
  const upper = link(yaw, 1.25, 0.42);
  const fore = link(upper, 1.0, 0);
  fore.position.x = 1.25;
  const wrist = k.group(fore, 1.0, 0, 0);
  k.cyl(wrist, 0.09, 0.09, 0.24, k.darkSteel, 0, 0, 0, 'z', 16);
  k.box(wrist, 0.16, 0.12, 0.16, k.shell, 0.1, -0.02, 0);
  const halo = new THREE.Mesh(k.geo('halo', () => new THREE.TorusGeometry(0.1, 0.014, 8, 20)), k.coolantBlue);
  halo.position.set(0.2, -0.08, 0);
  halo.rotation.x = Math.PI / 2;
  wrist.add(halo);
  for (let i = 0; i < 3; i++) k.cyl(wrist, 0.008, 0.014, 0.1, k.accent, 0.2 + Math.cos((i * Math.PI * 2) / 3) * 0.1, -0.13, Math.sin((i * Math.PI * 2) / 3) * 0.1, 'y', 6);
  k.tube(root, [[2.2, 0.9, -10.5], [2.0, 2.4, -11.2], [1.6, 4.0, -11.3], [1.2, 4.7, -11.0]], 0.022, k.coolantBlue);
  k.tube(root, [[2.3, 0.9, -10.5], [2.5, 2.6, -11.3], [2.4, 4.7, -11.0]], 0.018, k.rubber);
  solids.push(solid(2.2, -10.2, 1.2, 1.2));
  // the resting pose, also what reduced motion shows
  yaw.rotation.y = 0.5;
  upper.rotation.z = 0.75;
  fore.rotation.z = -1.25;
  wrist.rotation.z = 0.5;

  /* ---- office: desks, a plant, a filing cabinet, a window of light ---- */
  const od = k.group(root, -2.4, 0, 19.6);
  k.box(od, 2.0, 0.05, 0.9, k.wood, 0, 0.75, 0);
  for (const dx of [-0.95, 0.95]) k.box(od, 0.04, 0.74, 0.85, k.plastic, dx, 0.37, 0);
  k.box(od, 0.6, 0.4, 0.03, k.plastic, 0, 1.15, 0.25);
  k.sign(od, 0.56, 0.36, k.screen('PERSONAL', ['SCHEMA  V.47', 'FRÅNVARO: 3', 'ÖVERTID: JA', '', 'ATTEST SAKNAS']), 0, 1.15, 0.23, 0.8).rotation.y = Math.PI;
  for (let i = 0; i < 4; i++) k.box(od, 0.24, 0.02 + i * 0.012, 0.32, k.std('paper', hsl(48, 20, 88), 0.9, 0), -0.6, 0.79 + i * 0.016, -0.1 + i * 0.01).rotation.y = i * 0.2;
  solids.push(solid(-2.4, 19.6, 2.1, 1.0));
  k.box(root, 0.5, 1.3, 0.6, k.shellDark, 3.6, 0.65, 20.4);
  solids.push(solid(3.6, 20.4, 0.6, 0.7));
  const pot = k.group(root, 3.4, 0, 16);
  k.cyl(pot, 0.2, 0.15, 0.36, k.std('pot', hsl(18, 40, 36), 0.8, 0), 0, 0.18, 0, 'y', 12);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(k.geo('leaf', () => new THREE.ConeGeometry(0.09, 0.7, 5)), k.std('leaf', hsl(130, 36, 28), 0.7, 0));
    leaf.position.set(Math.cos(i) * 0.1, 0.7, Math.sin(i) * 0.1);
    leaf.rotation.set(Math.sin(i * 2) * 0.5, 0, Math.cos(i * 2) * 0.5);
    pot.add(leaf);
  }
  solids.push(solid(3.4, 16, 0.5, 0.5));
  const win = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.3), new THREE.MeshStandardMaterial({ color: hsl(205, 50, 80), emissive: hsl(205, 70, 78), emissiveIntensity: 1.1 }));
  win.position.set(0, 1.7, OFFICE.z1 - 0.01);
  win.rotation.y = Math.PI;
  root.add(win);
  k.box(root, 3.5, 0.06, 0.08, k.plastic, 0, 1.7, OFFICE.z1 - 0.04);
  k.box(root, 0.06, 1.3, 0.08, k.plastic, 0, 1.7, OFFICE.z1 - 0.04);

  /* ---- light ---- */
  const hemi = new THREE.HemisphereLight(hsl(207, 50, 80), hsl(215, 20, 10), 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(hsl(205, 40, 96), 1.5);
  sun.position.set(-3, 12, 5);
  sun.target.position.set(-1, 0, -5);
  sun.shadow.camera.left = -13;
  sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 13;
  sun.shadow.camera.bottom = -13;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const pools = ([[-6.3, 3.6, -7.6], [-1.4, 3.6, -6.8], [3.2, 3.8, -5.5], [8.0, 2.4, 3.6], [0, 2.5, 12], [0, 2.5, 18]] as const).map(([px, py, pz], i) => {
    const p = new THREE.PointLight(i < 3 ? hsl(207, 70, 84) : hsl(40, 70, 80), 14, 11, 1.6);
    p.position.set(px, py, pz);
    scene.add(p);
    return p;
  });
  scene.fog = new THREE.Fog(hsl(214, 24, 10), 16, 46);

  const anchors: World['anchors'] = {
    rack: new THREE.Vector3(-8.6, 1.4, 1.2),
    wrench: new THREE.Vector3(-8.1, 1.0, -2.7),
    gauge: new THREE.Vector3(-8.1, 1.0, -1.9),
    oil: new THREE.Vector3(-7.0, 0.3, 3.2),
    computer: new THREE.Vector3(8.4, 1.2, 3.6),
    cabinet: new THREE.Vector3(8.3, 1.4, 6.2),
    arm: new THREE.Vector3(2.2, 1.5, -10.2),
  };
  let cabOpen = false;
  return {
    solids,
    anchors,
    items: { wrench, oil: oilCan, gauge },
    rackTools,
    setCabinetOpen(o) {
      cabOpen = o;
    },
    setEnv(env, shadows) {
      const night = env === 'workshop-night';
      hemi.intensity = night ? 0.12 : 0.5;
      sun.intensity = night ? 0.18 : 1.5;
      sun.castShadow = shadows;
      pools.forEach((p, i) => {
        p.intensity = night ? (i < 3 ? 34 : 18) : i < 3 ? 20 : 12;
        p.color.copy(night && i < 3 ? hsl(34, 80, 70) : i < 3 ? hsl(207, 70, 84) : hsl(40, 70, 80));
      });
      lampMat.emissiveIntensity = night ? 0.25 : 1.6;
      (scene.fog as THREE.Fog).color.copy(night ? hsl(220, 30, 4) : hsl(214, 24, 10));
      scene.background = (scene.fog as THREE.Fog).color;
    },
    update(dt, t, still) {
      cabDoor.rotation.y += ((cabOpen ? -1.9 : 0) - cabDoor.rotation.y) * Math.min(1, dt * (still ? 60 : 5));
      if (still) return;
      // a slow reach-and-return: the base turns, the two joints fold, the nozzle ring keeps level
      yaw.rotation.y = Math.sin(t * 0.23) * 0.9 + 0.5;
      upper.rotation.z = 0.75 + Math.sin(t * 0.31) * 0.28;
      fore.rotation.z = -1.25 + Math.sin(t * 0.43 + 1) * 0.42;
      wrist.rotation.z = -(upper.rotation.z + fore.rotation.z);
    },
  };
}
