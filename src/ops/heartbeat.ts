// The worker's heartbeat (verbeterplan P0.2): it writes the time every tick; /health of the web
// process answers 503 when the file is older than five minutes.
import { readFile, writeFile } from 'node:fs/promises';

export const HEARTBEAT_MAX_AGE_MS = 5 * 60_000;

export async function writeHeartbeat(file: string, now: Date): Promise<void> {
  await writeFile(file, now.toISOString());
}

/** Milliseconds since the last beat, or undefined when there is none. */
export async function heartbeatAge(file: string, now: Date): Promise<number | undefined> {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  const at = text ? Date.parse(text.trim()) : Number.NaN;
  return Number.isNaN(at) ? undefined : now.getTime() - at;
}
