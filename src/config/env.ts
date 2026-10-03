import 'dotenv/config';
import { z } from 'zod';

// Treat empty strings from .env as "not set".
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

const ianaTimezone = z.string().refine(isValidTimezone, {
  message: 'Must be a valid IANA timezone, e.g. Europe/Amsterdam',
});

const commaList = (value: unknown) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : (value ?? []);

const telegramUserIds = z.preprocess(commaList, z.array(z.coerce.number().int().positive()));
const emailList = z.preprocess(
  commaList,
  z.array(z.email().transform((address) => address.toLowerCase())),
);

export const envSchema = z.object({
  // General
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(65535).default(3000)),
  APP_BASE_URL: optionalUrl,
  DATABASE_URL: optionalString,
  DEFAULT_TIMEZONE: z.preprocess(emptyToUndefined, ianaTimezone.default('Europe/Amsterdam')),

  // Claude. Model names come from env only; never hardcode them.
  ANTHROPIC_API_KEY: optionalString,
  CLAUDE_MODEL_FAST: optionalString,
  CLAUDE_MODEL_SMART: optionalString,
  /** Optional: low | medium | high | xhigh | max. Leave empty for Haiku 4.5. */
  CLAUDE_EFFORT_FAST: z.preprocess(emptyToUndefined, z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional()),
  CLAUDE_EFFORT_SMART: z.preprocess(emptyToUndefined, z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional()),

  // Transcription
  OPENAI_API_KEY: optionalString,
  TRANSCRIBE_MODEL: optionalString,

  // Telegram
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_BOT_USERNAME: optionalString,
  TELEGRAM_WEBHOOK_SECRET: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .min(32, 'Use at least 32 characters')
      .regex(/^[A-Za-z0-9_-]+$/, 'Only A-Z, a-z, 0-9, _ and - (Telegram limit)')
      .optional(),
  ),
  TELEGRAM_ALLOWED_USER_IDS: telegramUserIds,

  // Mail
  BREVO_API_KEY: optionalString,
  EMAIL_FROM: z.preprocess(emptyToUndefined, z.email().optional()),
  EMAIL_REPLY_TO: z.preprocess(emptyToUndefined, z.email().optional()),
  EMAIL_INBOUND_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  EMAIL_ALLOWED_SENDERS: emailList,
  /** Inbound mail with a higher Brevo SpamScore is ignored. */
  EMAIL_MAX_SPAM_SCORE: z.preprocess(emptyToUndefined, z.coerce.number().min(0).default(5)),
  ACTION_LINK_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),

  // Research
  RESEARCH_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['claude', 'perplexity']).default('claude'),
  ),
  PERPLEXITY_API_KEY: optionalString,

  // Calendar (optional)
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalUrl,

  // Phase 3
  MOLLIE_API_KEY: optionalString,
  ENCRYPTION_KEY: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
