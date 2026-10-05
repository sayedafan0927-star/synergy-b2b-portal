import { getAuthHeaders } from '@/lib/erpApi';

export interface ClientWarehouseSettings {
  mode: 'auto' | 'custom';
  showCentralWarehouse: boolean; // default true
  showShowroomWarehouse: boolean; // default true
  showStockSummary?: boolean; // default false for clients, true for admin: gives visibility to stock summary & reservations
  allowedWarehouseIds?: number[]; // explicit list of other allowed warehouse IDs
  hiddenWarehouseIds?: number[];  // explicit list of hidden warehouse IDs
  customName?: string;
  updatedAt?: string;
}

export const STORAGE_KEY = 'synergy:client_warehouse_rules';
export const CENTRAL_WAREHOUSE_ID = 81;
export const CENTRAL_WAREHOUSE_NAME = 'Основной Склад Астана';

let serverRulesCache: Record<string, ClientWarehouseSettings> | null = null;

/**
 * Инициализация и синхронизация складских правил из базы данных PostgreSQL
 */
export async function initWarehouseRulesFromServer(): Promise<Record<string, ClientWarehouseSettings>> {
  if (typeof window === 'undefined') return {};
  try {
    const res = await fetch('/api/warehouse-rules');
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return getAllClientWarehouseRules();
      }
      const data = await res.json();
      if (data?.success && data?.rules) {
        serverRulesCache = data.rules;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.rules));
        triggerWarehouseSettingsReload();
        return data.rules;
      }
    }
  } catch (err) {
    console.warn('[warehouseVisibility] Network sync fallback to localStorage:', err);
  }
  return getAllClientWarehouseRules();
}

// Запускаем фоновую синхронизацию с сервером при старте в браузере
if (typeof window !== 'undefined') {
  initWarehouseRulesFromServer().catch(() => {});
}

/**
 * Получить все сохранённые правила видимости складов для клиентов
 */
export function getAllClientWarehouseRules(): Record<string, ClientWarehouseSettings> {
  if (typeof window === 'undefined') return {};
  if (serverRulesCache) return serverRulesCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    serverRulesCache = parsed;
    return parsed;
  } catch (err) {
    console.warn('[warehouseVisibility] Failed to parse stored rules:', err);
    return {};
  }
}

/**
 * Получить настройки конкретного клиента по его ID или partner_id
 */
export function getClientWarehouseSettings(clientIdOrPartnerId?: string | number | null): ClientWarehouseSettings {
  const defaultAuto: ClientWarehouseSettings = {
    mode: 'auto',
    showCentralWarehouse: true,
    showShowroomWarehouse: true,
    showStockSummary: false,
  };

  if (!clientIdOrPartnerId) return defaultAuto;

  const key = String(clientIdOrPartnerId).trim();
  const allRules = getAllClientWarehouseRules();

  if (allRules[key]) {
    return allRules[key];
  }

  // Также пробуем ключ без префикса 'erp-client-' если есть
  const cleanKey = key.replace(/^erp-client-/, '');
  if (allRules[cleanKey]) {
    return allRules[cleanKey];
  }

  return defaultAuto;
}

/**
 * Сохранить настройки видимости складов для клиента
 */
export function saveClientWarehouseSettings(
  clientIdOrPartnerId: string | number,
  settings: ClientWarehouseSettings
): void {
  if (typeof window === 'undefined') return;
  try {
    const key = String(clientIdOrPartnerId).trim();
    const cleanKey = key.replace(/^erp-client-/, '');
    const allRules = getAllClientWarehouseRules();

    const payload = {
      ...settings,
      updatedAt: new Date().toISOString(),
    };

    allRules[key] = payload;
    if (cleanKey !== key) {
      allRules[cleanKey] = payload;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(allRules));

    // Персистируем настройки в PostgreSQL через защищенный серверный API
    getAuthHeaders().then(authHeaders => {
      if (!authHeaders['Authorization']) {
        console.warn('[warehouseVisibility] Missing Authorization header for warehouse rules sync');
      }
      fetch('/api/warehouse-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ clientId: cleanKey, settings: payload }),
      }).catch(err => console.warn('[warehouseVisibility] Background sync to PostgreSQL failed:', err));
    }).catch(() => {});

    triggerWarehouseSettingsReload();
  } catch (err) {
    console.error('[warehouseVisibility] Failed to save settings:', err);
  }
}

/**
 * Сбросить настройки клиента на автоматический режим по умолчанию
 */
export function resetClientWarehouseSettings(clientIdOrPartnerId: string | number): void {
  if (typeof window === 'undefined') return;
  try {
    const key = String(clientIdOrPartnerId).trim();
    const cleanKey = key.replace(/^erp-client-/, '');
    const allRules = getAllClientWarehouseRules();

    delete allRules[key];
    delete allRules[cleanKey];

    localStorage.setItem(STORAGE_KEY, JSON.stringify(allRules));

    // Синхронизируем сброс (удаление) с PostgreSQL
    getAuthHeaders().then(authHeaders => {
      fetch(`/api/warehouse-rules?client_id=${encodeURIComponent(cleanKey)}`, {
        method: 'DELETE',
        headers: authHeaders,
      }).catch(err => console.warn('[warehouseVisibility] Background reset in PostgreSQL failed:', err));
    }).catch(() => {});

    triggerWarehouseSettingsReload();
  } catch (err) {
    console.error('[warehouseVisibility] Failed to reset settings:', err);
  }
}

/**
 * Оповещение компонентов об изменении настроек видимости складов
 */
export function triggerWarehouseSettingsReload(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:reload-warehouse-settings'));
  }
}
