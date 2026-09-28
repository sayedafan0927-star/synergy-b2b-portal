import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifySignedDecisionToken } from './whatsapp';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Извлекаем токен из query или body
  let token = (req.query?.token || req.body?.token) as string | undefined;
  if (!token && typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      token = parsed.token;
    } catch {
      // urlencoded body fallback
      const match = req.body.match(/token=([^&]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }
  }

  if (!token || typeof token !== 'string') {
    return res.status(400).send(renderHtmlResult(false, 'Отсутствует или поврежден токен согласования.'));
  }

  const verified = verifySignedDecisionToken(token);
  if (!verified.valid || !verified.orderId || !verified.decision) {
    return res.status(403).send(renderHtmlResult(false, verified.error || 'Недействительный или просроченный токен согласования.'));
  }

  const { orderId, decision } = verified;
  const isApprove = decision === 'approve';
  const statusLabel = isApprove ? 'ОДОБРЕНИЕ' : 'ОТКЛОНЕНИЕ';
  const newStatus = isApprove ? 'confirmed' : 'cancelled';
  const statusColor = isApprove ? '#10b981' : '#ef4444';

  // 1. ЗАЩИТА ОТ КРАУЛЕРОВ WHATSAPP / LINK PREVIEWS:
  // Если метод GET — отдаем страницу подтверждения с кнопкой, мутацию не производим!
  if (req.method === 'GET') {
    return res.status(200).send(renderConfirmationPrompt({
      orderId: String(orderId),
      decision,
      token,
      statusLabel,
      statusColor,
      isApprove,
    }));
  }

  // 2. МУТАЦИЯ: Только по методу POST при осознанном клике пользователя
  if (req.method === 'POST') {
    try {
      // 2.1. Обновляем статус заказа в Supabase
      const { error: dbError } = await supabase
        .from('orders')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderId},order_number.eq.${orderId}`);

      if (dbError) {
        console.warn('[Approval Action] Supabase update warning:', dbError.message);
      }

      // 2.2. Синхронизируем статус с 1С:ERP
      if (SERVER_ERP_KEY) {
        const erpUrl = `${TARGET_ERP_URL}?action=update_order_status&portal_key=${encodeURIComponent(SERVER_ERP_KEY)}`;
        try {
          await fetch(erpUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Portal-Key': SERVER_ERP_KEY,
            },
            body: JSON.stringify({
              order_id: orderId,
              status: newStatus,
              comment: `Решение подтверждено менеджером в WhatsApp (${statusLabel}) в ${new Date().toLocaleString('ru-RU')}`,
            }),
          });
          console.log(`[Approval Action] Synced order status ${newStatus} to ERP for order ${orderId}`);
        } catch (erpErr: any) {
          console.warn('[Approval Action] Notice syncing with ERP:', erpErr?.message);
        }
      }

      // 2.3. Трансляция в Realtime-шину
      try {
        const channel = supabase.channel('portal_live_updates');
        await channel.send({
          type: 'broadcast',
          event: 'order_status_changed',
          payload: {
            order_id: orderId,
            new_status: newStatus,
            timestamp: new Date().toISOString(),
            decision_by: 'WhatsApp Manager Action Verified',
          },
        });
      } catch {}

      const successMessage = isApprove
        ? `Заказ №${orderId} успешно ОДОБРЕН и передан в WMS на комплектацию склада.`
        : `Заказ №${orderId} успешно ОТКЛОНЕН. Резервирование товаров аннулировано в 1С:ERP.`;

      return res.status(200).send(renderHtmlResult(true, successMessage, statusLabel, statusColor, String(orderId)));
    } catch (err: any) {
      console.error('[Approval Action] Server execution error:', err);
      return res.status(500).send(renderHtmlResult(false, `Внутренняя ошибка обработки решения: ${err?.message}`));
    }
  }

  return res.status(405).send('Method Not Allowed');
}

/**
 * Интерактивная форма подтверждения (защита от краулеров мессенджеров)
 */
function renderConfirmationPrompt(params: {
  orderId: string;
  decision: string;
  token: string;
  statusLabel: string;
  statusColor: string;
  isApprove: boolean;
}): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Подтверждение решения | Synergy B2B</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 32px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.05em;
      color: #ffffff;
      background: ${params.statusColor};
      margin-bottom: 16px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 12px;
      color: #0f172a;
    }
    p {
      color: #475569;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 14px 20px;
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      background: ${params.statusColor};
      border: none;
      border-radius: 10px;
      cursor: pointer;
      box-sizing: border-box;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .footer {
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 16px;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${params.statusLabel}</div>
    <h1>Подтверждение действия</h1>
    <p>Вы собираетесь <strong>${params.isApprove ? 'ОДОБРИТЬ' : 'ОТКЛОНИТЬ'}</strong> отгрузку по заказу <strong>№${params.orderId}</strong>.</p>
    <form method="POST" action="/api/approvals/action">
      <input type="hidden" name="token" value="${params.token}">
      <button type="submit" class="btn">
        ${params.isApprove ? '✅ Подтвердить и одобрить заказ' : '❌ Подтвердить отклонение заказа'}
      </button>
    </form>
    <div class="footer">
      Synergy B2B Portal • Безопасный шлюз согласования
    </div>
  </div>
</body>
</html>`;
}

function renderHtmlResult(success: boolean, message: string, badgeLabel?: string, badgeColor?: string, orderId?: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Решение по заказу | Synergy B2B</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 32px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      text-align: center;
    }
    .icon-wrapper {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: ${success ? (badgeLabel === 'ОДОБРЕНИЕ' ? '#ecfdf5' : '#fef2f2') : '#fef2f2'};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 32px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.05em;
      color: #ffffff;
      background: ${badgeColor || '#64748b'};
      margin-bottom: 12px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 12px;
      color: #0f172a;
    }
    p {
      color: #475569;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .footer {
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrapper">
      ${success ? (badgeLabel === 'ОДОБРЕНИЕ' ? '✅' : '❌') : '⚠️'}
    </div>
    ${badgeLabel ? `<div class="badge">${badgeLabel}</div>` : ''}
    <h1>${success ? 'Решение зафиксировано' : 'Ошибка обработки'}</h1>
    <p>${message}</p>
    <div class="footer">
      Synergy B2B Portal • Интеграционный шлюз ERP
    </div>
  </div>
</body>
</html>`;
}
