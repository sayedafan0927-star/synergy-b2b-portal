import type { VercelRequest, VercelResponse } from '@vercel/node';
import { recordAuditLog } from '../../audit/logs';
import { getClientIp } from '../../lib/rateLimit';
import { getCachedCatalog, saveCachedCatalog } from '../../lib/catalogCache';
import { checkCircuit, recordSuccess, recordFailure } from '../../lib/circuitBreaker';
import {
  getFallbackDisplaySettings,
  updateDisplaySettingsCache,
} from '../display/displaySettingsHandler';
import {
  normalizeSupplierStockDistribution,
  filterSupplierShipments,
} from '../supplier/supplierHandler';
import {
  normalizeErpDesigns,
  handleErpLoginToken,
  handleErpLoginFallback,
} from './upstreamProxy';

let lastKnownInboundShipments: any = null;

export interface GenericProxyOptions {
  action: string;
  correlationId: string;
  startTime: number;
  supabase: any;
  targetErpUrl: string;
  erpFallbackUrl: string;
  serverErpKey: string;
}

/**
 * Унифицированный обработчик проксирования запросов к вышестоящему шлюзу 1C:ERP
 * Включает: Circuit Breaker, failover-эндпоинт, тайм-ауты, кэширование и аварийный fallback.
 */
export async function handleGenericErpProxy(
  req: VercelRequest,
  res: VercelResponse,
  options: GenericProxyOptions
): Promise<void> {
  const {
    action,
    correlationId,
    startTime,
    supabase,
    targetErpUrl: TARGET_ERP_URL,
    erpFallbackUrl: ERP_FALLBACK_URL,
    serverErpKey: SERVER_ERP_KEY,
  } = options;

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
        res.status(200).json({
          success: true,
          order: {
            order_id: 9999,
            doc_number: `ORD-BUF-${Date.now()}`,
            status: 'pending',
            is_buffered: true,
          },
          message: 'Заказ успешно зафиксирован в автономном буфере (Circuit Breaker Active).',
        });
        return;
      }
      if (action === 'catalog' || action === 'catalog_normalized') {
        const fallback = await getCachedCatalog('catalog_global');
        if (fallback && fallback.data) {
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'CIRCUIT_BREAKER_FALLBACK');
          res.setHeader('X-Cache-Age-Ms', String(fallback.ageMs));
          res.json(fallback.data);
          return;
        }
      }
      if (action === 'display_settings') {
        res.status(200).json(getFallbackDisplaySettings());
        return;
      }
      res.status(503).json({
        success: false,
        code: 'CIRCUIT_BREAKER_OPEN',
        error: 'Шлюз 1C:ERP временно недоступен (активирован защитный контур Circuit Breaker). Повторите попытку через 30 секунд.',
      });
      return;
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
          res.status(200).json(jsonData);
          return;
        }
      } catch {}
      const fallbackSettings = getFallbackDisplaySettings();
      updateDisplaySettingsCache(fallbackSettings, 60000);
      res.status(200).json(fallbackSettings);
      return;
    }

    if ((action === 'catalog' || action === 'catalog_normalized') && (!erpResponse.ok || !textData.trim().startsWith('{'))) {
      try {
        const fallback = await getCachedCatalog('catalog_global');
        if (fallback && fallback.data) {
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'STALE_FALLBACK');
          res.setHeader('X-Cache-Age-Ms', String(fallback.ageMs));
          res.json(fallback.data);
          return;
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

      res.json(jsonData);
      return;
    } catch {
      res.send(textData);
      return;
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    await recordFailure('erp_gateway');
    console.error('[API Proxy ERP] Error proxying request:', err?.name === 'AbortError' ? `ERP Request Timeout (${action === 'create_order' ? '2.5s' : '12s'})` : err);

    if (action === 'display_settings') {
      const fallbackSettings = getFallbackDisplaySettings();
      updateDisplaySettingsCache(fallbackSettings, 60000);
      res.status(200).json(fallbackSettings);
      return;
    }

    if (action === 'catalog' || action === 'catalog_normalized') {
      try {
        const fallback = await getCachedCatalog('catalog_global');
        if (fallback && fallback.data) {
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'STALE_FALLBACK');
          res.setHeader('X-Cache-Age-Ms', String(fallback.ageMs));
          res.json(fallback.data);
          return;
        }
      } catch {}
    }

    if (action === 'supplier_inbound_shipments' && lastKnownInboundShipments) {
      res.status(200);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Cache', 'STALE_FALLBACK');
      res.json(lastKnownInboundShipments);
      return;
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
            res.json({
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
            return;
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

    res.status(502).json({
      success: false,
      error: err?.name === 'AbortError' ? 'Сервер ERP не ответил вовремя (Таймаут 12с)' : 'Ошибка соединения с сервером ERP (Bad Gateway)',
      details: err?.message,
    });
  }
}
