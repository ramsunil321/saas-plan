// =============================================================================
// SERVER ENTRY POINT
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   This is the only file that starts the HTTP server.
//   app.ts creates and configures Express (testable without a port).
//   server.ts binds the app to a port and handles process signals.
//
// GRACEFUL SHUTDOWN:
//   When a process receives SIGTERM (container stop, deploy) or SIGINT (Ctrl+C):
//   1. Stop accepting NEW connections
//   2. Wait for existing connections to finish
//   3. Close the database connection pool
//   4. Exit cleanly
//
//   Without graceful shutdown:
//   - In-flight requests get cut off mid-response
//   - Database transactions may be left open
//   - Clients receive connection reset errors
//
// INTERVIEW QUESTION:
//   "What is SIGTERM vs SIGINT?"
//   Answer: SIGTERM (signal 15) = polite request to terminate (sent by `kill`,
//   Docker `docker stop`, Kubernetes pod eviction). The process can handle it.
//   SIGINT (signal 2) = keyboard interrupt (Ctrl+C in terminal).
//   Both should trigger graceful shutdown.
//   SIGKILL (signal 9) = forced kill — cannot be caught or handled.
// =============================================================================

import app from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { logger } from './utils/logger';

const PORT = env.PORT;

// Start the HTTP server
const server = app.listen(PORT, () => {
  logger.info(`🚀 Auth Service running on port ${PORT}`, {
    environment: env.NODE_ENV,
    port: PORT,
  });
});

// =============================================================================
// GRACEFUL SHUTDOWN HANDLER
// =============================================================================

const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`[Server] ${signal} received — starting graceful shutdown`);

  // Step 1: Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error('[Server] Error closing HTTP server', { error: err });
    } else {
      logger.info('[Server] HTTP server closed');
    }

    // Step 2: Close database connections
    try {
      await prisma.$disconnect();
      logger.info('[Server] Database disconnected');
    } catch (dbErr) {
      logger.error('[Server] Error disconnecting database', { error: dbErr });
    }

    // Step 3: Close Redis connection
    try {
      await redis.quit();
      logger.info('[Server] Redis disconnected');
    } catch (redisErr) {
      logger.error('[Server] Error disconnecting Redis', { error: redisErr });
    }

    // Step 4: Exit
    logger.info('[Server] Graceful shutdown complete');
    process.exit(err ? 1 : 0);
  });

  // Force exit after 30 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('[Server] Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 30000).unref(); // .unref() allows the timeout to not block other exits
};

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections (bugs — async functions without try/catch)
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('[Server] Unhandled Promise Rejection', { reason });
  // In production, crash the process — let the orchestrator restart it
  // An unhandled rejection means the app is in an unknown state
  gracefulShutdown('unhandledRejection');
});

// Handle uncaught exceptions (synchronous bugs — should never happen in well-written code)
process.on('uncaughtException', (error: Error) => {
  logger.error('[Server] Uncaught Exception', { error: error.message, stack: error.stack });
  gracefulShutdown('uncaughtException');
});

export default server;
