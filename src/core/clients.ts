import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { clients } from '../db/schema/index.js';
import { bestWordMatch, normalizeName } from '../lib/match.js';

export async function listActiveClients(db: Database, userId: number) {
  return db
    .select({ id: clients.id, name: clients.name, contactName: clients.contactName, notes: clients.notes })
    .from(clients)
    .where(and(eq(clients.userId, userId), eq(clients.status, 'active')))
    .orderBy(asc(clients.name));
}

/**
 * Case-insensitive match on the full name, then on a name that contains the text, then on
 * words ("de bakker" finds Bakkerij De Vries). Two equally good word matches give no match.
 */
export async function findClientByName(db: Database, userId: number, name: string) {
  const needle = normalizeName(name);
  if (!needle) return undefined;
  const all = await listActiveClients(db, userId);
  const exact =
    all.find((client) => normalizeName(client.name) === needle) ??
    all.find((client) => normalizeName(client.name).includes(needle) || needle.includes(normalizeName(client.name)));
  return exact ?? bestWordMatch(needle, all, (client) => client.name);
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
