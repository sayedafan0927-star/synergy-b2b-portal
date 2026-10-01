import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { recordAuditLog } from '../audit/logs';
import { getRedisClient } from '../lib/redis';

// Реестр использованных одноразовых ссылок в памяти (L1 Fallback при недоступности Redis)
const memoryUsedNonces = new Map<string, number>();

function isMemoryNonceConsumed(nonceKey: string): boolean {
  const now = Date.now();
  for (const [k, exp] of memoryUsedNonces.entries()) {
    if (exp <= now) memoryUsedNonces.delete(k);
  }
  if (memoryUsedNonces.has(nonceKey)) {
    return true;
  }
  memoryUsedNonces.set(nonceKey, now + 900 * 1000);
  return false;
}

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

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
  try {
    const correlationId = applyCorrelationId(req, res);

    // Строгий Rate Limiting для SSO (макс 15 попыток в минуту на IP)
    if (!(await enforceRateLimit(req, res, { limit: 15, windowSeconds: 60, actionPrefix: 'erp_sso' }))) {
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

    // Защита от Replay-атак (One-Time Token Consumption)
    const rawNonce = String(req.query.nonce || p.nonce || token).trim();
    const nonceFingerprint = crypto.createHash('sha256').update(rawNonce).digest('hex');
    const redis = getRedisClient();

    let isConsumed = false;
    if (redis) {
      try {
        const redisKey = `sso:consumed:${nonceFingerprint}`;
        const setOk = await redis.set(redisKey, '1', { nx: true, ex: 900 });
        if (!setOk) {
          isConsumed = true;
        }
      } catch (redisErr) {
        console.warn('[SSO Gateway] Redis nonce check warning, using memory:', redisErr);
        isConsumed = isMemoryNonceConsumed(nonceFingerprint);
      }
    } else {
      isConsumed = isMemoryNonceConsumed(nonceFingerprint);
    }

    if (isConsumed) {
      await recordAuditLog({
        eventType: 'sso_replay_blocked',
        direction: 'inbound',
        status: 'error',
        source: 'SSO Gateway',
        correlationId,
        errorMessage: 'Одноразовая ссылка автовхода уже была использована (Replay Attack blocked)',
      });
      return res.status(403).send('Ошибка авторизации: одноразовая ссылка для входа уже была использована ранее.');
    }

  try {
    // Синхронизируем профиль в БД Supabase
    let profileQuery = supabase.from('profiles').select('id, role, partner_id, is_blocked_for_shipment');
    if (p.phone && p.phone.trim().length > 0) {
      profileQuery = profileQuery.eq('phone', p.phone);
    } else {
      profileQuery = profileQuery.eq('partner_id', String(p.sub));
    }
    const { data: existingProfile } = await profileQuery.maybeSingle();

    const effectivePartnerId = String(existingProfile?.partner_id || p.partner_id || p.sub || '').trim();

    // Проверка блокировки / деактивации клиента в 1С:ERP
    if (existingProfile?.is_blocked_for_shipment) {
      await recordAuditLog({
        eventType: 'sso_auth_blocked',
        direction: 'inbound',
        status: 'error',
        source: 'SSO Gateway',
        correlationId,
        errorMessage: `Клиент ${effectivePartnerId} заблокирован для отгрузок (is_blocked_for_shipment)`,
      });
      return res.status(403).send('Доступ заблокирован: учетная запись контрагента деактивирована в 1С:ERP.');
    }

    if (redis && effectivePartnerId) {
      try {
        const isRevoked = await redis.get(`revoked_partner:${effectivePartnerId}`);
        if (isRevoked) {
          await recordAuditLog({
            eventType: 'sso_auth_revoked',
            direction: 'inbound',
            status: 'error',
            source: 'SSO Gateway',
            correlationId,
            errorMessage: `Клиент ${effectivePartnerId} отозван по вебхуку деактивации`,
          });
          return res.status(403).send('Доступ заблокирован: сессия партнера отозвана по требованию 1С:ERP.');
        }
      } catch (redisCheckErr) {
        console.warn('[SSO Gateway] Redis partner revocation check warning:', redisCheckErr);
      }
    }

    let targetUserId = existingProfile?.id;

    if (!targetUserId) {
      // Создаем/обновляем профиль
      const newUuid = crypto.randomUUID();
      targetUserId = newUuid;
      await supabase.from('profiles').upsert({
        id: newUuid,
        role: p.role,
        full_name: p.name,
        company_name: 'Synergy Group (ERP)',
        phone: p.phone || '',
        partner_id: p.partner_id || String(p.sub) || null,
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

    // Anti-Open-Redirect Guard: разрешены строго внутренние относительные пути (/profile, /catalog и т.д.)
    let safeDest = '/profile';
    if (redirect_to && typeof redirect_to === 'string') {
      const trimmedDest = redirect_to.trim();
      // Запрещаем протоколы (http:, https:), protocol-relative URL (//evil.com) и обратные слэши
      if (trimmedDest.startsWith('/') && !trimmedDest.startsWith('//') && !trimmedDest.includes('\\') && !/^\/[a-z0-9]+:/i.test(trimmedDest)) {
        safeDest = trimmedDest;
      }
    }
    const redirectUrl = `${safeDest}${safeDest.includes('?') ? '&' : '?'}sso_session=${sessionToken}`;

    return res.redirect(302, redirectUrl);
  } catch (err: any) {
    console.error('[ERP SSO] Error provisioning session:', err);
    return res.status(500).send(`Ошибка создания сессии сотрудника: ${err?.message}`);
  }
} catch (fatalErr: any) {
  console.error('[ERP SSO Fatal Error]', fatalErr);
  return res.status(500).send(`Ошибка сервера: ${fatalErr?.message}`);
}
}
