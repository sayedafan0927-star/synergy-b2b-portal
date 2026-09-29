import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
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

// Primary live ERP gateway: https://kilem-khan.kz/api/sin/public/api_portal.php
// Production router alias per ERP spec: https://crm.kilem-khan.kz/api_portal.php
const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const ERP_FALLBACK_URL = process.env.ERP_FALLBACK_URL || 'https://crm.kilem-khan.kz/api_portal.php';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

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

  // 1.0. Высоконагруженный кэш каталога (Staging Cache / Sub-50ms HIT)
  if ((action === 'catalog' || action === 'catalog_normalized') && req.method === 'GET') {
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

  // 1.02. Серверная пагинация, фильтрация и поиск каталога (масштабирование до 50k+ SKU)
  if (action === 'catalog_paginated' && req.method === 'GET') {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '24'), 10) || 24));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || '').trim();
    const collection = String(req.query.collection || '').trim();
    const sizeCluster = String(req.query.size_cluster || '').trim().toLowerCase();
    const isRunner = req.query.is_runner === 'true' || req.query.is_runner === '1';
    const inStockOnly = req.query.in_stock === 'true' || req.query.in_stock === '1';

    try {
      let query = supabase
        .from('products')
        .select(`
          id,
          name,
          category,
          collection,
          manufacturer,
          material,
          style,
          country,
          density,
          pile_height,
          images,
          product_variants (
            id,
            size,
            sku,
            base_price,
            warehouse_stock (
              city,
              stock
            )
          )
        `, { count: 'exact' });

      if (category) {
        query = query.eq('category', category);
      }
      if (collection) {
        query = query.ilike('collection', `%${collection}%`);
      }
      if (search) {
        query = query.or(`name.ilike.%${search}%,collection.ilike.%${search}%,id.ilike.%${search}%`);
      }

      query = query.range(offset, offset + limit - 1).order('name', { ascending: true });

      const { data, count, error } = await query;

      if (error) {
        // Fallback to cached catalog snapshot if database tables aren't populated yet
        const cached = await getCachedCatalog('catalog_global');
        if (cached && cached.data && Array.isArray(cached.data.products)) {
          let list = cached.data.products;
          if (category) list = list.filter((p: any) => p.category === category);
          if (collection) list = list.filter((p: any) => p.collection?.toLowerCase().includes(collection.toLowerCase()));
          if (search) {
            const sLower = search.toLowerCase();
            list = list.filter((p: any) => 
              p.name?.toLowerCase().includes(sLower) || 
              p.collection?.toLowerCase().includes(sLower) ||
              p.id?.toLowerCase().includes(sLower) ||
              (p.variants || []).some((v: any) => v.sku?.toLowerCase().includes(sLower))
            );
          }
          if (sizeCluster) {
            list = list.filter((p: any) => (p.variants || []).some((v: any) => v.size_cluster === sizeCluster));
          }
          if (isRunner) {
            list = list.filter((p: any) => (p.variants || []).some((v: any) => v.is_runner));
          }
          if (inStockOnly) {
            list = list.filter((p: any) => (p.variants || []).some((v: any) => (v.stock || v.total_stock || 0) > 0));
          }
          const total = list.length;
          const paginated = list.slice(offset, offset + limit);
          return res.status(200).json({
            success: true,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            items: paginated,
            source: 'cache_fallback'
          });
        }
        return res.status(500).json({ success: false, error: error.message });
      }

      let items = (data || []).map((p: any) => {
        const variants = (p.product_variants || []).map((v: any) => {
          const stocks = v.warehouse_stock || [];
          const totalStock = stocks.reduce((acc: number, s: any) => acc + (Number(s.stock) || 0), 0);
          return {
            id: v.id,
            size: v.size,
            sku: v.sku,
            base_price: Number(v.base_price) || 0,
            stock: totalStock,
            stocks_by_city: stocks.reduce((acc: Record<string, number>, s: any) => {
              acc[s.city] = Number(s.stock) || 0;
              return acc;
            }, {})
          };
        });

        const totalProductStock = variants.reduce((acc: number, v: any) => acc + v.stock, 0);

        return {
          id: p.id,
          name: p.name,
          category: p.category,
          collection: p.collection,
          manufacturer: p.manufacturer,
          material: p.material,
          style: p.style,
          country: p.country,
          density: p.density,
          pile_height: p.pile_height,
          images: p.images || [],
          variants,
          total_stock: totalProductStock
        };
      });

      if (inStockOnly) {
        items = items.filter((p: any) => p.total_stock > 0);
      }

      const total = count || items.length;
      return res.status(200).json({
        success: true,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        items,
        source: 'supabase_db'
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message });
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
      const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
      const pId = String(req.query.counterparty_id || req.query.client_id || '');
      if (pId && !isRefresh) {
        try {
          const { data: cachedBal } = await supabase
            .from('partner_balances')
            .select('*')
            .eq('partner_id', pId)
            .maybeSingle();

          const syncAgeMs = cachedBal?.last_synced_at ? Date.now() - new Date(cachedBal.last_synced_at).getTime() : Infinity;
          if (cachedBal && syncAgeMs < 5 * 60 * 1000) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('X-Cache-Age-Ms', String(syncAgeMs));
            return res.status(200).json({
              success: true,
              found: true,
              client: {
                partner_id: pId,
                is_overdue: Boolean(cachedBal.is_overdue),
              },
              financials: {
                balance_usd: Number(cachedBal.balance || 0),
                total_debt_usd: Math.max(0, -Number(cachedBal.balance || 0)),
                is_overdue: Boolean(cachedBal.is_overdue),
                overdue_days: Number(cachedBal.overdue_days || 0),
              },
              source: 'cache_partner_balances',
            });
          }
        } catch (cacheErr) {
          console.warn('[Financial Cache] Lookup warning:', cacheErr);
        }
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

  // 3. ─── Серверный расчет и Anti-Tamper Pricing Guard для заказов ───
  let validatedOrderPayload: any = null;
  let finalTotalAmount = 0;
  let finalTotalItems = 0;
  let outboxOrderId: string | null = null;
  let outboxOrderDoc: string | null = null;
  let createdSplitOrders: Array<{ doc_number: string; warehouse: string; amount: number; items_count: number }> = [];

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

      // ── Idempotency Check: проверка повторного запроса ──
      const incomingIdempotencyKey = String(
        req.headers['idempotency-key'] ||
        req.headers['x-idempotency-key'] ||
        rawPayload.idempotency_key ||
        ''
      ).trim();

      if (!incomingIdempotencyKey) {
        return res.status(400).json({
          success: false,
          error: 'Заголовок X-Idempotency-Key (или idempotency_key в теле) обязателен для создания заказов (UUID v4).',
        });
      }

      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, order_number, status, total_amount')
        .eq('idempotency_key', incomingIdempotencyKey)
        .maybeSingle();

      if (existingOrder) {
        return res.status(200).json({
          success: true,
          order: {
            order_id: existingOrder.id,
            doc_number: existingOrder.order_number,
            status: existingOrder.status,
            is_buffered: true,
            total_amount: Number(existingOrder.total_amount || 0),
          },
          message: 'Заказ уже был успешно зарегистрирован ранее (Idempotency Key HIT).',
        });
      }

      // ── Pre-Order Compliance: проверка кредитного лимита и стоп-листа на сервере ──
      let serverRequiresApproval = false;
      let complianceReason = '';

      if (callerAuth.role === 'client' && callerAuth.userId) {
        try {
          const { data: clientProf } = await supabase
            .from('profiles')
            .select('id, credit_limit_usd, partner_id, full_name, phone, manager_id, status, impersonation_enabled')
            .eq('id', callerAuth.userId)
            .maybeSingle();

          if (clientProf?.impersonation_enabled === false || clientProf?.status === 'inactive') {
            return res.status(403).json({
              success: false,
              error: 'Создание заказа заблокировано: учетная запись контрагента деактивирована в ERP.',
            });
          }

          if (clientProf?.partner_id) {
            const { data: balRow } = await supabase
              .from('partner_balances')
              .select('balance, is_overdue, overdue_days')
              .eq('partner_id', clientProf.partner_id)
              .maybeSingle();

            // Блокировка при просроченной задолженности (T-16)
            if (balRow?.is_overdue && (balRow.overdue_days || 0) > 14) {
              return res.status(403).json({
                success: false,
                error: `Создание заказа заблокировано: просроченная задолженность (${balRow.overdue_days} дн.). Пожалуйста, погасите задолженность или обратитесь к менеджеру.`,
              });
            }

            const limitUsd = Number(clientProf?.credit_limit_usd || 0);
            if (limitUsd > 0) {
              const debt = balRow ? Math.max(0, -Number(balRow.balance || 0)) : 0;
              if (debt + finalTotalAmount > limitUsd) {
                serverRequiresApproval = true;
                complianceReason = `Превышение кредитного лимита на сервере (Лимит: $${limitUsd}, Текущий долг: $${debt.toFixed(0)}, Заказ: $${finalTotalAmount})`;
              }
            }
          }
        } catch (compErr) {
          console.warn('[Compliance Validator] Check warning:', compErr);
        }
      }

      // Multi-Warehouse Grouping (выявление позиций с разных складов)
      const distinctWarehouses = Array.from(new Set(pricingResult.items.map(it => it.warehouse || 'Основной Склад Астана')));
      const isMultiWarehouse = distinctWarehouses.length > 1;
      const multiWhTag = isMultiWarehouse ? ` [МУЛЬТИСКЛАД: ${distinctWarehouses.join(', ')}]` : '';

      const clientComment = rawPayload.comment || '';
      const orderCommentWithCompliance = `${clientComment}${multiWhTag}${serverRequiresApproval ? ` [ТРЕБУЕТСЯ АППРУВ В WHATSAPP: ${complianceReason}]` : ''}`.trim();

      const primaryWarehouseId = Number(pricingResult.items[0]?.warehouse_id || rawPayload.warehouse_id || 1);

      // Строгая санитаризация и формат WMS/ERP:
      // Исключаем любые складские ячейки/стеллажи, передаем габариты ковра и точный warehouse_id
      const sanitizedItemsForErp = pricingResult.items.map(it => {
        const itemObj: Record<string, any> = {
          item_id: it.item_id,
          sku: it.sku,
          quantity: it.quantity,
          price: it.price,
          width: it.width,
          length: it.length,
          area_sqm: it.area_sqm,
          warehouse_id: it.warehouse_id || primaryWarehouseId,
        };
        // Гарантия отсутствия внутрискладских ячеек адресации WMS
        delete itemObj.cell;
        delete itemObj.cell_code;
        delete itemObj.rack;
        delete itemObj.location;
        return itemObj;
      });

      // T-24: Атомарное резервирование свободного остатка (PostgreSQL SELECT FOR UPDATE)
      const reservedSkuItems: Array<{ sku: string; qty: number; whId: number }> = [];
      let reservationFailedSku: string | null = null;

      for (const it of pricingResult.items) {
        const itemSku = String(it.sku || '');
        const itemQty = Number(it.quantity || 1);
        const whId = Number(it.warehouse_id || primaryWarehouseId);

        if (itemSku) {
          try {
            const { data: isReserved, error: rpcErr } = await supabase.rpc('reserve_stock', {
              p_sku: itemSku,
              p_qty: itemQty,
              p_warehouse_id: whId,
            });

            if (!rpcErr && isReserved === false) {
              reservationFailedSku = itemSku;
              break;
            } else if (!rpcErr && isReserved === true) {
              reservedSkuItems.push({ sku: itemSku, qty: itemQty, whId });
            }
          } catch (rErr) {
            console.warn('[Stock Reservation] RPC check notice:', rErr);
          }
        }
      }

      // Если хотя бы по одному SKU не хватило остатка — откатываем предыдущие брони и отдаем 409 Conflict
      if (reservationFailedSku) {
        for (const rel of reservedSkuItems) {
          await supabase.rpc('release_stock', {
            p_sku: rel.sku,
            p_qty: rel.qty,
            p_warehouse_id: rel.whId,
          }).catch(() => {});
        }
        return res.status(409).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          error: `Недостаточно свободного остатка для артикула "${reservationFailedSku}". Товар был зарезервирован другим покупателем.`,
        });
      }

      validatedOrderPayload = {
        ...rawPayload,
        idempotency_key: incomingIdempotencyKey || null,
        warehouse_id: primaryWarehouseId,
        partner_id: (callerAuth.role === 'client' ? callerAuth.partnerId : rawPayload.partner_id) || rawPayload.client_id,
        client_name: rawPayload.client_name || rawPayload.buyer?.name,
        client_phone: rawPayload.client_phone || rawPayload.buyer?.phone,
        client_company: rawPayload.client_company || rawPayload.client_name,
        city: rawPayload.city || 'Астана',
        comment: orderCommentWithCompliance,
        total_amount: finalTotalAmount,
        items: sanitizedItemsForErp,
        user_id: callerAuth.userId || rawPayload.user_id,
        server_requires_approval: serverRequiresApproval,
        compliance_reason: complianceReason,
        is_multi_warehouse: isMultiWarehouse,
        warehouses: distinctWarehouses,
      };

      // Гарантия отсутствия ячеек на верхнем уровне
      delete (validatedOrderPayload as any).cell;
      delete (validatedOrderPayload as any).cell_code;
      delete (validatedOrderPayload as any).rack;
      delete (validatedOrderPayload as any).location;

      // 4. ─── Transactional Outbox (Буферизация в PostgreSQL перед вызовом 1C) ───
      let resolvedUserId = validatedOrderPayload.user_id || callerAuth.userId;
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

      // Устранена привязка чужих заказов к администратору:
      if (!resolvedUserId && callerAuth.role === 'admin' && callerAuth.userId) {
        resolvedUserId = callerAuth.userId;
      }

      if (!resolvedUserId) {
        return res.status(401).json({
          success: false,
          error: 'Для оформления оптового заказа требуется авторизация (пользователь не идентифицирован).',
        });
      }

      createdSplitOrders = [];

      // Создаем мастер-заказ в PostgreSQL (номер генерируется sequence функцией generate_order_number)
      const { data: createdRow, error: masterOrderErr } = await supabase
        .from('orders')
        .insert({
          user_id: resolvedUserId,
          placed_by_id: callerAuth.userId || resolvedUserId,
          warehouse: validatedOrderPayload.items?.[0]?.warehouse || 'Основной Склад Астана',
          notes: isMultiWarehouse ? `[Мастер-заказ мультисклада (${distinctWarehouses.length} склада)] ${validatedOrderPayload.comment || ''}`.trim() : (validatedOrderPayload.comment || ''),
          total_amount: finalTotalAmount,
          total_items: finalTotalItems,
          total_sqm: pricingResult.items.reduce((s, it) => s + (it.price_per_sqm > 0 ? it.price / it.price_per_sqm * it.quantity : 0), 0),
          status: 'pending',
          idempotency_key: incomingIdempotencyKey || null,
        })
        .select('id, order_number')
        .maybeSingle();

      if (masterOrderErr || !createdRow) {
        console.error('[Transactional Outbox] Error creating master order:', masterOrderErr);
        return res.status(500).json({
          success: false,
          error: 'Ошибка фиксации заказа в базе данных',
          details: masterOrderErr?.message,
        });
      }

      outboxOrderId = createdRow.id;
      outboxOrderDoc = createdRow.order_number;

      if (isMultiWarehouse) {
        // Создаем независимые субордера для каждого склада
        let splitIdx = 1;
        for (const wh of distinctWarehouses) {
          const whItems = pricingResult.items.filter(it => (it.warehouse || 'Основной Склад Астана') === wh);
          const whAmount = Math.round(whItems.reduce((acc, it) => acc + it.total_line, 0) * 100) / 100;
          const whItemsCount = whItems.reduce((acc, it) => acc + it.quantity, 0);
          const whSqm = Math.round(whItems.reduce((acc, it) => acc + (it.price_per_sqm > 0 ? it.price / it.price_per_sqm * it.quantity : 0), 0) * 100) / 100;
          const subDoc = `${outboxOrderDoc}-${splitIdx}`;

          const { data: subOrderRow } = await supabase
            .from('orders')
            .insert({
              order_number: subDoc,
              user_id: resolvedUserId,
              placed_by_id: callerAuth.userId || resolvedUserId,
              warehouse: wh,
              notes: `[Мультисклад ${splitIdx}/${distinctWarehouses.length}: ${wh}] ${validatedOrderPayload.comment || ''}`.trim(),
              total_amount: whAmount,
              total_items: whItemsCount,
              total_sqm: whSqm,
              status: 'pending',
              idempotency_key: incomingIdempotencyKey ? `${incomingIdempotencyKey}-wh-${splitIdx}` : null,
            })
            .select('id, order_number')
            .maybeSingle();

          if (subOrderRow) {
            const subItemRows = whItems.map(it => ({
              order_id: subOrderRow.id,
              product_id: String(it.productId || it.item_id || it.sku || ''),
              product_name: String(it.sku || 'Ковровое изделие'),
              size: String(it.size || 'Стандарт'),
              sku: String(it.sku || ''),
              warehouse: wh,
              price: Number(it.price) || 0,
              quantity: Number(it.quantity) || 1,
            }));
            await supabase.from('order_items').insert(subItemRows);
            createdSplitOrders.push({
              doc_number: subDoc,
              warehouse: wh,
              amount: whAmount,
              items_count: whItemsCount,
            });
          }
          splitIdx++;
        }
      } else {
        createdSplitOrders = [{
          doc_number: outboxOrderDoc,
          warehouse: distinctWarehouses[0] || 'Основной Склад Астана',
          amount: finalTotalAmount,
          items_count: finalTotalItems,
        }];
      }

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
      const bodyToSend = validatedOrderPayload || (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body);
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
      if (erpResponse.status >= 500 && ERP_FALLBACK_URL && ERP_FALLBACK_URL !== TARGET_ERP_URL) {
        console.warn(`[ERP Failover] Primary returned ${erpResponse.status}. Attempting fallback endpoint: ${ERP_FALLBACK_URL}`);
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
              const allResp = await fetch(`${targetUrl}?action=supplier_inbound_shipments&portal_key=${SERVER_ERP_KEY}`);
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
                const rmUrl = `${TARGET_ERP_URL}?action=regional_managers&portal_key=${encodeURIComponent(SERVER_ERP_KEY)}`;
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
                const empRole = matchedEmp.role === 'lm' ? 'manager_lm' : (matchedEmp.role === 'admin' ? 'admin' : 'manager_rm');
                const empName = matchedEmp.name || matchedEmp.username || 'Сотрудник ERP';
                const empPhone = matchedEmp.phone || inputLogin;
                const empId = matchedEmp.id;
                const uId = `erp-employee-${empId}`;

                const SECRET_KEY = process.env.PORTAL_SECRET_KEY || '';
                const sessionData = {
                  user: {
                    id: uId,
                    email: `${empPhone.replace(/\D+/g, '') || empId}@synergy-portal.kz`,
                    user_metadata: { full_name: empName },
                  },
                  profile: {
                    id: uId,
                    role: empRole,
                    partner_id: null,
                    full_name: empName,
                    phone: empPhone,
                    company_name: 'Synergy Group (ERP)',
                    manager_id: String(empId),
                    price_type: 'wholesale',
                    impersonation_enabled: true,
                  },
                  timestamp: Date.now(),
                };

                const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
                const signedPayload = { data: sessionData, sig };
                const sessionToken = Buffer.from(JSON.stringify(signedPayload)).toString('base64url');

                try {
                  await supabase.from('profiles').upsert({
                    id: crypto.randomUUID(),
                    role: empRole,
                    full_name: empName,
                    company_name: 'Synergy Group (ERP)',
                    phone: empPhone,
                    manager_id: String(empId),
                    impersonation_enabled: true,
                    updated_at: new Date().toISOString(),
                  }, { onConflict: 'phone' });
                } catch (e) {
                  console.warn('[API Proxy ERP] Employee profile upsert notice:', e);
                }

                res.status(200);
                return res.json({
                  success: true,
                  user_type: 'employee',
                  manager_id: empId,
                  name: empName,
                  role: empRole,
                  phone: empPhone,
                  token: sessionToken,
                  portal_session_token: sessionToken,
                  employee: {
                    id: empId,
                    name: empName,
                    role: empRole,
                    phone: empPhone,
                  },
                });
              }

              // 2. Проверяем, не является ли логин/телефон зарегистрированным клиентом (дилером) в ERP
              if (inputCleanPhone && inputCleanPhone.length >= 7) {
                let counterparties: any[] = [];
                try {
                  const cpUrl = `${TARGET_ERP_URL}?action=counterparties&phone=${encodeURIComponent(inputCleanPhone)}&portal_key=${encodeURIComponent(SERVER_ERP_KEY)}`;
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
                    const allUrl = `${TARGET_ERP_URL}?action=counterparties&portal_key=${encodeURIComponent(SERVER_ERP_KEY)}`;
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
                  // Проверка деактивации клиента в ERP
                  if (matchedClient.is_active === 0 || matchedClient.portal_access_enabled === false || matchedClient.status === 'inactive' || matchedClient.access === 'disabled') {
                    res.status(403);
                    return res.json({
                      success: false,
                      code: 'CLIENT_DEACTIVATED',
                      error: 'Доступ к оптовому порталу заблокирован: учетная запись клиента деактивирована в ERP.',
                    });
                  }

                  const inputPass = String(loginBody.password || req.query?.password || '').trim();
                  const cPhone = String(matchedClient.phone || inputCleanPhone).replace(/\D+/g, '');
                  const last6 = cPhone.slice(-6);
                  const last4 = cPhone.slice(-4);

                  // Проверяем сохраненный пароль в базе данных с поддержкой bcrypt и плавной миграцией
                  let customPasswordMatched = false;
                  try {
                    const { data: dbProfile } = await supabase
                      .from('profiles')
                      .select('password_hash')
                      .eq('phone', matchedClient.phone)
                      .maybeSingle();

                    if (dbProfile?.password_hash && inputPass) {
                      const storedHash = String(dbProfile.password_hash).trim();
                      if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
                        customPasswordMatched = await bcrypt.compare(inputPass, storedHash);
                      } else {
                        // Обратная совместимость с SHA-256 и прозрачный апгрейд на bcrypt
                        const inputHash = crypto.createHash('sha256').update(inputPass).digest('hex');
                        if (storedHash === inputHash) {
                          customPasswordMatched = true;
                          try {
                            const bcryptHash = await bcrypt.hash(inputPass, 10);
                            await supabase
                              .from('profiles')
                              .update({ password_hash: bcryptHash })
                              .eq('phone', matchedClient.phone);
                          } catch (upgradeErr) {
                            console.warn('[AUTH] Automatic bcrypt upgrade notice:', upgradeErr);
                          }
                        }
                      }
                    }
                  } catch (pwErr) {
                    console.warn('[AUTH] Password verification error:', pwErr);
                  }

                  // Проверка стойкости пароля (Enterprise Security Standard):
                  // Запрещены тривиальные пароли (123456, окончания телефонов и т.д.)
                  const isTrivialPassword = (p: string) => {
                    const norm = p.toLowerCase().trim();
                    return (
                      norm.length < 8 ||
                      ['123456', '12345678', 'password', 'qwerty', '111111', '000000', 'admin123'].includes(norm) ||
                      (last6 && norm === last6) ||
                      (last4 && norm === last4)
                    );
                  };

                  const isPasswordValid = customPasswordMatched || (
                    Boolean(inputPass) &&
                    !isTrivialPassword(inputPass) &&
                    inputPass.length >= 8
                  );

                  if (isPasswordValid) {
                    const pId = String(matchedClient.id || '');
                    const uId = `erp-client-${pId}`;
                    const fName = String(matchedClient.name || 'Оптовый клиент');
                    const priceType = String(matchedClient.price_type || 'wholesale');
                    const debtUsd = typeof matchedClient.financials?.debt_usd === 'number' ? matchedClient.financials.debt_usd : (matchedClient.debt_usd || 0);
                    const balanceUsd = typeof matchedClient.financials?.balance_usd === 'number' ? matchedClient.financials.balance_usd : (matchedClient.balance_usd || 0);

                    const SECRET_KEY = process.env.PORTAL_SECRET_KEY || '';
                    const sessionData = {
                      user: {
                        id: uId,
                        email: `${cPhone || pId}@kilem-khan.kz`,
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

                    const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
                    const signedPayload = { data: sessionData, sig };
                    const sessionToken = Buffer.from(JSON.stringify(signedPayload)).toString('base64url');

                    // Синхронизируем профиль клиента в БД
                    try {
                      await supabase.from('profiles').upsert({
                        id: crypto.randomUUID(),
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
                      console.warn('[API Proxy ERP] Profile upsert notice:', e);
                    }

                    res.status(200);
                    return res.json({
                      success: true,
                      token: sessionToken,
                      portal_session_token: sessionToken,
                      client_id: Number(pId),
                      name: fName,
                      phone: matchedClient.phone || inputLogin,
                      is_initial_password: !customPasswordMatched,
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
                  } else {
                    res.status(401);
                    return res.json({
                      success: false,
                      code: 'AUTH_FAILED',
                      error: `Неверный пароль для клиента «${matchedClient.name}». Пароль должен содержать минимум 8 символов и не быть тривиальным (123456 или цифры телефона запрещены). Для первого входа или сброса обратитесь к вашему менеджеру.`,
                    });
                  }
                }
              }
            }
          } catch (empFallbackErr) {
            console.warn('[API Proxy ERP] Employee fallback auth notice:', empFallbackErr);
          }
        }
      }

      if (action === 'create_order') {
        if (outboxOrderId && jsonData.success && jsonData.order?.doc_number) {
          await supabase
            .from('orders')
            .update({
              order_number: jsonData.order.doc_number,
              status: 'processing',
              updated_at: new Date().toISOString(),
            })
            .eq('id', outboxOrderId);
        }

        // Обработка 409 Conflict / INSUFFICIENT_STOCK от 1C:ERP
        if (erpResponse.status === 409 || jsonData?.error_code === 'INSUFFICIENT_STOCK') {
          if (outboxOrderId) {
            await supabase
              .from('orders')
              .update({
                status: 'cancelled',
                notes: `[Отклонено ERP: Недостаточно остатка] ${jsonData.details?.sku ? `SKU: ${jsonData.details.sku}, запрошено: ${jsonData.details.requested_qty}, доступно: ${jsonData.details.available_qty}` : (jsonData.error || '')}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', outboxOrderId);
          }
        }

        if (jsonData && typeof jsonData === 'object' && createdSplitOrders.length > 0) {
          jsonData.split_orders = createdSplitOrders;
          if (jsonData.order && typeof jsonData.order === 'object') {
            jsonData.order.split_orders = createdSplitOrders;
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
        message: 'Заказ успешно зафиксирован и сохранен в буфере синхронизации с Synergy ERP.',
      });
    }

    return res.status(502).json({
      success: false,
      error: err?.name === 'AbortError' ? 'Сервер ERP не ответил вовремя (Таймаут 12с)' : 'Ошибка соединения с сервером ERP (Bad Gateway)',
      details: err?.message,
    });
  }
}
