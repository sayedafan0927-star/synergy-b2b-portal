import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { authenticateRequest } from '../lib/authGuard';
import { recordAuditLog } from '../audit/logs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabaseAdmin = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) {
    return;
  }

  const correlationId = applyCorrelationId(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Expected POST.' });
  }

  // Rate limiting: 10 попыток смены пароля в 10 минут
  if (!(await enforceRateLimit(req, res, { limit: 10, windowSeconds: 600, actionPrefix: 'change_password' }))) {
    return;
  }

  const authCtx = await authenticateRequest(req, { allowServerKey: true });
  if (!authCtx.isAuthenticated) {
    return res.status(401).json({
      success: false,
      error: authCtx.error || 'Требуется авторизация для смены пароля.',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { new_password, newPassword } = body || {};
    const targetPassword = String(new_password || newPassword || '').trim();

    if (!targetPassword || targetPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Новый пароль должен содержать не менее 6 символов.',
      });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({
        success: false,
        error: 'Ошибка подключения к базе данных аутентификации.',
      });
    }

    // Криптографическое хеширование через bcrypt с cost factor 10
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(targetPassword, saltRounds);

    let updated = false;

    // 1. Поиск и обновление профиля по userId
    if (authCtx.userId) {
      const { data: updatedRow, error: upErr } = await supabaseAdmin
        .from('profiles')
        .update({
          password_hash: hashedPassword,
          updated_at: new Date().toISOString(),
        })
        .eq('id', authCtx.userId)
        .select('id')
        .maybeSingle();

      if (!upErr && updatedRow) {
        updated = true;
      }
    }

    // 2. Если по id не найден, но есть partnerId (клиент ERP)
    if (!updated && authCtx.partnerId) {
      const { data: updatedPartner, error: partErr } = await supabaseAdmin
        .from('profiles')
        .update({
          password_hash: hashedPassword,
          updated_at: new Date().toISOString(),
        })
        .eq('partner_id', authCtx.partnerId)
        .select('id')
        .maybeSingle();

      if (!partErr && updatedPartner) {
        updated = true;
      }
    }

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Профиль пользователя для сохранения пароля не найден.',
      });
    }

    await recordAuditLog({
      eventType: 'password_changed',
      direction: 'inbound',
      status: 'success',
      source: 'Change Password API',
      correlationId,
      payload: {
        userId: authCtx.userId,
        role: authCtx.role,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Пароль успешно обновлен с криптографическим хешированием.',
    });
  } catch (err: any) {
    console.error('[ChangePassword] Exception:', err);
    return res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка при обновлении пароля.',
      details: err?.message,
    });
  }
}
