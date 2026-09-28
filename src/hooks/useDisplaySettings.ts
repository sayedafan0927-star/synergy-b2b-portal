import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface DisplaySettings {
  show_stock: boolean;
  show_reserve: boolean;
  show_total_pcs: boolean;
  show_sqm: boolean;
  show_price: boolean;
  show_hub_warehouse?: boolean;
  show_showroom_warehouse?: boolean;
  hidden_warehouses?: string[];
}

const DEFAULT_SETTINGS: Record<string, DisplaySettings> = {
  admin: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
  manager_rm: { show_stock: true, show_reserve: true, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
  manager_lm: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
  supplier: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: false, show_hub_warehouse: true, show_showroom_warehouse: false, hidden_warehouses: [] },
  client: { show_stock: true, show_reserve: false, show_total_pcs: true, show_sqm: true, show_price: true, show_hub_warehouse: true, show_showroom_warehouse: true, hidden_warehouses: [] },
};

export function triggerDisplaySettingsReload() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:reload-display-settings'));
  }
}

const STORAGE_KEY = 'synergy:display_settings';

export function useDisplaySettings() {
  const { profile, user } = useAuth();
  const currentRole = profile?.role || (user ? 'client' : 'client');

  const getStoredSettings = useCallback((): DisplaySettings => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed[currentRole]) return parsed[currentRole];
        }
      } catch {
        // fallback
      }
    }
    return DEFAULT_SETTINGS[currentRole] || DEFAULT_SETTINGS.client;
  }, [currentRole]);

  const [settings, setSettings] = useState<DisplaySettings>(getStoredSettings);
  const [loading, setLoading] = useState(false);

  const loadSettings = useCallback(() => {
    setSettings(getStoredSettings());
  }, [getStoredSettings]);

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
