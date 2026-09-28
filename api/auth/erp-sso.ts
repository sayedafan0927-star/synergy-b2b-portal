import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { recordAuditLog } from '../audit/logs';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface ErpSsoPayload {
  sub: string;
  role: 'admin' | 'manager_rm' | 'manager_lm' | 'supplier' | 'client';
  name: string;
  phone: string;
  email?: string;
  partner_id?: string;
  showroom_warehouse_id?: number;
  exp: number;
  nonce?: string;
}

/**
 * Валидация криптографического токена из 1С / ERP
 */
function verifyErpToken(tokenStr: string, queryParams?: Record<string, any>): { valid: boolean; payload?: ErpSsoPayload; error?: string } {
  if (!SECRET_KEY) {
    return { valid: false, error: 'Конфигурация сервера: отсутствует ключ PORTAL_SECRET_KEY' };
  }

  // 1. Проверка спецификации ERP_INTEGRATION_SPEC.md (HMAC-SHA256 подпись: "{manager_id}:{role}:{timestamp}")
  if (queryParams && queryParams.manager_id && queryParams.timestamp) {
    const managerId = String(queryParams.manager_id).trim();
    const role = String(queryParams.role || 'manager_rm').trim() as any;
    const timestamp = Number(queryParams.timestamp);
    const phone = String(queryParams.phone || '').trim();
    const name = String(queryParams.name || 'Сотрудник 1С').trim();

    const payloadToSign = `${managerId}:${role}:${timestamp}`;
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(payloadToSign).digest('hex');

    if (tokenStr.toLowerCase() === expectedSig.toLowerCase()) {
      // Проверка срока жизни ссылки (15 минут по спецификации)
      const nowSec = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSec - timestamp) > 900) {
        return { valid: false, error: 'Срок действия одноразовой ссылки из 1С истек (TTL 15 мин)' };
      }

      return {
        valid: true,
        payload: {
          sub: managerId,
          role,
          name,
          phone,
          exp: (timestamp + 900) * 1000,
        },
      };
    }
  }

  // 2. Fallback: проверка токена в формате base64url JSON
  try {
    const raw = Buffer.from(tokenStr, 'base64url').toString('utf8');
    const { data, sig } = JSON.parse(raw);

    if (!data || !sig) {
      return { valid: false, error: 'Некорректный формат SSO-пакета' };
    }

    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(data)).digest('hex');
    if (sig !== expectedSig) {
      return { valid: false, error: 'Подпись токена не совпадает с секретным ключом портала' };
    }

    const payload = data as ErpSsoPayload;
    if (Date.now() > payload.exp) {
      return { valid: false, error: 'Срок действия одноразовой ссылки из 1С истек' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: `Сбой валидации SSO-токена: неверная подпись или формат` };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const correlationId = applyCorrelationId(req, res);

  // Строгий Rate Limiting для SSO (макс 15 попыток в минуту на IP)
  if (!enforceRateLimit(req, res, { limit: 15, windowSeconds: 60, actionPrefix: 'erp_sso' })) {
    return;
  }

  const { token, redirect_to } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).send('SSO Token is required');
  }

  const result = verifyErpToken(token, req.query);
  if (!result.valid || !result.payload) {
    await recordAuditLog({
      eventType: 'sso_auth_failed',
      direction: 'inbound',
      status: 'error',
      source: 'SSO Gateway',
      correlationId,
      errorMessage: result.error,
    });
    return res.status(401).send(`Ошибка авторизации из 1С: ${result.error}`);
  }

  const p = result.payload;
  const targetEmail = p.email || `${p.phone.replace(/\D+/g, '') || p.sub}@synergy-portal.kz`;

  try {
    // Синхронизируем профиль в БД Supabase
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('phone', p.phone)
      .maybeSingle();

    let targetUserId = existingProfile?.id;

    if (!targetUserId) {
      // Создаем/обновляем профиль
      const newUuid = crypto.randomUUID();
      targetUserId = newUuid;
      await supabase.from('profiles').upsert({
        id: newUuid,
        role: p.role,
        full_name: p.name,
        company_name: 'Synergy Group (1C:ERP)',
        phone: p.phone,
        partner_id: p.partner_id || null,
        updated_at: new Date().toISOString(),
      });
    } else {
      await supabase.from('profiles').update({
        role: p.role,
        full_name: p.name,
        updated_at: new Date().toISOString(),
      }).eq('id', targetUserId);
    }

    // Формируем безопасный криптографически подписанный сессионный токен для браузера
    const sessionData = {
      user: {
        id: targetUserId,
        email: targetEmail,
        user_metadata: { full_name: p.name },
      },
      profile: {
        id: targetUserId,
        role: p.role,
        full_name: p.name,
        phone: p.phone,
        partner_id: p.partner_id || null,
        company_name: 'Synergy Group (ERP)',
        price_type: 'wholesale',
      },
      timestamp: Date.now(),
    };

    const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
    const signedTokenPayload = {
      data: sessionData,
      sig,
    };

    const sessionToken = Buffer.from(JSON.stringify(signedTokenPayload)).toString('base64url');

    const dest = redirect_to ? String(redirect_to) : '/profile';
    const redirectUrl = `${dest}${dest.includes('?') ? '&' : '?'}sso_session=${sessionToken}`;

    return res.redirect(302, redirectUrl);
  } catch (err: any) {
    console.error('[ERP SSO] Error provisioning session:', err);
    return res.status(500).send(`Ошибка создания сессии сотрудника: ${err?.message}`);
  }
}
