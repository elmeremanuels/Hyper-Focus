import { describe, expect, it, vi } from 'vitest';
import {
  ChannelUnavailableError,
  createDelivery,
  type Channel,
  type ChannelUser,
} from '../src/channels/channel.js';
import { TelegramChannel } from '../src/channels/telegram/channel.js';
import { TelegramClient } from '../src/channels/telegram/client.js';
import { createLinkCode } from '../src/channels/telegram/link.js';
import { createTelegramProcessor, TEXTS, type VoiceTranscriber } from '../src/channels/telegram/processor.js';
import { createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import type { InboundMessage, OutboundMessage } from '../src/conversation/types.js';
import { fixture } from './helpers/fixtures.js';
import {
  fakeTelegramFetch,
  MemoryMessageStore,
  MemoryUserStore,
  sam,
  SAM_TELEGRAM_ID,
} from './helpers/memory.js';

const LINK_SECRET = 's'.repeat(32);

function setup(options: { linked?: boolean; mail?: Channel; transcriber?: VoiceTranscriber; quiet?: boolean } = {}) {
  const telegram = fakeTelegramFetch();
  const client = new TelegramClient('test-token', telegram.fetchImpl);
  const messages = new MemoryMessageStore();
  const users = new MemoryUserStore([
    options.linked === false
      ? sam({ telegramUserId: null, telegramChatId: null, telegramLinkedAt: null })
      : sam(),
  ]);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const delivery = createDelivery(
    { telegram: new TelegramChannel(client, messages), ...(options.mail && { email: options.mail }) },
    log,
  );
  const routed: InboundMessage[] = [];
  const keywordRouter = createRouter(
      createMemoryRouterDeps('Sam', [
        { id: 11, title: 'Factuur versturen', estimatedMinutes: 5, projectTitle: 'Losse taken' },
      ]),
  );
  const process = createTelegramProcessor({
    client,
    users,
    messages,
    delivery,
    router: async (message) => {
      routed.push(message);
      return keywordRouter(message);
    },
    allowedUserIds: [SAM_TELEGRAM_ID],
    linkSecret: LINK_SECRET,
    transcriber: options.transcriber,
    log,
    now: () => new Date('2026-10-01T08:00:00Z'),
    ...(options.quiet !== undefined && { isQuiet: async () => options.quiet! }),
  });
  return { telegram, messages, users, log, process, routed };
}

describe('Telegram processor', () => {
  it('answers a text message through the router and stores both sides', async () => {
    const { telegram, messages, process } = setup();

    expect(await process(fixture('telegram', 'text'))).toBe('processed');

    const [reply] = telegram.sent();
    expect(reply?.body).toMatchObject({ chat_id: SAM_TELEGRAM_ID, text: expect.stringContaining('Hoi Sam') });
    expect(reply?.body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Laat zien', callback_data: 'f:show' },
          { text: 'Wat kan ik?', callback_data: 'help' },
        ],
      ],
    });
    expect(messages.inbound()).toMatchObject([{ channel: 'telegram', externalId: 'u:500001', body: 'Hoi' }]);
    expect(messages.outbound()).toMatchObject([{ channel: 'telegram', externalId: 'm:111222333:101', deliveryStatus: 'sent' }]);
    expect(messages.lastInbound.get(1)).toEqual(new Date(1791280800 * 1000));
    expect(messages.events[0]).toMatchObject({ name: 'inbound_message', props: { channel: 'telegram' } });
  });

  it('answers without sound during a work block or pause', async () => {
    const quiet = setup({ quiet: true });
    await quiet.process(fixture('telegram', 'text'));
    expect(quiet.telegram.sent()[0]?.body.disable_notification).toBe(true);

    const loud = setup({ quiet: false });
    await loud.process(fixture('telegram', 'text'));
    expect(loud.telegram.sent()[0]?.body).not.toHaveProperty('disable_notification');
  });

  it('processes a duplicate delivery once', async () => {
    const { telegram, process } = setup();
    await process(fixture('telegram', 'text'));
    expect(await process(fixture('telegram', 'text'))).toBe('duplicate');
    expect(telegram.sent()).toHaveLength(1);
  });

  it('answers a button tap, removes the keyboard and handles the choice once', async () => {
    const { telegram, process } = setup();

    expect(await process(fixture('telegram', 'callback'))).toBe('processed');
    expect(telegram.calls.map((call) => call.method)).toEqual([
      'answerCallbackQuery',
      'editMessageReplyMarkup',
      'sendMessage',
    ]);
    expect(telegram.calls[1]?.body).toEqual({
      chat_id: SAM_TELEGRAM_ID,
      message_id: 20,
      reply_markup: { inline_keyboard: [] },
    });
    expect(telegram.sent()[0]?.body.text).toContain('Vandaag, in deze volgorde');

    // A second tap on another button of the same message is not handled again.
    expect(await process(fixture('telegram', 'callback-second-tap'))).toBe('duplicate');
    expect(telegram.sent()).toHaveLength(1);
  });

  it('maps bot commands to words the router knows', async () => {
    const { telegram, process } = setup();
    await process(fixture('telegram', 'command-vandaag'));
    expect(telegram.sent()[0]?.body.text).toContain('Vandaag, in deze volgorde');
  });

  it('answers voice and unsupported messages', async () => {
    const { telegram, process } = setup();
    await process(fixture('telegram', 'voice'));
    await process(fixture('telegram', 'photo'));
    expect(telegram.sent().map((call) => call.body.text)).toEqual([TEXTS.voice, TEXTS.unsupported]);
  });

  it('ignores an unknown user, sends one short message and logs a masked id', async () => {
    const { telegram, messages, log, process } = setup();

    expect(await process(fixture('telegram', 'unknown-user'))).toBe('ignored');
    expect(telegram.sent().map((call) => call.body)).toMatchObject([{ chat_id: 444555666, text: TEXTS.closed }]);
    expect(telegram.sent()).toHaveLength(1);
    expect(messages.messages).toHaveLength(0);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('44*****66');
    expect(String(log.warn.mock.calls[0]?.[0])).not.toContain('444555666');
  });

  it('ignores group chats', async () => {
    const { telegram, process } = setup();
    expect(await process(fixture('telegram', 'group'))).toBe('ignored');
    expect(telegram.calls).toHaveLength(0);
  });

  describe('linking with /start {code}', () => {
    const start = (code: string, updateId = 600001) => ({
      update_id: updateId,
      message: {
        message_id: 1,
        from: { id: SAM_TELEGRAM_ID, first_name: 'Sam' },
        chat: { id: SAM_TELEGRAM_ID, type: 'private' },
        date: 1791280800,
        text: `/start ${code}`,
      },
    });

    it('links the account with a valid code', async () => {
      const { telegram, users, process } = setup({ linked: false });
      const code = createLinkCode(1, LINK_SECRET, new Date('2026-10-01T07:50:00Z'));

      expect(await process(start(code))).toBe('linked');
      expect(users.users[0]).toMatchObject({ telegramUserId: SAM_TELEGRAM_ID, telegramChatId: SAM_TELEGRAM_ID });
      expect(telegram.sent()[0]?.body.text).toBe(TEXTS.linked);
    });

    it('refuses a code that is expired or already used', async () => {
      const { telegram, process, routed } = setup({ linked: false });
      const old = createLinkCode(1, LINK_SECRET, new Date('2026-10-01T07:00:00Z'));
      expect(await process(start(old))).toBe('ignored');

      const code = createLinkCode(1, LINK_SECRET, new Date('2026-10-01T07:55:00Z'));
      expect(await process(start(code, 600002))).toBe('linked');
      expect(await process(start(code, 600003))).toBe('ignored');
      const texts = telegram.sent().map((call) => call.body.text);
      expect([texts[0], texts[1], texts.at(-1)]).toEqual([TEXTS.linkInvalid, TEXTS.linked, TEXTS.linkInvalid]);
      // After linking: when the user works best (step 1.12), then the tool questions (step 1.10).
      expect(routed).toEqual([
        expect.objectContaining({ kind: 'button', buttonId: 'fp:ask' }),
        expect.objectContaining({ kind: 'button', buttonId: 'tl:start' }),
      ]);
    });

    it('asks an allowed but unlinked user to open the link', async () => {
      const { telegram, process } = setup({ linked: false });
      expect(await process(fixture('telegram', 'text'))).toBe('ignored');
      expect(telegram.sent()[0]?.body.text).toBe(TEXTS.notLinked);
    });
  });

  it('falls back to mail when the bot is blocked', async () => {
    const mailed: OutboundMessage[] = [];
    const mail: Channel = { name: 'email', send: async (_user, message) => void mailed.push(message) };
    const { telegram, messages, process } = setup({ mail });
    telegram.failSendWith(403, 'Forbidden: bot was blocked by the user');

    expect(await process(fixture('telegram', 'text'))).toBe('processed');
    expect(mailed[0]?.text).toContain('Hoi Sam');
    expect(messages.outbound()).toMatchObject([{ channel: 'telegram', deliveryStatus: 'failed' }]);
  });
});

describe('createDelivery', () => {
  const user: ChannelUser = { id: 1, name: 'Sam', email: 's@x.nl', telegramChatId: null, preferredChannel: 'telegram' };

  it('uses the preferred channel, then mail when Telegram is unavailable', async () => {
    const used: string[] = [];
    const telegram: Channel = {
      name: 'telegram',
      send: async () => {
        used.push('telegram');
        throw new ChannelUnavailableError('telegram', 'not linked');
      },
    };
    const email: Channel = { name: 'email', send: async () => void used.push('email') };
    const delivery = createDelivery({ telegram, email }, { warn: () => undefined });

    expect(await delivery.send(user, { text: 'Hoi' })).toBe('email');
    expect(used).toEqual(['telegram', 'email']);
  });

  it('does not fall back on other errors', async () => {
    const telegram: Channel = {
      name: 'telegram',
      send: async () => {
        throw new Error('network down');
      },
    };
    const email: Channel = { name: 'email', send: vi.fn(async () => undefined) };
    const delivery = createDelivery({ telegram, email }, { warn: () => undefined });
    await expect(delivery.send(user, { text: 'Hoi' })).rejects.toThrow('network down');
    expect(email.send).not.toHaveBeenCalled();
  });

  describe('voice messages', () => {
    const transcriber = (text: string | Error) => ({
      isConfigured: () => true,
      transcribe: vi.fn(async (audio: Buffer) => {
        expect(audio.length).toBeGreaterThan(0);
        if (text instanceof Error) throw text;
        return text;
      }),
    });

    it('transcribes, stores the transcript and routes it as text from voice', async () => {
      const voice = transcriber('  zet op de lijst: banner voor boho ');
      const { telegram, messages, process, routed } = setup({ transcriber: voice });
      const started = Date.now();
      await process(fixture('telegram', 'voice'));

      expect(Date.now() - started).toBeLessThan(8000);
      expect(telegram.calls.map((call) => call.method)).toEqual(['sendChatAction', 'getFile', 'download', 'sendMessage']);
      expect(routed).toEqual([{ kind: 'text', userId: 1, text: 'zet op de lijst: banner voor boho', source: 'voice' }]);
      const [inbound] = messages.inbound();
      expect(inbound).toMatchObject({ type: 'audio', body: null, transcript: 'zet op de lijst: banner voor boho' });
    });

    it('asks to type when transcription fails or is not configured', async () => {
      const failing = setup({ transcriber: transcriber(new Error('bad audio')) });
      await failing.process(fixture('telegram', 'voice'));
      expect(failing.telegram.sent().at(-1)?.body.text).toBe(TEXTS.voiceFailed);
      expect(failing.routed).toHaveLength(0);

      const off = setup({ transcriber: { isConfigured: () => false, transcribe: vi.fn() } });
      await off.process(fixture('telegram', 'voice'));
      expect(off.telegram.sent().at(-1)?.body.text).toBe(TEXTS.voice);
    });

    it('does not transcribe messages over five minutes', async () => {
      const voice = transcriber('lang');
      const { telegram, process } = setup({ transcriber: voice });
      const update = fixture<{ message: { voice: { duration: number } } }>('telegram', 'voice');
      update.message.voice.duration = 301;
      await process(update);
      expect(voice.transcribe).not.toHaveBeenCalled();
      expect(telegram.sent().at(-1)?.body.text).toBe(TEXTS.voiceTooLong);
    });
  });
});
