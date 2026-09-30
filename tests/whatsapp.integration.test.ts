import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { WhatsAppChannel } from '../src/channels/whatsapp/channel.js';
import { WhatsAppClient } from '../src/channels/whatsapp/client.js';
import { createWebhookProcessor, type ProcessResult } from '../src/channels/whatsapp/processor.js';
import { signBody } from '../src/channels/whatsapp/signature.js';
import { createDbRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { connect, type DbConnection } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { events, messages, users } from '../src/db/schema/index.js';
import example from '../src/db/seed/example.js';
import { loadSeed } from '../src/db/seed/load.js';
import { metaFixture } from './helpers/meta.js';
import { startServer, type RunningServer } from './helpers/server.js';

const adminUrl = process.env.TEST_DATABASE_URL;
const SECRET = 'app-secret';

describe.skipIf(!adminUrl)('WhatsApp webhook end to end (integration)', () => {
  const dbName = `hyperfocus_test_${randomBytes(4).toString('hex')}`;
  let connection: DbConnection;
  let server: RunningServer;
  let outboundId = 0;
  const graphCalls: Array<Record<string, unknown>> = [];
  const results: ProcessResult[] = [];

  async function admin(query: string) {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query(query);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    await runMigrations(url.toString());
    connection = connect(url.toString());
    await loadSeed(connection.db, example);

    // Fake Graph API: records the request and returns a message id.
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      graphCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      outboundId += 1;
      return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT${outboundId}` }] }), { status: 200 });
    });
    const client = new WhatsAppClient({ graphVersion: 'v99.0', accessToken: 't', phoneNumberId: '1' }, fetchImpl);
    const store = createDbMessageStore(connection.db);
    const processPayload = createWebhookProcessor({
      store,
      router: createRouter(createDbRouterDeps(connection.db)),
      allowedNumbers: [example.user.phoneE164],
      channelFor: (userId) => new WhatsAppChannel(client, store, userId),
      log: { info: () => undefined, warn: () => undefined, error: console.error },
    });

    server = await startServer(
      createApp({
        whatsapp: {
          verifyToken: 'v',
          appSecret: SECRET,
          onPayload: async (body) => {
            results.push(await processPayload(body));
          },
        },
      }),
    );
  });

  afterAll(async () => {
    await server?.close();
    await connection?.close();
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  });

  async function deliver(fixture: string) {
    const body = JSON.stringify(metaFixture(fixture));
    const before = results.length;
    const started = Date.now();
    const response = await fetch(`${server.baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signBody(body, SECRET) },
      body,
    });
    const responseMs = Date.now() - started;
    await vi.waitFor(() => expect(results.length).toBe(before + 1));
    return { status: response.status, responseMs, result: results[before]! };
  }

  it('answers a text message and stores both messages', async () => {
    const { status, responseMs, result } = await deliver('text');

    expect(status).toBe(200);
    expect(responseMs).toBeLessThan(1000);
    expect(result.processed).toBe(1);
    expect(graphCalls[0]).toMatchObject({ to: '+31600000000', type: 'interactive' });

    const rows = await connection.db.select().from(messages);
    expect(rows.map((row) => [row.direction, row.waMessageId, row.deliveryStatus])).toEqual([
      ['in', 'wamid.TEXT1', null],
      ['out', 'wamid.OUT1', 'sent'],
    ]);

    const [user] = await connection.db.select().from(users).where(eq(users.phoneE164, '+31600000000'));
    expect(user?.lastInboundAt?.toISOString()).toBe(new Date(1791280800 * 1000).toISOString());
    expect(await connection.db.select().from(events)).toHaveLength(1);
  });

  it('processes a duplicate delivery only once', async () => {
    const { status, result } = await deliver('text');

    expect(status).toBe(200);
    expect(result).toMatchObject({ processed: 0, duplicates: 1 });
    expect(graphCalls).toHaveLength(1);
    expect(await connection.db.select().from(messages)).toHaveLength(2);
  });

  it('updates the delivery status on the outgoing message', async () => {
    await deliver('status');
    const [row] = await connection.db.select().from(messages).where(eq(messages.waMessageId, 'wamid.OUT1'));
    expect(row?.deliveryStatus).toBe('read');
  });

  it('does not move a status backwards', async () => {
    const store = createDbMessageStore(connection.db);
    await store.updateDeliveryStatus('wamid.OUT1', 'delivered', new Date());
    const [row] = await connection.db.select().from(messages).where(eq(messages.waMessageId, 'wamid.OUT1'));
    expect(row?.deliveryStatus).toBe('read');
  });

  it('answers a button with the focus list from the database', async () => {
    await deliver('button');
    const last = graphCalls.at(-1) as { interactive: { body: { text: string } } };
    expect(last.interactive.body.text).toContain('Offerte bakkerij afmaken');
  });

  it('ignores an unknown number', async () => {
    const callsBefore = graphCalls.length;
    const countBefore = (await connection.db.select().from(messages)).length;
    const { result } = await deliver('unknown-number');

    expect(result).toMatchObject({ ignored: 1, processed: 0 });
    expect(graphCalls).toHaveLength(callsBefore);
    expect(await connection.db.select().from(messages)).toHaveLength(countBefore);
  });
});
