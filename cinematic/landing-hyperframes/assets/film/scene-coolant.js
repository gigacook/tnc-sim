// Shot 3: milky coolant macro. Two jets flood the cutter tip; the pool ripples,
// droplets fly, out-of-focus lights hang in the dark behind.
import { THREE, COL, clamp, lerp, fract, easeInOut, mulberry32, metal, chamferBox, buildSpindle, bokehTexture } from './util.js';

const IMPACTS = [new THREE.Vector3(-0.42, 0.06, 0.34), new THREE.Vector3(0.5, 0.06, 0.26)];
const NOZZLES = [new THREE.Vector3(-3.3, 2.5, 1.5), new THREE.Vector3(3.1, 2.9, 0.9)];

function milk() {
  return new THREE.MeshPhysicalMaterial({
    color: COL.coolant,
    roughness: 0.1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    emissive: 0x24506e,
    emissiveIntensity: 0.22,
    envMapIntensity: 1.3,
  });
}

export function buildCoolant(env) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080c);
  scene.fog = new THREE.FogExp2(0x05080c, 0.03);
  scene.environment = env;
  scene.environmentIntensity = 1.0;
  const camera = new THREE.PerspectiveCamera(23, 16 / 9, 0.1, 120);

  const spindle = buildSpindle();
  spindle.position.set(0, -0.2, 0);
  scene.add(spindle);

  const block = new THREE.Mesh(chamferBox(11, 1.4, 6.4, 0.06), metal(COL.alu, 0.32));
  block.position.y = -0.7;
  block.receiveShadow = true;
  scene.add(block);

  // the pool: a displaced sheet, recomputed for each frame from time alone
  const NX = 150;
  const NZ = 96;
  const poolGeo = new THREE.PlaneGeometry(10.6, 6.0, NX, NZ);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(poolGeo, milk());
  pool.position.y = 0.02;
  pool.receiveShadow = true;
  scene.add(pool);
  const base = poolGeo.attributes.position.array.slice();

  // jets
  const jetMat = milk();
  const jets = NOZZLES.map(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), jetMat);
    m.castShadow = true;
    scene.add(m);
    return m;
  });
  // segmented hoses behind the nozzles
  const hoseMat = metal(0x2f6fb8, 0.36);
  const tipMat = metal(0xc7d0d9, 0.2);
  NOZZLES.forEach((n, k) => {
    const dir = n.clone().sub(IMPACTS[k]).normalize();
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.55, 32), tipMat);
    tip.position.copy(n);
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate());
    tip.castShadow = true;
    scene.add(tip);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.27, 28, 20), hoseMat);
      s.position.copy(n).addScaledVector(dir, 0.42 + i * 0.36);
      s.position.y += i * i * 0.03;
      s.castShadow = true;
      scene.add(s);
    }
  });

  // droplets: each one repeats a short ballistic arc
  const rnd = mulberry32(57);
  const DROPS = 150;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 12, 10), milk(), DROPS);
  const dd = [];
  for (let i = 0; i < DROPS; i++) {
    const src = i % 3; // 0,1: jet impacts, 2: flung off the cutter
    const a = rnd() * Math.PI * 2;
    const sp = 0.9 + rnd() * 1.9;
    const up = 1.6 + rnd() * 2.6;
    dd.push({
      src,
      a,
      vx: Math.cos(a) * sp * (src === 2 ? 1.7 : 1),
      vz: Math.sin(a) * sp * (src === 2 ? 1.7 : 1),
      vy: src === 2 ? 0.6 + rnd() * 1.4 : up,
      period: 0.45 + rnd() * 0.5,
      phase: rnd(),
      size: 0.5 + rnd() * 1.6,
      y0: src === 2 ? 0.3 + rnd() * 1.2 : 0.08,
    });
  }
  scene.add(drops);

  // foam on the sheet
  const FOAM = 90;
  const foam = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 12, 8), milk(), FOAM);
  const ff = [];
  for (let i = 0; i < FOAM; i++) ff.push({ a: rnd() * Math.PI * 2, r: 0.9 + rnd() * 3.4, s: 0.4 + rnd() * 1.5, w: 0.2 + rnd() * 0.5 });
  scene.add(foam);

  // out-of-focus lights
  const bk = bokehTexture();
  for (let i = 0; i < 26; i++) {
    const blue = rnd() < 0.55;
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: bk,
        color: new THREE.Color(blue ? COL.accent : COL.ice).multiplyScalar(blue ? 1.1 : 0.55),
        transparent: true,
        opacity: 0.1 + rnd() * 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    const s = 0.7 + rnd() * 1.9;
    m.scale.set(s, s, 1);
    m.position.set(-13 + rnd() * 26, 0.6 + rnd() * 6.5, -9 - rnd() * 9);
    scene.add(m);
  }

  const key = new THREE.SpotLight(0xf2f8ff, 900, 40, 0.5, 0.7, 2);
  key.position.set(5, 9, 7);
  key.target.position.set(0, 0.3, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const rim = new THREE.PointLight(COL.accent, 420, 30, 2);
  rim.position.set(-6, 2.2, -4);
  scene.add(rim);
  const rim2 = new THREE.PointLight(0xbfe3ff, 200, 30, 2);
  rim2.position.set(6, 1.4, -3);
  scene.add(rim2);

  const height = (x, z, t) => {
    let h = 0;
    for (let k = 0; k < 2; k++) {
      const d = Math.hypot(x - IMPACTS[k].x, z - IMPACTS[k].z);
      h += 0.05 * Math.sin(9.5 * d - 10.5 * t + k * 1.7) * Math.exp(-0.55 * d);
      h += 0.11 * Math.exp(-d * d * 5.5); // the mound where the jet lands
    }
    const dc = Math.hypot(x, z);
    h += 0.16 * Math.exp(-Math.pow((dc - 0.58) * 5.5, 2)); // bow wave around the cutter
    h += 0.012 * Math.sin(3.1 * x + 2.2 * t) * Math.sin(2.7 * z - 1.6 * t);
    // sheet thins out to the block edge
    const edge = Math.min(5.3 - Math.abs(x), 3.0 - Math.abs(z));
    return h * clamp(edge * 1.4) - 0.05 * (1 - clamp(edge * 2.2));
  };

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < 9; i++) pts.push(new THREE.Vector3());

  function update(tau) {
    const a = tau + 0.6;
    spindle.userData.spin.rotation.y = -a * Math.PI * 1.6;

    const p = poolGeo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) p[i + 1] = height(base[i], base[i + 2], a);
    poolGeo.attributes.position.needsUpdate = true;
    poolGeo.computeVertexNormals();

    jets.forEach((jet, k) => {
      const n = NOZZLES[k];
      const hit = IMPACTS[k];
      for (let i = 0; i < pts.length; i++) {
        const s = i / (pts.length - 1);
        const wob = 0.035 * Math.sin(s * 9 - a * 13 + k * 2) * s;
        pts[i].set(lerp(n.x, hit.x, s) + wob, lerp(n.y, hit.y, s * s * 0.55 + s * 0.45), lerp(n.z, hit.z, s) + wob * 0.6);
      }
      jet.geometry.dispose();
      jet.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((x) => x.clone())), 48, 0.085, 14, false);
    });

    dd.forEach((d, i) => {
      const t = fract(a / d.period + d.phase) * d.period;
      const o = d.src === 2 ? null : IMPACTS[d.src];
      const ox = o ? o.x : Math.cos(d.a) * 0.52;
      const oz = o ? o.z : Math.sin(d.a) * 0.52;
      v.set(ox + d.vx * t, d.y0 + d.vy * t - 4.9 * t * t * 2.2, oz + d.vz * t);
      const life = t / d.period;
      sc.setScalar(v.y < 0.04 ? 0.0001 : d.size * (1 - life * 0.55));
      drops.setMatrixAt(i, m4.compose(v, q, sc));
    });
    drops.instanceMatrix.needsUpdate = true;

    ff.forEach((f, i) => {
      const r = 0.7 + fract(f.r / 4.3 + a * 0.08 * f.w) * 4.2;
      const x = Math.cos(f.a) * r * 1.15;
      const z = Math.sin(f.a) * r * 0.62;
      v.set(x, height(x, z, a) + 0.035, z);
      sc.set(f.s, f.s * 0.5, f.s);
      foam.setMatrixAt(i, m4.compose(v, q, sc));
    });
    foam.instanceMatrix.needsUpdate = true;

    const u = easeInOut(clamp(a / 3.5) * 0.86 + 0.07);
    camera.position.set(lerp(-4.6, -1.3, u), lerp(0.75, 1.15, u), lerp(6.4, 5.5, u));
    camera.lookAt(lerp(-0.5, 0.15, u), lerp(0.75, 0.6, u), 0);
    camera.rotateZ(lerp(-0.07, 0.02, u));
  }
  return { scene, camera, update, exposure: 0.82 };
}
