// What the Business shell (/work) says: the edge menu and its status line. Swedish first; the language follows
// tnc.settings.v1, which the simulator's own settings panel writes. Plain TypeScript so it runs under `node --test`.
import type { Lang } from './bridge.ts';

const sv = {
  frame: 'TNC-simulator',
  menu: 'Bibliotek och konto',
  library: 'Program',
  tools: 'Verktygstabeller',
  account: 'Konto',
  users: 'Användare',
  signIn: 'Logga in',
  save: 'Spara i biblioteket',
  saving: 'Sparar…',
  open: 'Öppna',
  saved: (n: string, v: number) => `${n} sparad som v${v}.`,
  same: (n: string, v: number) => `${n} är oförändrad (v${v}).`,
  added: (n: string) => `${n} lades till i biblioteket.`,
  noAnswer: 'Simulatorn svarade inte.',
};

const en: typeof sv = {
  frame: 'TNC simulator',
  menu: 'Library and account',
  library: 'Programs',
  tools: 'Tool tables',
  account: 'Account',
  users: 'Users',
  signIn: 'Sign in',
  save: 'Save to library',
  saving: 'Saving…',
  open: 'Open',
  saved: (n, v) => `${n} saved as v${v}.`,
  same: (n, v) => `${n} is unchanged (v${v}).`,
  added: (n) => `${n} added to the library.`,
  noAnswer: 'The simulator did not answer.',
};

const sr: typeof sv = {
  frame: 'TNC simulator',
  menu: 'Biblioteka i nalog',
  library: 'Programi',
  tools: 'Tabele alata',
  account: 'Nalog',
  users: 'Korisnici',
  signIn: 'Prijava',
  save: 'Sačuvaj u biblioteku',
  saving: 'Čuvam…',
  open: 'Otvori',
  saved: (n, v) => `${n} sačuvan kao v${v}.`,
  same: (n, v) => `${n} je nepromenjen (v${v}).`,
  added: (n) => `${n} je dodat u biblioteku.`,
  noAnswer: 'Simulator nije odgovorio.',
};

/** Every table by language. Swedish is the reference: tests/play/strings.test.ts fails when another one lacks a key. */
export const WORK_STRINGS: Record<Lang, typeof sv> = { sv, en, sr };
