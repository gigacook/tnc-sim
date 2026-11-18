import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { useDisclosure } from '../lib/disclosure';

export function Layout() {
  const { user, info, signOut } = useAuth();
  // phones: the page links fold behind a Menu button (disclosure); wide screens show them inline
  const { open, setOpen, toggle } = useDisclosure();
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is the trigger; the path is not read here
  useEffect(() => setOpen(false), [pathname, setOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/library" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span>TNC Library</span>
        </NavLink>
        <button
          ref={toggle}
          type="button"
          className="ghost nav-toggle"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
        <nav id="site-nav" aria-label="Pages" className={open ? 'open' : undefined}>
          <NavLink to="/library" end>
            Programs
          </NavLink>
          <NavLink to="/work">Machine</NavLink>
          <NavLink to="/tools">Tool tables</NavLink>
          <NavLink to="/account">Account</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin">Users</NavLink>}
        </nav>
        <div className="topbar-right">
          {info && !info.interpreter && (
            <span className="badge warn" title="Programs are stored but not checked">
              interpreter off
            </span>
          )}
          <span className="muted">{user?.name}</span>
          {!info?.local && (
            <button type="button" className="ghost" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="content" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
