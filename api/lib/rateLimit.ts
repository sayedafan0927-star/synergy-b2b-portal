import type { VercelRequest, VercelResponse } from '@vercel/node';

interface RateLimitRecord {
  timestamps: number[];
}

// In-memory хранилище логов запросов по ключу
const rateLimitMap = new Map<string, RateLimitRecord>();

// Периодическая очистка устаревших записей памяти раз в 2 минуты
setInterval(() => {
  const cutoff = Date.now() - 300000; // 5 минут назад
  for (const [key, record] of rateLimitMap.entries()) {
    record.timestamps = record.timestamps.filter(t => t > cutoff);
    if (record.timestamps.length === 0) {
      rateLimitMap.delete(key);
    }
  }
}, 120000);

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
 * Проверка лимита частоты запросов (Sliding Window Algorithm)
 */
export function checkRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  options: RateLimitOptions = {}
): { allowed: boolean; remaining: number; resetSeconds: number; ip: string } {
  const limit = options.limit || 60;
  const windowMs = (options.windowSeconds || 60) * 1000;
  const ip = getClientIp(req);
  const key = `${options.actionPrefix || 'general'}:${ip}`;

  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitMap.get(key);
  if (!record) {
    record = { timestamps: [] };
    rateLimitMap.set(key, record);
  }

  // Очищаем отметки времени старше текущего окна
  record.timestamps = record.timestamps.filter(t => t > windowStart);

  const resetSeconds = record.timestamps.length > 0
    ? Math.max(1, Math.ceil((record.timestamps[0] + windowMs - now) / 1000))
    : Math.ceil(windowMs / 1000);

  if (record.timestamps.length >= limit) {
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', resetSeconds);
    res.setHeader('Retry-After', resetSeconds);

    return {
      allowed: false,
      remaining: 0,
      resetSeconds,
      ip,
    };
  }

  // Добавляем текущую отметку
  record.timestamps.push(now);
  const remaining = Math.max(0, limit - record.timestamps.length);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetSeconds);

  return {
    allowed: true,
    remaining,
    resetSeconds,
    ip,
  };
}

/**
 * Валидатор и ограничитель: если лимит превышен, автоматически отдает 429 и завершает запрос
 */
export function enforceRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  options: RateLimitOptions = {}
): boolean {
  const result = checkRateLimit(req, res, options);

  if (!result.allowed) {
    res.status(429).json({
      success: false,
      error: 'Превышен лимит запросов к API. Пожалуйста, подождите перед повторной отправкой.',
      retryAfterSeconds: result.resetSeconds,
    });
    return false;
  }

  return true;
}
