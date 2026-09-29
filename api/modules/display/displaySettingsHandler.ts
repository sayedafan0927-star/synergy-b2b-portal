import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../../lib/authGuard';

let displaySettingsCache: { data: any; expiry: number } | null = null;

export function getFallbackDisplaySettings() {
  return {
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
}

export function updateDisplaySettingsCache(data: any, ttlMs: number = 60000) {
  displaySettingsCache = {
    data,
    expiry: Date.now() + ttlMs,
  };
}

export function getCachedDisplaySettings(): any | null {
  if (displaySettingsCache && displaySettingsCache.expiry > Date.now()) {
    return displaySettingsCache.data;
  }
  return null;
}

export async function handleDisplaySettingsGet(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
  if (!isRefresh && displaySettingsCache && displaySettingsCache.expiry > Date.now()) {
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(displaySettingsCache.data);
    return true;
  }
  return false;
}

export async function handleDisplaySettingsPost(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const auth = await authenticateRequest(req, { requiredRoles: ['admin'], allowServerKey: true });
  if (!auth.isAuthenticated || auth.error) {
    res.status(403).json({ success: false, error: auth.error || 'Access denied' });
    return true;
  }
  const submittedSettings = req.body?.settings || req.body;
  if (submittedSettings) {
    updateDisplaySettingsCache({ success: true, ...submittedSettings }, 60000);
  }
  return false;
}
