// =============================================================================
// RATE LIMITING MIDDLEWARE — Sliding window with Redis
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Auth endpoints are primary targets for brute force attacks:
//   - Login: attacker tries thousands of password combinations
//   - Forgot password: attacker enumerates valid emails
//   - Register: attacker creates spam accounts
//
//   Rate limiting restricts how many requests a client can make in a time window.
//
// ALGORITHM — Sliding Window:
//   Fixed window (simple): Reset counter every N seconds. Problem: burst at
//   window boundary — 100 req in last second + 100 req in first second = 200 total.
//
//   Sliding window (our approach): Uses Redis sorted sets.
//   Each request is stored with its timestamp as the score.
//   Count entries within [now - window, now] → true sliding count.
//   Remove old entries (outside window) on each request.
//
//   This accurately limits requests regardless of when in the window they arrive.
//
// INTERVIEW QUESTION:
//   "Why use Redis for rate limiting instead of in-memory?"
//   Answer: In-memory state doesn't survive restarts and isn't shared across
//   multiple server instances (horizontal scaling). If you have 5 servers,
//   an attacker can make 5x the allowed requests (one per server).
//   Redis is shared across all instances — one counter for all servers.
//
// INTERVIEW QUESTION:
//   "What is the difference between rate limiting and throttling?"
//   Answer: Rate limiting REJECTS requests over the limit (429 Too Many Requests).
//   Throttling SLOWS DOWN requests (adds delay). Rate limiting is more common
//   for auth APIs; throttling for bandwidth-sensitive operations.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

interface RateLimitOptions {
  windowMs: number;      // Time window in milliseconds
  max: number;           // Maximum requests allowed in the window
  keyPrefix: string;     // Redis key prefix to namespace limits (e.g., 'login', 'register')
  message?: string;      // Custom error message
  skipIf?: (req: Request) => boolean; // Function to skip rate limiting conditionally
}

export const createRateLimit = (options: RateLimitOptions) => {
  const {
    windowMs,
    max,
    keyPrefix,
    message = 'Too many requests. Please try again later.',
    skipIf,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Allow bypassing rate limit in tests
    if (skipIf && skipIf(req)) {
      next();
      return;
    }

    // Use IP as the rate limit key — identifies the client
    // In production behind a proxy: use X-Forwarded-For header (req.ip handles this
    // if app.set('trust proxy', 1) is set in app.ts)
    const ip = req.ip ?? 'unknown';
    const key = `ratelimit:${keyPrefix}:${ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Sliding window using Redis sorted set:
      // Score = timestamp, Member = unique request ID (timestamp is fine here)
      const pipeline = redis.pipeline();

      // Remove requests outside the current window
      pipeline.zremrangebyscore(key, '-inf', windowStart.toString());

      // Count remaining requests in the window
      pipeline.zcard(key);

      // Add current request to the set
      pipeline.zadd(key, now, `${now}-${Math.random()}`);

      // Set expiry on the key (cleanup — prevents Redis memory leak)
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();

      // results[1] is the count BEFORE adding the current request
      const currentCount = (results?.[1]?.[1] as number) ?? 0;

      // Set rate limit headers (standard X-RateLimit headers)
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - currentCount - 1));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (currentCount >= max) {
        logger.warn('[RateLimit] Rate limit exceeded', {
          ip,
          key: keyPrefix,
          count: currentCount,
          limit: max,
        });

        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message,
          },
        });
        return;
      }

      next();
    } catch (redisError) {
      // If Redis is unavailable, fail OPEN (allow the request)
      // This is a trade-off: availability over security
      // In high-security contexts, you might fail CLOSED (reject all)
      logger.error('[RateLimit] Redis error — skipping rate limit', { error: redisError });
      next();
    }
  };
};

// =============================================================================
// PRE-CONFIGURED LIMITERS FOR AUTH ENDPOINTS
// =============================================================================

// Login: 10 attempts per 15 minutes
// Prevents brute force password attacks
export const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  keyPrefix: 'login',
  message: 'Too many login attempts. Please wait 15 minutes before trying again.',
});

// Registration: 5 attempts per hour
// Prevents spam account creation
export const registerRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyPrefix: 'register',
  message: 'Too many registration attempts. Please try again later.',
});

// Forgot password: 3 attempts per 15 minutes
// Prevents email enumeration and email bombing
export const forgotPasswordRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  keyPrefix: 'forgot-password',
  message: 'Too many password reset requests. Please wait before trying again.',
});
