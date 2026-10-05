import { useState, useEffect, useContext, useCallback } from 'react';
import {
  fetchCatalogFromErp,
  fetchSingleProductFromErp,
  fetchPaginatedCatalogFromErp,
  type PaginatedCatalogParams,
} from '@/lib/erpApi';
import { AuthContext, type Profile } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Product, StockSummary } from '@/types';
import { calculateArea } from '@/lib/nomenclatureParser';
import { mergeProducts } from '@/lib/catalogMerge';
import { cacheProduct, cacheProducts, getCachedProduct } from '@/lib/productCache';

// Re-export utility functions and constants for full backward compatibility
export {
  STANDARD_SIZES,
  calculateArea,
  parse1CNomenclature,
  getValidImages,
} from '@/lib/nomenclatureParser';

export {
  mergeProducts,
  filterClientWarehouses,
  triggerCatalogReload,
} from '@/lib/catalogMerge';

export {
  cacheProduct,
  cacheProducts,
  getCachedProduct,
} from '@/lib/productCache';

export function useProducts(customDealerId?: string | number) {
  const authContext = useContext(AuthContext);
  const effectiveDealerId =
    customDealerId ??
    authContext?.impersonatedProfile?.partner_id ??
    authContext?.profile?.partner_id ??
    undefined;

  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    const handler = () => {
      setLoading(true);
      setReloadCounter(c => c + 1);
    };
    window.addEventListener('synergy:reload-catalog', handler);
    window.addEventListener('synergy:reload-warehouse-settings', handler);
    return () => {
      window.removeEventListener('synergy:reload-catalog', handler);
      window.removeEventListener('synergy:reload-warehouse-settings', handler);
    };
  }, []);

  // Слушатель событий реального времени по вебхуку (списание остатка дилера)
  useEffect(() => {
    const handleStockEvent = (e: CustomEvent<{ partner_id?: number | string; sku?: string; released_qty?: number }>) => {
      const data = e.detail;
      if (!data || !data.sku || !data.released_qty) return;
      if (data.partner_id && effectiveDealerId && String(data.partner_id) !== String(effectiveDealerId)) {
        return; // Событие для другого партнёра
      }

      setProducts(prev =>
        prev.map(prod => {
          let changed = false;
          const newVariants = prod.variants.map(v => {
            if ((v.sku === data.sku || v.id.includes(data.sku!)) && v.dealer_stock) {
              changed = true;
              const newQty = Math.max(0, v.dealer_stock.in_showroom_qty - Number(data.released_qty));
              const area = calculateArea(v.size);
              return {
                ...v,
                dealer_stock: {
                  ...v.dealer_stock,
                  in_showroom_qty: newQty,
                  in_showroom_sqm: Math.round(newQty * area * 10) / 10,
                },
              };
            }
            return v;
          });
          return changed ? { ...prod, variants: newVariants } : prod;
        }),
      );
    };

    window.addEventListener('synergy:stock-event', handleStockEvent as EventListener);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('synergy_stock_channel');
        bc.onmessage = event => {
          if (event.data?.event === 'partner_stock_released') {
            window.dispatchEvent(new CustomEvent('synergy:stock-event', { detail: event.data }));
          }
        };
      } catch {
        // fallback
      }
    }

    return () => {
      window.removeEventListener('synergy:stock-event', handleStockEvent as EventListener);
      if (bc) bc.close();
    };
  }, [effectiveDealerId]);

  // Сквозная подписка на Supabase Realtime канал portal_live_updates
  useEffect(() => {
    const channel = supabase
      .channel('portal_live_updates')
      .on('broadcast', { event: 'stock_changed' }, (payload: any) => {
        const rawItems = payload?.payload?.items || payload?.items;
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          const itemMap = new Map<string, any>();
          for (const it of rawItems) {
            if (it.sku) itemMap.set(String(it.sku).trim().toUpperCase(), it);
            if (it.article) itemMap.set(String(it.article).trim().toUpperCase(), it);
            if (it.code) itemMap.set(String(it.code).trim().toUpperCase(), it);
            if (it.barcode) itemMap.set(String(it.barcode).trim().toUpperCase(), it);
            if (it.item_id) itemMap.set(String(it.item_id).trim(), it);
          }

          setProducts(prev => {
            let totalFreeDelta = 0;
            let totalReservedDelta = 0;
            let totalDelta = 0;

            const updatedProducts = prev.map(prod => {
              let hasChange = false;
              const updatedVariants = prod.variants.map(v => {
                const skuKey = String(v.sku || '').trim().toUpperCase();
                const artKey = String(v.article || '').trim().toUpperCase();
                const codeKey = String(v.code || '').trim().toUpperCase();
                const barcodeKey = String(v.barcode || '').trim().toUpperCase();
                const idKey = String(v.item_id || v.id || '').trim();

                const update =
                  itemMap.get(skuKey) ||
                  itemMap.get(artKey) ||
                  itemMap.get(codeKey) ||
                  itemMap.get(barcodeKey) ||
                  itemMap.get(idKey);
                if (update) {
                  hasChange = true;
                  const newFree = Number(update.free_stock ?? update.stock ?? v.free_stock);
                  const newReserved = Number(update.reserved_stock ?? v.reserved_stock);
                  const newTotal = Number(update.total_stock ?? newFree + newReserved);

                  totalFreeDelta += newFree - (v.free_stock || 0);
                  totalReservedDelta += newReserved - (v.reserved_stock || 0);
                  totalDelta += newTotal - (v.total_stock || 0);

                  return {
                    ...v,
                    free_stock: newFree,
                    stock: newFree,
                    reserved_stock: newReserved,
                    total_stock: newTotal,
                    warehouses: (v.warehouses || []).map(w =>
                      w.warehouse_id === 81 || w.is_hub
                        ? {
                            ...w,
                            stock: newFree,
                            free_stock: newFree,
                            reserved_stock: newReserved,
                            total_stock: newTotal,
                          }
                        : w,
                    ),
                  };
                }
                return v;
              });
              return hasChange ? { ...prod, variants: updatedVariants } : prod;
            });

            // Обновляем общую сводку на плашке
            if (totalFreeDelta !== 0 || totalReservedDelta !== 0) {
              setSummary(prevSummary => {
                if (!prevSummary) return prevSummary;
                return {
                  ...prevSummary,
                  free_stock_qty: Math.max(0, (prevSummary.free_stock_qty || 0) + totalFreeDelta),
                  reserved_stock_qty: Math.max(0, (prevSummary.reserved_stock_qty || 0) + totalReservedDelta),
                  total_stock_qty: Math.max(0, (prevSummary.total_stock_qty || 0) + totalDelta),
                };
              });
            }

            return updatedProducts;
          });
        }
      })
      .on('broadcast', { event: 'partner_stock_released' }, (payload: any) => {
        const data = payload?.payload;
        if (!data || !data.sku) return;
        window.dispatchEvent(new CustomEvent('synergy:stock-event', { detail: data }));
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          // При недоступности WSS соединений портал автоматически работает через единый HTTP Gateway
          if (import.meta.env.DEV) {
            console.debug('[Realtime] portal_live_updates channel offline:', err?.message || status);
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const bypassCache = reloadCounter > 0;
        const erpData = await fetchCatalogFromErp(effectiveDealerId, undefined, bypassCache);
        if (!cancelled && erpData && erpData.success && Array.isArray(erpData.products) && erpData.products.length > 0) {
          const merged = mergeProducts(erpData.products as Product[]);
          cacheProducts(merged);
          setProducts(merged);
          if (erpData.summary) {
            setSummary(erpData.summary);
          }
          setLoading(false);
          return;
        }
        if (!cancelled) {
          if (erpData?.summary) setSummary(erpData.summary);
          setLoading(false);
        }
      } catch (erpErr) {
        console.warn('[useProducts] ERP catalog fetch error:', erpErr);
        if (!cancelled) setError(erpErr instanceof Error ? erpErr.message : 'Ошибка загрузки каталога ERP');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadCounter, effectiveDealerId]);

  return { products, summary, loading, error };
}

/**
 * Хук для высоконагруженной серверной пагинации, фильтрации и поиска по каталогу
 */
export function usePaginatedProducts(initialParams: PaginatedCatalogParams = {}) {
  const [params, setParams] = useState<PaginatedCatalogParams>(initialParams);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(initialParams.page || 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (currentParams: PaginatedCatalogParams) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPaginatedCatalogFromErp(currentParams);
      if (res && res.success) {
        setItems(res.items || []);
        setTotal(res.total || 0);
        setTotalPages(res.totalPages || 1);
        setPage(res.page || 1);
      } else {
        throw new Error(res?.error || 'Не удалось загрузить каталог');
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка соединения');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(params);
  }, [params, loadData]);

  const updateFilters = useCallback((newParams: Partial<PaginatedCatalogParams>) => {
    setParams(prev => ({ ...prev, ...newParams, page: newParams.page ?? 1 }));
  }, []);

  const goToPage = useCallback((newPage: number) => {
    setParams(prev => ({ ...prev, page: newPage }));
  }, []);

  return {
    items,
    total,
    totalPages,
    page,
    loading,
    error,
    updateFilters,
    goToPage,
    reload: () => loadData(params),
  };
}

export function useProduct(id: string | undefined, customDealerId?: string | number) {
  const authContext = useContext(AuthContext);
  const effectiveDealerId =
    customDealerId ??
    authContext?.impersonatedProfile?.partner_id ??
    authContext?.profile?.partner_id ??
    undefined;

  const [product, setProduct] = useState<Product | null>(() => (id ? getCachedProduct(id) : null));
  const [loading, setLoading] = useState<boolean>(() => !Boolean(id && getCachedProduct(id)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const preloaded = getCachedProduct(id);
    if (preloaded) {
      setProduct(preloaded);
      setLoading(false);
    }

    let cancelled = false;

    async function load() {
      try {
        // 1. Попытка точечной выборки товара из кэша каталога
        const single = await fetchSingleProductFromErp(id!, effectiveDealerId).catch(() => null);
        if (!cancelled && single) {
          const merged = mergeProducts([single as Product]);
          if (merged.length > 0) {
            cacheProduct(merged[0]);
            setProduct(merged[0]);
            setLoading(false);
            return;
          }
        }

        // 2. Fallback на полный каталог, если точечный поиск не вернул результат
        const erpData = await fetchCatalogFromErp(effectiveDealerId);
        if (!cancelled && erpData && erpData.success && Array.isArray(erpData.products)) {
          const merged = mergeProducts(erpData.products as Product[]);
          cacheProducts(merged);
          const cleanId = decodeURIComponent(String(id || '')).trim().toLowerCase();
          const found = merged.find(p => {
            if (String(p.id).toLowerCase() === cleanId) return true;
            if (String(p.article || '').toLowerCase() === cleanId) return true;
            return p.variants.some(
              v =>
                String(v.id).toLowerCase() === cleanId ||
                String(v.sku || '').toLowerCase() === cleanId ||
                String(v.barcode || '').toLowerCase() === cleanId ||
                String(v.article || '').toLowerCase() === cleanId ||
                String((v as any).code || '').toLowerCase() === cleanId,
            );
          });
          if (found) {
            cacheProduct(found);
            setProduct(found);
            setLoading(false);
            return;
          }
        }
        if (!cancelled) {
          setLoading(false);
        }
      } catch (erpErr) {
        console.warn('[useProduct] ERP single product fetch error:', erpErr);
        if (!cancelled) setError(erpErr instanceof Error ? erpErr.message : 'Ошибка загрузки товара ERP');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, effectiveDealerId]);

  return { product, loading, error };
}
