import { readFileSync } from 'node:fs';

/** Loads a recorded webhook payload from tests/fixtures/{kind}/{name}.json. */
export function fixture<T = unknown>(kind: 'telegram' | 'mail', name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${kind}/${name}.json`, import.meta.url), 'utf8'),
  ) as T;
}
