// The string tables of both shells: Swedish is the reference, and every other language has every key.
// Run: node --test tests/play/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlLang, LANG_NAMES, LANGS } from '../../web/src/lib/bridge.ts';
import { WORK_STRINGS } from '../../web/src/lib/work-strings.ts';
import { STRINGS, translator } from '../../web/src/play/strings.ts';

type Entry = string | ((...a: never[]) => string);
type Table = Record<string, Entry>;
const TABLES: Record<string, Record<string, Table>> = { 'play/strings.ts': STRINGS, 'lib/work-strings.ts': WORK_STRINGS };
/** what an entry says; the Business status lines are functions of a program name and a version */
const said = (e: Entry): string => (typeof e === 'function' ? (e as (n: string, v: number) => string)('NAME.H', 7) : e);

/** keys the reference has and `other` lacks or leaves empty */
export function missingKeys(reference: Table, other: Table | undefined): string[] {
  return Object.keys(reference).filter((k) => other === undefined || !(k in other) || typeof other[k] !== typeof reference[k] || said(other[k]).trim() === '');
}

test('the three languages are offered under their own names, Swedish first', () => {
  assert.deepEqual([...LANGS], ['sv', 'en', 'sr']);
  assert.deepEqual(LANGS.map((l) => LANG_NAMES[l]), ['Svenska', 'English', 'Srpski']);
  assert.deepEqual(LANGS.map(htmlLang), ['sv', 'en', 'sr-Latn']);
  // the short code on a button is the start of the name a screen reader says (label in name)
  for (const l of LANGS) assert.ok(LANG_NAMES[l].toLowerCase().startsWith(l), l);
});

for (const [file, tables] of Object.entries(TABLES)) {
  test(`${file}: every Swedish key is there in Serbian and in English, and nothing extra`, () => {
    assert.deepEqual(Object.keys(tables).sort(), [...LANGS].sort(), 'one table per language');
    assert.ok(Object.keys(tables.sv).length > 0);
    for (const lang of LANGS) {
      assert.deepEqual(missingKeys(tables.sv, tables[lang]), [], `${lang}: missing or empty`);
      assert.deepEqual(missingKeys(tables[lang], tables.sv), [], `${lang}: keys Swedish does not have`);
    }
  });

  test(`${file}: Serbian is Latin script and is not the Swedish text left in place`, () => {
    // identical on purpose: machine names, CNC and file names, key names, proper names, START
    const same = Object.keys(tables.sv).filter((k) => said(tables.sv[k]) === said(tables.sr[k]));
    for (const k of same) assert.match(said(tables.sv[k]), /^[\x20-\x7e·]*$/, `${k}: Swedish text with its own letters must be translated`);
    for (const k of same) assert.doesNotMatch(said(tables.sv[k]), /[a-z]{4,} [a-z]{4,}/, `${k}: a sentence left untranslated`);
    for (const [k, v] of Object.entries(tables.sr)) {
      assert.doesNotMatch(said(v), /[Ѐ-ӿ]/, `${k}: Cyrillic`);
      assert.doesNotMatch(said(v), /[åäöÅÄÖ]/, `${k}: Swedish letters`);
      assert.doesNotMatch(said(v), /dj|Dj|DJ(?=[aeiou])/, `${k}: đ written as dj`);
    }
    assert.match(Object.values(tables.sr).map(said).join(' '), /[čćšžđ]/, 'diacritics are used');
  });
}

test('the check itself notices a missing, an empty and a wrongly typed key', () => {
  const sv: Table = { a: 'A', b: 'B', f: (n: string) => `${n}.` };
  assert.deepEqual(missingKeys(sv, { a: 'A', b: 'B', f: (n: string) => n }), []);
  assert.deepEqual(missingKeys(sv, { a: 'A', f: (n: string) => n }), ['b']);
  assert.deepEqual(missingKeys(sv, { a: ' ', b: 'B', f: 'not a function' }), ['a', 'f']);
  assert.deepEqual(missingKeys(sv, undefined), ['a', 'b', 'f']);
});

test('Play: names, CNC words and 5511 are the same in every language; the staff joke keeps its off word', () => {
  for (const k of ['land.c1', 'land.c2', 'land.c3', 't.fil15', 't.dmc125', 't.big', 's.norsk', 's.5511', 's.plat', 'land.h1c', 'land.start'] as const) {
    for (const l of LANGS) assert.equal(STRINGS[l][k], STRINGS.sv[k], `${l} ${k}`);
  }
  for (const l of LANGS) for (const k of ['land.kicker', 'o.title'] as const) assert.match(STRINGS[l][k], /5511/, `${l} ${k}`);
  for (const k of ['n.office.0', 'n.office.1', 'n.office.2'] as const) {
    assert.match(STRINGS.sv[k], /personell/);
    assert.match(STRINGS.sr[k], /personal/);
  }
  assert.equal(translator('sr')('hud.stations'), 'Stanice');
  assert.equal(translator('sr')('land.h1a'), 'ŠPON.');
});

test('Play: Serbian button labels stay short (one or two words on the rail and in the settings)', () => {
  const short = Object.keys(STRINGS.sr).filter((k) => /^(hud\.(stations|view|computer|help|mute|unmute|close|goThere|exit)|c\.(q|m)\.|c\.(on|off|open|lang|quality|motion|env|sound|captions|secrets|settings)$|o\.(next|back|done|skip)|n\.(next|skip|boss|office)$)/.test(k));
  assert.ok(short.length > 25);
  for (const k of short) assert.ok(STRINGS.sr[k as keyof typeof STRINGS.sr].split(' ').length <= 2, `${k}: ${STRINGS.sr[k as keyof typeof STRINGS.sr]}`);
});

test('Business: the status lines name the program and the version in every language', () => {
  for (const l of LANGS) {
    assert.match(WORK_STRINGS[l].saved('A.H', 3), /A\.H.*v3/);
    assert.match(WORK_STRINGS[l].same('A.H', 3), /A\.H.*v3/);
    assert.match(WORK_STRINGS[l].added('A.H'), /A\.H/);
  }
});
