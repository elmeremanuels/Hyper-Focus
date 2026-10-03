// Tone rules (step 1.12): no medical claims in anything the bot says, no emoji in the text files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
  });
}

const FORBIDDEN = /symptom|behandel|genees|genezen|therapie|dopamine/i;

describe('tone of the bot texts', () => {
  it('never uses symptomen, behandelen, genezen, therapie or dopamine', () => {
    const hits = files('src', /\.(ts|md)$/).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, i) => ({ path, line: i + 1, text: line }))
        .filter((l) => FORBIDDEN.test(l.text)),
    );
    expect(hits).toEqual([]);
  });

  it('keeps emoji out of the text files', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const hits = files('src/texts', /\.ts$/).filter((path) => emoji.test(readFileSync(path, 'utf8')));
    expect(hits).toEqual([]);
  });
});
