#!/usr/bin/env node
// Builds the Play landing hero loop in one go, on this machine only:
//   1. fill assets/vendor and assets/fonts from node_modules (nothing is fetched)
//   2. hyperframes check   (lint, runtime, layout, contrast)
//   3. hyperframes render  (a near-lossless master, local Chrome + FFmpeg)
//   4. FFmpeg: hero.mp4 (H.264), hero.webm (VP9), hero-poster.jpg, hero-poster.webp
//   5. copy the four files to web/public/play/ and six proof frames to artifacts/hero/
//
// Use:  npm ci && node render.mjs        (from media/landing-hyperframes)
// Flags: --skip-check   render without the check gate (never for a delivery)
//        --keep-master  leave out/hero-master.mp4 in place after the run
// Needs Node 22+, FFmpeg and ffprobe on PATH. No cloud render, no account, no publish.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const out = join(here, 'out');
const webDir = join(repo, 'web', 'public', 'play');
const proofDir = join(repo, 'artifacts', 'hero');

let args;
try {
  args = parseArgs({ options: { 'skip-check': { type: 'boolean' }, 'keep-master': { type: 'boolean' } } }).values;
} catch (err) {
  console.error(`render.mjs: ${err.message}\nusage: node render.mjs [--skip-check] [--keep-master]`);
  process.exit(2);
}

const DURATION = 15; // seconds, the root data-duration in index.html
const FPS = 30;
const POSTER_AT = 5.2; // the cutter and the gear train
const PROOF = [
  ['01-grid-reveal', 1.6],
  ['02-cutter-gears', 4.6],
  ['03-coolant-macro', 7.6],
  ['04-controller-reveal', 10.9],
  ['05-part-sweep', 13.6],
  ['06-loop-wipe', 14.7],
];
const LIMIT = { mp4: 6_000_000, webm: 5_000_000 };

// HyperFrames stays local and quiet: no telemetry, no update check, no skill install.
const env = {
  ...process.env,
  HYPERFRAMES_NO_TELEMETRY: '1',
  DO_NOT_TRACK: '1',
  HYPERFRAMES_NO_UPDATE_CHECK: '1',
  HYPERFRAMES_SKIP_SKILLS: '1',
  HYPERFRAMES_NO_AUTO_INSTALL: '1',
};

function fail(msg) {
  console.error(`render.mjs: ${msg}`);
  process.exit(1);
}

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: here, env, encoding: 'utf8', stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) fail(`${cmd} did not start: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) fail(`${cmd} ${argv.slice(0, 3).join(' ')} ... exited ${r.status}${opts.capture ? `\n${r.stderr}` : ''}`);
  return r;
}

const cli = join(here, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
const hf = (argv, opts) => run(process.execPath, [cli, ...argv], opts);
const size = (p) => statSync(p).size;
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

// ---- 1. local assets -------------------------------------------------------
if (!existsSync(cli)) fail('node_modules is missing: run "npm ci" in media/landing-hyperframes first');
const copies = [
  ['node_modules/three/build/three.module.js', 'assets/vendor/three.module.js'],
  ['node_modules/three/build/three.core.js', 'assets/vendor/three.core.js'],
  ['node_modules/gsap/dist/gsap.min.js', 'assets/vendor/gsap.min.js'],
  ['node_modules/hyperframes/dist/skills/hyperframes/assets/frame-presets/code-editorial/fonts/JetBrainsMono-400.woff2', 'assets/fonts/JetBrainsMono-400.woff2'],
  ['node_modules/hyperframes/dist/skills/hyperframes/assets/frame-presets/code-editorial/fonts/JetBrainsMono-700.woff2', 'assets/fonts/JetBrainsMono-700.woff2'],
];
for (const [from, to] of copies) {
  const src = join(here, from);
  if (!existsSync(src)) fail(`missing ${from}: run "npm ci" (the lockfile pins the versions)`);
  mkdirSync(dirname(join(here, to)), { recursive: true });
  copyFileSync(src, join(here, to));
}
const version = JSON.parse(readFileSync(join(here, 'node_modules', 'hyperframes', 'package.json'), 'utf8')).version;
console.log(`hyperframes ${version}, local render`);

// ---- 2. check --------------------------------------------------------------
if (!args['skip-check']) {
  const r = hf(['check', '--json', '--timeout', '60000'], { capture: true, allowFail: true });
  let report;
  try {
    report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  } catch {
    fail(`check printed no JSON (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  if (report.browserSkipped) fail('check never opened the browser, so nothing was checked');
  if (!report.ok || r.status !== 0) fail(`check failed:\n${JSON.stringify(report, null, 2).slice(0, 6000)}`);
  console.log('check: ok');
}

// ---- 3. render the master --------------------------------------------------
mkdirSync(out, { recursive: true });
const master = join(out, 'hero-master.mp4');
const t0 = performance.now();
hf(['render', '--output', master, '--fps', String(FPS), '--quality', 'high', '--crf', '8', '--strict']);
const renderSeconds = (performance.now() - t0) / 1000;
if (!existsSync(master) || size(master) === 0) fail('render wrote no file');

// ---- 4. encode --------------------------------------------------------------
const ff = (argv) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv]);
const mp4 = join(out, 'hero.mp4');
const webm = join(out, 'hero.webm');
const frames = String(DURATION * FPS);

// Step the quality down only as far as the size limit asks for.
let mp4Crf;
for (mp4Crf = 21; mp4Crf <= 32; mp4Crf++) {
  ff(['-i', master, '-an', '-frames:v', frames, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(mp4Crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-movflags', '+faststart', mp4]);
  if (size(mp4) < LIMIT.mp4) break;
}
if (size(mp4) >= LIMIT.mp4) fail(`hero.mp4 is ${mb(size(mp4))}, over the limit`);
let webmCrf;
for (webmCrf = 36; webmCrf <= 48; webmCrf += 3) {
  ff(['-i', master, '-an', '-frames:v', frames, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(webmCrf), '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-row-mt', '1', '-tile-columns', '2', '-threads', '8', '-deadline', 'good', '-cpu-used', '3', webm]);
  if (size(webm) < LIMIT.webm) break;
}
if (size(webm) >= LIMIT.webm) fail(`hero.webm is ${mb(size(webm))}, over the limit`);

const posterJpg = join(out, 'hero-poster.jpg');
const posterWebp = join(out, 'hero-poster.webp');
ff(['-ss', String(POSTER_AT), '-i', master, '-frames:v', '1', '-q:v', '3', '-update', '1', posterJpg]);
ff(['-ss', String(POSTER_AT), '-i', master, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', '-update', '1', posterWebp]);

// ---- 5. deliver -------------------------------------------------------------
mkdirSync(webDir, { recursive: true });
mkdirSync(proofDir, { recursive: true });
for (const f of ['hero.mp4', 'hero.webm', 'hero-poster.jpg', 'hero-poster.webp']) copyFileSync(join(out, f), join(webDir, f));
for (const [name, at] of PROOF) ff(['-ss', String(at), '-i', master, '-frames:v', '1', '-q:v', '3', '-update', '1', join(proofDir, `${name}.jpg`)]);
// loop point: the last and the first frame, for a side-by-side look
ff(['-i', mp4, '-vf', `select=eq(n\\,0)+eq(n\\,${DURATION * FPS - 1}),tile=2x1`, '-frames:v', '1', '-q:v', '3', '-update', '1', join(out, 'loop-seam.jpg')]);

const probe = (p) => {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,nb_frames:format=duration', '-of', 'json', p], { capture: true });
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { codec: v.codec_name, size: `${v.width}x${v.height}`, pix: v.pix_fmt, fps: v.r_frame_rate, seconds: Number(j.format.duration), audio: j.streams.some((s) => s.codec_type === 'audio') };
};
const summary = {
  hyperframes: version,
  renderSeconds: Number(renderSeconds.toFixed(1)),
  mp4: { ...probe(mp4), bytes: size(mp4), crf: mp4Crf },
  webm: { ...probe(webm), bytes: size(webm), crf: webmCrf },
  posterJpg: size(posterJpg),
  posterWebp: size(posterWebp),
};
for (const k of ['mp4', 'webm']) {
  const v = summary[k];
  if (v.audio) fail(`hero.${k} has an audio track`);
  if (v.size !== '1920x1080' || v.pix !== 'yuv420p') fail(`hero.${k} is ${v.size} ${v.pix}`);
  if (Math.abs(v.seconds - DURATION) > 0.05) fail(`hero.${k} runs ${v.seconds} s, expected ${DURATION}`);
}
if (!args['keep-master']) rmSync(master, { force: true });
console.log(JSON.stringify(summary, null, 2));
console.log(`delivered to ${webDir}`);
