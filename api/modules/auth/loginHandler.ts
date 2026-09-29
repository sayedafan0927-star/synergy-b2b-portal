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
    .select('id, password_hash, role')
    .or(`phone.eq.${matchedClient.phone},partner_id.eq.${matchedClient.id}`)
    .maybeSingle();

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
  const fName = String(matchedClient.name || 'Оптовый клиент');
  const priceType = String(matchedClient.price_type || 'wholesale');
  const debtUsd = typeof matchedClient.financials?.debt_usd === 'number' ? matchedClient.financials.debt_usd : (matchedClient.debt_usd || 0);
  const balanceUsd = typeof matchedClient.financials?.balance_usd === 'number' ? matchedClient.financials.balance_usd : (matchedClient.balance_usd || 0);

  const sessionData = {
    user: {
      id: uId,
      email: `${(matchedClient.phone || pId).replace(/\D+/g, '')}@kilem-khan.kz`,
      user_metadata: { full_name: fName },
    },
    profile: {
      id: uId,
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
      id: dbProfile?.id || crypto.randomUUID(),
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
