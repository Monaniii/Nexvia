import { Redis } from 'ioredis';
import { env } from './env';
import { logger } from '../lib/logger';

let shared: Redis | null = null;
let healthy = false;

/**
 * Shared ioredis client. BullMQ requires `maxRetriesPerRequest: null`, so all
 * consumers reuse this single connection definition.
 */
export function redisConnection(): Redis {
  if (!shared) {
    shared = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 500, 10_000),
    });
    shared.on('ready', () => {
      healthy = true;
      logger.info('Redis connected');
    });
    shared.on('error', (err) => {
      if (healthy) logger.error({ err: err.message }, 'Redis connection error');
      healthy = false;
    });
  }
  return shared;
}

export function redisHealthy(): boolean {
  return healthy;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit().catch(() => undefined);
    shared = null;
    healthy = false;
  }
}

/** Health probe used by /health and /ready endpoints. */
export async function pingRedis(): Promise<boolean> {
  try {
    const client = redisConnection();
    const res = await client.ping();
    healthy = res === 'PONG';
  } catch {
    healthy = false;
  }
  return healthy;
}