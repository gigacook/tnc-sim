// Original stylised low-poly figures, built from a handful of flat-shaded primitives. One builder makes
// every character: the two generic ones shipped here (a boss, an office worker in a dress) and the figures
// a content pack describes with numbers and colours.
import * as THREE from 'three';
import { hsl } from './kit.ts';
import type { PackFigure } from '../pack/loader.ts';

export interface FigureSpec {
  height: number;
  build: number;
  skin: THREE.Color;
  hair: THREE.Color;
  hairStyle: 'short' | 'long' | 'bald' | 'bun';
  beard: boolean;
  glasses: boolean;
  top: THREE.Color;
  bottom: THREE.Color;
  /** a dress instead of trousers */
  dress?: boolean;
  /** a tie in this colour */
  tie?: THREE.Color;
  /** holds a handkerchief to the face and sheds low-poly tears */
  tearful?: boolean;
  /** carries a clipboard */
  clipboard?: boolean;
}

export const BOSS: FigureSpec = {
  height: 1.82,
  build: 1.25,
  skin: hsl(24, 42, 62),
  hair: hsl(30, 10, 22),
  hairStyle: 'short',
  beard: false,
  glasses: false,
  top: hsl(215, 18, 20),
  bottom: hsl(215, 14, 14),
  tie: hsl(210, 100, 58),
  clipboard: true,
};
export const OFFICE_WORKER: FigureSpec = {
  height: 1.68,
  build: 0.95,
  skin: hsl(22, 46, 70),
  hair: hsl(18, 52, 28),
  hairStyle: 'bun',
  beard: false,
  glasses: true,
  top: hsl(338, 42, 42),
  bottom: hsl(338, 42, 42),
  dress: true,
  tearful: true,
};

/** A content-pack figure (validated numbers and colours) as a figure spec. */
export const specFromPack = (f: PackFigure): FigureSpec => ({
  height: f.height,
  build: f.build,
  skin: new THREE.Color(f.skin),
  hair: new THREE.Color(f.hair),
  hairStyle: f.hairStyle,
  beard: f.beard,
  glasses: f.glasses,
  top: new THREE.Color(f.top),
  bottom: new THREE.Color(f.bottom),
});

export interface Figure {
  root: THREE.Group;
  /** t in seconds; talking waves an arm, cheer raises the right arm for a high-five (0..1) */
  pose(t: number, o: { talking: boolean; cheer: number; still: boolean }): void;
  dispose(): void;
}

export function buildFigure(spec: FigureSpec): Figure {
  const root = new THREE.Group();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  const mat = (c: THREE.Color, rough = 0.8) => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, flatShading: true });
    owned.push(m);
    return m;
  };
  const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    owned.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const s = spec.height / 1.75;
  const b = spec.build;
  const skin = mat(spec.skin);
  const top = mat(spec.top);
  const bottom = mat(spec.bottom);
  const hair = mat(spec.hair, 0.9);
  const body = new THREE.Group();
  body.scale.setScalar(s);
  root.add(body);

  // legs or a dress
  if (spec.dress) {
    add(body, new THREE.ConeGeometry(0.34 * b, 0.78, 7, 1, true), bottom, 0, 0.72, 0);
    for (const sx of [-1, 1]) add(body, new THREE.CylinderGeometry(0.045, 0.04, 0.36, 5), skin, sx * 0.09, 0.2, 0);
  } else {
    for (const sx of [-1, 1]) add(body, new THREE.CylinderGeometry(0.085 * b, 0.07 * b, 0.86, 6), bottom, sx * 0.1 * b, 0.47, 0);
  }
  for (const sx of [-1, 1]) add(body, new THREE.BoxGeometry(0.1, 0.06, 0.24), mat(hsl(220, 10, 8)), sx * 0.1 * b, 0.03, 0.05);
  // torso: a tapered six-sided block
  const torso = add(body, new THREE.CylinderGeometry(0.2 * b, 0.16 * b, 0.56, 6), top, 0, 1.18, 0);
  torso.scale.z = 0.62;
  if (spec.tie) add(body, new THREE.BoxGeometry(0.05, 0.3, 0.02), mat(spec.tie, 0.5), 0, 1.24, 0.13 * b * 0.62 + 0.03);
  add(body, new THREE.CylinderGeometry(0.05, 0.06, 0.08, 6), skin, 0, 1.5, 0);
  // head
  const head = new THREE.Group();
  head.position.set(0, 1.64, 0);
  body.add(head);
  add(head, new THREE.IcosahedronGeometry(0.125, 1), skin).scale.set(0.92, 1.08, 0.98);
  add(head, new THREE.ConeGeometry(0.022, 0.05, 4), skin, 0, -0.01, 0.125).rotation.x = Math.PI / 2;
  const eye = mat(hsl(220, 20, 10), 0.3);
  for (const sx of [-1, 1]) add(head, new THREE.BoxGeometry(0.022, 0.022, 0.01), eye, sx * 0.045, 0.03, 0.115);
  if (spec.hairStyle !== 'bald') {
    add(head, new THREE.SphereGeometry(0.132, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, 0.022, -0.012);
    if (spec.hairStyle === 'long') add(head, new THREE.CylinderGeometry(0.125, 0.1, 0.22, 7, 1, true, Math.PI * 0.35, Math.PI * 1.3), hair, 0, -0.08, -0.015);
    if (spec.hairStyle === 'bun') add(head, new THREE.IcosahedronGeometry(0.06, 0), hair, 0, 0.12, -0.09);
  }
  if (spec.beard) add(head, new THREE.SphereGeometry(0.105, 6, 4, 0, Math.PI, Math.PI * 0.5, Math.PI * 0.42), hair, 0, -0.012, 0.03).rotation.y = -Math.PI / 2;
  if (spec.glasses) {
    const frame = mat(hsl(220, 10, 12), 0.4);
    for (const sx of [-1, 1]) add(head, new THREE.TorusGeometry(0.03, 0.005, 4, 8), frame, sx * 0.045, 0.03, 0.12);
    add(head, new THREE.BoxGeometry(0.03, 0.005, 0.005), frame, 0, 0.03, 0.122);
  }
  // arms: shoulder pivot -> upper arm -> elbow pivot -> forearm and hand
  const arm = (sx: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.24 * b, 1.4, 0);
    body.add(shoulder);
    add(shoulder, new THREE.CylinderGeometry(0.05 * b, 0.045 * b, 0.3, 5), top, 0, -0.15, 0);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.3, 0);
    shoulder.add(elbow);
    add(elbow, new THREE.CylinderGeometry(0.04 * b, 0.035 * b, 0.26, 5), spec.dress ? skin : top, 0, -0.13, 0);
    add(elbow, new THREE.BoxGeometry(0.06, 0.08, 0.04), skin, 0, -0.3, 0);
    return { shoulder, elbow };
  };
  const left = arm(-1);
  const right = arm(1);
  if (spec.clipboard) {
    add(left.elbow, new THREE.BoxGeometry(0.2, 0.28, 0.015), mat(hsl(30, 30, 30)), 0.06, -0.26, 0.06);
    add(left.elbow, new THREE.BoxGeometry(0.17, 0.23, 0.005), mat(hsl(48, 20, 90)), 0.06, -0.26, 0.07);
  }
  const tears: THREE.Mesh[] = [];
  if (spec.tearful) {
    add(right.elbow, new THREE.BoxGeometry(0.1, 0.1, 0.012), mat(hsl(0, 0, 96)), 0, -0.34, 0.02);
    const tear = mat(hsl(200, 80, 70), 0.2);
    for (const sx of [-1, 1]) tears.push(add(head, new THREE.OctahedronGeometry(0.014, 0), tear, sx * 0.05, 0, 0.12));
  }

  return {
    root,
    pose(t, o) {
      const k = o.still ? 0 : 1;
      body.position.y = Math.sin(t * 1.6) * 0.008 * k;
      head.rotation.y = Math.sin(t * 0.7) * 0.12 * k;
      head.rotation.x = (spec.tearful ? 0.16 : 0) + (o.talking ? Math.sin(t * 5) * 0.035 * k : 0);
      left.shoulder.rotation.set(spec.clipboard ? -0.75 : Math.sin(t * 1.1) * 0.05 * k, 0, -0.08);
      left.elbow.rotation.x = spec.clipboard ? -0.9 : -0.12;
      if (spec.tearful) {
        // the handkerchief goes to the face, with a sob
        right.shoulder.rotation.set(-1.0 + Math.sin(t * 3.2) * 0.06 * k, 0, -0.45);
        right.elbow.rotation.x = -1.9;
      } else {
        const wave = o.talking ? 0.5 + Math.sin(t * 4.2) * 0.22 * k : 0;
        right.shoulder.rotation.set(-wave - o.cheer * 2.5, 0, 0.08 + o.cheer * 0.25);
        right.elbow.rotation.x = -0.15 - wave * 1.4 * (1 - o.cheer);
      }
      tears.forEach((m, i) => {
        const f = o.still ? 0.3 : (t * 0.9 + i * 0.5) % 1;
        m.position.y = -0.005 - f * 0.16;
        m.visible = f < 0.9;
      });
    },
    dispose() {
      root.removeFromParent();
      for (const x of owned) x.dispose();
    },
  };
}
