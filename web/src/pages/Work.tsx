import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { createBridge, htmlLang, type Bridge, type Lang } from '../lib/bridge';
import { useDisclosure } from '../lib/disclosure';
import { browserStore, readSettings, watchSettings } from '../lib/settings';
import { WORK_STRINGS } from '../lib/work-strings';
import '../tokens.css';
import '../work.css';

/**
 * Business: the machine, full-bleed, at once. No landing, no account needed, no server needed.
 * When a server answers, one compact menu at the edge reaches the library, tool tables, account and users,
 * and stores the program on screen in the library.
 */
export function Work() {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<Bridge | null>(null);
  const { info, user } = useAuth();
  const qc = useQueryClient();
  const [lang, setLang] = useState(() => readSettings(browserStore()).lang);
  const { open, setOpen, toggle } = useDisclosure();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const t = WORK_STRINGS[lang];
  // the language on screen, known at once: a bridge message and the storage event of the same change arrive
  // one after the other, before React has drawn the first
  const shown = useRef(lang);

  useEffect(() => {
    const b = createBridge(() => frame.current?.contentWindow, location.origin);
    bridge.current = b;
    const show = (l: Lang) => {
      shown.current = l;
      setLang(l);
    };
    const offSettings = b.on('tnc:settings', (m) => m.lang && show(m.lang));
    const offStore = watchSettings((s) => show(s.lang), () => ({ lang: shown.current, simLang: b.simLang }));
    return () => {
      offSettings();
      offStore();
      b.dispose();
      bridge.current = null;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);
  }, [lang]);
  // the machine workspace is dark; the brand tokens follow the page's theme, so say so while it is open
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => {
      if (before === undefined) delete root.dataset.theme;
      else root.dataset.theme = before;
    };
  }, []);

  async function store() {
    setBusy(true);
    setStatus(null);
    try {
      const p = await bridge.current!.current().catch(() => Promise.reject(new Error(t.noAnswer)));
      const same = (await api.programs({ machine: p.machine, q: p.name.replace(/\.H$/, '') })).find((x) => x.name === p.name);
      if (same) {
        const r = await api.saveProgram(same.id, { content: p.text, message: 'from the simulator', source: 'simulator' });
        setStatus({ ok: true, id: same.id, text: r.changed ? t.saved(p.name, r.version) : t.same(p.name, r.version) });
      } else {
        const r = await api.createProgram({ name: p.name, machine: p.machine, content: p.text, message: 'from the simulator', source: 'simulator' });
        setStatus({ ok: true, id: r.id, text: t.added(r.name) });
      }
      qc.invalidateQueries({ queryKey: ['programs'] });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="work">
      <iframe
        ref={frame}
        src="/sim/?edition=business"
        title={t.frame}
        allow="fullscreen; clipboard-read; clipboard-write"
        onLoad={() => bridge.current?.hello()}
      />
      {info && (
        <div className="work-menu">
          <button
            ref={toggle}
            type="button"
            className="work-menu-toggle"
            aria-expanded={open}
            aria-controls="work-menu"
            aria-label={t.menu}
            title={t.menu}
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          {open && (
            <nav id="work-menu" className="work-menu-list" aria-label={t.menu}>
              {user ? (
                <>
                  <Link to="/library">{t.library}</Link>
                  <Link to="/tools">{t.tools}</Link>
                  <Link to="/account">{t.account}</Link>
                  {user.role === 'admin' && <Link to="/admin">{t.users}</Link>}
                  <button type="button" className="primary" onClick={store} disabled={busy}>
                    {busy ? t.saving : t.save}
                  </button>
                </>
              ) : (
                <Link to="/library">{t.signIn}</Link>
              )}
              <p className={status?.ok === false ? 'error' : undefined} role="status">
                {status && (
                  <>
                    {status.text} {status.id && <Link to={`/programs/${status.id}`}>{t.open}</Link>}
                  </>
                )}
              </p>
            </nav>
          )}
        </div>
      )}
    </main>
  );
}
