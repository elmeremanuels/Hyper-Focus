// A throwaway database per test file, created from TEST_DATABASE_URL (a role with CREATEDB).
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { connect, type DbConnection } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import example from '../../src/db/seed/example.js';
import { loadSeed } from '../../src/db/seed/load.js';

export const adminUrl = process.env.TEST_DATABASE_URL;
/** Creating and dropping a database can be slow while other test files run. */
const HOOK_TIMEOUT_MS = 30_000;

export interface TestDatabase {
  connection: DbConnection;
  /** The example user (Sam). */
  userId: number;
  url: string;
}

/** Registers beforeAll/afterAll hooks; read the fields inside tests. */
export function useTestDatabase(): TestDatabase {
  const dbName = `hyperfocus_test_${randomBytes(4).toString('hex')}`;
  const state = {} as TestDatabase;

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
    const url = new URL(adminUrl ?? '');
    url.pathname = `/${dbName}`;
    state.url = url.toString();
    await runMigrations(state.url);
    state.connection = connect(state.url);
    state.userId = (await loadSeed(state.connection.db, example)).userId;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await state.connection?.close();
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  }, HOOK_TIMEOUT_MS);

  return state;
}
