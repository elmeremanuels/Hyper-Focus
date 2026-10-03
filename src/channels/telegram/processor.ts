// Handles a verified Telegram update (BOUWPLAN.md, 9.2): allow-list, linking via /start,
// idempotency, removing tapped keyboards, routing and replies.
import type { MessageStore, StoredMessageType } from '../../core/messages.js';
import type { LinkableUser, UserStore } from '../../core/users.js';
import type { Router } from '../../conversation/router.js';
import type { InboundMessage, OutboundMessage } from '../../conversation/types.js';
import { mask } from '../../lib/secrets.js';
import type { Delivery } from '../channel.js';
import type { TelegramClient } from './client.js';
import { verifyLinkCode } from './link.js';
import { parseUpdate, type TelegramUpdate } from './updates.js';

export interface TelegramProcessorDeps {
  client: TelegramClient;
  users: UserStore;
  messages: MessageStore;
  delivery: Delivery;
  router: Router;
  /** True during a work block or pause: replies go out without sound (step 1.9). */
  isQuiet?: (userId: number) => Promise<boolean>;
  allowedUserIds: readonly number[];
  linkSecret: string | undefined;
  /** Without a configured transcriber, voice messages get a short reply. */
  transcriber?: VoiceTranscriber | undefined;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export interface VoiceTranscriber {
  isConfigured(): boolean;
  transcribe(audio: Buffer, filename: string, mimeType: string): Promise<string>;
}

/** Longer voice messages are not transcribed (cost and the 8-second target). */
export const MAX_VOICE_SECONDS = 300;

export type TelegramOutcome = 'processed' | 'duplicate' | 'ignored' | 'linked';

export const TEXTS = {
  closed: 'Deze bot is nog besloten.',
  notLinked: 'Je Telegram is nog niet gekoppeld. Open de koppellink die je kreeg.',
  linkInvalid: 'Deze koppellink is verlopen of al gebruikt. Vraag een nieuwe aan.',
  linkTaken: 'Dit Telegram-account is al aan een ander account gekoppeld.',
  linked: 'Gekoppeld. Vanaf nu stuur ik je berichten hier. Zal ik je focus voor vandaag laten zien?',
  voice: 'Spraakberichten lees ik nu niet. Wil je het typen?',
  voiceTooLong: 'Dat spraakbericht is langer dan 5 minuten. Stuur je het in kortere stukken?',
  voiceFailed: 'Dat spraakbericht kon ik niet verstaan. Probeer het nog eens of typ het.',
  unsupported: 'Dit soort bericht lees ik nog niet. Stuur tekst of tik op een knop.',
} as const;

// Bot commands map to the same words a user could type (BOUWPLAN.md, 9.1).
const COMMAND_TEXT: Record<string, string> = {
  start: 'hoi',
  vandaag: 'vandaag',
  pauze: 'pauze',
  parkeerplaats: 'parkeerplaats',
  weekreview: 'weekreview',
  help: 'help',
};

/** The command menu in Telegram, set by `npm run telegram:webhook`. */
export const BOT_COMMANDS: ReadonlyArray<{ command: string; description: string }> = [
  { command: 'vandaag', description: 'Je focus voor vandaag' },
  { command: 'parkeerplaats', description: 'Geparkeerde taken' },
  { command: 'weekreview', description: 'De weekreview in drie tikken' },
  { command: 'pauze', description: 'Berichten even stilzetten' },
  { command: 'help', description: 'Wat ik kan' },
];

export function createTelegramProcessor(deps: TelegramProcessorDeps) {
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  const allowed = new Set(deps.allowedUserIds);

  return async function processUpdate(body: unknown): Promise<TelegramOutcome> {
    const update = parseUpdate(body);
    if (!update) return 'ignored';

    if (update.content.kind === 'button') {
      // Answer within seconds so the client stops its spinner.
      const { callbackQueryId } = update.content;
      await quietly(() => deps.client.answerCallbackQuery(callbackQueryId));
    }

    if (!allowed.has(update.fromUserId)) {
      log.warn(`Ignored Telegram update from unknown user ${mask(update.fromUserId)}`);
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.closed));
      return 'ignored';
    }

    if (update.content.kind === 'command' && update.content.command === 'start' && update.content.argument) {
      return link(update, update.content.argument);
    }

    const user = await deps.users.findByTelegramUserId(update.fromUserId);
    if (!user) {
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.notLinked));
      return 'ignored';
    }

    // A tapped button counts once per message: retries and double taps share this id.
    const externalId =
      update.content.kind === 'button'
        ? `cb:${update.chatId}:${update.messageId}`
        : `u:${update.updateId}`;
    const isNew = await deps.messages.recordInbound({
      userId: user.id,
      channel: 'telegram',
      externalId,
      type: storedType(update),
      body: bodyOf(update),
    });

    if (update.content.kind === 'button') {
      await quietly(() => deps.client.removeKeyboard(update.chatId, update.messageId));
    }
    if (!isNew) return 'duplicate';

    await deps.messages.touchLastInbound(user.id, update.sentAt);
    await deps.messages.recordEvent(user.id, 'inbound_message', {
      channel: 'telegram',
      type: update.content.kind,
    });

    // Decided before routing: a tap that ends the pause is still answered quietly.
    const silent = deps.isQuiet ? await deps.isQuiet(user.id).catch(() => false) : false;
    for (const reply of await route(update, user, externalId)) {
      await deps.delivery.send(withChat(user, update.chatId), reply, { via: 'telegram', context: { silent } });
    }
    return 'processed';
  };

  async function link(update: TelegramUpdate, code: string): Promise<TelegramOutcome> {
    const verified = deps.linkSecret ? verifyLinkCode(code, deps.linkSecret, now()) : undefined;
    const user = verified ? await deps.users.findById(verified.userId) : undefined;

    if (!verified || !user || (user.telegramLinkedAt && user.telegramLinkedAt >= verified.issuedAt)) {
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.linkInvalid));
      return 'ignored';
    }

    const owner = await deps.users.findByTelegramUserId(update.fromUserId);
    if (owner && owner.id !== user.id) {
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.linkTaken));
      return 'ignored';
    }

    const linkedAt = now();
    await deps.users.linkTelegram(user.id, update.fromUserId, update.chatId, linkedAt);
    await deps.messages.recordInbound({
      userId: user.id,
      channel: 'telegram',
      externalId: `u:${update.updateId}`,
      type: 'text',
      body: '/start',
    });
    await deps.messages.touchLastInbound(user.id, update.sentAt);
    log.info(`Linked Telegram user ${mask(update.fromUserId)} to user ${user.id}`);

    const linkedUser = { ...user, telegramChatId: update.chatId };
    await deps.delivery.send(linkedUser, { text: TEXTS.linked, buttons: [{ id: 'f:show', title: 'Laat zien' }] }, { via: 'telegram' });
    // Then, once, when the user works best (step 1.12) and which tools they use (step 1.10).
    try {
      const [pref] = await deps.router({ kind: 'button', userId: user.id, buttonId: 'fp:ask', title: 'Mijn ritme', source: 'telegram' });
      if (pref) await deps.delivery.send(linkedUser, pref, { via: 'telegram' });
      const [week] = await deps.router({ kind: 'button', userId: user.id, buttonId: 'ww:ask', title: 'Mijn werkweek', source: 'telegram' });
      if (week) await deps.delivery.send(linkedUser, week, { via: 'telegram' });
    } catch (error) {
      log.error('Asking the focus preference failed:', error);
    }
    try {
      const questions = await deps.router({ kind: 'button', userId: user.id, buttonId: 'tl:start', title: 'Tools instellen', source: 'telegram' });
      for (const reply of questions) await deps.delivery.send(linkedUser, reply, { via: 'telegram' });
    } catch (error) {
      log.error('Starting the tool questions failed:', error);
    }
    return 'linked';
  }

  async function route(update: TelegramUpdate, user: LinkableUser, externalId: string): Promise<OutboundMessage[]> {
    const { content } = update;
    let inbound: InboundMessage;
    switch (content.kind) {
      case 'text':
        inbound = { kind: 'text', userId: user.id, text: content.text, source: 'telegram' };
        break;
      case 'command':
        inbound = {
          kind: 'text',
          userId: user.id,
          text: COMMAND_TEXT[content.command] ?? content.command,
          source: 'telegram',
        };
        break;
      case 'button':
        inbound = {
          kind: 'button',
          userId: user.id,
          buttonId: content.buttonId,
          title: content.title,
          source: 'telegram',
        };
        break;
      case 'voice': {
        const text = await transcribe(update, content.fileId, content.durationSeconds, externalId);
        if (typeof text !== 'string') return [text];
        inbound = { kind: 'text', userId: user.id, text, source: 'voice' };
        break;
      }
      case 'unsupported':
        return [{ text: TEXTS.unsupported }];
    }
    return deps.router(inbound);
  }

  /** Downloads, transcribes and stores the transcript; the audio only lives in memory. */
  async function transcribe(
    update: TelegramUpdate,
    fileId: string,
    seconds: number,
    externalId: string,
  ): Promise<string | OutboundMessage> {
    if (!deps.transcriber?.isConfigured()) return { text: TEXTS.voice };
    if (seconds > MAX_VOICE_SECONDS) return { text: TEXTS.voiceTooLong };
    await quietly(() => deps.client.sendChatAction(update.chatId));
    try {
      // The audio stays in this buffer only; it is never stored (BOUWPLAN.md, 14).
      const audio = await deps.client.downloadFile(fileId);
      const text = (await deps.transcriber.transcribe(audio, 'voice.ogg', 'audio/ogg')).trim();
      if (!text) return { text: TEXTS.voiceFailed };
      await deps.messages.setTranscript('telegram', externalId, text);
      return text;
    } catch (error) {
      log.error('Voice transcription failed:', error);
      return { text: TEXTS.voiceFailed };
    }
  }

  async function quietly(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      log.error('Telegram call failed:', error);
    }
  }
}

function withChat(user: LinkableUser, chatId: number): LinkableUser {
  return user.telegramChatId === chatId ? user : { ...user, telegramChatId: chatId };
}

function storedType(update: TelegramUpdate): StoredMessageType {
  switch (update.content.kind) {
    case 'button':
      return 'button';
    case 'voice':
      return 'audio';
    default:
      return 'text';
  }
}

function bodyOf(update: TelegramUpdate): string | null {
  switch (update.content.kind) {
    case 'text':
      return update.content.text;
    case 'command':
      return `/${update.content.command}`;
    case 'button':
      return update.content.buttonId;
    default:
      return null;
  }
}
