// Projecten & klanten (step 2a.4): lists, add and edit, and moving tasks between projects.
import { useState, type ReactNode } from 'react';
import { ClientContentSection } from '../components/ClientContent';
import { ESTIMATES, patch, post, type Client, type Project, type Projects as ProjectsData, type ProjectTask } from '../api';
import { Button } from '../components/Button';
import { Badge, Field, FormActions, Input, Select, Textarea } from '../components/Form';
import { Card } from '../components/Shell';
import { T } from '../texts';
import { useApi } from '../useApi';
import { useSubmit } from '../useSubmit';

const t = T.projects;

export function Projects() {
  const data = useApi<ProjectsData>('/api/projects');
  const [tab, setTab] = useState<'projects' | 'clients'>('projects');

  if (data.error) return <Card><p>{T.error}</p></Card>;
  if (!data.data) return <p className="text-muted">{T.loading}</p>;
  const { projects, clients } = data.data;
  const reload = () => data.reload();

  return (
    <>
      <div role="tablist" className="mb-4 inline-flex gap-1 rounded-xl border-2 border-ink bg-card p-1">
        {(['projects', 'clients'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-ink text-paper' : ''}`}
          >
            {k === 'projects' ? t.tabProjects : t.tabClients}
          </button>
        ))}
      </div>

      {tab === 'projects' ? (
        <>
          <NewProject clients={clients} onSaved={reload} />
          {projects.length === 0 && <Card><p className="text-muted">{t.noProjects}</p></Card>}
          <div className="grid items-start gap-x-4 md:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} projects={projects} clients={clients} onChange={reload} />
            ))}
          </div>
        </>
      ) : (
        <>
          <NewClient onSaved={reload} />
          {clients.length === 0 && <Card><p className="text-muted">{t.noClients}</p></Card>}
          <div className="grid items-start gap-x-4 md:grid-cols-2">
            {clients.map((c) => (
              <ClientCard key={c.id} client={c} onChange={reload} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Opener({ open, label, onOpen, children }: { open: boolean; label: string; onOpen: () => void; children: ReactNode }) {
  if (open) return <Card>{children}</Card>;
  return (
    <div className="mb-4">
      <Button onClick={onOpen}>+ {label}</Button>
    </div>
  );
}

function NewProject({ clients, onSaved }: { clients: Client[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const close = () => {
    setOpen(false);
    setTitle('');
    setClientId('');
  };
  const { busy, failed, run } = useSubmit(close);
  const onSubmit = run(async () => {
    await post('/api/projects', { title, clientId: clientId ? Number(clientId) : null });
    await onSaved();
  });
  return (
    <Opener open={open} label={t.newProject} onOpen={() => setOpen(true)}>
      <form className="grid gap-3" onSubmit={onSubmit}>
        <Field label={t.title}>
          <Input required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
        <FormActions busy={busy} failed={failed} onCancel={close} label={t.add} />
      </form>
    </Opener>
  );
}

function ClientSelect({ clients, value, onChange }: { clients: Client[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={t.client}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t.noClient}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const countTasks = (n: number) => (n === 1 ? t.oneTask : `${n} ${t.tasksMany}`);
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });

function ProjectCard({ project, projects, clients, onChange }: { project: Project; projects: Project[]; clients: Client[]; onChange: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const meta = [project.client, countTasks(project.tasks.length), project.deadline ? `${t.deadline} ${shortDate(project.deadline)}` : null].filter(Boolean).join(' · ');
  return (
    <section className={`mb-4 break-inside-avoid rounded-xl border-2 border-ink p-4 shadow-hard ${project.isWeeklyFocus ? 'bg-accent-soft' : 'bg-card'} ${project.status === 'parked' ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-2 empty:hidden">
            {project.isWeeklyFocus && <Badge>{t.weeklyFocus}</Badge>}
            {project.status === 'parked' && <Badge>{t.paused}</Badge>}
            {project.priority === 1 && <Badge>{t.priorities[1]}</Badge>}
          </div>
          <h2 className="font-display text-lg font-bold">{project.title}</h2>
          <p className="text-sm text-muted tabular">{meta}</p>
        </div>
        {!editing && (
          <Button variant="quiet" onClick={() => setEditing(true)}>
            {t.edit}
          </Button>
        )}
      </div>

      {editing && <ProjectForm project={project} clients={clients} onDone={() => setEditing(false)} onSaved={onChange} />}

      <ul className="mt-3 divide-y-2 divide-ink/10">
        {project.tasks.map((task) => (
          <TaskRow key={task.id} task={task} projectId={project.id} projects={projects} onChange={onChange} />
        ))}
      </ul>
      {project.tasks.length === 0 && <p className="mt-2 text-sm text-muted">{t.noTasks}</p>}

      {adding ? (
        <NewTask projectId={project.id} onDone={() => setAdding(false)} onSaved={onChange} />
      ) : (
        <div className="mt-3">
          <Button variant="quiet" onClick={() => setAdding(true)}>
            + {t.newTask}
          </Button>
        </div>
      )}
    </section>
  );
}

function ProjectForm({ project, clients, onDone, onSaved }: { project: Project; clients: Client[]; onDone: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(project.title);
  const [clientId, setClientId] = useState(project.clientId ? String(project.clientId) : '');
  const [deadline, setDeadline] = useState(project.deadline ?? '');
  const [priority, setPriority] = useState(String(project.priority));
  const [weekly, setWeekly] = useState(project.isWeeklyFocus);
  const save = (extra: Record<string, unknown> = {}) =>
    patch(`/api/projects/${project.id}`, {
      ...(project.loose ? {} : { title }),
      clientId: clientId ? Number(clientId) : null,
      deadline: deadline || null,
      priority: Number(priority),
      isWeeklyFocus: weekly,
      ...extra,
    }).then(onSaved);
  const { busy, failed, run } = useSubmit(onDone);
  const setStatus = (next: 'active' | 'parked' | 'done') => void run(() => save({ status: next }))();
  return (
    <form className="mt-3 grid gap-3 border-t-2 border-ink/10 pt-3" onSubmit={run(() => save())}>
      {!project.loose && (
        <Field label={t.title}>
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      )}
      <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.deadline}>
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <Field label={t.priority}>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {([1, 2, 3] as const).map((p) => (
              <option key={p} value={p}>
                {t.priorities[p]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} className="size-5 accent-accent" />
        {t.weeklyFocus}
      </label>
      <FormActions busy={busy} failed={failed} onCancel={onDone} />
      {!project.loose && (
        <div className="flex flex-wrap gap-2 border-t-2 border-ink/10 pt-3">
          {project.status === 'parked' ? (
            <Button disabled={busy} onClick={() => setStatus('active')}>
              {t.resume}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => setStatus('parked')}>
              {t.pause}
            </Button>
          )}
          <Button disabled={busy} onClick={() => setStatus('done')}>
            {t.finish}
          </Button>
        </div>
      )}
    </form>
  );
}

function MinutesSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label={t.minutes}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t.noMinutes}</option>
        {ESTIMATES.map((m) => (
          <option key={m} value={m}>
            {m} {t.min}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function NewTask({ projectId, onDone, onSaved }: { projectId: number; onDone: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const { busy, failed, run } = useSubmit(onDone);
  const onSubmit = run(async () => {
    await post(`/api/projects/${projectId}/tasks`, { title, minutes: minutes ? Number(minutes) : null });
    await onSaved();
  });
  return (
    <form className="mt-3 grid gap-3 border-t-2 border-ink/10 pt-3" onSubmit={onSubmit}>
      <Field label={t.title}>
        <Input required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <MinutesSelect value={minutes} onChange={setMinutes} />
      <FormActions busy={busy} failed={failed} onCancel={onDone} label={t.add} />
    </form>
  );
}

function TaskRow({ task, projectId, projects, onChange }: { task: ProjectTask; projectId: number; projects: Project[]; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [minutes, setMinutes] = useState(task.minutes ? String(task.minutes) : '');
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [target, setTarget] = useState(String(projectId));
  const close = () => setOpen(false);
  const { busy, failed, run } = useSubmit(close);
  const onSubmit = run(async () => {
    await patch(`/api/tasks/${task.id}`, {
      title,
      minutes: minutes ? Number(minutes) : null,
      dueDate: dueDate || null,
      ...(Number(target) !== projectId ? { projectId: Number(target) } : {}),
    });
    await onChange();
  });
  const park = run(async () => {
    await post(`/api/tasks/${task.id}/park`);
    await onChange();
  });

  if (!open) {
    return (
      <li>
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-baseline justify-between gap-3 py-2 text-left">
          <span>{task.title}</span>
          <span className="shrink-0 text-sm text-muted tabular">
            {[task.dueDate ? shortDate(task.dueDate) : null, task.minutes ? `${task.minutes} ${t.min}` : null].filter(Boolean).join(' · ')}
          </span>
        </button>
      </li>
    );
  }
  return (
    <li className="py-3">
      <form className="grid gap-3" onSubmit={onSubmit}>
        <Field label={t.title}>
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <MinutesSelect value={minutes} onChange={setMinutes} />
          <Field label={t.dueDate}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t.project}>
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <FormActions busy={busy} failed={failed} onCancel={close} />
        <div>
          <Button disabled={busy} onClick={() => void park()}>
            {t.park}
          </Button>
        </div>
      </form>
    </li>
  );
}

function NewClient({ onSaved }: { onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const close = () => {
    setOpen(false);
    setName('');
    setContact('');
  };
  const { busy, failed, run } = useSubmit(close);
  const onSubmit = run(async () => {
    await post('/api/clients', { name, contactName: contact || null });
    await onSaved();
  });
  return (
    <Opener open={open} label={t.newClient} onOpen={() => setOpen(true)}>
      <form className="grid gap-3" onSubmit={onSubmit}>
        <Field label={t.name}>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t.contact}>
          <Input value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <FormActions busy={busy} failed={failed} onCancel={close} label={t.add} />
      </form>
    </Opener>
  );
}

function ClientCard({ client, onChange }: { client: Client; onChange: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [contact, setContact] = useState(client.contactName ?? '');
  const [notes, setNotes] = useState(client.notes ?? '');
  const close = () => setEditing(false);
  const save = (extra: Record<string, unknown> = {}) =>
    patch(`/api/clients/${client.id}`, { name, contactName: contact || null, notes: notes || null, ...extra }).then(onChange);
  const { busy, failed, run } = useSubmit(close);
  const onSubmit = run(() => save());
  const meta = [client.contactName, t.projectCount[client.projects] ?? `${client.projects} ${t.projectsMany}`].filter(Boolean).join(' · ');
  return (
    <section className={`mb-4 break-inside-avoid rounded-xl border-2 border-ink bg-card p-4 shadow-hard ${client.status === 'paused' ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {client.status === 'paused' && (
            <div className="mb-1">
              <Badge>{t.paused}</Badge>
            </div>
          )}
          <h2 className="font-display text-lg font-bold">{client.name}</h2>
          <p className="text-sm text-muted">{meta}</p>
        </div>
        {!editing && (
          <Button variant="quiet" onClick={() => setEditing(true)}>
            {t.edit}
          </Button>
        )}
      </div>
      {!editing && client.notes && <p className="mt-2 whitespace-pre-line text-sm">{client.notes}</p>}
      {client.content && <ClientContentSection client={client} content={client.content} onChange={onChange} />}
      {editing && (
        <form className="mt-3 grid gap-3 border-t-2 border-ink/10 pt-3" onSubmit={onSubmit}>
          <Field label={t.name}>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t.contact}>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label={t.notes}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FormActions busy={busy} failed={failed} onCancel={close} />
          <div>
            <Button disabled={busy} onClick={() => void run(() => save({ status: client.status === 'paused' ? 'active' : 'paused' }))()}>
              {client.status === 'paused' ? t.resume : t.pause}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
