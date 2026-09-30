import { describe, expect, it, vi } from 'vitest';
import { WhatsAppClient } from '../src/channels/whatsapp/client.js';

const config = { graphVersion: 'v99.0', accessToken: 'token', phoneNumberId: '123' };

function fakeFetch(status = 200, body: unknown = { messages: [{ id: 'wamid.1' }] }) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe('WhatsAppClient', () => {
  it('sends a text message to the configured Graph version', async () => {
    const fetchImpl = fakeFetch();
    const client = new WhatsAppClient(config, fetchImpl);

    const result = await client.sendText('+31600000001', 'Hoi');

    expect(result.id).toBe('wamid.1');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v99.0/123/messages');
    expect(JSON.parse(String(init?.body))).toMatchObject({ type: 'text', text: { body: 'Hoi' } });
  });

  it('sends templates in Dutch', async () => {
    const fetchImpl = fakeFetch();
    const client = new WhatsAppClient(config, fetchImpl);

    await client.sendTemplate('+31600000001', 'ochtend_focus', ['Elmer']);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.template.language.code).toBe('nl');
    expect(body.template.components[0].parameters).toEqual([{ type: 'text', text: 'Elmer' }]);
  });

  it('throws the Graph error message on failure', async () => {
    const client = new WhatsAppClient(config, fakeFetch(400, { error: { message: 'Bad number' } }));
    await expect(client.sendText('+31600000001', 'Hoi')).rejects.toThrow('Bad number');
  });
});
