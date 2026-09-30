import { describe, expect, it, vi } from 'vitest';
import { createWebhookProcessor, maskPhone } from '../src/channels/whatsapp/processor.js';
import { createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import type { OutboundMessage } from '../src/conversation/types.js';
import { MemoryMessageStore } from './helpers/memory-store.js';
import { metaFixture } from './helpers/meta.js';

const SAM = '+31600000000';

function setup() {
  const store = new MemoryMessageStore({ [SAM]: { id: 1, name: 'Sam' } });
  const sent: Array<{ to: string; message: OutboundMessage }> = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const process = createWebhookProcessor({
    store,
    router: createRouter(
      createMemoryRouterDeps('Sam', [{ id: 11, title: 'Factuur versturen', estimatedMinutes: 5, projectTitle: 'Losse taken' }]),
    ),
    allowedNumbers: [SAM],
    channelFor: (userId) => ({
      send: async (to, message) => {
        sent.push({ to, message });
        await store.recordOutbound({ userId, waMessageId: `wamid.OUT${sent.length}`, type: 'text', body: message.text });
      },
    }),
    log,
  });
  return { store, sent, log, process };
}

describe('webhook processor', () => {
  it('answers a text message through the router and stores it', async () => {
    const { store, sent, process } = setup();
    const result = await process(metaFixture('text'));

    expect(result).toMatchObject({ processed: 1, duplicates: 0, ignored: 0 });
    expect(sent[0]?.to).toBe(SAM);
    expect(sent[0]?.message.text).toContain('Hoi Sam');
    expect(store.messages.filter((message) => message.direction === 'in')).toHaveLength(1);
    expect(store.lastInbound.get(1)).toEqual(new Date(1791280800 * 1000));
    expect(store.events).toEqual([{ userId: 1, name: 'inbound_message', props: { type: 'text' } }]);
  });

  it('processes a duplicate delivery once', async () => {
    const { store, sent, process } = setup();
    await process(metaFixture('text'));
    const second = await process(metaFixture('text'));

    expect(second).toMatchObject({ processed: 0, duplicates: 1 });
    expect(sent).toHaveLength(1);
    expect(store.messages.filter((message) => message.direction === 'in')).toHaveLength(1);
  });

  it('ignores and logs an unknown number without the full number', async () => {
    const { store, sent, log, process } = setup();
    const result = await process(metaFixture('unknown-number'));

    expect(result).toMatchObject({ processed: 0, ignored: 1 });
    expect(sent).toHaveLength(0);
    expect(store.messages).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('+316*****111'));
    expect(String(log.warn.mock.calls[0]?.[0])).not.toContain('31611111111');
  });

  it('handles buttons, list choices and template buttons without text matching', async () => {
    const { sent, store, process } = setup();
    await process(metaFixture('button'));
    await process(metaFixture('template-button'));
    await process(metaFixture('list'));

    expect(sent[0]?.message.text).toContain('Vandaag, in deze volgorde');
    expect(sent[1]?.message.text).toContain('Vandaag, in deze volgorde');
    expect(store.messages.find((message) => message.waMessageId === 'wamid.LIST1')?.type).toBe('list');
  });

  it('replies to audio and unsupported types', async () => {
    const { sent, store, process } = setup();
    await process(metaFixture('audio'));
    await process(metaFixture('image'));

    expect(sent[0]?.message.text).toContain('Spraakberichten');
    expect(sent[1]?.message.text).toContain('Dit soort bericht');
    expect(store.messages.find((message) => message.waMessageId === 'wamid.AUDIO1')?.type).toBe('audio');
  });

  it('updates the delivery status of the outgoing message', async () => {
    const { store, process } = setup();
    await process(metaFixture('text'));
    const result = await process(metaFixture('status'));

    expect(result.statuses).toBe(2);
    expect(store.messages.find((message) => message.waMessageId === 'wamid.OUT1')?.deliveryStatus).toBe('read');
  });
});

describe('maskPhone', () => {
  it('keeps the country code and last three digits', () => {
    expect(maskPhone('+31612345678')).toBe('+316*****678');
  });
});
