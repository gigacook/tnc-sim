# Third-party notices

What this repository bundles, ships or builds with, as read from the checkout on 2026-11-18 (`LICENSE`,
`build.py`, the lockfiles, `node_modules` and the local cargo cache). The project's own code is MIT, see
[LICENSE](LICENSE). A repository's code licence does not by itself license its models, fonts or audio: every
asset gets its own row here before it is used.

"HEIDENHAIN" and "TNC" are trademarks of DR. JOHANNES HEIDENHAIN GmbH. This project is not affiliated with
HEIDENHAIN; it contains no HEIDENHAIN software, manual text or artwork.

## 1. Inlined into the shipped simulator (`index.html`, `docs/index.html`)

`build.py` puts these into the single HTML file. Hashes are sha256 of the files in `.libcache/` on 2026-11-18.

| Item | Version | Source | Licence | sha256 of the bundled file | Modifications |
|---|---|---|---|---|---|
| three.js with the addons OrbitControls, RoomEnvironment, EffectComposer, RenderPass, ShaderPass, OutputPass, FXAAShader, CopyShader | 0.186.1 (r186) | https://github.com/mrdoob/three.js, npm `three@0.186.1`, integrity `sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==` | MIT, Copyright (c) 2010-2026 three.js authors | `2cce9d87859329c66fa683cec4cf533ae529a6f27092396b94c9759eef272099` (`three-vendor-0.186.1.js`, three + addons + three.quarks in one file) | none to the sources; bundled and minified by esbuild from `sim/vendor/three-entry.mjs`, `ColorManagement.enabled = false` set at start |
| three.quarks | 0.17.1 | https://github.com/Alchemist0823/three.quarks, npm `three.quarks@0.17.1`, integrity `sha512-HiyORXkPZTfy7OBA/IRJqTcNxpo53yctgV3N8dSUG/jdisiVciDFGyf6hVnOLQDrIEmzU0yOtNFvzo+JHCjc7A==` | MIT, Copyright (c) Alchemist0823 | in the vendor file above | none |
| JSZip | 3.10.1 | https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js (https://github.com/Stuk/jszip) | MIT (the file's banner: dual licensed MIT or GPLv3; used under MIT), (c) 2009-2016 Stuart Knightley. The file also contains pako, MIT | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` | none |
| idb-keyval | 6.2.2 | https://cdn.jsdelivr.net/npm/idb-keyval@6.2.2/dist/umd.js (https://github.com/jakearchibald/idb-keyval) | Apache-2.0, Jake Archibald (as labelled in `build.py`; the bundled file carries no banner) | `f5985c43b11e4f99700e0c97a0d44ac129821f227f17c60afd7de8d421db5a58` | none |
| TNC engine `tnc_core.wasm` | built from `server/crates/tnc-core` | this repository | MIT (own code) | `dd23cb13e4de38b0423d61d8bc7d1c856249111045b0494b292ecb5a2f112aa7` | own work |

## 2. Build and test tooling (root `package.json`, not shipped)

| Item | Version (locked = installed) | Source | Licence (package.json) |
|---|---|---|---|
| esbuild | 0.28.2 | https://github.com/evanw/esbuild | MIT |
| playwright | 1.56.1 | https://github.com/microsoft/playwright | Apache-2.0 |
| @axe-core/playwright | 4.13.0 | https://github.com/dequelabs/axe-core-npm | MPL-2.0 |
| @tauri-apps/cli | 2.12.1 | https://github.com/tauri-apps/tauri | Apache-2.0 OR MIT |
| three, three.quarks | 0.186.1, 0.17.1 | see section 1 | MIT |

## 3. Web app (`web/`), direct dependencies at the starting commit `c6e6e7d`

Versions from `web/package-lock.json`; licences from each installed package's `package.json`. They are bundled
into `web/dist` by Vite (the last four are build-time only).

| Item | Version | Source | Licence |
|---|---|---|---|
| react, react-dom | 19.3.0 | https://github.com/react/react | MIT |
| react-router | 8.4.0 | https://github.com/remix-run/react-router | MIT |
| @tanstack/react-query | 5.104.0 | https://github.com/TanStack/query | MIT |
| codemirror | 6.0.2 | https://github.com/codemirror/basic-setup | MIT |
| @codemirror/commands, language, lint, state, view | 6.11.1, 6.12.4, 6.9.7, 6.7.6, 6.43.13 | https://code.haverbeke.berlin/codemirror | MIT |
| @lezer/highlight | 1.2.5 | https://code.haverbeke.berlin/lezer/highlight | MIT |
| vite | 8.3.1 | https://github.com/vitejs/vite | MIT |
| @vitejs/plugin-react | 6.1.1 | https://github.com/vitejs/vite-plugin-react | MIT |
| typescript | 7.0.2 | https://github.com/microsoft/TypeScript | Apache-2.0 |
| @types/react, @types/react-dom | 19.3.0 | https://github.com/DefinitelyTyped/DefinitelyTyped | MIT |

Added on this branch by the web lane (not at the starting commit, listed in `docs/RESEARCH.md`): `three` 0.186.1
(MIT) and `@types/three` 0.186.0. Any further addition gets a row here in the same commit.

## 4. Server (`server/`), direct dependencies

Versions from `server/Cargo.lock` (309 locked packages); licences from each crate's own `Cargo.toml` in the local
cargo cache. Compiled into the server binary and into the desktop app.

| Crate | Version | Source | Licence |
|---|---|---|---|
| anyhow | 1.0.104 | https://github.com/dtolnay/anyhow | MIT OR Apache-2.0 |
| argon2 | 0.5.3 | https://github.com/RustCrypto/password-hashes | MIT OR Apache-2.0 |
| axum | 0.8.9 | https://github.com/tokio-rs/axum | MIT |
| base64 | 0.22.1 and 0.23.1 (both locked) | https://github.com/marshallpierce/rust-base64 | MIT OR Apache-2.0 |
| bytes | 1.12.1 | https://github.com/tokio-rs/bytes | MIT |
| chrono | 0.4.45 | https://github.com/chronotope/chrono | MIT OR Apache-2.0 |
| clap | 4.6.7 | https://github.com/clap-rs/clap | MIT OR Apache-2.0 |
| dotenvy | 0.15.7 | https://github.com/allan2/dotenvy | MIT |
| encoding_rs | 0.8.42 | https://github.com/hsivonen/encoding_rs | (Apache-2.0 OR MIT) AND BSD-3-Clause |
| futures-util | 0.3.34 | https://github.com/rust-lang/futures-rs | MIT OR Apache-2.0 |
| http-body-util | 0.1.5 | https://github.com/hyperium/http-body | MIT |
| libm | 0.2.16 | https://github.com/rust-lang/compiler-builtins | MIT |
| rand | 0.8.8 and 0.10.3 (both locked) | https://github.com/rust-random/rand | MIT OR Apache-2.0 |
| regex, regex-lite | 1.13.1, 0.1.9 | https://github.com/rust-lang/regex | MIT OR Apache-2.0 |
| reqwest | 0.12.28 | https://github.com/seanmonstar/reqwest | MIT OR Apache-2.0 |
| serde, serde_json | 1.0.229, 1.0.151 | https://github.com/serde-rs | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | https://github.com/RustCrypto/hashes | MIT OR Apache-2.0 |
| sqlx (SQLite) | 0.8.6 | https://github.com/launchbadge/sqlx | MIT OR Apache-2.0 |
| tempfile | 3.27.0 | https://github.com/Stebalien/tempfile | MIT OR Apache-2.0 |
| thiserror | 2.0.21 | https://github.com/dtolnay/thiserror | MIT OR Apache-2.0 |
| tokio, tokio-stream | 1.53.1, 0.1.19 | https://github.com/tokio-rs/tokio | MIT |
| tower, tower-http | 0.5.3, 0.6.11 | https://github.com/tower-rs | MIT |
| tracing, tracing-subscriber | 0.1.44, 0.3.23 | https://github.com/tokio-rs/tracing | MIT |
| uuid | 1.26.1 | https://github.com/uuid-rs/uuid | Apache-2.0 OR MIT |
| zip | 2.4.2 | https://github.com/zip-rs/zip2 | MIT |

## 5. Desktop app (`desktop/src-tauri/`), direct dependencies

Versions from `desktop/src-tauri/Cargo.lock` (602 locked packages). The desktop app also contains everything of
sections 1, 3 and 4.

| Crate | Version | Source | Licence |
|---|---|---|---|
| tauri | 2.12.1 | https://github.com/tauri-apps/tauri | Apache-2.0 OR MIT |
| tauri-build | 2.7.1 | https://github.com/tauri-apps/tauri | Apache-2.0 OR MIT |
| tauri-plugin-opener | 2.7.0 | https://github.com/tauri-apps/plugins-workspace | Apache-2.0 OR MIT |
| tauri-plugin-single-instance | 2.5.2 | https://github.com/tauri-apps/plugins-workspace | Apache-2.0 OR MIT |
| tokio | 1.53.2 | https://github.com/tokio-rs/tokio | MIT |
| anyhow, serde, serde_json, tracing, tracing-subscriber | as in section 4 | as in section 4 | as in section 4 |
| url | 2.5.8 | https://github.com/servo/rust-url | MIT OR Apache-2.0 |

## 6. Assets

| Item | Source | Licence |
|---|---|---|
| Icons (`assets/tnc-sim.ico`, `tnc-sim.ico`, `desktop/src-tauri/icons/*`, `web/public/favicon.svg`) and screenshots (`docs/shots/*`) | this repository | own work, MIT |
| Showcase programs, manifest and thumbnails (`examples/showcase/`) | written by `scripts/showcase-gen.mjs`, pictures taken from this simulator by `scripts/showcase-thumbs.mjs` | own work, MIT. The lettering uses the generator's own single-stroke glyphs, no font file |
| Play landing hero film (`web/public/play/hero.mp4`, `hero.webm`, `hero-poster.jpg`, `hero-poster.webp`), its source (`cinematic/landing-hyperframes/`) and proof frames (`artifacts/hero/`) | rendered on this machine by `cinematic/landing-hyperframes/render.mjs` from the composition in that folder; every shape, texture and screen in it is drawn by that code (no stock footage, no product artwork, no game material, no sound) | own work, MIT. The rendered pictures contain glyphs of two fonts, see the next table; no font file is in the repository |

At the starting commit the repository tracks no third-party font, 3-D model, audio or video file
(`git ls-files` holds no `.woff`, `.woff2`, `.ttf`, `.otf`, `.glb`, `.gltf`, `.mp3`, `.ogg`, `.wav`, `.mp4`, `.webm`).

### Hero film tooling (`cinematic/landing-hyperframes/package.json`, pinned exactly, not shipped)

Installed only in `cinematic/landing-hyperframes/node_modules` (ignored). `render.mjs` copies the files it needs into
`assets/vendor/` and `assets/fonts/` there (both ignored), so none of them is tracked or served by the app.

| Item | Version | Source | Licence | Modifications |
|---|---|---|---|---|
| HyperFrames CLI | 0.9.65 | https://github.com/heygen-com/hyperframes, npm `hyperframes@0.9.65`, integrity `sha512-Rr/bhaA9e4ytXQRRsboG1m6kgOIzaE22FIFoHJsag2uls0mWbQW6MK/Vxm7plVBEn35p7piCv1SN7jCrfxdgNQ==` | Apache-2.0 (package.json) | none; local render only, telemetry and update check switched off by `render.mjs`; no registry block is used |
| three.js (`build/three.module.js`, `build/three.core.js`) | 0.186.1 | npm `three@0.186.1`, same integrity as in section 1 | MIT | none; draws the film's frames at render time |
| GSAP (`dist/gsap.min.js`) | 3.15.0 | https://gsap.com, npm `gsap@3.15.0`, integrity `sha512-dMW4CWBTUK1AEEDeZc1g4xpPGIrSf9fJF960qbTZmN/QwZIWY5wgliS6JWl9/25fpTGJrMRtSjGtOmPnfjZB+A==` | GSAP "Standard 'no charge' license", https://gsap.com/standard-license (package.json; not an OSI licence). Not verified: the licence text itself was not read | none; the HyperFrames timeline runtime, used at render time only |
| JetBrains Mono 400 and 700 (`.woff2`) | as shipped inside `hyperframes@0.9.65` (`dist/skills/hyperframes/assets/frame-presets/code-editorial/fonts/`) | https://github.com/JetBrains/JetBrainsMono | SIL Open Font License 1.1 (`OFL-jetbrains-mono.txt` beside the files) | none; rendered into the film's pictures (read-out, program text), the font files are not redistributed |
| Bahnschrift | the copy installed with Windows 11 on the render machine | Microsoft, loaded with `local("Bahnschrift")` | Microsoft Windows font licence. Not verified: the licence terms were not read; the face is only rendered into the film's pictures (labels, key legends, the 5511 marks), never copied. Without it the film falls back to JetBrains Mono | none |

## 7. Reference material, nothing copied

The design and tool references of this build (`nextlevelbuilder/ui-ux-pro-max-skill`, `nabinkhair42/structural-grid-skill`,
`vercel-labs/agent-skills`, `heygen-com/hyperframes`, `shorepine/kenney`) are recorded with revision and licence in
[docs/RESEARCH.md](docs/RESEARCH.md). When a file from one of them (a model, a font, a registry block, a tool
binary) enters this repository or a build, it gets a row in section 6 with its source path, revision, its own
licence and what was changed.

## 8. Not covered here

- Transitive dependencies are fixed by the lockfiles (`package-lock.json`, `web/package-lock.json`,
  `server/Cargo.lock`, `desktop/src-tauri/Cargo.lock`) and are not listed one by one. Not verified: a licence
  audit of the transitive set.
- The full licence texts of the bundled libraries are not reproduced in this file; the bundled three.js build
  drops legal comments (`--legal-comments=none` in `build.py`), so this file and `LICENSE` carry the notices.
