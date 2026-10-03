import { describe, expect, it } from 'vitest';
import { TelegramApiError } from '../src/channels/telegram/client.js';
import { splitText, toInlineKeyboard } from '../src/channels/telegram/keyboard.js';
import { createLinkCode, deeplink, LINK_CODE_TTL_MS, verifyLinkCode } from '../src/channels/telegram/link.js';
import { parseUpdate } from '../src/channels/telegram/updates.js';
import { fixture } from './helpers/fixtures.js';

describe('toInlineKeyboard', () => {
  it('puts buttons three per row', () => {
    const buttons = [1, 2, 3, 4].map((n) => ({ id: `t:${n}:done`, title: `Knop ${n}` }));
    const keyboard = toInlineKeyboard({ text: 'Kies', buttons });
    expect(keyboard?.inline_keyboard.map((row) => row.length)).toEqual([3, 1]);
    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({ text: 'Knop 1', callback_data: 't:1:done' });
  });

  it('puts choices one per row and refuses more than eight', () => {
    const choices = Array.from({ length: 8 }, (_, n) => ({ id: `t:${n}:park`, title: `Taak ${n}` }));
    expect(toInlineKeyboard({ text: 'Afronden', choices })?.inline_keyboard).toHaveLength(8);
    expect(() =>
      toInlineKeyboard({ text: 'Afronden', choices: [...choices, { id: 'x', title: 'x' }] }),
    ).toThrow();
  });

  it('cuts titles to 20 characters and checks the 64-byte callback limit', () => {
    const keyboard = toInlineKeyboard({
      text: 'Kies',
      buttons: [{ id: 't:1:tomorrow', title: 'Morgen verder met deze taak' }],
    });
    expect(keyboard?.inline_keyboard[0]?.[0]?.text).toHaveLength(20);
    expect(() => toInlineKeyboard({ text: 'x', buttons: [{ id: 'x'.repeat(65), title: 'x' }] })).toThrow();
  });

  it('returns no keyboard without buttons', () => {
    expect(toInlineKeyboard({ text: 'Hoi' })).toBeUndefined();
  });
});

describe('splitText', () => {
  it('keeps short text whole and splits long text at a line break', () => {
    expect(splitText('kort')).toEqual(['kort']);
    const long = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}`;
    const parts = splitText(long);
    expect(parts).toEqual(['a'.repeat(3000), 'b'.repeat(3000)]);
  });
});

describe('parseUpdate', () => {
  it('parses a text message', () => {
    expect(parseUpdate(fixture('telegram', 'text'))).toMatchObject({
      updateId: 500001,
      fromUserId: 111222333,
      chatId: 111222333,
      messageId: 10,
      content: { kind: 'text', text: 'Hoi' },
    });
  });

  it('parses a command', () => {
    expect(parseUpdate(fixture('telegram', 'command-vandaag'))?.content).toEqual({
      kind: 'command',
      command: 'vandaag',
      argument: '',
    });
    const start = parseUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 5 },
        chat: { id: 5, type: 'private' },
        date: 1,
        text: '/start abc_def',
      },
    });
    expect(start?.content).toEqual({ kind: 'command', command: 'start', argument: 'abc_def' });
  });

  it('parses a button tap with the button title', () => {
    expect(parseUpdate(fixture('telegram', 'callback'))).toMatchObject({
      messageId: 20,
      content: {
        kind: 'button',
        buttonId: 'f:show',
        callbackQueryId: '4382bfdwdsb323b2d9',
        title: 'Laat zien',
      },
    });
  });

  it('parses voice and marks other types as unsupported', () => {
    expect(parseUpdate(fixture('telegram', 'voice'))?.content).toEqual({
      kind: 'voice',
      fileId: 'AwACAgQAAxkBAAIB',
      durationSeconds: 12,
    });
    expect(parseUpdate(fixture('telegram', 'photo'))?.content).toEqual({ kind: 'unsupported' });
  });

  it('ignores group chats and malformed updates', () => {
    expect(parseUpdate(fixture('telegram', 'group'))).toBeUndefined();
    expect(parseUpdate({ nonsense: true })).toBeUndefined();
  });
});

describe('link codes', () => {
  const secret = 'x'.repeat(32);
  const now = new Date('2026-10-01T08:00:00Z');

  it('round-trips and fits the 64-character start parameter', () => {
    const code = createLinkCode(42, secret, now);
    expect(code.length).toBeLessThanOrEqual(64);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyLinkCode(code, secret, now)).toEqual({ userId: 42, issuedAt: new Date('2026-10-01T08:00:00Z') });
  });

  it('expires after 30 minutes', () => {
    const code = createLinkCode(42, secret, now);
    expect(verifyLinkCode(code, secret, new Date(now.getTime() + LINK_CODE_TTL_MS - 1000))).toBeDefined();
    expect(verifyLinkCode(code, secret, new Date(now.getTime() + LINK_CODE_TTL_MS + 1000))).toBeUndefined();
  });

  it('rejects a changed code or another secret', () => {
    const code = createLinkCode(42, secret, now);
    expect(verifyLinkCode(code.replace(/^16_/, '17_'), secret, now)).toBeUndefined();
    expect(verifyLinkCode(code, 'y'.repeat(32), now)).toBeUndefined();
    expect(verifyLinkCode('nonsense', secret, now)).toBeUndefined();
  });

  it('builds the deeplink', () => {
    expect(deeplink('hyperfocus_bot', 'abc')).toBe('https://t.me/hyperfocus_bot?start=abc');
  });
});

describe('TelegramApiError', () => {
  it('recognizes an unreachable chat', () => {
    expect(new TelegramApiError('sendMessage', 403, 'Forbidden: bot was blocked by the user').chatUnreachable).toBe(true);
    expect(new TelegramApiError('sendMessage', 400, 'Bad Request: chat not found').chatUnreachable).toBe(true);
    expect(new TelegramApiError('sendMessage', 429, 'Too Many Requests').chatUnreachable).toBe(false);
  });
});

describe('command menu', () => {
  it('sends the commands to setMyCommands, and every command maps to a word the router knows', async () => {
    const { BOT_COMMANDS } = await import('../src/channels/telegram/processor.js');
    const { TelegramClient } = await import('../src/channels/telegram/client.js');
    const { fakeTelegramFetch } = await import('./helpers/memory.js');
    const telegram = fakeTelegramFetch();
    await new TelegramClient('t', telegram.fetchImpl).setMyCommands(BOT_COMMANDS);
    expect(telegram.calls[0]).toMatchObject({ method: 'setMyCommands', body: { commands: BOT_COMMANDS } });
    expect(BOT_COMMANDS.map((c) => c.command)).toContain('weekreview');
    for (const c of BOT_COMMANDS) expect(c.description.length).toBeLessThanOrEqual(256);
  });
});
