// Shot 4: controller reveal. An original, stylised control panel (not a copy of any
// real product): light screen with monospaced program text, a soft-key row, a key
// field and two override knobs. The camera starts low over the keys and pulls back.
import { THREE, COL, clamp, lerp, easeInOut, chamferBox, metal, strip, FONT_MONO, FONT_DIN } from './util.js';

const PROGRAM = [
  '0  BEGIN PGM 5511 MM',
  '1  BLK FORM 0.1 Z X-70 Y-70 Z-20',
  '2  BLK FORM 0.2 X+70 Y+70 Z+0',
  '3  TOOL CALL 4 Z S8000',
  '4  L Z+50 R0 F MAX M3',
  '5  CC X+0 Y+0',
  '6  LP PR+57 PA+157,5 R0 F MAX',
  '7  L Z-6 F250 M8',
  '8  LP PA+202,5 R0 F MAX',
  '9  L Z-6 F250',
];
const SW = 1480;
const SH = 960;

function drawScreen(g, a) {
  g.fillStyle = '#f3f4ef';
  g.fillRect(0, 0, SW, SH);
  // header
  g.fillStyle = '#dfe5ea';
  g.fillRect(0, 0, SW, 84);
  g.fillStyle = '#0066cc';
  g.fillRect(0, 0, 14, 84);
  g.fillStyle = '#15181c';
  g.font = `700 40px ${FONT_DIN}`;
  g.textBaseline = 'middle';
  g.fillText('PROGRAM', 40, 44);
  g.font = `400 34px ${FONT_MONO}`;
  g.fillText('5511.H', 260, 45);
  g.textAlign = 'right';
  g.fillText('MM', SW - 36, 45);
  g.textAlign = 'left';

  // program text, typed line by line
  const LH = 66;
  const TOP = 136;
  const PRE = 4; // lines already on the screen when the shot opens
  const typed = PROGRAM.slice(0, PRE).reduce((n, l) => n + l.length + 6, 0) + Math.max(0, (a - 0.35) * 46); // characters so far
  let budget = typed;
  let current = 0;
  g.font = `400 46px ${FONT_MONO}`;
  for (let i = 0; i < PROGRAM.length; i++) {
    const line = PROGRAM[i];
    if (budget <= 0) break;
    const n = Math.min(line.length, Math.floor(budget));
    budget -= line.length + 6; // short pause between lines
    current = i;
    const y = TOP + i * LH;
    const live = n < line.length || budget <= 0;
    if (live) {
      g.fillStyle = '#0066cc';
      g.fillRect(24, y - LH / 2 + 4, 912, LH - 8);
      g.fillStyle = '#ffffff';
    } else g.fillStyle = '#15181c';
    g.fillText(line.slice(0, n), 44, y + 2);
    if (live && n < line.length) g.fillRect(44 + g.measureText(line.slice(0, n)).width + 4, y - 20, 20, 40);
  }

  // side panel: the bolt circle the program is describing
  const px = 960;
  g.fillStyle = '#e7ebee';
  g.fillRect(px, 108, SW - px - 24, 690);
  g.strokeStyle = '#9aa7b3';
  g.lineWidth = 2;
  g.strokeRect(px, 108, SW - px - 24, 690);
  const cx = px + (SW - px - 24) / 2;
  const cy = 380;
  const pr = 170;
  g.strokeStyle = '#b9c3cc';
  g.beginPath();
  g.moveTo(cx - 215, cy);
  g.lineTo(cx + 215, cy);
  g.moveTo(cx, cy - 215);
  g.lineTo(cx, cy + 215);
  g.stroke();
  g.strokeStyle = '#3b4650';
  g.lineWidth = 3;
  g.strokeRect(cx - 205, cy - 205, 410, 410);
  g.setLineDash([10, 9]);
  g.strokeStyle = '#0066cc';
  g.beginPath();
  g.arc(cx, cy, pr, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  const holes = clamp(current - 5, 0, 8) + (current >= 6 ? Math.floor(clamp((a - 2.2) * 3, 0, 6)) : 0);
  for (let k = 0; k < 8; k++) {
    const ang = ((157.5 + k * 45) * Math.PI) / 180;
    const hx = cx + Math.cos(ang) * pr;
    const hy = cy - Math.sin(ang) * pr;
    g.beginPath();
    g.arc(hx, hy, 17, 0, Math.PI * 2);
    if (k < holes) {
      g.fillStyle = '#15181c';
      g.fill();
    } else {
      g.strokeStyle = '#9aa7b3';
      g.lineWidth = 2;
      g.stroke();
    }
  }
  if (current >= 6) {
    const ang = (157.5 * Math.PI) / 180;
    g.strokeStyle = '#0066cc';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(ang) * pr, cy - Math.sin(ang) * pr);
    g.stroke();
  }
  g.fillStyle = '#15181c';
  g.font = `400 34px ${FONT_MONO}`;
  const rows = [['PR', current >= 6 ? '+57,000' : '+0,000'], ['PA', current >= 8 ? '+202,500' : current >= 6 ? '+157,500' : '+0,000'], ['Z', current >= 7 ? '-6,000' : '+50,000']];
  rows.forEach(([k, val], i) => {
    const y = 640 + i * 50;
    g.textAlign = 'left';
    g.fillText(k, px + 34, y);
    g.textAlign = 'right';
    g.fillText(val, SW - 58, y);
  });
  g.textAlign = 'left';

  // soft-key row on the screen
  const labels = ['BEGIN', 'END', 'PAGE', 'PAGE', 'FIND', 'BLOCK', 'TOOL', 'RUN'];
  const kw = (SW - 48 - 7 * 10) / 8;
  labels.forEach((t, i) => {
    const x = 24 + i * (kw + 10);
    g.fillStyle = i === 7 ? '#0066cc' : '#d5dce2';
    g.fillRect(x, 838, kw, 98);
    g.strokeStyle = '#8f9ca8';
    g.lineWidth = 2;
    g.strokeRect(x, 838, kw, 98);
    g.fillStyle = i === 7 ? '#ffffff' : '#15181c';
    g.font = `700 32px ${FONT_DIN}`;
    g.textAlign = 'center';
    g.fillText(t, x + kw / 2, 889);
  });
  g.textAlign = 'left';
}

export function buildController(env) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.ground);
  scene.fog = new THREE.FogExp2(COL.ground, 0.018);
  scene.environment = env;
  scene.environmentIntensity = 0.85;
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 160);

  const panel = new THREE.Group();
  scene.add(panel);
  const body = new THREE.Mesh(chamferBox(13.4, 9.2, 1.0, 0.1), metal(0x1d232a, 0.42));
  body.position.z = -0.5;
  body.receiveShadow = true;
  body.castShadow = true;
  panel.add(body);
  const trim = new THREE.Mesh(chamferBox(13.4, 0.12, 1.06, 0.03), metal(COL.accent, 0.3));
  trim.position.set(0, -4.2, -0.5);
  panel.add(trim);

  // screen
  const SCW = 7.7;
  const SCH = (SCW * SH) / SW;
  const SX = -2.45;
  const SY = 1.35;
  const bezel = new THREE.Mesh(chamferBox(SCW + 0.5, SCH + 0.5, 0.16, 0.05), metal(0x0b0e12, 0.3));
  bezel.position.set(SX, SY, 0.04);
  bezel.receiveShadow = true;
  panel.add(bezel);
  const cv = document.createElement('canvas');
  cv.width = SW;
  cv.height = SH;
  const g2 = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCW, SCH), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.set(SX, SY, 0.125);
  panel.add(screen);
  // thin glass over the screen: a faint, oily reflection that never covers the text
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCW, SCH),
    new THREE.MeshBasicMaterial({ color: 0xffffff, envMap: env, transparent: true, opacity: 0.06, depthWrite: false }),
  );
  glass.position.set(SX, SY, 0.13);
  panel.add(glass);

  const keyGeo = chamferBox(0.66, 0.26, 0.66, 0.05);
  const softGeo = chamferBox(0.84, 0.22, 0.44, 0.05);
  const mats = {
    dark: new THREE.MeshStandardMaterial({ color: 0x343c45, metalness: 0.5, roughness: 0.42 }),
    light: new THREE.MeshStandardMaterial({ color: 0xc3ccd4, metalness: 0.35, roughness: 0.4 }),
    blue: new THREE.MeshStandardMaterial({ color: COL.accent, metalness: 0.4, roughness: 0.36, emissive: COL.accentDeep, emissiveIntensity: 0.35 }),
  };
  const legends = []; // {x, y, text, dark}
  const addKey = (geo, x, y, kind, text) => {
    const m = new THREE.Mesh(geo, mats[kind]);
    m.position.set(x, y, 0.1);
    m.rotation.x = Math.PI / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    panel.add(m);
    if (text) legends.push({ x, y, text, ink: kind === 'light' ? '#15181c' : '#f2f6fa' });
    return m;
  };
  // soft keys under the screen
  for (let i = 0; i < 8; i++) addKey(softGeo, SX - SCW / 2 + 0.48 + i * ((SCW - 0.96) / 7), SY - SCH / 2 - 0.62, 'light');
  // key field, right
  const field = [
    ['X', 'Y', 'Z', 'A', 'C'],
    ['7', '8', '9', 'L', 'CC'],
    ['4', '5', '6', 'LP', 'CR'],
    ['1', '2', '3', 'P', 'I'],
    ['0', ',', '+/-', 'CE', 'ENT'],
    ['<', '^', 'v', '>', 'GO'],
  ];
  const FX = 2.72;
  const FY = 3.55;
  const PITCH = 0.8;
  field.forEach((row, r) => {
    row.forEach((t, c) => {
      const kind = r === 0 ? 'blue' : t === 'ENT' || t === 'GO' ? 'blue' : c < 3 && r > 0 && r < 5 ? 'light' : 'dark';
      addKey(keyGeo, FX + c * PITCH, FY - r * PITCH, kind, t);
    });
  });
  // letter row, bottom left
  'QWERTYUIOP'.split('').forEach((t, i) => { addKey(keyGeo, SX - SCW / 2 + 0.36 + i * 0.78, -3.05, 'dark', t); });

  // legends: one transparent sheet over the key tops
  const LS = 150; // px per unit
  const lc = document.createElement('canvas');
  lc.width = 13.4 * LS;
  lc.height = 9.2 * LS;
  const lg = lc.getContext('2d');
  lg.textAlign = 'center';
  lg.textBaseline = 'middle';
  legends.forEach((l) => {
    lg.fillStyle = l.ink;
    lg.font = `700 ${l.text.length > 2 ? 34 : 46}px ${FONT_DIN}`;
    lg.fillText(l.text, (l.x + 6.7) * LS, (4.6 - l.y) * LS + 3);
  });
  const ltex = new THREE.CanvasTexture(lc);
  ltex.colorSpace = THREE.SRGBColorSpace;
  ltex.anisotropy = 8;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 9.2), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false, toneMapped: false }));
  sheet.position.z = 0.236;
  panel.add(sheet);

  // override knobs
  const knurl = [];
  for (let i = 0; i <= 8; i++) knurl.push(new THREE.Vector2(0.56 - (i === 0 || i === 8 ? 0.06 : 0), i * 0.07));
  knurl.push(new THREE.Vector2(0.4, 0.62), new THREE.Vector2(0, 0.62));
  const knobs = [0, 1].map((k) => {
    const grp = new THREE.Group();
    const kn = new THREE.Mesh(new THREE.LatheGeometry(knurl, 48), metal(0xaab6c2, 0.26));
    kn.rotation.x = Math.PI / 2;
    kn.castShadow = true;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.04), new THREE.MeshBasicMaterial({ color: COL.accent }));
    mark.position.set(0, 0.26, 0.63);
    grp.add(kn, mark);
    grp.position.set(3.3 + k * 1.75, -3.0, 0.0);
    panel.add(grp);
    const ringTicks = new THREE.Group();
    for (let i = 0; i < 11; i++) {
      const a = (-0.75 + i * 0.15) * Math.PI;
      const tk = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.02), new THREE.MeshBasicMaterial({ color: 0x9fb2c4 }));
      tk.position.set(Math.sin(a) * 0.76, Math.cos(a) * 0.76, 0.012);
      tk.rotation.z = -a;
      ringTicks.add(tk);
    }
    ringTicks.position.copy(grp.position);
    panel.add(ringTicks);
    return grp;
  });
  // status lamps
  const lamps = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 20), new THREE.MeshBasicMaterial({ color: COL.accent }));
    l.rotation.x = Math.PI / 2;
    l.position.set(2.72 + i * 0.36, 4.2, 0.03);
    lamps.push(l);
    panel.add(l);
  }

  // mount arm and wall
  const arm = new THREE.Mesh(chamferBox(1.6, 1.6, 9, 0.1), metal(0x252d36, 0.4));
  arm.position.set(0, -1, -5.4);
  scene.add(arm);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), metal(0x0f141a, 0.5));
  wall.position.z = -10;
  wall.receiveShadow = true;
  scene.add(wall);
  for (let i = 0; i < 10; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.2, 60, 0.4), metal(0x1d252e, 0.3));
    rib.position.set(-27 + i * 6, 0, -9.7);
    scene.add(rib);
  }
  const b1 = strip(0.1, 16, 0.1, COL.accent, 3.5);
  b1.position.set(-12.5, 0, -9.4);
  const b2 = strip(0.1, 16, 0.1, COL.ice, 1.2);
  b2.position.set(11.5, 0, -9.4);
  scene.add(b1, b2);

  const key = new THREE.SpotLight(0xeaf3ff, 1700, 70, 0.5, 0.8, 2);
  key.position.set(-8, 12, 14);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const spill = new THREE.PointLight(0xf3f4ef, 26, 9, 2); // the screen lighting the keys
  spill.position.set(SX + 2, SY, 1.6);
  scene.add(spill);
  const rim = new THREE.PointLight(COL.accent, 700, 40, 2);
  rim.position.set(11, 3, -3);
  scene.add(rim);

  const look = new THREE.Vector3();
  function update(tau) {
    const a = tau + 0.6;
    drawScreen(g2, a);
    tex.needsUpdate = true;
    knobs[0].rotation.z = -0.9 + 1.3 * easeInOut(clamp((a - 1.0) / 1.6));
    knobs[1].rotation.z = 0.5 - 0.9 * easeInOut(clamp((a - 1.8) / 1.4));
    lamps.forEach((l, i) => { l.material.color.setHex(a > 0.7 + i * 0.5 ? COL.accent : 0x1a2733); });
    // low over the keys, then back and up to the whole panel
    const u = easeInOut(clamp(a / 2.9));
    camera.position.set(lerp(7.4, 0.7, u), lerp(-3.6, 0.9, u), lerp(2.6, 15, u));
    look.set(lerp(2.6, -0.6, u), lerp(1.2, 1.7, u), 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.rotateZ(lerp(0.1, 0, u));
  }
  return { scene, camera, update, exposure: 1.0 };
}
