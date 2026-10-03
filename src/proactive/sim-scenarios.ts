// Scripted user behaviour for sim:day (npm run sim:day -- --scenario …).
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { focusBlocks, tasks } from '../db/schema/index.js';
import type { SimulatedAction } from './simulate.js';

type Ctx = { db: Database; userId: number; now: Date };

async function firstOpenTask({ db, userId }: Ctx): Promise<number | undefined> {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.parentTaskId), inArray(tasks.status, ['open', 'in_progress'])))
    .orderBy(asc(tasks.id))
    .limit(1);
  return task?.id;
}

async function lastBlock({ db, userId }: Ctx) {
  const [block] = await db.select().from(focusBlocks).where(eq(focusBlocks.userId, userId)).orderBy(desc(focusBlocks.id)).limit(1);
  return block;
}

const tap = (userId: number, buttonId: string, title: string) => ({ kind: 'button' as const, userId, buttonId, title });

/** Step 1.9: two blocks in a row, an on-time return after the first and a late return after the second. */
export function blocksScenario(day = 0): SimulatedAction[] {
  return [
    { day, time: '10:00', message: async (ctx) => { const id = await firstOpenTask(ctx); return id ? tap(ctx.userId, `t:${id}:start`, 'Start') : undefined; } },
    { day, time: '10:00', message: async (ctx) => { const id = await firstOpenTask(ctx); return id ? tap(ctx.userId, `blk:t${id}:m25`, '25 min') : undefined; } },
    // 10:25 the block end arrives (with sound).
    { day, time: '10:30', message: async (ctx) => { const b = await lastBlock(ctx); return b ? tap(ctx.userId, `blk:${b.id}:done`, 'Afgerond') : undefined; } },
    { day, time: '10:30', message: async (ctx) => { const b = await lastBlock(ctx); return b ? tap(ctx.userId, `blk:${b.id}:back`, 'Ik ben terug') : undefined; } },
    { day, time: '10:30', message: async (ctx) => { const b = await lastBlock(ctx); return b?.taskId ? tap(ctx.userId, `blk:t${b.taskId}:next`, 'Volgende blok starten') : undefined; } },
    // 10:45 the second block end.
    { day, time: '10:50', message: async (ctx) => { const b = await lastBlock(ctx); return b ? tap(ctx.userId, `blk:${b.id}:done`, 'Afgerond') : undefined; } },
    // The pause runs out around 10:53: one reminder with sound. Back at 11:00, late.
    { day, time: '11:00', message: async (ctx) => ({ kind: 'text', userId: ctx.userId, text: 'ben terug' }) },
  ];
}

export const SCENARIOS: Record<string, () => SimulatedAction[]> = {
  blocks: () => blocksScenario(0),
};
