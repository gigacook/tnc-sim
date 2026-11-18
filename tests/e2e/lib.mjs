// Shared by the edition end-to-end tests: a plain static file server (no rewrite rules, no backend),
// a Chromium launcher that falls back to an already-installed browser, and small check helpers.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = join(ROOT, 'dist');
export const ARTIFACTS = join(ROOT, 'artifacts');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

/** A port for a test server: PORT, else the machine's port catalog when it exists, else any free one. */
function pickPort() {
  if (process.env.PORT) return Number(process.env.PORT);
  const catalog = join(homedir(), 'gigacook', 'core', 'infra', 'scripts', 'catalog.mjs');
  if (existsSync(catalog)) {
    const r = spawnSync(process.execPath, [catalog, '--free', 'dev'], { encoding: 'utf8' });
    const p = Number((r.stdout || '').trim());
    if (r.status === 0 && p > 1023) return p;
  }
  return 0;
}

/**
 * Serve a folder the way the dumbest static host does: files, a folder's index.html, 404.html (status 404)
 * for the rest. Loopback only. `overrides` maps a URL path to another file (used for the mock simulator).
 */
export async function serve(dir, overrides = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    requests.push(path);
    let file = overrides[path] ?? normalize(join(dir, path));
    if (!overrides[path] && !file.startsWith(dir + sep) && file !== dir) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    let status = 200;
    if (!existsSync(file)) {
      status = 404;
      file = join(dir, '404.html');
      if (extname(path) || !existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
    }
    res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  const listen = (port) =>
    new Promise((ok, bad) => {
      server.once('error', bad);
      server.listen(port, '127.0.0.1', () => ok());
    });
  try {
    await listen(pickPort());
  } catch {
    await listen(0);
  }
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, port, requests, close: () => new Promise((ok) => server.close(ok)) };
}

/** Chromium: Playwright's pinned build, else PW_CHROMIUM, else any Chromium in the Playwright cache folders. */
export async function launch(args = []) {
  const flags = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...args];
  const tries = [undefined, process.env.PW_CHROMIUM];
  for (const cache of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Developer', '_shared', 'cache', 'ms-playwright'), join(homedir(), 'AppData', 'Local', 'ms-playwright')]) {
    if (!cache || !existsSync(cache)) continue;
    for (const d of readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      for (const exe of ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) tries.push(join(cache, d, exe));
    }
  }
  let lastError;
  for (const executablePath of tries) {
    if (executablePath !== undefined && !(executablePath && existsSync(executablePath))) continue;
    try {
      const browser = await chromium.launch({ executablePath, args: flags });
      return { browser, exe: executablePath ?? chromium.executablePath() };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error('no Chromium could be started: ' + (lastError?.message ?? 'none installed'));
}

export function checks(name) {
  let pass = 0;
  const failures = [];
  const waiting = [];
  console.log(`\n== ${name} ==`);
  return {
    ok(cond, what, detail = '') {
      if (cond) {
        pass++;
        console.log('  ok    ' + what);
      } else {
        failures.push(what);
        console.log('  FAIL  ' + what + (detail ? `  (${detail})` : ''));
      }
      return !!cond;
    },
    /** a step that cannot pass yet because another lane has not landed its part; counted as a failure, reported apart */
    waits(what, on) {
      waiting.push(`${what} -- waits on: ${on}`);
      console.log(`  WAIT  ${what}  (waits on: ${on})`);
    },
    done() {
      console.log(`\n${name}: ${pass} passed, ${failures.length} failed, ${waiting.length} waiting`);
      for (const f of failures) console.log('  failed: ' + f);
      for (const w of waiting) console.log('  waiting: ' + w);
      return failures.length + waiting.length ? 1 : 0;
    },
  };
}

export function requireBuild(edition) {
  const dir = join(DIST, edition);
  if (!existsSync(join(dir, 'index.html')) || !existsSync(join(dir, 'sim', 'index.html'))) {
    console.error(`dist/${edition} is missing: run npm run build:${edition}`);
    process.exit(1);
  }
  return dir;
}

export const shots = (sub) => {
  const d = join(ARTIFACTS, sub);
  mkdirSync(d, { recursive: true });
  return d;
};

/** every file under a folder, as paths relative to it with forward slashes */
export function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1).split(sep).join('/')]));
}
