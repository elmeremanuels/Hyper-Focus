// Checks a proactive message before it goes out (BOUWPLAN.md, 11.6). Step 1.3 covers the
// pause; step 1.5 adds the daily limit, quiet hours, breathing room and withdrawal.
import type { UserSettingsRow } from '../core/settings.js';

export interface GuardrailInput {
  kind: string;
  now: Date;
  settings: Pick<UserSettingsRow, 'pausedUntil'>;
}

export type GuardrailVerdict = { send: true } | { send: false; reason: string };

export function checkGuardrails(input: GuardrailInput): GuardrailVerdict {
  if (input.settings.pausedUntil && input.settings.pausedUntil > input.now) {
    return { send: false, reason: 'paused' };
  }
  return { send: true };
}
