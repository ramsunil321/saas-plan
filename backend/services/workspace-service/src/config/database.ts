// Prisma Client singleton — identical pattern to auth-service.
// See auth-service/src/config/database.ts for full documentation.
import { PrismaClient } from '@prisma/client';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const createPrismaClient = () =>
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

export const prisma = global.__prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
