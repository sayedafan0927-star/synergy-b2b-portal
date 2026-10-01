import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';

import { authenticateRequest } from '../lib/authGuard';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseAdmin = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  applyCorrelationId(req, res);

  if (!(await enforceRateLimit(req, res, { limit: 30, windowSeconds: 60, actionPrefix: 'client_token' }))) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Защита от P0 Auth-Bypass: выпуск сессионного токена строго защищен
  // Допускаются только доверенный бэкенд ERP (по X-Portal-Key) либо авторизованный персонал (admin / manager)
  const authCtx = await authenticateRequest(req, {
    requiredRoles: ['admin', 'manager_rm', 'manager_lm', 'client'],
    allowServerKey: true,
  });

  if (!authCtx.isAuthenticated) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Генерация сессионного токена требует действующей авторизации или мастер-ключа ERP (Anti-Spoofing Guard).',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { client, user } = body || {};

    if (!client || !client.id) {
      return res.status(400).json({ success: false, error: 'Параметры клиента обязательны' });
    }

    const partnerId = String(client.partner_id || client.id);

    if (!authCtx.isServer && authCtx.role !== 'admin') {
      const callerPartnerId = String(authCtx.partnerId || '');
      if (authCtx.role === 'client' && (!callerPartnerId || callerPartnerId !== partnerId)) {
        return res.status(403).json({ success: false, error: 'Forbidden: Access to other clients is denied.' });
      }
      if (callerPartnerId && callerPartnerId !== partnerId) {
        return res.status(403).json({ success: false, error: 'Forbidden: Access to other clients is denied.' });
      }
    }

    const userId = String(client.id || user?.id || `erp-client-${partnerId}`);
    const fullName = String(client.full_name || client.name || 'Оптовый клиент');
    const phone = String(client.phone || '');
    const priceType = String(client.price_type || 'wholesale');

    // Обеспечиваем наличие профиля в PostgreSQL (profiles)
    try {
      await supabaseAdmin.from('profiles').upsert({
        id: userId.includes('-') && userId.length >= 32 ? userId : crypto.randomUUID(),
        partner_id: partnerId,
        erp_id: Number(partnerId) || null,
        full_name: fullName,
        company_name: client.company_name || fullName,
        phone,
        price_type: priceType,
        role: 'client',
        impersonation_enabled: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'partner_id' });
    } catch (dbErr) {
      console.warn('[Client Token API] Notice upserting profile:', dbErr);
    }

    // Формируем подписанный токен сессии (HMAC-SHA256)
    const sessionData = {
      user: {
        id: userId,
        email: user?.email || `${phone.replace(/\D+/g, '') || partnerId}@kilem-khan.kz`,
        user_metadata: { full_name: fullName },
      },
      profile: {
        id: userId,
        role: 'client',
        partner_id: partnerId,
        full_name: fullName,
        phone,
        company_name: client.company_name || fullName,
        price_type: priceType,
        showroom_warehouse_id: client.showroom_warehouse_id ?? null,
      },
      timestamp: Date.now(),
    };

    const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
    const signedPayload = {
      data: sessionData,
      sig,
    };

    const token = Buffer.from(JSON.stringify(signedPayload)).toString('base64url');

    return res.status(200).json({
      success: true,
      token,
      user: sessionData.user,
      profile: sessionData.profile,
    });
  } catch (err: any) {
    console.error('[Client Token API] Error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
}
