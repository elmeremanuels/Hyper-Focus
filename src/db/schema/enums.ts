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
  // Work blocks (step 1.9)
  'block_end',
  'return_reminder',
  'pause_close',
  'hyperfocus_break',
  // Focus window (step 1.12)
  'window_heads_up',
  'window_quiet_check',
  'soft_landing',
  'window_missed',
  // A second morning message, 10 minutes later: never two in one minute (verbeterplan P0.1)
  'morning_followup',
  // A message the AI could not read yet, tried again (verbeterplan P0.2)
  'ai_retry',
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
export const calendarProvider = pgEnum('calendar_provider', ['google', 'microsoft', 'apple', 'ics']);
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
  'post_edit',
]);

/** Kinds of work a workplace link can open (step 1.10). */
export const workType = pgEnum('work_type', ['invoicing', 'email', 'calendar', 'content', 'website', 'docs']);

/** How a work block ended (step 1.9). */
export const focusBlockOutcome = pgEnum('focus_block_outcome', ['completed', 'extended', 'stopped', 'expired']);

/** Energy at the end of the day (step 1.11). */
export const dayEnergy = pgEnum('day_energy', ['low', 'normal', 'high']);

/** When someone works best (step 1.12). */
export const focusPref = pgEnum('focus_pref', ['morning', 'afternoon', 'evening', 'unknown']);
export const focusWindowSource = pgEnum('focus_window_source', ['pref', 'learned', 'manual']);
export const focusWindowStatus = pgEnum('focus_window_status', ['planned', 'used', 'missed', 'moved']);
export const loginChannel = pgEnum('login_channel', ['email', 'telegram']);

/** Content module (step C1): a social post from idea to Buffer. */
export const contentPostStatus = pgEnum('content_post_status', [
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'sent',
  'failed',
  'skipped',
]);
/** Where a post's image comes from (step C3). */
export const contentMediaSource = pgEnum('content_media_source', ['drive', 'meme', 'generated', 'none']);
