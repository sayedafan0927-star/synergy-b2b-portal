/**
 * B2B Enterprise Pricing Engine
 * Расчет многоуровневых оптовых цен на основе договоров с 1С:ERP
 */

export interface ContractPricingTier {
  code: string;
  label: string;
  discountPercent: number;
  badgeColor: string;
}

export interface CalculatedPrice {
  basePrice: number;
  finalPrice: number;
  discountPercent: number;
  savings: number;
  tier: ContractPricingTier;
  hasDiscount: boolean;
}

/**
 * Нормализация типа цен из 1С/БД в стандартизированную шкалу скидок
 */
export function getPricingTier(rawPriceType?: string | null): ContractPricingTier {
  if (!rawPriceType) {
    return {
      code: 'standard',
      label: 'Базовая цена',
      discountPercent: 0,
      badgeColor: 'bg-slate-100 text-slate-700',
    };
  }

  const str = rawPriceType.toLowerCase().trim();

  // Цены из 1С:ERP (price_deferred, price_opt, wholesale) уже рассчитаны 1С по договору и являются финальными
  if (
    str === 'wholesale' ||
    str === 'price_deferred' ||
    str === 'price_opt' ||
    str === 'оптовая' ||
    str === 'standard' ||
    str === 'retail' ||
    str === 'базовая цена'
  ) {
    return {
      code: 'standard',
      label: 'Оптовая цена 1С',
      discountPercent: 0,
      badgeColor: 'bg-slate-100 text-slate-700',
    };
  }

  // VIP Уровень (-25%)
  if (str.includes('vip') || str.includes('вип') || str.includes('эксклюзив')) {
    return {
      code: 'vip',
      label: 'Договор VIP (-25%)',
      discountPercent: 25,
      badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
    };
  }

  // Опт-3 / Дилерский (-20%)
  if (str.includes('opt3') || str.includes('опт-3') || str.includes('дилер')) {
    return {
      code: 'opt3',
      label: 'Договор Дилер (-20%)',
      discountPercent: 20,
      badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    };
  }

  // Опт-2 / Крупный опт (-15%)
  if (str.includes('opt2') || str.includes('опт-2') || str.includes('крупн')) {
    return {
      code: 'opt2',
      label: 'Договор Опт-2 (-15%)',
      discountPercent: 15,
      badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
    };
  }

  // Опт-1 / Стандартный опт (-10%)
  if (str.includes('opt1') || str.includes('опт-1')) {
    return {
      code: 'opt1',
      label: 'Договор Опт-1 (-10%)',
      discountPercent: 10,
      badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    };
  }

  return {
    code: 'standard',
    label: 'Базовая цена',
    discountPercent: 0,
    badgeColor: 'bg-slate-100 text-slate-700',
  };
}

/**
 * Расчет индивидуальной стоимости для B2B-контрагента
 */
export function calculateContractPrice(basePrice: number, rawPriceType?: string | null): CalculatedPrice {
  const safeBase = Number(basePrice) > 0 ? Number(basePrice) : 0;
  const tier = getPricingTier(rawPriceType);

  if (tier.discountPercent <= 0) {
    return {
      basePrice: safeBase,
      finalPrice: safeBase,
      discountPercent: 0,
      savings: 0,
      tier,
      hasDiscount: false,
    };
  }

  const multiplier = (100 - tier.discountPercent) / 100;
  // Округление до 2 знаков после запятой
  const finalPrice = Math.round(safeBase * multiplier * 100) / 100;
  const savings = Math.round((safeBase - finalPrice) * 100) / 100;

  return {
    basePrice: safeBase,
    finalPrice,
    discountPercent: tier.discountPercent,
    savings,
    tier,
    hasDiscount: true,
  };
}

export type CurrencyCode = 'USD' | 'KZT';

export const DEFAULT_USD_KZT_RATE = 520; // Индикативный курс USD/KZT для рынка РК

/**
 * Форматирование цены:
 * - В KZT: сумма в тенге со знаком ₸
 * - В USD:
 *   - для поставщиков (ВЭД) и администраторов: $ 45.00
 *   - для дилеров, клиентов и публичного просмотра в РК: 45.00 у.е. (во избежание нарушения ст. 193 КоАП РК)
 */
export function formatCurrency(
  amount: number,
  currency: CurrencyCode = 'USD',
  exchangeRate: number = DEFAULT_USD_KZT_RATE,
  allowRawDollar: boolean = false
): string {
  const safeAmount = Number(amount) || 0;
  if (currency === 'KZT') {
    const kzt = Math.round(safeAmount * exchangeRate);
    return `${kzt.toLocaleString('ru-RU')} ₸`;
  }
  if (allowRawDollar) {
    return `$${safeAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${safeAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} у.е.`;
}

export function formatDualCurrency(
  amountUsd: number,
  _exchangeRate: number = DEFAULT_USD_KZT_RATE,
  allowRawDollar: boolean = false
): string {
  const safeAmount = Number(amountUsd) || 0;
  if (allowRawDollar) {
    return `$${safeAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${safeAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} у.е.`;
}

/**
 * Перевод системных идентификаторов типов цен (1С:ERP / БД) на понятный русский язык
 */
export function formatPriceType(rawPriceType?: string | null): string {
  if (!rawPriceType) return '—';
  const str = rawPriceType.toLowerCase().trim();

  const directMap: Record<string, string> = {
    price_deferred: 'С отсрочкой',
    deferred: 'С отсрочкой',
    deferred_14: 'Отсрочка 14 дн.',
    deferred_30: 'Отсрочка 30 дн.',
    deferred_60: 'Отсрочка 60 дн.',
    prepayment: 'Предоплата',
    consignment: 'Под реализацию',
    price_wholesale: 'Оптовая',
    wholesale: 'Оптовая',
    price_cash: 'По факту',
    cash: 'По факту',
    price_opt: 'Оптовая',
    optom_1: 'Опт 1',
    optom_2: 'Опт 2',
    optom_3: 'Опт 3',
    opt1: 'Опт 1',
    opt2: 'Опт 2',
    opt3: 'Опт 3',
    retail: 'Розничная',
    commission: 'Комиссионная',
    dealer: 'Дилерская',
    standard: 'Базовая',
    vip: 'VIP',
    price_vip: 'VIP',
  };

  if (directMap[str]) {
    return directMap[str];
  }

  // Эвристический поиск по ключевым подстрокам
  if (str.includes('deferred') || str.includes('отсроч')) return 'С отсрочкой';
  if (str.includes('wholesale') || str.includes('опт')) return 'Оптовая';
  if (str.includes('cash') || str.includes('факт') || str.includes('налич')) return 'По факту';
  if (str.includes('retail') || str.includes('розниц')) return 'Розничная';
  if (str.includes('dealer') || str.includes('дилер')) return 'Дилерская';
  if (str.includes('commission') || str.includes('комисс')) return 'Комиссионная';
  if (str.includes('vip') || str.includes('вип')) return 'VIP';

  return rawPriceType;
}

