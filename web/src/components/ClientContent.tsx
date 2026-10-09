// The content part of a client card (step C1): free fields, the socials switch, Buffer and
// up to three channels with their own rhythm.
import { useState } from 'react';
import { api, del, patch, put, type BufferChannel, type Client, type ClientChannel, type ClientContent } from '../api';
import { T } from '../texts';
import { useSubmit } from '../useSubmit';
import { Button } from './Button';
import { Choice, Field, Input, Textarea } from './Form';

const t = T.projects;
const MAX_CHANNELS = 3;
type Reload = () => Promise<void>;

export function ClientContentSection({ client, content, onChange }: { client: Client; content: ClientContent; onChange: Reload }) {
  return (
    <div className="mt-3 grid gap-4 border-t-2 border-ink/10 pt-3">
      <ProfileFields clientId={client.id} profile={content.profile} onChange={onChange} />
      <Socials clientId={client.id} content={content} onChange={onChange} />
    </div>
  );
}

function ProfileFields({ clientId, profile, onChange }: { clientId: number; profile: ClientContent['profile']; onChange: Reload }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(profile);
  const close = () => setEditing(false);
  const { busy, failed, run } = useSubmit(close);
  const onSubmit = run(async () => {
    await patch(`/api/clients/${clientId}/content`, { profile: rows.filter((r) => r.label.trim() && r.value.trim()) });
    await onChange();
  });
  const update = (i: number, next: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const unused = t.suggestions.filter((s) => !rows.some((r) => r.label === s));

  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t.card}</h3>
          <Button
            variant="quiet"
            onClick={() => {
              setRows(profile);
              setEditing(true);
            }}
          >
            {t.edit}
          </Button>
        </div>
        {profile.length === 0 ? (
          <p className="text-sm text-muted">{t.cardEmpty}</p>
        ) : (
          <dl className="grid gap-1 text-sm">
            {profile.map((f) => (
              <div key={f.label}>
                <dt className="font-semibold">{f.label}</dt>
                <dd className="whitespace-pre-line">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }
  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <h3 className="font-semibold">{t.card}</h3>
      <p className="text-sm text-muted">{t.cardIntro}</p>
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 rounded-lg border-2 border-ink/20 p-2">
          <Field label={t.fieldLabel}>
            <Input value={row.label} maxLength={60} onChange={(e) => update(i, { label: e.target.value })} />
          </Field>
          <Field label={t.fieldValue}>
            <Textarea rows={3} value={row.value} maxLength={2000} onChange={(e) => update(i, { value: e.target.value })} />
          </Field>
          <div>
            <Button variant="quiet" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              {t.removeField}
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {unused.map((label) => (
          <Button key={label} onClick={() => setRows([...rows, { label, value: '' }])}>
            {`+ ${label}`}
          </Button>
        ))}
        <Button onClick={() => setRows([...rows, { label: '', value: '' }])}>{t.addField}</Button>
      </div>
      {failed && <p className="text-sm font-semibold">{T.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {T.save}
        </Button>
        <Button variant="quiet" onClick={close}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

function Socials({ clientId, content, onChange }: { clientId: number; content: ClientContent; onChange: Reload }) {
  const { busy, failed, run } = useSubmit();
  const [available, setAvailable] = useState<BufferChannel[] | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggle = (on: boolean) =>
    void run(async () => {
      await patch(`/api/clients/${clientId}/content`, { socialsEnabled: on });
      await onChange();
    })();
  const connect = run(async () => {
    setError(null);
    try {
      const res = await put<{ available: BufferChannel[] }>(`/api/clients/${clientId}/buffer`, { apiKey });
      setApiKey('');
      setAvailable(res.available);
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : T.error);
    }
  });
  const pick = () =>
    void run(async () => {
      setError(null);
      try {
        setAvailable((await api<{ available: BufferChannel[] }>(`/api/clients/${clientId}/buffer/channels`)).available);
      } catch (e) {
        setError(e instanceof Error ? e.message : T.error);
      }
    })();
  const disconnect = () =>
    void run(async () => {
      await del(`/api/clients/${clientId}/buffer`);
      setAvailable(null);
      await onChange();
    })();

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t.socials}</h3>
        <Choice
          label={t.socials}
          options={[
            { value: 'on', label: t.socialsOn },
            { value: 'off', label: t.socialsOff },
          ]}
          selected={[content.socialsEnabled ? 'on' : 'off']}
          onToggle={(v) => !busy && toggle(v === 'on')}
        />
      </div>
      {content.socialsEnabled && !content.bufferConnected && (
        <form className="grid gap-2" onSubmit={connect}>
          <Field label={t.bufferKey}>
            <Input type="password" autoComplete="off" required minLength={10} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <p className="text-sm text-muted">{t.bufferKeyHelp}</p>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {t.connect}
            </Button>
          </div>
        </form>
      )}
      {content.socialsEnabled && content.bufferConnected && (
        <>
          {available ? (
            <ChannelPicker clientId={clientId} available={available} chosen={content.channels} onDone={() => setAvailable(null)} onSaved={onChange} />
          ) : (
            <>
              <ChannelList channels={content.channels} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy} onClick={pick}>
                  {t.connect}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={disconnect}>
                  {t.disconnect}
                </Button>
              </div>
            </>
          )}
          <MediaSettings clientId={clientId} content={content} onChange={onChange} />
        </>
      )}
      {(error || failed) && <p className="text-sm font-semibold">{error ?? T.error}</p>}
    </div>
  );
}

const service = (s: string) => t.services[s] ?? s;
const rhythmText = (c: ClientChannel) =>
  c.days.length === 0 ? t.rhythmQueue : `${c.days.map((d) => T.settings.days[d - 1]).join(' ')} · ${c.time}`;

function ChannelList({ channels }: { channels: ClientChannel[] }) {
  if (channels.length === 0) return <p className="text-sm text-muted">{t.channelsNone}</p>;
  return (
    <ul className="grid gap-1 text-sm">
      {channels.map((c) => (
        <li key={c.bufferChannelId}>
          <span className="font-semibold">{c.name}</span> <span className="text-muted">({service(c.service)})</span>
          <br />
          {rhythmText(c)}
        </li>
      ))}
    </ul>
  );
}

function ChannelPicker({ clientId, available, chosen, onDone, onSaved }: { clientId: number; available: BufferChannel[]; chosen: ClientChannel[]; onDone: () => void; onSaved: Reload }) {
  const [picked, setPicked] = useState(() =>
    new Map(chosen.filter((c) => available.some((a) => a.id === c.bufferChannelId)).map((c) => [c.bufferChannelId, { days: c.days, time: c.time }])),
  );
  const { busy, failed, run } = useSubmit(onDone);
  const onSubmit = run(async () => {
    await put(`/api/clients/${clientId}/channels`, { channels: [...picked].map(([bufferChannelId, r]) => ({ bufferChannelId, ...r })) });
    await onSaved();
  });
  const set = (id: string, next: { days: number[]; time: string } | null) => {
    const copy = new Map(picked);
    if (next) copy.set(id, next);
    else copy.delete(id);
    setPicked(copy);
  };
  if (available.length === 0) return <p className="text-sm text-muted">{t.noChannels}</p>;
  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <p className="text-sm font-semibold">{t.pickChannels}</p>
      {available.map((a) => {
        const rhythm = picked.get(a.id);
        return (
          <div key={a.id} className="grid gap-2 rounded-lg border-2 border-ink/20 p-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={Boolean(rhythm)}
                disabled={!rhythm && picked.size >= MAX_CHANNELS}
                onChange={(e) => set(a.id, e.target.checked ? { days: [], time: '10:00' } : null)}
                className="size-5 accent-accent"
              />
              {a.name} <span className="font-normal text-muted">({service(a.service)} · {a.organization})</span>
            </label>
            {rhythm && (
              <>
                <p className="text-sm">{t.rhythm}</p>
                <Choice
                  label={`${t.rhythm} ${a.name}`}
                  options={T.settings.days.map((label, i) => ({ value: i + 1, label }))}
                  selected={rhythm.days}
                  onToggle={(d) => set(a.id, { ...rhythm, days: rhythm.days.includes(d) ? rhythm.days.filter((x) => x !== d) : [...rhythm.days, d] })}
                />
                <Field label={t.postTime}>
                  <Input type="time" required value={rhythm.time} onChange={(e) => set(a.id, { ...rhythm, time: e.target.value })} />
                </Field>
                {rhythm.days.length === 0 && <p className="text-sm text-muted">{t.rhythmQueue}</p>}
              </>
            )}
          </div>
        );
      })}
      {failed && <p className="text-sm font-semibold">{T.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {t.saveChannels}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

function MediaSettings({ clientId, content, onChange }: { clientId: number; content: ClientContent; onChange: Reload }) {
  const [folder, setFolder] = useState(content.photoFolderUrl ?? '');
  const [memes, setMemes] = useState(content.memesAllowed);
  const [saved, setSaved] = useState(false);
  const { busy, failed, run } = useSubmit(() => setSaved(true));
  const onSubmit = run(async () => {
    await patch(`/api/clients/${clientId}/content`, { photoFolderUrl: folder.trim() || null, memesAllowed: memes });
    await onChange();
  });
  return (
    <form className="grid gap-2" onSubmit={onSubmit} onChange={() => setSaved(false)}>
      <Field label={t.photoFolder}>
        <Input type="url" pattern="https://.*" value={folder} onChange={(e) => setFolder(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={memes} onChange={(e) => setMemes(e.target.checked)} className="size-5 accent-accent" />
        {t.memes}
      </label>
      {failed && <p className="text-sm font-semibold">{T.error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {T.save}
        </Button>
        {saved && (
          <span role="status" className="text-sm text-muted">
            {T.settings.saved}
          </span>
        )}
      </div>
    </form>
  );
}
