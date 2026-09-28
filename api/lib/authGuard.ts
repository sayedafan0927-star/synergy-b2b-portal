import type { VercelRequest } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

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

  try {
    let userId: string | undefined;
    let fallbackRole: 'admin' | 'manager_rm' | 'manager_lm' | 'supplier' | 'client' | undefined;
    let fallbackPartnerId: string | null | undefined;
    let fallbackPhone: string | undefined;
    let fallbackFullName: string | undefined;
    let fallbackPriceType: string | undefined;

    // 2.1. Проверка криптографически подписанного HMAC-токена сессии портала (SSO / ERP Login)
    const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
    if (SECRET_KEY) {
      try {
        const raw = Buffer.from(token, 'base64url').toString('utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.data && parsed?.sig) {
          const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(parsed.data)).digest('hex');
          if (parsed.sig === expectedSig) {
            // Проверка срока жизни токена (24 часа)
            const tokenTs = Number(parsed.data.timestamp || 0);
            if (!tokenTs || Date.now() - tokenTs <= 24 * 3600 * 1000) {
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
