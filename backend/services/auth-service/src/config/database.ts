// =============================================================================
// PRISMA CLIENT — Singleton Pattern
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   PrismaClient opens a connection pool to PostgreSQL. If you create a new
//   PrismaClient instance on every request (or in every file that imports it),
//   you'll exhaust the database connection limit within seconds.
//
//   This file implements the Singleton Pattern — one shared instance for the
//   entire application lifetime.
//
// HOW IT WORKS:
//   The global object in Node.js persists across hot-reloads in development
//   (when using tools like ts-node-dev or nodemon). Without the global trick,
//   every file save in dev creates a new PrismaClient instance, eventually
//   hitting PostgreSQL's max_connections limit.
//
//   In production, the module cache already ensures one instance — but the
//   global trick is harmless in production and solves the dev problem.
//
// INTERVIEW QUESTION:
//   "What is the Singleton Pattern?"
//   Answer: A design pattern that ensures a class has only ONE instance and
//   provides a global point of access to it. In Node.js, you can achieve this
//   with module caching (the first require() executes the file, subsequent
//   ones return the cached export) or with the global object for dev hot-reload.
//
// INTERVIEW QUESTION:
//   "What is a connection pool?"
//   Answer: Instead of opening/closing a TCP connection for every DB query
//   (expensive: ~100ms), a pool maintains N open connections and reuses them.
//   Prisma manages this automatically. Default pool size = (CPU cores * 2) + 1.
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { env } from './env';

// Extend the global Node.js type to include our prisma instance
// This prevents TypeScript errors when we assign to global.prisma
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Create the Prisma client with logging configuration
const createPrismaClient = () => {
  return new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },  // Log all SQL queries in dev
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [
            { emit: 'event', level: 'error' },  // Only errors in production
          ],
  });
};

// Singleton: reuse existing instance in development hot-reloads
export const prisma = global.__prisma ?? createPrismaClient();

// In development, attach to global to survive hot-reloads
if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

// Log SQL queries in development — helpful for learning and debugging
// In production, we don't want to log queries (performance + sensitive data)
if (env.NODE_ENV === 'development') {
  // @ts-expect-error: Prisma event emitter types are loose
  prisma.$on('query', (e: { query: string; duration: number }) => {
    console.log(`[Prisma Query] ${e.query} — ${e.duration}ms`);
  });
}

// Graceful shutdown: close the DB connection when the process exits
// Without this, the Node.js process might hang instead of cleanly exiting
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
