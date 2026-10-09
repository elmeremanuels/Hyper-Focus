// Header with the battery top right, and the navigation: a bar at the bottom on a phone,
// tabs under the header on a wider screen.
import type { ReactNode } from 'react';
import type { Battery as BatteryData } from '../api';
import { T } from '../texts';
import { Battery } from './Battery';

export type Route = 'today' | 'projects' | 'parking' | 'settings';
export const ROUTES: Record<Route, string> = { today: '/', projects: '/projecten', parking: '/parkeerplaats', settings: '/instellingen' };

export function Shell({ route, go, battery, assistant, children }: { route: Route; go: (r: Route) => void; battery: BatteryData | undefined; assistant?: ReactNode; children: ReactNode }) {
  const tabs = (Object.keys(ROUTES) as Route[]).map((r) => (
    <a
      key={r}
      href={ROUTES[r]}
      onClick={(e) => {
        e.preventDefault();
        go(r);
      }}
      aria-current={route === r ? 'page' : undefined}
      className={`min-w-0 rounded-lg px-1 py-2 text-center text-xs font-semibold sm:flex-none sm:px-4 sm:text-sm ${
        route === r ? 'bg-ink text-paper' : 'text-ink hover:bg-accent-soft'
      }`}
    >
      <span className="sm:hidden">{T.navShort[r]}</span>
      <span className="hidden sm:inline">{T.nav[r]}</span>
    </a>
  ));
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-24 sm:pb-8">
      <header className="flex items-center justify-between py-4">
        <span className="font-display text-xl font-bold tracking-tight">{T.appName}</span>
        <div className="flex min-h-9 items-center gap-3">
          {assistant}
          <Battery battery={battery} />
        </div>
      </header>
      <nav className="mb-6 hidden gap-2 rounded-xl border-2 border-ink bg-card p-1 shadow-hard sm:flex">{tabs}</nav>
      <main className="flex-1">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 grid grid-cols-4 gap-1 border-t-2 border-ink bg-card p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">{tabs}</nav>
    </div>
  );
}

/** A card in the house style. */
export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-4 break-inside-avoid rounded-xl border-2 border-ink bg-card p-4 shadow-hard">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="font-display text-lg font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
