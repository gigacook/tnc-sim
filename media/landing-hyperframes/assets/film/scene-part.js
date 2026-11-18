// Shot 5: workshop and part sweep. The finished plate (bolt circle at radius 57, first
// hole at 157.5 degrees, as in the program on the controller) sits in a vise; the
// camera sweeps low across it and pulls back into the shop.
import { THREE, COL, clamp, lerp, easeInOut, mulberry32, chamferBox, metal, strip, buildSpindle, FONT_DIN } from './util.js';

function toolMarks() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(430);
  for (let i = 0; i < 150; i++) {
    const v = 90 + Math.floor(rnd() * 90);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    g.arc(256, 256, 6 + i * 1.7, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function engraving() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,14,22,0.82)';
  g.font = `700 150px ${FONT_DIN}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('5511', 256, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildPart(env) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.ground);
  scene.fog = new THREE.FogExp2(COL.ground, 0.016);
  scene.environment = env;
  scene.environmentIntensity = 0.95;
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);

  // --- the part (1 unit = 10 mm) ---
  const part = new THREE.Group();
  const alu = metal(COL.alu, 0.24);
  const lower = new THREE.Mesh(chamferBox(14, 1.4, 14, 0.08), alu);
  lower.position.y = -1.3;
  lower.castShadow = true;
  lower.receiveShadow = true;
  part.add(lower);
  const top = new THREE.Shape();
  const H = 7;
  const CH = 1.1;
  top.moveTo(-H + CH, -H);
  top.lineTo(H - CH, -H);
  top.lineTo(H, -H + CH);
  top.lineTo(H, H - CH);
  top.lineTo(H - CH, H);
  top.lineTo(-H + CH, H);
  top.lineTo(-H, H - CH);
  top.lineTo(-H, -H + CH);
  top.closePath();
  const hole = (x, y, r) => {
    const p = new THREE.Path();
    p.absarc(x, y, r, 0, Math.PI * 2, true);
    top.holes.push(p);
  };
  hole(0, 0, 3.3);
  for (let k = 0; k < 8; k++) {
    const a = ((157.5 + k * 45) * Math.PI) / 180;
    hole(Math.cos(a) * 5.7, Math.sin(a) * 5.7, 0.5);
  }
  const upperGeo = new THREE.ExtrudeGeometry(top, { depth: 0.52, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1, curveSegments: 48 });
  upperGeo.rotateX(-Math.PI / 2);
  const upper = new THREE.Mesh(upperGeo, alu);
  upper.position.y = -0.56;
  upper.castShadow = true;
  upper.receiveShadow = true;
  part.add(upper);
  // pocket floor with tool marks
  const marks = toolMarks();
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb9c3cd, metalness: 1, roughness: 0.34, bumpMap: marks, bumpScale: 1.4 });
  const pocket = new THREE.Mesh(new THREE.CircleGeometry(3.3, 96), floorMat);
  pocket.rotation.x = -Math.PI / 2;
  pocket.position.y = -0.595;
  pocket.receiveShadow = true;
  part.add(pocket);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.6, 72), alu);
  boss.position.y = -0.3;
  boss.castShadow = true;
  part.add(boss);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.62, 48), metal(0x10161c, 0.4));
  bore.position.y = -0.3;
  part.add(bore);
  const eng = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.24), new THREE.MeshBasicMaterial({ map: engraving(), transparent: true, depthWrite: false }));
  eng.rotation.x = -Math.PI / 2;
  eng.position.set(4.0, 0.012, 5.3);
  part.add(eng);
  scene.add(part);

  // coolant left on the part
  const rnd = mulberry32(1157);
  const wet = new THREE.MeshPhysicalMaterial({ color: COL.coolant, roughness: 0.08, clearcoat: 1, emissive: 0x24506e, emissiveIntensity: 0.18 });
  for (let i = 0; i < 14; i++) {
    const s = 0.1 + rnd() * 0.24;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), wet);
    const a = rnd() * Math.PI * 2;
    const r = 3.6 + rnd() * 2.9;
    m.position.set(Math.cos(a) * r, 0.0, Math.sin(a) * r);
    m.scale.set(s * (0.8 + rnd() * 0.8), s * 0.3, s);
    part.add(m);
  }

  // --- vise and table ---
  const dark = metal(0x2a333d, 0.36);
  const jawGeo = chamferBox(15.6, 2.6, 2.4, 0.1);
  [-8.25, 8.25].forEach((z) => {
    const j = new THREE.Mesh(jawGeo, dark);
    j.position.set(0, -1.1, z);
    j.castShadow = true;
    j.receiveShadow = true;
    scene.add(j);
    const cap = new THREE.Mesh(chamferBox(15.6, 0.12, 2.4, 0.03), metal(COL.accent, 0.3));
    cap.position.set(0, 0.26, z);
    scene.add(cap);
  });
  const viseBase = new THREE.Mesh(chamferBox(17, 1.3, 24, 0.12), metal(0x1f262e, 0.4));
  viseBase.position.y = -2.65;
  viseBase.castShadow = true;
  viseBase.receiveShadow = true;
  scene.add(viseBase);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 32), metal(0x9aa7b3, 0.25));
  screw.rotation.x = Math.PI / 2;
  screw.position.set(0, -1.3, 12.2);
  scene.add(screw);
  // T-slot table
  const railGeo = chamferBox(70, 1.2, 4.2, 0.12);
  for (let i = -5; i <= 5; i++) {
    const r = new THREE.Mesh(railGeo, metal(0x3a4550, 0.3));
    r.position.set(0, -3.9, i * 4.9);
    r.receiveShadow = true;
    scene.add(r);
  }
  const under = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.accent).multiplyScalar(0.5) }));
  under.rotation.x = -Math.PI / 2;
  under.position.y = -4.3;
  scene.add(under);

  // --- the shop around it ---
  const spindle = buildSpindle();
  spindle.position.set(-3.5, 5.2, -3.5);
  scene.add(spindle);
  const paint = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.35, roughness: 0.5 });
  const head = new THREE.Mesh(chamferBox(7, 12, 8, 0.25), paint(0x3a4856));
  head.position.set(-3.5, 22, -4.5);
  head.castShadow = true;
  scene.add(head);
  const headLight = strip(7.02, 0.16, 8.02, COL.ice, 2.4);
  headLight.position.set(-3.5, 16.6, -4.5);
  const headBand = strip(7.02, 0.5, 8.02, COL.accent, 1.6);
  headBand.position.set(-3.5, 19.5, -4.5);
  scene.add(headLight, headBand);
  const column = new THREE.Mesh(chamferBox(14, 60, 8, 0.3), paint(0x26303a));
  column.position.set(-3.5, 20, -14);
  scene.add(column);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(260, 90), paint(0x1a232c));
  wall.position.set(0, 30, -34);
  scene.add(wall);
  for (let i = 0; i < 16; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 90, 1), paint(0x2c3844));
    rib.position.set(-75 + i * 10, 30, -33.5);
    scene.add(rib);
  }
  // enclosure posts in the foreground corners
  [[-30, -20], [30, -20]].forEach(([x, z]) => {
    const post = new THREE.Mesh(chamferBox(2.2, 70, 2.2, 0.15), paint(0x303b47));
    post.position.set(x, 30, z);
    scene.add(post);
  });
  // overhead lights: they switch on one after another as the shot opens
  const lamps = [];
  for (let i = 0; i < 6; i++) {
    const l = strip(15, 0.28, 0.3, 0xe6f1ff, 1);
    l.position.set(-42.5 + (i % 3) * 20 + (i > 2 ? 10 : 0) + 12, i > 2 ? 15.5 : 9.5, -33.2);
    lamps.push(l);
    scene.add(l);
  }
  const sideBars = [strip(0.3, 26, 0.3, COL.accent, 5), strip(0.3, 26, 0.3, COL.accent, 5)];
  sideBars[0].position.set(-30, 18, -18.8);
  sideBars[1].position.set(30, 18, -18.8);
  scene.add(...sideBars);

  const key = new THREE.SpotLight(0xeef5ff, 3900, 120, 0.5, 0.8, 2);
  key.position.set(14, 30, 16);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const back = new THREE.PointLight(0xbfe3ff, 9000, 140, 2);
  back.position.set(6, 13, -22);
  scene.add(back);
  const rim = new THREE.PointLight(COL.accent, 2600, 90, 2);
  rim.position.set(-20, 6, -12);
  scene.add(rim);
  const fill = new THREE.PointLight(0xbfe3ff, 500, 60, 2);
  fill.position.set(8, 3, 14);
  scene.add(fill);

  const lampOn = new THREE.Color(0xe6f1ff).multiplyScalar(3.2);
  const lampOff = new THREE.Color(0x0a0f14);
  function update(tau) {
    const a = tau + 0.6;
    spindle.userData.spin.rotation.y = -a * Math.PI * 0.5;
    spindle.position.y = 3.2 + 2.6 * easeInOut(clamp(a / 2.6));
    lamps.forEach((l, i) => { l.material.color.copy(a > 0.3 + i * 0.14 ? lampOn : lampOff); });
    const u = easeInOut(clamp(a / 3.5) * 0.9 + 0.05);
    const az = lerp(0.95, -0.42, u);
    const rad = lerp(11.5, 29, u);
    camera.position.set(Math.sin(az) * rad, lerp(1.15, 6.2, u), Math.cos(az) * rad);
    camera.lookAt(lerp(1.8, -1.2, u), lerp(-0.2, 3.6, u), lerp(1.5, -3, u));
  }
  return { scene, camera, update, exposure: 1.0 };
}
