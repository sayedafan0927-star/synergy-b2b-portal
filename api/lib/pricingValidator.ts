import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

export interface OrderItemInput {
  sku?: string;
  item_id?: number | string;
  productId?: string;
  size?: string;
  quantity: number;
  price?: number;
  price_per_sqm?: number;
  width?: number;
  length?: number;
  area_sqm?: number;
  warehouse?: string;
  warehouse_id?: number;
  cell?: never;
  cell_code?: never;
  rack?: never;
  location?: never;
}

export interface ValidatedItem {
  sku: string;
  productId: string;
  item_id?: number;
  size: string;
  quantity: number;
  price: number;
  price_per_sqm: number;
  width: number;
  length: number;
  area_sqm: number;
  warehouse: string;
  warehouse_id?: number;
  total_line: number;
  server_verified: boolean;
}

export interface PricingValidationResult {
  valid: boolean;
  tamperDetected: boolean;
  totalAmount: number;
  totalItems: number;
  items: ValidatedItem[];
  error?: string;
}

/**
 * Расчет скидки по типу договора на основе динамических правил из БД (T-25)
 */
async function getDynamicDiscountPercent(priceType?: string | null): Promise<number> {
  if (!priceType) return 0;
  const str = priceType.toLowerCase().trim();

  try {
    const nowIso = new Date().toISOString();
    const { data: rule } = await supabaseAdmin
      .from('discount_rules')
      .select('discount_percent')
      .eq('price_type_id', str)
      .eq('is_active', true)
      .lte('valid_from', nowIso)
      .or(`valid_to.is.null,valid_to.gte.${nowIso}`)
      .order('discount_percent', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rule?.discount_percent !== undefined) {
      return Number(rule.discount_percent);
    }
  } catch (err) {
    console.warn('[PricingValidator] Discount rule query notice:', err);
  }

  // Fallback значения
  if (str === 'wholesale' || str === 'price_deferred' || str === 'price_opt' || str === 'оптовая') return 0;
  if (str.includes('vip') || str.includes('вип')) return 25;
  if (str.includes('opt3') || str.includes('опт-3') || str.includes('дилер')) return 20;
  if (str.includes('opt2') || str.includes('опт-2') || str.includes('крупн')) return 15;
  if (str.includes('opt1') || str.includes('опт-1')) return 10;
  return 0;
}

/**
 * Парсинг физических габаритов и площади коврового изделия (для WMS/ERP)
 */
export function parseDimensions(sizeStr: string): { width: number; length: number; area: number } {
  if (!sizeStr) return { width: 1.6, length: 2.3, area: 3.68 };
  const cleaned = sizeStr.replace(',', '.');
  const parts = cleaned.split(/[*×xX]/).map(s => parseFloat(s.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
    const width = Math.round(parts[0] * 100) / 100;
    const length = Math.round(parts[1] * 100) / 100;
    const area = Math.round(width * length * 100) / 100;
    return { width, length, area };
  }
  return { width: 1.6, length: 2.3, area: 3.68 };
}

/**
 * Серверная валидация цен и пересчет заказа (Anti-Tamper Pricing Guard)
 */
export async function validateAndPriceOrder(
  rawItems: OrderItemInput[],
  priceType = 'wholesale'
): Promise<PricingValidationResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return {
      valid: false,
      tamperDetected: false,
      totalAmount: 0,
      totalItems: 0,
      items: [],
      error: 'В заказе отсутствует список позиций (массив items пуст)',
    };
  }

  const skusToLookup = rawItems.map(i => String(i.sku || '').trim()).filter(Boolean);
  const discountPercent = await getDynamicDiscountPercent(priceType);
  const discountMultiplier = (100 - discountPercent) / 100;

  // Загружаем актуальные базовые цены из PostgreSQL (product_variants)
  let dbVariantsMap = new Map<string, { base_price: number; sku: string; size: string; product_id: string }>();
  if (skusToLookup.length > 0) {
    try {
      const { data: dbVariants } = await supabaseAdmin
        .from('product_variants')
        .select('sku, size, base_price, product_id')
        .in('sku', skusToLookup);

      if (dbVariants && dbVariants.length > 0) {
        for (const v of dbVariants) {
          dbVariantsMap.set(v.sku.toUpperCase(), {
            base_price: Number(v.base_price) || 0,
            sku: v.sku,
            size: v.size,
            product_id: v.product_id,
          });
        }
      }
    } catch (e) {
      console.warn('[PricingValidator] DB lookup warning:', e);
    }
  }

  let totalAmount = 0;
  let totalItems = 0;
  let tamperDetected = false;
  const validatedItems: ValidatedItem[] = [];

  for (const raw of rawItems) {
    const qty = Number(raw.quantity);
    if (isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
      return {
        valid: false,
        tamperDetected: false,
        totalAmount: 0,
        totalItems: 0,
        items: [],
        error: `Недопустимое количество позиции: "${raw.sku || 'Товар'}". Количество должно быть целым положительным числом.`,
      };
    }

    const skuUpper = String(raw.sku || '').trim().toUpperCase();
    const dbVariant = dbVariantsMap.get(skuUpper);
    const clientPrice = Number(raw.price);

    let authoritativePrice = clientPrice;
    let serverVerified = false;

    if (dbVariant && dbVariant.base_price > 0) {
      // Рассчитываем точную цену со скидкой по договору
      const calculatedPrice = Math.round(dbVariant.base_price * discountMultiplier * 100) / 100;
      
      // Если клиент прислал цену меньше расчетной более чем на $0.50 — это подмена цены!
      if (!isNaN(clientPrice) && clientPrice < (calculatedPrice - 0.50)) {
        console.warn(`[Anti-Tamper] Price tampering attempt detected for SKU ${raw.sku}. Client sent: $${clientPrice}, Authoritative: $${calculatedPrice}`);
        tamperDetected = true;
      }
      authoritativePrice = calculatedPrice;
      serverVerified = true;
    } else {
      // Если позиции еще нет в локальной таблице variants, проверяем жесткий нижний предел
      if (isNaN(clientPrice) || clientPrice < 1.0) {
        return {
          valid: false,
          tamperDetected: true,
          totalAmount: 0,
          totalItems: 0,
          items: [],
          error: `Обнаружена недопустимая или нулевая цена позиции: "${raw.sku || 'Товар'}".`,
        };
      }
      authoritativePrice = clientPrice;
    }

    const lineTotal = Math.round(authoritativePrice * qty * 100) / 100;
    totalAmount += lineTotal;
    totalItems += qty;

    const size = raw.size || dbVariant?.size || 'Стандарт';
    const dims = parseDimensions(size);
    const width = Number(raw.width) > 0 ? Number(raw.width) : dims.width;
    const length = Number(raw.length) > 0 ? Number(raw.length) : dims.length;
    const area = Number(raw.area_sqm) > 0 ? Number(raw.area_sqm) : (width * length > 0 ? Math.round(width * length * 100) / 100 : dims.area);
    const pricePerSqm = area > 0 ? Math.round((authoritativePrice / area) * 100) / 100 : (raw.price_per_sqm || 0);

    validatedItems.push({
      sku: raw.sku || dbVariant?.sku || 'UNKNOWN-SKU',
      productId: String(raw.productId || dbVariant?.product_id || raw.item_id || ''),
      item_id: Number(raw.item_id) > 0 ? Number(raw.item_id) : undefined,
      size,
      quantity: qty,
      price: authoritativePrice,
      price_per_sqm: pricePerSqm,
      width,
      length,
      area_sqm: area,
      warehouse: raw.warehouse || 'Основной Склад Астана',
      warehouse_id: raw.warehouse_id !== undefined ? Number(raw.warehouse_id) : (raw.warehouse && (raw.warehouse.includes('Астана') || raw.warehouse.includes('Основной')) ? 81 : 81),
      total_line: lineTotal,
      server_verified: serverVerified,
    });
  }

  totalAmount = Math.round(totalAmount * 100) / 100;

  return {
    valid: true,
    tamperDetected,
    totalAmount,
    totalItems,
    items: validatedItems,
  };
}
