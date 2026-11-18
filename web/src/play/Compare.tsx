import { useEffect, useRef, useState } from 'react';
import { Panel } from './Panel';
import type { Key, T } from './strings';

const SHOTS: { id: string; tab: Key; cap: Key }[] = [
  { id: 'main', tab: 'k.main', cap: 'k.cap.main' },
  { id: 'run', tab: 'k.run', cap: 'k.cap.run' },
  { id: 'new-menu', tab: 'k.new', cap: 'k.cap.new' },
  { id: 'ai-dialog', tab: 'k.ai', cap: 'k.cap.ai' },
];

interface Props {
  t: T;
  onClose(): void;
  /** where the live simulator should show (viewport px) while the "after" picture is missing; null = hide it */
  onLive(box: { left: number; top: number; width: number; height: number } | null): void;
}

/**
 * The 333 Easter egg: the simulator before and after the redesign. "Before" are real screenshots of the
 * starting commit (/play/before/). "After" are screenshots of the finished build (/play/after/); while one
 * is missing, the live simulator is shown beside the old picture instead.
 */
export function Compare({ t, onClose, onLive }: Props) {
  const [shot, setShot] = useState(0);
  const [split, setSplit] = useState(50);
  const [after, setAfter] = useState<Record<string, boolean | undefined>>({});
  const [before, setBefore] = useState<Record<string, boolean | undefined>>({});
  const s = SHOTS[shot];
  const hasAfter = after[s.id];
  const live = hasAfter === false;

  const hole = useRef<HTMLDivElement>(null);
  // the hole is rebuilt for every picture, so it is measured again when the tab changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shot` is the trigger, not a value read here
  useEffect(() => {
    const el = hole.current;
    if (!live || !el) return;
    const tell = () => {
      const r = el.getBoundingClientRect();
      onLive({ left: r.left, top: r.top + 36, width: r.width, height: r.height - 36 });
    };
    const ro = new ResizeObserver(tell);
    ro.observe(el);
    window.addEventListener('resize', tell);
    tell();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', tell);
      onLive(null);
    };
  }, [live, onLive, shot]);

  return (
    <Panel title={t('k.title')} closeLabel={t('hud.close')} onClose={onClose} place="full" className={live ? 'cmp cmp-live' : 'cmp'}>
      <div className="cmp-tabs" role="tablist" aria-label={t('k.title')}>
        {SHOTS.map((x, i) => (
          <button key={x.id} type="button" role="tab" aria-selected={i === shot} onClick={() => setShot(i)} data-autofocus={i === 0 ? '' : undefined}>
            {t(x.tab)}
          </button>
        ))}
      </div>
      <figure className="cmp-fig">
        <div className="cmp-stage" style={{ ['--split' as string]: `${split}%` }}>
          <div className="cmp-pane cmp-before">
            {before[s.id] === false ? (
              <p className="cmp-missing">{t('k.missing')}</p>
            ) : (
              <img key={s.id} src={`/play/before/before-${s.id}.png`} alt={`${t('k.before')}: ${t(s.tab)}`} onError={() => setBefore((b) => ({ ...b, [s.id]: false }))} />
            )}
            <span className="cmp-tag">{t('k.before')}</span>
          </div>
          {live ? (
            <div ref={hole} className="cmp-pane cmp-hole">
              <span className="cmp-tag">{t('k.live')}</span>
            </div>
          ) : (
            <div className="cmp-pane cmp-after">
              <img
                key={s.id}
                src={`/play/after/after-${s.id}.png`}
                alt={`${t('k.after')}: ${t(s.tab)}`}
                onLoad={() => setAfter((a) => ({ ...a, [s.id]: true }))}
                onError={() => setAfter((a) => ({ ...a, [s.id]: false }))}
              />
              <span className="cmp-tag cmp-tag-r">{t('k.after')}</span>
            </div>
          )}
          {!live && <span className="cmp-bar" aria-hidden="true" />}
        </div>
        {!live && (
          <input
            className="cmp-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={split}
            onChange={(e) => setSplit(+e.target.value)}
            aria-label={t('k.slider')}
            aria-valuetext={`${100 - split} ${t('k.pct')}`}
          />
        )}
        <figcaption>{t(s.cap)}</figcaption>
      </figure>
    </Panel>
  );
}
