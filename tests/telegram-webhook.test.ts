import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { startServer, type RunningServer } from './helpers/server.js';

const SECRET = 'a'.repeat(40);
let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function post(baseUrl: string, secret: string | undefined, body = { update_id: 1 }) {
  return fetch(`${baseUrl}/webhooks/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret && { 'x-telegram-bot-api-secret-token': secret }) },
    body: JSON.stringify(body),
  });
}

describe('POST /webhooks/telegram', () => {
  it('returns 401 for a missing or wrong secret token and does not process', async () => {
    const onUpdate = vi.fn(async () => undefined);
    server = await startServer(createApp({ telegram: { secretToken: SECRET, onUpdate } }));

    expect((await post(server.baseUrl, undefined)).status).toBe(401);
    expect((await post(server.baseUrl, 'b'.repeat(40))).status).toBe(401);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('returns 401 when no secret is configured', async () => {
    server = await startServer(createApp());
    expect((await post(server.baseUrl, SECRET)).status).toBe(401);
  });

  it('returns 200 before processing finishes', async () => {
    let finish: () => void = () => undefined;
    const onUpdate = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    server = await startServer(createApp({ telegram: { secretToken: SECRET, onUpdate } }));

    const response = await post(server.baseUrl, SECRET, { update_id: 7 });
    expect(response.status).toBe(200);
    expect(onUpdate).toHaveBeenCalledWith({ update_id: 7 });
    finish();
  });

  it('keeps running when processing fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onUpdate = vi.fn(async () => {
      throw new Error('boom');
    });
    server = await startServer(createApp({ telegram: { secretToken: SECRET, onUpdate } }));

    expect((await post(server.baseUrl, SECRET)).status).toBe(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect((await fetch(`${server.baseUrl}/health`)).status).toBe(200);
    error.mockRestore();
  });
});
