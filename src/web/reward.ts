// The reward minute (step 1.9): /app/beloning, a Telegram mini-app with one round of
// exactly 60 seconds. The clock runs on the server, so reloading gives no extra time.
import express, { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { focusBlocks, users } from '../db/schema/index.js';
import { validateInitData } from '../channels/telegram/webapp.js';
import { hashToken } from '../conversation/blocks.js';
import { localDate } from '../lib/time.js';
import { BLOCK_TEXTS } from '../texts/werkblokken.nl.js';
import { rewardPage } from './reward-page.js';

export const REWARD_SECONDS = 60;

export interface RewardRouteConfig {
  db: Database;
  /** TELEGRAM_BOT_TOKEN, to validate initData from the mini-app. */
  botToken: string | undefined;
  now?: () => Date;
}

type Result = { status: number; body: Record<string, unknown> };

export function createRewardRouter(config: RewardRouteConfig): Router {
  const router = Router();
  const now = config.now ?? (() => new Date());
  const json = express.json({ limit: '8kb' });

  router.get('/app/beloning', (_req, res) => {
    res.status(200).type('html').set('Cache-Control', 'no-store').send(rewardPage(BLOCK_TEXTS.miniAppEnd));
  });

  /** Finds the block for a token and checks owner and day. */
  async function authorize(body: unknown, at: Date): Promise<Result | { block: typeof focusBlocks.$inferSelect; garden: number }> {
    const { token, initData } = (body ?? {}) as { token?: unknown; initData?: unknown };
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return { status: 400, body: { error: 'token' } };
    const [block] = await config.db.select().from(focusBlocks).where(eq(focusBlocks.rewardTokenHash, hashToken(token)));
    if (!block) return { status: 404, body: { error: 'unknown' } };
    const [user] = await config.db
      .select({ timezone: users.timezone, telegramUserId: users.telegramUserId, garden: users.gardenGrowth })
      .from(users)
      .where(eq(users.id, block.userId));
    if (!user) return { status: 404, body: { error: 'unknown' } };

    // Inside Telegram the initData must be valid and belong to the owner. A mail link has none.
    if (typeof initData === 'string' && initData.length > 0) {
      const webApp = config.botToken ? validateInitData(initData, config.botToken, at) : undefined;
      if (!webApp || webApp.telegramUserId !== user.telegramUserId) return { status: 403, body: { error: 'forbidden' } };
    }
    // The minute expires at the end of the user's day.
    if (localDate(user.timezone, block.startedAt) !== localDate(user.timezone, at)) return { status: 410, body: { error: 'expired', garden: user.garden } };
    return { block, garden: user.garden };
  }

  router.post('/app/beloning/start', json, async (req, res, next) => {
    try {
      const at = now();
      const found = await authorize(req.body, at);
      if ('status' in found) return void res.status(found.status).json(found.body);
      const { block, garden } = found;
      if (block.rewardFinishedAt) return void res.json({ remaining: 0, finished: true, garden });
      const opened = block.rewardOpenedAt ?? at;
      if (!block.rewardOpenedAt) {
        await config.db
          .update(focusBlocks)
          .set({ rewardOpenedAt: at })
          .where(and(eq(focusBlocks.id, block.id), eq(focusBlocks.userId, block.userId)));
      }
      const remaining = Math.max(0, Math.ceil(REWARD_SECONDS - (at.getTime() - opened.getTime()) / 1000));
      if (remaining === 0) await config.db.update(focusBlocks).set({ rewardFinishedAt: at }).where(eq(focusBlocks.id, block.id));
      res.json({ remaining, finished: remaining === 0, garden });
    } catch (error) {
      next(error);
    }
  });

  router.post('/app/beloning/finish', json, async (req, res, next) => {
    try {
      const at = now();
      const found = await authorize(req.body, at);
      if ('status' in found) return void res.status(found.status).json(found.body);
      const { block, garden } = found;
      if (!block.rewardFinishedAt && block.rewardOpenedAt) {
        await config.db.update(focusBlocks).set({ rewardFinishedAt: at }).where(eq(focusBlocks.id, block.id));
      }
      res.json({ finished: true, garden });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
