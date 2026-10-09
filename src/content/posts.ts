// Content module (step C1): a post waits for approval in Telegram, then goes to Buffer.
// Nothing goes live without "Goed".
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { fillPrompt, loadPrompt } from '../ai/prompts.js';
import type { ClaudeClient } from '../ai/claude.js';
import { getProfile } from '../core/profile.js';
import { getSettings } from '../core/settings.js';
import type { Database } from '../db/client.js';
import { clientChannels, clients, contentPosts, scheduledNudges } from '../db/schema/index.js';
import { BufferClient, BufferError, type BufferApi } from '../integrations/buffer/client.js';
import { decryptToken } from '../lib/crypto.js';
import { localNow, localTimeOnDate } from '../lib/time.js';
import { CONTENT_TEXTS, POST_STATUS_LABELS } from '../texts/content.nl.js';
import type { OutboundMessage } from '../conversation/types.js';
import type { MediaConfig } from './media.js';

export interface ContentDeps {
  /** ENCRYPTION_KEY: Buffer keys are stored encrypted per client. */
  encryptionKey?: string | undefined;
  /** Builds the API client for one key; tests pass a fake. */
  buffer?: (apiKey: string) => BufferApi;
  /** Photos and memes (step C3). */
  media?: MediaConfig | undefined;
}

export interface ContentContext {
  db: Database;
  userId: number;
  timezone: string;
  now: Date;
  claude?: Pick<ClaudeClient, 'callWithTools'> | undefined;
  content?: ContentDeps | undefined;
}

export const MAX_CHANNELS = 3;
/** A slot this close or closer is too soon: the user needs a moment to approve. */
export const LEAD_MINUTES = 15;
/** How long "Aanpassen" waits for the next message. */
export const EDIT_MINUTES = 60;
/** The reminder before a post that still waits for approval (step C2). */
export const REMINDER_MINUTES = 60;
/** Approved this close to its moment, a post goes out a little later instead. */
const LAST_MINUTE_MS = 5 * 60_000;

/** One reminder an hour before each post, while it still waits for approval. */
export async function scheduleReminders(db: Database, userId: number, posts: Array<{ id: number; dueAt: Date | null }>, now: Date) {
  const reminders = posts
    .filter((p): p is { id: number; dueAt: Date } => p.dueAt !== null && p.dueAt.getTime() - REMINDER_MINUTES * 60_000 > now.getTime())
    .map((p) => ({ userId, kind: 'content_reminder' as const, scheduledForUtc: new Date(p.dueAt.getTime() - REMINDER_MINUTES * 60_000), payload: { postId: p.id } }));
  if (reminders.length) await db.insert(scheduledNudges).values(reminders);
}


/** The next moment from the rhythm (ISO weekdays and a local time), or null for Buffer's queue. */
export function nextSlot(days: number[], postTime: string, timezone: string, now: Date, leadMinutes = LEAD_MINUTES): Date | null {
  if (days.length === 0) return null;
  const earliest = now.getTime() + leadMinutes * 60_000;
  const today = localNow(timezone, now).startOf('day');
  for (let offset = 0; offset < 15; offset++) {
    const day = today.plus({ days: offset });
    if (!days.includes(day.weekday)) continue;
    const slot = localTimeOnDate(timezone, day.toISODate() ?? '', postTime);
    if (slot.getTime() >= earliest) return slot;
  }
  return null;
}

/** "dinsdag 13 okt 10:00" in the user's time zone. */
export function describeSlot(timezone: string, at: Date): string {
  return localNow(timezone, at).setLocale('nl').toFormat('cccc d LLL HH:mm');
}

export async function contentEnabled(db: Database, userId: number): Promise<boolean> {
  return (await getSettings(db, userId)).contentEnabled;
}

/** The Buffer client for one client, or undefined when no key is stored or it cannot be read. */
export function bufferForKey(deps: ContentDeps | undefined, encrypted: string | null): BufferApi | undefined {
  if (!deps?.encryptionKey || !encrypted) return undefined;
  const key = decryptToken(encrypted, deps.encryptionKey);
  return (deps.buffer ?? ((k) => new BufferClient(k)))(key);
}

const postButtons = (id: number, retry = false) => [
  { id: `cp:${id}:ok`, title: retry ? CONTENT_TEXTS.retry : CONTENT_TEXTS.ok },
  { id: `cp:${id}:edit`, title: CONTENT_TEXTS.edit },
  { id: `cp:${id}:skip`, title: CONTENT_TEXTS.skip },
];

async function loadPost(db: Database, userId: number, postId: number) {
  const [row] = await db
    .select({ post: contentPosts, channel: clientChannels, client: { id: clients.id, name: clients.name, key: clients.bufferApiKeyEnc, profile: clients.profile } })
    .from(contentPosts)
    .innerJoin(clientChannels, eq(clientChannels.id, contentPosts.channelId))
    .innerJoin(clients, eq(clients.id, contentPosts.clientId))
    .where(and(eq(contentPosts.userId, userId), eq(contentPosts.id, postId)));
  return row;
}

/** The approval message: who, where, when, the text, and the three buttons. */
export async function approvalMessage(ctx: ContentContext, postId: number): Promise<OutboundMessage> {
  const row = await loadPost(ctx.db, ctx.userId, postId);
  if (!row) return { text: CONTENT_TEXTS.notFound };
  const { post, channel, client } = row;
  const due = post.dueAt ?? nextSlot(channel.days, channel.postTime, ctx.timezone, ctx.now);
  const lines = [
    CONTENT_TEXTS.header(client.name, channel.name, channel.service),
    due ? CONTENT_TEXTS.when(describeSlot(ctx.timezone, due)) : CONTENT_TEXTS.queue,
    ...(post.reason ? [post.reason] : []),
    ...(post.mediaUrl ? [CONTENT_TEXTS.image(post.mediaUrl)] : []),
    '',
    post.text,
  ];
  return { text: lines.join('\n'), buttons: postButtons(post.id, post.status === 'failed') };
}

/** New posts for a client, one per channel (or only the given one), each waiting for approval. */
export async function draftPosts(
  ctx: ContentContext,
  input: { clientId: number; text: string; channelIds?: number[] | undefined; reason?: string | null | undefined },
): Promise<number[]> {
  const channels = await ctx.db
    .select()
    .from(clientChannels)
    .where(and(eq(clientChannels.userId, ctx.userId), eq(clientChannels.clientId, input.clientId)))
    .orderBy(asc(clientChannels.id));
  const chosen = input.channelIds ? channels.filter((c) => input.channelIds?.includes(c.id)) : channels;
  if (chosen.length === 0) return [];
  const rows = await ctx.db
    .insert(contentPosts)
    .values(
      chosen.map((channel) => ({
        userId: ctx.userId,
        clientId: input.clientId,
        channelId: channel.id,
        text: input.text,
        reason: input.reason ?? null,
        dueAt: nextSlot(channel.days, channel.postTime, ctx.timezone, ctx.now),
        status: 'pending_approval' as const,
      })),
    )
    .returning({ id: contentPosts.id, dueAt: contentPosts.dueAt });
  await scheduleReminders(ctx.db, ctx.userId, rows, ctx.now);
  return rows.map((r) => r.id);
}

/** "Goed": to Buffer at the planned slot (moved on when it has passed). Also "Opnieuw" after a failure. */
export async function approvePost(ctx: ContentContext, postId: number): Promise<OutboundMessage> {
  const row = await loadPost(ctx.db, ctx.userId, postId);
  if (!row) return { text: CONTENT_TEXTS.notFound };
  const { post, channel, client } = row;
  if (post.status !== 'pending_approval' && post.status !== 'failed') return { text: CONTENT_TEXTS.already(POST_STATUS_LABELS[post.status]) };
  const buffer = bufferForKey(ctx.content, client.key);
  if (!buffer) return { text: CONTENT_TEXTS.noBuffer(client.name) };

  const where = and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.id, post.id));
  // The moment has passed: skipped, never posted late (step C2).
  if (post.dueAt && post.dueAt.getTime() <= ctx.now.getTime()) {
    await ctx.db.update(contentPosts).set({ status: 'skipped', error: 'Niet op tijd goedgekeurd' }).where(where);
    return { text: CONTENT_TEXTS.tooLate };
  }
  const soon = post.dueAt && post.dueAt.getTime() < ctx.now.getTime() + LAST_MINUTE_MS;
  const dueAt = soon ? new Date(ctx.now.getTime() + LAST_MINUTE_MS) : post.dueAt;
  await ctx.db.update(contentPosts).set({ status: 'approved', approvedAt: ctx.now, dueAt, error: null }).where(where);
  try {
    const created = await buffer.createPost({ channelId: channel.bufferChannelId, service: channel.service, text: post.text, dueAt, imageUrl: post.mediaUrl });
    const planned = created.dueAt ? new Date(created.dueAt) : dueAt;
    await ctx.db.update(contentPosts).set({ status: 'scheduled', bufferPostId: created.id, dueAt: planned }).where(where);
    return { text: planned ? CONTENT_TEXTS.scheduled(describeSlot(ctx.timezone, planned), channel.name) : CONTENT_TEXTS.scheduledQueue(channel.name) };
  } catch (error) {
    const message = error instanceof BufferError ? error.message : 'Buffer is nu niet bereikbaar';
    if (!(error instanceof BufferError)) console.error(`Buffer post ${post.id} failed:`, error);
    await ctx.db.update(contentPosts).set({ status: 'failed', error: message.slice(0, 500) }).where(where);
    return { text: CONTENT_TEXTS.failed(message), buttons: [{ id: `cp:${post.id}:ok`, title: CONTENT_TEXTS.retry }] };
  }
}

export async function skipPost(ctx: ContentContext, postId: number): Promise<OutboundMessage> {
  const row = await loadPost(ctx.db, ctx.userId, postId);
  if (!row) return { text: CONTENT_TEXTS.notFound };
  if (row.post.status !== 'pending_approval' && row.post.status !== 'failed') return { text: CONTENT_TEXTS.already(POST_STATUS_LABELS[row.post.status]) };
  await ctx.db.update(contentPosts).set({ status: 'skipped' }).where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.id, postId)));
  return { text: CONTENT_TEXTS.skipped };
}

/** Whether "Aanpassen" may start: only while the post still waits. */
export async function editablePost(ctx: ContentContext, postId: number): Promise<OutboundMessage | undefined> {
  const row = await loadPost(ctx.db, ctx.userId, postId);
  if (!row) return { text: CONTENT_TEXTS.notFound };
  if (row.post.status !== 'pending_approval' && row.post.status !== 'failed') return { text: CONTENT_TEXTS.already(POST_STATUS_LABELS[row.post.status]) };
  return undefined;
}

const rewriteInput = z.object({ text: z.string().min(1).max(3000) });
const REWRITE_TOOL = {
  name: 'rewrite_post',
  description: 'De herschreven post.',
  input_schema: { type: 'object' as const, properties: { text: { type: 'string' } }, required: ['text'] },
};

/**
 * The answer to "Aanpassen": Claude rewrites the post with the wish. Without Claude, or when it
 * fails, the message itself becomes the new text only if it is clearly a full post.
 */
export async function applyEdit(ctx: ContentContext, postId: number, wish: string): Promise<OutboundMessage> {
  const row = await loadPost(ctx.db, ctx.userId, postId);
  if (!row) return { text: CONTENT_TEXTS.notFound };
  const { post, channel, client } = row;
  let text: string | undefined;
  if (ctx.claude) {
    try {
      const profile = await getProfile(ctx.db, ctx.userId);
      const fields = client.profile.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(niets ingevuld)';
      const result = await ctx.claude.callWithTools({
        userId: ctx.userId,
        purpose: 'post_rewrite',
        tier: 'fast',
        system: fillPrompt(loadPrompt('post-herschrijven'), { klant: client.name, kanaal: channel.service, profiel: fields, naam: profile?.name ?? 'de gebruiker' }),
        messages: [{ role: 'user', content: `Huidige post:\n${post.text}\n\nWens:\n${wish}` }],
        tools: [REWRITE_TOOL],
        forceTool: 'rewrite_post',
        maxTokens: 2048,
      });
      const parsed = rewriteInput.safeParse(result.toolCalls[0]?.input);
      if (parsed.success) text = parsed.data.text.trim();
    } catch (error) {
      console.error('Post rewrite failed:', error);
    }
  } else if (wish.trim().length >= Math.min(80, post.text.length / 2)) {
    text = wish.trim();
  }
  if (!text) return { text: CONTENT_TEXTS.editFailed, buttons: postButtons(post.id) };
  await ctx.db
    .update(contentPosts)
    .set({ text, status: 'pending_approval', error: null })
    .where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.id, post.id)));
  return approvalMessage(ctx, post.id);
}

/** "Alles goed": every post that waits for approval and still has its moment ahead. */
export async function approveAll(ctx: ContentContext): Promise<OutboundMessage[]> {
  const waiting = await ctx.db
    .select({ id: contentPosts.id })
    .from(contentPosts)
    .where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.status, 'pending_approval')))
    .orderBy(asc(contentPosts.dueAt));
  if (waiting.length === 0) return [{ text: CONTENT_TEXTS.allNone }];
  const failures: OutboundMessage[] = [];
  let scheduled = 0;
  for (const { id } of waiting) {
    const reply = await approvePost(ctx, id);
    const [row] = await ctx.db.select({ status: contentPosts.status }).from(contentPosts).where(eq(contentPosts.id, id));
    // Failures, a missing Buffer key or a passed moment: shown one by one.
    if (row?.status === 'scheduled') scheduled++;
    else failures.push(reply);
  }
  return [{ text: CONTENT_TEXTS.allDone(scheduled) }, ...failures];
}

/** The reminder an hour before: the approval message again, only while it still waits. */
export async function reminderMessage(ctx: ContentContext, postId: number): Promise<OutboundMessage | undefined> {
  const row = await loadPost(ctx.db, ctx.userId, postId);
  if (!row || row.post.status !== 'pending_approval') return undefined;
  const message = await approvalMessage(ctx, postId);
  return { ...message, text: `${CONTENT_TEXTS.reminder}\n\n${message.text}` };
}
