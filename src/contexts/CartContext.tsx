import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CartItem } from '@/types';
import { calcSqm } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface CartContextValue {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>, qty?: number) => void;
  removeItem: (productId: string, size: string, warehouse: string) => void;
  updateQuantity: (productId: string, size: string, warehouse: string, qty: number) => void;
  syncItemPrices: (updater: (item: CartItem) => { price: number; price_per_sqm?: number; maxStock?: number } | null) => number;
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

function itemKey(i: Pick<CartItem, 'productId' | 'size' | 'warehouse'>) {
  return `${i.productId}::${i.size}::${i.warehouse}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, profile, isImpersonating, impersonatedProfile } = useAuth();

  // Изоляция корзины по конкретному дилеру (включая режим имперсонации)
  const effectiveUserId = isImpersonating && impersonatedProfile
    ? String(impersonatedProfile.id || impersonatedProfile.partner_id)
    : String(profile?.partner_id || profile?.id || user?.id || 'guest');

  const storageKey = `synergy-cart:${effectiveUserId}`;

  const [items, setItems] = useState<CartItem[]>(() => loadCart(storageKey));

  // Подгрузка корзины при смене пользователя или переключении имперсонации
  useEffect(() => {
    setItems(loadCart(storageKey));
  }, [storageKey]);

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
            const match = rawItems.find(
              (it: any) =>
                (it.sku && String(it.sku).toUpperCase() === String(cartItem.sku).toUpperCase()) ||
                (it.article && String(it.article).toUpperCase() === String(cartItem.sku).toUpperCase())
            );
            if (match) {
              const newFree = Math.max(0, Number(match.free_stock ?? match.stock ?? 0));
              if (cartItem.maxStock !== newFree) {
                updated = true;
                window.dispatchEvent(
                  new CustomEvent('synergy:cart-item-stock-depleted', {
                    detail: {
                      item: cartItem,
                      previousStock: cartItem.maxStock,
                      newStock: newFree,
                    },
                  })
                );
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

  const syncItemPrices = useCallback((updater: (item: CartItem) => { price: number; price_per_sqm?: number; maxStock?: number } | null) => {
    let updatedCount = 0;
    setItems(prev => {
      const next = prev.map(item => {
        const patch = updater(item);
        if (!patch) return item;
        const priceChanged = Math.abs(item.price - patch.price) >= 0.01;
        const sqmChanged = patch.price_per_sqm !== undefined && Math.abs((item.price_per_sqm ?? 0) - patch.price_per_sqm) >= 0.01;
        const stockChanged = patch.maxStock !== undefined && item.maxStock !== patch.maxStock;
        if (priceChanged || sqmChanged || stockChanged) {
          updatedCount++;
          return {
            ...item,
            price: patch.price,
            price_per_sqm: patch.price_per_sqm ?? item.price_per_sqm,
            maxStock: patch.maxStock ?? item.maxStock,
            quantity: patch.maxStock !== undefined ? Math.min(item.quantity, Math.max(1, patch.maxStock)) : item.quantity,
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
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, syncItemPrices, clearCart, totalItems, totalPrice, totalSqm }}>
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
