import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getEnv } from '../config/env.js';
import { connect } from './client.js';

export const MIGRATIONS_FOLDER = 'drizzle';

export async function runMigrations(databaseUrl: string | undefined): Promise<void> {
  const connection = connect(databaseUrl);
  try {
    await migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await connection.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations(getEnv().DATABASE_URL)
    .then(() => console.log('Migrations applied'))
    .catch((error: unknown) => {
      console.error('Migration failed:', error);
      process.exitCode = 1;
    });
}
