// Instellingen (step 2a.6): rhythm, work week, day times, quiet hours, rewards, calendar, tools,
// profile, and export and delete (BOUWPLAN.md, 14). Each card saves on its own.
import { useState, type ReactNode } from 'react';
import { del, patch, post, put, type FocusPref, type Settings as SettingsData } from '../api';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Form';
import { Card } from '../components/Shell';
import { T } from '../texts';
import { useApi } from '../useApi';
import { useSubmit } from '../useSubmit';

const t = T.settings;
type Reload = () => Promise<void>;

export function Settings() {
  const data = useApi<SettingsData>('/api/settings');
  if (data.error) return <Card><p>{T.error}</p></Card>;
  if (!data.data) return <p className="text-muted">{T.loading}</p>;
  const s = data.data;
  const reload = () => data.reload();
  return (
    <>
      <h1 className="mb-4 font-display text-2xl font-bold">{T.nav.settings}</h1>
      <RhythmCard rhythm={s.rhythm} onSaved={reload} />
      <WorkWeekCard week={s.workWeek} onSaved={reload} />
      <DayCard day={s.day} quiet={s.quiet} onSaved={reload} />
      <RewardsCard enabled={s.rewardsEnabled} onSaved={reload} />
      <CalendarCard calendar={s.calendar} onSaved={reload} />
      <ToolsCard tools={s.tools} onSaved={reload} />
      <ProfileCard profile={s.profile} onSaved={reload} />
      <DataCard />
      <form method="post" action="/auth/logout" className="mb-4">
        <Button type="submit">{t.logout}</Button>
      </form>
    </>
  );
}

/** A card with one save action and a short "Opgeslagen." after it. */
function SettingsForm({ title, intro, children, save, dirty = true }: { title: string; intro?: string; children: ReactNode; save: () => Promise<unknown>; dirty?: boolean }) {
  const [saved, setSaved] = useState(false);
  const { busy, failed, run } = useSubmit(() => setSaved(true));
  return (
    <Card title={title}>
      {intro && <p className="mb-3 text-sm text-muted">{intro}</p>}
      <form
        className="grid gap-3"
        onChange={() => setSaved(false)}
        onSubmit={run(save)}
      >
        {children}
        {failed && <p className="text-sm font-semibold">{T.error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy || !dirty}>
            {T.save}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-muted">
              {t.saved}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

/** Toggle buttons: one choice or several, as pressed buttons. */
function Choice<V extends string | number>({ options, selected, onToggle, label }: { options: Array<{ value: V; label: string }>; selected: V[]; onToggle: (v: V) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            className={`min-w-11 rounded-xl border-2 border-ink px-3 py-2 text-sm font-semibold ${on ? 'bg-ink text-paper' : 'bg-card'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RhythmCard({ rhythm, onSaved }: { rhythm: SettingsData['rhythm']; onSaved: Reload }) {
  const [pref, setPref] = useState<FocusPref | null>(rhythm.pref);
  const [start, setStart] = useState(rhythm.start ?? rhythm.prefStart);
  const [minutes, setMinutes] = useState(String(rhythm.minutes));
  const prefs = (Object.keys(t.prefs) as FocusPref[]).map((value) => ({ value, label: t.prefs[value] }));
  return (
    <SettingsForm
      title={t.rhythm}
      intro={t.rhythmIntro}
      save={async () => {
        if (pref && pref !== rhythm.pref) await post('/api/settings/rhythm', { pref });
        await post('/api/settings/rhythm', { start, minutes: Number(minutes) });
        await onSaved();
      }}
    >
      <Choice
        label={t.rhythm}
        options={prefs}
        selected={pref ? [pref] : []}
        onToggle={(value) => {
          setPref(value);
          setStart(rhythm.prefStarts[value]);
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.ownStart}>
          <Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t.length}>
          <Select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {rhythm.lengths.map((m) => (
              <option key={m} value={m}>
                {m} {t.min}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {rhythm.learned.length > 0 && (
        <div>
          <p className="text-sm font-semibold">{t.learned}</p>
          <p className="text-sm text-muted">{t.learnedIntro}</p>
          <ul className="mt-1 text-sm tabular">
            {rhythm.learned.map((l) => (
              <li key={l.weekday}>
                {t.dayNames[l.weekday - 1]} {l.start}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsForm>
  );
}

function WorkWeekCard({ week, onSaved }: { week: SettingsData['workWeek']; onSaved: Reload }) {
  const [days, setDays] = useState(week.days);
  const [start, setStart] = useState(week.start);
  const [end, setEnd] = useState(week.end);
  const last = [...days].sort((a, b) => a - b).at(-1);
  return (
    <SettingsForm
      title={t.workWeek}
      dirty={days.length > 0}
      save={async () => {
        await patch('/api/settings', { workDays: days, workStart: start, workEnd: end });
        await onSaved();
      }}
    >
      <Choice
        label={t.workDays}
        options={t.days.map((label, i) => ({ value: i + 1, label }))}
        selected={days}
        onToggle={(d) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.workStart}>
          <Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t.workEnd}>
          <Input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      {last && (
        <p className="text-sm text-muted">
          {t.reviewOn} {t.dayNames[last - 1]}.
        </p>
      )}
    </SettingsForm>
  );
}

function DayCard({ day, quiet, onSaved }: { day: SettingsData['day']; quiet: SettingsData['quiet']; onSaved: Reload }) {
  const [morning, setMorning] = useState(day.morningTime);
  const [midday, setMidday] = useState(day.middayEnabled);
  const [wrapup, setWrapup] = useState(day.wrapupTime);
  const [quietStart, setQuietStart] = useState(quiet.start);
  const [quietEnd, setQuietEnd] = useState(quiet.end);
  return (
    <SettingsForm
      title={t.dayTimes}
      save={async () => {
        await patch('/api/settings', { morningTime: morning, middayEnabled: midday, wrapupTime: wrapup, quietStart, quietEnd });
        await onSaved();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.morning}>
          <Input type="time" required value={morning} onChange={(e) => setMorning(e.target.value)} />
        </Field>
        <Field label={t.wrapup}>
          <Input type="time" required value={wrapup} onChange={(e) => setWrapup(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={midday} onChange={(e) => setMidday(e.target.checked)} className="size-5 accent-accent" />
        {t.midday}
      </label>
      <p className="mt-2 font-display font-bold">{t.quiet}</p>
      <p className="-mt-2 text-sm text-muted">{t.quietIntro}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.from}>
          <Input type="time" required value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
        </Field>
        <Field label={t.to}>
          <Input type="time" required value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
        </Field>
      </div>
    </SettingsForm>
  );
}

function RewardsCard({ enabled, onSaved }: { enabled: boolean; onSaved: Reload }) {
  const { busy, failed, run } = useSubmit();
  const set = (value: boolean) =>
    void run(async () => {
      await patch('/api/settings', { rewardsEnabled: value });
      await onSaved();
    })();
  return (
    <Card title={t.rewards}>
      <p className="mb-3 text-sm text-muted">{t.rewardsIntro}</p>
      <Choice
        label={t.rewards}
        options={[
          { value: 'on', label: t.on },
          { value: 'off', label: t.off },
        ]}
        selected={[enabled ? 'on' : 'off']}
        onToggle={(v) => !busy && set(v === 'on')}
      />
      {failed && <p className="mt-2 text-sm font-semibold">{T.error}</p>}
    </Card>
  );
}

function CalendarCard({ calendar, onSaved }: { calendar: SettingsData['calendar']; onSaved: Reload }) {
  const { busy, failed, run } = useSubmit();
  const [headsUp, setHeadsUp] = useState(calendar.meetingHeadsUp);
  const [followup, setFollowup] = useState(calendar.meetingFollowup);
  const connected = calendar.connections.length > 0;
  const toggle = (field: 'meetingHeadsUp' | 'meetingFollowup', value: boolean) =>
    void run(async () => {
      if (field === 'meetingHeadsUp') setHeadsUp(value);
      else setFollowup(value);
      await patch('/api/settings', { [field]: value });
    })();
  return (
    <Card title={t.calendar}>
      <p className="mb-3 text-sm text-muted">{t.calendarIntro}</p>
      {!calendar.available && !connected ? (
        <p>{t.calendarOff}</p>
      ) : connected ? (
        <>
          <ul className="mb-3">
            {calendar.connections.map((c) => (
              <li key={c.provider} className="font-semibold">
                {t.calendarLinked}: {t.providers[c.provider] ?? c.provider}
              </li>
            ))}
          </ul>
          <div className="mb-3 grid gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={headsUp} disabled={busy} onChange={(e) => toggle('meetingHeadsUp', e.target.checked)} className="size-5 accent-accent" />
              {t.headsUp}
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={followup} disabled={busy} onChange={(e) => toggle('meetingFollowup', e.target.checked)} className="size-5 accent-accent" />
              {t.followup}
            </label>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await post('/api/settings/calendar/disconnect');
                await onSaved();
              })()
            }
          >
            {t.disconnect}
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3">{t.calendarNone}</p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              // Open the window first, in the tap itself, so a popup blocker lets it through.
              const tab = window.open('', '_blank');
              void run(async () => {
                const { url } = await post<{ url: string }>('/api/settings/calendar/connect');
                if (tab) tab.location.href = url;
                else window.location.assign(url);
              })();
            }}
          >
            {t.connect}
          </Button>
          <p className="mt-2 text-sm text-muted">{t.connectNote}</p>
        </>
      )}
      {failed && <p className="mt-2 text-sm font-semibold">{T.error}</p>}
    </Card>
  );
}

function ToolsCard({ tools, onSaved }: { tools: SettingsData['tools']; onSaved: Reload }) {
  return (
    <Card title={t.tools}>
      <p className="mb-3 text-sm text-muted">{t.toolsIntro}</p>
      <ul className="divide-y-2 divide-ink/10">
        {tools.map((tool) => (
          <ToolRow key={tool.workType} tool={tool} onSaved={onSaved} />
        ))}
      </ul>
    </Card>
  );
}

const OWN = 'other';

function ToolRow({ tool, onSaved }: { tool: SettingsData['tools'][number]; onSaved: Reload }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(tool.current?.key ?? '');
  const [url, setUrl] = useState(tool.current?.key === OWN ? tool.current.url : '');
  const close = () => setOpen(false);
  const { busy, failed, run } = useSubmit(close);
  const option = tool.options.find((o) => o.key === key);
  const needsLink = key === OWN || Boolean(option?.needsLink);
  if (!open) {
    return (
      <li className="flex items-center justify-between gap-3 py-2">
        <span>
          <span className="font-semibold">{tool.label}</span>
          <span className="block text-sm text-muted">{tool.current?.label ?? t.none}</span>
        </span>
        <Button variant="quiet" onClick={() => setOpen(true)}>
          {T.projects.edit}
        </Button>
      </li>
    );
  }
  return (
    <li className="py-3">
      <form
        className="grid gap-3"
        onSubmit={run(async () => {
          await put(`/api/settings/tools/${tool.workType}`, key === OWN ? { url } : { toolKey: key, ...(needsLink ? { url } : {}) });
          await onSaved();
        })}
      >
        <Field label={tool.label}>
          <Select required value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="" disabled>
              {t.choose}
            </option>
            {tool.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
            <option value={OWN}>{t.ownLink}</option>
          </Select>
        </Field>
        {needsLink && (
          <Field label={t.link}>
            <Input type="url" required inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        )}
        {failed && <p className="text-sm font-semibold">{T.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy || !key}>
            {T.save}
          </Button>
          <Button variant="quiet" onClick={close}>
            {T.cancel}
          </Button>
          {tool.current && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await del(`/api/settings/tools/${tool.workType}`);
                  await onSaved();
                })()
              }
            >
              {t.remove}
            </Button>
          )}
        </div>
      </form>
    </li>
  );
}

const ZONES = ['Europe/Amsterdam', 'Europe/Brussels', 'Europe/Lisbon', 'Europe/London', 'Asia/Makassar', 'Asia/Jakarta', 'Asia/Bangkok', 'America/New_York'];

function ProfileCard({ profile, onSaved }: { profile: SettingsData['profile']; onSaved: Reload }) {
  const [name, setName] = useState(profile.name);
  const [timezone, setTimezone] = useState(profile.timezone);
  const zones = ZONES.includes(profile.timezone) ? ZONES : [profile.timezone, ...ZONES];
  return (
    <SettingsForm
      title={t.profile}
      save={async () => {
        await patch('/api/settings', { name, timezone });
        await onSaved();
      }}
    >
      <Field label={t.name}>
        <Input required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t.timezone}>
        <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </Field>
      {profile.email && <p className="text-sm text-muted">{profile.email}</p>}
    </SettingsForm>
  );
}

function DataCard() {
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState('');
  const { busy, failed, run } = useSubmit(() => window.location.assign('/login'));
  return (
    <Card title={t.data}>
      <p className="mb-3 text-sm text-muted">{t.dataIntro}</p>
      <div className="flex flex-wrap gap-2">
        <a href="/api/export" download className="rounded-xl border-2 border-ink bg-card px-4 py-2 text-sm font-semibold">
          {t.export}
        </a>
        {!deleting && (
          <Button variant="quiet" onClick={() => setDeleting(true)}>
            {t.delete}
          </Button>
        )}
      </div>
      {deleting && (
        <form
          className="mt-4 grid gap-3 border-t-2 border-ink/10 pt-3"
          onSubmit={run(() => post('/api/account/delete', { confirm: word }))}
        >
          <p className="font-semibold">{t.deleteWarn}</p>
          <Field label={t.deleteType}>
            <Input value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
          </Field>
          {failed && <p className="text-sm font-semibold">{T.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="strong" disabled={busy || word.trim().toLowerCase() !== t.deleteWord}>
              {t.deleteNow}
            </Button>
            <Button variant="quiet" onClick={() => setDeleting(false)}>
              {T.cancel}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
