// Hero film: five WebGL shots joined by a hard-edged wipe, drawn only from the
// HyperFrames seek time. The last wipe lands on the first frame, so the film loops.
import { THREE, COL, clamp, makeEnvironment } from './util.js';
import { buildGrid } from './scene-grid.js';
import { buildCutter } from './scene-cutter.js';
import { buildCoolant } from './scene-coolant.js';
import { buildController } from './scene-controller.js';
import { buildPart } from './scene-part.js';

const W = 1920;
const H = 1080;
const root = document.getElementById('root');
const DURATION = Number(root.dataset.duration);
// Where each shot starts, in seconds. Keep in step with the label clips in index.html.
const CUTS = [0, 3.0, 6.2, 9.0, 12.2];
const WIPE = 0.5; // each wipe ends exactly on its cut

async function build() {
  await Promise.all([
    document.fonts.load('400 40px "Hero Mono"'),
    document.fonts.load('700 40px "Hero Mono"'),
    document.fonts.load('700 40px "Hero Din"'),
  ]);

  const canvas = document.getElementById('film');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const env = makeEnvironment(renderer);
  const shots = [buildGrid(env), buildCutter(env), buildCoolant(env), buildController(env), buildPart(env)];

  const mkTarget = () => new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
  const rtA = mkTarget();
  const rtB = mkTarget();

  // join: A is the running shot, B the next one, revealed behind a slanted lit edge
  const join = new THREE.ShaderMaterial({
    uniforms: {
      tA: { value: rtA.texture },
      tB: { value: rtB.texture },
      uP: { value: 0 },
      uDir: { value: 1 },
      uEa: { value: 1 },
      uEb: { value: 1 },
      uAccent: { value: new THREE.Color(COL.accent) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tA; uniform sampler2D tB; uniform float uP; uniform float uDir; uniform float uEa; uniform float uEb;
      uniform vec3 uAccent; varying vec2 vUv;
      void main(){
        vec3 a = texture2D(tA, vUv).rgb * uEa;
        vec3 c = a;
        if (uP > 0.0) {
          vec3 b = texture2D(tB, vUv).rgb * uEb;
          float x = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;
          float s = x + (vUv.y - 0.5) * 0.28;
          float edge = mix(-0.16, 1.16, uP);
          float m = smoothstep(edge + 0.0015, edge - 0.0015, s);
          c = mix(a, b, m);
          float d = s - edge;
          c += uAccent * (exp(-abs(d) * 420.0) * 5.0 + exp(-max(d, 0.0) * 26.0) * step(0.0, d) * 0.5);
          c += vec3(0.8, 0.92, 1.0) * exp(-abs(d) * 1400.0) * 6.0;
        }
        vec2 q = vUv - 0.5;
        c *= 1.0 - dot(q, q) * 0.85;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), join));
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // the read-out lives in compositions/hud.html, which the runtime mounts on its own schedule
  const hud = { x: null, y: null, z: null, ticks: [] };
  const findHud = () => {
    hud.x = document.getElementById('hud-x');
    hud.y = document.getElementById('hud-y');
    hud.z = document.getElementById('hud-z');
    hud.ticks = [...document.querySelectorAll('#hud-ticks rect')];
    return hud.x && hud.y && hud.z;
  };
  const fmt = (v) => (v < 0 ? '-' : '+') + Math.abs(v * 10).toFixed(3).padStart(8, '0');

  function shotAt(t) {
    let i = CUTS.length - 1;
    while (i > 0 && t < CUTS[i]) i--;
    return i;
  }

  function draw(time) {
    const t = clamp(time, 0, DURATION - 1e-4);
    const i = shotAt(t);
    const j = (i + 1) % shots.length;
    const nextCut = i + 1 < CUTS.length ? CUTS[i + 1] : DURATION;
    const p = clamp((t - (nextCut - WIPE)) / WIPE);
    const A = shots[i];
    const B = shots[j];

    A.update(t - CUTS[i]);
    renderer.setRenderTarget(rtA);
    renderer.render(A.scene, A.camera);
    if (p > 0) {
      B.update(t - nextCut);
      renderer.setRenderTarget(rtB);
      renderer.render(B.scene, B.camera);
    }
    join.uniforms.uP.value = p;
    join.uniforms.uDir.value = i % 2 === 0 ? 1 : -1;
    join.uniforms.uEa.value = A.exposure;
    join.uniforms.uEb.value = B.exposure;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);

    // read-out follows the camera of the shot that owns most of the frame
    const lead = p >= 0.5 ? j : i;
    if (!hud.x && !findHud()) return;
    const cam = shots[lead].camera.position;
    hud.x.textContent = 'X' + fmt(cam.x);
    hud.y.textContent = 'Y' + fmt(cam.z);
    hud.z.textContent = 'Z' + fmt(cam.y);
    hud.ticks.forEach((r, k) => { r.setAttribute('class', k === lead ? 'on' : ''); });
  }

  // warm every shot up once so no shader compiles inside a seek, then make the GPU finish
  for (let k = 0; k < shots.length; k++) draw(CUTS[k] + 1.0);
  for (let k = 0; k < shots.length; k++) draw((k + 1 < CUTS.length ? CUTS[k + 1] : DURATION) - 0.1);
  const px = new Uint8Array(4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

  window.addEventListener('hf-seek', (e) => draw(e.detail.time));
  draw(0);
}

build().then(
  () => window.__filmReady(),
  (err) => window.__filmFailed(err),
);
