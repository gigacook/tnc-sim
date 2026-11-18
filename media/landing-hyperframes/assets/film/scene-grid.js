// Shot 1: mechanical grid reveal. A field of steel blocks locks into place from the
// centre outwards over a blue light well; a laser grid draws across the seams.
import { THREE, COL, clamp, lerp, easeOut, easeInOut, easeOutBack, mulberry32, chamferBox, metal, strip, gearGeometry } from './util.js';

const COLS = 60;
const ROWS = 48;
const PITCH = 1.0;
const HOLE = 4.15; // radius kept free for the ring in the middle

export function buildGrid(env) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.ground);
  scene.fog = new THREE.FogExp2(COL.ground, 0.05);
  scene.environment = env;
  scene.environmentIntensity = 0.75;
  const camera = new THREE.PerspectiveCamera(31, 16 / 9, 0.1, 120);

  // light well under the blocks
  const well = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS + 6, ROWS + 6),
    new THREE.ShaderMaterial({
      uniforms: { uR: { value: 0 }, uC: { value: new THREE.Color(COL.accent) }, uPulse: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uR; uniform float uPulse; uniform vec3 uC; varying vec2 vP;
        void main(){ float d = length(vP); float on = smoothstep(uR, uR - 2.5, d);
          float ring = exp(-pow((d - uPulse) * 0.8, 2.0));
          vec3 c = uC * (1.5 + 3.0 * ring) * on; c += vec3(0.75, 0.9, 1.0) * ring * on * 1.5;
          gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  well.rotation.x = -Math.PI / 2;
  well.position.y = -0.34;
  scene.add(well);

  // the blocks
  const rnd = mulberry32(5511);
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = (c - (COLS - 1) / 2) * PITCH;
      const z = (r - (ROWS - 1) / 2) * PITCH;
      const d = Math.hypot(x, z);
      if (d < HOLE) {
        rnd(); rnd(); rnd();
        continue;
      }
      const j = rnd();
      const tall = rnd() < 0.085 && d > 6.5 ? 0.25 + rnd() * 0.9 : (rnd(), 0);
      cells.push({ x, z, d, j, tall });
    }
  }
  const tileGeo = chamferBox(0.9, 0.5, 0.9, 0.035);
  const tiles = new THREE.InstancedMesh(tileGeo, metal(0xffffff, 0.3), cells.length);
  tiles.castShadow = true;
  tiles.receiveShadow = true;
  const tint = new THREE.Color();
  cells.forEach((c, i) => {
    const v = 0.2 + c.j * 0.16;
    tint.setRGB(v * 0.86, v * 0.95, v * 1.08);
    if (c.tall > 0.7) tint.setRGB(0.05, 0.22, 0.52);
    tiles.setColorAt(i, tint);
  });
  scene.add(tiles);

  // centre piece: a toothed ring around a polished disc
  const ring = new THREE.Mesh(gearGeometry(44, 0.17, 0.5, 2.85, 0), metal(0x8fa3b6, 0.24));
  ring.rotation.x = -Math.PI / 2;
  ring.castShadow = true;
  ring.receiveShadow = true;
  scene.add(ring);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 2.62, 0.5, 96), metal(0x1d252e, 0.14));
  disc.receiveShadow = true;
  scene.add(disc);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.3, 48), metal(COL.accent, 0.28));
  scene.add(hub);

  // laser grid: thin lit bars in the seams, revealed by distance from the centre
  const barGeo = new THREE.BufferGeometry();
  {
    const p = [];
    const a = [];
    const quad = (x0, z0, x1, z1, w) => {
      const horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const dx = horiz ? 0 : w;
      const dz = horiz ? w : 0;
      const d0 = Math.hypot(x0, z0);
      const d1 = Math.hypot(x1, z1);
      p.push(x0 - dx, 0, z0 - dz, x1 - dx, 0, z1 - dz, x1 + dx, 0, z1 + dz, x0 - dx, 0, z0 - dz, x1 + dx, 0, z1 + dz, x0 + dx, 0, z0 + dz);
      a.push(d0, d1, d1, d0, d1, d0);
    };
    const STEP = 4;
    for (let c = -COLS / 2; c <= COLS / 2; c += STEP) {
      for (let r = -ROWS / 2; r < ROWS / 2; r += 1) {
        if (Math.hypot(c, r + 0.5) < HOLE + 0.3) continue;
        quad(c, r, c, r + 1, 0.03);
      }
    }
    for (let r = -ROWS / 2 + 1; r <= ROWS / 2; r += STEP) {
      for (let c = -COLS / 2; c < COLS / 2; c += 1) {
        if (Math.hypot(c + 0.5, r) < HOLE + 0.3) continue;
        quad(c, r, c + 1, r, 0.03);
      }
    }
    barGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    barGeo.setAttribute('aD', new THREE.Float32BufferAttribute(a, 1));
  }
  const bars = new THREE.Mesh(
    barGeo,
    new THREE.ShaderMaterial({
      uniforms: { uR: { value: 0 }, uC: { value: new THREE.Color(0x6fbaff) } },
      vertexShader: 'attribute float aD; varying float vD; void main(){ vD = aD; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uR; uniform vec3 uC; varying float vD;
        void main(){ float on = step(vD, uR); float head = exp(-max(uR - vD, 0.0) * 0.9);
          gl_FragColor = vec4(uC * (1.6 + 5.0 * head) * on, on); }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  bars.position.y = 0.262;
  scene.add(bars);

  // far light bars for depth
  const far = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const s = strip(0.12, 6 + (i % 3) * 2.5, 0.12, i % 3 === 1 ? COL.accent : COL.ice, i % 3 === 1 ? 4 : 1.1);
    s.position.set(-30 + i * 7.5, 3 + (i % 3), -27 - (i % 2) * 6);
    far.add(s);
  }
  scene.add(far);

  const key = new THREE.SpotLight(0xdcecff, 900, 80, 0.5, 0.6, 2);
  key.position.set(9, 16, 10);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const rim = new THREE.PointLight(COL.accent, 500, 60, 2);
  rim.position.set(-10, 3, -12);
  scene.add(rim);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  // tau: seconds since the shot's cut; the pre-roll (tau < 0) is already animated
  function update(tau) {
    const a = tau + 1.0;
    const front = a * 10; // radius the build has reached
    cells.forEach((c, i) => {
      const p = clamp((a - (c.d - HOLE) * 0.085 - c.j * 0.22) / 0.62);
      const wave = 0.22 * Math.exp(-Math.pow((c.d - (a - 1.7) * 9.5) * 0.55, 2));
      const y = lerp(-2.4, 0, easeOutBack(p)) + wave + c.tall * easeOut(clamp((a - 1.3 - c.j) / 0.8));
      v.set(c.x, y, c.z);
      sc.setScalar(p <= 0 ? 0.0001 : 1);
      tiles.setMatrixAt(i, m4.compose(v, q, sc));
    });
    tiles.instanceMatrix.needsUpdate = true;
    well.material.uniforms.uR.value = front + 3;
    well.material.uniforms.uPulse.value = (a - 1.7) * 9.5;
    bars.material.uniforms.uR.value = Math.max(0, (a - 0.7) * 11);
    const up = easeOutBack(clamp(a / 0.9));
    ring.position.y = lerp(-1.6, 0.06, up);
    ring.rotation.z = -0.5 + a * 0.32;
    disc.position.y = lerp(-1.2, 0, easeOut(clamp(a / 0.6)));
    hub.position.y = disc.position.y + 0.36;
    const u = easeInOut(clamp(a / 4.2) * 0.9 + 0.05);
    camera.position.set(lerp(-9.5, -3.2, u), lerp(1.55, 2.5, u), lerp(15.5, 9.2, u));
    camera.lookAt(lerp(1.5, 0.2, u), 0.1, lerp(-1.5, -0.6, u));
  }
  return { scene, camera, update, exposure: 1.0 };
}
