import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { id, timestamps, userId } from './common.js';
import { clientStatus, ideaStatus, projectStatus, taskSource, taskStatus } from './enums.js';

export interface Competitor {
  name: string;
  url?: string;
}

/** The business the improvement engine works on. */
export const businesses = pgTable(
  'businesses',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    website: text('website'),
    sector: text('sector'),
    description: text('description'),
    audience: text('audience'),
    offer: text('offer'),
    pricingNote: text('pricing_note'),
    competitors: jsonb('competitors').$type<Competitor[]>().notNull().default([]),
    goals: text('goals'),
    isFocus: boolean('is_focus').notNull().default(false),
    profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
    lastResearchedAt: timestamp('last_researched_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('businesses_user_idx').on(table.userId),
    // At most one focus business per user.
    uniqueIndex('businesses_one_focus_per_user')
      .on(table.userId)
      .where(sql`${table.isFocus}`),
  ],
);

/** Clients the user serves. */
export const clients = pgTable(
  'clients',
  {
    id: id(),
    userId: userId(),
    businessId: integer('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    notes: text('notes'),
    status: clientStatus('status').notNull().default('active'),
    ...timestamps,
  },
  (table) => [index('clients_user_idx').on(table.userId)],
);

export const LOOSE_TASKS_PROJECT_TITLE = 'Losse taken';

export const projects = pgTable(
  'projects',
  {
    id: id(),
    userId: userId(),
    businessId: integer('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    clientId: integer('client_id').references(() => clients.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    goal: text('goal'),
    status: projectStatus('status').notNull().default('active'),
    deadline: date('deadline'),
    priority: smallint('priority').notNull().default(2),
    isWeeklyFocus: boolean('is_weekly_focus').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index('projects_user_idx').on(table.userId),
    check('projects_priority_range', sql`${table.priority} BETWEEN 1 AND 3`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    userId: userId(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentTaskId: integer('parent_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    notes: text('notes'),
    status: taskStatus('status').notNull().default('open'),
    estimatedMinutes: smallint('estimated_minutes'),
    dueDate: date('due_date'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    carryOver: boolean('carry_over').notNull().default(false),
    source: taskSource('source').notNull(),
    stuckSince: timestamp('stuck_since', { withTimezone: true }),
    lastEscalationLevel: smallint('last_escalation_level').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('tasks_user_status_idx').on(table.userId, table.status),
    index('tasks_project_idx').on(table.projectId),
    index('tasks_parent_idx').on(table.parentTaskId),
    check(
      'tasks_estimated_minutes_values',
      sql`${table.estimatedMinutes} IS NULL OR ${table.estimatedMinutes} IN (5, 15, 30, 60, 120)`,
    ),
    check('tasks_escalation_level_range', sql`${table.lastEscalationLevel} BETWEEN 0 AND 3`),
  ],
);

/** The idea inbox. Ideas never enter the daily focus directly. */
export const ideas = pgTable(
  'ideas',
  {
    id: id(),
    userId: userId(),
    businessId: integer('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    source: taskSource('source').notNull(),
    status: ideaStatus('status').notNull().default('inbox'),
    promotedToProjectId: integer('promoted_to_project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('ideas_user_status_idx').on(table.userId, table.status)],
);

export const dailyFocus = pgTable(
  'daily_focus',
  {
    id: id(),
    userId: userId(),
    /** Date in the user's own timezone. */
    localDate: date('local_date').notNull(),
    /** Ordered task ids, at most three. */
    taskIds: integer('task_ids').array().notNull().default(sql`ARRAY[]::integer[]`),
    quickWinTaskId: integer('quick_win_task_id').references(() => tasks.id, {
      onDelete: 'set null',
    }),
    wrapupDoneAt: timestamp('wrapup_done_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('daily_focus_user_date').on(table.userId, table.localDate),
    check('daily_focus_max_three', sql`cardinality(${table.taskIds}) <= 3`),
  ],
);
