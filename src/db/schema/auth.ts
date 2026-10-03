// Dashboard login (step 2a.1): one-time login links and browser sessions. Only hashes of the
// tokens are stored; the token itself lives in the link or in the cookie.
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps, userId } from './common.js';
import { loginChannel } from './enums.js';

export const loginTokens = pgTable(
  'login_tokens',
  {
    id: id(),
    userId: userId(),
    tokenHash: text('token_hash').notNull(),
    channel: loginChannel('channel').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('login_tokens_hash').on(table.tokenHash), index('login_tokens_user_created_idx').on(table.userId, table.createdAt)],
);

export const webSessions = pgTable(
  'web_sessions',
  {
    id: id(),
    userId: userId(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('web_sessions_hash').on(table.tokenHash)],
);
