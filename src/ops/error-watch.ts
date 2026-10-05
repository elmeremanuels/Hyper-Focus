// Counts errors in the logs (verbeterplan P0.2): more than five in an hour gives an alert.
import type { Alert } from './alerts.js';

export const ERRORS_PER_HOUR = 5;

/** Wraps console.error; returns a function that restores it. */
export function watchErrors(alert: Alert, process: string, now: () => Date = () => new Date()): () => void {
  const original = console.error.bind(console);
  const times: number[] = [];
  console.error = (...args: unknown[]) => {
    original(...args);
    const t = now().getTime();
    times.push(t);
    while (times.length > 0 && (times[0] ?? t) < t - 3_600_000) times.shift();
    if (times.length > ERRORS_PER_HOUR) {
      const first = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 200);
      void alert(`errors:${process}`, `${times.length} fouten in een uur in ${process}. Laatste: ${first}`);
    }
  };
  return () => {
    console.error = original;
  };
}
