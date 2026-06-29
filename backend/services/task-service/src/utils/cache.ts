// Redis cache utility — see workspace-service/src/utils/cache.ts for full docs.
// Identical implementation; each service has its own copy for isolation.
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from './logger';

const DEFAULT_TTL = env.CACHE_TTL_SECONDS;

export const getOrFetch = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL,
): Promise<T> => {
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      logger.debug(`[Cache] HIT: ${key}`);
      return JSON.parse(cached) as T;
    }
  } catch (redisErr) {
    logger.error('[Cache] Redis GET error — falling back to DB', { key, error: redisErr });
  }

  logger.debug(`[Cache] MISS: ${key}`);
  const data = await fetcher();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (redisErr) {
    logger.error('[Cache] Redis SETEX error', { key, error: redisErr });
  }

  return data;
};

export const setCache = async <T>(key: string, data: T, ttlSeconds = DEFAULT_TTL): Promise<void> => {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    logger.error('[Cache] Redis SET error', { key, error });
  }
};

export const invalidate = async (key: string): Promise<void> => {
  try {
    await redis.del(key);
    logger.debug(`[Cache] INVALIDATED: ${key}`);
  } catch (error) {
    logger.error('[Cache] Redis DEL error', { key, error });
  }
};

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

export const invalidatePattern = async (pattern: string): Promise<void> => {
  try {
    let cursor = '0';
    const keysToDelete: string[] = [];
    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      keysToDelete.push(...result[1]);
    } while (cursor !== '0');
    if (keysToDelete.length > 0) {
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
