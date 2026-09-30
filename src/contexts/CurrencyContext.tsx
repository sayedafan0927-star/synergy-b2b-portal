import React, { createContext, useContext, useState, useEffect } from 'react';
import { CurrencyCode, DEFAULT_USD_KZT_RATE, formatCurrency, formatDualCurrency } from '@/lib/pricingEngine';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

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
  const { isAdmin, isImpersonating } = useAuth();
  const isEffectiveAdmin = Boolean(isAdmin && !isImpersonating);

  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    try {
      const saved = localStorage.getItem('synergy_preferred_currency');
      return (saved === 'KZT' || saved === 'USD') ? (saved as CurrencyCode) : 'USD';
    } catch {
      return 'USD';
    }
  });

  const [exchangeRate, setExchangeRate] = useState<number>(DEFAULT_USD_KZT_RATE);

  // Динамическая загрузка курса валют из display_settings и синхронизация по Realtime
  useEffect(() => {
    let isMounted = true;

    async function loadExchangeRate() {
      try {
        const { data } = await supabase
          .from('display_settings')
          .select('exchange_rate_usd_kzt')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data?.exchange_rate_usd_kzt && isMounted) {
          const val = Number(data.exchange_rate_usd_kzt);
          if (!isNaN(val) && val > 0) {
            setExchangeRate(val);
          }
        }
      } catch (err) {
        console.warn('[CurrencyContext] Failed to fetch exchange rate:', err);
      }
    }

    loadExchangeRate();

    const channel = supabase
      .channel('currency_rate_realtime')
      .on('broadcast', { event: 'currency_rate_updated' }, (msg: any) => {
        const newRate = Number(msg?.payload?.exchange_rate_usd_kzt);
        if (!isNaN(newRate) && newRate > 0 && isMounted) {
          setExchangeRate(newRate);
        }
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Если пользователь не админ, принудительно переключаем на USD и очищаем KZT из localStorage
  useEffect(() => {
    if (!isEffectiveAdmin && currency !== 'USD') {
      setCurrencyState('USD');
      try {
        localStorage.setItem('synergy_preferred_currency', 'USD');
      } catch {}
    }
  }, [isEffectiveAdmin, currency]);

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

