import React, { createContext, useContext, useState } from 'react';
import { CurrencyCode, DEFAULT_USD_KZT_RATE, formatCurrency, formatDualCurrency } from '@/lib/pricingEngine';

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
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    try {
      const saved = localStorage.getItem('synergy_preferred_currency');
      return (saved === 'KZT' || saved === 'USD') ? (saved as CurrencyCode) : 'USD';
    } catch {
      return 'USD';
    }
  });

  const exchangeRate = DEFAULT_USD_KZT_RATE;

  const setCurrency = (c: CurrencyCode) => {
    setCurrencyState(c);
    try {
      localStorage.setItem('synergy_preferred_currency', c);
    } catch {}
  };

  const formatPrice = (amountUsd: number) => {
    return formatCurrency(amountUsd, currency, exchangeRate);
  };

  const formatDual = (amountUsd: number) => {
    return formatDualCurrency(amountUsd, exchangeRate);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, exchangeRate, formatPrice, formatDual }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);
