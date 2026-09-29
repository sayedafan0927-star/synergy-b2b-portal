import React, { createContext, useContext, useState, useEffect } from 'react';
import { CurrencyCode, DEFAULT_USD_KZT_RATE, formatCurrency, formatDualCurrency } from '@/lib/pricingEngine';
import { useAuth } from '@/contexts/AuthContext';

interface CurrencyContextType {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  exchangeRate: number;
  formatPrice: (amountUsd: number) => string;
  formatDual: (amountUsd: number) => string;
}

const CurrencyContext = createContext<CurrencyContextType>({
  currency: 'USD',
  setCurrency: () => {},
  exchangeRate: DEFAULT_USD_KZT_RATE,
  formatPrice: (amount) => formatCurrency(amount, 'USD'),
  formatDual: (amount) => formatDualCurrency(amount),
});

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAdmin, realIsAdmin } = useAuth();
  const isEffectiveAdmin = Boolean(isAdmin || realIsAdmin);

  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    try {
      const saved = localStorage.getItem('synergy_preferred_currency');
      return (saved === 'KZT' || saved === 'USD') ? (saved as CurrencyCode) : 'USD';
    } catch {
      return 'USD';
    }
  });

  // Если пользователь не админ, принудительно переключаем на USD и очищаем KZT из localStorage
  useEffect(() => {
    if (!isEffectiveAdmin && currency !== 'USD') {
      setCurrencyState('USD');
      try {
        localStorage.setItem('synergy_preferred_currency', 'USD');
      } catch {}
    }
  }, [isEffectiveAdmin, currency]);

  const exchangeRate = DEFAULT_USD_KZT_RATE;

  const setCurrency = (c: CurrencyCode) => {
    // Пользователям без прав админа запрещено переключаться на KZT
    if (!isEffectiveAdmin && c === 'KZT') {
      return;
    }
    setCurrencyState(c);
    try {
      localStorage.setItem('synergy_preferred_currency', c);
    } catch {}
  };

  const activeCurrency: CurrencyCode = isEffectiveAdmin ? currency : 'USD';

  const formatPrice = (amountUsd: number) => {
    return formatCurrency(amountUsd, activeCurrency, exchangeRate);
  };

  const formatDual = (amountUsd: number) => {
    return formatDualCurrency(amountUsd, exchangeRate);
  };

  return (
    <CurrencyContext.Provider value={{ currency: activeCurrency, setCurrency, exchangeRate, formatPrice, formatDual }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);

