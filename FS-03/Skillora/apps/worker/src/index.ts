import './preload';
import http from 'node:http';
import { Worker, type Job } from 'bullmq';
import {
  QUEUE_NAMES,
  env,
  logger,
  redisConnection,
  closeRedis,
} from './data';
import { VIDEO_JOB, processVideoJob, type VideoJobData } from './processors/video';
import { processReminder, type ReminderJobData } from './processors/reminder';
import { processEmail, type EmailJobData } from './processors/email';

const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT || 4100);

const workers: Worker[] = [];

function startWorker<T>(
  name: string,
  concurrency: number,
  handler: (job: Job<T>) => Promise<void>,
): Worker {
  const worker = new Worker<T>(name, handler, {
    connection: redisConnection(),
    concurrency,
    // Stalled-job recovery: a crashed worker's job is re-processed rather than
    // left in limbo. The video processor is idempotent, so this is safe.
    lockDuration: 120_000,
  });

  worker.on('completed', (job) => {
    logger.info({ queue: name, jobId: String(job.id) }, 'Job completed');
  });
  worker.on('failed', (job, err) => {
    logger.error(
      { queue: name, jobId: job ? String(job.id) : undefined, err: err.message },
      'Job failed',
    );
  });
  worker.on('error', (err) => {
    logger.error({ queue: name, err: err.message }, 'Worker error');
  });

  workers.push(worker);
  return worker;
}

/** Small health endpoint so orchestration/CI can confirm the worker is alive. */
function startHealthServer(): http.Server {
  let lastTick = Date.now();
  const timer = setInterval(() => {
    lastTick = Date.now();
  }, 1000);
  timer.unref();

  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const alive = workers.every((w) => w.isRunning());
    const body = JSON.stringify({
      status: alive ? 'ok' : 'degraded',
      service: 'skillora-worker',
      queues: workers.map((w) => ({ name: w.name, running: w.isRunning() })),
      redis: redisConnection().status,
      heartbeatAgeMs: Date.now() - lastTick,
    });
    res.writeHead(alive ? 200 : 503, { 'content-type': 'application/json' });
    res.end(body);
  });

  server.listen(HEALTH_PORT, '127.0.0.1', () => {
    logger.info({ port: HEALTH_PORT }, 'Worker health endpoint listening');
  });
  return server;
}

async function main(): Promise<void> {
  logger.info(
    { redis: env.REDIS_URL.replace(/\/\/.*@/, '//***@'), concurrency: env.MEDIA_WORKERS },
    'Starting Skillora worker',
  );

  startWorker(QUEUE_NAMES.video, env.MEDIA_WORKERS, processVideoJob);
  startWorker(QUEUE_NAMES.reminders, 2, processReminder);
  startWorker(QUEUE_NAMES.email, 2, processEmail);

  const health = startHealthServer();

  logger.info(
    {
      queues: [QUEUE_NAMES.video, QUEUE_NAMES.reminders, QUEUE_NAMES.email],
      ffmpeg: env.FFMPEG_PATH ?? 'PATH',
      storage: env.STORAGE_DRIVER,
    },
    'Skillora worker ready',
  );
  void VIDEO_JOB;

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Worker shutting down (waiting for in-flight jobs)');
    const timer = setTimeout(() => {
      logger.error('Forced worker shutdown after timeout');
      process.exit(1);
    }, 30_000);
    timer.unref();

    try {
      await Promise.all(workers.map((w) => w.close()));
      health.close();
      await closeRedis();
      logger.info('Worker shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection in worker');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});