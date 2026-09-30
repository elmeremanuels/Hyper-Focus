import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { signBody } from '../src/channels/whatsapp/signature.js';
import { startServer, type RunningServer } from './helpers/server.js';

const SECRET = 'app-secret';
let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(onPayload?: (body: unknown) => Promise<unknown>) {
  server = await startServer(
    createApp({ whatsapp: { verifyToken: 'test-token', appSecret: SECRET, ...(onPayload && { onPayload }) } }),
  );
  return server;
}

function post(baseUrl: string, body: string, signature: string | undefined) {
  return fetch(`${baseUrl}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature && { 'x-hub-signature-256': signature }) },
    body,
  });
}

describe('GET /webhooks/whatsapp', () => {
  const verify = (baseUrl: string, params: Record<string, string>) =>
    fetch(`${baseUrl}/webhooks/whatsapp?${new URLSearchParams(params).toString()}`);

  it('returns the challenge for a valid verify token', async () => {
    const { baseUrl } = await start();
    const response = await verify(baseUrl, {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-token',
      'hub.challenge': '12345',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('12345');
  });

  it('rejects a wrong verify token', async () => {
    const { baseUrl } = await start();
    const response = await verify(baseUrl, {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '12345',
    });
    expect(response.status).toBe(403);
  });

  it('rejects every request when no verify token is configured', async () => {
    server = await startServer(createApp());
    const response = await fetch(`${server.baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=1`);
    expect(response.status).toBe(403);
  });
});

describe('POST /webhooks/whatsapp', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('returns 401 for an invalid signature and does not process', async () => {
    const onPayload = vi.fn(async () => undefined);
    const { baseUrl } = await start(onPayload);

    expect((await post(baseUrl, body, signBody(body, 'wrong-secret'))).status).toBe(401);
    expect((await post(baseUrl, body, undefined)).status).toBe(401);
    expect(onPayload).not.toHaveBeenCalled();
  });

  it('returns 401 when no app secret is configured', async () => {
    server = await startServer(createApp({ whatsapp: { verifyToken: 'x', appSecret: undefined } }));
    expect((await post(server.baseUrl, body, signBody(body, SECRET))).status).toBe(401);
  });

  it('returns 200 before processing finishes', async () => {
    let finish: () => void = () => undefined;
    const processing = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onPayload = vi.fn(() => processing);
    const { baseUrl } = await start(onPayload);

    const response = await post(baseUrl, body, signBody(body, SECRET));

    expect(response.status).toBe(200);
    expect(onPayload).toHaveBeenCalledWith(JSON.parse(body));
    finish();
  });

  it('returns 400 for a signed body that is not JSON', async () => {
    const { baseUrl } = await start(vi.fn(async () => undefined));
    expect((await post(baseUrl, 'not json', signBody('not json', SECRET))).status).toBe(400);
  });

  it('keeps running when processing fails', async () => {
    const onPayload = vi.fn(async () => {
      throw new Error('boom');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { baseUrl } = await start(onPayload);

    expect((await post(baseUrl, body, signBody(body, SECRET))).status).toBe(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    error.mockRestore();
  });
});
