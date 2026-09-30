import { integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** All timestamps are stored in UTC (timestamptz). */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();

/** Every table except `users` belongs to one user; deleting the user deletes their data. */
export const userId = () =>
  integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
