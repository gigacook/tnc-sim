#!/usr/bin/env python3
"""Bundle shell + libraries + modules into one standalone HTML. All files are UTF-8 (explicit: Windows defaults to cp1252).

  python3 build.py          -> index.html        (public, pushed; never contains a key)
                            -> docs/index.html   (the same file, for GitHub Pages)
  No build holds a key: the OpenRouter key lives on the server only (docs/AI_API.md).
  python3 build.py --wasm   first rebuilds the engine (server/crates/tnc-core -> sim/engine/tnc_core.wasm; needs
                            cargo and `rustup target add wasm32-unknown-unknown`). Without it the committed module is used.

A new module is one line in MODULES. Missing optional files are skipped, never fatal.
The showcase programs (examples/showcase/manifest.json + its .H files) are embedded as window.TNC_SHOWCASE when the
folder is there; without it the build is the same page without them.
"""
import base64
import gzip
import json
import pathlib
import re
import sys
import urllib.request

d = pathlib.Path(__file__).parent
cache = d / '.libcache'
cache.mkdir(exist_ok=True)
src = d / 'sim'          # simulator sources (the single-file build's modules + shell)
T_VER = '0.186.1'   # three.js; bundled with its addons and three.quarks by esbuild (vendor/three-entry.mjs)

def vendor():
    """three + addons + three.quarks as one classic script (window.THREE, window.QUARKS)."""
    out = cache / f'three-vendor-{T_VER}.js'
    if not out.exists():
        import os
        import subprocess
        # root package.json (npm ci) first; the older gitignored .tools/ layout still works
        for nm in (d / 'node_modules', d / '.tools' / 'node_modules'):
            esb = nm / '.bin' / ('esbuild.cmd' if os.name == 'nt' else 'esbuild')
            if esb.exists():
                break
        else:
            sys.exit('build: esbuild missing — run: npm ci   (in the repo root; pins three@%s three.quarks@0.17.1 esbuild@0.28.2)' % T_VER)
        subprocess.run([str(esb), str(src / 'vendor' / 'three-entry.mjs'), '--bundle', '--format=iife', '--minify',
                        '--legal-comments=none', '--log-level=warning', f'--outfile={out}'], check=True, cwd=nm.parent,
                       env=dict(os.environ, NODE_PATH=str(nm)))
    return out.read_text(encoding='utf-8')

# (cache file, url, label) — fetched once into .libcache/
LIBS = [
    ('jszip.js',          'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip 3.10.1 — MIT, Stuart Knightley'),
    ('idb-keyval.js',     'https://cdn.jsdelivr.net/npm/idb-keyval@6.2.2/dist/umd.js',   'idb-keyval 6.2.2 — Apache-2.0, Jake Archibald'),
]

WASM = src / 'engine' / 'tnc_core.wasm'

def build_wasm():
    """server/crates/tnc-core -> sim/engine/tnc_core.wasm (profile wasm: size-optimised, abort on panic)."""
    import os
    import shutil
    import subprocess
    subprocess.run(['cargo', 'build', '-p', 'tnc-core', '--target', 'wasm32-unknown-unknown', '--profile', 'wasm'], check=True, cwd=d / 'server')
    target = pathlib.Path(os.environ.get('CARGO_TARGET_DIR') or d / 'server' / 'target')
    WASM.parent.mkdir(exist_ok=True)
    shutil.copyfile(target / 'wasm32-unknown-unknown' / 'wasm' / 'tnc_core.wasm', WASM)

# (file, label) — project modules, in load order. ui.js must stay last.
# The engine (Rust -> WebAssembly) loads first; every module after it waits until the module is instantiated.
ENGINE_MODULES = [
    ('engine.js',    'TNC engine: interpreter, checks, material model (Rust, server/crates/tnc-core, as WebAssembly)'),
]
MODULES = [
    ('settings.js',  'Presentation settings (tnc.settings.v1) and the edition flag'),
    ('machines.js',  'Machine parameters (shared with the server engine)'),
    ('programs.js',  'Programs on the control'),
    ('lessons.js',   'Lessons, BREAK IT, manual'),
    ('tools3d.js',   'Tool geometry'),
    ('callouts.js',  'Callouts'),
    ('flow.js',      'Flow view'),
    ('fx.js',        'Effects'),
    ('materials.js', 'Materials'),
    ('look.js',      'Look: environment, antialiasing'),
    ('stockview.js', 'Stock drawing: display field, edge snapping, machined-metal shader'),
    ('profile.js',   'User profile storage'),
    ('part.js',      'Part spec: target geometry, lettering, measured comparison (AI loop)'),
    ('ai.js',        'AI program generation (OpenRouter)'),
    ('aigen.js',     'AI view of the New program dialog (server generation API)'),
    ('bridge.js',    'Bridge to the TNC server (when there is one) and to the web app around the page (same-origin iframe)'),
    ('viz.js',       'View aids: axis vectors, click to pick'),
    ('dialogs.js',   'Programming dialogs: path functions, CYCL DEF, TOOL CALL'),
    ('i18n.js',      'i18n: language strings (en/sv)'),
    ('autosave.js',  'Autosave drafts for text boxes (data-autosave)'),
    ('cine.js',      'Machining replay: cinematic camera, time remap, post pass, synthesised sound'),
    ('sheet.js',     'Profile sheet: flat profile lines and the program cards (TNC_SHEET)'),
    ('editor.js',    'Text editor for .H programs and text files (TNC_EDITOR)'),
    ('setpanel.js',  'Settings panel behind the gear (replaces the settings modal and the Effects and view menu)'),
    ('ui.js',        'Simulator UI'),
]

# text files exposed as window globals for the DEV modal
TEXTS = [('docs/FEATURES.txt', 'TNC_DEVLOG'), ('docs/HISTORY.txt', 'TNC_HISTORY')]

def lib(name, url):
    f = cache / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(url).read())
    return f.read_text(encoding='utf-8')

def tag(label, src):
    if '</script' in src.lower():
        sys.exit(f'build: "{label}" contains </script — would break the page')
    return f'<script>/* ===== {label} ===== */\n{src}\n</script>\n'

def env_key():
    # private/.env (gitignored folder) first, then a root .env
    for f in (d / 'private' / '.env', d / '.env'):
        if not f.exists():
            continue
        for line in f.read_text(encoding='utf-8').splitlines():
            m = re.match(r'\s*OPENROUTER_API_KEY\s*=\s*["\']?([^"\'\s#]+)', line)
            if m:
                return m.group(1)
    return None

shell = (src / 'sim-shell.html').read_text(encoding='utf-8')
split = '<div class="app">'
head, body = shell.split(split, 1)
body = split + body

scripts = tag('three.js r186 + addons (MIT, three.js authors) + three.quarks (MIT, Alchemist0823)', vendor())
scripts += ''.join(tag(label, lib(n, u)) for n, u, label in LIBS)
for name, var in TEXTS:
    f = d / name
    if f.exists():
        scripts += tag('text: ' + name, f'window.{var} = {json.dumps(f.read_text(encoding="utf-8"))};')
def showcase():
    """examples/showcase -> {manifest: [...], sources: {FILE.H: text}} or None. Never fatal: a missing or broken folder is skipped."""
    sc = d / 'examples' / 'showcase'
    try:
        man = json.loads((sc / 'manifest.json').read_text(encoding='utf-8'))
        entries = man.get('programs', []) if isinstance(man, dict) else man
        keep, sources = [], {}
        for e in entries:
            f = sc / str(e.get('file', ''))
            if not (e.get('file') and f.is_file()):
                continue
            sources[e['file']] = f.read_text(encoding='utf-8')
            keep.append({k: e[k] for k in ('id', 'file', 'title', 'description', 'machines') if k in e})
        return {'manifest': keep, 'sources': sources} if sources else None
    except Exception:
        return None

sc = showcase()
if sc:
    scripts += tag('showcase programs (examples/showcase)', 'window.TNC_SHOWCASE = ' + json.dumps(sc, sort_keys=True) + ';')
included = []
if '--wasm' in sys.argv or not WASM.exists():
    build_wasm()
for name, label in ENGINE_MODULES:
    scripts += tag(label, (src / name).read_text(encoding='utf-8'))
    included.append(name)
# gzip + base64; DecompressionStream (all current browsers) restores it, then the deferred modules run in order
wasm = WASM.read_bytes()
b64 = base64.b64encode(gzip.compress(wasm, 9, mtime=0)).decode('ascii')
# zlib and zlib-ng (Windows Python 3.14) compress differently: keep the committed bytes while they hold the same module
old = re.search(r'window\.TNC_WASM_GZ = "([^"]*)"', (d / 'index.html').read_text(encoding='utf-8')) if (d / 'index.html').exists() else None
if old and gzip.decompress(base64.b64decode(old.group(1))) == wasm:
    b64 = old.group(1)
scripts += tag('TNC engine module (WebAssembly, gzip, base64)', f'window.TNC_WASM_GZ = "{b64}";')
deferred = ''
for name, label in MODULES:
    f = src / name
    if f.exists():
        mod = tag(label, f.read_text(encoding='utf-8'))
        deferred += mod.replace('<script>', '<script type="text/x-tnc-deferred">', 1)
        included.append(name)
scripts += deferred
scripts += tag('start: instantiate the engine, then run the modules above in order', """(function () {
  var b = atob(window.TNC_WASM_GZ), u = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  delete window.TNC_WASM_GZ;
  new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
.then(function (buf) { return TNC_ENGINE.load(buf); })
.then(function () {
  [].forEach.call(document.querySelectorAll('script[type="text/x-tnc-deferred"]'), function (s) {
    var n = document.createElement('script'); n.textContent = s.textContent; s.replaceWith(n);
  });
}, function (e) {
  var p = document.createElement('pre'); p.style.cssText = 'color:#ff5347;padding:16px;white-space:pre-wrap';
  p.textContent = 'The simulator engine (WebAssembly) did not load: ' + (e && e.message || e) + '. A current Chrome, Edge, Firefox or Safari is needed.';
  document.body.prepend(p);
});
})();""")

def page():
    return f"""<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="TNC 426 Simulator — HEIDENHAIN Klartext CNC simulator with live material removal.">
{head}<style>html{{color-scheme:dark}} img{{max-width:100%}} [hidden]{{display:none!important}}</style>
</head>
<body>
{body}
{scripts}</body>
</html>
"""

doc = page()
key = env_key()
if key and key in doc:   # a guard only: the key is read to prove it is NOT in the page, never to put it there
    sys.exit('build: the OpenRouter key leaked into the public build — aborting')
(d / 'index.html').write_text(doc, encoding='utf-8', newline='\n')
(d / 'docs' / 'index.html').write_text(doc, encoding='utf-8', newline='\n')  # GitHub Pages serves main -> /docs
print(f'built index.html  {len(doc):,} bytes  modules: {" ".join(included)}' + (f'  showcase: {len(sc["sources"])} programs' if sc else ''))

