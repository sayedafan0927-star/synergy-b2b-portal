import type { VercelRequest } from '@vercel/node';
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
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      return {
        isAuthenticated: false,
        isServer: false,
        error: `Недействительный или истекший JWT токен: ${authError?.message || 'Пользователь не найден'}`,
      };
    }

    const userId = authData.user.id;

    // 3. Загружаем подтвержденный профиль из PostgreSQL (Master Data)
    const { data: profile, error: profError } = await supabaseAdmin
      .from('profiles')
      .select('id, role, partner_id, erp_id, full_name, company_name, phone, price_type')
      .eq('id', userId)
      .maybeSingle();

    if (profError || !profile) {
      return {
        isAuthenticated: false,
        isServer: false,
        userId,
        error: 'Профиль пользователя не найден в системе',
      };
    }

    // 4. Проверка RBAC ролей (если указаны)
    if (options.requiredRoles && options.requiredRoles.length > 0) {
      if (!options.requiredRoles.includes(profile.role as any)) {
        return {
          isAuthenticated: true,
          isServer: false,
          userId,
          role: profile.role,
          partnerId: profile.partner_id,
          error: `Доступ запрещен. Требуется одна из ролей: ${options.requiredRoles.join(', ')}`,
        };
      }
    }

    return {
      isAuthenticated: true,
      isServer: false,
      userId,
      role: profile.role,
      partnerId: profile.partner_id,
      erpId: profile.erp_id,
      priceType: profile.price_type || 'wholesale',
      fullName: profile.full_name,
      companyName: profile.company_name,
      phone: profile.phone,
    };
  } catch (err: any) {
    return {
      isAuthenticated: false,
      isServer: false,
      error: `Ошибка проверки авторизации: ${err?.message}`,
    };
  }
}
