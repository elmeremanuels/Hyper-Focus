// Context for Claude, at most about 3,000 tokens (BOUWPLAN.md, 10.3).
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { messages } from '../db/schema/index.js';
import { listActiveClients } from '../core/clients.js';
import { getProfile } from '../core/profile.js';
import { listActiveProjects } from '../core/projects.js';
import { getSettings } from '../core/settings.js';
import { listOpenSuggestions } from '../core/suggestions.js';
import { listOpenTasks } from '../core/tasks.js';
import { describeLocal, localDate } from '../lib/time.js';
import { getTask } from '../core/tasks.js';
import { getState } from './state.js';
import { todaysFocus } from './views.js';

export interface ContextTask {
  id: number;
  title: string;
  projectTitle: string;
  clientName: string | null;
  estimatedMinutes: number | null;
  dueDate: string | null;
  status: string;
}

export interface ContextData {
  name: string;
  businessName: string | null;
  timezone: string;
  /** "woensdag 1 oktober 2026, 10:30" in the user's timezone. */
  localTime: string;
  /** YYYY-MM-DD in the user's timezone. */
  today: string;
  settings: { morningTime: string; wrapupTime: string; sessionMinutes: number; pausedUntil: string | null };
  focus: ContextTask[];
  openTasks: ContextTask[];
  projects: Array<{ id: number; title: string; clientName: string | null }>;
  clients: string[];
  suggestions: Array<{ id: number; title: string; status: string }>;
  /** The running work session, if any. */
  session: { taskId: number; stepId: number; stepTitle: string } | null;
  /** Oldest first. */
  recentMessages: Array<{ direction: 'in' | 'out'; body: string }>;
}

export const MAX_CONTEXT_CHARS = 12_000; // roughly 3,000 tokens

export async function loadContext(db: Database, userId: number, now: Date): Promise<ContextData> {
  const profile = await getProfile(db, userId);
  if (!profile) throw new Error(`Unknown user ${userId}`);
  const tz = profile.timezone;

  const [state, settings, focus, open, projectRows, clientRows, suggestionRows, messageRows] = await Promise.all([
    getState(db, userId, now),
    getSettings(db, userId),
    todaysFocus(db, userId, tz, now),
    listOpenTasks(db, userId, 10, now),
    listActiveProjects(db, userId),
    listActiveClients(db, userId),
    listOpenSuggestions(db, userId, 3),
    db
      .select({ direction: messages.direction, body: messages.body, transcript: messages.transcript })
      .from(messages)
      .where(and(eq(messages.userId, userId)))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(12),
  ]);

  const toTask = (task: (typeof open)[number]): ContextTask => ({
    id: task.id,
    title: task.title,
    projectTitle: task.projectTitle,
    clientName: task.clientName,
    estimatedMinutes: task.estimatedMinutes,
    dueDate: task.dueDate,
    status: task.status,
  });

  return {
    name: profile.name,
    businessName: profile.businessName,
    timezone: tz,
    localTime: describeLocal(tz, now),
    today: localDate(tz, now),
    settings: {
      morningTime: settings.morningTime.slice(0, 5),
      wrapupTime: settings.wrapupTime.slice(0, 5),
      sessionMinutes: settings.sessionMinutes,
      pausedUntil: settings.pausedUntil && settings.pausedUntil > now ? settings.pausedUntil.toISOString() : null,
    },
    focus: focus.map(toTask),
    openTasks: open.map(toTask),
    projects: projectRows.slice(0, 25).map((project) => ({
      id: project.id,
      title: project.title,
      clientName: project.clientName,
    })),
    clients: clientRows.map((client) => client.name),
    suggestions: suggestionRows.map((suggestion) => ({
      id: suggestion.id,
      title: suggestion.title,
      status: suggestion.status,
    })),
    session: await sessionInfo(db, userId, state),
    recentMessages: messageRows
      .reverse()
      .map((message) => ({ direction: message.direction, body: message.transcript ?? message.body ?? '' }))
      .filter((message) => message.body.length > 0),
  };
}

async function sessionInfo(
  db: Database,
  userId: number,
  state: Awaited<ReturnType<typeof getState>>,
): Promise<ContextData['session']> {
  if (state.mode !== 'session') return null;
  const taskId = Number(state.data.taskId);
  const stepId = Number(state.data.stepId);
  const step = await getTask(db, userId, stepId);
  return step ? { taskId, stepId, stepTitle: step.title } : null;
}

export function renderContext(data: ContextData): string {
  const task = (t: ContextTask) =>
    `- #${t.id} ${t.title} · project: ${t.projectTitle}${t.clientName ? ` (klant ${t.clientName})` : ''}` +
    `${t.estimatedMinutes ? ` · ${t.estimatedMinutes} min` : ''}${t.dueDate ? ` · deadline ${t.dueDate}` : ''}` +
    `${t.status === 'in_progress' ? ' · mee bezig' : ''}`;

  const head = [
    `Vandaag is het ${data.localTime} (${data.timezone}). Datum: ${data.today}.`,
    `Instellingen: ochtend ${data.settings.morningTime}, afronden ${data.settings.wrapupTime}, sessie ${data.settings.sessionMinutes} min` +
      `${data.settings.pausedUntil ? `, pauze tot ${data.settings.pausedUntil}` : ''}.`,
    '',
    'Focus vandaag:',
    ...(data.focus.length ? data.focus.map(task) : ['- (nog niets)']),
    '',
    'Belangrijkste open taken:',
    ...(data.openTasks.length ? data.openTasks.map(task) : ['- (geen)']),
    '',
    'Actieve projecten (id · titel · klant):',
    ...data.projects.map((p) => `- ${p.id} · ${p.title}${p.clientName ? ` · ${p.clientName}` : ''}`),
    '',
    `Klanten: ${data.clients.join(', ') || '(geen)'}`,
    ...(data.session
      ? ['', `Lopende sessie: taak #${data.session.taskId}, stap #${data.session.stepId} "${data.session.stepTitle}".`]
      : []),
    ...(data.suggestions.length
      ? ['', 'Open suggesties:', ...data.suggestions.map((s) => `- #${s.id} ${s.title} (${s.status})`)]
      : []),
  ].join('\n');

  // Recent messages fill what is left of the budget; the oldest go first.
  const history = data.recentMessages.map(
    (message) => `${message.direction === 'in' ? 'Gebruiker' : 'Hyper&Focus'}: ${truncate(message.body, 300)}`,
  );
  while (history.length > 0 && head.length + history.join('\n').length + 40 > MAX_CONTEXT_CHARS) {
    history.shift();
  }

  return history.length > 0 ? `${head}\n\nLaatste berichten:\n${history.join('\n')}` : head;
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
