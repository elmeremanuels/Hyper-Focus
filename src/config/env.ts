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

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be an E.164 number, e.g. +31612345678');

const numberList = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : (value ?? []),
  z.array(e164),
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

  // Transcription
  OPENAI_API_KEY: optionalString,
  TRANSCRIBE_MODEL: optionalString,

  // WhatsApp
  WHATSAPP_GRAPH_VERSION: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,
  WHATSAPP_ALLOWED_NUMBERS: numberList,

  // Mail
  SENDGRID_API_KEY: optionalString,
  EMAIL_FROM: z.preprocess(emptyToUndefined, z.email().optional()),

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
