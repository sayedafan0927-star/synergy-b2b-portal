import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '../../approvals/whatsapp';
import { recordAuditLog } from '../../audit/logs';
import { getClientIp } from '../../lib/rateLimit';

export async function handleNotifyDealerRegistration(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  correlationId: string,
) {
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(payload?.email || '').trim();
    const fullName = String(payload?.full_name || payload?.fullName || '').trim();
    const companyName = String(payload?.company_name || payload?.companyName || '').trim();
    const phone = String(payload?.phone || '').trim();
    const city = String(payload?.city || '').trim();

    if (!email && !companyName) {
      return res.status(400).json({
        success: false,
        error: 'Требуется указать email или название компании',
      });
    }

    // 1. Фиксация в журнале аудита безопасности
    await recordAuditLog({
      eventType: 'dealer_registration_submitted',
      direction: 'inbound',
      status: 'success',
      source: 'Dealer Registration Modal',
      correlationId,
      ip: getClientIp(req),
      payload: {
        email,
        full_name: fullName,
        company_name: companyName,
        phone,
        city,
      },
    });

    // 2. Диспетчеризация оперативного WhatsApp-уведомления менеджерам Synergy через шлюз ERP
    const managerPhone = process.env.ADMIN_WHATSAPP_PHONE || process.env.MANAGER_WHATSAPP_PHONE || process.env.WHATSAPP_MANAGER_PHONE || '';
    const waMsg =
      `👤 *НОВАЯ РЕГИСТРАЦИЯ B2B-ДИЛЕРА*\n\n` +
      `🏢 *Компания:* ${companyName || 'Не указана'}\n` +
      `👤 *Контакт:* ${fullName || 'Не указано'}\n` +
      `✉️ *Email:* ${email}\n` +
      (phone ? `📞 *Телефон:* ${phone}\n` : '') +
      (city ? `📍 *Город:* ${city}\n` : '') +
      `⏱️ *Время:* ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}\n\n` +
      `_Необходимо проверить карточку в 1С / админ-панели и назначить категорию оптовых цен._`;

    sendWhatsAppMessage(managerPhone, waMsg, {
      eventType: 'dealer_registration',
      clientName: fullName || companyName,
    }).catch(waErr => {
      console.warn('[Dealer Registration] WhatsApp alert notice:', waErr);
    });

    return res.status(200).json({
      success: true,
      message: 'Уведомление о регистрации дилера принято.',
    });
  } catch (err: any) {
    console.error('[Dealer Registration Notification] Error:', err);
    return res.status(500).json({
      success: false,
      error: 'Ошибка при обработке уведомления о регистрации',
    });
  }
}
