// =============================================================================
// TASK SERVICE — HTTP Server Entry Point
// =============================================================================
// See auth-service/src/server.ts for full graceful shutdown documentation.
// =============================================================================

import app from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { rabbitMQ } from './config/rabbitmq';
import { logger } from './utils/logger';

const PORT = env.PORT;

const startServer = async () => {
  // Connect to RabbitMQ before accepting traffic
  // If RabbitMQ is unavailable, the service still starts (graceful degradation)
  // Events won't be published but task operations will still work
  await rabbitMQ.connect();

  const server = app.listen(PORT, () => {
    logger.info(`🚀 Task Service running on port ${PORT}`, { environment: env.NODE_ENV });
  });

  const gracefulShutdown = async (signal: string) => {
    logger.info(`[TaskServer] ${signal} — graceful shutdown starting`);
    // Stop accepting new connections first
    server.close(async () => {
      await prisma.$disconnect();
      await redis.quit();
      await rabbitMQ.close();
      logger.info('[TaskServer] Shutdown complete');
      process.exit(0);
    });
    // Force exit after 30 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('[TaskServer] Forced shutdown — graceful shutdown exceeded 30s');
      process.exit(1);
    }, 30000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('[TaskServer] Unhandled rejection', { reason });
    gracefulShutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error('[TaskServer] Uncaught exception', { error: error.message, stack: error.stack });
    gracefulShutdown('uncaughtException');
  });
};

startServer().catch((err) => {
  logger.error('[TaskServer] Failed to start', { error: err });
  process.exit(1);
});
