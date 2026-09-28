import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Извлечение или генерация сквозного идентификатора трассировки (Correlation-ID)
 */
export function getOrCreateCorrelationId(req: VercelRequest): string {
  const header = req.headers['x-correlation-id'] || req.headers['x-request-id'];
  if (header) {
    return Array.isArray(header) ? header[0] : String(header);
  }
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `trc_${timestamp}_${randomPart}`;
}

/**
 * Применение Correlation-ID к HTTP-ответу и возврат значения
 */
export function applyCorrelationId(req: VercelRequest, res: VercelResponse): string {
  const correlationId = getOrCreateCorrelationId(req);
  res.setHeader('X-Correlation-ID', correlationId);
  return correlationId;
}
