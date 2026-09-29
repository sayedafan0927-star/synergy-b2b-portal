import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { dispatchApprovalRequest, sendWhatsAppMessage } from './approvals/whatsapp';
import { recordAuditLog } from './audit/logs';
import { applyCorrelationId } from './lib/trace';
import { enforceRateLimit, getClientIp } from './lib/rateLimit';
import { getCachedCatalog, saveCachedCatalog } from './lib/catalogCache';
import { authenticateRequest, revokeToken } from './lib/authGuard';
import { validateAndPriceOrder } from './lib/pricingValidator';
import { applyCorsHeaders } from './lib/cors';
import { checkCircuit, recordSuccess, recordFailure } from './lib/circuitBreaker';
import { handleCreateLead } from './modules/leads';
import { handleReconciliationReport } from './modules/reconciliation';
import { handleCatalogRequests } from './modules/catalog/catalogHandler';
import { handleCreateOrder } from './modules/orders/createOrderHandler';
import { handleLoginFallback, handleEmployeeLoginFallback } from './modules/auth/loginHandler';
import { handleCachedClientDebt, handleDebtFallbackOnFailure } from './modules/financial/debtHandler';
import { getErpApiKey } from './lib/erpKey';

// Primary live ERP gateway: https://kilem-khan.kz/api/sin/public/api_portal.php
// Production router alias per ERP spec: https://crm.kilem-khan.kz/api_portal.php
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const ERP_FALLBACK_URL = process.env.ERP_FALLBACK_URL || 'https://crm.kilem-khan.kz/api_portal.php';
const SERVER_ERP_KEY = getErpApiKey();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null as any;

// Список публичных действий, не требующих обязательной предварительной авторизации
const PUBLIC_ACTIONS = new Set([
  'catalog',
  'catalog_normalized',
  'catalog_paginated',
  'reconcile_all_balances',
  'product',
  'ping',
  'login',
  'logout',
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
let displaySettingsCache: { data: any; expiry: number } | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  try {
    // Unified CORS Guard
    if (!applyCorsHeaders(req, res)) {
      return;
    }

  // Reject oversized payloads (10MB limit)
  const bodyStr = JSON.stringify(req.body);
  if (bodyStr && bodyStr.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Payload too large', maxSize: '10MB' });
  }

  // Сквозной Correlation-ID
  const correlationId = applyCorrelationId(req, res);

  // Rate Limiting (300 запросов в минуту на IP)
  if (!(await enforceRateLimit(req, res, { limit: 300, windowSeconds: 60, actionPrefix: 'erp_proxy' }))) {
    return;
  }

  const action = String(req.query.action || req.body?.action || '').trim();

  // 0.8. Управление очередью недоставленных заказов DLQ (T-14)
  if (action === 'dlq_orders' && req.method === 'GET') {
    const auth = await authenticateRequest(req, { requiredRoles: ['admin', 'manager_rm'], allowServerKey: true });
    if (!auth.isAuthenticated || auth.error) {
      return res.status(403).json({ success: false, error: auth.error || 'Access denied' });
    }
    const { data: dlqList, error: dlqErr } = await supabase
      .from('orders')
      .select('id, order_number, user_id, warehouse, total_amount, total_items, notes, retry_count, last_error, updated_at, created_at')
      .eq('status', 'failed_dlq')
      .order('created_at', { ascending: false })
      .limit(100);

    if (dlqErr) {
      return res.status(500).json({ success: false, error: dlqErr.message });
    }
    return res.status(200).json({ success: true, count: dlqList?.length || 0, orders: dlqList || [] });
  }

  if (action === 'retry_dlq_order' && req.method === 'POST') {
    const auth = await authenticateRequest(req, { requiredRoles: ['admin'], allowServerKey: true });
    if (!auth.isAuthenticated || auth.error) {
      return res.status(403).json({ success: false, error: auth.error || 'Access denied' });
    }
    const orderId = req.body?.order_id || req.query?.order_id;
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Параметр order_id обязателен.' });
    }

    const { data: updated, error: updErr } = await supabase
      .from('orders')
      .update({
        status: 'pending',
        retry_count: 0,
        next_retry_at: new Date().toISOString(),
        notes: `[Ручной перезапуск администратором: ${auth.fullName || auth.userId}]`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('status', 'failed_dlq')
      .select('id, order_number')
      .maybeSingle();

    if (updErr || !updated) {
      return res.status(500).json({ success: false, error: updErr?.message || 'Заказ не найден в очереди DLQ.' });
    }

    await recordAuditLog({
      eventType: 'dlq_manual_retry',
      direction: 'outbound',
      status: 'success',
      statusCode: 200,
      source: 'Admin Portal',
      correlationId,
      payload: { order_id: orderId, order_number: updated.order_number, retried_by: auth.userId },
    });

    return res.status(200).json({
      success: true,
      message: `Заказ ${updated.order_number} успешно возвращен в очередь синхронизации Outbox.`,
      order: updated,
    });
  }

  // 0.9. Кэш настроек отображения (60s TTL)
  if (action === 'display_settings' && req.method === 'GET') {
    const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    if (!isRefresh && displaySettingsCache && displaySettingsCache.expiry > Date.now()) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(displaySettingsCache.data);
    }
  }

  // 1.0. Каталог, карточка товара и серверная пагинация (модульный обработчик)
  if (action === 'catalog' || action === 'catalog_normalized' || action === 'product' || action === 'catalog_paginated') {
    if (await handleCatalogRequests(req, res, action, supabase)) {
      return;
    }
  }

  // 1.03. Прием лидов и заявок с контактных форм B2B-портала
  if (action === 'create_lead' && req.method === 'POST') {
    return handleCreateLead(req, res, supabase, correlationId);
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
    return handleReconciliationReport(req, res, TARGET_ERP_URL, SERVER_ERP_KEY);
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

    if (verifiedAuth.isAuthenticated && verifiedAuth.role === 'client') {
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

    // T-12: Высокоскоростной кэш финансового баланса контрагента (5 минут TTL)
    if (action === 'client_debt' && req.method === 'GET') {
      if (await handleCachedClientDebt(req, res, supabase)) {
        return;
      }
    }
  }

  // T-15: Отзыв сессии через Redis blacklist
  if (action === 'logout' && req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const tokenToRevoke = authHeader.substring(7).trim();
      await revokeToken(tokenToRevoke);
    }
    return res.status(200).json({ success: true, message: 'Сессия успешно завершена (Token Revoked).' });
  }

  if (['supplier_network_stock', 'supplier_inbound_shipments', 'supplier_defects'].includes(action)) {
    verifiedAuth = await authenticateRequest(req, { requiredRoles: ['admin', 'manager_rm', 'supplier'], allowServerKey: true });
    if (!verifiedAuth.isAuthenticated || verifiedAuth.error) {
      return res.status(403).json({
        success: false,
        error: verifiedAuth.error || 'Доступ разрешен только поставщикам и уполномоченным менеджерам.',
      });
    }

    if (action === 'supplier_network_stock' && (!req.query.supplier_id || req.query.supplier_id === '0')) {
      return res.status(400).json({
        success: false,
        error: 'Параметр supplier_id обязателен для запроса складских остатков поставщика.',
      });
    }

    if (action === 'supplier_defects') {
      return res.status(200).json({
        success: true,
        supplier_id: Number(req.query.supplier_id || req.body?.supplier_id || 0),
        total_defects: 0,
        defects: [],
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

  // 3. ─── Создание заказов с Compensating Saga и Anti-Tamper Guard ───
  if (action === 'create_order' && req.method === 'POST') {
    const callerAuth = await authenticateRequest(req, { allowServerKey: true });
    if (!callerAuth.isAuthenticated || callerAuth.error) {
      return res.status(401).json({ success: false, error: callerAuth.error || 'Требуется авторизация' });
    }
    await handleCreateOrder({
      req,
      res,
      callerAuth,
      correlationId,
      supabase,
      targetErpUrl: TARGET_ERP_URL,
      serverErpKey: SERVER_ERP_KEY,
      clientIp: getClientIp(req),
    });
    return;
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

    // Note: X-Portal-Key is passed strictly via HTTP headers, never in URL query string

    const targetUrl = `${TARGET_ERP_URL}?${queryParams.toString()}`;

    const clientIp = getClientIp(req);
    const headers: Record<string, string> = {
      'X-Portal-Key': SERVER_ERP_KEY,
      'Accept': 'application/json',
      'X-Correlation-ID': correlationId,
      'X-Forwarded-For': req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']) : clientIp,
      'X-Real-IP': clientIp,
    };

    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (idempotencyKey) {
      headers['Idempotency-Key'] = String(idempotencyKey);
      headers['X-Idempotency-Key'] = String(idempotencyKey);
    }

    // Circuit Breaker: Проверка состояния внешнего шлюза 1C:ERP (T-08: Persistent Redis state)
    const circuit = await checkCircuit('erp_gateway');
    if (!circuit.permitted) {
      console.warn(`[CircuitBreaker] Request to ERP suppressed for action '${action}'. Circuit state: ${circuit.state}`);
      if (action === 'create_order') {
        return res.status(200).json({
          success: true,
          order: {
            order_id: 9999,
            doc_number: `ORD-BUF-${Date.now()}`,
            status: 'pending',
            is_buffered: true,
          },
          message: 'Заказ успешно зафиксирован в автономном буфере (Circuit Breaker Active).',
        });
      }
      if (action === 'catalog' || action === 'catalog_normalized') {
        const fallback = await getCachedCatalog('catalog_global');
        if (fallback && fallback.data) {
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'CIRCUIT_BREAKER_FALLBACK');
          res.setHeader('X-Cache-Age-Ms', String(fallback.ageMs));
          return res.json(fallback.data);
        }
      }
      if (action === 'display_settings') {
        const fallbackSettings = {
          success: true,
          settings: {
            show_free_stock: true,
            show_reserved_stock: false,
            show_total_stock: true,
            show_prices: true,
            show_price_per_sqm: true,
            show_discounts: true,
            show_dealer_showroom: true,
            allow_orders_when_zero_stock: false,
          },
        };
        return res.status(200).json(fallbackSettings);
      }
      return res.status(503).json({
        success: false,
        code: 'CIRCUIT_BREAKER_OPEN',
        error: 'Шлюз 1C:ERP временно недоступен (активирован защитный контур Circuit Breaker). Повторите попытку через 30 секунд.',
      });
    }

    // Таймаут запроса к ERP: 2.5 секунды для чекаута (быстрый fallback в Outbox) и 12 секунд для каталога
    const erpTimeoutMs = action === 'create_order' ? 2500 : 12000;

    let fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      const bodyToSend = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
      fetchOptions = {
        ...fetchOptions,
        body: typeof bodyToSend === 'string' ? bodyToSend : (Buffer.isBuffer(bodyToSend) ? bodyToSend.toString('utf8') : JSON.stringify(bodyToSend || {})),
      };
    }

    // T-10: Отказоустойчивый вызов с автоматическим переключением на резервный URL (Failover)
    async function sendRequestToErp(url: string): Promise<Response> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), erpTimeoutMs);
      try {
        return await fetch(url, { ...fetchOptions, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    let erpResponse: Response;
    try {
      erpResponse = await sendRequestToErp(targetUrl);
      const isHtmlResponse = (erpResponse.headers.get('content-type') || '').includes('text/html');
      if ((erpResponse.status >= 500 || isHtmlResponse) && ERP_FALLBACK_URL && ERP_FALLBACK_URL !== TARGET_ERP_URL) {
        console.warn(`[ERP Failover] Primary returned ${erpResponse.status} (isHtml: ${isHtmlResponse}). Attempting fallback endpoint: ${ERP_FALLBACK_URL}`);
        const fallbackTargetUrl = `${ERP_FALLBACK_URL}?${queryParams.toString()}`;
        const fallbackResp = await sendRequestToErp(fallbackTargetUrl);
        if (fallbackResp.ok) {
          erpResponse = fallbackResp;
        }
      }
    } catch (primaryFetchErr) {
      if (ERP_FALLBACK_URL && ERP_FALLBACK_URL !== TARGET_ERP_URL) {
        console.warn(`[ERP Failover] Primary connection failed. Attempting fallback endpoint: ${ERP_FALLBACK_URL}`);
        const fallbackTargetUrl = `${ERP_FALLBACK_URL}?${queryParams.toString()}`;
        erpResponse = await sendRequestToErp(fallbackTargetUrl);
      } else {
        throw primaryFetchErr;
      }
    }

    if (erpResponse.ok) {
      await recordSuccess('erp_gateway');
    } else if (erpResponse.status >= 500) {
      await recordFailure('erp_gateway');
    }

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

    // Resilient Fallback для настроек отображения (display_settings)
    if (action === 'display_settings') {
      try {
        const jsonData = JSON.parse(textData);
        if (jsonData && jsonData.success && jsonData.settings) {
          displaySettingsCache = { data: jsonData, expiry: Date.now() + 60_000 };
          return res.status(200).json(jsonData);
        }
      } catch {}
      const fallbackSettings = {
        success: true,
        settings: {
          show_free_stock: true,
          show_reserved_stock: true,
          show_to_ship_stock: true,
          show_total_stock: true,
          show_prices: true,
          show_price_per_sqm: true,
          show_discounts: true,
          show_dealer_showroom: true,
          allow_orders_when_zero_stock: false,
        },
      };
      displaySettingsCache = { data: fallbackSettings, expiry: Date.now() + 60_000 };
      return res.status(200).json(fallbackSettings);
    }

    // Resilient Staging Fallback для каталога
    if ((action === 'catalog' || action === 'catalog_normalized') && (!erpResponse.ok || !textData.trim().startsWith('{'))) {
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

      if ((action === 'catalog' || action === 'catalog_normalized') && erpResponse.ok && jsonData?.success) {
        // Если ERP вернул нормализованную структуру designs (Архитектура RugsUSA):
        if (Array.isArray(jsonData.designs) && !Array.isArray(jsonData.products)) {
          const normalizedProducts = jsonData.designs.map((d: any) => ({
            id: String(d.design_id || d.id || `design-${d.article}`),
            name: d.name || `${d.collection} ${d.article}`,
            collection: d.collection,
            article: d.article,
            category: d.category || 'Ковры',
            manufacturer: d.manufacturer || 'Karmen Hali',
            country: d.country || 'Турция',
            color: d.color || '',
            material: d.material || '',
            density: String(d.density || ''),
            pile_height: String(d.pile_height || ''),
            images: Array.isArray(d.images) ? d.images : [],
            image_thumb: Array.isArray(d.images) && d.images[0] ? d.images[0] : undefined,
            variants: Array.isArray(d.variants) ? d.variants.map((v: any) => ({
              ...v,
              id: v.id || `var-${v.sku}`,
              base_price: Number(v.base_price || (Number(v.price_per_sqm || 15) * Number(v.area_sqm || 1))),
              price_per_sqm: Number(v.price_per_sqm || 15),
              stock: Number(v.free_stock ?? v.stock ?? 0),
              free_stock: Number(v.free_stock ?? v.stock ?? 0),
              reserved_stock: Number(v.reserved_stock ?? 0),
              total_stock: Number(v.total_stock ?? 0),
              warehouses: Array.isArray(v.warehouses) ? v.warehouses.map((w: any) => ({
                ...w,
                stock: Number(w.free_stock ?? w.stock ?? 0),
                free_stock: Number(w.free_stock ?? w.stock ?? 0),
                reserved_stock: Number(w.reserved_stock ?? 0),
                total_stock: Number(w.total_stock ?? 0),
                is_hub: w.warehouse_id === 81 || (w.warehouse_name && w.warehouse_name.includes('Астана')),
              })) : [],
            })) : [],
          }));
          jsonData.products = normalizedProducts;
        }

        if (Array.isArray(jsonData.products)) {
          saveCachedCatalog(jsonData, 'catalog_global').catch(e => console.warn('[API Proxy ERP] Cache save error:', e));
          res.setHeader('X-Cache', 'MISS');
        }
      }

      if (action === 'display_settings' && erpResponse.ok && jsonData?.success) {
        displaySettingsCache = { data: jsonData, expiry: Date.now() + 60000 };
      }

      // T-12: Сохранение свежего финансового баланса в локальный кэш
      if (action === 'client_debt' && erpResponse.ok && jsonData?.success) {
        const pId = String(req.query.counterparty_id || req.query.client_id || jsonData.client?.partner_id || jsonData.partner_id || '');
        const fin = jsonData.financials || {};
        const bal = typeof fin.balance_usd === 'number' ? fin.balance_usd : (typeof jsonData.balance_usd === 'number' ? jsonData.balance_usd : -Number(fin.total_debt_usd || jsonData.debt_usd || 0));
        const isOverdue = Boolean(fin.is_overdue || jsonData.is_overdue);
        const overdueDays = Number(fin.max_overdue_days || fin.overdue_days || 0);

        if (pId) {
          supabase
            .from('partner_balances')
            .upsert({
              partner_id: pId,
              balance: bal,
              is_overdue: isOverdue,
              overdue_days: overdueDays,
              currency: 'USD',
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'partner_id' })
            .catch(e => console.warn('[Financial Cache] Update error:', e));
        }
      }

      if (action === 'supplier_network_stock' && erpResponse.ok && jsonData?.success) {
        if (Array.isArray(jsonData.items)) {
          jsonData.items.forEach((item: any) => {
            if (Array.isArray(item.distribution)) {
              item.distribution.forEach((dist: any) => {
                if (dist.warehouse_id === 81 || (dist.warehouse_name && dist.warehouse_name.includes('Астана')) || dist.type === 'central_hub') {
                  dist.city = 'Астана';
                  if (!dist.warehouse_name || dist.warehouse_name.includes('Алматы')) {
                    dist.warehouse_name = 'Основной Склад Астана';
                  }
                }
              });
            }
          });
        }
      }

      if (action === 'supplier_inbound_shipments' && erpResponse.ok && jsonData?.success) {
        if (Array.isArray(jsonData.shipments)) {
          jsonData.shipments.forEach((s: any) => {
            if (s.warehouse_id === 81 || (s.warehouse_name && s.warehouse_name.includes('Астана'))) {
              s.city = 'Астана';
            }
          });

          // Если по выбранному supplier_id пришло 0 поставок, подгружаем реестр и ищем партии с товарами фабрики (напр. SAYDAM)
          if (jsonData.shipments.length === 0 && req.query.supplier_id && req.query.supplier_id !== '0') {
            try {
              const allResp = await fetch(`${targetUrl}?action=supplier_inbound_shipments`, {
                headers: { 'X-Portal-Key': SERVER_ERP_KEY },
              });
              if (allResp.ok) {
                const allData = await allResp.json();
                if (allData.success && Array.isArray(allData.shipments)) {
                  const sId = Number(req.query.supplier_id);
                  const matched = allData.shipments.filter((s: any) => {
                    if (s.supplier_id === sId) return true;
                    return Array.isArray(s.items) && s.items.some((it: any) => {
                      const iname = (it.name || '').toLowerCase();
                      if (sId === 11 && (iname.includes('saydam') || iname.includes('flora'))) return true;
                      return false;
                    });
                  });
                  if (matched.length > 0) {
                    jsonData.shipments = matched;
                    jsonData.total_shipments = matched.length;
                  } else {
                    // Возвращаем все поступления склада Астана
                    jsonData.shipments = allData.shipments;
                    jsonData.total_shipments = allData.shipments.length;
                    jsonData.filter_notice = 'Показан общий реестр склада Астана';
                  }
                }
              }
            } catch (fallbackErr) {
              console.warn('[API Proxy ERP] Inbound shipment fallback notice:', fallbackErr);
            }
          }
        }
      }

      if (action === 'login') {
        if (erpResponse.ok && jsonData?.success) {
          try {
            const SECRET_KEY = process.env.PORTAL_SECRET_KEY || '';
            if (SECRET_KEY) {
              const c = jsonData.client || {};
              const pId = String(c.id || jsonData.client_id || '');
              const uId = `erp-client-${pId}`;
              const fName = String(jsonData.name || c.name || 'Оптовый клиент');
              const phone = String(jsonData.phone || c.phone || '');
              const priceType = String(c.price_type || 'wholesale');

              const sessionData = {
                user: {
                  id: uId,
                  email: `${phone.replace(/\D+/g, '') || pId}@kilem-khan.kz`,
                  user_metadata: { full_name: fName },
                },
                profile: {
                  id: uId,
                  role: 'client',
                  partner_id: pId,
                  full_name: fName,
                  phone,
                  company_name: fName,
                  price_type: priceType,
                  showroom_warehouse_id: c.showroom_warehouse_id ?? null,
                },
                timestamp: Date.now(),
              };

              const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
              const signedPayload = { data: sessionData, sig };
              const sessionToken = Buffer.from(JSON.stringify(signedPayload)).toString('base64url');

              jsonData.token = sessionToken;
              jsonData.portal_session_token = sessionToken;

              // Синхронизируем профиль клиента в базе данных
              if (pId) {
                try {
                  await supabase.from('profiles').upsert({
                    id: crypto.randomUUID(),
                    partner_id: pId,
                    erp_id: Number(pId) || null,
                    full_name: fName,
                    company_name: fName,
                    phone,
                    price_type: priceType,
                    role: 'client',
                    impersonation_enabled: true,
                    updated_at: new Date().toISOString(),
                  }, { onConflict: 'partner_id' });
                } catch (e) {
                  console.warn('[API Proxy ERP] Profile upsert notice:', e);
                }
              }
            }
          } catch (tokenErr) {
            console.warn('[API Proxy ERP] Error generating login session token:', tokenErr);
          }
        } else {
          // Fallback: Проверяем, не является ли логин/телефон сотрудником ERP (РМ, ЛМ, Администратор)
          try {
            let loginBody: any = {};
            try {
              if (Buffer.isBuffer(req.body)) {
                loginBody = JSON.parse(req.body.toString('utf8'));
              } else if (typeof req.body === 'string') {
                loginBody = JSON.parse(req.body || '{}');
              } else if (typeof req.body === 'object' && req.body !== null) {
                loginBody = req.body;
              }
            } catch {}
            const inputLogin = String(loginBody.login || loginBody.phone || req.query?.login || req.query?.phone || '').trim();
            const inputCleanPhone = inputLogin.replace(/\D+/g, '');

            if (inputLogin) {
              let managers: any[] = [];
              try {
                const rmUrl = `${TARGET_ERP_URL}?action=regional_managers`;
                const rmRes = await fetch(rmUrl, { headers: { 'X-Portal-Key': SERVER_ERP_KEY } });
                if (rmRes.ok) {
                  const rmData = await rmRes.json();
                  if (rmData && Array.isArray(rmData.managers)) {
                    managers = rmData.managers;
                  }
                }
              } catch (rmErr) {
                console.warn('[API Proxy ERP] Error fetching regional managers for auth fallback:', rmErr);
              }

              // Если список менеджеров из ERP недоступен - запрещаем вход под сотрудником (deny-by-default)
              if (managers.length === 0) {
                console.warn('[AUTH] ERP regional_managers endpoint returned no data or failed. Employee login denied.');
              }

              const matchedEmp = managers.find((m: any) => {
                const mPhoneClean = String(m.phone || '').replace(/\D+/g, '');
                const mUsername = String(m.username || '').toLowerCase().trim();
                const mName = String(m.name || '').toLowerCase().trim();
                const qLow = inputLogin.toLowerCase().trim();

                if (inputCleanPhone && mPhoneClean && (mPhoneClean === inputCleanPhone || (mPhoneClean.length >= 10 && inputCleanPhone.endsWith(mPhoneClean.slice(-10))))) {
                  return true;
                }
                if (mUsername && (mUsername === qLow || qLow.includes(mUsername))) return true;
                if (mName && (mName === qLow || qLow.includes(mName))) return true;
                return false;
              });

              if (matchedEmp) {
                const inputPass = String(loginBody.password || req.query?.password || '').trim();
                const handled = await handleEmployeeLoginFallback(
                  req,
                  res,
                  matchedEmp,
                  inputCleanPhone,
                  inputLogin,
                  inputPass,
                  correlationId
                );
                if (handled) return;
              }

              // 2. Проверяем, не является ли логин/телефон зарегистрированным клиентом (дилером) в ERP
              if (inputCleanPhone && inputCleanPhone.length >= 7) {
                let counterparties: any[] = [];
                try {
                  const cpUrl = `${TARGET_ERP_URL}?action=counterparties&phone=${encodeURIComponent(inputCleanPhone)}`;
                  const cpRes = await fetch(cpUrl, { headers: { 'X-Portal-Key': SERVER_ERP_KEY } });
                  if (cpRes.ok) {
                    const cpData = await cpRes.json();
                    if (Array.isArray(cpData)) {
                      counterparties = cpData;
                    } else if (cpData && Array.isArray(cpData.counterparties)) {
                      counterparties = cpData.counterparties;
                    }
                  }
                  if (counterparties.length === 0) {
                    const allUrl = `${TARGET_ERP_URL}?action=counterparties`;
                    const allRes = await fetch(allUrl, { headers: { 'X-Portal-Key': SERVER_ERP_KEY } });
                    if (allRes.ok) {
                      const allData = await allRes.json();
                      counterparties = Array.isArray(allData) ? allData : (allData?.counterparties || []);
                    }
                  }
                } catch (cpErr) {
                  console.warn('[API Proxy ERP] Error fetching counterparties for auth fallback:', cpErr);
                }

                const matchedClient = counterparties.find((c: any) => {
                  const cPhoneClean = String(c.phone || '').replace(/\D+/g, '');
                  if (!cPhoneClean) return false;
                  return (
                    cPhoneClean === inputCleanPhone ||
                    (cPhoneClean.length >= 10 && inputCleanPhone.endsWith(cPhoneClean.slice(-10))) ||
                    (inputCleanPhone.length >= 10 && cPhoneClean.endsWith(inputCleanPhone.slice(-10)))
                  );
                });

                if (matchedClient) {
                  const inputPass = String(loginBody.password || req.query?.password || '').trim();
                  const handled = await handleLoginFallback(
                    req,
                    res,
                    matchedClient,
                    inputCleanPhone,
                    inputLogin,
                    inputPass,
                    correlationId
                  );
                  if (handled) return;
                }


              }
            }
          } catch (empFallbackErr) {
            console.warn('[API Proxy ERP] Employee fallback auth notice:', empFallbackErr);
          }
        }
      }



      return res.json(jsonData);
    } catch {
      return res.send(textData);
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    await recordFailure('erp_gateway');
    console.error('[API Proxy ERP] Error proxying request:', err?.name === 'AbortError' ? `ERP Request Timeout (${action === 'create_order' ? '2.5s' : '12s'})` : err);

    if (action === 'display_settings') {
      const fallbackSettings = {
        success: true,
        settings: {
          show_free_stock: true,
          show_reserved_stock: false,
          show_total_stock: true,
          show_prices: true,
          show_price_per_sqm: true,
          show_discounts: true,
          show_dealer_showroom: true,
          allow_orders_when_zero_stock: false,
        },
      };
      displaySettingsCache = { data: fallbackSettings, expiry: Date.now() + 60_000 };
      return res.status(200).json(fallbackSettings);
    }

    if (action === 'catalog' || action === 'catalog_normalized') {
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

    // T-12: Отказоустойчивый возврат сохраненного баланса при сбое ERP
    if (action === 'client_debt') {
      const pId = String(req.query.counterparty_id || req.query.client_id || '');
      if (pId) {
        try {
          const { data: cachedBal } = await supabase
            .from('partner_balances')
            .select('*')
            .eq('partner_id', pId)
            .maybeSingle();

          if (cachedBal) {
            res.status(200);
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Cache', 'STALE_FALLBACK');
            return res.json({
              success: true,
              found: true,
              client: { partner_id: pId, is_overdue: Boolean(cachedBal.is_overdue) },
              financials: {
                balance_usd: Number(cachedBal.balance || 0),
                total_debt_usd: Math.max(0, -Number(cachedBal.balance || 0)),
                is_overdue: Boolean(cachedBal.is_overdue),
                overdue_days: Number(cachedBal.overdue_days || 0),
              },
              source: 'stale_partner_balances',
            });
          }
        } catch {}
      }
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



    return res.status(502).json({
      success: false,
      error: err?.name === 'AbortError' ? 'Сервер ERP не ответил вовремя (Таймаут 12с)' : 'Ошибка соединения с сервером ERP (Bad Gateway)',
      details: err?.message,
    });
  }
} catch (fatalErr: any) {
  console.error('[ERP Proxy Fatal Error]', fatalErr);
  return res.status(500).json({
    success: false,
    error: 'Внутренняя ошибка шлюза API',
    message: fatalErr?.message,
  });
}
}
