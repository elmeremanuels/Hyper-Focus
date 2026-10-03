import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { id, timestamps, userId } from './common.js';

// Metadata only, no message content. Kept for 12 months (BOUWPLAN.md, 14).
// Telegram costs nothing per message; sent mails are counted through the email_sent event.

export const EVENT_NAMES = [
  'inbound_message',
  'email_sent',
  'task_created',
  'task_status_changed',
  'focus_item_done',
  'suggestion_delivered',
  'suggestion_status_changed',
  'session_started',
  'session_completed',
  'reentry',
  'escalation',
  'crisis_flagged',
  'weekly_review_done',
  'tool_button_shown',
  'tool_prompt',
  'block_started',
  'block_completed',
  'pause_returned',
  'rewards_toggled',
  'day_review_done',
  'day_energy_set',
  'overwhelm',
  'nudge_skipped',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export const events = pgTable(
  'events',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    props: jsonb('props').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [index('events_user_name_created_idx').on(table.userId, table.name, table.createdAt)],
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    userId: userId(),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    ...timestamps,
  },
  (table) => [index('ai_usage_user_created_idx').on(table.userId, table.createdAt)],
);
