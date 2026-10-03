// The weekly review in three taps and the Monday overview by mail (BOUWPLAN.md, 11.7).
import { and, desc, eq, gte, isNull, ne } from 'drizzle-orm';
import { recordEvent } from '../core/events.js';
import { getSettings } from '../core/settings.js';
import { BLOCK_TEXTS, fill } from '../texts/werkblokken.nl.js';
import { gardenGrowthSince } from './blocks.js';
import { listOpenSuggestions } from '../core/suggestions.js';
import type { Database } from '../db/client.js';
import { ideas, projects, tasks } from '../db/schema/index.js';
import type { ButtonContext, ButtonExtension } from './buttons.js';
import { clearState, setState } from './state.js';
import type { Button, OutboundMessage } from './types.js';

const WEEK_MS = 7 * 86_400_000;
const REVIEW_TTL_MS = 24 * 60 * 60 * 1000;
/** Telegram choice lists show at most 8 rows. */
const MAX_CHOICES = 8;

async function doneThisWeek(db: Database, userId: number, now: Date, limit = 3) {
  return db
    .select({ title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.status, 'done'),
        isNull(tasks.parentTaskId),
        gte(tasks.completedAt, new Date(now.getTime() - WEEK_MS)),
      ),
    )
    .orderBy(desc(tasks.completedAt))
    .limit(limit);
}

async function activeProjects(db: Database, userId: number) {
  return db
    .select({ id: projects.id, title: projects.title, isWeeklyFocus: projects.isWeeklyFocus })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.status, 'active'), ne(projects.title, 'Losse taken')))
    .orderBy(desc(projects.isWeeklyFocus), projects.priority, projects.id)
    .limit(MAX_CHOICES);
}

async function inboxIdeas(db: Database, userId: number) {
  return db
    .select({ id: ideas.id, text: ideas.text })
    .from(ideas)
    .where(and(eq(ideas.userId, userId), eq(ideas.status, 'inbox')))
    .orderBy(desc(ideas.createdAt));
}

// ---------------------------------------------------------------------------
// Step 1: what went well

export async function reviewStart(ctx: Pick<ButtonContext, 'db' | 'userId' | 'now'>): Promise<OutboundMessage> {
  const done = await doneThisWeek(ctx.db, ctx.userId, ctx.now);
  await setState(ctx.db, ctx.userId, 'weekly_review', { step: 1 }, new Date(ctx.now.getTime() + REVIEW_TTL_MS));
  const intro =
    done.length === 0
      ? 'Tijd voor de weekreview, drie korte stappen.'
      : `Tijd voor de weekreview, drie korte stappen. Deze week af: ${listTitles(done.map((t) => t.title))} ✔`;
  // The garden line (step 1.9): only with rewards on and when it grew.
  const { rewardsEnabled } = await getSettings(ctx.db, ctx.userId);
  const leaves = rewardsEnabled ? await gardenGrowthSince(ctx.db, ctx.userId, new Date(ctx.now.getTime() - WEEK_MS)) : 0;
  const garden = leaves > 0 ? `\n${fill(BLOCK_TEXTS.gardenWeek, { n: leaves })}` : '';
  return {
    text: `${intro}${garden}\nWat ging goed? Tik of stuur een paar woorden.`,
    buttons: [
      { id: 'wr:good:focus', title: 'Focus hield ik vast' },
      { id: 'wr:good:clients', title: 'Klanten blij' },
      { id: 'wr:good:hard', title: 'Was een zware week' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Step 2: weekly focus project

async function askFocus(ctx: ButtonContext, prefix: string): Promise<OutboundMessage[]> {
  const list = await activeProjects(ctx.db, ctx.userId);
  if (list.length === 0) return askIdea(ctx, prefix);
  await setState(ctx.db, ctx.userId, 'weekly_review', { step: 2 }, new Date(ctx.now.getTime() + REVIEW_TTL_MS));
  return [
    {
      text: `${prefix}Welk project krijgt volgende week voorrang?`,
      choices: list.map((p) => ({ id: `wr:focus:${p.id}`, title: p.title })),
    },
  ];
}

async function setFocus(ctx: ButtonContext, projectId: number): Promise<string> {
  const [project] = await ctx.db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.userId, ctx.userId), eq(projects.id, projectId)));
  if (!project) return '';
  await ctx.db.update(projects).set({ isWeeklyFocus: false }).where(eq(projects.userId, ctx.userId));
  await ctx.db.update(projects).set({ isWeeklyFocus: true }).where(eq(projects.id, project.id));
  return `${project.title} krijgt voorrang. `;
}

// ---------------------------------------------------------------------------
// Step 3: promote one idea, at most once a week

async function askIdea(ctx: ButtonContext, prefix: string): Promise<OutboundMessage[]> {
  const list = await inboxIdeas(ctx.db, ctx.userId);
  const promotedThisWeek = await ctx.db
    .select({ id: ideas.id })
    .from(ideas)
    .where(and(eq(ideas.userId, ctx.userId), eq(ideas.status, 'promoted'), gte(ideas.reviewedAt, new Date(ctx.now.getTime() - WEEK_MS))));
  if (list.length === 0 || promotedThisWeek.length > 0) return finish(ctx, prefix);

  await setState(ctx.db, ctx.userId, 'weekly_review', { step: 3 }, new Date(ctx.now.getTime() + REVIEW_TTL_MS));
  const count = list.length === 1 ? 'staat 1 idee' : `staan ${list.length} ideeën`;
  const choices: Button[] = [
    { id: 'wr:idea:none', title: 'Laten staan' },
    ...list.slice(0, MAX_CHOICES - 1).map((idea) => ({ id: `wr:idea:${idea.id}`, title: idea.text })),
  ];
  return [{ text: `${prefix}In je ideeënbak ${count}. Eén promoveren tot project, of laten staan?`, choices }];
}

async function promoteIdea(ctx: ButtonContext, ideaId: number): Promise<string> {
  const [idea] = await ctx.db
    .select({ id: ideas.id, text: ideas.text, businessId: ideas.businessId })
    .from(ideas)
    .where(and(eq(ideas.userId, ctx.userId), eq(ideas.id, ideaId), eq(ideas.status, 'inbox')));
  if (!idea) return '';
  const title = idea.text.length <= 80 ? idea.text : `${idea.text.slice(0, 79)}…`;
  const [project] = await ctx.db
    .insert(projects)
    .values({ userId: ctx.userId, businessId: idea.businessId, title, goal: idea.text, priority: 3 })
    .returning({ id: projects.id });
  await ctx.db
    .update(ideas)
    .set({ status: 'promoted', promotedToProjectId: project?.id ?? null, reviewedAt: ctx.now })
    .where(eq(ideas.id, idea.id));
  return `"${title}" is nu een project. `;
}

async function finish(ctx: ButtonContext, prefix: string): Promise<OutboundMessage[]> {
  await ctx.db
    .update(ideas)
    .set({ reviewedAt: ctx.now })
    .where(and(eq(ideas.userId, ctx.userId), eq(ideas.status, 'inbox')));
  await clearState(ctx.db, ctx.userId);
  await recordEvent(ctx.db, ctx.userId, 'weekly_review_done', {});
  return [{ text: `${prefix}De weekreview is klaar. Fijne week.` }];
}

// ---------------------------------------------------------------------------

const GOOD_REPLIES: Record<string, string> = {
  focus: 'Mooi. ',
  clients: 'Top. ',
  hard: 'Dank dat je het zegt. Volgende week houden we het klein. ',
};

/** Handles wr:{step}:{value} buttons. */
export function reviewButtons(): ButtonExtension {
  return async (button, ctx) => {
    if (button.kind !== 'review') return undefined;
    if (button.step === 'start') return [await reviewStart(ctx)];
    if (button.step === 'good') return askFocus(ctx, GOOD_REPLIES[button.value] ?? 'Mooi. ');
    if (button.step === 'focus') return askIdea(ctx, await setFocus(ctx, Number(button.value)));
    if (button.step === 'idea') {
      const prefix = button.value === 'none' ? '' : await promoteIdea(ctx, Number(button.value));
      return finish(ctx, prefix);
    }
    return undefined;
  };
}

/** In weekly_review mode: a few words answer step 1; later steps want a tap. */
export async function reviewModeHandler(
  _text: string,
  data: Record<string, unknown>,
  ctx: ButtonContext,
): Promise<OutboundMessage[] | undefined> {
  if (data.step === 1) return askFocus(ctx, 'Dank je. ');
  return undefined;
}

// ---------------------------------------------------------------------------
// Monday overview by mail

export async function composeWeeklyMail(ctx: Pick<ButtonContext, 'db' | 'userId' | 'now'> & { name: string }) {
  // One query at a time: inside a transaction (sim:day) all queries share one connection.
  const done = await doneThisWeek(ctx.db, ctx.userId, ctx.now, 10);
  const focus = await ctx.db
    .select({ title: projects.title })
    .from(projects)
    .where(and(eq(projects.userId, ctx.userId), eq(projects.isWeeklyFocus, true), eq(projects.status, 'active')));
  const open = await listOpenSuggestions(ctx.db, ctx.userId, 3);

  const lines = [
    `Goedemorgen ${ctx.name}. ${done.length === 0 ? 'Een nieuwe week.' : `Vorige week ${done.length === 1 ? 'is 1 taak' : `zijn ${done.length} taken`} af.`}`,
    focus[0] ? `Deze week krijgt ${focus[0].title} voorrang.` : 'Er is nog geen focusproject gekozen.',
    ...(done.length > 0 ? ['', 'Af:', ...done.map((t) => `✔ ${t.title}`)] : []),
    ...(open.length > 0 ? ['', 'Open suggesties:', ...open.map((s) => `- ${s.title}`)] : []),
    '',
    'Antwoord op deze mail om iets vast te leggen.',
  ];
  const buttons: Button[] = open.flatMap((s) => [
    { id: `s:${s.id}:in_progress`, title: `Pak ik op: ${s.title}`.slice(0, 60) },
    { id: `s:${s.id}:not_relevant`, title: `Niet relevant: ${s.title}`.slice(0, 60) },
  ]);
  const message: OutboundMessage = { text: lines.join('\n'), ...(buttons.length > 0 && { buttons }) };
  return { subject: 'Je week bij Hyper&Focus', message };
}

function listTitles(titles: string[]): string {
  const lower = titles.map((t) => t.charAt(0).toLowerCase() + t.slice(1));
  return lower.length <= 1 ? (lower[0] ?? '') : `${lower.slice(0, -1).join(', ')} en ${lower.at(-1)}`;
}
