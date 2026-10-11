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
  canViewRawDollar: boolean;
  currencyUnitLabel: string;
}

const CurrencyContext = createContext<CurrencyContextType>({
  currency: 'USD',
  setCurrency: () => {},
  exchangeRate: DEFAULT_USD_KZT_RATE,
  formatPrice: (amount) => formatCurrency(amount, 'USD', DEFAULT_USD_KZT_RATE, false),
  formatDual: (amount) => formatDualCurrency(amount, DEFAULT_USD_KZT_RATE, false),
  canViewRawDollar: false,
  currencyUnitLabel: 'у.е.',
});

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAdmin, isSupplier, isImpersonating } = useAuth();
  // Реальный знак доллара ($) виден строго администраторам и прямым поставщикам (фабрикам ВЭД)
  // Для дилеров, клиентов и гостей в РК отображается «у.е.» во избежание юридических рисков
  const canViewRawDollar = Boolean((isAdmin || isSupplier) && !isImpersonating);

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

  const setCurrency = (c: CurrencyCode) => {
    setCurrencyState(c);
    try {
      localStorage.setItem('synergy_preferred_currency', c);
    } catch {}
  };

  const activeCurrency: CurrencyCode = currency;

  const formatPrice = (amountUsd: number) => {
    return formatCurrency(amountUsd, activeCurrency, exchangeRate, canViewRawDollar);
  };

  const formatDual = (amountUsd: number) => {
    return formatDualCurrency(amountUsd, exchangeRate, canViewRawDollar);
  };

  const currencyUnitLabel = activeCurrency === 'KZT' ? '₸' : (canViewRawDollar ? '$' : 'у.е.');

  return (
    <CurrencyContext.Provider value={{
      currency: activeCurrency,
      setCurrency,
      exchangeRate,
      formatPrice,
      formatDual,
      canViewRawDollar,
      currencyUnitLabel,
    }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);

