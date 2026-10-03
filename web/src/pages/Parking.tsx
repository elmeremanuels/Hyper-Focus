// Parkeerplaats & ideeënbak (step 2a.5): parked tasks back or let go; ideas written down,
// edited, archived, or made into a project (one a week, BOUWPLAN.md 11.7).
import { useState } from 'react';
import { patch, post, type Parking as ParkingData } from '../api';
import { Button } from '../components/Button';
import { Field, FormActions, Textarea } from '../components/Form';
import { Card } from '../components/Shell';
import { T } from '../texts';
import { useApi } from '../useApi';
import { useSubmit } from '../useSubmit';

const t = T.parking;

export function Parking() {
  const data = useApi<ParkingData>('/api/parking');
  const [note, setNote] = useState<string>();

  if (data.error) return <Card><p>{T.error}</p></Card>;
  if (!data.data) return <p className="text-muted">{T.loading}</p>;
  const { parked, ideas, canPromote } = data.data;
  const reload = () => data.reload();

  return (
    <>
      {note && (
        <div role="status" className="mb-4 rounded-xl border-2 border-ink bg-accent-soft px-4 py-3">
          {note}
        </div>
      )}

      <h1 className="font-display text-2xl font-bold">{t.parked}</h1>
      <p className="mb-4 text-muted">{t.parkedIntro}</p>
      {parked.length === 0 && (
        <Card>
          <p className="text-muted">{t.parkedEmpty}</p>
        </Card>
      )}
      {parked.map((task) => (
        <ParkedCard key={task.id} task={task} onChange={reload} />
      ))}

      <h1 className="mt-8 font-display text-2xl font-bold">{t.ideas}</h1>
      <p className="mb-4 text-muted">{t.ideasIntro}</p>
      <NewIdea onSaved={reload} />
      {!canPromote && ideas.length > 0 && <p className="mb-4 text-sm text-muted">{t.promoteUsed}</p>}
      {ideas.length === 0 && (
        <Card>
          <p className="text-muted">{t.ideasEmpty}</p>
        </Card>
      )}
      {ideas.map((idea) => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          canPromote={canPromote}
          onChange={reload}
          onPromoted={(title) => {
            setNote(`"${title}" ${t.promoted}`);
            window.scrollTo(0, 0);
          }}
        />
      ))}
    </>
  );
}

function ParkedCard({ task, onChange }: { task: ParkingData['parked'][number]; onChange: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, failed, run } = useSubmit();
  const act = (action: 'unpark' | 'release') => void run(async () => {
    await post(`/api/tasks/${task.id}/${action}`);
    await onChange();
  })();
  return (
    <section className="mb-4 rounded-xl border-2 border-ink bg-card p-4 shadow-hard">
      <h2 className="font-display text-lg font-bold">{task.title}</h2>
      <p className="text-sm text-muted">{[task.client ?? task.project, task.minutes ? `${task.minutes} ${t.min}` : null].filter(Boolean).join(' · ')}</p>
      {failed && <p className="mt-2 text-sm font-semibold">{T.error}</p>}
      {confirming ? (
        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold">{t.releaseSure}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => act('release')}>
              {t.release}
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              {T.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => act('unpark')}>
            {t.unpark}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => setConfirming(true)}>
            {t.release}
          </Button>
        </div>
      )}
    </section>
  );
}

function NewIdea({ onSaved }: { onSaved: () => Promise<void> }) {
  const [text, setText] = useState('');
  const { busy, failed, run } = useSubmit(() => setText(''));
  return (
    <Card>
      <form
        className="grid gap-3"
        onSubmit={run(async () => {
          await post('/api/ideas', { text });
          await onSaved();
        })}
      >
        <Field label={t.newIdea}>
          <Textarea rows={2} required value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {failed && <p className="text-sm font-semibold">{T.error}</p>}
        <div>
          <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
            {t.add}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function IdeaCard({ idea, canPromote, onChange, onPromoted }: { idea: ParkingData['ideas'][number]; canPromote: boolean; onChange: () => Promise<void>; onPromoted: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(idea.text);
  const close = () => setEditing(false);
  const { busy, failed, run } = useSubmit(close);
  const date = new Date(`${idea.date}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  return (
    <section className="mb-4 rounded-xl border-2 border-ink bg-card p-4 shadow-hard">
      {editing ? (
        <form
          className="grid gap-3"
          onSubmit={run(async () => {
            await patch(`/api/ideas/${idea.id}`, { text });
            await onChange();
          })}
        >
          <Textarea rows={3} required value={text} onChange={(e) => setText(e.target.value)} aria-label={t.edit} />
          <FormActions busy={busy} failed={failed} onCancel={close} />
        </form>
      ) : (
        <>
          <p className="whitespace-pre-line">{idea.text}</p>
          <p className="mt-1 text-sm text-muted tabular">{date}</p>
          {failed && <p className="mt-2 text-sm font-semibold">{T.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {canPromote && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { title } = await post<{ title: string }>(`/api/ideas/${idea.id}/promote`);
                    onPromoted(title);
                    await onChange();
                  })()
                }
              >
                {t.promote}
              </Button>
            )}
            <Button disabled={busy} onClick={() => setEditing(true)}>
              {t.edit}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post(`/api/ideas/${idea.id}/archive`);
                  await onChange();
                })()
              }
            >
              {t.archive}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
