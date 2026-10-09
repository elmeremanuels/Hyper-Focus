// Shared channel interface (BOUWPLAN.md, 9): the proactive and conversation layers
// call send(user, message) without knowing which channel delivers it.
import type { OutboundMessage } from '../conversation/types.js';

export type ChannelName = 'telegram' | 'email';

export interface ChannelUser {
  id: number;
  name: string;
  email: string | null;
  telegramChatId: number | null;
  preferredChannel: ChannelName;
}

export interface SendContext {
  /** Telegram: deliver without sound (during a work block or pause, step 1.9). Mail ignores it. */
  silent?: boolean;
  /** Mail: subject line. */
  subject?: string;
  /** Mail: Message-ID of the mail this answers, for threading. */
  inReplyTo?: string;
}

export interface Channel {
  readonly name: ChannelName;
  /** Throws ChannelUnavailableError when this channel cannot reach the user. */
  send(user: ChannelUser, message: OutboundMessage, context?: SendContext): Promise<void>;
}

export class ChannelUnavailableError extends Error {
  constructor(
    readonly channel: ChannelName,
    reason: string,
  ) {
    super(`${channel} unavailable: ${reason}`);
    this.name = 'ChannelUnavailableError';
  }
}

export interface Delivery {
  /**
   * Sends through `via` (defaults to the user's preferred channel). When Telegram cannot
   * reach the user, the same message goes by mail (BOUWPLAN.md, 9, fallback row).
   */
  send(
    user: ChannelUser,
    message: OutboundMessage,
    options?: { via?: ChannelName; context?: SendContext },
  ): Promise<ChannelName>;
}

export function createDelivery(
  channels: Partial<Record<ChannelName, Channel>>,
  log: Pick<Console, 'warn'> = console,
): Delivery {
  return {
    async send(user, message, options = {}) {
      const first = options.via ?? user.preferredChannel;
      const order: ChannelName[] = first === 'telegram' ? ['telegram', 'email'] : ['email'];

      let lastError: unknown;
      for (const name of order) {
        const channel = channels[name];
        if (!channel) continue;
        try {
          await channel.send(user, message, options.context);
          return name;
        } catch (error) {
          if (!(error instanceof ChannelUnavailableError)) throw error;
          log.warn(`Delivery to user ${user.id} via ${name} failed: ${error.message}`);
          lastError = error;
        }
      }
      throw lastError ?? new Error(`No channel available for user ${user.id}`);
    },
  };
}
