let RedisClass: any = null;
let redisInstance: any = null;
let redisInitialized = false;

function loadRedisClass() {
  if (RedisClass) return RedisClass;
  try {
    const mod = require('@upstash/redis');
    RedisClass = mod.Redis || mod.default?.Redis || mod;
  } catch {
    RedisClass = null;
  }
  return RedisClass;
}

/**
 * Initializes and returns the Upstash Redis client.
 * Supports standard UPSTASH_REDIS_REST_URL/TOKEN and Vercel KV environment variables.
 * Returns null if no Redis environment variables are configured.
 */
export function getRedisClient(): any {
  if (redisInitialized) {
    return redisInstance;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (url && token) {
    try {
      const Cls = loadRedisClass();
      if (Cls) {
        redisInstance = new Cls({ url, token });
      }
    } catch (err) {
      console.warn('[Redis] Failed to initialize Upstash Redis client:', err);
      redisInstance = null;
    }
  }

  redisInitialized = true;
  return redisInstance;
}

/**
 * Returns true if Redis environment variables are provided.
 */
export function isRedisConfigured(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  );
}

/**
 * Diagnostic health check for Upstash Redis connectivity.
 */
export async function checkRedisHealth(): Promise<{ configured: boolean; connected: boolean; latencyMs?: number; error?: string }> {
  if (!isRedisConfigured()) {
    return { configured: false, connected: false };
  }
  const client = getRedisClient();
  if (!client) {
    return { configured: true, connected: false, error: 'Client initialization failed' };
  }
  const start = Date.now();
  try {
    const pingRes = await client.ping();
    return {
      configured: true,
      connected: pingRes === 'PONG' || Boolean(pingRes),
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - start,
      error: err?.message,
    };
  }
}

