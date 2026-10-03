import { describe, expect, it } from 'vitest';
import { EmailChannel } from '../src/channels/email/channel.js';
import { EmailSender } from '../src/channels/email/send.js';
import { TelegramChannel } from '../src/channels/telegram/channel.js';
import { TelegramClient } from '../src/channels/telegram/client.js';
import { fakeBrevoFetch } from './helpers/brevo.js';
import { fakeTelegramFetch, MemoryMessageStore, sam } from './helpers/memory.js';

const message = {
  text: 'Staat gepland.',
  attachments: [{ filename: 'focus-1400.ics', mimeType: 'text/calendar', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }],
};

describe('attachments', () => {
  it('Telegram sends the text, then the file as a document', async () => {
    const telegram = fakeTelegramFetch();
    await new TelegramChannel(new TelegramClient('t', telegram.fetchImpl), new MemoryMessageStore()).send(sam(), message);
    expect(telegram.calls.map((c) => c.method)).toEqual(['sendMessage', 'sendDocument']);
    expect(telegram.calls[1]?.body).toMatchObject({ chat_id: String(sam().telegramChatId), document: { filename: 'focus-1400.ics', type: 'text/calendar' } });
  });

  it('mail adds the file as a Brevo attachment', async () => {
    const brevo = fakeBrevoFetch();
    const sender = new EmailSender({ apiKey: 'k', from: 'hallo@hyper-focus.invalid', replyTo: undefined }, brevo.fetchImpl);
    await new EmailChannel(sender, new MemoryMessageStore(), { actionLinkSecret: undefined, baseUrl: undefined }).send(sam(), message);
    const body = brevo.sent[0]?.body as unknown as { attachment: Array<{ name: string; content: string }> };
    expect(body.attachment[0]?.name).toBe('focus-1400.ics');
    expect(Buffer.from(body.attachment[0]?.content ?? '', 'base64').toString()).toContain('BEGIN:VCALENDAR');
  });
});
