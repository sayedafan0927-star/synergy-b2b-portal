import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { applyCorsHeaders } from '../lib/cors';
import { enforceRateLimit } from '../lib/rateLimit';
import { getRedisClient } from '../lib/redis';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  // Rate Limiting (60 запросов в минуту на IP)
  if (!(await enforceRateLimit(req, res, { limit: 60, windowSeconds: 60, actionPrefix: 'verify_sso' }))) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!SECRET_KEY) {
    return res.status(500).json({ success: false, error: 'PORTAL_SECRET_KEY is not configured on server' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { token } = body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    // Проверка отзыва токена через Redis blacklist
    const redis = getRedisClient();
    if (redis) {
      try {
        const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
        const isRevoked = await redis.exists(`revoked:${tokenHash}`);
        if (isRevoked) {
          return res.status(401).json({
            success: false,
            error: 'Токен авторизации был отозван (Revoked Session). Пожалуйста, выполните вход повторно.',
          });
        }
      } catch (revErr) {
        console.warn('[VerifySSO] Redis revocation check notice:', revErr);
      }
    }

    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);

    if (parsed.data && parsed.sig) {
      const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(parsed.data)).digest('hex');
      const sigBuf = Buffer.from(String(parsed.sig || ''), 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');

      // Защита от Timing Attacks через timingSafeEqual
      const isSigValid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
      if (!isSigValid) {
        return res.status(401).json({ success: false, error: 'Недействительная цифровая подпись сессии SSO' });
      }

      // Проверка срока жизни сессии (24 часа)
      if (parsed.data.timestamp && Date.now() - parsed.data.timestamp > 24 * 3600 * 1000) {
        return res.status(401).json({ success: false, error: 'Срок действия сессии SSO истек' });
      }

      return res.status(200).json({
        success: true,
        user: parsed.data.user,
        profile: parsed.data.profile,
        token,
        portal_session_token: token,
      });
    }

    return res.status(401).json({ success: false, error: 'Неподписанный или поврежденный токен сессии' });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: 'Ошибка верификации токена: ' + err?.message });
  }
}
