import type { VercelRequest, VercelResponse } from '@vercel/node';

const TARGET_ERP_URL = process.env.ERP_API_URL || 'https://kilem-khan.kz/api/sin/public/api_portal.php';
const SERVER_ERP_KEY = process.env.ERP_API_KEY || process.env.VITE_ERP_API_KEY || '138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type, X-Portal-Key, Idempotency-Key, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Собираем Query параметры
    const queryParams = new URLSearchParams();
    for (const [key, val] of Object.entries(req.query)) {
      if (Array.isArray(val)) {
        val.forEach(v => queryParams.append(key, String(v)));
      } else if (val !== undefined && val !== null) {
        queryParams.set(key, String(val));
      }
    }

    // Добавляем серверный ключ портала
    queryParams.set('portal_key', SERVER_ERP_KEY);

    const targetUrl = `${TARGET_ERP_URL}?${queryParams.toString()}`;

    const headers: Record<string, string> = {
      'X-Portal-Key': SERVER_ERP_KEY,
      'Accept': 'application/json',
    };

    if (req.headers['idempotency-key']) {
      headers['Idempotency-Key'] = String(req.headers['idempotency-key']);
    }

    let fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      fetchOptions = {
        ...fetchOptions,
        body,
      };
    }

    const erpResponse = await fetch(targetUrl, fetchOptions);
    const contentType = erpResponse.headers.get('content-type') || 'application/json';
    const textData = await erpResponse.text();

    res.status(erpResponse.status);
    res.setHeader('Content-Type', contentType);

    try {
      const jsonData = JSON.parse(textData);
      return res.json(jsonData);
    } catch {
      return res.send(textData);
    }
  } catch (err: any) {
    console.error('[API Proxy ERP] Error proxying request:', err);
    return res.status(502).json({
      success: false,
      error: 'Ошибка соединения с сервером ERP (Bad Gateway)',
      details: err?.message,
    });
  }
}
