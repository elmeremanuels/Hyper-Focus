// The dashboard (fase 2a). A small router on the History API: four screens, no library.
import { useCallback, useEffect, useState } from 'react';
import type { Battery, KikiInfo, Me } from './api';
import { Kiki } from './components/Kiki';
import { Card, ROUTES, Shell, type Route } from './components/Shell';
import { Parking } from './pages/Parking';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import { T } from './texts';
import { useApi } from './useApi';

const routeFor = (path: string): Route => (Object.entries(ROUTES).find(([, p]) => p === path)?.[0] as Route | undefined) ?? 'today';

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));
  const me = useApi<Me>('/api/me');
  // The battery refreshes once a minute, no faster (1.12 A4).
  const battery = useApi<Battery>('/api/battery', 60_000);
  const kiki = useApi<KikiInfo>('/api/assistant');
  // Logged in: the marker of a fresh login is no longer needed in the address bar.
  useEffect(() => {
    if (me.data && window.location.search.includes('login=1')) window.history.replaceState(null, '', window.location.pathname);
  }, [me.data]);
  const [kikiOpen, setKikiOpen] = useState(false);
  // Pages reload when the assistant saved something.
  const [version, setVersion] = useState(0);

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
    <Shell
      route={route}
      go={go}
      battery={battery.data}
      assistant={
        kiki.data?.available && (
          <button type="button" onClick={() => setKikiOpen(true)} className="rounded-xl border-2 border-ink bg-accent px-3 py-1.5 text-sm font-semibold text-white">
            {T.kiki.open}
          </button>
        )
      }
    >
      {kikiOpen && kiki.data && (
        <Kiki
          info={kiki.data}
          onClose={() => setKikiOpen(false)}
          onSaved={() => {
            setVersion((v) => v + 1);
            void battery.reload();
          }}
        />
      )}
      <div key={version} className="contents">
        {route === 'today' && <Today onChange={() => void battery.reload()} />}
        {route === 'projects' && <Projects />}
        {route === 'parking' && <Parking />}
        {route === 'settings' && <Settings />}
      </div>
    </Shell>
  );
}
