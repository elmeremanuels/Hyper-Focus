// Measurements for the test weeks of step 1.9 (npm run stats:focus -- --days 14).
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export interface FocusStats {
  userId: number;
  name: string;
  blocksStarted: number;
  blocksCompleted: number;
  pauses: number;
  returnedOnTime: number;
  rewardsFinished: number;
  backToWorkAfterReward: number;
  rewardsEnabled: boolean;
  toolButtonsShown: number;
  quickStartsAfterButton: number;
  /** Focus window (step 1.12). */
  windowsPlanned: number;
  windowsUsed: number;
  blocksInWindow: number;
  blocksOutsideWindow: number;
  avgWindowMinutes: number | null;
}

type Row = Record<string, unknown>;
const n = (value: unknown) => Number(value ?? 0);

export async function focusStats(db: Database, since: Date): Promise<FocusStats[]> {
  const result = await db.execute(sql`
    select
      u.id as user_id,
      u.name,
      s.rewards_enabled,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.started_at >= ${since}) as blocks_started,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.started_at >= ${since} and b.outcome = 'completed') as blocks_completed,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.pause_started_at >= ${since}) as pauses,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.pause_started_at >= ${since}
         and b.returned_at is not null and b.returned_at <= b.pause_due_at) as returned_on_time,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.reward_finished_at >= ${since}) as rewards_finished,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.reward_finished_at >= ${since}
         and exists (select 1 from focus_blocks nb where nb.user_id = u.id
           and nb.started_at > b.reward_finished_at and nb.started_at <= b.reward_finished_at + interval '10 minutes')) as back_to_work,
      (select count(*) from events e where e.user_id = u.id and e.name = 'tool_button_shown' and e.created_at >= ${since}) as buttons_shown,
      (select count(*) from events e where e.user_id = u.id and e.name = 'tool_button_shown' and e.created_at >= ${since}
         and exists (select 1 from events f where f.user_id = u.id
           and (f.name in ('block_started', 'session_started') or (f.name = 'task_status_changed' and f.props->>'status' = 'done'))
           and f.created_at >= e.created_at and f.created_at <= e.created_at + interval '2 minutes')) as quick_starts,
      (select count(*) from focus_windows w where w.user_id = u.id and w.starts_at >= ${since} and w.starts_at <= now() and w.status <> 'moved') as windows_planned,
      (select count(*) from focus_windows w where w.user_id = u.id and w.starts_at >= ${since} and w.status = 'used') as windows_used,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.started_at >= ${since} and b.in_window and b.outcome in ('completed', 'extended')) as blocks_in_window,
      (select count(*) from focus_blocks b where b.user_id = u.id and b.started_at >= ${since} and not b.in_window and b.outcome in ('completed', 'extended')) as blocks_outside_window,
      (select round(avg(extract(epoch from (b.ended_at - b.started_at)) / 60)) from focus_blocks b
         where b.user_id = u.id and b.started_at >= ${since} and b.in_window and b.ended_at is not null) as avg_window_minutes
    from users u
    left join user_settings s on s.user_id = u.id
    order by u.id
  `);
  return (result.rows as Row[]).map((row) => ({
    userId: n(row.user_id),
    name: String(row.name ?? ''),
    blocksStarted: n(row.blocks_started),
    blocksCompleted: n(row.blocks_completed),
    pauses: n(row.pauses),
    returnedOnTime: n(row.returned_on_time),
    rewardsFinished: n(row.rewards_finished),
    backToWorkAfterReward: n(row.back_to_work),
    rewardsEnabled: row.rewards_enabled !== false,
    toolButtonsShown: n(row.buttons_shown),
    quickStartsAfterButton: n(row.quick_starts),
    windowsPlanned: n(row.windows_planned),
    windowsUsed: n(row.windows_used),
    blocksInWindow: n(row.blocks_in_window),
    blocksOutsideWindow: n(row.blocks_outside_window),
    avgWindowMinutes: row.avg_window_minutes === null || row.avg_window_minutes === undefined ? null : n(row.avg_window_minutes),
  }));
}

const ratio = (part: number, whole: number) => (whole === 0 ? '–' : `${part}/${whole} (${Math.round((part / whole) * 100)}%)`);

export function formatFocusStats(stats: FocusStats[], days: number): string {
  const lines = [`Focusmeting · laatste ${days} dagen`, ''];
  for (const s of stats) {
    const row = (label: string, value: string) => `  ${label.padEnd(31)}${value}`;
    lines.push(
      `#${s.userId} ${s.name}`,
      row('Afgeronde blokken', ratio(s.blocksCompleted, s.blocksStarted)),
      row('Terug op tijd', ratio(s.returnedOnTime, s.pauses)),
      row('Terug naar werk na beloning', ratio(s.backToWorkAfterReward, s.rewardsFinished)),
      row('Snelle start na werkplek-knop', ratio(s.quickStartsAfterButton, s.toolButtonsShown)),
      row('Venster gebruikt', ratio(s.windowsUsed, s.windowsPlanned)),
      row('Afgeronde blokken in venster', `${s.blocksInWindow} · erbuiten ${s.blocksOutsideWindow}`),
      row('Gemiddelde vensterduur', s.avgWindowMinutes === null ? '–' : `${s.avgWindowMinutes} min`),
      row('Beloningen', s.rewardsEnabled ? 'aan' : 'uit'),
      '',
    );
  }
  lines.push(`Beloningen uitgezet: ${stats.filter((s) => !s.rewardsEnabled).length} van ${stats.length} gebruikers`);
  lines.push('Klikken op werkplek-knop: klikmeting staat uit (zie docs/later.md)');
  return lines.join('\n');
}
