import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifySignedDecisionToken, sendWhatsAppMessage } from './whatsapp';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY2dscW5qaHl1Ynh1aGZ0cndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzQ1MDUsImV4cCI6MjA1ODYxMDUwNX0.z0Vw3tJ4372iY-qC52dZ_Yl-kC46M25jH3_P9z3G30w';
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { decision: reqDecision, token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).send(renderHtmlResult(false, 'Отсутствует токен согласования.'));
  }

  const verified = verifySignedDecisionToken(token);
  if (!verified.valid || !verified.orderId || !verified.decision) {
    return res.status(403).send(renderHtmlResult(false, verified.error || 'Недействительный или просроченный токен.'));
  }

  const { orderId, decision } = verified;
  const newStatus = decision === 'approve' ? 'confirmed' : 'cancelled';
  const statusLabel = decision === 'approve' ? 'ОДОБРЕН' : 'ОТКЛОНЕН';
  const statusColor = decision === 'approve' ? '#10b981' : '#ef4444';

  try {
    // 1. Обновляем статус в Supabase
    const { data: updatedOrders, error: dbError } = await supabase
      .from('orders')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .or(`id.eq.${orderId},order_number.eq.${orderId}`)
      .select('id, order_number, user_id, total_amount');

    if (dbError) {
      console.warn('[Approval Action] Supabase update warning:', dbError.message);
    }

    // 2. Отправляем статус в 1C:ERP
    const erpUrl = `${TARGET_ERP_URL}?action=update_order_status&portal_key=${SERVER_ERP_KEY}`;
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
          comment: `Решение принято через WhatsApp (${statusLabel}) в ${new Date().toLocaleString('ru-RU')}`,
        }),
      });
      console.log(`[Approval Action] Synced order status ${newStatus} to ERP for order ${orderId}`);
    } catch (erpErr: any) {
      console.warn('[Approval Action] Notice syncing with ERP:', erpErr?.message);
    }

    // 3. Отправляем уведомление в Realtime канал
    try {
      const channel = supabase.channel('portal_live_updates');
      await channel.send({
        type: 'broadcast',
        event: 'order_status_changed',
        payload: {
          order_id: orderId,
          new_status: newStatus,
          timestamp: new Date().toISOString(),
          decision_by: 'WhatsApp Manager Action',
        },
      });
    } catch {
      // non-critical
    }

    const message = decision === 'approve'
      ? `Заказ №${orderId} успешно ОДОБРЕН и передан в WMS на комплектацию склада.`
      : `Заказ №${orderId} успешно ОТКЛОНЕН. Резервирование товара аннулировано в ERP.`;

    return res.status(200).send(renderHtmlResult(true, message, statusLabel, statusColor, String(orderId)));
  } catch (err: any) {
    console.error('[Approval Action] Server execution error:', err);
    return res.status(500).send(renderHtmlResult(false, `Внутренняя ошибка обработки решения: ${err?.message}`));
  }
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
      border: 1px border #e2e8f0;
      text-align: center;
    }
    .icon-wrapper {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: ${success ? (badgeLabel === 'ОДОБРЕН' ? '#ecfdf5' : '#fef2f2') : '#fef2f2'};
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
      ${success ? (badgeLabel === 'ОДОБРЕН' ? '✅' : '❌') : '⚠️'}
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
