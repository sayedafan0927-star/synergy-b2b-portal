import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorrelationId } from './lib/trace';
import { enforceRateLimit, getClientIp } from './lib/rateLimit';
import { authenticateRequest, revokeToken } from './lib/authGuard';
import { applyCorsHeaders } from './lib/cors';
import { handleCreateLead } from './modules/leads';
import { handleNotifyDealerRegistration } from './modules/auth/dealerRegistrationNotification';
import { handleReconciliationReport } from './modules/reconciliation';
import { handleCatalogRequests } from './modules/catalog/catalogHandler';
import { handleResolveCatalogBatch } from './modules/catalog/resolveBatchHandler';
import { handleCreateOrder } from './modules/orders/createOrderHandler';
import { handleCachedClientDebt } from './modules/financial/debtHandler';
import { handleFinancialBalanceSheet } from './modules/financial/balanceHandler';
import { handleRefreshClientBalance } from './modules/financial/refreshBalanceHandler';
import { handleDlqOrders, handleRetryDlqOrder, handleRetryAllDlqOrders } from './modules/dlq/dlqHandler';
import { handleActiveReservations } from './modules/orders/activeReservationsHandler';
import {
  handleDisplaySettingsGet,
  handleDisplaySettingsPost,
} from './modules/display/displaySettingsHandler';
import { handleRequestApproval } from './modules/approvals/approvalHandler';
import { handleCancelOrder } from './modules/orders/cancelOrderHandler';
import { handleGenericErpProxy } from './modules/erp/genericProxyHandler';
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
  'resolve_catalog_batch',
  'product',
  'ping',
  'login',
  'logout',
  'create_lead',
  'notify_dealer_registration',
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
  'reconcile_all_balances',
]);

// Защищенные служебные действия персонала (admin, manager_rm, manager_lm, server)
const STAFF_ACTIONS = new Set([
  'counterparties',
  'regional_managers',
  'suppliers',
]);

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

    if (action === 'retry_all_dlq_orders' && req.method === 'POST') {
      return await handleRetryAllDlqOrders(req, res, supabase, correlationId);
    }

    // 0.8.5. Оперативное оповещение менеджеров о новой регистрации дилера
    if (action === 'notify_dealer_registration' && req.method === 'POST') {
      return await handleNotifyDealerRegistration(req, res, supabase, correlationId);
    }

    // 0.9. Кэш настроек отображения и официального курса валюты (60s TTL)
    if (action === 'display_settings' && req.method === 'GET') {
      if (await handleDisplaySettingsGet(req, res, supabase)) return;
    }

    if (action === 'display_settings' && req.method === 'POST') {
      if (await handleDisplaySettingsPost(req, res, supabase)) return;
    }

    // 1.0. Каталог, карточка товара и серверная пагинация (модульный обработчик)
    if (action === 'catalog' || action === 'catalog_normalized' || action === 'product' || action === 'catalog_paginated') {
      const handled = await handleCatalogRequests(req, res, action, supabase, TARGET_ERP_URL, ERP_FALLBACK_URL, SERVER_ERP_KEY, correlationId);
      if (handled) return;
    }

    if (action === 'resolve_catalog_batch' && req.method === 'POST') {
      return await handleResolveCatalogBatch(req, res, supabase);
    }

    // 1.1. Прямой опрос кэша финансового баланса контрагента (PostgreSQL) с аутентификацией
    if ((action === 'client_debt' || action === 'get_client_debt') && req.method === 'GET' && supabase) {
      const callerAuth = await authenticateRequest(req, { allowServerKey: true });
      if (!callerAuth.isAuthenticated) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация для просмотра задолженности' });
      }
      const handled = await handleCachedClientDebt(req, res, supabase, callerAuth);
      if (handled) return;
    }

    // 1.1.1. Сводный финансовый баланс-лист для администратора
    if (action === 'financial_balance' && req.method === 'GET') {
      return await handleFinancialBalanceSheet(req, res, supabase);
    }

    // 1.1.2. Принудительный онлайн-запрос баланса из 1С дилером или администратором
    if (action === 'refresh_balance' && (req.method === 'POST' || req.method === 'GET')) {
      const callerAuth = await authenticateRequest(req, { allowServerKey: true });
      if (!callerAuth.isAuthenticated) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      return await handleRefreshClientBalance({
        req,
        res,
        callerAuth,
        correlationId,
        supabase,
        targetErpUrl: TARGET_ERP_URL,
        serverErpKey: SERVER_ERP_KEY,
      });
    }

    // 1.1.3. Активные резервы склада (клиенты, товары, объемы)
    if (action === 'active_reservations' && req.method === 'GET') {
      const callerAuth = await authenticateRequest(req, { allowServerKey: true });
      if (!callerAuth.isAuthenticated) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      return await handleActiveReservations(req, res, supabase, callerAuth);
    }

    // 1.2. Быстрое создание лида из модалки каталога
    if (action === 'create_lead' && req.method === 'POST') {
      return await handleCreateLead(req, res, supabase, correlationId);
    }

    // 1.3. Серверная генерация акта сверки взаиморасчетов (Anti-IDOR и клампинг периода)
    if (
      (action === 'reconciliation_report' || action === 'get_reconciliation_report') &&
      (req.method === 'GET' || req.method === 'POST')
    ) {
      return await handleReconciliationReport(req, res, TARGET_ERP_URL, SERVER_ERP_KEY);
    }

    // 1.4. Серверный запрос согласования заказа через WhatsApp
    if (action === 'request_approval' && req.method === 'POST') {
      return await handleRequestApproval(req, res, correlationId);
    }

    // 1.5. Серверная выдача JWT-токена сессии
    if (action === 'session_token' && req.method === 'POST') {
      const callerAuth = await authenticateRequest(req, { allowServerKey: true });
      if (!callerAuth.isAuthenticated || !callerAuth.isServer) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Токены портала могут выпускаться только авторизованными серверными вызовами.',
        });
      }

      const { user_id, phone, role, partner_id, full_name, company_name } = req.body || {};
      if (!user_id && !phone) {
        return res.status(400).json({ success: false, error: 'user_id or phone required' });
      }

      const tokenPayload = {
        sub: user_id || phone,
        user_id: user_id || phone,
        phone: phone || '',
        role: role || 'client',
        partner_id: partner_id || '',
        full_name: full_name || '',
        company_name: company_name || '',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      };

      const JWT_SECRET = process.env.PORTAL_JWT_SECRET || process.env.SUPABASE_JWT_SECRET || SERVER_ERP_KEY;
      if (!JWT_SECRET) {
        return res.status(500).json({ success: false, error: 'Internal Server Error: Missing JWT signing secret configuration.' });
      }
      const b64Url = (str: string | Buffer) => Buffer.from(str as any).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const header = b64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = b64Url(JSON.stringify(tokenPayload));
      const sig = b64Url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest());
      const token = `${header}.${payload}.${sig}`;

      return res.status(200).json({ success: true, token, expires_in: 7 * 24 * 3600 });
    }

    // 1.7. Выход из системы
    if (action === 'logout' && req.method === 'POST') {
      const authHeader = String(req.headers['authorization'] || '');
      const rawTok = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (rawTok) await revokeToken(rawTok);
      return res.status(200).json({ success: true, message: 'Logged out successfully' });
    }

    // 2. ─── Защита эндпоинтов (RBAC & AuthGuard) ───
    const isPublicAction = PUBLIC_ACTIONS.has(action);
    if (!isPublicAction) {
      const verifiedAuth = await authenticateRequest(req, {
        requiredRoles: ADMIN_ACTIONS.has(action) ? ['admin'] : undefined,
        allowServerKey: true,
      });

      if (!verifiedAuth.isAuthenticated) {
        return res.status(401).json({
          success: false,
          error: verifiedAuth.error || 'Unauthorized: Требуется авторизация для выполнения действия',
        });
      }

      const isAdmin = verifiedAuth.role === 'admin';
      const isStaff = isAdmin || verifiedAuth.role === 'manager_rm' || verifiedAuth.role === 'manager_lm';

      if (ADMIN_ACTIONS.has(action) && !isAdmin && !verifiedAuth.isServer) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Недостаточно прав для выполнения административного действия',
        });
      }

      if (STAFF_ACTIONS.has(action) && !isStaff && !verifiedAuth.isServer) {
        if (!(action === 'suppliers' && verifiedAuth.role === 'supplier')) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: Доступ к служебным справочникам разрешен только сотрудникам компании.',
          });
        }
      }

      // Whitelist для оптовых клиентов: блокируем BOLA и несанкционированные действия
      if (verifiedAuth.role === 'client' && !verifiedAuth.isServer) {
        const CLIENT_ALLOWED_ACTIONS = new Set([
          'catalog',
          'catalog_normalized',
          'catalog_paginated',
          'resolve_catalog_batch',
          'product',
          'create_order',
          'client_debt',
          'get_client_debt',
          'refresh_balance',
          'active_reservations',
          'create_lead',
          'reconciliation_report',
          'get_reconciliation_report',
          'request_approval',
          'cancel_order',
          'logout',
          'display_settings',
          'orders',
          'my_orders',
        ]);

        if (!CLIENT_ALLOWED_ACTIONS.has(action)) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: Действие недоступно для учетной записи клиента.',
          });
        }

        // Anti-IDOR: принудительно фиксируем partner_id клиента и санируем phone
        if (verifiedAuth.partnerId) {
          req.query.partner_id = String(verifiedAuth.partnerId);
          req.query.counterparty_id = String(verifiedAuth.partnerId);
          req.query.client_id = String(verifiedAuth.partnerId);
          if (req.body && typeof req.body === 'object') {
            req.body.partner_id = String(verifiedAuth.partnerId);
            req.body.counterparty_id = String(verifiedAuth.partnerId);
            req.body.client_id = String(verifiedAuth.partnerId);
          }
        }
        // Anti-BOLA: клиенты не могут фильтровать чужие заказы через сторонний phone
        if (req.query.phone) {
          req.query.phone = verifiedAuth.phone || '';
        }
        if (req.body && typeof req.body === 'object' && req.body.phone) {
          req.body.phone = verifiedAuth.phone || '';
        }
      }

      // Ограничение доступа для поставщиков к данным только своей фабрики
      if (verifiedAuth.role === 'supplier' && !isAdmin && !verifiedAuth.isServer) {
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

    // 2.9. Безопасная клиентская и административная отмена заказа (T-24 / P1-1)
    if (action === 'cancel_order' && (req.method === 'POST' || req.method === 'DELETE')) {
      const callerAuth = await authenticateRequest(req, { allowServerKey: true });
      if (!callerAuth.isAuthenticated || callerAuth.error) {
        return res.status(401).json({ success: false, error: callerAuth.error || 'Требуется авторизация' });
      }
      await handleCancelOrder({
        req,
        res,
        callerAuth,
        correlationId,
        supabase,
        targetErpUrl: TARGET_ERP_URL,
        serverErpKey: SERVER_ERP_KEY,
      });
      return;
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

    // 4. ─── Универсальное проксирование в ERP через модульный обработчик ───
    // Маршрутизирует запросы, включая логины сотрудников через handleEmployeeLoginFallback
    await handleGenericErpProxy(req, res, {
      action,
      correlationId,
      startTime,
      supabase,
      targetErpUrl: TARGET_ERP_URL,
      erpFallbackUrl: ERP_FALLBACK_URL,
      serverErpKey: SERVER_ERP_KEY,
    });
  } catch (fatalErr: any) {
    console.error('[ERP Proxy Fatal Error]', fatalErr);
    return res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка шлюза API',
      message: fatalErr?.message,
    });
  }
}
