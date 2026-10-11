/**
 * Synergy B2B Portal — Sub-Millisecond Distributed Idempotency Guard (Redis L2 Tier)
 * Prevents race conditions, double-submissions, and duplicate charges before reaching PostgreSQL.
 */

import { getRedisClient, isRedisConfigured } from './redis';
import { logger } from './logger';

export interface IdempotencyCheckResult {
  isLocked: boolean;          // Another concurrent request is actively processing this key
  isCompleted: boolean;       // Key has already been completed; cached response available
  cachedResponse?: any;       // Previously returned response payload
  acquired: boolean;          // Current request successfully acquired the distributed processing lock
}

const IDEMPOTENCY_PREFIX = 'idempotency:order:';
const DEFAULT_LOCK_TTL_SECONDS = 120; // 2 minutes to complete transaction
const DEFAULT_COMPLETED_TTL_SECONDS = 86400; // 24 hours to remember result

/**
 * Attempts to acquire an atomic distributed lock on the idempotency key using Redis SET NX EX.
 * If the key is already processing, informs caller to reject or wait.
 * If the key is already completed, returns the cached result.
 */
export async function checkAndAcquireIdempotency(
  rawKey: string | undefined | null,
  lockTtlSeconds = DEFAULT_LOCK_TTL_SECONDS
): Promise<IdempotencyCheckResult> {
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
    return { isLocked: false, isCompleted: false, acquired: false };
  }

  const key = rawKey.trim();
  const redisKey = `${IDEMPOTENCY_PREFIX}${key}`;
  const redis = getRedisClient();

  if (!redis || !isRedisConfigured()) {
    // Graceful degradation when Redis is not available
    return { isLocked: false, isCompleted: false, acquired: false };
  }

  try {
    const processingPayload = JSON.stringify({
      state: 'PROCESSING',
      started_at: Date.now(),
      key,
    });

    // Atomic SET if Not eXists with expiration
    const acquired = await redis.set(redisKey, processingPayload, {
      nx: true,
      ex: lockTtlSeconds,
    });

    if (acquired) {
      return { isLocked: false, isCompleted: false, acquired: true };
    }

    // Key already exists in Redis — inspect its current state
    const existingRaw = await redis.get(redisKey);
    const existing = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;

    if (existing && existing.state === 'COMPLETED') {
      logger.info('[Idempotency Guard] Hit completed cache in Redis', { key });
      return {
        isLocked: false,
        isCompleted: true,
        cachedResponse: existing.response,
        acquired: false,
      };
    }

    // Key exists and is still in 'PROCESSING' state -> concurrent collision
    logger.warn('[Idempotency Guard] Concurrent duplicate request detected in Redis', { key });
    return {
      isLocked: true,
      isCompleted: false,
      acquired: false,
    };
  } catch (err) {
    logger.warn('[Idempotency Guard] Redis exception, falling back to database check:', err as Error);
    return { isLocked: false, isCompleted: false, acquired: false };
  }
}

/**
 * Stores the final successful response for the idempotency key with a 24-hour TTL.
 */
export async function saveIdempotencyCompleted(
  rawKey: string | undefined | null,
  response: any,
  completedTtlSeconds = DEFAULT_COMPLETED_TTL_SECONDS
): Promise<void> {
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) return;

  const key = rawKey.trim();
  const redisKey = `${IDEMPOTENCY_PREFIX}${key}`;
  const redis = getRedisClient();

  if (!redis || !isRedisConfigured() || !response) return;

  try {
    const completedPayload = JSON.stringify({
      state: 'COMPLETED',
      completed_at: Date.now(),
      key,
      response,
    });

    await redis.set(redisKey, completedPayload, {
      ex: completedTtlSeconds,
    });

    logger.debug('[Idempotency Guard] Saved completed response to Redis', { key });
  } catch (err) {
    logger.warn('[Idempotency Guard] Failed to save completed response to Redis:', err as Error);
  }
}

/**
 * Releases the lock early in case of business validation failure (e.g. invalid pricing or credit block)
 * so that the user can correct their input and retry without waiting for lock TTL.
 */
export async function releaseIdempotencyLock(rawKey: string | undefined | null): Promise<void> {
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) return;

  const key = rawKey.trim();
  const redisKey = `${IDEMPOTENCY_PREFIX}${key}`;
  const redis = getRedisClient();

  if (!redis || !isRedisConfigured()) return;

  try {
    await redis.del(redisKey);
    logger.debug('[Idempotency Guard] Released lock from Redis', { key });
  } catch (err) {
    logger.warn('[Idempotency Guard] Failed to release lock from Redis:', err as Error);
  }
}
