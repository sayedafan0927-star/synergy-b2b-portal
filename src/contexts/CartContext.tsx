import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CartItem } from '@/types';
import { calcSqm } from '@/types';

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

const STORAGE_KEY = 'synergy-cart';

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function itemKey(i: Pick<CartItem, 'productId' | 'size' | 'warehouse'>) {
  return `${i.productId}::${i.size}::${i.warehouse}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart);

  useEffect(() => {
    saveCart(items);
  }, [items]);

  const addItem = useCallback((item: Omit<CartItem, 'quantity'>, qty = 1) => {
    setItems(prev => {
      const key = itemKey(item);
      const existing = prev.find(i => itemKey(i) === key);
      if (existing) {
        return prev.map(i => itemKey(i) === key ? { ...i, quantity: i.quantity + qty } : i);
      }
      return [...prev, { ...item, quantity: qty }];
    });
  }, []);

  const removeItem = useCallback((productId: string, size: string, warehouse: string) => {
    setItems(prev => prev.filter(i => itemKey(i) !== itemKey({ productId, size, warehouse })));
  }, []);

  const updateQuantity = useCallback((productId: string, size: string, warehouse: string, qty: number) => {
    if (qty < 1) return;
    setItems(prev => prev.map(i =>
      itemKey(i) === itemKey({ productId, size, warehouse }) ? { ...i, quantity: qty } : i
    ));
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
