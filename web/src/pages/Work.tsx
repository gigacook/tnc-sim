import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { createBridge, type Bridge } from '../lib/bridge';
import { browserStore, readSettings, watchSettings } from '../lib/settings';
import '../tokens.css';
import '../work.css';

const T = {
  sv: {
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
  },
  en: {
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
    saved: (n: string, v: number) => `${n} saved as v${v}.`,
    same: (n: string, v: number) => `${n} is unchanged (v${v}).`,
    added: (n: string) => `${n} added to the library.`,
    noAnswer: 'The simulator did not answer.',
  },
};

/**
 * Business: the machine, full-bleed, at once. No landing, no account needed, no server needed.
 * When a server answers, one compact menu at the edge reaches the library, tool tables, account and users,
 * and stores the program on screen in the library.
 */
export function Work() {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<Bridge | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const { info, user } = useAuth();
  const qc = useQueryClient();
  const [lang, setLang] = useState(() => readSettings(browserStore()).lang);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const t = T[lang];

  useEffect(() => {
    const b = createBridge(() => frame.current?.contentWindow, location.origin);
    bridge.current = b;
    const offSettings = b.on('tnc:settings', (m) => m.lang && setLang(m.lang));
    const offStore = watchSettings((s) => setLang(s.lang));
    return () => {
      offSettings();
      offStore();
      b.dispose();
      bridge.current = null;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
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
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

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
