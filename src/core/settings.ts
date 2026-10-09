import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { userSettings } from '../db/schema/index.js';

export type UserSettingsRow = typeof userSettings.$inferSelect;

export async function getSettings(db: Database, userId: number): Promise<UserSettingsRow> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (row) return row;
  const [created] = await db.insert(userSettings).values({ userId }).returning();
  if (!created) throw new Error('Failed to create user settings');
  return created;
}

/** Settings a user may change by message (BOUWPLAN.md, 10.2 update_settings). */
export interface SettingsPatch {
  morningTime?: string;
  middayEnabled?: boolean;
  wrapupTime?: string;
  weeklyReviewDay?: number;
  weeklyReviewTime?: string;
  quietStart?: string;
  quietEnd?: string;
  maxProactivePerDay?: number;
  sessionMinutes?: number;
  engineTime?: string;
  engineFrequency?: 'every_other_day' | 'daily' | 'twice_weekly';
}

export async function updateSettings(db: Database, userId: number, patch: SettingsPatch) {
  await getSettings(db, userId);
  if (Object.keys(patch).length === 0) return;
  await db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
}

export async function setPausedUntil(db: Database, userId: number, until: Date | null) {
  await getSettings(db, userId);
  await db.update(userSettings).set({ pausedUntil: until }).where(eq(userSettings.userId, userId));
}
