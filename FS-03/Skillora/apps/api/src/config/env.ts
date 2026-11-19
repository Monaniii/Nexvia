import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Load .env from the repository root regardless of the process cwd.
const rootEnv = path.resolve(process.cwd(), '../../.env');
const localEnv = path.resolve(process.cwd(), '.env');
for (const file of [rootEnv, localEnv]) {
  if (existsSync(file)) loadDotenv({ path: file, override: false });
}

const bool = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v)));

const num = (dflt: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? dflt : Number(v)))
    .pipe(z.number());

// PORT must be a fixed, documented port (frontend proxy, docs, tests all rely on it).
// Some execution harnesses export PORT=0 meaning "not set"; an ephemeral port would
// be useless here, so treat 0/empty as unset and fall back to the default.
const port = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' || v === '0' ? 4000 : Number(v)))
  .pipe(z.number().int().min(1).max(65535));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Logger/service label; the worker process sets this to skillora-worker. */
  SERVICE_NAME: z.string().optional(),
  PORT: port,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/skillora'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  WEB_ORIGIN: z.string().min(1).default('http://127.0.0.1:5173'),
  CORS_ORIGINS: z.string().optional(),
  API_BASE_PATH: z.string().default('/api/v1'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-only-refresh-secret-change-me-please'),
  ACCESS_TOKEN_TTL_SECONDS: num(900),
  REFRESH_TOKEN_TTL_DAYS: num(14),
  COOKIE_SECURE: bool(false),
  COOKIE_DOMAIN: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  CDN_BASE_URL: z.string().optional(),
  SIGNED_URL_TTL_SECONDS: num(600),
  PUBLIC_MEDIA_BASE_URL: z.string().optional(),

  PAYMENT_PROVIDER: z.enum(['local', 'stripe']).default('local'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  COMMISSION_BPS: num(1500),
  PLATFORM_NAME: z.string().default('Skillora'),
  SUPPORT_EMAIL: z.string().default('support@skillora.local'),
  APP_URL: z.string().default('http://127.0.0.1:4000'),
  PAYOUT_THRESHOLD_MINOR: num(5000),

  UPLOAD_MAX_BYTES: num(500 * 1024 * 1024),
  IMAGE_MAX_BYTES: num(5 * 1024 * 1024),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  MEDIA_WORKERS: num(2),

  EMAIL_PROVIDER: z.enum(['none', 'log']).default('log'),
  SMTP_URL: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: num(60_000),
  RATE_LIMIT_AUTH_MAX: num(10),
  RATE_LIMIT_API_MAX: num(300),
  RATE_LIMIT_CHECKOUT_MAX: num(20),

  TEST_MODE: bool(true),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const corsOrigins = (env.CORS_ORIGINS ?? env.WEB_ORIGIN)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const isProd = env.NODE_ENV === 'production';

/** True when the required credentials for a real (non-local) integration exist. */
export const integrationStatus = {
  stripe: env.PAYMENT_PROVIDER === 'stripe' && Boolean(env.STRIPE_SECRET_KEY),
  aws: env.STORAGE_DRIVER === 's3' && Boolean(env.S3_BUCKET && env.AWS_ACCESS_KEY_ID),
  livekit: Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
} as const;