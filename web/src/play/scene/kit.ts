// Building blocks of the workshop scene: palette, procedural textures, materials and mesh helpers.
// UI colours come from the brand tokens (read from CSS at run time); material colours of steel, paint and
// concrete are defined here in HSL, so no colour literal is pasted from anywhere.
import * as THREE from 'three';

export const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(h / 360, s / 100, l / 100);
const css = (h: number, s: number, l: number, a = 1) => `hsl(${h} ${s}% ${l}% / ${a})`;

/** A brand token as a colour (the dark value: Play runs with data-theme="dark"). */
export function token(name: string, fallback: THREE.Color): THREE.Color {
  try {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    probe.setAttribute('data-theme', 'dark');
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    const m = v.match(/[\d.]+/g);
    if (m && m.length >= 3) return new THREE.Color(+m[0] / 255, +m[1] / 255, +m[2] / 255);
  } catch {
    /* no DOM colour: the fallback */
  }
  return fallback;
}

export interface Palette {
  accent: THREE.Color;
  warning: THREE.Color;
  danger: THREE.Color;
  success: THREE.Color;
  ink: THREE.Color;
}
export function readPalette(): Palette {
  return {
    accent: token('--gc-accent', hsl(210, 100, 58)),
    warning: token('--gc-warning', hsl(36, 100, 52)),
    danger: token('--gc-danger', hsl(3, 100, 69)),
    success: token('--gc-success', hsl(135, 64, 50)),
    ink: token('--gc-ink', hsl(240, 11, 96)),
  };
}
const cssOf = (c: THREE.Color, a = 1) => `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)} / ${a})`;

/** Everything created through a Kit is tracked and released by dispose(). */
export class Kit {
  readonly pal: Palette;
  private readonly textures: THREE.Texture[] = [];
  private readonly mats = new Map<string, THREE.Material>();
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private seed = 5511;
  readonly maxAniso: number;

  constructor(maxAniso: number) {
    this.pal = readPalette();
    this.maxAniso = maxAniso;
  }

  /** deterministic noise: the shop looks the same on every visit */
  rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.maxAniso);
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    this.textures.push(t);
    return t;
  }

  /** sealed concrete: speckle, trowel clouds, a few oil stains, saw-cut joints */
  concrete(repeat: [number, number]): THREE.CanvasTexture {
    return this.canvasTex(
      512,
      512,
      (g, w, h) => {
        g.fillStyle = css(214, 7, 34);
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 26; i++) {
          const r = 40 + this.rnd() * 120;
          const x = this.rnd() * w;
          const y = this.rnd() * h;
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, css(214, 8, this.rnd() < 0.5 ? 40 : 29, 0.22));
          gr.addColorStop(1, css(214, 8, 34, 0));
          g.fillStyle = gr;
          g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        for (let i = 0; i < 9000; i++) {
          g.fillStyle = css(210, 6, 20 + this.rnd() * 36, 0.35);
          g.fillRect(this.rnd() * w, this.rnd() * h, 1.2, 1.2);
        }
        g.strokeStyle = css(214, 10, 18, 0.7);
        g.lineWidth = 2;
        g.strokeRect(1, 1, w - 2, h - 2);
      },
      repeat,
    );
  }

  /** brushed sheet metal: fine horizontal streaks */
  brushed(light: number, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
    return this.canvasTex(
      256,
      256,
      (g, w, h) => {
        g.fillStyle = css(210, 8, light);
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y++) {
          g.fillStyle = css(210, 8, light + (this.rnd() - 0.5) * 14, 0.5);
          g.fillRect(0, y, w, 1);
        }
      },
      repeat,
    );
  }

  /** folded cladding: vertical ribs with screws */
  cladding(light: number, repeat: [number, number]): THREE.CanvasTexture {
    return this.canvasTex(
      256,
      256,
      (g, w, h) => {
        for (let x = 0; x < w; x += 32) {
          const gr = g.createLinearGradient(x, 0, x + 32, 0);
          gr.addColorStop(0, css(212, 12, light - 7));
          gr.addColorStop(0.18, css(212, 12, light + 6));
          gr.addColorStop(0.8, css(212, 12, light));
          gr.addColorStop(1, css(212, 14, light - 10));
          g.fillStyle = gr;
          g.fillRect(x, 0, 32, h);
        }
        g.fillStyle = css(212, 10, light - 16);
        for (let x = 16; x < w; x += 64) for (let y = 20; y < h; y += 108) g.fillRect(x - 2, y - 2, 4, 4);
        g.fillStyle = css(212, 14, light - 12, 0.6);
        g.fillRect(0, h - 3, w, 3);
      },
      repeat,
    );
  }

  /** warning chevrons for floor zones and guards */
  hazard(repeat: [number, number]): THREE.CanvasTexture {
    const warn = this.pal.warning;
    return this.canvasTex(
      128,
      128,
      (g, w, h) => {
        g.fillStyle = cssOf(warn);
        g.fillRect(0, 0, w, h);
        g.fillStyle = css(220, 10, 8);
        for (let i = -2; i < 4; i++) {
          g.beginPath();
          g.moveTo(i * 64, 0);
          g.lineTo(i * 64 + 32, 0);
          g.lineTo(i * 64 + 32 + h, h);
          g.lineTo(i * 64 + h, h);
          g.closePath();
          g.fill();
        }
      },
      repeat,
    );
  }

  /** a text plate: nameplates, door signs, screens */
  plate(lines: string[], o: { w?: number; h?: number; bg?: string; fg?: string; border?: string; mono?: boolean; size?: number } = {}): THREE.CanvasTexture {
    const w = o.w ?? 512;
    const h = o.h ?? 256;
    return this.canvasTex(w, h, (g) => {
      g.fillStyle = o.bg ?? css(215, 14, 12);
      g.fillRect(0, 0, w, h);
      g.strokeStyle = o.border ?? cssOf(this.pal.ink, 0.5);
      g.lineWidth = 6;
      g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = o.fg ?? cssOf(this.pal.ink);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const size = o.size ?? Math.min(h / (lines.length + 0.6), (w * 1.7) / Math.max(...lines.map((l) => l.length), 3));
      g.font = `700 ${size}px ${o.mono ? 'ui-monospace, Consolas, monospace' : '"Segoe UI", system-ui, sans-serif'}`;
      lines.forEach((l, i) => {
        g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.15);
      });
    });
  }

  /** the picture on a controller screen: a light program page with dark monospaced lines */
  screen(title: string, rows: string[]): THREE.CanvasTexture {
    return this.canvasTex(512, 384, (g, w, h) => {
      g.fillStyle = css(70, 12, 92);
      g.fillRect(0, 0, w, h);
      g.fillStyle = css(213, 30, 22);
      g.fillRect(0, 0, w, 54);
      g.fillStyle = css(70, 12, 94);
      g.font = '700 30px ui-monospace, Consolas, monospace';
      g.textBaseline = 'middle';
      g.fillText(title, 18, 28);
      g.fillStyle = css(215, 20, 14);
      g.font = '24px ui-monospace, Consolas, monospace';
      rows.forEach((r, i) => {
        g.fillText(r, 18, 88 + i * 34);
      });
      g.fillStyle = cssOf(this.pal.accent, 0.9);
      g.fillRect(0, 88 + 2 * 34 - 16, 8, 32);
      for (let i = 0; i < 8; i++) {
        g.strokeStyle = css(213, 20, 40);
        g.lineWidth = 2;
        g.strokeRect(6 + i * 63, h - 44, 58, 38);
      }
    });
  }

  /** a shared material by name; `make` runs once */
  mat<T extends THREE.Material>(name: string, make: () => T): T {
    const have = this.mats.get(name);
    if (have) return have as T;
    const m = make();
    this.mats.set(name, m);
    return m;
  }
  std(name: string, color: THREE.Color, rough: number, metal: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return this.mat(name, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
  }

  // the shop's material set
  get steel() {
    return this.std('steel', hsl(212, 10, 62), 0.36, 0.92);
  }
  get darkSteel() {
    return this.std('darkSteel', hsl(215, 12, 22), 0.5, 0.85);
  }
  get ground() {
    return this.std('ground', hsl(210, 6, 78), 0.18, 1);
  }
  get cast() {
    return this.std('cast', hsl(158, 12, 27), 0.58, 0.3);
  }
  get castDark() {
    return this.std('castDark', hsl(158, 12, 17), 0.62, 0.3);
  }
  get shell() {
    return this.std('shell', hsl(208, 10, 78), 0.42, 0.35);
  }
  get shellDark() {
    return this.std('shellDark', hsl(213, 16, 24), 0.48, 0.45);
  }
  get rubber() {
    return this.std('rubber', hsl(220, 8, 7), 0.9, 0);
  }
  get plastic() {
    return this.std('plastic', hsl(215, 10, 14), 0.55, 0.05);
  }
  get wood() {
    return this.std('wood', hsl(30, 32, 36), 0.78, 0);
  }
  get glass() {
    return this.mat('glass', () => new THREE.MeshStandardMaterial({ color: hsl(200, 40, 70), roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false }));
  }
  get accent() {
    return this.std('accent', this.pal.accent, 0.45, 0.3);
  }
  get accentGlow() {
    return this.mat('accentGlow', () => new THREE.MeshBasicMaterial({ color: this.pal.accent }));
  }
  get coolantBlue() {
    return this.std('coolantBlue', hsl(204, 60, 40), 0.4, 0.05);
  }
  get milky() {
    return this.std('milky', hsl(190, 22, 84), 0.25, 0, { transparent: true, opacity: 0.86 });
  }

  /** geometry cache for shapes used many times */
  geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const have = this.geos.get(key);
    if (have) return have;
    const g = make();
    this.geos.set(key, g);
    return g;
  }

  box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  /** a cylinder standing on Y; `axis` lays it along x or z */
  cyl(parent: THREE.Object3D, rTop: number, rBot: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, axis: 'x' | 'y' | 'z' = 'y', seg = 20): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(`c${rTop}|${rBot}|${h}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBot, h, seg)), m);
    mesh.position.set(x, y, z);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  /** a flat picture (label, screen, decal) facing +Z of its parent */
  sign(parent: THREE.Object3D, w: number, h: number, tex: THREE.Texture, x = 0, y = 0, z = 0, glow = 0): THREE.Mesh {
    const m = glow > 0 ? new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: glow, roughness: 0.4 }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  /** a cable or hose through points */
  tube(parent: THREE.Object3D, pts: [number, number, number][], r: number, m: THREE.Material): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), r, 6), m);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  dispose(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const ms = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of ms) m.dispose();
    });
    for (const t of this.textures) t.dispose();
    for (const m of this.mats.values()) m.dispose();
    for (const g of this.geos.values()) g.dispose();
    this.textures.length = 0;
    this.mats.clear();
    this.geos.clear();
  }
}

/** Axis-aligned footprint on the floor that the player cannot enter. */
export interface Solid {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export const solid = (cx: number, cz: number, w: number, d: number): Solid => ({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
