import type { VercelRequest } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getRedisClient } from './redis';
import { getErpApiKey } from './erpKey';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SERVER_ERP_KEY = getErpApiKey();

const supabaseAdmin = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export interface AuthenticatedContext {
  isAuthenticated: boolean;
  isServer: boolean;
  userId?: string;
  role?: 'admin' | 'manager_rm' | 'manager_lm' | 'supplier' | 'client';
  partnerId?: string | null;
  erpId?: number | null;
  priceType?: string;
  fullName?: string;
  companyName?: string;
  phone?: string;
  error?: string;
}

/**
 * Revokes a session token by storing its hash in Redis blacklist
 */
export async function revokeToken(token: string, ttlSeconds: number = 7200): Promise<boolean> {
  const redis = getRedisClient();
  if (redis && token) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
      await redis.set(`revoked:${tokenHash}`, '1', { ex: ttlSeconds });
      return true;
    } catch (e) {
      console.warn('[AuthGuard] Failed to revoke token in Redis:', e);
    }
  }
  return false;
}

/**
 * Криптографическая валидация сессии пользователя через Supabase Auth JWT
 * либо авторизация доверенного сервера ERP по X-Portal-Key.
 */
export async function authenticateRequest(
  req: VercelRequest,
  options: {
    requiredRoles?: Array<'admin' | 'manager_rm' | 'manager_lm' | 'supplier' | 'client'>;
    allowServerKey?: boolean;
  } = {}
): Promise<AuthenticatedContext> {
  const allowServerKey = options.allowServerKey !== false;
  const portalKeyHeader = (req.headers['x-portal-key'] || req.headers['X-Portal-Key']) as string | undefined;

  // 1. Проверка прямого защищенного ключа сервера ERP
  if (allowServerKey && portalKeyHeader && SERVER_ERP_KEY && portalKeyHeader === SERVER_ERP_KEY) {
    return {
      isAuthenticated: true,
      isServer: true,
      role: 'admin',
    };
  }

  // 2. Извлечение и криптографическая верификация Bearer JWT токена
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      isAuthenticated: false,
      isServer: false,
      error: 'Отсутствует или недействителен заголовок авторизации Authorization: Bearer <token>',
    };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return {
      isAuthenticated: false,
      isServer: false,
      error: 'Пустой токен авторизации',
    };
  }

  // Проверка отзыва токена через Redis blacklist (T-15)
  const redis = getRedisClient();
  if (redis) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const isRevoked = await redis.exists(`revoked:${tokenHash}`);
      if (isRevoked) {
        return {
          isAuthenticated: false,
          isServer: false,
          error: 'Токен авторизации был отозван (Revoked Session). Пожалуйста, выполните вход повторно.',
        };
      }
    } catch (revErr) {
      console.warn('[AuthGuard] Redis revocation check notice:', revErr);
    }
  }

  try {
    let userId: string | undefined;
    let fallbackRole: 'admin' | 'manager_rm' | 'manager_lm' | 'supplier' | 'client' | undefined;
    let fallbackPartnerId: string | null | undefined;
    let fallbackPhone: string | undefined;
    let fallbackFullName: string | undefined;
    let fallbackPriceType: string | undefined;

    const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
    if (SECRET_KEY) {
      try {
        const raw = Buffer.from(token, 'base64url').toString('utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.data && parsed?.sig) {
          const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(parsed.data)).digest('hex');
          if (parsed.sig === expectedSig) {
            // Проверка срока жизни токена: сокращено с 24 часов до 2 часов (Enterprise standard T-15)
            const tokenTs = Number(parsed.data.timestamp || 0);
            if (!tokenTs || Date.now() - tokenTs <= 2 * 3600 * 1000) {
              const u = parsed.data.user || {};
              const p = parsed.data.profile || {};
              userId = String(u.id || p.id || '');
              fallbackRole = p.role || u.role || 'client';
              fallbackPartnerId = p.partner_id ? String(p.partner_id) : null;
              fallbackPhone = p.phone || u.phone;
              fallbackFullName = p.full_name || u.full_name || u.user_metadata?.full_name;
              fallbackPriceType = p.price_type || 'wholesale';
            }
          }
        }
      } catch {
        // Не JSON/HMAC токен — продолжаем проверку через Supabase Auth JWT
      }
    }

    // 2.2. Если не HMAC-токен — валидируем как стандартный Supabase Auth JWT
    if (!userId) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !authData?.user) {
        return {
          isAuthenticated: false,
          isServer: false,
          error: `Недействительный или истекший JWT токен: ${authError?.message || 'Пользователь не найден'}`,
        };
      }
      userId = authData.user.id;
    }

    // 3. Загружаем подтвержденный профиль из PostgreSQL (Master Data)
    let profile: any = null;
    if (userId) {
      const { data: dbProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, partner_id, erp_id, full_name, company_name, phone, price_type')
        .eq('id', userId)
        .maybeSingle();
      
      profile = dbProfile;

      // Если в БД профиль еще не сохранен по ID, но есть partner_id или телефон из HMAC
      if (!profile && fallbackPartnerId) {
        const { data: pByPartner } = await supabaseAdmin
          .from('profiles')
          .select('id, role, partner_id, erp_id, full_name, company_name, phone, price_type')
          .eq('partner_id', fallbackPartnerId)
          .maybeSingle();
        profile = pByPartner;
      }
    }

    // При использовании HMAC-сессии допускаем валидированные данные профиля
    const effectiveRole = (profile?.role || fallbackRole || 'client') as any;
    const effectivePartnerId = profile?.partner_id || fallbackPartnerId;
    const effectiveErpId = profile?.erp_id || (effectivePartnerId ? Number(effectivePartnerId) || null : null);
    const effectivePriceType = profile?.price_type || fallbackPriceType || 'wholesale';
    const effectiveFullName = profile?.full_name || fallbackFullName || '';
    const effectivePhone = profile?.phone || fallbackPhone || '';

    // 4. Проверка RBAC ролей (если указаны)
    if (options.requiredRoles && options.requiredRoles.length > 0) {
      if (!options.requiredRoles.includes(effectiveRole)) {
        return {
          isAuthenticated: true,
          isServer: false,
          userId,
          role: effectiveRole,
          partnerId: effectivePartnerId,
          error: `Доступ запрещен. Требуется одна из ролей: ${options.requiredRoles.join(', ')}`,
        };
      }
    }

    return {
      isAuthenticated: true,
      isServer: false,
      userId,
      role: effectiveRole,
      partnerId: effectivePartnerId,
      erpId: effectiveErpId,
      priceType: effectivePriceType,
      fullName: effectiveFullName,
      companyName: profile?.company_name || effectiveFullName,
      phone: effectivePhone,
    };
  } catch (err: any) {
    return {
      isAuthenticated: false,
      isServer: false,
      error: `Ошибка проверки авторизации: ${err?.message}`,
    };
  }
}
