import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { htmlLang, type Present } from '../lib/bridge';
import { browserStore, readSettings, watchSettings, writeSettings, type Settings } from '../lib/settings';
import { Landing } from './Landing';
import { translator } from './strings';

// the workshop (Three.js, the game, the panels) is one chunk that the landing does not need
const loadShop = () => import('./Shop');
const Shop = lazy(() => loadShop().then((m) => ({ default: m.Shop })));

/** What the page should do about motion: the stored choice, or the system's when the user never chose. */
function useReducedMotion(settings: Settings): boolean {
  const [system, setSystem] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return system || settings.motion === 'reduced';
}

export function Play() {
  const [settings, setSettings] = useState(() => readSettings(browserStore()));
  const [started, setStarted] = useState(false);
  const reduced = useReducedMotion(settings);
  const t = useMemo(() => translator(settings.lang), [settings.lang]);

  // the language on screen, known at once: a bridge message and the storage event of the same change arrive
  // one after the other, before React has drawn the first
  const shown = useRef(settings.lang);
  const apply = useCallback((s: Settings) => {
    shown.current = s.lang;
    setSettings(s);
  }, []);
  // a change that does not name a language keeps the one on screen, whatever the simulator last wrote into the store
  const change = useCallback((p: Present) => apply(writeSettings(browserStore(), { lang: shown.current, ...p })), [apply]);
  // the workshop tells which language the simulator shows, so a simulator that fell back does not rename the shell
  const simLang = useRef<() => string | undefined>(() => undefined);
  useEffect(() => watchSettings(apply, () => ({ lang: shown.current, simLang: simLang.current() })), [apply]);
  useEffect(() => {
    document.documentElement.lang = htmlLang(settings.lang);
    document.documentElement.dataset.theme = 'dark';
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [settings.lang]);
  // warm the workshop chunk while the visitor reads the landing, so START does not wait for the network
  useEffect(() => {
    const id = window.setTimeout(() => void loadShop().catch(() => {}), 600);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="play" data-motion={reduced ? 'reduced' : 'full'}>
      {started ? (
        <Suspense
          fallback={
            <div className="play-loading" role="status">
              {t('land.loading')}
            </div>
          }
        >
          <Shop settings={settings} change={change} reduced={reduced} t={t} simLang={simLang} />
        </Suspense>
      ) : (
        <Landing t={t} lang={settings.lang} setLang={(lang) => change({ lang })} reduced={reduced} onStart={() => setStarted(true)} />
      )}
    </div>
  );
}
