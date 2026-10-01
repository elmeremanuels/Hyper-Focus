import { eq } from 'drizzle-orm';
import type { ChannelUser } from '../channels/channel.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema/index.js';

export interface LinkableUser extends ChannelUser {
  telegramUserId: number | null;
  telegramLinkedAt: Date | null;
}

export interface UserStore {
  findById(id: number): Promise<LinkableUser | undefined>;
  findByTelegramUserId(telegramUserId: number): Promise<LinkableUser | undefined>;
  /** Case-insensitive. */
  findByEmail(email: string): Promise<LinkableUser | undefined>;
  linkTelegram(userId: number, telegramUserId: number, chatId: number, at: Date): Promise<void>;
}

const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  telegramChatId: users.telegramChatId,
  telegramUserId: users.telegramUserId,
  telegramLinkedAt: users.telegramLinkedAt,
  preferredChannel: users.preferredChannel,
};

export function createDbUserStore(db: Database): UserStore {
  return {
    async findById(id) {
      const [user] = await db.select(columns).from(users).where(eq(users.id, id));
      return user;
    },
    async findByTelegramUserId(telegramUserId) {
      const [user] = await db
        .select(columns)
        .from(users)
        .where(eq(users.telegramUserId, telegramUserId));
      return user;
    },
    async findByEmail(email) {
      const [user] = await db
        .select(columns)
        .from(users)
        .where(eq(users.email, email.toLowerCase()));
      return user;
    },
    async linkTelegram(userId, telegramUserId, chatId, at) {
      await db
        .update(users)
        .set({ telegramUserId, telegramChatId: chatId, telegramLinkedAt: at })
        .where(eq(users.id, userId));
    },
  };
}
