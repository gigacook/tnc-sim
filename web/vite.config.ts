import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Three ways to run this project:
//   vite / vite build                 the web app for tnc-server (web/dist): Business routes, /api and /sim proxied to it
//   --mode business | --mode play     an edition, built to <repo>/dist/<edition>/ with sim/index.html beside the shell,
//                                     so it runs from any static file server: no backend, no account
// TNC_SERVER=http://127.0.0.1:8426 makes an edition dev server proxy /api and /sim to a running tnc-server instead.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SIM_FILE = join(REPO, 'index.html');
const SERVER = process.env.TNC_SERVER;

type Edition = 'business' | 'play';

/** Edition builds: pick the entry, keep Play assets out of Business, add the simulator and the static-host fallbacks. */
function edition(ed: Edition, outDir: string): Plugin {
  const routes = ed === 'play' ? ['play', 'work'] : ['work'];
  return {
    name: 'tnc-edition',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const out = html.replace('<html lang="en">', `<html lang="sv" data-edition="${ed}">`);
        return ed === 'play'
          ? out.replace('/src/main.tsx', '/src/play/main.tsx').replace('<title>TNC Library</title>', '<title>TNC 5511</title>')
          : out.replace('<title>TNC Library</title>', '<title>TNC 426/430</title>');
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        // Business never serves a Play asset, in dev as in the build
        if (ed === 'business' && path.startsWith('/play/')) {
          res.statusCode = 404;
          res.end('not in this edition');
          return;
        }
        if (!SERVER && (path === '/sim' || path === '/sim/' || path === '/sim/index.html')) {
          if (!existsSync(SIM_FILE)) {
            res.statusCode = 503;
            res.end('index.html missing: run python build.py in the repo root');
            return;
          }
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(readFileSync(SIM_FILE));
          return;
        }
        next();
      });
    },
    closeBundle() {
      if (!existsSync(join(outDir, 'index.html'))) return;
      if (ed === 'business') rmSync(join(outDir, 'play'), { recursive: true, force: true });
      if (!existsSync(SIM_FILE)) throw new Error('index.html missing in the repo root: run python build.py first');
      mkdirSync(join(outDir, 'sim'), { recursive: true });
      copyFileSync(SIM_FILE, join(outDir, 'sim', 'index.html'));
      // static hosts have no rewrite rule: every entry route gets its own copy of the shell, plus 404.html
      // (in Play, /play/ also holds the media from public/play; only the html is added there)
      for (const r of routes) {
        mkdirSync(join(outDir, r), { recursive: true });
        copyFileSync(join(outDir, 'index.html'), join(outDir, r, 'index.html'));
      }
      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const ed: Edition | null = mode === 'business' || mode === 'play' ? mode : null;
  const outDir = ed ? join(REPO, 'dist', ed) : 'dist';
  const proxy =
    !ed || SERVER
      ? {
          '/api': { target: SERVER ?? 'http://127.0.0.1:8426', changeOrigin: false },
          '^/sim(/|$)': { target: SERVER ?? 'http://127.0.0.1:8426', changeOrigin: false },
        }
      : undefined;
  return {
    root: HERE,
    plugins: [react(), ...(ed ? [edition(ed, outDir)] : [])],
    server: { host: '127.0.0.1', port: Number(process.env.PORT) || 5426, proxy },
    build: { outDir, emptyOutDir: true, sourcemap: !ed },
  };
});
