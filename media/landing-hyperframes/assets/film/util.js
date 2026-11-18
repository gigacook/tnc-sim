// Shared helpers for the hero film. Everything here is a pure function of its
// arguments: no clock, no unseeded randomness.
import * as THREE from '../vendor/three.module.js';

export { THREE };

// Palette. The blue and the neutrals are the gigacook brand tokens
// (--gc-accent dark #2997FF, --gc-accent-fill #0066CC, dark surface #141416);
// the steel and coolant tones are this film's own.
export const COL = {
  accent: 0x2997ff,
  accentDeep: 0x0066cc,
  ice: 0xbfe3ff,
  steel: 0x7f8fa0,
  steelDark: 0x2b333c,
  graphite: 0x1b2026,
  ground: 0x06080b,
  alu: 0xd3dbe3,
  coolant: 0xeef5f8,
  screen: 0xf3f4ef,
};

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, x) => a + (b - a) * x;
export const smooth = (a, b, x) => {
  const u = clamp((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
export const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = (x) => {
  const u = clamp(x);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
export const easeOutBack = (x) => {
  const u = clamp(x) - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
};
export const fract = (x) => x - Math.floor(x);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box centred on the origin with flat chamfered edges, so every edge catches a highlight.
export function chamferBox(w, h, d, b = 0.04) {
  const x = w / 2 - b;
  const z = d / 2 - b;
  const s = new THREE.Shape();
  s.moveTo(-x, -z);
  s.lineTo(x, -z);
  s.lineTo(x, z);
  s.lineTo(-x, z);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: h - 2 * b,
    bevelEnabled: true,
    bevelSize: b,
    bevelThickness: b,
    bevelSegments: 1,
    steps: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b - h / 2, 0);
  return g;
}

export function metal(color, roughness = 0.3, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness, ...extra });
}

// A light source you can see: an emissive bar. Values above 1 survive into tone mapping.
export function strip(w, h, d, color, power) {
  const c = new THREE.Color(color).multiplyScalar(power);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c }));
  m.material.fog = false;
  return m;
}

// Studio environment for reflections: a dark room with a few hard light bars.
export function makeEnvironment(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x020304);
  const add = (w, h, d, x, y, z, color, power) => {
    const m = strip(w, h, d, color, power);
    m.position.set(x, y, z);
    s.add(m);
  };
  add(14, 0.2, 5, 0, 9, 0, 0xffffff, 7); // overhead key
  add(0.6, 9, 9, -11, 2, -2, 0x9fd4ff, 9); // ice rim, left
  add(0.6, 7, 6, 11, 1, 3, 0x3f7fd0, 5); // steel-blue rim, right
  add(16, 1.2, 0.4, 0, 1.2, -12, 0xcfe6ff, 4); // low back bar
  add(10, 0.5, 0.4, 0, 5, 12, 0xffffff, 3); // front fill
  add(1.2, 0.2, 1.2, 5, 9, -5, 0x2997ff, 14); // blue accent
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ color: 0x0b1118 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4;
  s.add(floor);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.03).texture;
  pm.dispose();
  return tex;
}

// Soft round sprite texture for out-of-focus lights.
export function bokehTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.72, 'rgba(255,255,255,0.75)');
  r.addColorStop(0.86, 'rgba(255,255,255,0.95)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- Shared machine parts -------------------------------------------------

// Helical end mill, axis +Y, tip at y = 0, flutes up to y = L.
export function endMillGeometry(R = 0.5, L = 2.6, flutes = 4, helixDeg = 38) {
  const N = 128;
  const M = 96;
  const core = 0.56;
  const twistPerY = Math.tan((helixDeg * Math.PI) / 180) / R;
  const pos = [];
  const idx = [];
  const prof = (f) => {
    const g = f < 0.62 ? 0.5 + 0.5 * Math.cos((Math.PI * f) / 0.62) : Math.pow((f - 0.62) / 0.38, 2.4);
    return R * (core + (1 - core) * g);
  };
  for (let j = 0; j <= M; j++) {
    const y = (j / M) * L;
    const tw = y * twistPerY;
    // flutes run out into the round shank over the top 12 %
    const run = smooth(0.86, 1.0, j / M);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = lerp(prof(fract((i / N) * flutes)), R, run);
      pos.push(r * Math.cos(a + tw), y, r * Math.sin(a + tw));
    }
  }
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * N + i;
      const b = j * N + ((i + 1) % N);
      const c = a + N;
      const d = b + N;
      idx.push(a, c, b, b, c, d);
    }
  }
  // flat tip with its own vertices (hard edge)
  const base = pos.length / 3;
  pos.push(0, 0.06, 0);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = prof(fract((i / N) * flutes));
    pos.push(r * Math.cos(a), 0, r * Math.sin(a));
  }
  for (let i = 0; i < N; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % N));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Cutter + shank + holder as one group. Spin `group.userData.spin` about Y.
export function buildSpindle() {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const R = 0.5;
  const L = 2.6;
  const cutter = new THREE.Mesh(endMillGeometry(R, L), metal(0xa9c4dc, 0.16));
  cutter.castShadow = true;
  spin.add(cutter);
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1.3, 64), metal(0xc4ccd4, 0.22));
  shank.position.y = L + 0.65;
  shank.castShadow = true;
  spin.add(shank);
  // collet nut + taper, turned profile
  const p = [
    [0.5, 0], [0.92, 0], [1.0, 0.08], [1.0, 0.5], [0.94, 0.56], [0.94, 0.62], [1.0, 0.68],
    [1.0, 1.0], [0.9, 1.1], [0.9, 1.25], [1.25, 2.3], [1.25, 2.45], [1.75, 2.5], [1.8, 2.56],
    [1.8, 2.8], [1.62, 2.84], [1.62, 3.0], [1.8, 3.04], [1.8, 3.3], [1.5, 3.4], [1.5, 6.5],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const holder = new THREE.Mesh(new THREE.LatheGeometry(p, 96), metal(0x39434d, 0.34));
  holder.position.y = L + 1.2;
  holder.castShadow = true;
  spin.add(holder);
  // six wrench flats on the nut, so the turn is visible
  const flat = chamferBox(0.26, 0.36, 0.1, 0.02);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const f = new THREE.Mesh(flat, metal(0x1c232a, 0.5));
    f.position.set(Math.cos(a) * 1.0, L + 1.2 + 0.28, Math.sin(a) * 1.0);
    f.rotation.y = -a + Math.PI / 2;
    spin.add(f);
  }
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.262, 1.262, 0.1, 96, 1, true), metal(COL.accent, 0.3));
  band.position.y = L + 1.2 + 2.375;
  spin.add(band);
  group.userData.spin = spin;
  group.userData.cutter = cutter;
  return group;
}

// Spur gear in the XY plane, extruded along Z, centred.
export function gearGeometry(teeth, mod, thick, bore, holes = 0) {
  const rp = (mod * teeth) / 2;
  const ro = rp + mod;
  const rr = rp - 1.25 * mod;
  const s = new THREE.Shape();
  const tau = (Math.PI * 2) / teeth;
  const stops = [[0, rr], [0.22, rr], [0.38, ro], [0.62, ro], [0.78, rr]];
  for (let i = 0; i < teeth; i++) {
    for (const [f, r] of stops) {
      const a = (i + f) * tau;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0 && f === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
  }
  s.closePath();
  const hole = (cx, cy, r) => {
    const h = new THREE.Path();
    h.absarc(cx, cy, r, 0, Math.PI * 2, true);
    s.holes.push(h);
  };
  hole(0, 0, bore);
  const hr = (rr - bore) * 0.3;
  const hd = (rr + bore) * 0.5;
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2;
    hole(Math.cos(a) * hd, Math.sin(a) * hd, hr);
  }
  const b = Math.min(0.05, mod * 0.2);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thick - 2 * b,
    bevelEnabled: true,
    bevelSize: b,
    bevelThickness: b,
    bevelSegments: 1,
    curveSegments: 40,
  });
  g.translate(0, 0, -thick / 2 + b);
  g.userData = { rp };
  return g;
}

// Canvas text helper used by the screen, the key legends and the engraving.
export const FONT_MONO = '"Hero Mono", monospace';
export const FONT_DIN = '"Hero Din", "Hero Mono", sans-serif';
