// Name matching by words: "de bakker" or "Call Bakkerij De Vries" finds Bakkerij De Vries.

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(de|het|een|bij)\s+/, '')
    .trim();
}

function words(value: string): string[] {
  return normalizeName(value)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
}

/** Words of `text` that start or extend a word of `name` (bakker ↔ bakkerij). */
export function wordScore(text: string, name: string): number {
  const nameWords = words(name);
  return words(text).filter((word) => nameWords.some((part) => part.startsWith(word) || word.startsWith(part))).length;
}

/** The best match by word score; two equally good matches give none. */
export function bestWordMatch<T>(text: string, candidates: T[], nameOf: (candidate: T) => string): T | undefined {
  const scored = candidates
    .map((candidate) => ({ candidate, score: wordScore(text, nameOf(candidate)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  return best && best.score !== second?.score ? best.candidate : undefined;
}
