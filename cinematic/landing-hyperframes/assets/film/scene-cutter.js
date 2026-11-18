// Shot 2: reflective cutter and gears. A slow, low orbit around a turning end mill
// with a meshing gear train behind it.
import { THREE, COL, clamp, lerp, easeInOut, metal, strip, chamferBox, buildSpindle, gearGeometry } from './util.js';

export function buildCutter(env) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.ground);
  scene.fog = new THREE.FogExp2(COL.ground, 0.028);
  scene.environment = env;
  scene.environmentIntensity = 1.0;
  const camera = new THREE.PerspectiveCamera(27, 16 / 9, 0.1, 120);

  const spindle = buildSpindle();
  spindle.position.set(1.1, 0.7, 0);
  scene.add(spindle);

  // gear train, facing the camera
  const MOD = 0.26;
  const specs = [
    { n: 34, x: -4.6, y: 3.4, color: 0x8b99a8, rough: 0.3, holes: 6, thick: 0.9 },
    { n: 17, color: COL.accent, rough: 0.3, holes: 0, thick: 1.1, ang: -0.62 },
    { n: 26, color: 0x55626f, rough: 0.36, holes: 5, thick: 0.8, ang: 0.95 },
  ];
  const gears = [];
  const train = new THREE.Group();
  train.position.z = -5.0;
  specs.forEach((s, i) => {
    const g = gearGeometry(s.n, MOD, s.thick, i === 1 ? 0.5 : 0.8, s.holes);
    const m = new THREE.Mesh(g, metal(s.color, s.rough));
    m.castShadow = true;
    m.receiveShadow = true;
    if (i === 0) m.position.set(s.x, s.y, 0);
    else {
      const prev = gears[i - 1];
      const dist = prev.rp + g.userData.rp;
      m.position.set(prev.mesh.position.x + Math.cos(s.ang) * dist, prev.mesh.position.y + Math.sin(s.ang) * dist, 0);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(i === 1 ? 0.5 : 0.8, i === 1 ? 0.5 : 0.8, s.thick + 0.5, 48), metal(0x1c232a, 0.22));
    hub.rotation.x = Math.PI / 2;
    hub.position.copy(m.position);
    train.add(m, hub);
    gears.push({ mesh: m, rp: g.userData.rp, n: s.n, ang: s.ang ?? 0 });
  });
  scene.add(train);

  // back plate the train is mounted on
  const plate = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 0.6), metal(0x151b21, 0.42));
  plate.position.set(0, 6, -6.2);
  plate.receiveShadow = true;
  scene.add(plate);
  for (let i = 0; i < 12; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.18, 30, 0.3), metal(0x232c35, 0.3));
    rib.position.set(-22 + i * 4, 6, -5.8);
    scene.add(rib);
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), metal(0x10161c, 0.2));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // work piece the tip hovers over
  const block = new THREE.Mesh(chamferBox(5.4, 0.5, 3.4, 0.06), metal(0x66778a, 0.34));
  block.position.set(1.1, 0.25, 0);
  block.receiveShadow = true;
  block.castShadow = true;
  scene.add(block);

  const bar1 = strip(0.14, 9, 0.14, COL.ice, 4);
  bar1.position.set(9.5, 4.5, -5.6);
  const bar2 = strip(0.14, 9, 0.14, COL.accent, 6);
  bar2.position.set(-11.5, 4.5, -5.6);
  scene.add(bar1, bar2);

  const key = new THREE.SpotLight(0xe8f2ff, 900, 60, 0.42, 0.7, 2);
  key.position.set(9, 12, 10);
  key.target.position.set(0, 2.5, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const rim = new THREE.PointLight(COL.accent, 900, 40, 2);
  rim.position.set(-9, 5, -2.5);
  scene.add(rim);
  const kick = new THREE.PointLight(0xbfe3ff, 260, 30, 2);
  kick.position.set(5, 1.2, 4);
  scene.add(kick);

  function update(tau) {
    const a = tau + 0.6;
    spindle.userData.spin.rotation.y = -a * Math.PI * 1.1;
    spindle.position.y = 0.7 - 0.12 * easeInOut(clamp(a / 3.4));
    // meshing train: each gear turns against the one before it
    let w = 0.55;
    gears.forEach((g, i) => {
      if (i === 0) {
        g.mesh.rotation.z = a * w;
        return;
      }
      const prev = gears[i - 1];
      w = (-w * prev.n) / g.n;
      // phase so a tooth meets a gap on the line of centres
      const base = g.ang + Math.PI - ((g.ang * prev.n) / g.n) * -1 + Math.PI / g.n;
      g.mesh.rotation.z = base - (prev.mesh.rotation.z * prev.n) / g.n;
    });
    const u = easeInOut(clamp(a / 3.9) * 0.86 + 0.07);
    const az = lerp(-0.5, 0.2, u);
    const rad = lerp(10.2, 8.4, u);
    camera.position.set(1.1 + Math.sin(az) * rad, lerp(1.15, 1.9, u), Math.cos(az) * rad);
    camera.lookAt(lerp(-0.4, 0.5, u), lerp(2.7, 2.2, u), -1.2);
  }
  return { scene, camera, update, exposure: 1.0 };
}
