// Handles an inbound mail (BOUWPLAN.md, 9.3): sender and SPF/DKIM checks, idempotency on
// Message-ID, reply extraction, forwarded mail as context, and the answer by mail.
import type { MessageStore } from '../../core/messages.js';
import type { UserStore } from '../../core/users.js';
import type { Router } from '../../conversation/router.js';
import type { OutboundMessage } from '../../conversation/types.js';
import { mask } from '../../lib/secrets.js';
import type { Delivery } from '../channel.js';
import { parseInboundMail, type InboundFields } from './inbound.js';
import { detectForward, extractReply } from './parse-reply.js';

export interface MailProcessorDeps {
  users: UserStore;
  messages: MessageStore;
  delivery: Delivery;
  router: Router;
  allowedSenders: readonly string[];
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export type MailOutcome = 'processed' | 'duplicate' | 'ignored';

export const EMPTY_REPLY: OutboundMessage = {
  text: 'Ik zag geen nieuwe tekst in je mail. Schrijf je bericht boven de geciteerde tekst.',
};

export function createMailProcessor(deps: MailProcessorDeps) {
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  const allowed = new Set(deps.allowedSenders.map((address) => address.toLowerCase()));

  return async function processMail(fields: InboundFields): Promise<MailOutcome> {
    const mail = parseInboundMail(fields);
    if (!mail.from) {
      log.warn('Ignored inbound mail without a sender address');
      return 'ignored';
    }

    const user = await deps.users.findByEmail(mail.from);
    const reason = !user
      ? 'unknown sender'
      : !allowed.has(mail.from)
        ? 'sender not allowed'
        : !mail.spfPass
          ? 'SPF not pass'
          : !mail.dkimPass
            ? 'DKIM not pass'
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

    const replies = text ? await deps.router({ kind: 'text', userId: user.id, text }) : [EMPTY_REPLY];
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
