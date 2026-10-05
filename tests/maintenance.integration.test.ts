import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activeBlock } from '../src/conversation/blocks.js';
import { events, focusBlocks, loginTokens, messages, users } from '../src/db/schema/index.js';
import { localTime } from '../src/focus/windows.js';
import { runMaintenance } from '../src/proactive/maintenance.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const NOW = new Date('2026-10-07T06:00:00Z'); // 14:00 in Makassar
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe.skipIf(!adminUrl)('hourly upkeep (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;

  it('ignores and then closes a block left open for more than 12 hours', async () => {
    const [stale] = await db()
      .insert(focusBlocks)
      .values({ userId: t.userId, plannedMinutes: 25, startedAt: ago(13), endsAt: ago(12.5) })
      .returning({ id: focusBlocks.id });
    // "Blok loopt tot 01:48" during the day: such a block no longer counts as running.
    expect(await activeBlock(db(), t.userId, NOW)).toBeUndefined();

    const result = await runMaintenance(db(), NOW);
    expect(result.expiredBlocks).toBe(1);
    const [row] = await db().select().from(focusBlocks).where(eq(focusBlocks.id, stale!.id));
    expect(row).toMatchObject({ outcome: 'expired', endedAt: ago(12.5) });
  });

  it('shows a running block in the user’s own time zone (Asia/Makassar)', async () => {
    await db().update(users).set({ timezone: 'Asia/Makassar' }).where(eq(users.id, t.userId));
    await db().insert(focusBlocks).values({ userId: t.userId, plannedMinutes: 25, startedAt: ago(0.25), endsAt: new Date(NOW.getTime() + 10 * 60_000) });
    const running = await activeBlock(db(), t.userId, NOW);
    expect(running?.phase).toBe('block');
    expect(localTime('Asia/Makassar', running!.block.endsAt)).toBe('14:10');
    expect((await runMaintenance(db(), NOW)).expiredBlocks).toBe(0);
  });

  it('keeps the retention promises: messages 30 days, metadata 12 months, old login links', async () => {
    const message = (createdAt: Date) => ({ userId: t.userId, direction: 'in' as const, channel: 'telegram' as const, type: 'text' as const, body: 'hoi', createdAt });
    await db().insert(messages).values([message(ago(31 * 24)), message(ago(29 * 24))]);
    await db().insert(events).values([
      { userId: t.userId, name: 'login', props: {}, createdAt: ago(366 * 24) },
      { userId: t.userId, name: 'login', props: {}, createdAt: ago(24) },
    ]);
    await db().insert(loginTokens).values({ userId: t.userId, tokenHash: 'x'.repeat(64), channel: 'email', expiresAt: ago(48) });

    const result = await runMaintenance(db(), NOW);
    expect(result).toMatchObject({ messages: 1, metadata: 1, logins: 1 });
    expect(await db().select().from(messages).where(eq(messages.userId, t.userId))).toHaveLength(1);
  });
});
