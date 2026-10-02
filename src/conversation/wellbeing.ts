// Crisis signals (BOUWPLAN.md, 11.6 and 14): stop all productivity messages, answer with
// care, refer to 113 and the GP, and flag the conversation for manual follow-up.
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent } from '../core/events.js';
import type { Database } from '../db/client.js';
import { scheduledNudges, users } from '../db/schema/index.js';
import { defineTool } from './tools.js';
import type { OutboundMessage } from './types.js';

export const CRISIS_REPLY: OutboundMessage = {
  text:
    'Wat fijn dat je het zegt, en wat zwaar dat je je zo voelt. Ik zet alle taken en berichten stil. ' +
    'Praat erover met iemand: bel 113 of gratis 0800-0113, of chat via 113.nl. Je huisarts kan ook helpen. ' +
    'Ben je in direct gevaar, bel dan 112.',
};

// A safety net that works without Claude. Claude's crisis tool catches subtler messages.
const CRISIS_PATTERNS = [
  /\bzelfmoord\b/i,
  /\bsuïcid/i,
  /\bsuicid/i,
  /\bniet meer (willen |wil )?(leven|bestaan)\b/i,
  /\bwil (\w+ )?er (\w+ ){0,2}niet meer (\w+ )?zijn\b/i,
  /\bmezelf (iets )?(aan ?doen|pijn doen|van kant maken)\b/i,
  /\bdood (willen|wil) zijn\b/i,
  /\bwil dood\b/i,
  /\bkill myself\b/i,
];

export function looksLikeCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((pattern) => pattern.test(text));
}

/** Pauses the user (users.status = paused), cancels pending messages and flags the event. */
export async function flagCrisis(
  db: Database,
  userId: number,
  source: 'pattern' | 'claude',
  log: Pick<Console, 'warn'> = console,
): Promise<void> {
  await db.update(users).set({ status: 'paused' }).where(eq(users.id, userId));
  await db
    .update(scheduledNudges)
    .set({ status: 'skipped', skipReason: 'crisis' })
    .where(and(eq(scheduledNudges.userId, userId), eq(scheduledNudges.status, 'pending'), ne(scheduledNudges.kind, 'session_checkin')));
  await recordEvent(db, userId, 'crisis_flagged', { source });
  log.warn(`CRISIS flagged for user ${userId}: proactive messages stopped, manual follow-up needed`);
}

export const crisisTool = defineTool({
  name: 'crisis',
  description:
    'Gebruik bij signalen van wanhoop of zelfbeschadiging ("ik zie het niet meer zitten", "wil er niet meer zijn"). ' +
    'Zet alle taken en berichten stil en verwijst naar hulp. Roep daarna geen andere tool aan.',
  input: z.object({}),
  async run(_input, ctx) {
    await flagCrisis(ctx.db, ctx.userId, 'claude');
    return { content: 'Stilgezet en gemarkeerd.', exclusive: true, reply: CRISIS_REPLY };
  },
});
