import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateRequest } from '../../lib/authGuard';

let displaySettingsCache: { data: any; expiry: number } | null = null;
const DEFAULT_RATE = 520.00;

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
      exchange_rate_usd_kzt: DEFAULT_RATE,
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

export async function handleDisplaySettingsGet(
  req: VercelRequest,
  res: VercelResponse,
  supabase?: SupabaseClient,
): Promise<boolean> {
  const isRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
  if (!isRefresh && displaySettingsCache && displaySettingsCache.expiry > Date.now()) {
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(displaySettingsCache.data);
    return true;
  }

  let dbRate = DEFAULT_RATE;
  if (supabase) {
    try {
      const { data } = await supabase
        .from('display_settings')
        .select('exchange_rate_usd_kzt')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.exchange_rate_usd_kzt) {
        dbRate = Number(data.exchange_rate_usd_kzt);
      }
    } catch {
      // fallback to DEFAULT_RATE
    }
  }

  const baseSettings = getFallbackDisplaySettings();
  baseSettings.settings.exchange_rate_usd_kzt = dbRate;
  updateDisplaySettingsCache(baseSettings, 60000);

  res.setHeader('X-Cache', 'MISS');
  res.status(200).json(baseSettings);
  return true;
}

export async function handleDisplaySettingsPost(
  req: VercelRequest,
  res: VercelResponse,
  supabase?: SupabaseClient,
): Promise<boolean> {
  const auth = await authenticateRequest(req, { requiredRoles: ['admin'], allowServerKey: true });
  if (!auth.isAuthenticated || auth.error) {
    res.status(403).json({ success: false, error: auth.error || 'Access denied' });
    return true;
  }

  const submittedSettings = req.body?.settings || req.body;
  if (submittedSettings) {
    const newRate = Number(submittedSettings.exchange_rate_usd_kzt || submittedSettings.exchange_rate || DEFAULT_RATE);
    
    if (supabase && !isNaN(newRate) && newRate > 0) {
      try {
        await supabase
          .from('display_settings')
          .update({
            exchange_rate_usd_kzt: newRate,
            updated_at: new Date().toISOString(),
          })
          .neq('id', '00000000-0000-0000-0000-000000000000');
      } catch (dbErr) {
        console.warn('[DisplaySettings] Error persisting exchange rate to DB:', dbErr);
      }
    }

    const mergedSettings = {
      ...getFallbackDisplaySettings().settings,
      ...submittedSettings,
      exchange_rate_usd_kzt: newRate,
    };

    updateDisplaySettingsCache({ success: true, settings: mergedSettings }, 60000);
    res.status(200).json({ success: true, message: 'Настройки успешно обновлены', settings: mergedSettings });
    return true;
  }
  return false;
}
