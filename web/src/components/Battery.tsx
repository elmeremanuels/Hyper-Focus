// The battery (step 1.12 A4): four segments, never empty. Idle shows the last state dimmed.
import type { Battery as BatteryData } from '../api';

export function Battery({ battery }: { battery: BatteryData | undefined }) {
  const segments = battery?.segments ?? 1;
  return (
    <div
      role="img"
      aria-label={battery?.label ?? 'Batterij'}
      title={battery?.label}
      className={`flex items-center gap-[3px] transition-opacity ${battery?.dimmed ? 'opacity-45' : ''}`}
    >
      <div className="flex h-7 w-14 items-stretch gap-[3px] rounded-md border-2 border-ink bg-card p-[3px]">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`flex-1 rounded-[2px] ${n <= segments ? 'bg-accent' : 'bg-transparent'}`} />
        ))}
      </div>
      <span className="h-3 w-[4px] rounded-r-sm bg-ink" />
    </div>
  );
}
