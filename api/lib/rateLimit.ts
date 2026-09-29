import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedisClient } from './redis';

interface RateLimitRecord {
  timestamps: number[];
}

// In-memory fallback map (inline expiration on access, no setInterval)
const rateLimitMap = new Map<string, RateLimitRecord>();

export function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const list = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return list.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export interface RateLimitOptions {
  limit?: number;          // Максимум запросов за окно
  windowSeconds?: number;  // Размер окна в секундах
  actionPrefix?: string;   // Префикс действия для изолированного счетчика
}

/**
 * Проверка лимита частоты запросов с использованием Redis (или in-memory fallback)
 */
export async function checkRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  options: RateLimitOptions = {}
): Promise<{ allowed: boolean; remaining: number; resetSeconds: number; ip: string }> {
  const limit = options.limit || 60;
  const windowSeconds = options.windowSeconds || 60;
  const windowMs = windowSeconds * 1000;
  const ip = getClientIp(req);
  const action = options.actionPrefix || 'general';
  const redisKey = `ratelimit:${action}:${ip}`;

  const redis = getRedisClient();
  if (redis) {
    try {
      // Redis pipeline: INCR and set EXPIRE if first request
      const current = await redis.incr(redisKey);
      let ttl = await redis.ttl(redisKey);
      if (ttl < 0) {
        await redis.expire(redisKey, windowSeconds);
        ttl = windowSeconds;
      }

      const resetSeconds = Math.max(1, ttl);
      const remaining = Math.max(0, limit - current);

      try {
        res.setHeader('X-RateLimit-Limit', String(limit));
        res.setHeader('X-RateLimit-Remaining', String(remaining));
        res.setHeader('X-RateLimit-Reset', String(resetSeconds));

        if (current > limit) {
          res.setHeader('Retry-After', String(resetSeconds));
          return { allowed: false, remaining: 0, resetSeconds, ip };
        }
      } catch {}

      return { allowed: true, remaining, resetSeconds, ip };
    } catch (redisErr) {
      console.warn('[RateLimit] Redis check failed, using memory fallback:', redisErr);
    }
  }

  // Fallback: In-memory sliding window
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitMap.get(redisKey);
  if (!record) {
    record = { timestamps: [] };
    rateLimitMap.set(redisKey, record);
  }

  // Очищаем отметки времени старше текущего окна inline
  record.timestamps = record.timestamps.filter(t => t > windowStart);

  const resetSeconds = record.timestamps.length > 0
    ? Math.max(1, Math.ceil((record.timestamps[0] + windowMs - now) / 1000))
    : windowSeconds;

  try {
    if (record.timestamps.length >= limit) {
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(resetSeconds));
      res.setHeader('Retry-After', String(resetSeconds));

      return { allowed: false, remaining: 0, resetSeconds, ip };
    }

    record.timestamps.push(now);
    const remaining = Math.max(0, limit - record.timestamps.length);

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    return { allowed: true, remaining, resetSeconds, ip };
  } catch {
    return { allowed: true, remaining: limit, resetSeconds: 0, ip };
  }
}

/**
 * Валидатор и ограничитель: если лимит превышен, автоматически отдает 429 и завершает запрос
 */
export async function enforceRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  options: RateLimitOptions = {}
): Promise<boolean> {
  try {
    const result = await checkRateLimit(req, res, options);

    if (!result.allowed) {
      res.status(429).json({
        success: false,
        error: 'Превышен лимит запросов к API. Пожалуйста, подождите перед повторной отправкой.',
        retryAfterSeconds: result.resetSeconds,
      });
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[RateLimit] Guard execution notice:', err);
    return true; // Fail open to guarantee endpoint availability
  }
}
