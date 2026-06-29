// =============================================================================
// REDIS CLIENT — Singleton with ioredis
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Redis is used in the Auth Service for:
//   1. Refresh token blacklisting (when a user logs out or a token is compromised)
//   2. Rate limiting on auth endpoints (prevent brute force attacks)
//   3. Token verification caching (avoid DB hit on every request — future optimization)
//
// WHY ioredis over the official 'redis' package?
//   - Built-in automatic reconnection with exponential backoff
//   - Cluster mode support for horizontal scaling
//   - Better TypeScript support
//   - Promise-based API natively (no callback hell)
//   - Pipeline/multi-exec support for atomic operations
//
// HOW IT WORKS:
//   ioredis manages its own connection pool internally.
//   Commands are queued if the connection is temporarily lost and
//   replayed when reconnected (configurable behavior).
//
// INTERVIEW QUESTION:
//   "When would you use Redis vs PostgreSQL?"
//   Answer: Redis for ephemeral data that needs sub-millisecond access:
//   sessions, caches, rate limiting counters, pub/sub, leaderboards.
//   PostgreSQL for persistent, relational data that needs ACID guarantees.
//   They complement each other — don't replace one with the other.
// =============================================================================

import Redis from 'ioredis';
import { env } from './env';

// Declare global for singleton pattern (same reason as Prisma)
declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

const createRedisClient = (): Redis => {
  const client = new Redis(env.REDIS_URL, {
    // Reconnect strategy: exponential backoff
    // Wait 2^attempt * 100ms between retries, capped at 5 seconds
    retryStrategy(times) {
      const delay = Math.min(times * 100, 5000);
      return delay;
    },
    // Timeout for connection attempts
    connectTimeout: 10000,
    // If Redis is unavailable, commands are rejected immediately rather than queuing
    // Set to true in production to fail fast
    enableOfflineQueue: env.NODE_ENV !== 'production',
    // Keyspace prefix — all keys from this service start with "auth:"
    // Prevents key collisions if multiple services share one Redis instance
    keyPrefix: 'auth:',
  });

  client.on('connect', () => {
    console.log('[Redis] Connected successfully');
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
    // Don't crash the process — Redis errors are non-fatal for most operations
    // The rate limiter will degrade gracefully if Redis is unavailable
  });

  client.on('reconnecting', (delay: number) => {
    console.warn(`[Redis] Reconnecting in ${delay}ms...`);
  });

  return client;
};

// Singleton instance
export const redis = global.__redis ?? createRedisClient();

if (env.NODE_ENV !== 'production') {
  global.__redis = redis;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await redis.quit();
});

// =============================================================================
// REDIS KEY HELPERS
// =============================================================================
// Centralize key names to prevent typos and make changes easier.
// Pattern: {service}:{entity}:{identifier}
// The keyPrefix "auth:" is prepended automatically by ioredis.
// =============================================================================
export const RedisKeys = {
  // Blacklisted refresh token JTI (JWT ID) — prevents reuse after logout
  // TTL: match the refresh token expiry (7 days)
  refreshTokenBlacklist: (jti: string) => `refresh:blacklist:${jti}`,

  // Rate limiting for login attempts per IP
  // TTL: set by the rate limiter window
  loginAttempts: (ip: string) => `ratelimit:login:${ip}`,

  // Rate limiting for password reset requests per email
  resetAttempts: (email: string) => `ratelimit:reset:${email}`,

  // Temporary storage for email verification tokens (redundant with DB, but faster)
  verifyToken: (token: string) => `verify:${token}`,
} as const;
