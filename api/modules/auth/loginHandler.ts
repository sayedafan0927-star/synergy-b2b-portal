/**
 * Enterprise Authentication & Login Handler
 * Eliminates P0-1 Auth Bypass: Requires verified bcrypt password hash in database.
 * No arbitrary passwords allowed when password_hash is not set.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';
import { checkRateLimit } from '../../lib/rateLimit';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SECRET_KEY = process.env.PORTAL_SECRET_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export function generateSessionToken(sessionData: any): string {
  if (!SECRET_KEY) {
    throw new Error('PORTAL_SECRET_KEY is not configured on server');
  }
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
  const signedPayload = { data: sessionData, sig };
  return Buffer.from(JSON.stringify(signedPayload)).toString('base64url');
}

export async function handleLoginFallback(
  req: VercelRequest,
  res: VercelResponse,
  matchedClient: any,
  inputCleanPhone: string,
  inputLogin: string,
  inputPass: string,
  correlationId: string
): Promise<boolean> {
  // 0. Brute-Force & Credential Stuffing Guard (5 attempts / 60s per client/IP)
  const rl = await checkRateLimit(req, res, {
    limit: 5,
    windowSeconds: 60,
    actionPrefix: `auth_login_${inputCleanPhone || 'client'}`,
  });

  if (!rl.allowed) {
    logger.warn('[Auth] Rate limit exceeded on client login', {
      phone: inputCleanPhone,
      ip: rl.ip,
      correlationId,
    });
    res.status(429).json({
      success: false,
      code: 'TOO_MANY_REQUESTS',
      error: `Слишком много попыток входа. Повторите попытку через ${rl.resetSeconds} сек.`,
    });
    return true;
  }

  // 1. Проверка активности клиента
  if (
    matchedClient.is_active === 0 ||
    matchedClient.portal_access_enabled === false ||
    matchedClient.status === 'inactive' ||
    matchedClient.access === 'disabled'
  ) {
    logger.warn('[Auth] Attempt to login to deactivated account', {
      clientId: matchedClient.id,
      correlationId,
    });
    res.status(403).json({
      success: false,
      code: 'CLIENT_DEACTIVATED',
      error: 'Доступ к оптовому порталу заблокирован: учетная запись клиента деактивирована в ERP.',
    });
    return true;
  }

  // 2. Поиск хэша пароля в profiles
  const { data: dbProfile } = await supabase
    .from('profiles')
    .select('id, password_hash, role, is_blocked_for_shipment')
    .or(`phone.eq.${matchedClient.phone},partner_id.eq.${matchedClient.id}`)
    .maybeSingle();

  if (dbProfile?.is_blocked_for_shipment === true) {
    logger.warn('[Auth] Blocked login attempt: client profile is blocked for shipment', {
      clientId: matchedClient.id,
      correlationId,
    });
    res.status(403).json({
      success: false,
      code: 'CLIENT_DEACTIVATED',
      error: 'Доступ к оптовому порталу заблокирован администратором.',
    });
    return true;
  }

  // КРИТИЧЕСКИЙ ФИКС P0-1: Если password_hash не установлен, вход категорически ЗАПРЕЩЕН
  if (!dbProfile?.password_hash) {
    logger.warn('[Auth P0-1 Guard] Blocked login attempt: account has no password_hash configured', {
      clientId: matchedClient.id,
      phone: matchedClient.phone,
      correlationId,
    });
    res.status(401).json({
      success: false,
      code: 'PASSWORD_NOT_SET',
      error: `Для клиента «${matchedClient.name}» пароль еще не был установлен. Пожалуйста, обратитесь к персональному менеджеру для отправки ссылки активации.`,
    });
    return true;
  }

  // 3. Криптографическая проверка пароля (bcrypt / SHA-256 upgrade)
  let customPasswordMatched = false;
  const storedHash = String(dbProfile.password_hash).trim();

  try {
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
      customPasswordMatched = await bcrypt.compare(inputPass, storedHash);
    } else {
      // Поддержка legacy SHA-256 с прозрачной миграцией на bcrypt
      const inputHash = crypto.createHash('sha256').update(inputPass).digest('hex');
      if (storedHash === inputHash) {
        customPasswordMatched = true;
        try {
          const bcryptHash = await bcrypt.hash(inputPass, 10);
          await supabase
            .from('profiles')
            .update({ password_hash: bcryptHash, updated_at: new Date().toISOString() })
            .eq('id', dbProfile.id);
          logger.info('[Auth] Transparently upgraded password hash to bcrypt', { clientId: matchedClient.id });
        } catch (upgradeErr) {
          logger.warn('[Auth] Bcrypt upgrade notice:', { error: (upgradeErr as Error)?.message });
        }
      }
    }
  } catch (pwErr) {
    logger.warn('[Auth] Password verification exception:', pwErr as Error);
  }

  if (!customPasswordMatched) {
    logger.warn('[Auth] Invalid password provided for client', {
      clientId: matchedClient.id,
      correlationId,
    });
    res.status(401).json({
      success: false,
      code: 'AUTH_FAILED',
      error: `Неверный пароль для клиента «${matchedClient.name}».`,
    });
    return true;
  }

  // 4. Успешная авторизация — формирование сессии
  const pId = String(matchedClient.id || '');
  const uId = `erp-client-${pId}`;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resolvedProfileId = (dbProfile?.id && UUID_REGEX.test(dbProfile.id))
    ? dbProfile.id
    : crypto.randomUUID();
  const fName = String(matchedClient.name || 'Оптовый клиент');
  const priceType = String(matchedClient.price_type || 'wholesale');
  const debtUsd = typeof matchedClient.financials?.debt_usd === 'number' ? matchedClient.financials.debt_usd : (matchedClient.debt_usd || 0);
  const balanceUsd = typeof matchedClient.financials?.balance_usd === 'number' ? matchedClient.financials.balance_usd : (matchedClient.balance_usd || 0);

  const sessionData = {
    user: {
      id: resolvedProfileId,
      email: `${(matchedClient.phone || pId).replace(/\D+/g, '')}@kilem-khan.kz`,
      user_metadata: { full_name: fName, erp_client_id: uId },
    },
    profile: {
      id: resolvedProfileId,
      role: 'client',
      partner_id: pId,
      full_name: fName,
      phone: matchedClient.phone || inputLogin,
      company_name: fName,
      price_type: priceType,
      showroom_warehouse_id: matchedClient.showroom_warehouse_id ?? null,
    },
    timestamp: Date.now(),
  };

  const sessionToken = generateSessionToken(sessionData);

  // Синхронизация профиля в базе
  try {
    await supabase.from('profiles').upsert({
      id: resolvedProfileId,
      partner_id: pId,
      erp_id: Number(pId) || null,
      full_name: fName,
      company_name: fName,
      phone: matchedClient.phone || inputLogin,
      price_type: priceType,
      role: 'client',
      impersonation_enabled: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'partner_id' });
  } catch (e) {
    logger.warn('[Auth] Profile upsert notice:', e as Error);
  }

  res.status(200).json({
    success: true,
    token: sessionToken,
    portal_session_token: sessionToken,
    client_id: Number(pId),
    name: fName,
    phone: matchedClient.phone || inputLogin,
    is_initial_password: false,
    client: {
      id: Number(pId),
      name: fName,
      phone: matchedClient.phone || inputLogin,
      price_type: priceType,
      debt_usd: debtUsd,
      balance_usd: balanceUsd,
      showroom_warehouse_id: matchedClient.showroom_warehouse_id ?? null,
      showroom_warehouse_name: matchedClient.showroom_warehouse_name ?? null,
      regional_manager: matchedClient.regional_manager,
      contracts: matchedClient.contracts || [],
      financials: matchedClient.financials || { debt_usd: debtUsd, balance_usd: balanceUsd },
    },
  });

  return true;
}

/**
 * Enterprise Fallback: Безопасный вход сотрудников ERP (РМ, ЛМ, Администратор)
 * Ликвидирует P0 Auth Bypass: Категорически требует проверку пароля по bcrypt hash в profiles.
 */
export async function handleEmployeeLoginFallback(
  req: VercelRequest,
  res: VercelResponse,
  matchedEmp: any,
  inputCleanPhone: string,
  inputLogin: string,
  inputPass: string,
  correlationId: string
): Promise<boolean> {
  // 0. Brute-Force & Credential Stuffing Guard (5 attempts / 60s per employee/IP)
  const rl = await checkRateLimit(req, res, {
    limit: 5,
    windowSeconds: 60,
    actionPrefix: `auth_employee_${matchedEmp.id || inputCleanPhone || 'emp'}`,
  });

  if (!rl.allowed) {
    logger.warn('[Auth] Rate limit exceeded on employee login', {
      empId: matchedEmp.id,
      ip: rl.ip,
      correlationId,
    });
    res.status(429).json({
      success: false,
      code: 'TOO_MANY_REQUESTS',
      error: `Слишком много попыток входа. Повторите попытку через ${rl.resetSeconds} сек.`,
    });
    return true;
  }

  // 1. Проверяем наличие введенного пароля
  if (!inputPass) {
    logger.warn('[Auth P0 Guard] Employee login rejected: missing password', {
      empId: matchedEmp.id,
      login: inputLogin,
      correlationId,
    });
    res.status(401).json({
      success: false,
      code: 'PASSWORD_REQUIRED',
      error: 'Для входа сотрудника ERP обязательно требуется указать пароль.',
    });
    return true;
  }

  const empRole = matchedEmp.role === 'lm' ? 'manager_lm' : (matchedEmp.role === 'admin' ? 'admin' : 'manager_rm');
  const empName = matchedEmp.name || matchedEmp.username || 'Сотрудник ERP';
  const empPhone = matchedEmp.phone || inputLogin;
  const empId = matchedEmp.id;
  const uId = `erp-employee-${empId}`;

  // 2. Поиск хэша пароля сотрудника в profiles
  let dbProfile: any = null;
  if (supabase) {
    try {
      const qLow = inputLogin.toLowerCase().trim();
      const { data } = await supabase
        .from('profiles')
        .select('id, password_hash, role')
        .or(`id.eq.${empId},phone.eq.${empPhone},manager_id.eq.${empId},full_name.ilike.%${qLow}%`)
        .maybeSingle();
      dbProfile = data;
    } catch (e) {
      logger.warn('[Auth] Error looking up employee profile in Supabase:', e as Error);
    }
  }

  // Загрузка пароля сотрудника: строго из защищенной базы данных profiles (Master Record)
  const storedHash = String(dbProfile?.password_hash || '').trim();

  // Если пароль в базе не настроен и нет стартового хэша - блокируем вход
  if (!storedHash) {
    logger.warn('[Auth P0 Guard] Blocked employee login: account has no password_hash configured', {
      empId,
      phone: empPhone,
      correlationId,
    });
    res.status(401).json({
      success: false,
      code: 'PASSWORD_NOT_CONFIGURED',
      error: `Для учетной записи сотрудника «${empName}» пароль на портале не настроен. Обратитесь к главному администратору.`,
    });
    return true;
  }

  // 3. Криптографическая сверка пароля (bcrypt / SHA-256 fallback)
  let passwordMatched = false;

  try {
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
      passwordMatched = await bcrypt.compare(inputPass, storedHash);
    } else {
      const inputHash = crypto.createHash('sha256').update(inputPass).digest('hex');
      if (storedHash === inputHash) {
        passwordMatched = true;
        try {
          const bcryptHash = await bcrypt.hash(inputPass, 10);
          await supabase
            .from('profiles')
            .update({ password_hash: bcryptHash, updated_at: new Date().toISOString() })
            .eq('id', dbProfile.id);
          logger.info('[Auth] Upgraded employee password hash to bcrypt', { empId });
        } catch {}
      }
    }
  } catch (pwErr) {
    logger.warn('[Auth] Employee password verification exception:', pwErr as Error);
  }

  if (!passwordMatched) {
    logger.warn('[Auth P0 Guard] Invalid password for employee', { empId, correlationId });
    res.status(401).json({
      success: false,
      code: 'AUTH_FAILED',
      error: 'Неверный пароль сотрудника.',
    });
    return true;
  }

  // 4. Формирование сессии при успешной аутентификации
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resolvedEmpId = (dbProfile?.id && UUID_REGEX.test(dbProfile.id))
    ? dbProfile.id
    : crypto.randomUUID();

  const sessionData = {
    user: {
      id: resolvedEmpId,
      email: `${empPhone.replace(/\D+/g, '') || empId}@synergy-portal.kz`,
      user_metadata: { full_name: empName, erp_emp_id: uId },
    },
    profile: {
      id: resolvedEmpId,
      role: empRole,
      partner_id: null,
      full_name: empName,
      phone: empPhone,
      company_name: 'Synergy Group (ERP)',
      manager_id: String(empId),
      price_type: 'wholesale',
      impersonation_enabled: true,
    },
    timestamp: Date.now(),
  };

  const sessionToken = generateSessionToken(sessionData);

  try {
    const empProfilePayload = {
      role: empRole,
      full_name: empName,
      company_name: 'Synergy Group (ERP)',
      phone: empPhone,
      manager_id: String(empId),
      impersonation_enabled: true,
      updated_at: new Date().toISOString(),
    };
    if (dbProfile?.id) {
      await supabase.from('profiles').update(empProfilePayload).eq('id', dbProfile.id);
    } else {
      await supabase.from('profiles').insert({
        id: resolvedEmpId,
        ...empProfilePayload,
      });
    }
  } catch (e) {
    logger.warn('[Auth] Employee profile sync notice:', e as Error);
  }

  res.status(200).json({
    success: true,
    user_type: 'employee',
    manager_id: empId,
    name: empName,
    role: empRole,
    phone: empPhone,
    token: sessionToken,
    portal_session_token: sessionToken,
    employee: {
      id: empId,
      name: empName,
      role: empRole,
      phone: empPhone,
    },
  });

  return true;
}

