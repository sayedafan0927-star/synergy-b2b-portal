import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/logs';
import { getClientIp } from '../lib/rateLimit';
import { sendWhatsAppMessage } from '../approvals/whatsapp';

export async function handleCreateLead(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  correlationId: string
) {
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const name = String(payload?.name || '').trim();
    const phone = String(payload?.phone || '').trim();

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Поля "Имя" и "Телефон" обязательны для оформления заявки.',
      });
    }

    const company = String(payload?.company || '').trim() || null;
    const email = String(payload?.email || '').trim() || null;
    const message = String(payload?.message || '').trim() || null;
    const source = String(payload?.source || 'Форма заявки с сайта B2B').trim();
    const kanbanStage = String(payload?.kanban_stage || 'Новые лиды').trim();
    const generatedLeadId = `lead-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 1. Фиксация лида в базе данных Supabase
    let savedId = generatedLeadId;
    try {
      const { data: leadRow, error: leadErr } = await supabase
        .from('leads')
        .insert({
          name,
          phone,
          company,
          email,
          message,
          source,
          kanban_stage: kanbanStage,
          status: 'new',
          created_at: new Date().toISOString(),
        })
        .select('id')
        .maybeSingle();

      if (leadErr) {
        console.warn('[API Proxy ERP] Supabase leads table insert notice:', leadErr.message);
      } else if (leadRow?.id) {
        savedId = leadRow.id;
      }
    } catch (dbErr: any) {
      console.warn('[API Proxy ERP] Leads database persistence warning:', dbErr?.message);
    }

    // 2. Регистрация в журнале аудита интеграций
    await recordAuditLog({
      eventType: 'create_lead',
      direction: 'inbound',
      status: 'success',
      source: 'B2B Portal Contacts Form',
      correlationId,
      ip: getClientIp(req),
      payload: {
        lead_id: savedId,
        name,
        phone,
        company,
        email,
        source,
      },
    });

    // 3. Отправка оперативного WhatsApp-уведомления менеджеру
    const managerPhone = process.env.ADMIN_WHATSAPP_PHONE || process.env.MANAGER_WHATSAPP_PHONE || process.env.WHATSAPP_MANAGER_PHONE || '';
    const notificationText =
      `📥 *НОВАЯ ЗАЯВКА С B2B ПОРТАЛА*\n\n` +
      `👤 *Имя:* ${name}\n` +
      `📞 *Телефон:* ${phone}\n` +
      (company ? `🏢 *Компания:* ${company}\n` : '') +
      (email ? `✉️ *Email:* ${email}\n` : '') +
      (message ? `💬 *Сообщение:* ${message}\n` : '') +
      `🏷️ *Источник:* ${source}\n` +
      `⏱️ *Время:* ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`;

    sendWhatsAppMessage(managerPhone, notificationText, {
      eventType: 'dealer_registration',
      clientName: name,
    }).catch(waErr => {
      console.warn('[API Proxy ERP] WhatsApp lead notification error:', waErr);
    });

    return res.status(200).json({
      success: true,
      lead_id: savedId,
      message: 'Заявка успешно принята. Наш менеджер свяжется с вами в ближайшее время.',
    });
  } catch (parseErr: any) {
    console.error('[API Proxy ERP] Error processing create_lead:', parseErr);
    return res.status(400).json({
      success: false,
      error: `Некорректный запрос заявки: ${parseErr?.message}`,
    });
  }
}
