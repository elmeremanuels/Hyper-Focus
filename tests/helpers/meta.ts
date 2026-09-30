import { readFileSync } from 'node:fs';

/** Loads a recorded Meta webhook payload from tests/fixtures/meta. */
export function metaFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/meta/${name}.json`, import.meta.url), 'utf8'));
}
