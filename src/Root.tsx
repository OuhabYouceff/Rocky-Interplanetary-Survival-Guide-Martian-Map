// Two pages: the landing (default, always shown at the site root) and the dashboard (#/dashboard).
import { lazy, Suspense, useEffect, useState } from 'react';
import './styles.css';

const Landing = lazy(() => import('./landing/Landing'));
const App = lazy(() => import('./App'));

const route = () => (location.hash.startsWith('#/dashboard') ? 'dashboard' : 'landing');

export default function Root() {
  const [page, setPage] = useState(route());
  useEffect(() => { const f = () => setPage(route()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return (
    <Suspense fallback={<div className="splash"><div><b>Rocky</b><div className="loadbar"><i /></div></div></div>}>
      {page === 'dashboard' ? <App /> : <Landing />}
    </Suspense>
  );
}
