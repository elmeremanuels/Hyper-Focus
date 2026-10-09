// Loads the Dutch prompts from src/ai/prompts (copied to dist/ai/prompts by the build).
import { readFileSync } from 'node:fs';

const cache = new Map<string, string>();

export type PromptName = 'systeem' | 'router' | 'opknippen' | 'braindump' | 'post-herschrijven' | 'posts-plannen';

export function loadPrompt(name: PromptName): string {
  let prompt = cache.get(name);
  if (prompt === undefined) {
    prompt = readFileSync(new URL(`./prompts/${name}.nl.md`, import.meta.url), 'utf8').trim();
    cache.set(name, prompt);
  }
  return prompt;
}

/** Replaces {placeholders}; unknown placeholders stay as they are. */
export function fillPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => values[key] ?? match);
}
