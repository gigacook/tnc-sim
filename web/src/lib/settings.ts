// Settings shared by the shell and the simulator through localStorage (same origin): `tnc.settings.v1`.
// The simulator writes the same key; a `storage` event (it fires in the other same-origin frames) or a
// `tnc:settings` bridge message tells the shell. Unknown or malformed fields fall back to the defaults.
import { ENVS, LANGS, MOTIONS, QUALITIES, SKINS, parsePresent, type Env, type Lang, type Motion, type Present, type Quality, type Skin } from './bridge.ts';

export const SETTINGS_KEY = 'tnc.settings.v1';

export interface Settings {
  lang: Lang;
  skin: Skin;
  env: Env;
  quality: Quality;
  motion: Motion;
  sound: boolean;
}

const DEFAULT_SETTINGS: Settings = { lang: 'sv', skin: '426', env: 'cold-steel', quality: 'medium', motion: 'full', sound: true };

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Whatever is stored, made whole. Never throws. */
export function readSettings(store: KV | null): Settings {
  let raw: unknown = null;
  try {
    raw = JSON.parse(store?.getItem(SETTINGS_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const out = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  // field by field: one bad value must not throw the good ones away
  if ((LANGS as readonly unknown[]).includes(r.lang)) out.lang = r.lang as Lang;
  if ((SKINS as readonly unknown[]).includes(r.skin)) out.skin = r.skin as Skin;
  if ((ENVS as readonly unknown[]).includes(r.env)) out.env = r.env as Env;
  if ((QUALITIES as readonly unknown[]).includes(r.quality)) out.quality = r.quality as Quality;
  if ((MOTIONS as readonly unknown[]).includes(r.motion)) out.motion = r.motion as Motion;
  if (typeof r.sound === 'boolean') out.sound = r.sound;
  return out;
}

/** Merge a change into the stored object, keeping fields this version does not know. */
export function writeSettings(store: KV | null, patch: Present): Settings {
  const clean = parsePresent(patch as Record<string, unknown>) ?? {};
  let prev: Record<string, unknown> = {};
  try {
    const p = JSON.parse(store?.getItem(SETTINGS_KEY) ?? '{}');
    if (typeof p === 'object' && p !== null && !Array.isArray(p)) prev = p;
  } catch {
    prev = {};
  }
  const next = { ...prev, ...readSettings(store), ...clean };
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode or a full disk: the choice lasts for this page only */
  }
  return readSettings({ getItem: () => JSON.stringify(next), setItem: () => {} });
}

export function browserStore(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * True when a stored language is only the simulator putting back its own: it saves every field of the key each
 * time, so a simulator that does not know the shell's language (it fell back to another) would overwrite it.
 * @param ours the language the shell shows
 * @param simLang the language the simulator said it shows (Bridge.simLang)
 * @param stored the language now in the store
 */
export const simFellBack = (ours: Lang, simLang: string | undefined, stored: Lang): boolean => stored !== ours && stored === simLang;

/**
 * Subscribe to changes made by the simulator frame or another tab.
 * @param own what the shell shows and what the simulator said it shows; given, a language the simulator merely
 *   fell back to is not taken over: the shell's own is written back, so it also survives a reload
 */
export function watchSettings(fn: (s: Settings) => void, own?: () => { lang: Lang; simLang: string | undefined }): () => void {
  const on = (e: StorageEvent) => {
    if (e.key !== SETTINGS_KEY && e.key !== null) return;
    const store = browserStore();
    const s = readSettings(store);
    const o = own?.();
    fn(o && simFellBack(o.lang, o.simLang, s.lang) ? writeSettings(store, { lang: o.lang }) : s);
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}
