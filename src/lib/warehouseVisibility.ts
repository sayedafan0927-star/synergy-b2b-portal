import type { Warehouse } from '@/types';
import type { Profile } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export interface ClientWarehouseSettings {
  mode: 'auto' | 'custom';
  showCentralWarehouse: boolean; // default true
  showShowroomWarehouse: boolean; // default true
  allowedWarehouseIds?: number[]; // explicit list of other allowed warehouse IDs
  hiddenWarehouseIds?: number[];  // explicit list of hidden warehouse IDs
  customName?: string;
  updatedAt?: string;
}

const STORAGE_KEY = 'synergy:client_warehouse_rules';
export const CENTRAL_WAREHOUSE_ID = 81;
export const CENTRAL_WAREHOUSE_NAME = 'Основной Склад Астана';

export function isCentralWarehouse(w: { warehouse_id?: number; warehouse_name?: string; city?: string; is_hub?: boolean }): boolean {
  if (w.warehouse_id === CENTRAL_WAREHOUSE_ID) return true;
  if (w.is_hub) return true;
  const name = (w.warehouse_name || '').toLowerCase();
  const city = (w.city || '').toLowerCase();
  return name.includes('астана') || name.includes('основной') || city.includes('астана');
}

/**
 * Получить все сохранённые правила видимости складов для клиентов
 */
export function getAllClientWarehouseRules(): Record<string, ClientWarehouseSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
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

    // Пробуем также сохранить в Supabase display_settings или profiles (без блокировки)
    try {
      supabase
        .from('display_settings')
        .upsert({
          target_role: `client:${cleanKey}`,
          show_stock: settings.showCentralWarehouse,
          show_reserve: false,
          show_total_pcs: settings.showShowroomWarehouse,
          show_sqm: true,
          show_price: true,
          updated_at: new Date().toISOString(),
        })
        .then(() => {})
        .catch(() => {});
    } catch {
      // Игнорируем сетевые ошибки фонового синка
    }

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

/**
 * Проверка: виден ли конкретный склад для указанного профиля клиента.
 * 
 * Логика:
 * 1. Если пользователь не клиент (например, админ без имперсонации) — видит все склады.
 * 2. Если режим 'auto' (по умолчанию):
 *    - Центральный склад (Астана, ID 81) — ВИДЕН.
 *    - Собственный склад клиента (showroom_warehouse_id) — ВИДЕН (если назначен).
 *    - Если собственного склада нет — видит ТОЛЬКО центральный склад Астана.
 *    - Все остальные чужие склады — СКРЫТЫ.
 * 3. Если режим 'custom' (настроен админом):
 *    - Центральный склад — виден только если showCentralWarehouse === true.
 *    - Собственный склад — виден только если showShowroomWarehouse === true.
 *    - Другие склады — видны только если явно указаны в allowedWarehouseIds или не скрыты в hiddenWarehouseIds.
 */
export function isWarehouseVisibleForClient(
  warehouse: { warehouse_id?: number; warehouse_name?: string; city?: string; is_hub?: boolean },
  clientProfile?: Partial<Profile> | null
): boolean {
  // Если профиль не передан или роль не 'client' — считаем доступным (для админа/менеджера)
  if (!clientProfile || (clientProfile.role && clientProfile.role !== 'client')) {
    return true;
  }

  const clientId = clientProfile.partner_id || clientProfile.id;
  const settings = getClientWarehouseSettings(clientId);
  const isHub = isCentralWarehouse(warehouse);
  const showroomId = clientProfile.showroom_warehouse_id;
  const isOwnShowroom = Boolean(showroomId && warehouse.warehouse_id && warehouse.warehouse_id === showroomId);

  if (settings.mode === 'custom') {
    if (isHub) {
      return settings.showCentralWarehouse;
    }
    if (isOwnShowroom) {
      return settings.showShowroomWarehouse;
    }
    // Если это другой склад:
    if (warehouse.warehouse_id && settings.hiddenWarehouseIds?.includes(warehouse.warehouse_id)) {
      return false;
    }
    if (warehouse.warehouse_id && settings.allowedWarehouseIds?.includes(warehouse.warehouse_id)) {
      return true;
    }
    return false;
  }

  // Режим 'auto':
  // 1. Центральный склад Астана виден всегда (если есть)
  if (isHub) {
    return true;
  }

  // 2. Персональный склад шоурума виден только если он назначен клиенту
  if (isOwnShowroom) {
    return true;
  }

  // Все остальные склады для обычного клиента скрыты
  return false;
}

/**
 * Фильтрация массива складов товара под профиль клиента с нормализацией названий
 */
export function filterWarehousesForClient(
  warehouses: Warehouse[] = [],
  clientProfile?: Partial<Profile> | null,
  fallbackShowroomName?: string | null
): Warehouse[] {
  if (!warehouses || warehouses.length === 0) {
    return [];
  }

  // Если это не клиент (например, админ без имперсонации) — возвращаем все склады с ненулевым остатком
  if (clientProfile && clientProfile.role && clientProfile.role !== 'client') {
    return warehouses.filter(w => Number(w.stock) > 0);
  }

  const clientId = clientProfile?.partner_id || clientProfile?.id;
  const settings = getClientWarehouseSettings(clientId);
  const showroomId = clientProfile?.showroom_warehouse_id;
  const showroomName = fallbackShowroomName || clientProfile?.showroom_warehouse_name || 'В моем магазине';

  const result: Warehouse[] = [];

  // 1. Центральный склад компании — ID 81 («Основной Склад Астана»)
  const allowHub = settings.mode === 'custom' ? settings.showCentralWarehouse : true;
  if (allowHub) {
    const mainHub = warehouses.find(w => w.warehouse_id === CENTRAL_WAREHOUSE_ID)
      || warehouses.find(w => isCentralWarehouse(w) && Number(w.stock) > 0);

    if (mainHub && Number(mainHub.stock) > 0) {
      result.push({
        warehouse_id: CENTRAL_WAREHOUSE_ID,
        warehouse_name: CENTRAL_WAREHOUSE_NAME,
        city: CENTRAL_WAREHOUSE_NAME,
        is_hub: true,
        stock: Number(mainHub.stock),
      });
    }
  }

  // 2. Персональный склад шоурума клиента
  const allowShowroom = settings.mode === 'custom' ? settings.showShowroomWarehouse : true;
  if (allowShowroom && showroomId && showroomId !== CENTRAL_WAREHOUSE_ID) {
    const showroom = warehouses.find(w => w.warehouse_id === showroomId);
    if (showroom && Number(showroom.stock) > 0) {
      result.push({
        warehouse_id: showroomId,
        warehouse_name: showroomName || showroom.warehouse_name || 'В моем магазине',
        city: showroomName || showroom.warehouse_name || 'В моем магазине',
        is_hub: false,
        stock: Number(showroom.stock),
      });
    }
  }

  // 3. Дополнительные склады, если они были явно включены администратором в кастомном режиме
  if (settings.mode === 'custom' && settings.allowedWarehouseIds && settings.allowedWarehouseIds.length > 0) {
    for (const w of warehouses) {
      if (
        w.warehouse_id &&
        settings.allowedWarehouseIds.includes(w.warehouse_id) &&
        w.warehouse_id !== CENTRAL_WAREHOUSE_ID &&
        w.warehouse_id !== showroomId &&
        Number(w.stock) > 0
      ) {
        result.push({
          ...w,
          stock: Number(w.stock),
        });
      }
    }
  }

  return result;
}
