# Play content pack

An optional pack adds a short two-character scene to the Play edition without changing the build.
Put `pack.json` in `play/pack/` next to a built Play edition (`dist/play/play/pack/pack.json`); the page asks for
`/play/pack/pack.json` once at start. No file, a wrong content type or one invalid field: the pack is ignored and
Play runs with its own generic characters. Business never asks for it.

A pack is data only: text, colours and shape numbers. No code, no HTML, no image or sound files, no links.
The loader ([loader.ts](loader.ts)) rebuilds the pack field by field and drops anything it does not know.

## Schema (v 1)

| Field | Type | Rule |
|---|---|---|
| `v` | number | `1` |
| `id` | string | 1 to 40 of `a-z`, `0-9`, `-` |
| `completion` | scene, optional | played once after a program ran to its end without errors, the next time the player is on the shop floor |

Scene:

| Field | Type | Rule |
|---|---|---|
| `figures` | array | exactly two figures |
| `lines` | array | 1 to 6 lines, said in order |
| `gesture` | string | `highfive`, `wave` or `none`; done with the last line |

Figure:

| Field | Type | Rule |
|---|---|---|
| `name` | string | 1 to 40 characters, shown in the caption |
| `height` | number | 1.5 to 2.0 (metres) |
| `build` | number | 0.8 (slim) to 1.4 (broad) |
| `skin`, `hair`, `top`, `bottom` | string | a colour like `#a1b2c3` |
| `hairStyle` | string | `short`, `long` or `bald` |
| `beard`, `glasses` | boolean | |

Line:

| Field | Type | Rule |
|---|---|---|
| `who` | number | `0` or `1`: which figure speaks |
| `sv`, `en` | string | 1 to 120 characters each, no `<` or `>` |
| `sr` | string, optional | Serbian in Latin script (č ć š ž đ), same rule. Left out: the English text is shown when the language is Srpski |

## Example

```json
{
  "v": 1,
  "id": "example-greeting",
  "completion": {
    "figures": [
      { "name": "Operator A", "height": 1.78, "build": 1.0, "skin": "#c99a7a", "hair": "#8a8a8a", "hairStyle": "short", "beard": false, "glasses": true, "top": "#2f4a66", "bottom": "#2b2f36" },
      { "name": "Operator B", "height": 1.86, "build": 1.3, "skin": "#c99a7a", "hair": "#4a3323", "hairStyle": "short", "beard": true, "glasses": false, "top": "#3a3f47", "bottom": "#23262b" }
    ],
    "lines": [
      { "who": 0, "sv": "Hej! Snyggt kört.", "en": "Hello! Nicely run.", "sr": "Zdravo! Lepo odrađeno." },
      { "who": 1, "sv": "Tack. Nästa detalj?", "en": "Thanks. Next part?", "sr": "Hvala. Sledeći komad?" }
    ],
    "gesture": "highfive"
  }
}
```

Captions follow the Play language switch (Svenska, English, Srpski). The scene can be skipped like any other interruption.
