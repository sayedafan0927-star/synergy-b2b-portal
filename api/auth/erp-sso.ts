import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { recordAuditLog } from '../audit/logs';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || 'SynergySecretKey2025';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';

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
function verifyErpToken(tokenStr: string): { valid: boolean; payload?: ErpSsoPayload; error?: string } {
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
    return { valid: false, error: `Сбой парсинга токена: ${err?.message}` };
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

  const result = verifyErpToken(token);
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
