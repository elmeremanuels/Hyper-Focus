import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbConnection {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function connect(databaseUrl: string | undefined): DbConnection {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
