import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../lib/cors';
import { applyCorrelationId } from '../lib/trace';
import { enforceRateLimit } from '../lib/rateLimit';
import { authenticateRequest } from '../lib/authGuard';
import { handleReconciliationReport } from '../modules/reconciliation';
import { getErpApiKey } from '../lib/erpKey';

const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = getErpApiKey();

/**
 * Isolated Domain Micro-Endpoint: Reconciliation Report Service
 * Route: POST /api/financial/reconciliation
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) return;
  applyCorrelationId(req, res);

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ success: false, error: 'Метод не поддерживается. Ожидается POST или GET.' });
  }

  if (!(await enforceRateLimit(req, res, { limit: 30, windowSeconds: 60, actionPrefix: 'financial_reconciliation' }))) {
    return;
  }

  const callerAuth = await authenticateRequest(req, { allowServerKey: true });
  if (!callerAuth.isAuthenticated) {
    return res.status(401).json({ success: false, error: callerAuth.error || 'Требуется авторизация.' });
  }

  return await handleReconciliationReport(req, res, TARGET_ERP_URL, SERVER_ERP_KEY);
}
