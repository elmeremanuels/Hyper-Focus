import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { startServer, type RunningServer } from './helpers/server.js';

describe('GET /webhooks/whatsapp', () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(createApp({ whatsappVerifyToken: 'test-token' }));
  });

  afterAll(async () => {
    await server.close();
  });

  const verify = (params: Record<string, string>) =>
    fetch(`${server.baseUrl}/webhooks/whatsapp?${new URLSearchParams(params).toString()}`);

  it('returns the challenge for a valid verify token', async () => {
    const response = await verify({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-token',
      'hub.challenge': '12345',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('12345');
  });

  it('rejects a wrong verify token', async () => {
    const response = await verify({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '12345',
    });
    expect(response.status).toBe(403);
  });

  it('rejects every request when no verify token is configured', async () => {
    const unconfigured = await startServer(createApp());
    try {
      const response = await fetch(
        `${unconfigured.baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=1`,
      );
      expect(response.status).toBe(403);
    } finally {
      await unconfigured.close();
    }
  });
});
