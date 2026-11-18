// Optional content pack: /play/pack/pack.json, fetched at runtime if it is there. A pack is DATA only:
// text, colours and shape numbers. No code, no HTML, no URLs. Everything is checked and rebuilt field by field;
// anything unknown is dropped and anything out of range rejects the pack. Schema: README.md beside this file.
// Plain TypeScript (no DOM at import time) so the validator runs under `node --test`.

import { isObj } from '../../lib/bridge.ts';

const PACK_URL = '/play/pack/pack.json';

export interface PackFigure {
  /** shown in the caption */
  name: string;
  /** body height in metres, 1.5 .. 2.0 */
  height: number;
  /** 0.8 (slim) .. 1.4 (broad) */
  build: number;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bald';
  beard: boolean;
  glasses: boolean;
  top: string;
  bottom: string;
}

export interface PackLine {
  /** which of the two figures speaks */
  who: 0 | 1;
  sv: string;
  en: string;
}

export interface PackScene {
  figures: [PackFigure, PackFigure];
  lines: PackLine[];
  /** what the two do when the last line is said */
  gesture: 'highfive' | 'wave' | 'none';
}

export interface Pack {
  v: 1;
  id: string;
  /** played once after a program ran to its end without errors */
  completion?: PackScene;
}

export type PackResult = { ok: true; pack: Pack } | { ok: false; errors: string[] };

const COLOUR = /^#[0-9a-fA-F]{6}$/;
// text shown in a caption: letters, digits, common punctuation. No angle brackets, no control characters.
const plainText = (s: string) => !/[<>]/.test(s) && ![...s].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
const STYLES = ['short', 'long', 'bald'] as const;
const GESTURES = ['highfive', 'wave', 'none'] as const;

function text(v: unknown, max: number, at: string, errors: string[]): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || !plainText(v)) {
    errors.push(`${at}: text of 1 to ${max} characters without < or >`);
    return '';
  }
  return v;
}
function colour(v: unknown, at: string, errors: string[]): string {
  if (typeof v !== 'string' || !COLOUR.test(v)) {
    errors.push(`${at}: a colour like #a1b2c3`);
    return '#000000';
  }
  return v.toLowerCase();
}
function range(v: unknown, lo: number, hi: number, at: string, errors: string[]): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    errors.push(`${at}: a number from ${lo} to ${hi}`);
    return lo;
  }
  return v;
}

function figure(v: unknown, at: string, errors: string[]): PackFigure {
  const f = isObj(v) ? v : {};
  if (!isObj(v)) errors.push(`${at}: an object`);
  const style = STYLES.find((s) => s === f.hairStyle);
  if (!style) errors.push(`${at}.hairStyle: one of ${STYLES.join(', ')}`);
  if (typeof f.beard !== 'boolean') errors.push(`${at}.beard: true or false`);
  if (typeof f.glasses !== 'boolean') errors.push(`${at}.glasses: true or false`);
  return {
    name: text(f.name, 40, `${at}.name`, errors),
    height: range(f.height, 1.5, 2.0, `${at}.height`, errors),
    build: range(f.build, 0.8, 1.4, `${at}.build`, errors),
    skin: colour(f.skin, `${at}.skin`, errors),
    hair: colour(f.hair, `${at}.hair`, errors),
    hairStyle: style ?? 'short',
    beard: f.beard === true,
    glasses: f.glasses === true,
    top: colour(f.top, `${at}.top`, errors),
    bottom: colour(f.bottom, `${at}.bottom`, errors),
  };
}

function scene(v: unknown, at: string, errors: string[]): PackScene | undefined {
  if (!isObj(v)) {
    errors.push(`${at}: an object`);
    return undefined;
  }
  const figs = Array.isArray(v.figures) ? v.figures : [];
  if (figs.length !== 2) errors.push(`${at}.figures: exactly two figures`);
  const lines: PackLine[] = [];
  const raw = Array.isArray(v.lines) ? v.lines : [];
  if (raw.length < 1 || raw.length > 6) errors.push(`${at}.lines: 1 to 6 lines`);
  raw.slice(0, 6).forEach((l, i) => {
    const o = isObj(l) ? l : {};
    if (o.who !== 0 && o.who !== 1) errors.push(`${at}.lines[${i}].who: 0 or 1`);
    lines.push({ who: o.who === 1 ? 1 : 0, sv: text(o.sv, 120, `${at}.lines[${i}].sv`, errors), en: text(o.en, 120, `${at}.lines[${i}].en`, errors) });
  });
  const gesture = GESTURES.find((g) => g === v.gesture);
  if (!gesture) errors.push(`${at}.gesture: one of ${GESTURES.join(', ')}`);
  return { figures: [figure(figs[0], `${at}.figures[0]`, errors), figure(figs[1], `${at}.figures[1]`, errors)], lines, gesture: gesture ?? 'none' };
}

/** Check a parsed pack.json. Returns a rebuilt pack (never the input object) or every problem found. */
export function validatePack(raw: unknown): PackResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['pack: a JSON object'] };
  if (raw.v !== 1) errors.push('v: 1');
  const id = typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.id) ? raw.id : '';
  if (!id) errors.push('id: 1 to 40 of a-z, 0-9 and -');
  const completion = raw.completion === undefined ? undefined : scene(raw.completion, 'completion', errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, pack: completion ? { v: 1, id, completion } : { v: 1, id } };
}

/** The pack next to the build, or null when there is none or it is not valid. Never throws. */
export async function loadPack(fetcher: typeof fetch = fetch, url = PACK_URL): Promise<Pack | null> {
  try {
    const res = await fetcher(url, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const body = await res.text();
    if (body.length > 64_000) return null;
    const r = validatePack(JSON.parse(body));
    if (!r.ok) {
      console.warn('content pack rejected:', r.errors.join('; '));
      return null;
    }
    return r.pack;
  } catch {
    return null;
  }
}
