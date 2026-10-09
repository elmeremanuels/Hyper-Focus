// Telegram Bot API over fetch, without a library (BOUWPLAN.md, 5).

export type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  | { text: string; web_app: { url: string } };

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed (${errorCode}): ${description}`);
    this.name = 'TelegramApiError';
  }

  /** The user blocked the bot or the chat no longer exists. */
  get chatUnreachable(): boolean {
    return (
      this.errorCode === 403 ||
      (this.errorCode === 400 && /chat not found|user is deactivated/i.test(this.description))
    );
  }
}

type FetchLike = typeof fetch;

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
    options: { silent?: boolean } = {},
  ): Promise<{ messageId: number }> {
    const result = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      ...(options.silent && { disable_notification: true }),
      link_preview_options: { is_disabled: true },
      ...(replyMarkup && { reply_markup: replyMarkup }),
    });
    return { messageId: result.message_id };
  }

  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  /** Removes the inline keyboard so a choice cannot be made twice. */
  async removeKeyboard(chatId: number, messageId: number): Promise<void> {
    await this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  /** Shows "typing…" while a reply is on its way (for example during transcription). */
  async sendChatAction(chatId: number, action: 'typing' = 'typing'): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action });
  }

  /**
   * Downloads a file (such as a voice message) into memory. It is never written to disk;
   * the caller drops the buffer after use (BOUWPLAN.md, 14).
   */
  async downloadFile(fileId: string, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (!file.file_path) throw new TelegramApiError('getFile', 400, 'No file_path');
    if ((file.file_size ?? 0) > maxBytes) throw new TelegramApiError('getFile', 413, 'File too large');
    const response = await this.fetchImpl(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
    if (!response.ok) throw new TelegramApiError('downloadFile', response.status, response.statusText);
    return Buffer.from(await response.arrayBuffer());
  }

  /** Sends a file, for example an .ics file the user taps to add to their calendar. */
  async sendDocument(
    chatId: number,
    filename: string,
    mimeType: string,
    content: string,
    options: { caption?: string; silent?: boolean } = {},
  ): Promise<void> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (options.silent) form.append('disable_notification', 'true');
    form.append('document', new Blob([content], { type: mimeType }), filename);
    if (options.caption) form.append('caption', options.caption);
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendDocument`, { method: 'POST', body: form });
    const payload = (await response.json()) as ApiResponse<unknown>;
    if (!payload.ok) {
      throw new TelegramApiError('sendDocument', payload.error_code ?? response.status, payload.description ?? 'Unknown error');
    }
  }

  /** Sets the command menu next to the message field. */
  async setMyCommands(commands: ReadonlyArray<{ command: string; description: string }>): Promise<void> {
    await this.call('setMyCommands', { commands });
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
  }

  /** For the hourly check (verbeterplan P0.2). */
  async getWebhookInfo(): Promise<{ url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string }> {
    return this.call('getWebhookInfo', {});
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as ApiResponse<T>;
    if (!payload.ok || payload.result === undefined) {
      throw new TelegramApiError(
        method,
        payload.error_code ?? response.status,
        payload.description ?? 'Unknown error',
      );
    }
    return payload.result;
  }
}
