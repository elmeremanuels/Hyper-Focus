import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps, userId } from './common.js';
import {
  conversationMode,
  deliveryStatus,
  messageChannel,
  messageDirection,
  messageType,
  nudgeKind,
  nudgeStatus,
} from './enums.js';
import { suggestions } from './engine.js';
import { tasks } from './work.js';

export const scheduledNudges = pgTable(
  'scheduled_nudges',
  {
    id: id(),
    userId: userId(),
    kind: nudgeKind('kind').notNull(),
    scheduledForUtc: timestamp('scheduled_for_utc', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: nudgeStatus('status').notNull().default('pending'),
    skipReason: text('skip_reason'),
    /** Refers to messages.id; no foreign key because messages are deleted after 30 days. */
    sentMessageId: integer('sent_message_id'),
    ...timestamps,
  },
  (table) => [index('scheduled_nudges_due_idx').on(table.status, table.scheduledForUtc)],
);

/** Deleted after 30 days by a nightly job (BOUWPLAN.md, 14). */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    userId: userId(),
    direction: messageDirection('direction').notNull(),
    channel: messageChannel('channel').notNull(),
    /**
     * Telegram: update id or message id. Mail: Message-ID. Action link: token nonce.
     * Unique per channel for idempotency (BOUWPLAN.md, 9.2–9.3).
     */
    externalId: text('external_id'),
    type: messageType('type').notNull(),
    /** Mail only. */
    subject: text('subject'),
    body: text('body'),
    transcript: text('transcript'),
    intent: text('intent'),
    taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    suggestionId: integer('suggestion_id').references(() => suggestions.id, {
      onDelete: 'set null',
    }),
    nudgeId: integer('nudge_id').references(() => scheduledNudges.id, { onDelete: 'set null' }),
    /** Outbound only. */
    deliveryStatus: deliveryStatus('delivery_status'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('messages_channel_external_id').on(table.channel, table.externalId),
    index('messages_user_created_idx').on(table.userId, table.createdAt),
  ],
);

/** One row per user. */
export const conversationState = pgTable('conversation_state', {
  id: id(),
  userId: userId().unique(),
  mode: conversationMode('mode').notNull().default('idle'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...timestamps,
});
