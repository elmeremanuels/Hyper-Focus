import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { clients } from '../db/schema/index.js';

export async function listActiveClients(db: Database, userId: number) {
  return db
    .select({ id: clients.id, name: clients.name, notes: clients.notes })
    .from(clients)
    .where(and(eq(clients.userId, userId), eq(clients.status, 'active')))
    .orderBy(asc(clients.name));
}

/**
 * Case-insensitive match on the full name, then on a name that contains the text, then on
 * words ("de bakker" finds Bakkerij De Vries). Two equally good word matches give no match.
 */
export async function findClientByName(db: Database, userId: number, name: string) {
  const needle = normalize(name);
  if (!needle) return undefined;
  const all = await listActiveClients(db, userId);
  const exact =
    all.find((client) => normalize(client.name) === needle) ??
    all.find((client) => normalize(client.name).includes(needle) || needle.includes(normalize(client.name)));
  if (exact) return exact;

  const scored = all
    .map((client) => ({ client, score: wordScore(words(needle), words(normalize(client.name))) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  return best && best.score !== second?.score ? best.client : undefined;
}

function words(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
}

function wordScore(needle: string[], name: string[]): number {
  return needle.filter((word) => name.some((part) => part.startsWith(word) || word.startsWith(part))).length;
}

export async function appendClientNote(db: Database, userId: number, clientId: number, note: string) {
  const [client] = await db
    .select({ notes: clients.notes })
    .from(clients)
    .where(and(eq(clients.userId, userId), eq(clients.id, clientId)));
  if (!client) return;
  await db
    .update(clients)
    .set({ notes: client.notes ? `${client.notes}\n${note}` : note })
    .where(and(eq(clients.userId, userId), eq(clients.id, clientId)));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(de|het|een|bij)\s+/, '')
    .trim();
}
