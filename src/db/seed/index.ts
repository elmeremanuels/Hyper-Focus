import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEnv } from '../../config/env.js';
import { connect } from '../client.js';
import example from './example.js';
import { loadSeed } from './load.js';
import type { SeedData } from './types.js';

// Loads the fictional example data, plus your own data from eigen-data.local.ts if present.
async function main(): Promise<void> {
  const datasets: Array<{ label: string; data: SeedData }> = [{ label: 'example', data: example }];

  const localPath = fileURLToPath(new URL('./eigen-data.local.ts', import.meta.url));
  if (existsSync(localPath)) {
    const local = (await import(pathToFileURL(localPath).href)) as { default: SeedData };
    datasets.push({ label: 'eigen-data.local', data: local.default });
  }

  const connection = connect(getEnv().DATABASE_URL);
  try {
    for (const { label, data } of datasets) {
      const result = await loadSeed(connection.db, data);
      console.log(
        result.created
          ? `Seed ${label}: user ${result.userId} created`
          : `Seed ${label}: user ${result.userId} already exists, skipped`,
      );
    }
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
