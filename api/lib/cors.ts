import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://b2b.synergy.kz',
  'https://synergy-b2b-portal.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

/**
 * Validates the incoming Request Origin and sets strict CORS headers.
 * Returns true if request should proceed, or false if it was an OPTIONS preflight handled or rejected.
 */
export function applyCorsHeaders(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || (Array.isArray(req.headers.origin) ? req.headers.origin[0] : undefined);
  
  // Custom origins from environment
  const customOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
    
  const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...customOrigins]);

  // Check if current origin is allowed
  let isAllowed = false;
  if (!origin) {
    // Direct server-to-server or same-origin requests (e.g. curl, crons, webhooks)
    isAllowed = true;
  } else if (allowedOrigins.has(origin)) {
    isAllowed = true;
  } else if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
    isAllowed = true;
  } else if (origin.endsWith('.vercel.app') && origin.includes('synergy-b2b-portal')) {
    // Allow Vercel preview environments only for this project
    isAllowed = true;
  }

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Content-Type, X-Portal-Key, Idempotency-Key, Authorization, X-Correlation-ID, X-Request-ID'
    );
  } else {
    // Origin not in whitelist
    if (req.method === 'OPTIONS') {
      res.status(403).json({ error: 'CORS origin not allowed' });
      return false;
    }
  }

  // Handle preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return false;
  }

  return true;
}
