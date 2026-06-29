// =============================================================================
// NOTIFICATION SERVICE — Server Bootstrap
// =============================================================================
//
// This file starts TWO concurrent systems in one process:
//   1. HTTP server (Express) — serves the REST API
//   2. RabbitMQ consumer (EventConsumer) — processes incoming events
//
// STARTUP SEQUENCE:
//   1. Create HTTP server from Express app
//   2. Start EventConsumer (registers handler + connects to RabbitMQ)
//   3. Bind HTTP server to port
//
// GRACEFUL SHUTDOWN:
//   When the process receives SIGTERM (Kubernetes/Docker scale-down) or
//   SIGINT (Ctrl+C in development), the server:
//     1. Stops accepting new HTTP requests
//     2. Waits for in-flight requests to complete (up to 10s)
//     3. Closes the RabbitMQ channel + connection (any unacked message is
//        re-queued automatically by RabbitMQ)
//     4. Disconnects from Prisma and Redis
//
// WHY GRACEFUL SHUTDOWN MATTERS FOR CONSUMERS:
//   Without it, a SIGTERM during message processing would kill the process
//   before the ACK is sent. RabbitMQ would then redeliver the message to
//   the next consumer instance — this is safe but causes duplicate processing.
//   Graceful shutdown gives the current message time to finish and ACK.
//
// INTERVIEW QUESTION: "What happens to unprocessed messages when a consumer dies?"
//   Answer: If the consumer crashes without ACKing, RabbitMQ re-queues the
//   message and delivers it to another consumer (or the same consumer after restart).
//   This is RabbitMQ's "at-least-once delivery" guarantee. The message is NOT lost.
//   Messages only go to DLQ on explicit NACK(requeue=false) — not on consumer crash.
// =============================================================================

import { createServer } from 'http';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { rabbitMQConsumer } from './config/rabbitmq';
import { EventConsumer } from './consumers/event.consumer';
import { NotificationService } from './services/notification.service';
import { NotificationRepository } from './repositories/notification.repository';

const httpServer = createServer(app);

// =============================================================================
// DEPENDENCY INJECTION — Wire up the consumer pipeline
// =============================================================================
// The same service instance is used by both the HTTP API (via routes)
// and the event consumer. This means they share the same Redis client,
// which is intentional — writes from the consumer invalidate the same
// cache keys that the HTTP API reads.
// =============================================================================
const notificationRepository = new NotificationRepository();
const notificationService = new NotificationService(notificationRepository);
const eventConsumer = new EventConsumer(notificationService);

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`[Server] ${signal} received — starting graceful shutdown`);

  // 1. Stop accepting new HTTP connections (existing requests continue)
  httpServer.close(async () => {
    logger.info('[Server] HTTP server closed');

    try {
      // 2. Close RabbitMQ — any message currently being processed will be
      //    re-queued automatically since the ACK hasn't been sent yet
      await rabbitMQConsumer.close();
      logger.info('[Server] RabbitMQ consumer disconnected');

      // 3. Disconnect Prisma connection pool
      await prisma.$disconnect();
      logger.info('[Server] Prisma disconnected');

      // 4. Close Redis connection
      await redis.quit();
      logger.info('[Server] Redis disconnected');

      process.exit(0);
    } catch (err) {
      logger.error('[Server] Error during shutdown', { error: err });
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds if graceful shutdown hangs
  // (e.g., a request handler stuck in an infinite loop)
  setTimeout(() => {
    logger.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled promise rejections — log and exit
// In production, the container/process manager will restart the service
process.on('unhandledRejection', (reason) => {
  logger.error('[Server] Unhandled promise rejection', { reason });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('[Server] Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// =============================================================================
// START
// =============================================================================
httpServer.listen(env.PORT, () => {
  logger.info(`[Server] Notification service running on port ${env.PORT}`);
  logger.info(`[Server] Environment: ${env.NODE_ENV}`);

  // Start the RabbitMQ consumer AFTER the HTTP server is listening
  // This ensures the /health endpoint is available during consumer startup
  eventConsumer.start();
});
