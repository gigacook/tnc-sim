import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  closeLabel: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
  /** where the panel sits: a side sheet (lists) or the middle (dialogs) */
  place?: 'side' | 'center' | 'full';
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** A modal dialog: focus moves in, Tab stays in, Esc closes, focus goes back to where it was. */
export function Panel({ title, closeLabel, onClose, children, className, place = 'center' }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current!;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  return (
    // a click on the dimmed backdrop closes, as Esc and the close button do; the backdrop itself is not a control
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer convenience only, the keyboard path is Esc and the close button
    <div className={`pp-scrim pp-${place}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`pp ${className ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header className="pp-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="pp-x" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="pp-body">{children}</div>
      </div>
    </div>
  );
}
