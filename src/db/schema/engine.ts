import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { id, timestamps, userId } from './common.js';
import { lens, researchKind, suggestionStatus } from './enums.js';
import { businesses } from './work.js';

export interface SuggestionAsset {
  type: 'tekst' | 'mail' | 'post' | 'checklist';
  content: string;
}

export const suggestions = pgTable(
  'suggestions',
  {
    id: id(),
    userId: userId(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    lens: lens('lens').notNull(),
    subLens: text('sub_lens'),
    title: text('title').notNull(),
    why: text('why').notNull(),
    action: text('action').notNull(),
    estimatedMinutes: smallint('estimated_minutes'),
    asset: jsonb('asset').$type<SuggestionAsset>(),
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    status: suggestionStatus('status').notNull().default('new'),
    statusReason: text('status_reason'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    followupDueAt: timestamp('followup_due_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    buildsOnSuggestionId: integer('builds_on_suggestion_id').references(
      (): AnyPgColumn => suggestions.id,
      { onDelete: 'set null' },
    ),
    dedupeKey: text('dedupe_key'),
    ...timestamps,
  },
  (table) => [
    index('suggestions_user_status_idx').on(table.userId, table.status),
    index('suggestions_business_idx').on(table.businessId),
  ],
);

export const researchCache = pgTable(
  'research_cache',
  {
    id: id(),
    userId: userId(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: researchKind('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    ...timestamps,
  },
  (table) => [index('research_cache_business_kind_idx').on(table.businessId, table.kind)],
);
