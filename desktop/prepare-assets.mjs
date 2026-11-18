// Builds what the desktop app bundles: the single-file simulator (index.html) and the web shell.
// Run by `tauri dev` / `tauri build` (beforeDevCommand / beforeBuildCommand), or by hand:
//   node desktop/prepare-assets.mjs              the server-hosted web app (web/dist), as before
//   node desktop/prepare-assets.mjs business     the Business edition (dist/business), for tauri.business.conf.json
//   node desktop/prepare-assets.mjs play         the Play edition (dist/play), for tauri.play.conf.json
// One Rust crate serves all three: the edition is only a different folder of web files (see the conf overlays).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const edition = process.argv[2];
if (edition !== undefined && edition !== 'business' && edition !== 'play') {
  console.error(`prepare-assets: unknown edition "${edition}" (business | play | nothing)`);
  process.exit(2);
}
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win });
  if (r.error) return false;
  if (r.status !== 0) process.exit(r.status ?? 1);
  return true;
}
// python3 on mac/Linux; Windows installs often only have `python` or the `py` launcher
const py = ['python3', 'python', 'py'].find((p) => spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0);
if (!py) {
  console.error('prepare-assets: no Python found (python3 / python / py) to run build.py');
  process.exit(1);
}
// the simulator first: an edition build copies index.html into its own sim/ folder
run(py, ['build.py'], root);
if (!existsSync(join(root, 'web', 'node_modules'))) run('npm', ['ci', '--no-audit', '--no-fund'], join(root, 'web'));
run('npm', ['run', edition ? `build:${edition}` : 'build'], join(root, 'web'));
