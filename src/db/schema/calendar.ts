import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { id, timestamps, userId } from './common.js';
import { calendarConnectionStatus, calendarProvider } from './enums.js';
import { clients, projects } from './work.js';

/** Optional (step 1.8). Tokens are encrypted with src/lib/crypto.ts. */
export const calendarConnections = pgTable(
  'calendar_connections',
  {
    id: id(),
    userId: userId(),
    provider: calendarProvider('provider').notNull().default('google'),
    calendarIds: text('calendar_ids').array().notNull().default(sql`ARRAY['primary']::text[]`),
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    syncToken: text('sync_token'),
    status: calendarConnectionStatus('status').notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('calendar_connections_user_provider').on(table.userId, table.provider)],
);

/** Only today and tomorrow, and only these fields (BOUWPLAN.md, 14). */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: id(),
    userId: userId(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    startsAtUtc: timestamp('starts_at_utc', { withTimezone: true }).notNull(),
    endsAtUtc: timestamp('ends_at_utc', { withTimezone: true }).notNull(),
    title: text('title').notNull(),
    isBusy: boolean('is_busy').notNull().default(true),
    isAllDay: boolean('is_all_day').notNull().default(false),
    clientId: integer('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('calendar_events_connection_external').on(table.connectionId, table.externalId),
    index('calendar_events_user_start_idx').on(table.userId, table.startsAtUtc),
  ],
);
