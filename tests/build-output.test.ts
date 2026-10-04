import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import site from '../site/vite.config.js';
import web from '../web/vite.config.js';

// tsc compiles src/ to dist/; a Vite build that empties its outDir must never land on a folder
// that holds compiled server code (dist/web once wiped src/web on every build).
describe('build output folders', () => {
  for (const [name, config] of [['dashboard', web], ['site', site]] as const) {
    it(`${name} builds to a folder of its own`, () => {
      const outDir = config.build?.outDir ?? '';
      const inDist = relative(resolve('dist'), outDir);
      expect(inDist.startsWith('..')).toBe(false);
      expect(existsSync(resolve('src', inDist))).toBe(false);
    });
  }
});
