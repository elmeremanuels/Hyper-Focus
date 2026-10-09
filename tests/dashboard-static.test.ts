import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { startServer, type RunningServer } from './helpers/server.js';

function get(base: string, path: string, host: string): Promise<{ status: number; body: string; cache: string | undefined }> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, cache: res.headers['cache-control'] }));
    })
      .on('error', reject)
      .end();
  });
}

describe('dashboard app on its own host', () => {
  let server: RunningServer;
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hf-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
    server = await startServer(createApp({ dashboardWeb: { dir, host: 'app.hyper-focus.invalid' } }));
  });
  afterAll(() => server.close());

  it('serves the app and its routes on the dashboard host, uncached', async () => {
    for (const path of ['/', '/projecten', '/instellingen']) {
      const res = await get(server.baseUrl, path, 'app.hyper-focus.invalid');
      expect([res.status, res.body, res.cache]).toEqual([200, '<!doctype html><div id="root"></div>', 'no-store']);
    }
    const asset = await get(server.baseUrl, '/assets/index-abc.js', 'app.hyper-focus.invalid');
    expect(asset.status).toBe(200);
    expect(asset.cache).toContain('immutable');
  });

  it('leaves the server paths and the other host alone', async () => {
    expect((await get(server.baseUrl, '/health', 'app.hyper-focus.invalid')).body).toBe('{"status":"ok"}');
    expect((await get(server.baseUrl, '/api/unknown', 'app.hyper-focus.invalid')).status).toBe(404);
    expect((await get(server.baseUrl, '/', 'hyper-focus.invalid')).status).toBe(404);
  });
});
