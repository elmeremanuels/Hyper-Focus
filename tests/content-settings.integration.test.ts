import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { clients, userSettings } from '../src/db/schema/index.js';
import { createSession } from '../src/web/auth/sessions.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BASE = 'https://app.hyper-focus.invalid';
const NOW = new Date('2026-10-12T07:00:00Z');

describe.skipIf(!adminUrl)('image preferences on the client card (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const dir = mkdtempSync(join(tmpdir(), 'hf-logo-'));
  const content = { encryptionKey: 'k'.repeat(32), media: { dir, baseUrl: 'https://hyper-focus.invalid', pexelsApiKey: 'p' } };
  let cookie = '';
  let clientId = 0;

  beforeAll(async () => {
    cookie = `hf_session=${(await createSession(db(), t.userId, NOW)).token}`;
    await db().update(userSettings).set({ contentEnabled: true }).where(eq(userSettings.userId, t.userId));
    const [client] = await db().insert(clients).values({ userId: t.userId, name: 'Studio Rust', socialsEnabled: true }).returning({ id: clients.id });
    clientId = client!.id;
  });

  async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
    const s = await startServer(createApp({ dashboard: { db: db(), dashboardBaseUrl: BASE, now: () => NOW, content } }));
    try {
      const res = await fetch(`${s.baseUrl}${path}`, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: (await res.json()) as T };
    } finally {
      await s.close();
    }
  }
  type Card = { imageSources: string[]; imageStyle: string | null; brandColors: string[]; logoUrl: string | null; sourcesAvailable: string[] };
  const card = async () => (await call<{ clients: Array<{ id: number; content: Card }> }>('GET', '/api/projects')).body.clients.find((c) => c.id === clientId)!.content;

  it('stores the sources in their order, the style and the colours', async () => {
    expect((await card()).imageSources).toEqual(['drive', 'pexels', 'textcard']);
    // Pexels has a key, memes are allowed, text cards always work; no Drive folder, no AI.
    expect((await card()).sourcesAvailable).toEqual(['pexels', 'meme', 'textcard']);
    const res = await call('PATCH', `/api/clients/${clientId}/content`, { imageSources: ['textcard', 'pexels'], imageStyle: 'rustig, natuurlijk licht', brandColors: ['#264653', '#f4f1de'] });
    expect(res.status).toBe(200);
    expect(await card()).toMatchObject({ imageSources: ['textcard', 'pexels'], imageStyle: 'rustig, natuurlijk licht', brandColors: ['#264653', '#f4f1de'] });
    expect((await call('PATCH', `/api/clients/${clientId}/content`, { imageSources: ['pexels', 'pexels'] })).status).toBe(400);
    expect((await call('PATCH', `/api/clients/${clientId}/content`, { imageSources: ['canva'] })).status).toBe(400);
    expect((await call('PATCH', `/api/clients/${clientId}/content`, { brandColors: ['rood'] })).status).toBe(400);
  });

  it('takes a logo up to 3 MB as PNG, replaces and removes it', async () => {
    const png = await sharp({ create: { width: 400, height: 200, channels: 4, background: '#e07a5f' } }).png().toBuffer();
    const first = await call<{ logoUrl: string }>('PUT', `/api/logo/${clientId}`, { data: `data:image/png;base64,${png.toString('base64')}` });
    expect(first.status).toBe(200);
    expect(first.body.logoUrl).toMatch(/^https:\/\/hyper-focus\.invalid\/media\/l-[0-9a-f]{24}\.png$/);
    const firstFile = join(dir, first.body.logoUrl.split('/media/')[1]!);
    expect(existsSync(firstFile)).toBe(true);

    const second = await call<{ logoUrl: string }>('PUT', `/api/logo/${clientId}`, { data: png.toString('base64') });
    expect(existsSync(firstFile)).toBe(false);
    expect((await card()).logoUrl).toBe(second.body.logoUrl);

    expect((await call('PUT', `/api/logo/${clientId}`, { data: Buffer.from('geen beeld hier').toString('base64') })).status).toBe(400);
    expect((await call('DELETE', `/api/logo/${clientId}`)).status).toBe(200);
    expect((await card()).logoUrl).toBeNull();
  });

  it('keeps the AI budget per month in the settings', async () => {
    expect((await call<{ aiImageBudgetCents: number }>('GET', '/api/settings')).body.aiImageBudgetCents).toBe(1000);
    expect((await call('PATCH', '/api/settings', { aiImageBudgetCents: 2500 })).status).toBe(200);
    expect((await call<{ aiImageBudgetCents: number }>('GET', '/api/settings')).body.aiImageBudgetCents).toBe(2500);
  });
});
