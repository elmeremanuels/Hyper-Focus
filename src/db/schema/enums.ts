import { pgEnum } from 'drizzle-orm/pg-core';

// Enum values are English; Dutch labels live in src/db/labels.ts (BOUWPLAN.md, 8).

export const taskStatus = pgEnum('task_status', ['open', 'in_progress', 'parked', 'done', 'released']);

export const suggestionStatus = pgEnum('suggestion_status', [
  'new',
  'in_progress',
  'done',
  'parked',
  'skipped',
  'not_relevant',
]);

export const nudgeKind = pgEnum('nudge_kind', [
  'morning',
  'midday',
  'wrapup',
  'engine',
  'followup',
  'session_checkin',
  'escalation',
  'weekly_review',
  'reentry',
  'meeting_heads_up',
  'meeting_followup',
]);

// Phase 2 lenses. Later lenses (swot, offer_pricing, retention, visibility, time_saving)
// are added with their own migration.
export const lens = pgEnum('lens', ['destep', 'audience', 'competitor', 'funnel']);

export const userStatus = pgEnum('user_status', ['active', 'paused']);
export const clientStatus = pgEnum('client_status', ['active', 'paused', 'ended']);
export const projectStatus = pgEnum('project_status', ['active', 'parked', 'done']);
export const taskSource = pgEnum('task_source', ['telegram', 'voice', 'email', 'engine', 'web', 'seed']);
export const ideaStatus = pgEnum('idea_status', ['inbox', 'promoted', 'archived']);
export const engineFrequency = pgEnum('engine_frequency', ['every_other_day', 'daily', 'twice_weekly']);
export const researchKind = pgEnum('research_kind', ['website', 'competitor', 'news', 'web']);
export const messageDirection = pgEnum('message_direction', ['in', 'out']);
export const messageChannel = pgEnum('message_channel', ['telegram', 'email', 'web']);
export const messageType = pgEnum('message_type', ['text', 'button', 'audio', 'email', 'action_link']);
export const deliveryStatus = pgEnum('delivery_status', ['sent', 'failed']);
export const preferredChannel = pgEnum('preferred_channel', ['telegram', 'email']);
export const nudgeStatus = pgEnum('nudge_status', ['pending', 'sent', 'skipped', 'failed']);
export const calendarProvider = pgEnum('calendar_provider', ['google']);
export const calendarConnectionStatus = pgEnum('calendar_connection_status', [
  'active',
  'error',
  'revoked',
]);
export const conversationMode = pgEnum('conversation_mode', [
  'idle',
  'session',
  'wrapup',
  'weekly_review',
  'intake',
  'onboarding',
]);
