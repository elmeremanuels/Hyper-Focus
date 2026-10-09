import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { businesses, users } from '../db/schema/index.js';

export interface UserProfile {
  id: number;
  name: string;
  timezone: string;
  businessName: string | null;
}

export async function getProfile(db: Database, userId: number): Promise<UserProfile | undefined> {
  const [row] = await db
    .select({ id: users.id, name: users.name, timezone: users.timezone, businessName: businesses.name })
    .from(users)
    .leftJoin(businesses, and(eq(businesses.userId, users.id), eq(businesses.isFocus, true)))
    .where(eq(users.id, userId));
  return row;
}
