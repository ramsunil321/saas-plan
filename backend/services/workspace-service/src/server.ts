// Workspace Service entry point — see auth-service/src/server.ts for full docs.
import app from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { rabbitMQ } from './config/rabbitmq';
import { logger } from './utils/logger';

const PORT = env.PORT;

// Start server and connect to message broker
const startServer = async () => {
  // Connect to RabbitMQ before accepting traffic
  await rabbitMQ.connect();

  const server = app.listen(PORT, () => {
    logger.info(`🚀 Workspace Service running on port ${PORT}`, { environment: env.NODE_ENV });
  });

  const gracefulShutdown = async (signal: string) => {
    logger.info(`[WorkspaceServer] ${signal} — graceful shutdown starting`);
    server.close(async () => {
      await prisma.$disconnect();
      await redis.quit();
      await rabbitMQ.close();
      logger.info('[WorkspaceServer] Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => { logger.error('[WorkspaceServer] Forced shutdown'); process.exit(1); }, 30000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('[WorkspaceServer] Unhandled rejection', { reason });
    gracefulShutdown('unhandledRejection');
  });
};

startServer().catch((err) => {
  logger.error('[WorkspaceServer] Failed to start', { error: err });
  process.exit(1);
});
