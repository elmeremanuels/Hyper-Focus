// Checks a proactive message before it goes out (BOUWPLAN.md, 11.6). Step 1.3 covers the
// pause; step 1.5 adds the daily limit, quiet hours, breathing room and withdrawal.
import type { UserSettingsRow } from '../core/settings.js';

export interface GuardrailInput {
  kind: string;
  now: Date;
  settings: Pick<UserSettingsRow, 'pausedUntil'>;
}

export type GuardrailVerdict = { send: true } | { send: false; reason: string };

/** The user started these themselves, so they go out regardless of pause and limits. */
export const USER_STARTED_KINDS = new Set(['session_checkin']);

export function checkGuardrails(input: GuardrailInput): GuardrailVerdict {
  if (USER_STARTED_KINDS.has(input.kind)) return { send: true };
  if (input.settings.pausedUntil && input.settings.pausedUntil > input.now) {
    return { send: false, reason: 'paused' };
  }
  return { send: true };
}
