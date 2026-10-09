// Workplace links (step 1.10): ask once which tools the user works in, then show a button
// that opens the right tool for a task ("Open Moneybird → nieuwe factuur").
import { and, eq, gte } from 'drizzle-orm';
import { recordEvent } from '../core/events.js';
import { getUserTool, listUserTools, removeUserTool, saveUserTool } from '../core/user-tools.js';
import type { Database } from '../db/client.js';
import { events } from '../db/schema/index.js';
import {
  actionFor,
  catalogTool,
  LINK_REJECTED,
  labelFromLink,
  QUESTIONS,
  toolsFor,
  validateToolLink,
  WORK_LABELS,
  WORK_TYPES,
  type WorkType,
} from '../tools/catalog.js';
import type { ButtonContext, ButtonExtension } from './buttons.js';
import { clearState, getState, setState } from './state.js';
import type { Button, OutboundMessage } from './types.js';

export const WORKPLACE_TEXTS = {
  pasteAsk: (example: string) =>
    `Wil je de link plakken van het scherm waar je begint, bijvoorbeeld "${example}"? Dan kom je straks direct op de goede plek.`,
  pasteNow: 'Plak de link in je volgende bericht.',
  done: 'Klaar. Stuur "mijn tools" als je iets wilt wijzigen.',
  none: 'Je hebt nog geen tools ingesteld.',
  removed: 'Verwijderd.',
  rejected: LINK_REJECTED,
} as const;

const EXAMPLES: Record<WorkType, string> = {
  invoicing: 'nieuwe factuur',
  email: 'nieuwe mail',
  calendar: 'nieuwe afspraak',
  content: 'nieuwe post',
  website: 'nieuwe pagina',
  docs: 'nieuw document',
};

/** Singular names for the weekly question: "Ik zag een factuur-taak." */
const TASK_NOUNS: Record<WorkType, string> = {
  invoicing: 'factuur',
  email: 'mail',
  calendar: 'agenda',
  content: 'post',
  website: 'website',
  docs: 'document',
};

const PROMPT_EVERY_MS = 7 * 86_400_000;
const isWorkType = (value: string): value is WorkType => (WORK_TYPES as readonly string[]).includes(value);

interface OnboardingData extends Record<string, unknown> {
  queue: WorkType[];
  awaiting?: { workType: WorkType; toolKey: string };
}

// ---------------------------------------------------------------------------
// The button on a task

/** [Open {tool} → {actie}] for a task with a known kind of work and a tool; logged for the stats. */
export async function workplaceButton(
  db: Database,
  userId: number,
  task: { id: number; title: string; workType: WorkType | null },
): Promise<Button | undefined> {
  if (!task.workType) return undefined;
  const tool = await getUserTool(db, userId, task.workType);
  if (!tool) return undefined;
  await recordEvent(db, userId, 'tool_button_shown', { taskId: task.id, workType: task.workType });
  return { id: `link:${task.id}`, title: `Open ${tool.label} → ${actionFor(task.workType, task.title)}`, url: tool.url };
}

/**
 * For a task whose kind of work has no tool yet: once a week the question where the user
 * does that work. Returns undefined when asked within the last week.
 */
export async function weeklyToolQuestion(ctx: ButtonContext, workType: WorkType): Promise<OutboundMessage | undefined> {
  if (await getUserTool(ctx.db, ctx.userId, workType)) return undefined;
  const recent = await ctx.db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.userId, ctx.userId), eq(events.name, 'tool_prompt'), gte(events.createdAt, new Date(ctx.now.getTime() - PROMPT_EVERY_MS))))
    .limit(1);
  if (recent.length > 0) return undefined;
  await recordEvent(ctx.db, ctx.userId, 'tool_prompt', { workType });
  await setState(ctx.db, ctx.userId, 'onboarding', { queue: [workType] } satisfies OnboardingData, expiry(ctx.now));
  const question = askFor(workType);
  return { ...question, text: `Ik zag een ${TASK_NOUNS[workType]}-taak. ${question.text}` };
}

// ---------------------------------------------------------------------------
// Asking which tools the user works in

function expiry(now: Date): Date {
  return new Date(now.getTime() + 24 * 3_600_000);
}

function askFor(workType: WorkType): OutboundMessage {
  return {
    text: QUESTIONS[workType],
    choices: [
      ...toolsFor(workType).map((tool) => ({ id: `tl:${workType}:pick:${tool.key}`, title: tool.label })),
      { id: `tl:${workType}:skip`, title: 'Overslaan' },
      { id: `tl:${workType}:other`, title: 'Anders: plak je link' },
    ],
  };
}

async function next(ctx: ButtonContext, queue: WorkType[]): Promise<OutboundMessage[]> {
  const [first, ...rest] = queue;
  if (!first) {
    await clearState(ctx.db, ctx.userId);
    return [{ text: WORKPLACE_TEXTS.done }];
  }
  await setState(ctx.db, ctx.userId, 'onboarding', { queue: [first, ...rest] } satisfies OnboardingData, expiry(ctx.now));
  return [askFor(first)];
}

async function onboardingData(ctx: ButtonContext, workType: WorkType): Promise<OnboardingData> {
  const state = await getState(ctx.db, ctx.userId, ctx.now);
  if (state.mode === 'onboarding' && Array.isArray(state.data.queue)) return state.data as OnboardingData;
  return { queue: [workType] };
}

/** Starts the questions: all kinds of work, or only those without a tool yet. */
export async function startToolQuestions(ctx: ButtonContext, onlyMissing = false): Promise<OutboundMessage[]> {
  const configured = new Set((await listUserTools(ctx.db, ctx.userId)).map((tool) => tool.workType));
  const queue = WORK_TYPES.filter((wt) => !onlyMissing || !configured.has(wt));
  return next(ctx, queue);
}

/** "mijn tools": one line per tool with [Wijzig] [Verwijder]. */
export async function toolsOverview(ctx: Pick<ButtonContext, 'db' | 'userId'>): Promise<OutboundMessage> {
  const tools = await listUserTools(ctx.db, ctx.userId);
  if (tools.length === 0) {
    return { text: WORKPLACE_TEXTS.none, buttons: [{ id: 'tl:start', title: 'Tools instellen' }] };
  }
  const order = (wt: WorkType) => WORK_TYPES.indexOf(wt);
  const sorted = [...tools].sort((a, b) => order(a.workType) - order(b.workType));
  const rows: Button[][] = sorted.map((tool) => [
    { id: `tl:${tool.workType}:edit`, title: `Wijzig ${WORK_LABELS[tool.workType].toLowerCase()}` },
    { id: `tl:${tool.workType}:del`, title: 'Verwijder' },
  ]);
  if (tools.length < WORK_TYPES.length) rows.push([{ id: 'tl:missing', title: 'Tool toevoegen' }]);
  return {
    text: ['Je tools:', ...sorted.map((tool) => `${WORK_LABELS[tool.workType]}: ${tool.label}`)].join('\n'),
    rows,
  };
}

/** tl:start · tl:missing · tl:{wt}:pick:{key} · tl:{wt}:skip · tl:{wt}:other · tl:{wt}:paste · tl:{wt}:keep · tl:{wt}:edit · tl:{wt}:del */
export function workplaceButtons(): ButtonExtension {
  return async (button, ctx) => {
    if (button.kind !== 'tools') return undefined;
    if (button.action === 'start') return startToolQuestions(ctx);
    if (button.action === 'missing') return startToolQuestions(ctx, true);
    const workType = button.workType;
    if (!workType || !isWorkType(workType)) return undefined;
    const data = await onboardingData(ctx, workType);
    const rest = data.queue.filter((wt) => wt !== workType);

    switch (button.action) {
      case 'pick': {
        const tool = button.toolKey ? catalogTool(button.toolKey) : undefined;
        if (!tool) return next(ctx, rest);
        if (tool.defaultUrl) {
          await saveUserTool(ctx.db, ctx.userId, { workType, toolKey: tool.key, label: tool.label, url: tool.defaultUrl });
        }
        await setState(ctx.db, ctx.userId, 'onboarding', { queue: data.queue, awaiting: { workType, toolKey: tool.key } }, expiry(ctx.now));
        return [
          {
            text: WORKPLACE_TEXTS.pasteAsk(EXAMPLES[workType]),
            buttons: [
              { id: `tl:${workType}:paste`, title: 'Plak link' },
              tool.defaultUrl ? { id: `tl:${workType}:keep`, title: 'Gebruik de startpagina' } : { id: `tl:${workType}:skip`, title: 'Overslaan' },
            ],
          },
        ];
      }
      case 'other':
        await setState(ctx.db, ctx.userId, 'onboarding', { queue: data.queue, awaiting: { workType, toolKey: 'other' } }, expiry(ctx.now));
        return [{ text: WORKPLACE_TEXTS.pasteNow }];
      case 'paste':
        return [{ text: WORKPLACE_TEXTS.pasteNow }];
      case 'keep':
      case 'skip':
        return next(ctx, rest);
      case 'edit':
        return next(ctx, [workType]);
      case 'del': {
        await removeUserTool(ctx.db, ctx.userId, workType);
        const overview = await toolsOverview(ctx);
        return [{ ...overview, text: `${WORKPLACE_TEXTS.removed}\n${overview.text}` }];
      }
    }
  };
}

/** In onboarding mode a pasted link is stored for the kind of work being asked. */
export async function onboardingModeHandler(
  text: string,
  data: Record<string, unknown>,
  ctx: ButtonContext,
): Promise<OutboundMessage[] | undefined> {
  const { queue, awaiting } = data as OnboardingData;
  if (!awaiting || !isWorkType(awaiting.workType)) return undefined;
  const link = validateToolLink(text);
  if (!link) {
    // Only treat it as an attempt at a link; other text goes to the router as usual.
    return /^\s*\S+:\/\/|^\s*(www\.|javascript:|data:|file:)/i.test(text) ? [{ text: WORKPLACE_TEXTS.rejected }] : undefined;
  }
  const tool = catalogTool(awaiting.toolKey);
  await saveUserTool(ctx.db, ctx.userId, {
    workType: awaiting.workType,
    toolKey: tool ? tool.key : 'other',
    label: tool ? tool.label : labelFromLink(link),
    url: link,
  });
  return next(ctx, (queue ?? []).filter((wt) => wt !== awaiting.workType));
}
