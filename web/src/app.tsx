import { StrictMode, lazy, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Navigate, RouterProvider, type RouteObject } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { Work } from './pages/Work';
import './styles.css';

// The signed-in pages are only useful with a server, so they load on demand: the machine workspace
// (and the Play edition) never pay for the editor, the library or the admin page.
const page = <T extends string>(load: () => Promise<Record<T, ComponentType>>, name: T) => lazy(() => load().then((m) => ({ default: m[name] })));
const Layout = page(() => import('./components/Layout'), 'Layout');
const SignIn = page(() => import('./pages/SignIn'), 'SignIn');
const Library = page(() => import('./pages/Library'), 'Library');
const Program = page(() => import('./pages/Program'), 'Program');
const Tools = page(() => import('./pages/Tools'), 'Tools');
const Account = page(() => import('./pages/Account'), 'Account');
const Admin = page(() => import('./pages/Admin'), 'Admin');
const SharePage = page(() => import('./pages/SharePage'), 'SharePage');

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

const wait = <div className="panel-empty">…</div>;

/** Signed-in pages; otherwise the sign-in (or first-account) form. Without a server: a way back to the machine. */
function Private() {
  const { user, loading, info } = useAuth();
  if (loading) return <div className="panel-empty">Connecting to the server…</div>;
  if (!info)
    return (
      <div className="panel-empty error">
        <p>The TNC server does not answer at /api/v1. The library, tool tables and accounts need it.</p>
        <p>
          <Link className="button primary" to="/work">
            Open the machine
          </Link>
        </p>
      </div>
    );
  return <Suspense fallback={wait}>{user ? <Layout /> : <SignIn />}</Suspense>;
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Admin /> : <Navigate to="/library" replace />;
}

/**
 * Start the web shell.
 * @param home where `/` and unknown paths go: `/work` (Business) or `/play` (Play)
 * @param extra routes only this edition has (Play adds `/play`; Business adds nothing)
 */
export function mount(home: string, extra: RouteObject[] = []) {
  const router = createBrowserRouter([
    { path: '/', element: <Navigate to={home} replace /> },
    { path: '/work', element: <Work /> },
    ...extra,
    {
      path: '/s/:token',
      element: (
        <Suspense fallback={wait}>
          <SharePage />
        </Suspense>
      ),
    },
    {
      element: <Private />,
      children: [
        { path: 'library', element: <Library /> },
        { path: 'programs/:id', element: <Program /> },
        { path: 'tools', element: <Tools /> },
        { path: 'account', element: <Account /> },
        { path: 'admin', element: <AdminOnly /> },
      ],
    },
    { path: '/simulator', element: <Navigate to="/work" replace /> },
    { path: '*', element: <Navigate to={home} replace /> },
  ]);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
