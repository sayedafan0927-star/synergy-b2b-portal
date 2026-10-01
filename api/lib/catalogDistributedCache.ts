/**
 * Synergy B2B Portal — Distributed Multi-Tier Catalog Cache (Redis L2 Tier)
 * Provides sub-millisecond cross-lambda caching with automatic TTL & graceful degradation.
 */

import { getRedisClient } from './redis';

const DEFAULT_CATALOG_REDIS_TTL = 180; // 3 minutes

export async function getRedisCatalogCache(cacheKey: string): Promise<any | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const val = await redis.get(`cache:${cacheKey}`);
    if (val) {
      return typeof val === 'string' ? JSON.parse(val) : val;
    }
  } catch (err) {
    console.warn('[Redis Catalog Cache] Lookup exception:', err);
  }
  return null;
}

export async function setRedisCatalogCache(
  cacheKey: string,
  data: any,
  ttlSeconds = DEFAULT_CATALOG_REDIS_TTL
): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !data) return;
  try {
    await redis.set(`cache:${cacheKey}`, JSON.stringify(data), { ex: ttlSeconds });
  } catch (err) {
    console.warn('[Redis Catalog Cache] Save exception:', err);
  }
}

export async function invalidateRedisCatalogCache(cacheKey?: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    if (cacheKey) {
      await redis.del(`cache:${cacheKey}`);
    } else {
      await redis.del('cache:catalog_global');
      await redis.del('cache:catalog_normalized');
    }
  } catch (err) {
    console.warn('[Redis Catalog Cache] Invalidation exception:', err);
  }
}
