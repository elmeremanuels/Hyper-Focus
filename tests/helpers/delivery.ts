// Real channels and delivery over fake Telegram and Brevo APIs.
import { createDelivery } from '../../src/channels/channel.js';
import { EmailChannel } from '../../src/channels/email/channel.js';
import { EmailSender } from '../../src/channels/email/send.js';
import { TelegramChannel } from '../../src/channels/telegram/channel.js';
import { TelegramClient } from '../../src/channels/telegram/client.js';
import type { MessageStore } from '../../src/core/messages.js';
import { fakeBrevoFetch } from './brevo.js';
import { fakeTelegramFetch } from './memory.js';

export function fakeDelivery(store: MessageStore) {
  const telegram = fakeTelegramFetch();
  const brevo = fakeBrevoFetch();
  const delivery = createDelivery(
    {
      telegram: new TelegramChannel(new TelegramClient('test-token', telegram.fetchImpl), store),
      email: new EmailChannel(
        new EmailSender(
          { apiKey: 'key', from: 'hallo@hyper-focus.invalid', replyTo: 'taken@in.hyper-focus.invalid' },
          brevo.fetchImpl,
        ),
        store,
        { actionLinkSecret: 'a'.repeat(40), baseUrl: 'https://hyper-focus.invalid' },
      ),
    },
    { warn: () => undefined },
  );
  return { delivery, telegram, brevo };
}
