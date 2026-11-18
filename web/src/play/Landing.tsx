import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../lib/bridge';
import type { T } from './strings';

const TEETH = Array.from({ length: 12 }, (_, i) => i * 30);
const FLUTES = [0, 90, 180, 270];

interface Props {
  t: T;
  lang: Lang;
  setLang(l: Lang): void;
  reduced: boolean;
  onStart(): void;
}

/**
 * The Play landing: a structural grid (exposed rails, ruled cells, registration marks) around one START.
 * Behind it a muted looping film, when the build has one at /play/hero.mp4 (+ .webm) with /play/hero-poster.jpg.
 * Without those files the drawn grid is the background. Reduced motion shows the poster (or the grid) only.
 */
export function Landing({ t, lang, setLang, reduced, onStart }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const [film, setFilm] = useState<'unknown' | 'ok' | 'none'>('unknown');
  const [poster, setPoster] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => start.current?.focus({ preventScroll: true }), []);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  return (
    <main className="land" data-film={film}>
      <div className="land-bg" aria-hidden="true">
        <svg className="land-grid" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" role="presentation">
          <defs>
            <pattern id="lg-fine" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0H0V20" fill="none" className="lg-fine" />
            </pattern>
            <pattern id="lg-major" width="100" height="100" patternUnits="userSpaceOnUse">
              <rect width="100" height="100" fill="url(#lg-fine)" />
              <path d="M100 0H0V100" fill="none" className="lg-major" />
            </pattern>
          </defs>
          <rect width="1200" height="800" fill="url(#lg-major)" />
          {/* a cutter and its path, drawn like a setup sheet */}
          <g className="lg-draw" transform="translate(820 400)">
            <circle r="230" />
            <circle r="150" />
            <circle r="46" />
            <path d="M-300 0H300M0 -300V300" />
            {TEETH.map((deg) => (
              <path key={deg} d="M0 -150L18 -230L-18 -230Z" transform={`rotate(${deg})`} />
            ))}
            <g className="lg-spin">
              {FLUTES.map((deg) => (
                <path key={deg} d="M0 0C30 -14 44 -30 46 -46" transform={`rotate(${deg})`} />
              ))}
            </g>
          </g>
          <path className="lg-path" d="M60 640H380L460 560H700L760 620H1140" />
        </svg>
        {poster && <img className="land-poster" src="/play/hero-poster.jpg" alt="" onError={() => setPoster(false)} />}
        {!reduced && film !== 'none' && (
          <video
            ref={video}
            className="land-video"
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            poster={poster ? '/play/hero-poster.jpg' : undefined}
            onCanPlay={() => setFilm('ok')}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
          >
            <source src="/play/hero.webm" type="video/webm" />
            {/* the last source failing means no film in this build: the drawn grid stays */}
            <source src="/play/hero.mp4" type="video/mp4" onError={() => setFilm('none')} />
          </video>
        )}
        <div className="land-shade" />
      </div>

      <div className="land-frame">
        <header className="land-top">
          <span className="land-badge">
            <i>{t('land.kicker').replace('5511', '').trim()}</i>
            <b>5511</b>
          </span>
          <span className="land-coord" aria-hidden="true">
            X+0 Y+0 Z+100 · R0 · FMAX
          </span>
          <div className="land-tools">
            {film === 'ok' && !reduced && (
              <button type="button" className="land-ctl" onClick={toggle} aria-pressed={paused} aria-label={paused ? t('land.play') : t('land.pause')} title={paused ? t('land.play') : t('land.pause')}>
                <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
              </button>
            )}
            <fieldset className="land-lang" aria-label={t('land.lang')}>
              {(['sv', 'en'] as const).map((l) => (
                <button key={l} type="button" className="land-ctl" aria-pressed={lang === l} onClick={() => setLang(l)} lang={l}>
                  {l.toUpperCase()}
                </button>
              ))}
            </fieldset>
          </div>
        </header>

        <section className="land-hero">
          <h1>
            <span>{t('land.h1a')}</span>
            <span>{t('land.h1b')}</span>
            <span className="land-accent">{t('land.h1c')}</span>
          </h1>
          <p>{t('land.lead')}</p>
        </section>

        <div className="land-go">
          <button ref={start} type="button" className="land-start" onClick={onStart}>
            <span>{t('land.start')}</span>
            <kbd>{t('land.startHint')} ↵</kbd>
          </button>
        </div>

        <ul className="land-cells">
          {(['c1', 'c2', 'c3'] as const).map((c, i) => (
            <li key={c}>
              <span className="land-no" aria-hidden="true">
                0{i + 1}
              </span>
              <b>{t(`land.${c}`)}</b>
              <span>{t(`land.${c}t`)}</span>
            </li>
          ))}
        </ul>

        <footer className="land-foot">
          <span>{t('land.note')}</span>
          <span aria-hidden="true">N 5511 · END PGM</span>
        </footer>
      </div>
    </main>
  );
}
