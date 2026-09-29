import { erpFetch, deduplicateRequest } from './core';
import type { ErpDisplaySettings } from './types';

let cachedDisplaySettings: { settings: ErpDisplaySettings; expiry: number } | null = null;

export async function fetchDisplaySettingsFromErp(bypassCache = false): Promise<ErpDisplaySettings | null> {
  if (!bypassCache && cachedDisplaySettings && cachedDisplaySettings.expiry > Date.now()) {
    return cachedDisplaySettings.settings;
  }

  return deduplicateRequest('display_settings', async () => {
    try {
      const response = await erpFetch('display_settings', {
        method: 'GET',
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.success && data?.settings) {
          cachedDisplaySettings = { settings: data.settings, expiry: Date.now() + 60000 };
          return data.settings;
        }
      }
    } catch (err) {
      console.warn('[fetchDisplaySettingsFromErp] Error fetching display settings from ERP:', err);
    }
    return cachedDisplaySettings ? cachedDisplaySettings.settings : null;
  });
}

/**
 * Сохранение глобальных настроек видимости в ERP (action=display_settings).
 */
export async function saveDisplaySettingsToErp(settings: Partial<ErpDisplaySettings>): Promise<boolean> {
  cachedDisplaySettings = null;
  try {
    const response = await erpFetch('display_settings', {
      method: 'POST',
      body: { settings },
    });
    if (response.ok) {
      const data = await response.json();
      return !!data?.success;
    }
  } catch (err) {
    console.warn('[saveDisplaySettingsToErp] Error saving display settings to ERP:', err);
  }
  return false;
}
