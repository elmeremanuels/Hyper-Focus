// Content module (step C2): every work day at 17:00 Claude writes the posts for tomorrow up to
// the next work day, per client, from the rhythm, the client card and the week. One bundle goes
// to Telegram with "Alles goed"; nothing goes live without approval.
import { and, desc, eq, gte, ilike, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { ClaudeClient } from '../ai/claude.js';
import { fillPrompt, loadPrompt } from '../ai/prompts.js';
import { getProfile } from '../core/profile.js';
import { getSettings } from '../core/settings.js';
import type { Database } from '../db/client.js';
import { clientChannels, clients, contentPosts, messages, projects, tasks } from '../db/schema/index.js';
import { isWorkday } from '../focus/workweek.js';
import { localNow, localTimeOnDate } from '../lib/time.js';
import { CONTENT_TEXTS, serviceLabel } from '../texts/content.nl.js';
import type { OutboundMessage } from '../conversation/types.js';
import { approvalMessage, describeSlot, LEAD_MINUTES, scheduleReminders } from './posts.js';

export const CONTENT_BUNDLE_TIME = '17:00';
const WEEK_MS = 7 * 24 * 3_600_000;
const RECENT_POSTS_MS = 14 * 24 * 3_600_000;

type ChannelRow = typeof clientChannels.$inferSelect;

export interface Slot {
  channel: ChannelRow;
  dueAt: Date;
}

/** Local dates from tomorrow up to and including the next work day (Friday → Saturday to Monday). */
export function coveredDates(workDays: number[], timezone: string, now: Date): string[] {
  const dates: string[] = [];
  let day = localNow(timezone, now).startOf('day');
  for (let i = 0; i < 7; i++) {
    day = day.plus({ days: 1 });
    dates.push(day.toISODate() ?? '');
    if (isWorkday(workDays, day.weekday)) break;
  }
  return dates;
}

/** The rhythm moments in the covered dates; channels without days use Buffer's queue and get none. */
export function slotsFor(channels: ChannelRow[], dates: string[], timezone: string, now: Date): Slot[] {
  const slots: Slot[] = [];
  for (const date of dates) {
    const weekday = DateTime.fromISO(date, { zone: timezone }).weekday;
    for (const channel of channels) {
      if (!channel.days.includes(weekday)) continue;
      const dueAt = localTimeOnDate(timezone, date, channel.postTime);
      if (dueAt.getTime() >= now.getTime() + LEAD_MINUTES * 60_000) slots.push({ channel, dueAt });
    }
  }
  return slots.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/** What happened around a client this week, in short lines. */
export async function weekFor(db: Database, userId: number, client: { id: number; name: string; notes: string | null }, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - WEEK_MS);
  const done = await db
    .select({ title: tasks.title, project: projects.title })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.userId, userId), eq(projects.clientId, client.id), eq(tasks.status, 'done'), isNotNull(tasks.completedAt), gte(tasks.completedAt, since)))
    .limit(15);
  // Client notes carry a date stamp; the last lines are the newest.
  const notes = (client.notes ?? '').split('\n').filter(Boolean).slice(-8);
  // Messages that name the client: its longest word ("Bakkerij De Vries" → bakkerij).
  const word = client.name.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? client.name;
  const said = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.direction, 'in'), gte(messages.createdAt, since), ilike(messages.body, `%${word.replace(/[%_]/g, '')}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(8);
  return [
    ...done.map((t) => `Afgerond: ${t.title} (${t.project})`),
    ...notes.map((n) => `Notitie: ${n}`),
    ...said.map((m) => `Bericht van de gebruiker: ${(m.body ?? '').slice(0, 300)}`),
  ];
}

const planInput = z.object({
  posts: z.array(z.object({ moment: z.number().int().min(1), text: z.string().min(5).max(3000) })).max(20),
  extra: z
    .object({ channel: z.number().int().min(1), text: z.string().min(5).max(3000), reason: z.string().min(3).max(200) })
    .nullable()
    .optional(),
});

const PLAN_TOOL = {
  name: 'plan_posts',
  description: 'De posts voor de momenten, en eventueel één extra post met de reden.',
  input_schema: {
    type: 'object' as const,
    properties: {
      posts: {
        type: 'array',
        items: { type: 'object', properties: { moment: { type: 'integer', description: 'Het nummer van het moment' }, text: { type: 'string' } }, required: ['moment', 'text'] },
      },
      extra: {
        type: ['object', 'null'],
        description: 'Alleen als er iets te delen valt; anders null.',
        properties: { channel: { type: 'integer', description: 'Het nummer van het kanaal' }, text: { type: 'string' }, reason: { type: 'string' } },
        required: ['channel', 'text', 'reason'],
      },
    },
    required: ['posts'],
  },
};

export interface BundleContext {
  db: Database;
  userId: number;
  timezone: string;
  now: Date;
  claude: Pick<ClaudeClient, 'callWithTools'>;
}

/**
 * Writes and stores the posts for every client with socials on. Returns the new post ids.
 * Throws when Claude fails, so the sender can try again.
 */
export async function planBundle(ctx: BundleContext): Promise<number[]> {
  const { db, userId, timezone, now } = ctx;
  const settings = await getSettings(db, userId);
  if (!settings.contentEnabled) return [];
  const profile = await getProfile(db, userId);
  const dates = coveredDates(settings.workDays, timezone, now);
  const rows = await db
    .select({ id: clients.id, name: clients.name, notes: clients.notes, profile: clients.profile })
    .from(clients)
    .where(and(eq(clients.userId, userId), eq(clients.status, 'active'), eq(clients.socialsEnabled, true), isNotNull(clients.bufferApiKeyEnc)));

  const created: number[] = [];
  for (const client of rows) {
    const channels = await db.select().from(clientChannels).where(and(eq(clientChannels.userId, userId), eq(clientChannels.clientId, client.id)));
    if (channels.length === 0) continue;
    // A moment that already has a post (written by hand, or an earlier run) stays as it is.
    const taken = await db
      .select({ channelId: contentPosts.channelId, dueAt: contentPosts.dueAt })
      .from(contentPosts)
      .where(and(eq(contentPosts.userId, userId), eq(contentPosts.clientId, client.id), inArray(contentPosts.status, ['pending_approval', 'approved', 'scheduled', 'sent'])));
    const slots = slotsFor(channels, dates, timezone, now).filter(
      (s) => !taken.some((t) => t.channelId === s.channel.id && t.dueAt?.getTime() === s.dueAt.getTime()),
    );
    const week = await weekFor(db, userId, client, now);
    // Nothing planned and nothing happened: no call.
    if (slots.length === 0 && week.length === 0) continue;

    const recent = await db
      .select({ text: contentPosts.text })
      .from(contentPosts)
      .where(and(eq(contentPosts.userId, userId), eq(contentPosts.clientId, client.id), gte(contentPosts.createdAt, new Date(now.getTime() - RECENT_POSTS_MS)), or(eq(contentPosts.status, 'scheduled'), eq(contentPosts.status, 'sent'))))
      .orderBy(desc(contentPosts.createdAt))
      .limit(6);
    const system = fillPrompt(loadPrompt('posts-plannen'), {
      klant: client.name,
      naam: profile?.name ?? 'de gebruiker',
      profiel: client.profile.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(niets ingevuld)',
      week: week.map((l) => `- ${l}`).join('\n') || '(niets bijzonders)',
      eerder: recent.map((p) => `- ${p.text.slice(0, 200).replace(/\n/g, ' ')}`).join('\n') || '(geen)',
      momenten: slots.map((s, i) => `${i + 1}. ${serviceLabel(s.channel.service)} (${s.channel.name}), ${describeSlot(timezone, s.dueAt)}`).join('\n') || '(geen: alleen een extra post als er iets te delen valt)',
    });
    const channelList = channels.map((c, i) => `${i + 1}. ${serviceLabel(c.service)} (${c.name})`).join('\n');
    const result = await ctx.claude.callWithTools({
      userId,
      purpose: 'content_plan',
      tier: 'smart',
      system,
      messages: [{ role: 'user', content: `Kanalen voor een extra post:\n${channelList}\n\nSchrijf de posts.` }],
      tools: [PLAN_TOOL],
      forceTool: 'plan_posts',
      maxTokens: 6000,
    });
    const parsed = planInput.safeParse(result.toolCalls[0]?.input);
    if (!parsed.success) {
      console.error(`Content plan for client ${client.id} was not usable:`, parsed.error.message);
      continue;
    }

    const values: Array<typeof contentPosts.$inferInsert> = [];
    for (const post of parsed.data.posts) {
      const slot = slots[post.moment - 1];
      if (!slot || values.some((v) => v.channelId === slot.channel.id && v.dueAt?.getTime() === slot.dueAt.getTime())) continue;
      values.push({ userId, clientId: client.id, channelId: slot.channel.id, text: post.text.trim(), dueAt: slot.dueAt, status: 'pending_approval' });
    }
    const extra = parsed.data.extra;
    const extraChannel = extra ? channels[extra.channel - 1] : undefined;
    if (extra && extraChannel && dates[0]) {
      // The extra post goes out tomorrow at the channel's own time.
      const at = localTimeOnDate(timezone, dates[0], extraChannel.postTime);
      const dueAt = values.some((v) => v.channelId === extraChannel.id && v.dueAt?.getTime() === at.getTime()) ? new Date(at.getTime() + 3 * 3_600_000) : at;
      values.push({ userId, clientId: client.id, channelId: extraChannel.id, text: extra.text.trim(), dueAt, reason: CONTENT_TEXTS.extraReason(extra.reason.trim()), status: 'pending_approval' });
    }
    if (values.length === 0) continue;
    const inserted = await db.insert(contentPosts).values(values).returning({ id: contentPosts.id, dueAt: contentPosts.dueAt });
    await scheduleReminders(db, userId, inserted, now);
    created.push(...inserted.map((r) => r.id));
  }
  return created;
}

/** The bundle: a header with "Alles goed", then one approval message per post. */
export async function bundleMessages(ctx: { db: Database; userId: number; timezone: string; now: Date }, postIds: number[]): Promise<OutboundMessage[]> {
  const posts = await ctx.db
    .select({ id: contentPosts.id, clientId: contentPosts.clientId })
    .from(contentPosts)
    .where(and(eq(contentPosts.userId, ctx.userId), inArray(contentPosts.id, postIds)))
    .orderBy(contentPosts.dueAt);
  const clientCount = new Set(posts.map((p) => p.clientId)).size;
  const header: OutboundMessage = {
    text: CONTENT_TEXTS.bundleHeader(posts.length, clientCount),
    buttons: [{ id: 'cpb:all', title: CONTENT_TEXTS.allOk }],
  };
  const approvals = await Promise.all(posts.map((p) => approvalMessage(ctx, p.id)));
  return [header, ...approvals];
}

/** Posts still waiting when their moment comes are skipped: nothing goes live without approval. */
export async function expireWaitingPosts(db: Database, now: Date): Promise<number> {
  const rows = await db
    .update(contentPosts)
    .set({ status: 'skipped', error: 'Niet op tijd goedgekeurd' })
    .where(and(eq(contentPosts.status, 'pending_approval'), isNotNull(contentPosts.dueAt), lte(contentPosts.dueAt, now)))
    .returning({ id: contentPosts.id });
  return rows.length;
}
