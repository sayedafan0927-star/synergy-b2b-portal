import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifySignedDecisionToken } from './whatsapp';
import { getErpApiKey, getTargetErpUrl } from '../lib/erpKey';
import { triggerImmediateOutboxSync } from '../modules/orders/orderDispatcher';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const TARGET_ERP_URL = getTargetErpUrl();
const SERVER_ERP_KEY = getErpApiKey();

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

export { dispatchApprovalRequest } from './whatsapp';

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
  // 2. МУТАЦИЯ: Только по методу POST при осознанном клике пользователя
  if (req.method === 'POST') {
    try {
      // 2.0. Валидация заказа и защита от Replay-атак / случайных повторных кликов
      let existingOrder: any = null;
      if (supabase) {
        const { data } = await supabase
          .from('orders')
          .select('id, order_number, status, reservations_released, created_at, notes')
          .or(`id.eq.${orderId},order_number.eq.${orderId}`)
          .maybeSingle();
        existingOrder = data;
      }

      if (!existingOrder) {
        return res.status(404).send(renderHtmlResult(false, 'Заказ не найден в базе данных портала.'));
      }

      // Разрешенные статусы для согласования: только pending или processing
      const allowedStatuses = ['pending', 'processing'];
      if (!allowedStatuses.includes(existingOrder.status)) {
        const currentStatus = existingOrder.status;
        const msg = currentStatus === 'confirmed'
          ? `Заказ №${existingOrder.order_number || existingOrder.id} уже был ранее одобрен и передан на комплектацию.`
          : currentStatus === 'cancelled'
          ? `Заказ №${existingOrder.order_number || existingOrder.id} уже отменен, повторное действие невозможно.`
          : `Заказ №${existingOrder.order_number || existingOrder.id} находится в статусе «${currentStatus}». Повторное изменение через ссылку согласования отклонено.`;
        return res.status(409).send(renderHtmlResult(false, msg));
      }

      // Проверка срока действия складской брони (24ч)
      const createdMs = new Date(existingOrder.created_at).getTime();
      const isHoldExpired = !isNaN(createdMs) && (Date.now() - createdMs > 24 * 3600 * 1000);
      if (isApprove && isHoldExpired) {
        return res.status(409).send(renderHtmlResult(
          false,
          `Срок действия складской брони (24ч) для заказа №${existingOrder.order_number || existingOrder.id} истёк. Резерв товаров расформирован в WMS. Одобрение невозможно — клиенту необходимо сформировать новый заказ.`
        ));
      }

      const targetOrderId = existingOrder.id;
      const targetOrderNumber = existingOrder.order_number || orderId;

      // 2.1. При отклонении заказа: СНАЧАЛА возвращаем зарезервированные остатки на склад
      if (!isApprove && supabase) {
        try {
          await supabase.rpc('release_order_reservations', { p_order_id: targetOrderId });
        } catch (relErr: any) {
          console.warn('[Approval Action] Error releasing reservations on reject:', relErr?.message);
        }
      }

      // Определение нового статуса:
      // Если заказ еще в буфере Outbox (pending) и одобрен, статус 'pending' сохраняется,
      // добавляется отметка одобрения в notes и немедленно активируется воркер Outbox.
      const isBufferedOutbox = existingOrder.status === 'pending';
      const newStatus = !isApprove
        ? 'cancelled'
        : (isBufferedOutbox ? 'pending' : 'confirmed');

      const approvalNote = `[Согласование WhatsApp: ${statusLabel} (${new Date().toLocaleString('ru-RU')})]`;
      const combinedNotes = `${existingOrder.notes || ''} ${approvalNote}`.trim();

      // 2.2. Обновляем статус заказа в Supabase
      const { error: dbError } = await supabase
        .from('orders')
        .update({
          status: newStatus,
          reservations_released: !isApprove ? true : undefined,
          notes: combinedNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetOrderId);

      if (dbError) {
        console.warn('[Approval Action] Supabase update warning:', dbError.message);
      }

      // При одобрении каскадно подтверждаем мультискладские подзаказы (если мастер уже был в 1С)
      if (isApprove && !isBufferedOutbox) {
        try {
          await supabase
            .from('orders')
            .update({
              status: 'confirmed',
              updated_at: new Date().toISOString(),
            })
            .eq('parent_order_id', targetOrderId);
        } catch (subApproveErr) {
          console.warn('[Approval Action] Error cascading approval to suborders:', subApproveErr);
        }
      }

      // При отклонении заказа каскадно отменяем мультискладские подзаказы
      if (!isApprove) {
        try {
          await supabase
            .from('orders')
            .update({
              status: 'cancelled',
              reservations_released: true,
              updated_at: new Date().toISOString(),
            })
            .eq('parent_order_id', targetOrderId);
        } catch (relErr: any) {
          console.warn('[Approval Action] Error cascading cancel to suborders:', relErr?.message);
        }
      }

      // 2.3. Синхронизация с 1С:ERP или запуск Outbox дренажа
      if (isApprove && isBufferedOutbox) {
        // Заказ одобрен, но ожидает создания в 1С через Outbox: немедленный дренаж
        try {
          triggerImmediateOutboxSync(req, 'wa-approved-drain', {
            orderId: targetOrderId,
            orderDoc: targetOrderNumber,
          });
          console.log(`[Approval Action] Triggered immediate Outbox sync for approved order ${targetOrderNumber}`);
        } catch (syncErr: any) {
          console.warn('[Approval Action] Outbox trigger notice:', syncErr?.message);
        }
      } else if (SERVER_ERP_KEY) {
        // Заказ уже был создан в 1С: обновляем статус через API
        const erpUrl = `${TARGET_ERP_URL}?action=update_order_status`;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);
          await fetch(erpUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Portal-Key': SERVER_ERP_KEY,
            },
            body: JSON.stringify({
              order_id: targetOrderNumber,
              status: newStatus,
              comment: `Решение подтверждено менеджером в WhatsApp (${statusLabel}) в ${new Date().toLocaleString('ru-RU')}`,
            }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
          console.log(`[Approval Action] Synced order status ${newStatus} to ERP for order ${targetOrderNumber}`);
        } catch (erpErr: any) {
          console.warn('[Approval Action] Notice syncing with ERP:', erpErr?.message);
        }
      }

      // 2.4. Трансляция в Realtime-шину
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
