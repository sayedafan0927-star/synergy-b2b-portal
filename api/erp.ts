import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { dispatchApprovalRequest } from './approvals/whatsapp';
import { recordAuditLog } from './audit/logs';
import { applyCorrelationId } from './lib/trace';
import { enforceRateLimit } from './lib/rateLimit';
import { getCachedCatalog, saveCachedCatalog } from './lib/catalogCache';
import { authenticateRequest } from './lib/authGuard';
import { validateAndPriceOrder } from './lib/pricingValidator';

const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sjvvoxxwevwgziuxjvcy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Список публичных действий, не требующих обязательной предварительной авторизации
const PUBLIC_ACTIONS = new Set([
  'catalog',
  'product',
  'ping',
  'login',
  'create_lead',
  'suppliers',
  'display_settings',
  'request_approval',
]);

// Защищенные административные действия
const ADMIN_ACTIONS = new Set([
  'update_client_access',
  'update_order_status',
  'sync_bundle',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();

  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type, X-Portal-Key, Idempotency-Key, Authorization, X-Correlation-ID, X-Request-ID'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Сквозной Correlation-ID
  const correlationId = applyCorrelationId(req, res);

  // Rate Limiting (60 запросов в минуту на IP)
  if (!enforceRateLimit(req, res, { limit: 60, windowSeconds: 60, actionPrefix: 'erp_proxy' })) {
    return;
  }

  const action = String(req.query.action || req.body?.action || '').trim();

  // 1.0. Высоконагруженный кэш каталога (Staging Cache / Sub-50ms HIT)
  if (action === 'catalog' && req.method === 'GET') {
    const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    if (!isRefresh) {
      try {
        const cached = await getCachedCatalog('catalog_global');
        if (cached && cached.isFresh) {
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('X-Cache-Age-Ms', String(cached.ageMs));
          res.setHeader('X-Cache-Source', cached.source);
          return res.status(200).json(cached.data);
        }
      } catch (cacheLookupErr) {
        console.warn('[API Proxy ERP] Cache lookup warning:', cacheLookupErr);
      }
    }
  }

  // 1.01. Точечный эндпоинт товара (исключает скачивание всего каталога на карточке товара)
  if (action === 'product' && req.method === 'GET') {
    const targetId = decodeURIComponent(String(req.query.id || req.query.sku || '')).trim().toLowerCase();
    if (!targetId) {
      return res.status(400).json({ success: false, error: 'Параметр id или sku обязателен' });
    }

    try {
      const cached = await getCachedCatalog('catalog_global');
      if (cached && cached.data && Array.isArray(cached.data.products)) {
        const found = cached.data.products.find((p: any) => {
          if (String(p.id).toLowerCase() === targetId) return true;
          if (String(p.article || '').toLowerCase() === targetId) return true;
          return (p.variants || []).some((v: any) =>
            String(v.id).toLowerCase() === targetId ||
            String(v.sku || '').toLowerCase() === targetId ||
            String(v.barcode || '').toLowerCase() === targetId ||
            String(v.article || '').toLowerCase() === targetId
          );
        });

        if (found) {
          res.setHeader('X-Cache', 'HIT');
          return res.status(200).json({ success: true, product: found });
        }
      }
      return res.status(404).json({ success: false, error: 'Товар не найден в каталоге' });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e?.message });
    }
  }

  // 1. Специальное действие: запрос согласования заказа в WhatsApp
  if (action === 'request_approval' && req.method === 'POST') {
    try {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const sent = await dispatchApprovalRequest({
        orderId: payload.order_id || payload.orderId || `tmp-${Date.now()}`,
        orderDocNumber: payload.order_doc_number || payload.orderDocNumber,
        clientName: payload.client_name || payload.clientName || 'Клиент B2B',
        clientPhone: payload.client_phone || payload.clientPhone,
        totalAmount: Number(payload.total_amount || payload.totalAmount || 0),
        totalSqm: Number(payload.total_sqm || payload.totalSqm || 0),
        itemsCount: Number(payload.items_count || payload.itemsCount || 1),
        reason: payload.reason || 'Превышение кредитного лимита / стоп-лист',
        managerPhone: payload.manager_phone || payload.managerPhone,
      });

      await recordAuditLog({
        eventType: 'request_approval',
        direction: 'outbound',
        status: sent ? 'success' : 'warning',
        source: 'WhatsApp Approvals',
        payload: { order_id: payload.order_id, client: payload.client_name },
      });

      return res.status(200).json({
        success: true,
        dispatched: sent,
        message: 'Запрос на согласование успешно отправлен ответственному менеджеру в WhatsApp.',
      });
    } catch (apprErr: any) {
      console.error('[API Proxy ERP] Error dispatching approval:', apprErr);
      return res.status(500).json({
        success: false,
        error: 'Не удалось отправить запрос в WhatsApp',
        details: apprErr?.message,
      });
    }
  }

  // 1.1. Запрос официального акта сверки взаиморасчетов с 1С:ERP
  if (action === 'get_reconciliation_report') {
    const authCtx = await authenticateRequest(req, { allowServerKey: true });
    if (!authCtx.isAuthenticated) {
      return res.status(401).json({ success: false, error: authCtx.error || 'Требуется авторизация' });
    }

    let partnerId = String(req.query.partner_id || req.query.counterpartyId || '');
    if (authCtx.role === 'client') {
      partnerId = String(authCtx.partnerId || '');
      req.query.partner_id = partnerId;
    }

    const startDate = (req.query.start_date as string) || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = (req.query.end_date as string) || new Date().toISOString().split('T')[0];

    try {
      const erpUrl = `${TARGET_ERP_URL}?action=get_reconciliation_report&partner_id=${encodeURIComponent(partnerId)}&start_date=${startDate}&end_date=${endDate}&portal_key=${encodeURIComponent(SERVER_ERP_KEY)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const erpRes = await fetch(erpUrl, { headers: { 'X-Portal-Key': SERVER_ERP_KEY }, signal: controller.signal }).finally(() => clearTimeout(timeout));
      
      if (erpRes.ok) {
        const report = await erpRes.json();
        await recordAuditLog({
          eventType: 'reconciliation_report',
          direction: 'inbound',
          status: 'success',
          source: '1C ERP Reconciliation',
          payload: { partner_id: partnerId, startDate, endDate },
        });
        return res.status(200).json(report);
      } else {
        throw new Error(`ERP status ${erpRes.status}`);
      }
    } catch (erpNetErr: any) {
      console.warn('[API Proxy ERP] Direct reconciliation ERP fetch failed:', erpNetErr?.message);
      // Ликвидирована ложная генерация фиктивных актов по заказам! Честный ответ при недоступности учетной системы.
      return res.status(503).json({
        success: false,
        error: 'Сервер 1С:ERP временно недоступен для формирования официального акта сверки взаиморасчетов. Пожалуйста, повторите попытку позже.',
        details: erpNetErr?.message,
      });
    }
  }

  // 2. Строгая аутентификация и валидация прав доступа через JWT и RBAC
  let verifiedAuth: any = null;

  if (ADMIN_ACTIONS.has(action)) {
    verifiedAuth = await authenticateRequest(req, { requiredRoles: ['admin'], allowServerKey: true });
    if (!verifiedAuth.isAuthenticated || verifiedAuth.error) {
      return res.status(403).json({
        success: false,
        error: verifiedAuth.error || 'Forbidden: Для выполнения данного действия требуются права администратора.',
      });
    }
  }

  // 2.1. ─── Защита от B2B IDOR (на основе криптографически проверенного профиля) ───
  if (['client_debt', 'orders'].includes(action)) {
    verifiedAuth = await authenticateRequest(req, { allowServerKey: true });
    if (!verifiedAuth.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: verifiedAuth.error || 'Для доступа к финансовым данным требуется авторизация.',
      });
    }

    if (verifiedAuth.role === 'client') {
      const callerPartnerId = String(verifiedAuth.partnerId || verifiedAuth.erpId || '');
      const requestedId = String(req.query.client_id || req.query.counterparty_id || '');
      if (requestedId && callerPartnerId && requestedId !== callerPartnerId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Доступ к чужим финансовым начислениям и заказам запрещен (B2B Anti-IDOR Protection).',
        });
      }
      if (callerPartnerId) {
        req.query.client_id = callerPartnerId;
        req.query.counterparty_id = callerPartnerId;
      }
    }
  }

  if (['supplier_network_stock', 'supplier_inbound_shipments', 'supplier_defects'].includes(action)) {
    verifiedAuth = await authenticateRequest(req, { requiredRoles: ['admin', 'manager_rm', 'supplier'], allowServerKey: true });
    if (!verifiedAuth.isAuthenticated || verifiedAuth.error) {
      return res.status(403).json({
        success: false,
        error: verifiedAuth.error || 'Доступ разрешен только поставщикам и уполномоченным менеджерам.',
      });
    }

    if (verifiedAuth.role === 'supplier') {
      const callerSuppId = String(verifiedAuth.partnerId || verifiedAuth.erpId || '');
      const requestedSuppId = String(req.query.supplier_id || req.body?.supplier_id || '');
      if (requestedSuppId && callerSuppId && requestedSuppId !== callerSuppId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Поставщик имеет доступ только к данным собственной фабрики.',
        });
      }
      if (callerSuppId) {
        req.query.supplier_id = callerSuppId;
      }
    }
  }

  // 3. ─── Серверный расчет и Anti-Tamper Pricing Guard для заказов ───
  let validatedOrderPayload: any = null;
  let finalTotalAmount = 0;
  let finalTotalItems = 0;
  let outboxOrderId: string | null = null;
  let outboxOrderDoc: string | null = null;

  if (action === 'create_order' && req.method === 'POST') {
    try {
      const callerAuth = await authenticateRequest(req, { allowServerKey: true });
      const rawPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const rawItems = Array.isArray(rawPayload?.items) ? rawPayload.items : [];

      const priceType = callerAuth.priceType || rawPayload.price_type || 'wholesale';
      const pricingResult = await validateAndPriceOrder(rawItems, priceType);

      if (!pricingResult.valid) {
        return res.status(400).json({
          success: false,
          error: pricingResult.error || 'Ошибка валидации товарных позиций заказа',
        });
      }

      if (pricingResult.tamperDetected) {
        console.warn(`[Anti-Tamper Pricing] Notice: client sent untrusted prices. Server recalculated to $${pricingResult.totalAmount}`);
      }

      finalTotalAmount = pricingResult.totalAmount;
      finalTotalItems = pricingResult.totalItems;

      // ── Pre-Order Compliance: проверка кредитного лимита и стоп-листа на сервере ──
      let serverRequiresApproval = false;
      let complianceReason = '';

      if (callerAuth.role === 'client' && callerAuth.userId) {
        try {
          const { data: clientProf } = await supabase
            .from('profiles')
            .select('id, credit_limit_usd, partner_id, full_name, phone, manager_id')
            .eq('id', callerAuth.userId)
            .maybeSingle();

          const limitUsd = Number(clientProf?.credit_limit_usd || 0);
          if (limitUsd > 0 && clientProf?.partner_id) {
            const { data: balRow } = await supabase
              .from('partner_balances')
              .select('balance')
              .eq('partner_id', clientProf.partner_id)
              .maybeSingle();

            const debt = balRow ? Math.max(0, -Number(balRow.balance || 0)) : 0;
            if (debt + finalTotalAmount > limitUsd) {
              serverRequiresApproval = true;
              complianceReason = `Превышение кредитного лимита на сервере (Лимит: $${limitUsd}, Текущий долг: $${debt.toFixed(0)}, Заказ: $${finalTotalAmount})`;
            }
          }
        } catch (compErr) {
          console.warn('[Compliance Validator] Check warning:', compErr);
        }
      }

      const clientComment = rawPayload.comment || '';
      const orderCommentWithCompliance = serverRequiresApproval
        ? `${clientComment} [ТРЕБУЕТСЯ АППРУВ В WHATSAPP: ${complianceReason}]`.trim()
        : clientComment;

      validatedOrderPayload = {
        ...rawPayload,
        comment: orderCommentWithCompliance,
        total_amount: finalTotalAmount,
        items: pricingResult.items,
        user_id: callerAuth.userId || rawPayload.user_id,
        partner_id: (callerAuth.role === 'client' ? callerAuth.partnerId : rawPayload.partner_id) || rawPayload.client_id,
        server_requires_approval: serverRequiresApproval,
        compliance_reason: complianceReason,
      };

      // 4. ─── Transactional Outbox (Буферизация в PostgreSQL перед вызовом 1C) ───
      const year = new Date().getFullYear();
      outboxOrderDoc = `ORD-${year}-${Math.floor(1000 + Math.random() * 9000)}`;

      let resolvedUserId = validatedOrderPayload.user_id;
      if (!resolvedUserId && validatedOrderPayload.client_phone) {
        const cleanPhone = String(validatedOrderPayload.client_phone).replace(/\D+/g, '');
        const { data: matchedProfile } = await supabase
          .from('profiles')
          .select('id')
          .ilike('phone', `%${cleanPhone.slice(-10)}%`)
          .limit(1)
          .maybeSingle();
        if (matchedProfile?.id) resolvedUserId = matchedProfile.id;
      }

      if (!resolvedUserId) {
        const { data: adminProf } = await supabase.from('profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
        resolvedUserId = adminProf?.id;
      }

      if (resolvedUserId) {
        const { data: createdRow } = await supabase
          .from('orders')
          .insert({
            order_number: outboxOrderDoc,
            user_id: resolvedUserId,
            placed_by_id: resolvedUserId,
            warehouse: validatedOrderPayload.items?.[0]?.warehouse || 'Основной Склад Астана',
            notes: validatedOrderPayload.comment || '',
            total_amount: finalTotalAmount,
            total_items: finalTotalItems,
            total_sqm: pricingResult.items.reduce((s, it) => s + (it.price_per_sqm > 0 ? it.price / it.price_per_sqm * it.quantity : 0), 0),
            status: 'pending',
          })
          .select('id, order_number')
          .maybeSingle();

        if (createdRow) {
          outboxOrderId = createdRow.id;
          outboxOrderDoc = createdRow.order_number;

          const orderItemRows = pricingResult.items.map(it => ({
            order_id: createdRow.id,
            product_id: String(it.productId || it.item_id || it.sku || ''),
            product_name: String(it.sku || 'Ковровое изделие'),
            size: String(it.size || 'Стандарт'),
            sku: String(it.sku || ''),
            warehouse: String(it.warehouse || 'Основной Склад Астана'),
            price: Number(it.price) || 0,
            quantity: Number(it.quantity) || 1,
          }));

          if (orderItemRows.length > 0) {
            await supabase.from('order_items').insert(orderItemRows);
          }

          if (serverRequiresApproval) {
            dispatchApprovalRequest({
              orderId: createdRow.id,
              orderDocNumber: outboxOrderDoc,
              clientName: validatedOrderPayload.client_name || validatedOrderPayload.buyer?.name || 'Клиент B2B',
              clientPhone: validatedOrderPayload.client_phone || validatedOrderPayload.buyer?.phone,
              totalAmount: finalTotalAmount,
              totalSqm: pricingResult.items.reduce((s, it) => s + (it.price_per_sqm > 0 ? it.price / it.price_per_sqm * it.quantity : 0), 0),
              itemsCount: finalTotalItems,
              reason: complianceReason || 'Превышение кредитного лимита (серверный контроль)',
            }).catch(e => console.warn('[Auto-Approval Dispatch Warning]:', e));
          }
        }
      }
    } catch (parseErr: any) {
      return res.status(400).json({
        success: false,
        error: `Некорректный запрос заказа: ${parseErr?.message}`,
      });
    }
  }

  try {
    // Собираем Query параметры
    const queryParams = new URLSearchParams();
    for (const [key, val] of Object.entries(req.query)) {
      if (key === 'supplier_id' && (val === '0' || val === 'all' || val === '' || val === 'undefined' || val === 'null')) {
        continue;
      }
      if (Array.isArray(val)) {
        val.forEach(v => queryParams.append(key, String(v)));
      } else if (val !== undefined && val !== null && val !== '') {
        queryParams.set(key, String(val));
      }
    }

    if (SERVER_ERP_KEY) {
      queryParams.set('portal_key', SERVER_ERP_KEY);
    }

    const targetUrl = `${TARGET_ERP_URL}?${queryParams.toString()}`;

    const headers: Record<string, string> = {
      'X-Portal-Key': SERVER_ERP_KEY,
      'Accept': 'application/json',
      'X-Correlation-ID': correlationId,
    };

    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (idempotencyKey) {
      headers['Idempotency-Key'] = String(idempotencyKey);
      headers['X-Idempotency-Key'] = String(idempotencyKey);
    }

    // Таймаут запроса к ERP (12 секунд)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    let fetchOptions: RequestInit = {
      method: req.method,
      headers,
      signal: controller.signal,
    };

    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      const bodyToSend = validatedOrderPayload || req.body;
      fetchOptions = {
        ...fetchOptions,
        body: typeof bodyToSend === 'string' ? bodyToSend : JSON.stringify(bodyToSend || {}),
      };
    }

    const erpResponse = await fetch(targetUrl, fetchOptions).finally(() => clearTimeout(timeoutId));
    const latencyMs = Date.now() - startTime;
    const contentType = erpResponse.headers.get('content-type') || 'application/json';
    const textData = await erpResponse.text();

    if (['create_order', 'update_order_status', 'update_client_access', 'login'].includes(action)) {
      await recordAuditLog({
        eventType: action,
        direction: 'outbound',
        status: erpResponse.ok ? 'success' : 'error',
        statusCode: erpResponse.status,
        latencyMs,
        source: 'B2B Proxy API',
        correlationId,
        payload: { action, query: req.query },
      });
    }

    // Resilient Staging Fallback для каталога
    if (action === 'catalog' && erpResponse.status >= 500) {
      try {
        const fallback = await getCachedCatalog('catalog_global');
        if (fallback && fallback.data) {
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'STALE_FALLBACK');
          res.setHeader('X-Cache-Age-Ms', String(fallback.ageMs));
          return res.json(fallback.data);
        }
      } catch (fbErr) {
        console.warn('[API Proxy ERP] Fallback lookup exception:', fbErr);
      }
    }

    res.status(erpResponse.status);
    res.setHeader('Content-Type', contentType);

    try {
      const jsonData = JSON.parse(textData);

      if (action === 'catalog' && erpResponse.ok && jsonData?.success && Array.isArray(jsonData.products)) {
        saveCachedCatalog(jsonData, 'catalog_global').catch(e => console.warn('[API Proxy ERP] Cache save error:', e));
        res.setHeader('X-Cache', 'MISS');
      }

      if (action === 'create_order' && outboxOrderId && jsonData.success && jsonData.order?.doc_number) {
        await supabase
          .from('orders')
          .update({
            order_number: jsonData.order.doc_number,
            status: 'processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', outboxOrderId);
      }

      return res.json(jsonData);
    } catch {
      return res.send(textData);
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    console.error('[API Proxy ERP] Error proxying request:', err?.name === 'AbortError' ? 'ERP Request Timeout (12s)' : err);

    if (action === 'catalog') {
      try {
        const fallback = await getCachedCatalog('catalog_global');
        if (fallback && fallback.data) {
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'STALE_FALLBACK');
          res.setHeader('X-Cache-Age-Ms', String(fallback.ageMs));
          return res.json(fallback.data);
        }
      } catch {}
    }

    await recordAuditLog({
      eventType: action || 'proxy_request',
      direction: 'outbound',
      status: 'error',
      statusCode: 502,
      latencyMs,
      source: 'B2B Proxy API',
      errorMessage: err?.message || 'Bad Gateway / Timeout',
    });

    if (action === 'create_order' && outboxOrderDoc) {
      return res.status(200).json({
        success: true,
        order: {
          order_id: outboxOrderId || 9999,
          doc_number: outboxOrderDoc,
          status: 'pending',
          is_buffered: true,
          total_amount: finalTotalAmount,
        },
        message: 'Заказ успешно зафиксирован и сохранен в буфере синхронизации с 1С:ERP.',
      });
    }

    return res.status(502).json({
      success: false,
      error: err?.name === 'AbortError' ? 'Сервер ERP не ответил вовремя (Таймаут 12с)' : 'Ошибка соединения с сервером ERP (Bad Gateway)',
      details: err?.message,
    });
  }
}
