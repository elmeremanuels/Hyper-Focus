import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type DbConnection } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  businesses,
  dailyFocus,
  messages,
  projects,
  tasks,
  userSettings,
  LOOSE_TASKS_PROJECT_TITLE,
} from '../src/db/schema/index.js';
import example from '../src/db/seed/example.js';
import { loadSeed } from '../src/db/seed/load.js';
import { createDbRouterDeps } from '../src/conversation/deps.js';

// Runs against a throwaway database created from TEST_DATABASE_URL (a role with CREATEDB).
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('database (integration)', () => {
  const dbName = `hyperfocus_test_${randomBytes(4).toString('hex')}`;
  let testUrl: string;
  let connection: DbConnection;
  let userId: number;

  async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await admin((client) => client.query(`CREATE DATABASE ${dbName}`));
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    testUrl = url.toString();

    await runMigrations(testUrl);
    connection = connect(testUrl);
    userId = (await loadSeed(connection.db, example)).userId;
  });

  afterAll(async () => {
    await connection?.close();
    await admin((client) => client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
  });

  it('migrates an empty database and loads the seed', async () => {
    const [settings] = await connection.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    expect(settings?.morningTime).toBe('08:30:00');
    expect(settings?.maxProactivePerDay).toBe(4);

    const allTasks = await connection.db.select().from(tasks).where(eq(tasks.userId, userId));
    expect(allTasks).toHaveLength(8);
    expect(allTasks.filter((task) => task.parentTaskId !== null)).toHaveLength(3);
  });

  it('gives every user a "Losse taken" project', async () => {
    const rows = await connection.db
      .select()
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.title, LOOSE_TASKS_PROJECT_TITLE)));
    expect(rows).toHaveLength(1);
  });

  it('is idempotent when seeding twice', async () => {
    const again = await loadSeed(connection.db, example);
    expect(again).toEqual({ userId, created: false });
  });

  it('allows at most one focus business per user', async () => {
    await expect(
      connection.db.insert(businesses).values({ userId, name: 'Tweede', isFocus: true }),
    ).rejects.toThrow();
  });

  it('allows at most three focus tasks per day', async () => {
    await expect(
      connection.db
        .insert(dailyFocus)
        .values({ userId, localDate: '2026-10-06', taskIds: [1, 2, 3, 4] }),
    ).rejects.toThrow();
  });

  it('only allows the fixed estimates', async () => {
    const [project] = await connection.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));
    await expect(
      connection.db.insert(tasks).values({
        userId,
        projectId: project!.id,
        title: 'Rare schatting',
        estimatedMinutes: 45,
        source: 'web',
      }),
    ).rejects.toThrow();
  });

  it('stores a WhatsApp message id once (idempotency)', async () => {
    const insert = () =>
      connection.db
        .insert(messages)
        .values({
          userId,
          direction: 'in',
          channel: 'whatsapp',
          waMessageId: 'wamid.duplicate',
          type: 'text',
          body: 'hoi',
        })
        .onConflictDoNothing({ target: messages.waMessageId })
        .returning({ id: messages.id });

    expect(await insert()).toHaveLength(1);
    expect(await insert()).toHaveLength(0);
  });

  it('stores timestamps in UTC', async () => {
    // Force a non-UTC session timezone: timestamptz must still round-trip the same instant.
    await connection.db.execute(sql`SET TIME ZONE 'Asia/Makassar'`);
    const [row] = await connection.db
      .insert(dailyFocus)
      .values({ userId, localDate: '2026-10-07', wrapupDoneAt: new Date('2026-10-07T08:00:00Z') })
      .returning();
    expect(row?.wrapupDoneAt?.toISOString()).toBe('2026-10-07T08:00:00.000Z');
  });
});

describe.skipIf(!adminUrl)('router with database deps (integration)', () => {
  const dbName = `hyperfocus_test_${randomBytes(4).toString('hex')}`;
  let connection: DbConnection;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    await runMigrations(url.toString());
    connection = connect(url.toString());
    await loadSeed(connection.db, example);
  });

  afterAll(async () => {
    await connection?.close();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('lists weekly-focus and high-priority tasks first, without micro-steps', async () => {
    const deps = createDbRouterDeps(connection.db);
    expect(await deps.findUserName(example.user.phoneE164)).toBe('Sam');
    const open = await deps.listOpenTasks(example.user.phoneE164, 3);
    expect(open.map((task) => task.title)).toEqual([
      'Offerte bakkerij afmaken',
      'Banner voor de feestdagen',
      'Onderwerpregels nieuwsbrief kiezen',
    ]);
  });
});
