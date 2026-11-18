# Play landing hero loop

The source of the looping background film on the Play landing page: a 15 second, 1920x1080, 30 fps
[HyperFrames](https://github.com/heygen-com/hyperframes) composition, rendered on this machine to
`web/public/play/hero.mp4`, `hero.webm`, `hero-poster.jpg` and `hero-poster.webp`.

```
npm ci
node render.mjs
```

That one command fills the local assets from `node_modules`, runs `hyperframes check`, renders, encodes with
FFmpeg, copies the four files to `web/public/play/` and six proof frames to `artifacts/hero/`.
From the repository root the same thing is `npm run render:hero`.
The delivered film is the clean plate, without the overlay, because the landing page sets its own text on it;
`node render.mjs --hud` renders the version with the overlay to `out/hero-film.mp4` (not shipped). Needs Node 22+, FFmpeg and ffprobe.
Nothing is uploaded: no cloud render, no account, no publish, telemetry off.

To look while editing: `npx hyperframes preview` (the editor) or
`npx hyperframes snapshot --at 1.6,4.6,7.6,10.9,13.6` (stills under `.hyperframes/`).

## What is where

| File | What |
|---|---|
| `index.html` | the root composition: the film canvas and the overlay, 15 s |
| `compositions/hud.html` | overlay: frame marks, the 5511 badge, one label per shot, read-out; painted only when the variable `hud` is true |
| `tokens.css` | the overlay's colours and faces |
| `assets/film/main.js` | shot times (`CUTS`), the wipe between shots, the seek handler |
| `assets/film/scene-grid.js` | shot 1, mechanical grid reveal |
| `assets/film/scene-cutter.js` | shot 2, cutter and gear train |
| `assets/film/scene-coolant.js` | shot 3, coolant macro |
| `assets/film/scene-controller.js` | shot 4, the control panel and its program text (`PROGRAM`) |
| `assets/film/scene-part.js` | shot 5, the part in the shop |
| `assets/film/util.js` | palette (`COL`), easing, the cutter, gear and chamfered-box builders |
| `render.mjs` | check, render, encode, copy |

`assets/vendor/` and `assets/fonts/` are not tracked; `render.mjs` copies them from `node_modules`.

## Rules the film follows

- Every frame is drawn from the seek time alone (`hf-seek`): no clock, no timers, seeded randomness only.
- The loop: each shot is wiped in during the half second before its cut, and the wipe into shot 1 ends on
  the last frame, so the last frame runs straight into the first. Change a shot's length in `CUTS`
  (`assets/film/main.js`) and in the label times in `compositions/hud.html` together.
- All artwork is original and made in code. The control panel is a stylised panel of its own design, not a
  copy of a real product; the film makes no accuracy, certification or compatibility claim and has no sound.
- The headings use the Windows face Bahnschrift when it is installed and fall back to JetBrains Mono.

made by gigacook — per libertatem claritas vincit
