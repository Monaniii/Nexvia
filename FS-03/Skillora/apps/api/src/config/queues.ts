import { Queue } from 'bullmq';
import { env } from './env';
import { redisConnection } from './redis';
import { logger } from '../lib/logger';

export const QUEUE_NAMES = {
  video: 'video-processing',
  reminders: 'live-class-reminders',
  email: 'email',
} as const;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection(), defaultJobOptions });
    queues.set(name, q);
  }
  return q;
}

export const videoQueue = (): Queue => getQueue(QUEUE_NAMES.video);
export const reminderQueue = (): Queue => getQueue(QUEUE_NAMES.reminders);
export const emailQueue = (): Queue => getQueue(QUEUE_NAMES.email);

export interface EnqueueResult {
  enqueued: boolean;
  jobId?: string;
  reason?: string;
}

/**
 * Enqueue helper: failures are surfaced to the caller instead of being swallowed,
 * so the API can report a degraded (but consistent) state.
 */
export async function enqueue(
  queue: Queue,
  name: string,
  data: Record<string, unknown>,
  opts?: { jobId?: string; delay?: number },
): Promise<EnqueueResult> {
  try {
    const job = await queue.add(name, data, {
      jobId: opts?.jobId,
      delay: opts?.delay,
    });
    return { enqueued: true, jobId: String(job.id) };
  } catch (err) {
    logger.error(
      { queue: queue.name, job: name, err: err instanceof Error ? err.message : String(err) },
      'Failed to enqueue job',
    );
    return { enqueued: false, reason: 'queue_unavailable' };
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => undefined)));
  queues.clear();
}

export { env as queueEnv };