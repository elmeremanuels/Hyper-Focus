// Alerts to Elmer (verbeterplan P0.2): by Telegram to ALERT_TELEGRAM_CHAT_ID and by mail to
// ALERT_EMAIL. The same alert goes out at most once per six hours per process.

export interface AlertChannels {
  telegram?: ((text: string) => Promise<void>) | undefined;
  email?: ((subject: string, text: string) => Promise<void>) | undefined;
  now?: () => Date;
  log?: Pick<Console, 'warn'>;
}

export type Alert = (key: string, text: string) => Promise<void>;

export const ALERT_REPEAT_MS = 6 * 3_600_000;

export function createAlerter(channels: AlertChannels): Alert {
  const now = channels.now ?? (() => new Date());
  const log = channels.log ?? console;
  const last = new Map<string, number>();
  return async (key, text) => {
    const t = now().getTime();
    const previous = last.get(key);
    if (previous !== undefined && t - previous < ALERT_REPEAT_MS) return;
    last.set(key, t);
    const message = `⚠️ Hyper&Focus: ${text}`;
    // Never let an alert break the caller; the console keeps the trace.
    log.warn(`ALERT ${key}: ${text}`);
    await channels.telegram?.(message).catch((error: unknown) => log.warn('Alert by Telegram failed:', error));
    await channels.email?.(`Melding: ${key}`, message).catch((error: unknown) => log.warn('Alert by mail failed:', error));
  };
}
