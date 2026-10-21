import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CartItem } from '@/types';
import { calcSqm } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export interface CartTargetClient {
  id: number | string;
  name: string;
  city?: string;
  phone?: string;
  portal_login?: string;
  price_type?: string;
}

interface CartContextValue {
  items: CartItem[];
  targetClient: CartTargetClient | null;
  setTargetClient: (client: CartTargetClient | null) => void;
  addItem: (item: Omit<CartItem, 'quantity'>, qty?: number) => void;
  removeItem: (productId: string, size: string, warehouse: string) => void;
  updateQuantity: (productId: string, size: string, warehouse: string, qty: number) => void;
  syncItemPrices: (
    updater: (item: CartItem) => {
      price: number;
      price_per_sqm?: number;
      maxStock?: number;
      item_id?: number;
      warehouse?: string;
      warehouse_id?: number;
      keepQuantityOnConflict?: boolean;
    } | null
  ) => number;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  totalSqm: number;
}

const CartContext = createContext<CartContextValue | null>(null);

function loadCart(storageKey: string): CartItem[] {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(storageKey: string, items: CartItem[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // safe storage fallback
  }
}

function loadTargetClient(key: string): CartTargetClient | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function itemKey(i: Pick<CartItem, 'productId' | 'size' | 'warehouse'>) {
  return `${i.productId}::${i.size}::${i.warehouse}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, profile, isImpersonating, impersonatedProfile } = useAuth();

  // Изоляция корзины по конкретному контрагенту partner_id (включая режим имперсонации)
  const effectiveUserId = isImpersonating && impersonatedProfile
    ? String(impersonatedProfile.partner_id || impersonatedProfile.id)
    : String(profile?.partner_id || profile?.id || user?.id || 'guest');

  const storageKey = `synergy-cart:${effectiveUserId}`;
  const targetClientKey = `synergy-cart-target-client:${effectiveUserId}`;

  const [items, setItems] = useState<CartItem[]>(() => loadCart(storageKey));
  const [targetClient, setTargetClientState] = useState<CartTargetClient | null>(() => loadTargetClient(targetClientKey));

  const setTargetClient = useCallback((client: CartTargetClient | null) => {
    setTargetClientState(client);
    try {
      if (client) localStorage.setItem(targetClientKey, JSON.stringify(client));
      else localStorage.removeItem(targetClientKey);
    } catch {}
  }, [targetClientKey]);

  // Подгрузка корзины при смене пользователя или переключении имперсонации
  useEffect(() => {
    setItems(loadCart(storageKey));
    setTargetClientState(loadTargetClient(targetClientKey));
  }, [storageKey, targetClientKey]);

  // Межвкладочная синхронизация корзины в реальном времени (Multi-Tab Sync)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        try {
          const remoteItems = JSON.parse(e.newValue);
          if (Array.isArray(remoteItems)) {
            setItems(remoteItems);
          }
        } catch {
          // safe fallback
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [storageKey]);

  // Мониторинг выкупа позиций из корзины другими дилерами через Realtime CDC
  useEffect(() => {
    const channel = supabase
      .channel('portal_cart_stock_watcher')
      .on('broadcast', { event: 'stock_changed' }, (payload: any) => {
        const rawItems = payload?.payload?.items || payload?.items;
        if (!Array.isArray(rawItems) || rawItems.length === 0) return;

        setItems(prevItems => {
          let updated = false;
          const next = prevItems.map(cartItem => {
            if (cartItem.is_preorder || String(cartItem.warehouse || '').includes('Предзаказ')) {
              return cartItem;
            }
            const match = rawItems.find(
              (it: any) => {
                const skuMatches =
                  (it.sku && String(it.sku).toUpperCase() === String(cartItem.sku).toUpperCase()) ||
                  (it.article && String(it.article).toUpperCase() === String(cartItem.sku).toUpperCase());
                if (!skuMatches) return false;
                if (it.warehouse_id && (cartItem as any).warehouse_id && Number(it.warehouse_id) !== Number((cartItem as any).warehouse_id)) {
                  return false;
                }
                if (it.warehouse && cartItem.warehouse && String(it.warehouse).toLowerCase() !== String(cartItem.warehouse).toLowerCase()) {
                  return false;
                }
                return true;
              }
            );
            if (match) {
              const newFree = Math.max(0, Number(match.free_stock ?? match.stock ?? 0));
              if (cartItem.maxStock !== newFree) {
                updated = true;
                if (newFree < cartItem.quantity) {
                  window.dispatchEvent(
                    new CustomEvent('synergy:cart-item-stock-depleted', {
                      detail: {
                        item: cartItem,
                        previousStock: cartItem.maxStock,
                        newStock: newFree,
                      },
                    })
                  );
                }
                return {
                  ...cartItem,
                  maxStock: newFree,
                };
              }
            }
            return cartItem;
          });
          return updated ? next : prevItems;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    saveCart(storageKey, items);
  }, [storageKey, items]);

  const addItem = useCallback((item: Omit<CartItem, 'quantity'>, qty = 1) => {
    setItems(prev => {
      const key = itemKey(item);
      const existing = prev.find(i => itemKey(i) === key);
      if (existing) {
        const nextQty = existing.quantity + qty;
        const cappedQty = item.maxStock !== undefined ? Math.min(nextQty, item.maxStock) : nextQty;
        return prev.map(i => itemKey(i) === key ? { ...i, ...item, quantity: cappedQty } : i);
      }
      const initialQty = item.maxStock !== undefined ? Math.min(qty, item.maxStock) : qty;
      return [...prev, { ...item, quantity: initialQty }];
    });
  }, []);

  const removeItem = useCallback((productId: string, size: string, warehouse: string) => {
    setItems(prev => prev.filter(i => itemKey(i) !== itemKey({ productId, size, warehouse })));
  }, []);

  const updateQuantity = useCallback((productId: string, size: string, warehouse: string, qty: number) => {
    if (qty < 1) return;
    setItems(prev => prev.map(i => {
      if (itemKey(i) === itemKey({ productId, size, warehouse })) {
        const capped = i.maxStock !== undefined ? Math.min(qty, i.maxStock) : qty;
        return { ...i, quantity: capped };
      }
      return i;
    }));
  }, []);

  const syncItemPrices = useCallback((
    updater: (item: CartItem) => {
      price: number;
      price_per_sqm?: number;
      maxStock?: number;
      item_id?: number;
      warehouse?: string;
      warehouse_id?: number;
      keepQuantityOnConflict?: boolean;
    } | null
  ) => {
    let updatedCount = 0;
    setItems(prev => {
      const next = prev.map(item => {
        const patch = updater(item);
        if (!patch) return item;
        const priceChanged = Math.abs(item.price - patch.price) >= 0.01;
        const sqmChanged = patch.price_per_sqm !== undefined && Math.abs((item.price_per_sqm ?? 0) - patch.price_per_sqm) >= 0.01;
        const stockChanged = patch.maxStock !== undefined && item.maxStock !== patch.maxStock;
        const itemIdChanged = patch.item_id !== undefined && item.item_id !== patch.item_id;
        const whChanged = patch.warehouse !== undefined && item.warehouse !== patch.warehouse;
        const whIdChanged = patch.warehouse_id !== undefined && item.warehouse_id !== patch.warehouse_id;
        if (priceChanged || sqmChanged || stockChanged || itemIdChanged || whChanged || whIdChanged) {
          updatedCount++;
          const clampedQty = patch.keepQuantityOnConflict
            ? Math.max(1, item.quantity)
            : patch.maxStock !== undefined
            ? (patch.maxStock > 0 ? Math.min(item.quantity, patch.maxStock) : Math.max(1, item.quantity))
            : item.quantity;
          return {
            ...item,
            price: patch.price,
            price_per_sqm: patch.price_per_sqm ?? item.price_per_sqm,
            maxStock: patch.maxStock ?? item.maxStock,
            item_id: patch.item_id ?? item.item_id,
            warehouse: patch.warehouse ?? item.warehouse,
            warehouse_id: patch.warehouse_id ?? item.warehouse_id,
            quantity: clampedQty,
          };
        }
        return item;
      });
      return updatedCount > 0 ? next : prev;
    });
    return updatedCount;
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const totalSqm = items.reduce((sum, i) => sum + calcSqm(i.size, i.quantity), 0);

  return (
    <CartContext.Provider value={{ items, targetClient, setTargetClient, addItem, removeItem, updateQuantity, syncItemPrices, clearCart, totalItems, totalPrice, totalSqm }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

export default CartContext;
