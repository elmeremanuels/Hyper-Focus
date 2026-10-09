// Checks the worker runs on a schedule (verbeterplan P0.2). Each returns a problem in plain
// Dutch, or undefined when all is well.
import type { ClaudeClient } from '../ai/claude.js';
import type { TelegramClient } from '../channels/telegram/client.js';

export const PENDING_UPDATES_MAX = 10;

/** Hourly: Telegram keeps updates waiting, or reports a recent delivery error. */
export async function checkTelegramWebhook(client: Pick<TelegramClient, 'getWebhookInfo'>, now: Date): Promise<string | undefined> {
  try {
    const info = await client.getWebhookInfo();
    if (!info.url) return 'De Telegram-webhook staat niet ingesteld.';
    if (info.pending_update_count > PENDING_UPDATES_MAX) return `Telegram heeft ${info.pending_update_count} berichten in de wacht.`;
    const errorAgo = info.last_error_date ? now.getTime() / 1000 - info.last_error_date : undefined;
    if (errorAgo !== undefined && errorAgo < 3600) return `Telegram meldt een fout bij de webhook: ${info.last_error_message ?? 'onbekend'}.`;
    return undefined;
  } catch (error) {
    return `Telegram-webhook niet te controleren: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** A credit or key problem in an error from Anthropic or OpenAI, or undefined. */
export function creditProblem(error: unknown): string | undefined {
  const text = error instanceof Error ? error.message : String(error);
  if (/credit balance|insufficient_quota|exceeded your current quota|billing/i.test(text)) return 'Het tegoed bij de AI-leverancier is op.';
  if (/invalid x-api-key|incorrect api key|authentication_error|401/i.test(text)) return 'De API-sleutel van de AI-leverancier werkt niet.';
  return undefined;
}

/** Daily: one tiny call to Claude (one output token). */
export async function checkAnthropic(claude: Pick<ClaudeClient, 'generate'>): Promise<string | undefined> {
  try {
    await claude.generate({ purpose: 'health_check', tier: 'fast', messages: [{ role: 'user', content: 'ok' }], maxTokens: 1 });
    return undefined;
  } catch (error) {
    return `Anthropic: ${creditProblem(error) ?? (error instanceof Error ? error.message.slice(0, 200) : 'onbekende fout')}`;
  }
}

/** Daily: the OpenAI key still works (spraak naar tekst). */
export async function checkOpenAI(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetchImpl('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
    if (response.ok) return undefined;
    const body = await response.text();
    return `OpenAI: ${creditProblem(new Error(`${response.status} ${body}`)) ?? `fout ${response.status}`}`;
  } catch (error) {
    return `OpenAI niet bereikbaar: ${error instanceof Error ? error.message : String(error)}`;
  }
}
