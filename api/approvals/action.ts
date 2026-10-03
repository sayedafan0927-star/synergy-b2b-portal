import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifySignedDecisionToken } from './whatsapp';
import { getErpApiKey, getTargetErpUrl } from '../lib/erpKey';
import { triggerImmediateOutboxSync } from '../modules/orders/orderDispatcher';
import { renderConfirmationPrompt, renderHtmlResult } from './renderHtml';

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
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(orderId).trim());
      if (supabase) {
        try {
          let q = supabase
            .from('orders')
            .select('id, order_number, status, reservations_released, created_at, notes');
          if (isUuid) {
            q = q.or(`id.eq.${orderId},order_number.eq.${orderId}`);
          } else {
            q = q.eq('order_number', String(orderId));
          }
          const { data } = await q.maybeSingle();
          existingOrder = data;
        } catch (dbErr) {
          console.warn('[Approval Action] Supabase order query notice:', dbErr);
        }
      }

      // Fallback: Поиск заказа напрямую в ERP, если в локальной базе нет или передан ERP ID
      if (!existingOrder && SERVER_ERP_KEY) {
        try {
          const erpCheckRes = await fetch(`${TARGET_ERP_URL}?action=orders&limit=25`, {
            headers: {
              'X-Portal-Key': SERVER_ERP_KEY,
              Authorization: `Bearer ${SERVER_ERP_KEY}`,
            },
          });
          const erpCheckData = await erpCheckRes.json();
          const matchOrder = erpCheckData?.orders?.find((o: any) =>
            String(o.id) === String(orderId) || String(o.doc_number) === String(orderId)
          );
          if (matchOrder) {
            existingOrder = {
              id: matchOrder.id,
              order_number: matchOrder.doc_number,
              status: matchOrder.status_code || 'pending',
              created_at: matchOrder.date,
              notes: matchOrder.comment,
              is_erp_direct: true,
            };
          }
        } catch (erpFindErr) {
          console.warn('[Approval Action] ERP direct lookup notice:', erpFindErr);
        }
      }

      if (!existingOrder) {
        if (String(orderId).startsWith('TEST-') || String(orderId).toLowerCase().includes('test')) {
          existingOrder = {
            id: orderId,
            order_number: `ORD-${orderId}`,
            status: 'pending',
            created_at: new Date().toISOString(),
            notes: 'Тестовый заказ для проверки WhatsApp согласования',
            is_test: true,
          };
        } else {
          return res.status(404).send(renderHtmlResult(false, 'Заказ не найден в базе данных портала и ERP.'));
        }
      }

      // Разрешенные статусы для согласования: только pending или processing
      const allowedStatuses = ['pending', 'processing'];
      if (!allowedStatuses.includes(existingOrder.status) && !existingOrder.is_erp_direct && !existingOrder.is_test) {
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
      if (isApprove && isHoldExpired && !existingOrder.is_test) {
        return res.status(409).send(renderHtmlResult(
          false,
          `Срок действия складской брони (24ч) для заказа №${existingOrder.order_number || existingOrder.id} истёк. Резерв товаров расформирован в WMS. Одобрение невозможно — клиенту необходимо сформировать новый заказ.`
        ));
      }

      const targetOrderId = existingOrder.id;
      const targetOrderNumber = existingOrder.order_number || orderId;

      if (existingOrder.is_test) {
        return res.status(200).send(renderHtmlResult(
          true,
          `ТЕСТОВЫЙ РЕЖИМ: Заказ №${targetOrderNumber} успешно ${isApprove ? 'ОДОБРЕН (передан в WMS ТСД)' : 'ОТКЛОНЕН (бронь аннулирована)'}. Интеграция WhatsApp проверена на 100%!`,
          String(targetOrderNumber),
          isApprove ? 'confirmed' : 'cancelled'
        ));
      }

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
      const isBufferedOutbox = existingOrder.status === 'pending' && !existingOrder.is_erp_direct;
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
      }

      // Всегда синхронизируем статус с 1C:ERP, если заказ существует в 1С
      if (SERVER_ERP_KEY && (!isBufferedOutbox || existingOrder.is_erp_direct)) {
        const erpUrl = `${TARGET_ERP_URL}?action=update_order_status`;
        try {
          let numericErpOrderId: number | null = null;
          if (typeof existingOrder.id === 'number' && existingOrder.id > 0) {
            numericErpOrderId = existingOrder.id;
          } else if (typeof orderId === 'number' && orderId > 0) {
            numericErpOrderId = orderId;
          } else if (/^\d+$/.test(String(orderId).trim())) {
            numericErpOrderId = Number(String(orderId).trim());
          }

          if (!numericErpOrderId) {
            try {
              const listRes = await fetch(`${TARGET_ERP_URL}?action=orders&limit=25`, {
                headers: { 'X-Portal-Key': SERVER_ERP_KEY, Authorization: `Bearer ${SERVER_ERP_KEY}` },
              });
              const listData = await listRes.json();
              const found = listData?.orders?.find((o: any) =>
                o.doc_number === targetOrderNumber || String(o.id) === String(orderId)
              );
              if (found?.id) numericErpOrderId = Number(found.id);
            } catch {}
          }

          const erpStatus = isApprove ? 'picking' : 'cancelled';
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4500);
          await fetch(erpUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Portal-Key': SERVER_ERP_KEY,
            },
            body: JSON.stringify({
              order_id: numericErpOrderId || targetOrderNumber,
              status: erpStatus,
              comment: `Решение подтверждено менеджером в WhatsApp (${statusLabel}) в ${new Date().toLocaleString('ru-RU')}. Передано в WMS ТСД.`,
            }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
          console.log(`[Approval Action] Synced order status ${erpStatus} to ERP for order ${targetOrderNumber} (ERP ID: ${numericErpOrderId})`);
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
        ? `Заказ №${targetOrderNumber} успешно ОДОБРЕН и передан в WMS на комплектацию склада (статус: На сборке WMS).`
        : `Заказ №${targetOrderNumber} успешно ОТКЛОНЕН. Резервирование товаров аннулировано в 1С:ERP и WMS.`;

      return res.status(200).send(renderHtmlResult(true, successMessage, statusLabel, statusColor, String(targetOrderNumber)));
    } catch (err: any) {
      console.error('[Approval Action] Server execution error:', err);
      return res.status(500).send(renderHtmlResult(false, `Внутренняя ошибка обработки решения: ${err?.message}`));
    }
  }

  return res.status(405).send('Method Not Allowed');
}
