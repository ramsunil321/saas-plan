// =============================================================================
// REDIS CACHE UTILITY — Generic cache helpers with TTL and invalidation
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Raw Redis calls scattered across services lead to inconsistent TTLs,
//   forgotten invalidations, and hard-to-debug cache bugs. This utility
//   provides a typed, consistent API over Redis with:
//   1. get-or-fetch pattern (cache-aside / lazy loading)
//   2. TTL management
//   3. Pattern-based invalidation (delete all keys matching a prefix)
//
// CACHE STRATEGIES:
//   Cache-Aside (Lazy Loading): Check cache first. On miss, fetch from DB,
//   store in cache, return data. On write: invalidate cache.
//   Pro: only caches data that's actually requested.
//   Con: first request after invalidation is always a cache miss (slow).
//
//   Write-Through: On EVERY write to DB, also write to cache.
//   Pro: cache is always fresh.
//   Con: writes are slower (two operations), and we cache data nobody may read.
//
//   We use Cache-Aside for reads + invalidation on writes.
//
// INTERVIEW QUESTION:
//   "What is the difference between cache invalidation and cache expiration?"
//   Answer: Expiration (TTL) removes keys automatically after a set time —
//   simple but data can be stale for up to TTL. Invalidation removes keys
//   IMMEDIATELY when data changes — data is never stale, but requires tracking
//   which keys to invalidate. We use BOTH: invalidation for writes + TTL as
//   a safety net for invalidation misses.
//
// INTERVIEW QUESTION:
//   "What are cache stampedes and how do you prevent them?"
//   Answer: When a popular key expires, many simultaneous requests all miss
//   the cache and all hit the DB at once. Prevention strategies:
//   1. Probabilistic early expiration (refresh before expiry)
//   2. Mutex/lock on cache miss (only one request fetches, others wait)
//   3. Stale-while-revalidate (serve stale data while refreshing)
//   For FlowForge, TTLs are short enough that stampedes are acceptable.
// =============================================================================

import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from './logger';

const DEFAULT_TTL = env.CACHE_TTL_SECONDS;

// =============================================================================
// CACHE-ASIDE PATTERN
// get() → miss → fetch() → set() → return
// =============================================================================

// Get a value from cache, or fetch it from the source if not cached
export const getOrFetch = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL,
): Promise<T> => {
  try {
    // Step 1: Check cache
    const cached = await redis.get(key);
    if (cached !== null) {
      // Cache hit — parse JSON and return
      logger.debug(`[Cache] HIT: ${key}`);
      return JSON.parse(cached) as T;
    }
  } catch (redisErr) {
    // Redis error — fall through to fetch from DB (graceful degradation)
    logger.error('[Cache] Redis GET error — falling back to DB', { key, error: redisErr });
  }

  // Step 2: Cache miss — fetch from DB
  logger.debug(`[Cache] MISS: ${key}`);
  const data = await fetcher();

  // Step 3: Store in cache (async — don't block the response)
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (redisErr) {
    logger.error('[Cache] Redis SETEX error', { key, error: redisErr });
  }

  return data;
};

// Store a value in cache
export const setCache = async <T>(key: string, data: T, ttlSeconds = DEFAULT_TTL): Promise<void> => {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    logger.error('[Cache] Redis SET error', { key, error });
  }
};

// Delete a single cache key
export const invalidate = async (key: string): Promise<void> => {
  try {
    await redis.del(key);
    logger.debug(`[Cache] INVALIDATED: ${key}`);
  } catch (error) {
    logger.error('[Cache] Redis DEL error', { key, error });
  }
};

// Delete MULTIPLE cache keys at once (transactional — all or nothing in pipeline)
export const invalidateMany = async (keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  try {
    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.del(key));
    await pipeline.exec();
    logger.debug(`[Cache] INVALIDATED ${keys.length} keys`);
  } catch (error) {
    logger.error('[Cache] Redis multi-DEL error', { error });
  }
};

// Delete all keys matching a prefix pattern using SCAN (not KEYS — KEYS blocks Redis)
// INTERVIEW QUESTION: "Why use SCAN instead of KEYS in production?"
// Answer: KEYS is O(N) and blocks Redis during execution — it can freeze Redis
// for seconds on large datasets. SCAN iterates incrementally without blocking.
export const invalidatePattern = async (pattern: string): Promise<void> => {
  try {
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      // SCAN returns [nextCursor, [keys...]]
      // Count 100 = scan up to 100 keys per iteration (hint, not guarantee)
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      keysToDelete.push(...result[1]);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      // Strip keyPrefix if present because invalidateMany/del will auto-prepend it
      const prefix = redis.options.keyPrefix || '';
      const cleanKeys = prefix
        ? keysToDelete.map((key) => key.startsWith(prefix) ? key.slice(prefix.length) : key)
        : keysToDelete;
      await invalidateMany(cleanKeys);
    }
  } catch (error) {
    logger.error('[Cache] Pattern invalidation error', { pattern, error });
  }
};
