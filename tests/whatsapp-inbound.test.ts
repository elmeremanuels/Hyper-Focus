import { describe, expect, it } from 'vitest';
import { normalizeWaNumber, parseWebhook } from '../src/channels/whatsapp/inbound.js';
import { metaFixture } from './helpers/meta.js';

describe('parseWebhook', () => {
  it('parses a text message and normalizes the number to E.164', () => {
    const { messages } = parseWebhook(metaFixture('text'));
    expect(messages).toEqual([
      {
        waMessageId: 'wamid.TEXT1',
        from: '+31600000000',
        sentAt: new Date(1791280800 * 1000),
        content: { kind: 'text', text: 'Hoi' },
      },
    ]);
  });

  it('parses a reply button', () => {
    const [message] = parseWebhook(metaFixture('button')).messages;
    expect(message?.content).toEqual({ kind: 'button', buttonId: 'f:show', title: 'Laat zien', via: 'button' });
  });

  it('parses a list choice', () => {
    const [message] = parseWebhook(metaFixture('list')).messages;
    expect(message?.content).toEqual({ kind: 'button', buttonId: 't:12:park', title: 'Parkeren', via: 'list' });
  });

  it('parses a quick-reply button on a template', () => {
    const [message] = parseWebhook(metaFixture('template-button')).messages;
    expect(message?.content).toEqual({ kind: 'button', buttonId: 'f:show', title: 'Laat zien', via: 'template' });
  });

  it('parses an audio message', () => {
    const [message] = parseWebhook(metaFixture('audio')).messages;
    expect(message?.content).toEqual({ kind: 'audio', mediaId: '1234567890', mimeType: 'audio/ogg; codecs=opus' });
  });

  it('marks other types as unsupported', () => {
    const [message] = parseWebhook(metaFixture('image')).messages;
    expect(message?.content).toEqual({ kind: 'unsupported', type: 'image' });
  });

  it('parses status updates', () => {
    const { messages, statuses } = parseWebhook(metaFixture('status'));
    expect(messages).toEqual([]);
    expect(statuses.map((status) => status.status)).toEqual(['delivered', 'read']);
    expect(statuses[0]?.waMessageId).toBe('wamid.OUT1');
  });

  it('returns nothing for other objects or malformed payloads', () => {
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook('nonsense')).toEqual({ messages: [], statuses: [] });
  });
});

describe('normalizeWaNumber', () => {
  it('adds the plus sign and strips other characters', () => {
    expect(normalizeWaNumber('31612345678')).toBe('+31612345678');
    expect(normalizeWaNumber('+62 812-3456')).toBe('+628123456');
  });
});
