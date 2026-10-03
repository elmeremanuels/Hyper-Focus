// The assistant (step 2a.7): a braindump becomes a proposal; you pick and edit, then it saves.
import { useEffect, useRef, useState } from 'react';
import { ESTIMATES, post, type KikiInfo, type KikiItem, type KikiPlan } from '../api';
import { T } from '../texts';
import { useSubmit } from '../useSubmit';
import { Button } from './Button';
import { Field, Select, Textarea } from './Form';

const t = T.kiki;

interface Row {
  item: KikiItem;
  on: boolean;
}

export function Kiki({ info, onClose, onSaved }: { info: KikiInfo; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<KikiPlan>();
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState<string>();
  const panel = useRef<HTMLDivElement>(null);
  const planning = useSubmit();
  const saving = useSubmit();

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = rows.filter((r) => r.on);
  const update = (i: number, change: Partial<Row> | ((item: KikiItem) => KikiItem)) =>
    setRows(rows.map((r, j) => (j !== i ? r : typeof change === 'function' ? { ...r, item: change(r.item) } : { ...r, ...change })));

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-ink/40" onClick={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={info.name}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l-2 border-ink bg-paper p-4 outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold">{info.name}</h2>
          <Button variant="quiet" onClick={onClose}>
            {t.close}
          </Button>
        </div>

        {!info.available ? (
          <p>
            {info.name} {t.off}
          </p>
        ) : !plan ? (
          <form
            className="grid gap-3"
            onSubmit={planning.run(async () => {
              const result = await post<KikiPlan>('/api/assistant/plan', { text });
              setPlan(result);
              setRows(result.items.map((item) => ({ item, on: true })));
              setDone(undefined);
            })}
          >
            <p className="text-muted">{t.intro}</p>
            {done && (
              <p role="status" className="rounded-xl border-2 border-ink bg-accent-soft px-4 py-3">
                {done}
              </p>
            )}
            <Field label={t.label}>
              <Textarea rows={10} required maxLength={info.maxChars} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            {planning.failed && <p className="text-sm font-semibold">{T.error}</p>}
            <div>
              <Button type="submit" variant="primary" disabled={planning.busy || !text.trim()}>
                {planning.busy ? t.sorting : t.sort}
              </Button>
            </div>
          </form>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={saving.run(async () => {
              const result = await post<{ saved: number; results: Array<{ ok: boolean }> }>('/api/assistant/apply', {
                // The server drops "where"; it is only for showing.
                items: chosen.map(({ item }) => item),
              });
              const failed = result.results.length - result.saved;
              setDone([t.saved(result.saved), failed ? t.failedSome(failed) : ''].filter(Boolean).join(' '));
              setPlan(undefined);
              setRows([]);
              setText('');
              onSaved();
            })}
          >
            <p className={plan.crisis ? 'rounded-xl border-2 border-ink bg-card p-4 font-semibold' : 'text-muted'}>{plan.reply}</p>
            <ul className="grid gap-3">
              {rows.map((row, i) => (
                <li key={i} className={`rounded-xl border-2 border-ink p-3 ${row.on ? 'bg-card shadow-hard' : 'bg-paper opacity-60'}`}>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={row.on} onChange={(e) => update(i, { on: e.target.checked })} className="size-5 accent-accent" />
                    {t.kinds[row.item.kind]}
                    {row.item.where && <span className="font-normal text-muted">· {row.item.where}</span>}
                  </label>
                  <ItemFields item={row.item} disabled={!row.on} onChange={(change) => update(i, change)} />
                </li>
              ))}
            </ul>
            {saving.failed && <p className="text-sm font-semibold">{T.error}</p>}
            <div className="flex flex-wrap gap-2">
              {rows.length > 0 && (
                <Button type="submit" variant="primary" disabled={saving.busy || chosen.length === 0}>
                  {t.save(chosen.length)}
                </Button>
              )}
              <Button variant="quiet" onClick={() => setPlan(undefined)}>
                {t.again}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ItemFields({ item, disabled, onChange }: { item: KikiItem; disabled: boolean; onChange: (change: (item: KikiItem) => KikiItem) => void }) {
  if (item.kind === 'task') {
    return (
      <div className="grid gap-2">
        <Textarea rows={2} aria-label={t.kinds.task} required disabled={disabled} value={item.title} onChange={(e) => onChange((it) => ({ ...it, title: e.target.value }) as KikiItem)} />
        <Select
          aria-label={t.noMinutes}
          disabled={disabled}
          value={item.estimated_minutes}
          onChange={(e) => onChange((it) => ({ ...it, estimated_minutes: Number(e.target.value) }) as KikiItem)}
        >
          {ESTIMATES.map((m) => (
            <option key={m} value={m}>
              {m} {t.min}
            </option>
          ))}
        </Select>
      </div>
    );
  }
  const key = item.kind === 'note' ? 'note' : 'text';
  const value = item.kind === 'note' ? item.note : item.text;
  return <Textarea rows={2} aria-label={t.kinds[item.kind]} required disabled={disabled} value={value} onChange={(e) => onChange((it) => ({ ...it, [key]: e.target.value }) as KikiItem)} />;
}
