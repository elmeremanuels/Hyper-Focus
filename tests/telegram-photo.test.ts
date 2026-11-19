import { describe, expect, it } from 'vitest';
import { TelegramChannel } from '../src/channels/telegram/channel.js';
import { TelegramClient } from '../src/channels/telegram/client.js';
import { MemoryMessageStore, fakeTelegramFetch, sam } from './helpers/memory.js';

const PHOTO = 'https://hyper-focus.invalid/media/p-0123456789abcdef01234567.jpg';
const buttons = [{ id: 'cp:1:ok', title: 'Goed' }];

describe('a message with a photo in Telegram (step C4)', () => {
  it('sends one photo with the text as caption and the buttons under it', async () => {
    const telegram = fakeTelegramFetch();
    await new TelegramChannel(new TelegramClient('t', telegram.fetchImpl), new MemoryMessageStore()).send(sam(), { text: 'Korte post', buttons, photo: PHOTO });
    expect(telegram.calls.map((c) => c.method)).toEqual(['sendPhoto']);
    expect(telegram.calls[0]?.body).toMatchObject({ photo: PHOTO, caption: 'Korte post', reply_markup: { inline_keyboard: [[{ text: 'Goed', callback_data: 'cp:1:ok' }]] } });
  });

  it('sends a long text after the photo, with the buttons under the text', async () => {
    const telegram = fakeTelegramFetch();
    const text = 'x'.repeat(1500);
    await new TelegramChannel(new TelegramClient('t', telegram.fetchImpl), new MemoryMessageStore()).send(sam(), { text, buttons, photo: PHOTO });
    expect(telegram.calls.map((c) => c.method)).toEqual(['sendPhoto', 'sendMessage']);
    expect(telegram.calls[0]?.body.caption).toBeUndefined();
    expect(telegram.calls[1]?.body).toMatchObject({ text, reply_markup: { inline_keyboard: [[{ callback_data: 'cp:1:ok' }]] } });
  });

  it('falls back to a link when Telegram cannot fetch the image', async () => {
    const telegram = fakeTelegramFetch();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/sendPhoto')) {
        return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: wrong file identifier/HTTP URL specified' }), { status: 400 });
      }
      return telegram.fetchImpl(url, init);
    }) as typeof fetch;
    await new TelegramChannel(new TelegramClient('t', fetchImpl), new MemoryMessageStore()).send(sam(), { text: 'Korte post', buttons, photo: PHOTO });
    expect(telegram.sent().map((c) => c.body.text)).toEqual([`Korte post\n\nBeeld: ${PHOTO}`]);
  });
});
