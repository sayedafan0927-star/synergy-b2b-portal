import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { authenticateRequest } from '../lib/authGuard';

const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';

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

    const userId = String(user?.id || profile?.id || callerAuth.userId || `user-${effectiveRole}`);
    const fullName = String(
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      callerAuth.fullName ||
      (effectiveRole === 'admin' ? 'Администратор портала' : 'Пользователь портала')
    );
    // Для клиентов фиксируем partnerId исключительно из подтвержденной сессии
    const partnerId = (!callerAuth.isServer && callerAuth.role === 'client')
      ? (callerAuth.partnerId || null)
      : (profile?.partner_id ? String(profile.partner_id) : (callerAuth.partnerId || null));
    const phone = String(profile?.phone || user?.phone || callerAuth.phone || '');
    const priceType = String(profile?.price_type || callerAuth.priceType || 'wholesale');

    const sessionData = {
      user: {
        id: userId,
        email: user?.email || `${effectiveRole}@kilem-khan.kz`,
        user_metadata: { full_name: fullName },
      },
      profile: {
        id: userId,
        role: effectiveRole,
        partner_id: partnerId,
        full_name: fullName,
        company_name: profile?.company_name || callerAuth.companyName || 'ТОО «Kilem Khan Synergy»',
        phone,
        price_type: priceType,
        showroom_warehouse_id: profile?.showroom_warehouse_id ?? null,
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
