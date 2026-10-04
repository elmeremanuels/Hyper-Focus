// Vandaag (step 2a.3): quick wins first, the task of the focus window last, the focus log below.
// On a wide screen the assistant stands in a second column on the right.
import { useState } from 'react';
import { post, type KikiInfo, type Today as TodayData, type TodayTask } from '../api';
import { Button, LinkButton } from '../components/Button';
import { KikiFlow } from '../components/Kiki';
import { Card } from '../components/Shell';
import { T } from '../texts';
import { useApi } from '../useApi';

const t = T.today;

export function Today({ onChange, assistant }: { onChange: () => void; assistant: KikiInfo | undefined }) {
  const today = useApi<TodayData>('/api/today', 60_000);
  const [note, setNote] = useState<string>();
  const refresh = async () => {
    await today.reload();
    onChange();
  };

  if (today.error) return <Card><p>{T.error}</p></Card>;
  if (!today.data) return <p className="text-muted">{T.loading}</p>;
  const d = today.data;

  return (
    <>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold first-letter:uppercase">{d.dayLabel}</h1>
        <p className="text-muted">{t.count[d.focus.length] ?? t.count[3]}</p>
      </div>

      <div className={`grid items-start gap-x-6 ${assistant?.available ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}`}>
      <div>

      {d.activeBlock && (
        <div className="mb-4 rounded-xl border-2 border-ink bg-accent px-4 py-3 font-semibold text-white">
          {d.activeBlock.phase === 'block' ? t.blockRuns : t.pitstopUntil} <span className="tabular">{d.activeBlock.endsAt}</span>
        </div>
      )}
      {note && (
        <div role="status" className="mb-4 rounded-xl border-2 border-ink bg-accent-soft px-4 py-3">
          {note}
        </div>
      )}

      {d.window && <WindowCard window={d.window} onMoved={refresh} />}

      {d.focus.length === 0 && (
        <Card>
          <p>{assistant?.available ? t.emptyWithAssistant : t.empty}</p>
        </Card>
      )}
      <div>
        {d.focus.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onDone={async () => {
              await post(`/api/tasks/${task.id}/done`);
              await refresh();
            }}
            onTomorrow={async () => {
              await post(`/api/tasks/${task.id}/tomorrow`);
              await refresh();
            }}
            onStart={async (minutes) => {
              await post(`/api/tasks/${task.id}/start`, { minutes });
              setNote(t.started);
              await refresh();
            }}
          />
        ))}
      </div>

      <Card title={t.log}>
        {d.log.length === 0 ? (
          <p className="text-muted">{t.logEmpty}</p>
        ) : (
          <ol className="divide-y-2 divide-ink/10">
            {d.log.map((line, i) => (
              <li key={i} className={`grid grid-cols-[auto_auto_1fr] gap-3 py-2 tabular ${line.inWindow ? 'border-l-4 border-accent pl-3' : 'pl-4'}`}>
                <span className="text-muted">{line.time}</span>
                <span className="text-muted">
                  {line.minutes} {t.min}
                </span>
                <span>{line.result ?? line.title}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      </div>

      {assistant?.available && (
        <Card title={assistant.name}>
          <KikiFlow info={assistant} rows={5} hint={t.telegramHint} onSaved={() => void refresh()} />
        </Card>
      )}
      </div>
    </>
  );
}

function WindowCard({ window, onMoved }: { window: NonNullable<TodayData['window']>; onMoved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState(window.start);
  return (
    <section className="mb-4 rounded-xl border-2 border-ink bg-ink p-4 text-paper shadow-hard">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm uppercase tracking-wide opacity-80">{t.window}</p>
          <p className="font-display text-2xl font-bold tabular">
            {window.start}–{window.end}
          </p>
        </div>
        {!editing && (
          <button type="button" className="rounded-xl border-2 border-paper px-3 py-2 text-sm font-semibold" onClick={() => setEditing(true)}>
            {t.moveWindow}
          </button>
        )}
      </div>
      {editing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await post('/api/window', { time });
            setEditing(false);
            await onMoved();
          }}
        >
          <label className="flex flex-col text-sm">
            {t.moveTo}
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 rounded-lg border-2 border-paper bg-card px-2 py-1 text-ink" />
          </label>
          <button type="submit" className="rounded-xl border-2 border-paper bg-accent px-3 py-2 text-sm font-semibold">
            {t.save}
          </button>
          <button type="button" className="px-2 py-2 text-sm underline" onClick={() => setEditing(false)}>
            {t.cancel}
          </button>
        </form>
      )}
    </section>
  );
}

function TaskCard({ task, onDone, onTomorrow, onStart }: { task: TodayTask; onDone: () => Promise<void>; onTomorrow: () => Promise<void>; onStart: (minutes: number) => Promise<void> }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const presets = task.inWindow ? [45, 60, 90] : [15, 25, 45];
  return (
    <section className={`mb-4 rounded-xl border-2 border-ink p-4 shadow-hard ${task.inWindow ? 'bg-accent-soft' : 'bg-card'}`}>
      <div className="mb-1 flex flex-wrap gap-2">
        {task.inWindow && <Badge>{t.inWindow}</Badge>}
        {task.quickWin && <Badge>{t.quickWin}</Badge>}
      </div>
      <h2 className="font-display text-lg font-bold">{task.title}</h2>
      <p className="text-sm text-muted">
        {[task.client ?? task.project, task.minutes ? `${task.minutes} ${t.min}` : null].filter(Boolean).join(' · ')}
      </p>
      {task.step && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">{t.firstStep}:</span> {task.step}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {choosing ? (
          <>
            <span className="self-center text-sm font-semibold">{t.howLong}</span>
            {presets.map((m) => (
              <Button key={m} variant="primary" disabled={busy} onClick={run(async () => { await onStart(m); setChoosing(false); })}>
                {m} {t.min}
              </Button>
            ))}
            <Button variant="quiet" onClick={() => setChoosing(false)}>
              {t.cancel}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={busy} onClick={() => setChoosing(true)}>
              {t.start}
            </Button>
            <Button disabled={busy} onClick={run(onDone)}>
              {t.done}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={run(onTomorrow)}>
              {t.tomorrow}
            </Button>
            {task.link && <LinkButton href={task.link.url}>{task.link.title}</LinkButton>}
          </>
        )}
      </div>
    </section>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="rounded-full border-2 border-ink bg-card px-2 py-0.5 text-xs font-semibold">{children}</span>;
}
