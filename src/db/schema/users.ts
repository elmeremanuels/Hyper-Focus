import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { engineFrequency, preferredChannel, userStatus } from './enums.js';

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  email: text('email').unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // Telegram ids fit in 52 bits, so number mode is safe.
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }).unique(),
  telegramChatId: bigint('telegram_chat_id', { mode: 'number' }),
  telegramLinkedAt: timestamp('telegram_linked_at', { withTimezone: true }),
  preferredChannel: preferredChannel('preferred_channel').notNull().default('telegram'),
  timezone: text('timezone').notNull().default('Europe/Amsterdam'),
  locale: text('locale').notNull().default('nl-NL'),
  status: userStatus('status').notNull().default('active'),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  /** Leaves in the garden (step 1.9). Only grows. */
  gardenGrowth: integer('garden_growth').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Times are local wall-clock times in the user's timezone.
export const userSettings = pgTable(
  'user_settings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    morningTime: time('morning_time').notNull().default('08:30'),
    middayEnabled: boolean('midday_enabled').notNull().default(true),
    wrapupTime: time('wrapup_time').notNull().default('16:00'),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weeklyReviewDay: smallint('weekly_review_day').notNull().default(7),
    weeklyReviewTime: time('weekly_review_time').notNull().default('19:30'),
    quietStart: time('quiet_start').notNull().default('21:00'),
    quietEnd: time('quiet_end').notNull().default('08:00'),
    maxProactivePerDay: smallint('max_proactive_per_day').notNull().default(4),
    sessionMinutes: smallint('session_minutes').notNull().default(25),
    engineFrequency: engineFrequency('engine_frequency').notNull().default('every_other_day'),
    engineTime: time('engine_time').notNull().default('10:30'),
    enabledLenses: text('enabled_lenses')
      .array()
      .notNull()
      .default(sql`ARRAY['audience','competitor','funnel','destep']::text[]`),
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    calendarEnabled: boolean('calendar_enabled').notNull().default(false),
    meetingHeadsUp: boolean('meeting_heads_up').notNull().default(true),
    meetingFollowup: boolean('meeting_followup').notNull().default(true),
    maxCalendarNudgesPerDay: smallint('max_calendar_nudges_per_day').notNull().default(2),
    /** Reward minute and garden (step 1.9); blocks and pauses work either way. */
    rewardsEnabled: boolean('rewards_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('user_settings_weekly_review_day', sql`${table.weeklyReviewDay} BETWEEN 1 AND 7`)],
);
