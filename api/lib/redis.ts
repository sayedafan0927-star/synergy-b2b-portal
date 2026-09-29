import { Redis } from '@upstash/redis';

let redisInstance: Redis | null = null;
let redisInitialized = false;

/**
 * Initializes and returns the Upstash Redis client.
 * Supports standard UPSTASH_REDIS_REST_URL/TOKEN and Vercel KV environment variables.
 * Returns null if no Redis environment variables are configured.
 */
export function getRedisClient(): Redis | null {
  if (redisInitialized) {
    return redisInstance;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (url && token) {
    try {
      redisInstance = new Redis({ url, token });
    } catch (err) {
      console.warn('[Redis] Failed to initialize Upstash Redis client:', err);
      redisInstance = null;
    }
  }

  redisInitialized = true;
  return redisInstance;
}
