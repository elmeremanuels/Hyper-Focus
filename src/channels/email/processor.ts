// Handles an inbound mail (BOUWPLAN.md, 9.3), idempotent on Message-ID, with reply
// extraction, forwarded mail as context and the answer by mail.
//
// Trust: the secret webhook path (EMAIL_INBOUND_SECRET) and EMAIL_ALLOWED_SENDERS.
// Brevo sends no SPF/DKIM results, so those count only when the headers are present:
// a reported failure rejects the mail. A spam score above the limit rejects it too.
import type { MessageStore } from '../../core/messages.js';
import type { UserStore } from '../../core/users.js';
import type { Router } from '../../conversation/router.js';
import type { OutboundMessage } from '../../conversation/types.js';
import { mask } from '../../lib/secrets.js';
import type { Delivery } from '../channel.js';
import { parseInboundMail, type InboundItem } from './inbound.js';
import { detectForward, extractReply } from './parse-reply.js';

export interface MailProcessorDeps {
  users: UserStore;
  messages: MessageStore;
  delivery: Delivery;
  router: Router;
  allowedSenders: readonly string[];
  /** Mail with a higher Brevo SpamScore is ignored. */
  maxSpamScore?: number;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export type MailOutcome = 'processed' | 'duplicate' | 'ignored';

export const DEFAULT_MAX_SPAM_SCORE = 5;

export const EMPTY_REPLY: OutboundMessage = {
  text: 'Ik zag geen nieuwe tekst in je mail. Schrijf je bericht boven de geciteerde tekst.',
};

export function createMailProcessor(deps: MailProcessorDeps) {
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  const allowed = new Set(deps.allowedSenders.map((address) => address.toLowerCase()));
  const maxSpamScore = deps.maxSpamScore ?? DEFAULT_MAX_SPAM_SCORE;
  let headerNamesLogged = false;

  return async function processMail(item: InboundItem): Promise<MailOutcome> {
    const mail = parseInboundMail(item);

    // Once per process: which headers does Brevo actually send? Names only, no values.
    if (!headerNamesLogged) {
      headerNamesLogged = true;
      log.info(
        `Brevo inbound header names: ${mail.headerNames.join(', ') || '(none)'}; ` +
          `SpamScore ${mail.spamScore === undefined ? 'absent' : 'present'}`,
      );
    }

    if (!mail.from) {
      log.warn('Ignored inbound mail without a sender address');
      return 'ignored';
    }

    const user = await deps.users.findByEmail(mail.from);
    const reason = !user
      ? 'unknown sender'
      : !allowed.has(mail.from)
        ? 'sender not allowed'
        : mail.spf === 'fail'
          ? 'SPF fail'
          : mail.dkim === 'fail'
            ? 'DKIM fail'
            : mail.spamScore !== undefined && mail.spamScore > maxSpamScore
              ? `spam score ${mail.spamScore} above ${maxSpamScore}`
              : undefined;
    if (!user || reason) {
      log.warn(`Ignored inbound mail from ${mask(mail.from)}: ${reason}`);
      return 'ignored';
    }

    const forward = detectForward(mail.subject, mail.text);
    const text = forward
      ? [
          `Doorgestuurde mail${forward.originalFrom ? ` van ${forward.originalFrom}` : ''}` +
            `${forward.originalSubject ? `, onderwerp "${forward.originalSubject}"` : ''}.`,
          forward.note,
          forward.excerpt,
        ]
          .filter(Boolean)
          .join('\n\n')
      : extractReply(mail.text);

    const isNew = await deps.messages.recordInbound({
      userId: user.id,
      channel: 'email',
      externalId: mail.messageId,
      type: 'email',
      subject: mail.subject,
      body: text,
    });
    if (!isNew) return 'duplicate';

    await deps.messages.touchLastInbound(user.id, now());
    await deps.messages.recordEvent(user.id, 'inbound_message', {
      channel: 'email',
      type: forward ? 'forward' : 'reply',
    });

    const replies = text ? await deps.router({ kind: 'text', userId: user.id, text, source: 'email' }) : [EMPTY_REPLY];
    const context = { subject: replySubject(mail.subject), inReplyTo: mail.messageId };
    for (const reply of replies) {
      await deps.delivery.send(user, reply, { via: 'email', context });
    }
    return 'processed';
  };
}

export function replySubject(subject: string): string {
  const clean = subject.trim() || 'Je bericht';
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}
