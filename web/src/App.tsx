// The dashboard (fase 2a). A small router on the History API: four screens, no library.
import { useCallback, useEffect, useState } from 'react';
import type { Battery, Me } from './api';
import { Card, ROUTES, Shell, type Route } from './components/Shell';
import { Placeholder } from './pages/Placeholder';
import { Today } from './pages/Today';
import { T } from './texts';
import { useApi } from './useApi';

const routeFor = (path: string): Route => (Object.entries(ROUTES).find(([, p]) => p === path)?.[0] as Route | undefined) ?? 'today';

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));
  const me = useApi<Me>('/api/me');
  // The battery refreshes once a minute, no faster (1.12 A4).
  const battery = useApi<Battery>('/api/battery', 60_000);

  useEffect(() => {
    const onPop = () => setRoute(routeFor(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: Route) => {
    window.history.pushState(null, '', ROUTES[next]);
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  if (me.error) {
    return (
      <div className="mx-auto max-w-md p-4">
        <Card>
          <p>{T.error}</p>
          <button className="mt-3 rounded-xl border-2 border-ink bg-accent px-4 py-2 font-semibold text-white" onClick={() => void me.reload()}>
            {T.retry}
          </button>
        </Card>
      </div>
    );
  }
  if (!me.data) return <p className="p-4 text-muted">{T.loading}</p>;

  return (
    <Shell route={route} go={go} battery={battery.data}>
      {route === 'today' && <Today onChange={() => void battery.reload()} />}
      {route === 'projects' && <Placeholder title={T.nav.projects} />}
      {route === 'parking' && <Placeholder title={T.nav.parking} />}
      {route === 'settings' && <Placeholder title={T.nav.settings} />}
    </Shell>
  );
}
