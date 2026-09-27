import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface DisplaySettings {
  show_stock: boolean;
  show_reserve: boolean;
  show_total_pcs: boolean;
  show_sqm: boolean;
  show_price: boolean;
}

const DEFAULT_SETTINGS: Record<string, DisplaySettings> = {
  admin: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true },
  manager_rm: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true },
  manager_lm: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true },
  supplier: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: false },
  client: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true },
};

export function triggerDisplaySettingsReload() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:reload-display-settings'));
  }
}

export function useDisplaySettings() {
  const { profile, user } = useAuth();
  const currentRole = profile?.role || (user ? 'client' : 'client');

  const [settings, setSettings] = useState<DisplaySettings>(
    DEFAULT_SETTINGS[currentRole] || DEFAULT_SETTINGS.client,
  );
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('display_settings')
        .select('target_role, show_stock, show_reserve, show_total_pcs, show_sqm, show_price')
        .eq('target_role', currentRole)
        .maybeSingle();

      if (!error && data) {
        setSettings({
          show_stock: data.show_stock,
          show_reserve: data.show_reserve,
          show_total_pcs: data.show_total_pcs,
          show_sqm: data.show_sqm,
          show_price: data.show_price,
        });
      } else {
        setSettings(DEFAULT_SETTINGS[currentRole] || DEFAULT_SETTINGS.client);
      }
    } catch {
      setSettings(DEFAULT_SETTINGS[currentRole] || DEFAULT_SETTINGS.client);
    } finally {
      setLoading(false);
    }
  }, [currentRole]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const handler = () => {
      loadSettings();
    };
    window.addEventListener('synergy:reload-display-settings', handler);
    return () => window.removeEventListener('synergy:reload-display-settings', handler);
  }, [loadSettings]);

  return { settings, loading, reloadSettings: loadSettings };
}
