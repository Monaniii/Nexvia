import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './config/db';
import { closeRedis } from './config/redis';
import { closeQueues } from './config/queues';
import { logger } from './lib/logger';
import { createSocketServer } from './sockets';
import { ensureIndexes } from './db/ensureIndexes';

async function main(): Promise<void> {
  await connectDb();
  await ensureIndexes();

  const app = createApp();
  const server = http.createServer(app);
  const { io } = createSocketServer(server);

  server.listen(env.PORT, '0.0.0.0', () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        docs: `http://127.0.0.1:${env.PORT}${env.API_BASE_PATH}/docs`,
      },
      'Skillora API listening',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const timer = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    timer.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      io.close();
      await closeQueues();
      await closeRedis();
      await disconnectDb();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});