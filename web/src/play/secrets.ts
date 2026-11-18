// Secret snippets of the Play edition: small original Klartext programs found around the workshop and opened
// in the simulator from the workshop computer. Plain linear moves only (L, FMAX, M3/M5/M2), the block shapes
// the simulator's own built-in programs use.
import type { Key } from './strings.ts';

export type SecretId = '333' | 'norsk' | '5511' | 'plat';

export interface Secret {
  id: SecretId;
  title: Key;
  hint: Key;
  /** shown in the list from the start (the comparison); the others appear when found */
  always?: boolean;
  /** a program to open in the simulator; none = the before/after comparison */
  program?: { name: string; text: string };
}

const pgm = (name: string, stock: [number, number, number], comment: string, cuts: string[]): { name: string; text: string } => ({
  name: `${name}.H`,
  text: [
    `BEGIN PGM ${name} MM`,
    `BLK FORM 0.1 Z X+0 Y+0 Z-${stock[2]}`,
    `BLK FORM 0.2 X+${stock[0]} Y+${stock[1]} Z+0`,
    `; ${comment}`,
    'TOOL CALL 1 Z S2500',
    'L Z+50 R0 FMAX M3',
    ...cuts,
    'L Z+50 R0 FMAX M5',
    'L Z+100 R0 FMAX M2',
    `END PGM ${name} MM`,
  ].join('\n'),
});
/** one slot: rapid above the start, plunge, cut through the points, retract */
const slot = (pts: [number, number][], depth = 2): string[] => [
  `L X+${pts[0][0]} Y+${pts[0][1]} R0 FMAX`,
  'L Z+2 R0 FMAX',
  `L Z-${depth} R0 F150`,
  ...pts.slice(1).map(([x, y]) => `L X+${x} Y+${y} R0 F400`),
  'L Z+2 R0 FMAX',
];

export const SECRETS: readonly Secret[] = [
  { id: '333', title: 's.333', hint: 's.333h', always: true },
  {
    id: 'norsk',
    title: 's.norsk',
    hint: 's.norskh',
    // a Nordic cross: one long slot, one short, off centre toward the hoist side
    program: pgm('NORSK', [110, 80, 15], 'NORDIC CROSS, 2 DEEP', [...slot([[10, 40], [100, 40]]), ...slot([[40, 10], [40, 70]])]),
  },
  {
    id: '5511',
    title: 's.5511',
    hint: 's.5511h',
    // the shop number in straight strokes: 5 5 1 1
    program: pgm('5511', [120, 60, 15], 'SHOP NUMBER 5511, 1.5 DEEP', [
      ...slot([[30, 45], [12, 45], [12, 30], [30, 30], [30, 15], [12, 15]], 1.5),
      ...slot([[58, 45], [40, 45], [40, 30], [58, 30], [58, 15], [40, 15]], 1.5),
      ...slot([[70, 38], [78, 45], [78, 15]], 1.5),
      ...slot([[92, 38], [100, 45], [100, 15]], 1.5),
    ]),
  },
  {
    id: 'plat',
    title: 's.plat',
    hint: 's.plath',
    // a sheet-metal bracket outline with two bend-relief notches
    program: pgm('PLAT', [100, 70, 10], 'SHEET BRACKET OUTLINE, 1 DEEP', [
      ...slot([[10, 10], [90, 10], [90, 40], [60, 40], [60, 60], [10, 60], [10, 10]], 1),
      ...slot([[60, 40], [52, 32]], 1),
      ...slot([[35, 60], [35, 50]], 1),
    ]),
  },
];
