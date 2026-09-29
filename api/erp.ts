import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { recordAuditLog } from './audit/logs';
import { applyCorrelationId } from './lib/trace';
import { enforceRateLimit, getClientIp } from './lib/rateLimit';
import { getCachedCatalog, saveCachedCatalog } from './lib/catalogCache';
import { authenticateRequest, revokeToken } from './lib/authGuard';
import { applyCorsHeaders } from './lib/cors';
import { checkCircuit, recordSuccess, recordFailure } from './lib/circuitBreaker';
import { handleCreateLead } from './modules/leads';
import { handleReconciliationReport } from './modules/reconciliation';
import { handleCatalogRequests } from './modules/catalog/catalogHandler';
import { handleCreateOrder } from './modules/orders/createOrderHandler';
import { handleCachedClientDebt } from './modules/financial/debtHandler';
import { handleFinancialBalanceSheet } from './modules/financial/balanceHandler';
import { handleDlqOrders, handleRetryDlqOrder } from './modules/dlq/dlqHandler';
import {
  handleDisplaySettingsGet,
  handleDisplaySettingsPost,
  getFallbackDisplaySettings,
  updateDisplaySettingsCache,
} from './modules/display/displaySettingsHandler';
import { handleRequestApproval } from './modules/approvals/approvalHandler';
import {
  normalizeSupplierStockDistribution,
  filterSupplierShipments,
  handleSupplierDefects,
} from './modules/supplier/supplierHandler';
import {
  normalizeErpDesigns,
  handleErpLoginToken,
  handleErpLoginFallback,
} from './modules/erp/upstreamProxy';
import { handleEmployeeLoginFallback } from './modules/auth/loginHandler';
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
  'session_token',
]);

// Защищенные административные действия
const ADMIN_ACTIONS = new Set([
  'update_client_access',
  'update_order_status',
  'sync_bundle',
  'financial_balance',
]);

let lastKnownInboundShipments: any = null;

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
      return await handleDlqOrders(req, res, supabase);
    }

    if (action === 'retry_dlq_order' && req.method === 'POST') {
      return await handleRetryDlqOrder(req, res, supabase, correlationId);
    }

    // 0.9. Кэш настроек отображения (60s TTL)
    if (action === 'display_settings' && req.method === 'GET') {
      if (await handleDisplaySettingsGet(req, res)) return;
    }

    if (action === 'display_settings' && req.method === 'POST') {
      if (await handleDisplaySettingsPost(req, res)) return;
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
      return await handleRequestApproval(req, res, correlationId);
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

      // Управленческий баланс предприятия (Чистый капитал, активы, забаланс)
      if (action === 'financial_balance' && req.method === 'GET') {
        await handleFinancialBalanceSheet(req, res, supabase);
        return;
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

    // Генерация криптографически подписанной сессии портала (HMAC-SHA256)
    if (action === 'session_token' && req.method === 'POST') {
      const SECRET_KEY = process.env.PORTAL_SECRET_KEY || process.env.ERP_PORTAL_SECRET || '';
      if (!SECRET_KEY) {
        return res.status(500).json({ success: false, error: 'Server secret key not configured' });
      }
      let body: any = {};
      try {
        if (Buffer.isBuffer(req.body)) {
          body = JSON.parse(req.body.toString('utf8'));
        } else if (typeof req.body === 'string') {
          body = JSON.parse(req.body || '{}');
        } else if (typeof req.body === 'object' && req.body !== null) {
          body = req.body;
        }
      } catch {}

      const { role = 'client', user, profile } = body || {};
      const validRoles = ['admin', 'manager_rm', 'manager_lm', 'supplier', 'client'];
      const effectiveRole = validRoles.includes(role) ? role : (profile?.role && validRoles.includes(profile.role) ? profile.role : 'client');

      // Anti-Bypass P0: Запрет произвольного назначения привилегированных ролей без подтвержденной серверной аутентификации
      const callerAuth = await authenticateRequest(req, { allowServerKey: true });
      const isPrivileged = ['admin', 'manager_rm', 'manager_lm', 'supplier'].includes(effectiveRole);

      if (isPrivileged) {
        if (!callerAuth.isAuthenticated || (!callerAuth.isServer && callerAuth.role !== 'admin' && callerAuth.role !== effectiveRole)) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: Повышение привилегий до роли сотрудника или администратора запрещено без валидной серверной авторизации.',
          });
        }
      }

      const userId = String(user?.id || profile?.id || callerAuth.userId || `user-${effectiveRole}`);
      const fullName = String(
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        callerAuth.fullName ||
        (effectiveRole === 'admin' ? 'Администратор портала' : 'Пользователь портала')
      );
      const partnerId = profile?.partner_id ? String(profile.partner_id) : (callerAuth.partnerId || null);
      const phone = String(profile?.phone || user?.phone || callerAuth.phone || '');
      const priceType = String(profile?.price_type || callerAuth.priceType || 'wholesale');

      const sessionData = {
        user: {
          id: userId,
          email: user?.email || `${effectiveRole}@kilem-khan.kz`,
          user_metadata: { full_name: fullName },
        },
        profile: {
          id: userId,
          role: effectiveRole,
          partner_id: partnerId,
          full_name: fullName,
          company_name: profile?.company_name || callerAuth.companyName || 'ТОО «Kilem Khan Synergy»',
          phone,
          price_type: priceType,
          showroom_warehouse_id: profile?.showroom_warehouse_id ?? null,
        },
        timestamp: Date.now(),
      };

      const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
      const token = Buffer.from(JSON.stringify({ data: sessionData, sig })).toString('base64url');

      return res.status(200).json({
        success: true,
        token,
        portal_session_token: token,
        user: sessionData.user,
        profile: sessionData.profile,
      });
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
        return handleSupplierDefects(req, res);
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
        if (action === 'supplier_inbound_shipments' && key === 'supplier_id') {
          continue;
        }
        if (Array.isArray(val)) {
          val.forEach(v => queryParams.append(key, String(v)));
        } else if (val !== undefined && val !== null && val !== '') {
          queryParams.set(key, String(val));
        }
      }

      const targetUrl = `${TARGET_ERP_URL}?${queryParams.toString()}`;
      const clientIp = getClientIp(req);
      const callerPortalKey = (req.headers['x-portal-key'] || req.headers['X-Portal-Key']) as string | undefined;
      const keyToSend = SERVER_ERP_KEY || callerPortalKey || '';
      const headers: Record<string, string> = {
        'X-Portal-Key': keyToSend,
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

      // Circuit Breaker: Проверка состояния внешнего шлюза 1C:ERP
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
          return res.status(200).json(getFallbackDisplaySettings());
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

      if (action === 'display_settings') {
        try {
          const jsonData = JSON.parse(textData);
          if (jsonData && jsonData.success && jsonData.settings) {
            updateDisplaySettingsCache(jsonData, 60000);
            return res.status(200).json(jsonData);
          }
        } catch {}
        const fallbackSettings = getFallbackDisplaySettings();
        updateDisplaySettingsCache(fallbackSettings, 60000);
        return res.status(200).json(fallbackSettings);
      }

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
          normalizeErpDesigns(jsonData);

          if (Array.isArray(jsonData.products)) {
            saveCachedCatalog(jsonData, 'catalog_global').catch(e => console.warn('[API Proxy ERP] Cache save error:', e));
            res.setHeader('X-Cache', 'MISS');
          }
        }

        if (action === 'display_settings' && erpResponse.ok && jsonData?.success) {
          updateDisplaySettingsCache(jsonData, 60000);
        }

        if (action === 'client_debt' && erpResponse.ok && jsonData?.success) {
          const pId = String(req.query.counterparty_id || req.query.client_id || jsonData.client?.partner_id || jsonData.partner_id || '');
          const fin = jsonData.financials || {};
          const bal = typeof fin.balance_usd === 'number' ? fin.balance_usd : (typeof jsonData.balance_usd === 'number' ? jsonData.balance_usd : -Number(fin.total_debt_usd || jsonData.debt_usd || 0));
          const isOverdue = Boolean(fin.is_overdue || jsonData.is_overdue);
          const overdueDays = Number(fin.max_overdue_days || fin.overdue_days || 0);

          if (pId && supabase) {
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
              .catch((e: any) => console.warn('[Financial Cache] Update error:', e));
          }
        }

        if (action === 'supplier_network_stock' && erpResponse.ok && jsonData?.success) {
          normalizeSupplierStockDistribution(jsonData);
        }

        if (action === 'supplier_inbound_shipments' && erpResponse.ok && jsonData?.success) {
          filterSupplierShipments(jsonData, req.query.supplier_id);
          lastKnownInboundShipments = jsonData;
        }

        if (action === 'login') {
          if (erpResponse.ok && jsonData?.success) {
            handleErpLoginToken(jsonData, supabase);
          } else {
            const handled = await handleErpLoginFallback(req, res, TARGET_ERP_URL, SERVER_ERP_KEY, correlationId);
            if (handled) return;
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
        const fallbackSettings = getFallbackDisplaySettings();
        updateDisplaySettingsCache(fallbackSettings, 60000);
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

      if (action === 'supplier_inbound_shipments' && lastKnownInboundShipments) {
        res.status(200);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-Cache', 'STALE_FALLBACK');
        return res.json(lastKnownInboundShipments);
      }

      if (action === 'client_debt' && supabase) {
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
