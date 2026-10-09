// Content module on the client card (step C1): free profile fields, the socials switch, the
// Buffer key per client and up to three channels with their rhythm.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { bufferForKey, contentEnabled, MAX_CHANNELS } from '../../content/posts.js';
import { clientChannels, clients } from '../../db/schema/index.js';
import { BufferClient, BufferError } from '../../integrations/buffer/client.js';
import { encryptToken } from '../../lib/crypto.js';
import { handle, userContext, type DashboardRoutesConfig } from './common.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const field = z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().max(2000) });
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('https://'), 'https');

const contentPatch = z
  .object({
    profile: z.array(field).max(30),
    socialsEnabled: z.boolean(),
    photoFolderUrl: httpsUrl.nullable(),
    memesAllowed: z.boolean(),
  })
  .partial();
const keyInput = z.object({ apiKey: z.string().trim().min(10).max(500) });
const channelsInput = z.object({
  channels: z
    .array(z.object({ bufferChannelId: z.string().min(1).max(100), days: z.array(z.number().int().min(1).max(7)).max(7), time }))
    .max(MAX_CHANNELS),
});

const off = { error: 'De contentmodule staat uit' };
const noKey = { error: 'Koppel eerst Buffer met een API-sleutel' };
const noEncryption = { error: 'Versleuteling staat niet aan op de server' };

export function contentRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();
  const content = config.content;

  /** The client, only when the module is on. */
  async function ownClient(userId: number, clientId: number) {
    if (!Number.isInteger(clientId)) return undefined;
    const [row] = await config.db
      .select({ id: clients.id, key: clients.bufferApiKeyEnc })
      .from(clients)
      .where(and(eq(clients.userId, userId), eq(clients.id, clientId)));
    return row;
  }

  router.patch(
    '/api/clients/:id/content',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      if (!(await contentEnabled(db, userId))) return void res.status(409).json(off);
      const client = await ownClient(userId, Number(req.params.id));
      if (!client) return void res.status(404).json({ error: 'Klant niet gevonden' });
      const patch = contentPatch.parse(req.body);
      const profile = patch.profile?.filter((f) => f.value.length > 0);
      const set = { ...patch, ...(profile && { profile }) };
      if (Object.keys(set).length) await db.update(clients).set(set).where(eq(clients.id, client.id));
      res.json({ ok: true });
    }),
  );

  // The key is checked against Buffer before it is stored; the answer lists the channels.
  router.put(
    '/api/clients/:id/buffer',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      if (!(await contentEnabled(db, userId))) return void res.status(409).json(off);
      if (!content?.encryptionKey) return void res.status(409).json(noEncryption);
      const client = await ownClient(userId, Number(req.params.id));
      if (!client) return void res.status(404).json({ error: 'Klant niet gevonden' });
      const { apiKey } = keyInput.parse(req.body);
      const buffer = (content.buffer ?? ((k: string) => new BufferClient(k)))(apiKey);
      try {
        const available = await buffer.listChannels();
        await db.update(clients).set({ bufferApiKeyEnc: encryptToken(apiKey, content.encryptionKey) }).where(eq(clients.id, client.id));
        res.json({ available });
      } catch (error) {
        if (error instanceof BufferError) return void res.status(400).json({ error: error.kind === 'auth' ? 'Buffer herkent deze sleutel niet' : error.message });
        throw error;
      }
    }),
  );

  router.delete(
    '/api/clients/:id/buffer',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const client = await ownClient(userId, Number(req.params.id));
      if (!client) return void res.status(404).json({ error: 'Klant niet gevonden' });
      await db.delete(clientChannels).where(and(eq(clientChannels.userId, userId), eq(clientChannels.clientId, client.id)));
      await db.update(clients).set({ bufferApiKeyEnc: null }).where(eq(clients.id, client.id));
      res.json({ ok: true });
    }),
  );

  router.get(
    '/api/clients/:id/buffer/channels',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      if (!(await contentEnabled(db, userId))) return void res.status(409).json(off);
      const client = await ownClient(userId, Number(req.params.id));
      if (!client) return void res.status(404).json({ error: 'Klant niet gevonden' });
      const buffer = bufferForKey(content, client.key);
      if (!buffer) return void res.status(409).json(noKey);
      try {
        res.set('Cache-Control', 'no-store').json({ available: await buffer.listChannels() });
      } catch (error) {
        if (error instanceof BufferError) return void res.status(502).json({ error: error.message });
        throw error;
      }
    }),
  );

  // Replaces the chosen channels; names and services come from Buffer, never from the browser.
  router.put(
    '/api/clients/:id/channels',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      if (!(await contentEnabled(db, userId))) return void res.status(409).json(off);
      const client = await ownClient(userId, Number(req.params.id));
      if (!client) return void res.status(404).json({ error: 'Klant niet gevonden' });
      const buffer = bufferForKey(content, client.key);
      if (!buffer) return void res.status(409).json(noKey);
      const { channels } = channelsInput.parse(req.body);
      const ids = new Set(channels.map((c) => c.bufferChannelId));
      if (ids.size !== channels.length) return void res.status(400).json({ error: 'Elk kanaal één keer' });
      let available;
      try {
        available = await buffer.listChannels();
      } catch (error) {
        if (error instanceof BufferError) return void res.status(502).json({ error: error.message });
        throw error;
      }
      const unknown = channels.find((c) => !available.some((a) => a.id === c.bufferChannelId));
      if (unknown) return void res.status(400).json({ error: 'Dit kanaal staat niet in Buffer' });

      const where = and(eq(clientChannels.userId, userId), eq(clientChannels.clientId, client.id));
      const current = await db.select().from(clientChannels).where(where);
      const gone = current.filter((c) => !ids.has(c.bufferChannelId)).map((c) => c.id);
      if (gone.length) await db.delete(clientChannels).where(and(where, inArray(clientChannels.id, gone)));
      for (const choice of channels) {
        const info = available.find((a) => a.id === choice.bufferChannelId);
        if (!info) continue;
        const days = [...new Set(choice.days)].sort((a, b) => a - b);
        await db
          .insert(clientChannels)
          .values({ userId, clientId: client.id, bufferChannelId: info.id, service: info.service, name: info.name, days, postTime: choice.time })
          .onConflictDoUpdate({ target: [clientChannels.clientId, clientChannels.bufferChannelId], set: { service: info.service, name: info.name, days, postTime: choice.time } });
      }
      res.json({ ok: true });
    }),
  );

  return router;
}

/** The content part of a client in /api/projects. */
export async function clientContent(config: Pick<DashboardRoutesConfig, 'db'>, userId: number, clientIds: number[]) {
  if (clientIds.length === 0) return new Map<number, ClientContent>();
  const rows = await config.db
    .select({ id: clients.id, profile: clients.profile, socialsEnabled: clients.socialsEnabled, key: clients.bufferApiKeyEnc, photoFolderUrl: clients.photoFolderUrl, memesAllowed: clients.memesAllowed })
    .from(clients)
    .where(and(eq(clients.userId, userId), inArray(clients.id, clientIds)));
  const channels = await config.db
    .select()
    .from(clientChannels)
    .where(and(eq(clientChannels.userId, userId), inArray(clientChannels.clientId, clientIds)))
    .orderBy(asc(clientChannels.id));
  return new Map(
    rows.map((r): [number, ClientContent] => [
      r.id,
      {
        profile: r.profile,
        socialsEnabled: r.socialsEnabled,
        bufferConnected: r.key !== null,
        photoFolderUrl: r.photoFolderUrl,
        memesAllowed: r.memesAllowed,
        channels: channels
          .filter((c) => c.clientId === r.id)
          .map((c) => ({ bufferChannelId: c.bufferChannelId, name: c.name, service: c.service, days: c.days, time: c.postTime.slice(0, 5) })),
      },
    ]),
  );
}

export interface ClientContent {
  profile: Array<{ label: string; value: string }>;
  socialsEnabled: boolean;
  bufferConnected: boolean;
  photoFolderUrl: string | null;
  memesAllowed: boolean;
  channels: Array<{ bufferChannelId: string; name: string; service: string; days: number[]; time: string }>;
}
