import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { applyCorsHeaders } from '../lib/cors';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { token } = body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);

    if (parsed.data && parsed.sig) {
      const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(parsed.data)).digest('hex');
      if (parsed.sig !== expectedSig) {
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
    return res.status(400).json({ success: false, error: 'Ошибка верификации токена: ' + err.message });
  }
}
