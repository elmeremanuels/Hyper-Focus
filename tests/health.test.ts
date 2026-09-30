import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { startServer, type RunningServer } from './helpers/server.js';

describe('GET /health', () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(createApp());
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns status ok', async () => {
    const response = await fetch(`${server.baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
