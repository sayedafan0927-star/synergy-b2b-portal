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
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  applyCorrelationId(req, res);

  if (!(await enforceRateLimit(req, res, { limit: 120, windowSeconds: 60, actionPrefix: 'session_token' }))) {
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
    const { role = 'client', user, profile } = body || {};

    const validRoles = ['admin', 'manager_rm', 'manager_lm', 'supplier', 'client'];
    const effectiveRole = validRoles.includes(role) ? role : (profile?.role && validRoles.includes(profile.role) ? profile.role : 'client');

    // Anti-Bypass P0: Запрет произвольного назначения ролей и выпуска токенов без подтвержденной серверной аутентификации
    const callerAuth = await authenticateRequest(req, { allowServerKey: true });

    if (!callerAuth.isAuthenticated && !callerAuth.isServer) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Выпуск или обновление сессионного токена требует действующей авторизации или мастер-ключа ERP (Anti-Spoofing Guard).',
      });
    }

    const isPrivileged = ['admin', 'manager_rm', 'manager_lm', 'supplier'].includes(effectiveRole);

    if (isPrivileged) {
      if (!callerAuth.isServer && callerAuth.role !== 'admin' && callerAuth.role !== effectiveRole) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Повышение привилегий до роли сотрудника или администратора запрещено без валидной серверной авторизации.',
        });
      }
    } else if (callerAuth.role === 'supplier' && !callerAuth.isServer) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Учетные записи поставщиков (фабрик) не имеют прав выпускать клиентские сессионные токены.',
      });
    } else if (callerAuth.role === 'client' && !callerAuth.isServer) {
      // IDOR Guard: Клиент может обновлять токен исключительно для своего собственного подтвержденного partner_id
      const requestedPartnerId = profile?.partner_id ? String(profile.partner_id) : (callerAuth.partnerId || null);
      if (callerAuth.partnerId && requestedPartnerId && String(callerAuth.partnerId) !== String(requestedPartnerId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Попытка выпуска сессионного токена для чужого контрагента заблокирована (Anti-IDOR Guard).',
        });
      }
      if (!callerAuth.partnerId && requestedPartnerId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Неавторизованное назначение partner_id запрещено для неподтвержденных пользователей.',
        });
      }
    }

    const userId = (!callerAuth.isServer && callerAuth.role !== 'admin')
      ? String(callerAuth.userId || user?.id || profile?.id || `user-${effectiveRole}`)
      : String(user?.id || profile?.id || callerAuth.userId || `user-${effectiveRole}`);
    const fullName = String(
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      callerAuth.fullName ||
      (effectiveRole === 'admin' ? 'Администратор портала' : 'Пользователь портала')
    );
    // Для клиентов фиксируем partnerId, priceType, b2b_role и showroom_warehouse_id исключительно из подтвержденной сессии (Anti-Privilege Escalation)
    const partnerId = (!callerAuth.isServer && callerAuth.role === 'client')
      ? (callerAuth.partnerId || null)
      : (profile?.partner_id ? String(profile.partner_id) : (callerAuth.partnerId || null));
    const phone = String(profile?.phone || user?.phone || callerAuth.phone || '');

    let dbPriceType: string | null = null;
    const isManagerCaller = !callerAuth.isServer && (callerAuth.role === 'manager_rm' || callerAuth.role === 'manager_lm');
    if (isManagerCaller && partnerId && supabase) {
      try {
        const { data: clientProf } = await supabase
          .from('profiles')
          .select('price_type')
          .eq('partner_id', String(partnerId))
          .limit(1)
          .maybeSingle();
        if (clientProf?.price_type) dbPriceType = String(clientProf.price_type);
      } catch {}
    }

    const priceType = (!callerAuth.isServer && callerAuth.role === 'client')
      ? String(callerAuth.priceType || 'wholesale')
      : isManagerCaller
      ? String(dbPriceType || 'wholesale')
      : String(profile?.price_type || callerAuth.priceType || 'wholesale');
    const b2bRole = (!callerAuth.isServer && callerAuth.role === 'client')
      ? (callerAuth.b2bRole || 'director')
      : (profile?.b2b_role || callerAuth.b2bRole || 'director');
    const showroomWarehouseId = (!callerAuth.isServer && callerAuth.role === 'client')
      ? (callerAuth.showroomWarehouseId ?? null)
      : (profile?.showroom_warehouse_id ?? callerAuth.showroomWarehouseId ?? null);

    const sessionData = {
      user: {
        id: userId,
        email: user?.email || `${effectiveRole}@kilem-khan.kz`,
        user_metadata: { full_name: fullName },
      },
      profile: {
        id: userId,
        role: effectiveRole,
        b2b_role: b2bRole,
        partner_id: partnerId,
        full_name: fullName,
        company_name: profile?.company_name || callerAuth.companyName || 'ТОО «Kilem Khan Synergy»',
        phone,
        price_type: priceType,
        showroom_warehouse_id: showroomWarehouseId,
      },
      two_factor_verified: Boolean(callerAuth.isTwoFactorVerified),
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
      portal_session_token: token,
      user: sessionData.user,
      profile: sessionData.profile,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
}
