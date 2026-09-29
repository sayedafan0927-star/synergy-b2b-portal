import type { Warehouse, Product, ProductVariant } from '@/types';
import type { Profile } from '@/contexts/AuthContext';
import {
  ClientWarehouseSettings,
  CENTRAL_WAREHOUSE_ID,
  CENTRAL_WAREHOUSE_NAME,
  getClientWarehouseSettings,
} from './warehouseRulesStore';

// Re-export all storage & configuration interfaces for 100% backwards compatibility
export * from './warehouseRulesStore';

export function isCentralWarehouse(w: { warehouse_id?: number; warehouse_name?: string; city?: string; is_hub?: boolean }): boolean {
  if (w.warehouse_id === CENTRAL_WAREHOUSE_ID) return true;
  if (w.is_hub) return true;
  const name = (w.warehouse_name || '').toLowerCase();
  const city = (w.city || '').toLowerCase();
  return name.includes('астана') || name.includes('основной') || city.includes('астана');
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

/**
 * Расчет доступного остатка для конкретного размера (варианта) товара с учетом прав пользователя
 */
export function getVariantStockForUser(
  variant: ProductVariant,
  clientProfile?: Partial<Profile> | null,
  isEffectiveAdmin = false
): number {
  if (isEffectiveAdmin) {
    if (variant.warehouses && variant.warehouses.length > 0) {
      return variant.warehouses.reduce((sum, w) => sum + (Number(w.stock) || Number(w.free_stock) || 0), 0);
    }
    return Math.max(0, Number(variant.free_stock ?? variant.stock ?? 0));
  }

  // Для клиента: фильтруем склады по доступности
  const clientWarehouses = filterWarehousesForClient(
    variant.warehouses,
    clientProfile,
    clientProfile?.showroom_warehouse_name
  );
  let total = clientWarehouses.reduce((sum, w) => sum + (Number(w.stock) || Number(w.free_stock) || 0), 0);

  // Если у клиента есть шоурум, но его склад не попал в clientWarehouses, учитываем showroom_qty / dealer_stock
  if (clientProfile?.showroom_warehouse_id) {
    const hasShowroomInList = clientWarehouses.some(w => w.warehouse_id === clientProfile.showroom_warehouse_id);
    if (!hasShowroomInList) {
      const showroomQty = Number(variant.dealer_stock?.in_showroom_qty ?? variant.showroom_qty ?? 0);
      if (showroomQty > 0) {
        total += showroomQty;
      }
    }
  }

  return Math.max(0, total);
}

/**
 * Расчет суммарного доступного остатка (в штуках) по всем размерам товара для конкретного пользователя
 */
export function getProductAvailableStockForUser(
  product: Product,
  clientProfile?: Partial<Profile> | null,
  isEffectiveAdmin = false
): number {
  if (!product.variants || product.variants.length === 0) return 0;
  return product.variants.reduce((sum, v) => sum + getVariantStockForUser(v, clientProfile, isEffectiveAdmin), 0);
}

/**
 * Проверка наличия товара для пользователя:
 * - Для администратора (isEffectiveAdmin === true) — всегда возвращает true (админ видит всё ассортиментное дерево).
 * - Для клиентов/гостей — возвращает true, ТОЛЬКО если хотя бы один размер есть в наличии (> 0 шт) на доступных складах.
 *   Если у товара нет остатков ни по одному размеру — возвращает false (карточка должна быть скрыта).
 */
export function isProductInStockForUser(
  product: Product,
  clientProfile?: Partial<Profile> | null,
  isEffectiveAdmin = false,
  hideZeroStockSetting = true
): boolean {
  if (isEffectiveAdmin) {
    return true;
  }

  // Если в настройках явно выключено скрытие нулевых остатков (например, предзаказ)
  if (hideZeroStockSetting === false) {
    return true;
  }

  if (!product.variants || product.variants.length === 0) {
    return false;
  }

  return product.variants.some(v => getVariantStockForUser(v, clientProfile, false) > 0);
}
