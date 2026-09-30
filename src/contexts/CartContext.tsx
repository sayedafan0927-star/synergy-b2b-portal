import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CartItem } from '@/types';
import { calcSqm } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

interface CartContextValue {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>, qty?: number) => void;
  removeItem: (productId: string, size: string, warehouse: string) => void;
  updateQuantity: (productId: string, size: string, warehouse: string, qty: number) => void;
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

  const clearCart = useCallback(() => setItems([]), []);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const totalSqm = items.reduce((sum, i) => sum + calcSqm(i.size, i.quantity), 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, totalItems, totalPrice, totalSqm }}>
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
