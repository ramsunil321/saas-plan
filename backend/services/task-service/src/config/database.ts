// =============================================================================
// DATABASE — Prisma Client Singleton
// =============================================================================
// See auth-service/src/config/database.ts for full documentation.
// Uses global singleton to prevent multiple connections in hot-reload (dev mode).
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = global.__prisma ?? new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

prisma.$connect().catch((err) => {
  console.error('[TaskService] Database connection failed:', err);
  process.exit(1);
});
