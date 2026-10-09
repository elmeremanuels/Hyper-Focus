// Tools for the conversation layer (BOUWPLAN.md, 10.2). Every tool that touches the
// database has a fixed schema; input is validated again before it runs.
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeClient } from '../ai/claude.js';
import type { CalendarService } from '../integrations/calendar/service.js';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { appendClientNote, findClientByName } from '../core/clients.js';
import { recordEvent } from '../core/events.js';
import { addIdea } from '../core/ideas.js';
import { getLooseTasksProject, getProject, listActiveProjects, setProjectDeadline } from '../core/projects.js';
import { getSettings, setPausedUntil, updateSettings, type SettingsPatch } from '../core/settings.js';
import { setSuggestionStatus } from '../core/suggestions.js';
import {
  createTask,
  ESTIMATES,
  getTask,
  setTaskStatus,
  snoozeTask,
  updateTaskDetails,
  type Estimate,
} from '../core/tasks.js';
import { projects } from '../db/schema/index.js';
import { isValidDate, isValidTime, localDate, startOfLocalDate, startOfNextLocalDay } from '../lib/time.js';
import type { ContentDeps } from '../content/posts.js';
import type { Button, InboundSource, OutboundMessage } from './types.js';
import { focusView, parkingMessage, SHOW_TODAY } from './views.js';
import { weeklyToolQuestion, workplaceButton } from './workplace.js';
import { WORK_TYPES } from '../tools/catalog.js';
import { dayName, lastWorkday } from '../focus/workweek.js';

export interface ToolContext {
  db: Database;
  userId: number;
  timezone: string;
  now: Date;
  source: InboundSource;
  /** For tools that need a second AI call, such as breaking down a big task. */
  claude?: Pick<ClaudeClient, 'callWithTools'> | undefined;
  /** Calendar providers and secrets, when the calendar is set up (step 1.8). */
  calendar?: CalendarService | undefined;
  /** For the reward mini-app link (step 1.9). */
  appBaseUrl?: string | undefined;
  /** Buffer for the content module (step C1). */
  content?: ContentDeps | undefined;
}

export interface ToolOutcome {
  /** What Claude reads back as the tool result. */
  content: string;
  isError?: boolean;
  /** Replaces Claude's reply: for lists and fixed texts. */
  reply?: OutboundMessage;
  /** Extra messages after the reply, such as the weekly tool question. */
  followUps?: OutboundMessage[];
  /** Only this reply (and its own follow-ups) goes out; Claude's text and other buttons are dropped. */
  exclusive?: boolean;
  buttons?: Button[];
}

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutcome>;
}

export function defineTool<S extends z.ZodType>(tool: ToolDefinition<S>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => {
    const schema = z.toJSONSchema(tool.input) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
  });
}

export async function runTool(
  tools: ToolDefinition[],
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return { content: `Onbekende tool: ${name}`, isError: true };
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Ongeldige invoer: ${z.prettifyError(parsed.error)}`, isError: true };
  }
  return tool.run(parsed.data, ctx);
}

export const date = z.string().refine(isValidDate, 'Gebruik YYYY-MM-DD');
const time = z.string().refine(isValidTime, 'Gebruik HH:MM');
const estimate = z
  .union(ESTIMATES.map((value) => z.literal(value)) as unknown as [z.ZodLiteral<5>, z.ZodLiteral<15>])
  .describe('Geschatte minuten: 5, 15, 30, 60 of 120.');

/** Telegram shows about 20 characters per button. */
export function buttonTitle(title: string): string {
  return title.length <= 20 ? title : `${title.slice(0, 19)}…`;
}

/**
 * The project for a new task: a valid project id, else the client's first active project
 * (created when the client has none), else Losse taken.
 */
export async function resolveProject(
  { db, userId }: Pick<ToolContext, 'db' | 'userId'>,
  input: { project_id?: number | undefined; client_name?: string | undefined },
): Promise<{ projectId: number; needsProject: boolean }> {
  if (input.project_id !== undefined) {
    const project = await getProject(db, userId, input.project_id);
    if (project && project.status === 'active') return { projectId: project.id, needsProject: false };
  }
  if (input.client_name) {
    const client = await findClientByName(db, userId, input.client_name);
    if (client) {
      const existing = (await listActiveProjects(db, userId)).find((p) => p.clientId === client.id);
      if (existing) return { projectId: existing.id, needsProject: false };
      const [created] = await db
        .insert(projects)
        .values({ userId, clientId: client.id, title: client.name })
        .returning({ id: projects.id });
      if (created) return { projectId: created.id, needsProject: false };
    }
  }
  return { projectId: await getLooseTasksProject(db, userId), needsProject: true };
}

const stamp = (ctx: ToolContext) => `[${localDate(ctx.timezone, ctx.now)}]`;

// ---------------------------------------------------------------------------

const addTask = defineTool({
  name: 'add_task',
  description:
    'Leg een taak vast. Kies project_id uit de lijst met actieve projecten als het duidelijk is. ' +
    'Noemt de gebruiker een klant, geef dan client_name. Twijfel je, laat beide weg: de taak gaat dan naar Losse taken ' +
    'en ik vraag waar hij hoort. Schat altijd de duur.',
  input: z.object({
    title: z.string().min(2).max(200).describe('Korte titel die met een werkwoord begint, bijv. "Banner maken voor Bakkerij De Vries".'),
    estimated_minutes: estimate,
    project_id: z.number().int().optional().describe('Id uit de lijst met actieve projecten.'),
    client_name: z.string().optional().describe('Naam van de klant zoals de gebruiker hem noemt.'),
    due_date: date.optional().describe('Deadline als YYYY-MM-DD, alleen als de gebruiker die noemt.'),
    notes: z.string().max(1000).optional(),
    work_type: z
      .enum(WORK_TYPES)
      .optional()
      .describe(
        'Alleen bij een duidelijk werkwoord + object: invoicing (factuur, offerte), email (mail sturen), calendar (afspraak plannen), ' +
          'content (post, social), website (pagina, site), docs (document, contract). Bij twijfel weglaten.',
      ),
  }),
  async run(input, ctx) {
    const { db, userId } = ctx;
    const { projectId, needsProject } = await resolveProject(ctx, input);

    const { id } = await createTask(db, {
      userId,
      projectId,
      title: input.title,
      estimatedMinutes: input.estimated_minutes as Estimate,
      dueDate: input.due_date ?? null,
      notes: input.notes ?? null,
      source: ctx.source,
      workType: input.work_type ?? null,
    });
    const task = await getTask(db, userId, id);
    const link = task ? await workplaceButton(db, userId, task) : undefined;
    const question = input.work_type && !link ? await weeklyToolQuestion(ctx, input.work_type) : undefined;
    const followUps = question ? { followUps: [question] } : {};

    if (needsProject) {
      const candidates = (await listActiveProjects(db, userId)).filter((p) => p.id !== projectId).slice(0, 3);
      return {
        content: `Taak #${id} "${input.title}" staat in Losse taken. Vraag kort bij welk project hij hoort; ik toon knoppen met projecten.`,
        buttons: [...candidates.map((p) => ({ id: `mv:${id}:${p.id}`, title: buttonTitle(p.title) })), ...(link ? [link] : [])],
        ...followUps,
      };
    }
    return {
      content: `Taak #${id} "${input.title}" aangemaakt in project "${task?.projectTitle}"${input.due_date ? `, deadline ${input.due_date}` : ''}.`,
      buttons: [{ id: `t:${id}:start`, title: 'Nu starten' }, ...(link ? [link] : [])],
      ...followUps,
    };
  },
});

const addIdeaTool = defineTool({
  name: 'add_idea',
  description: 'Zet een idee in de ideeënbak. Gebruik dit voor ideeën en "misschien ooit"-dingen, niet voor taken met een actie.',
  input: z.object({ text: z.string().min(2).max(1000) }),
  async run(input, ctx) {
    await addIdea(ctx.db, ctx.userId, input.text, ctx.source === 'web' ? 'web' : ctx.source);
    // The weekly review falls on the last work day (step 1.12).
    const day = dayName(lastWorkday((await getSettings(ctx.db, ctx.userId)).workDays));
    return {
      content: 'Idee opgeslagen in de ideeënbak.',
      reply: { text: `Staat in je ideeënbak. ${day.charAt(0).toUpperCase()}${day.slice(1)} kijken we ernaar.` },
    };
  },
});

const setTaskStatusTool = defineTool({
  name: 'set_task_status',
  description:
    'Werk de status van een bestaande taak bij: done (af), in_progress (mee bezig), parked (later), released (loslaten), open.',
  input: z.object({
    task_id: z.number().int().describe('Id van de taak uit de context.'),
    status: z.enum(['open', 'in_progress', 'parked', 'done', 'released']),
  }),
  async run(input, ctx) {
    const task = await getTask(ctx.db, ctx.userId, input.task_id);
    if (!task) return { content: `Taak #${input.task_id} bestaat niet.`, isError: true };
    await setTaskStatus(ctx.db, ctx.userId, input.task_id, input.status, ctx.now);
    const extra = input.status === 'done' ? ' Vier het kort en concreet.' : '';
    return {
      content: `Taak #${task.id} "${task.title}" staat nu op ${input.status}.${extra}`,
      ...(input.status === 'done' && { buttons: [SHOW_TODAY] }),
    };
  },
});

const setSuggestionStatusTool = defineTool({
  name: 'set_suggestion_status',
  description: 'Werk de status van een suggestie van de verbetermotor bij.',
  input: z.object({
    suggestion_id: z.number().int(),
    status: z.enum(['in_progress', 'done', 'parked', 'skipped', 'not_relevant']),
    reason: z.string().max(300).optional(),
  }),
  async run(input, ctx) {
    const ok = await setSuggestionStatus(ctx.db, ctx.userId, input.suggestion_id, input.status, input.reason ?? null, ctx.now);
    return ok
      ? { content: `Suggestie #${input.suggestion_id} staat op ${input.status}.` }
      : { content: `Suggestie #${input.suggestion_id} bestaat niet.`, isError: true };
  },
});

const snooze = defineTool({
  name: 'snooze',
  description: 'Schuif een taak op naar een latere dag ("doe ik donderdag"). De taak verschijnt pas weer vanaf die dag.',
  input: z.object({ task_id: z.number().int(), until_date: date.describe('Dag waarop de taak terugkomt, YYYY-MM-DD.') }),
  async run(input, ctx) {
    const task = await getTask(ctx.db, ctx.userId, input.task_id);
    if (!task) return { content: `Taak #${input.task_id} bestaat niet.`, isError: true };
    await snoozeTask(ctx.db, ctx.userId, task.id, startOfLocalDate(ctx.timezone, input.until_date));
    return { content: `Taak #${task.id} "${task.title}" komt terug op ${input.until_date}.` };
  },
});

const logNote = defineTool({
  name: 'log_note',
  description:
    'Leg een notitie vast bij een taak of klant, bijv. "klant belde, deadline wordt vrijdag". Geef task_id, project_id of client_name, en due_date als er een nieuwe deadline is.',
  input: z.object({
    note: z.string().min(2).max(1000),
    task_id: z.number().int().optional(),
    project_id: z.number().int().optional(),
    client_name: z.string().optional(),
    due_date: date.optional(),
  }),
  async run(input, ctx) {
    const { db, userId } = ctx;
    const note = `${stamp(ctx)} ${input.note}`;

    if (input.task_id !== undefined) {
      const ok = await updateTaskDetails(db, userId, input.task_id, {
        appendNote: note,
        ...(input.due_date && { dueDate: input.due_date }),
      });
      if (!ok) return { content: `Taak #${input.task_id} bestaat niet.`, isError: true };
      return { content: `Notitie bij taak #${input.task_id}${input.due_date ? `, deadline ${input.due_date}` : ''}.` };
    }

    let clientId: number | null = null;
    if (input.project_id !== undefined) {
      const project = await getProject(db, userId, input.project_id);
      if (!project) return { content: `Project ${input.project_id} bestaat niet.`, isError: true };
      if (input.due_date) await setProjectDeadline(db, userId, project.id, input.due_date);
      clientId = project.clientId;
    }
    if (clientId === null && input.client_name) {
      clientId = (await findClientByName(db, userId, input.client_name))?.id ?? null;
    }
    if (clientId === null) {
      return {
        content: 'Ik kan een notitie alleen bij een taak of klant bewaren. Vraag bij welke taak of klant hij hoort.',
        isError: true,
      };
    }
    await appendClientNote(db, userId, clientId, note);
    return { content: `Notitie bewaard bij de klant${input.due_date ? `, deadline ${input.due_date}` : ''}.` };
  },
});

const showToday = defineTool({
  name: 'show_today',
  description: 'Laat de focus van vandaag zien ("wat stond er ook alweer", "vandaag").',
  input: z.object({}),
  async run(_input, ctx) {
    return { content: 'Focus getoond.', reply: await focusView(ctx.db, ctx.userId, ctx.timezone, ctx.now) };
  },
});

const showParking = defineTool({
  name: 'show_parking',
  description: 'Laat de geparkeerde taken zien ("parkeerplaats").',
  input: z.object({}),
  async run(_input, ctx) {
    return { content: 'Parkeerplaats getoond.', reply: await parkingMessage(ctx.db, ctx.userId) };
  },
});

const pause = defineTool({
  name: 'pause',
  description:
    'Zet berichten van mij stil tot een dag ("laat me vandaag met rust" = tot morgen, "vakantie tot maandag" = tot maandag).',
  input: z.object({ until_date: date.describe('Eerste dag dat ik weer berichten mag sturen, YYYY-MM-DD.') }),
  async run(input, ctx) {
    const until = startOfLocalDate(ctx.timezone, input.until_date);
    if (until <= ctx.now) return { content: 'Die datum ligt niet in de toekomst.', isError: true };
    await setPausedUntil(ctx.db, ctx.userId, until);
    return { content: `Pauze tot ${input.until_date}. Bevestig kort en warm.` };
  },
});

const updateSettingsTool = defineTool({
  name: 'update_settings',
  description:
    'Wijzig een instelling, bijv. "stuur \'s ochtends pas om 9 uur" (morning_time 09:00). Tijden als HH:MM. ' +
    'Werkdagen, werktijden en de dag van de weekreview gaan via set_work_week.',
  input: z.object({
    morning_time: time.optional(),
    wrapup_time: time.optional(),
    midday_enabled: z.boolean().optional(),
    quiet_start: time.optional(),
    quiet_end: time.optional(),
    max_proactive_per_day: z.number().int().min(1).max(8).optional(),
    session_minutes: z.number().int().min(10).max(90).optional(),
  }),
  async run(input, ctx) {
    const patch: SettingsPatch = {
      ...(input.morning_time && { morningTime: input.morning_time }),
      ...(input.wrapup_time && { wrapupTime: input.wrapup_time }),
      ...(input.midday_enabled !== undefined && { middayEnabled: input.midday_enabled }),
      ...(input.quiet_start && { quietStart: input.quiet_start }),
      ...(input.quiet_end && { quietEnd: input.quiet_end }),
      ...(input.max_proactive_per_day !== undefined && { maxProactivePerDay: input.max_proactive_per_day }),
      ...(input.session_minutes !== undefined && { sessionMinutes: input.session_minutes }),
    };
    if (Object.keys(patch).length === 0) return { content: 'Geen instelling opgegeven.', isError: true };
    await updateSettings(ctx.db, ctx.userId, patch);
    return { content: `Instellingen bijgewerkt: ${JSON.stringify(input)}. Bevestig in één zin.` };
  },
});

const overwhelm = defineTool({
  name: 'overwhelm',
  description:
    'Gebruik bij signalen van overbelasting ("ik trek het niet", "alles loopt vast", "te veel"). Zet de dag stil. Stel daarna niets nieuws voor.',
  input: z.object({}),
  async run(_input, ctx) {
    const settings = await getSettings(ctx.db, ctx.userId);
    await setPausedUntil(ctx.db, ctx.userId, startOfNextLocalDay(ctx.timezone, ctx.now));
    await recordEvent(ctx.db, ctx.userId, 'overwhelm', { date: localDate(ctx.timezone, ctx.now) });
    const morning = settings.morningTime.slice(0, 5).replace(/^0/, '');
    return {
      content: 'Dag stilgezet.',
      exclusive: true,
      reply: { text: `Dank dat je het zegt. Ik zet vandaag alles stil. Morgen om ${morning} uur stuur ik één bericht.` },
    };
  },
});

/** Tools available from step 1.2. Later steps add break_down, start_session and calendar tools. */
export const CORE_TOOLS: ToolDefinition[] = [
  addTask,
  addIdeaTool,
  setTaskStatusTool,
  setSuggestionStatusTool,
  snooze,
  logNote,
  showToday,
  showParking,
  pause,
  updateSettingsTool,
  overwhelm,
];
