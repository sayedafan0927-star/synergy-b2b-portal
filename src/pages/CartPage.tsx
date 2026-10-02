import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ShoppingCart, ArrowLeft, PackageOpen, AlertCircle, Trash2, FileSpreadsheet } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PageId } from '@/types';
import { submitOrderToErp, fetchClientDebtFromErp, type SplitSubOrder } from '@/lib/erpApi';
import { enqueueOfflineOrder } from '@/lib/offlineOrderQueue';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useProducts } from '@/hooks/useProductData';
import { useUserPricing } from '@/hooks/usePricing';
import { useToast } from '@/contexts/ToastContext';
import {
  CartSuccessModal,
  CartItemsTable,
  CartCheckoutForm,
  ExcelBulkOrderModal,
  CITIES,
  DEFAULT_CHECKOUT_PHONE,
  CHECKOUT_PHONE_STORAGE_KEY,
  isValidPhone,
  formatPhone,
} from '@/components/cart';

export default function CartPage({ onNavigate }: { onNavigate: (page: PageId, productId?: string) => void }) {
  const { currency } = useCurrency();
  const { items, removeItem, updateQuantity, syncItemPrices, clearCart, totalItems, totalPrice, totalSqm } = useCart();
  const { user, profile, isImpersonating, impersonatedProfile, isAccountant } = useAuth();
  const { products } = useProducts();
  const { getVariantPrice, getPricePerSqm } = useUserPricing();
  const { info: toastInfo } = useToast();
  const syncedRef = useRef(false);

  const [orderDocNumber, setOrderDocNumber] = useState<string | null>(null);
  const [splitOrders, setSplitOrders] = useState<SplitSubOrder[] | null>(null);
  const [isOfflineQueued, setIsOfflineQueued] = useState(false);
  const [isServerBuffered, setIsServerBuffered] = useState(false);
  const [isWaitingApproval, setIsWaitingApproval] = useState(false);
  const [isPartiallyConfirmed, setIsPartiallyConfirmed] = useState(false);
  const [debtReport, setDebtReport] = useState<any | null>(null);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [sizeAsc, setSizeAsc] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stockConflictDetails, setStockConflictDetails] = useState<{ available_qty?: number; requested_qty?: number; sku?: string } | null>(null);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);

  const [clientName, setClientName] = useState(profile?.full_name ?? '');
  const [clientPhone, setClientPhone] = useState(profile?.phone ?? '');
  const [clientCompany, setClientCompany] = useState(profile?.company_name ?? '');
  const [selectedCity, setSelectedCity] = useState(CITIES[0]);
  const [orderComment, setOrderComment] = useState('');

  // Загрузка финансового состояния клиента (кредитный лимит, просрочки)
  useEffect(() => {
    const effectiveProfile = isImpersonating && impersonatedProfile ? impersonatedProfile : profile;
    if (!effectiveProfile?.partner_id && !effectiveProfile?.phone) return;
    fetchClientDebtFromErp({
      phone: effectiveProfile.phone,
      counterpartyId: Number(effectiveProfile.partner_id) || undefined,
      search: effectiveProfile.full_name || effectiveProfile.company_name,
    })
      .then(res => {
        if (res?.success && res.found) {
          setDebtReport(res);
        }
      })
      .catch(err => console.warn('Debt check notice:', err));
  }, [profile, isImpersonating, impersonatedProfile]);

  // Автоматическая тихая синхронизация цен и курса валют при входе в корзину
  useEffect(() => {
    if (!products || products.length === 0 || items.length === 0 || syncedRef.current) return;
    syncedRef.current = true;

    const count = syncItemPrices(item => {
      const prod = products.find(p => p.id === item.productId || p.variants.some(v => v.sku === item.sku));
      if (!prod) return null;
      const variant = prod.variants.find(v => v.sku === item.sku || v.size === item.size);
      if (!variant) return null;

      const latestPrice = getVariantPrice(prod.collection, variant.size, variant.base_price, variant.price_per_sqm);
      const latestSqmPrice = getPricePerSqm(prod.collection, variant.size, variant.base_price, variant.price_per_sqm);
      const wh = variant.warehouses.find(w => (w.warehouse_name || w.city) === item.warehouse || w.warehouse_id === item.warehouse_id);
      const latestStock = wh ? (typeof wh.free_stock === 'number' ? wh.free_stock : wh.stock ?? 0) : undefined;

      return {
        price: latestPrice,
        price_per_sqm: latestSqmPrice,
        maxStock: latestStock !== undefined ? Math.max(0, latestStock) : undefined,
      };
    });

    if (count > 0) {
      toastInfo(`Цены и доступные остатки для ${count} поз. в корзине актуализированы по прайсу 1С`, 'Синхронизация цен');
    }
  }, [products, items, syncItemPrices, getVariantPrice, getPricePerSqm, toastInfo]);

  // Сброс флага синхронизации при получении фоновых обновлений остатков
  useEffect(() => {
    const handler = () => {
      syncedRef.current = false;
    };
    window.addEventListener('synergy:reload-catalog', handler);
    return () => window.removeEventListener('synergy:reload-catalog', handler);
  }, []);

  const hasDepletedItems = useMemo(() => items.some(it => it.maxStock === 0), [items]);
  const hasOverStockItems = useMemo(
    () => items.some(it => typeof it.maxStock === 'number' && it.maxStock > 0 && it.quantity > it.maxStock),
    [items]
  );
  const hasZeroPriceItems = useMemo(() => items.some(it => !it.price || it.price <= 0), [items]);

  const handleRemoveUnavailableItems = useCallback(() => {
    const problematicItems = items.filter(it => (!it.price || it.price <= 0) || it.maxStock === 0);
    problematicItems.forEach(it => removeItem(it.productId, it.size, it.warehouse));
    if (problematicItems.length > 0) {
      toastInfo(`Удалено позиций: ${problematicItems.length}. Корзина обновлена.`);
    }
  }, [items, removeItem, toastInfo]);

  const handleAutoAdjustQuantities = useCallback(() => {
    let adjustedCount = 0;

    // 1. Точечный конфликт от сервера при нехватке остатка (INSUFFICIENT_STOCK)
    if (stockConflictDetails) {
      const targetSku = String(stockConflictDetails.sku || '').trim().toLowerCase();
      const avail = typeof stockConflictDetails.available_qty === 'number'
        ? Math.max(0, stockConflictDetails.available_qty)
        : 0;

      for (const it of items) {
        const itSku = String(it.sku || '').trim().toLowerCase();
        const itProdId = String(it.productId || '').trim().toLowerCase();
        const isTarget = (targetSku && (itSku === targetSku || itProdId === targetSku)) || items.length === 1;
        if (isTarget) {
          if (avail === 0) {
            removeItem(it.productId, it.size, it.warehouse);
            adjustedCount++;
          } else if (it.quantity > avail) {
            updateQuantity(it.productId, it.size, it.warehouse, avail);
            adjustedCount++;
          }
        }
      }
    }

    // 2. Сквозная автокоррекция позиций, где запрошено больше фактического maxStock
    for (const it of items) {
      if (typeof it.maxStock === 'number') {
        if (it.maxStock === 0) {
          removeItem(it.productId, it.size, it.warehouse);
          adjustedCount++;
        } else if (it.quantity > it.maxStock) {
          updateQuantity(it.productId, it.size, it.warehouse, it.maxStock);
          adjustedCount++;
        }
      }
    }

    setSubmitError(null);
    setStockConflictDetails(null);
    if (adjustedCount > 0) {
      toastInfo(`Скорректировано позиций: ${adjustedCount}. Количество выровнено по доступным остаткам складов.`, 'Остатки актуализированы');
    }
  }, [items, stockConflictDetails, removeItem, updateQuantity, toastInfo]);

  // Проверка финансовых блокировок и условий
  const isBlocked = debtReport?.client?.is_blocked_for_shipment === true;
  const overdueDebt = debtReport?.financials?.overdue_usd || 0;
  const currentDebt = debtReport?.financials?.total_debt_usd || debtReport?.client?.debt_usd || 0;
  const creditLimit = debtReport?.client?.credit_limit_usd || 0;
  const totalExposure = currentDebt + totalPrice;
  const exceedsLimit = creditLimit > 0 && totalExposure > creditLimit;
  const hasOverdue = overdueDebt > 0;
  const requiresApproval = isBlocked || exceedsLimit || hasOverdue;

  // Анализ распределения товаров по складам для мультискладских заказов
  const warehousesInCart = useMemo(() => {
    const map = new Map<string, { count: number; totalAmount: number }>();
    for (const item of items) {
      const whName = item.warehouse || 'Основной Склад Астана';
      const existing = map.get(whName) || { count: 0, totalAmount: 0 };
      existing.count += item.quantity;
      existing.totalAmount += item.price * item.quantity;
      map.set(whName, existing);
    }
    return map;
  }, [items]);

  const hasMultipleWarehouses = warehousesInCart.size > 1;

  if (orderDocNumber) {
    return (
      <CartSuccessModal
        orderDocNumber={orderDocNumber}
        splitOrders={splitOrders}
        isOfflineQueued={isOfflineQueued}
        isServerBuffered={isServerBuffered}
        isWaitingApproval={isWaitingApproval}
        isPartiallyConfirmed={isPartiallyConfirmed}
        onContinueShopping={() => {
          setOrderDocNumber(null);
          setSplitOrders(null);
          setIsOfflineQueued(false);
          setIsServerBuffered(false);
          setIsWaitingApproval(false);
          setIsPartiallyConfirmed(false);
          onNavigate('catalog');
        }}
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen pt-20 pb-24 lg:pb-8">
        <div className="container-w flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-slate-50">
            <PackageOpen className="h-8 w-8 text-slate-400" />
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Корзина пуста</h1>
          <p className="mt-2 text-slate-500">Добавьте товары из каталога или загрузите смету из файла</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => onNavigate('catalog')} className="btn-primary cursor-pointer">
              Перейти в каталог
            </button>
            <button
              type="button"
              onClick={() => setIsExcelModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>Загрузить из Excel / CSV</span>
            </button>
          </div>
        </div>

        <ExcelBulkOrderModal
          isOpen={isExcelModalOpen}
          onClose={() => setIsExcelModalOpen(false)}
        />
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!user) {
      setSubmitError('Для оформления оптового заказа необходимо войти в личный кабинет.');
      return;
    }

    if (isAccountant) {
      setSubmitError('Учетная запись бухгалтера имеет доступ только к просмотру и сверкам. Оформление заказов доступно закупщику или руководителю компании.');
      return;
    }

    if (hasZeroPriceItems) {
      setSubmitError('В корзине есть позиции с неустановленной ценой (0 ₸ / $0). Обратитесь к менеджеру или удалите их для оформления заказа.');
      return;
    }

    if (!clientName.trim() || !clientPhone.trim()) {
      setSubmitError('Укажите имя и телефон для оформления заказа');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const effectiveProfile = isImpersonating && impersonatedProfile ? impersonatedProfile : profile;
    const clientId = effectiveProfile?.partner_id
      ? Number(effectiveProfile.partner_id) || effectiveProfile.partner_id
      : undefined;

    const whSummaryTag = hasMultipleWarehouses
      ? ` [МУЛЬТИСКЛАД: ${Array.from(warehousesInCart.entries())
          .map(([w, d]) => `${w} (${d.count} шт, $${d.totalAmount.toFixed(0)})`)
          .join(', ')}]`
      : '';
    const fullComment = `${orderComment.trim()}${whSummaryTag}${
      requiresApproval
        ? ' [ТРЕБУЕТСЯ АППРУВ В WHATSAPP: ' +
          (isBlocked ? 'Стоп-лист' : exceedsLimit ? 'Превышение кредитного лимита' : 'Просроченная задолженность') +
          ']'
        : ''
    }`;

    const effectiveWarehouseId = items.find(it => (it as any).warehouse_id)?.warehouse_id || 81;

    const orderPayload = {
      user_id: effectiveProfile?.id,
      client_id: clientId,
      partner_id: clientId,
      warehouse_id: effectiveWarehouseId,
      currency: currency || 'USD',
      buyer: {
        name: clientCompany.trim() || clientName.trim(),
        phone: clientPhone.trim(),
      },
      client_name: clientName.trim(),
      client_phone: clientPhone.trim(),
      client_company: clientCompany.trim(),
      city: selectedCity,
      comment: fullComment,
      items: items.map(item => ({
        item_id: item.item_id,
        productId: item.productId,
        size: item.size,
        sku: item.sku,
        warehouse: item.warehouse || 'Основной Склад Астана',
        warehouse_id: (item as any).warehouse_id || effectiveWarehouseId,
        price: item.price,
        price_per_sqm: item.price_per_sqm,
        area_sqm: item.area_sqm,
        quantity: item.quantity,
      })),
    };

    if (hasDepletedItems) {
      setSubmitError('В корзине есть закончившиеся на складе позиции. Пожалуйста, удалите их для продолжения.');
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const queued = enqueueOfflineOrder(orderPayload);
      clearCart();
      setIsOfflineQueued(true);
      setOrderDocNumber(queued.id);
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    try {
      const data = await submitOrderToErp(orderPayload);

      if (data.success && (data.order?.doc_number || data.split_orders?.length)) {
        const docNum = data.order?.doc_number || data.split_orders?.[0]?.doc_number || 'ORD-NEW';
        const receivedSplits = data.split_orders || data.order?.split_orders || null;
        if (receivedSplits && receivedSplits.length > 1) {
          setSplitOrders(receivedSplits);
        } else {
          setSplitOrders(null);
        }
        const buffered = Boolean(
          data.order?.is_buffered ||
            (data as any)?.is_buffered ||
            (data as any)?.is_buffered_offline,
        );
        setIsServerBuffered(buffered);
        setIsOfflineQueued(false);

        const isApprovalRequired =
          requiresApproval ||
          Boolean((data.order as any)?.requires_approval) ||
          Boolean((data as any)?.requires_approval);
        setIsWaitingApproval(isApprovalRequired);

        const isPartial = Boolean(
          data.is_partially_confirmed ||
          data.status === 'partially_confirmed' ||
          (receivedSplits && receivedSplits.some((s: any) => s.status === 'failed' || s.status === 'cancelled' || s.success === false))
        );
        setIsPartiallyConfirmed(isPartial);

        clearCart();
        setOrderDocNumber(docNum);
        setStockConflictDetails(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        throw new Error(data.error || 'Не удалось создать заказ');
      }
    } catch (err: any) {
      const isNetworkIssue =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        err?.name === 'TypeError' ||
        String(err?.message || '').toLowerCase().includes('failed to fetch') ||
        String(err?.message || '').toLowerCase().includes('network');

      if (isNetworkIssue) {
        const queued = enqueueOfflineOrder(orderPayload);
        clearCart();
        setIsOfflineQueued(true);
        setOrderDocNumber(queued.id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      setSubmitError(err.message || 'Ошибка оформления заказа');
      if (err.code === 'INSUFFICIENT_STOCK' || err.details?.code === 'INSUFFICIENT_STOCK') {
        const details = err.details || {};
        setStockConflictDetails(details);
        const targetSku = String(details.sku || '').trim().toLowerCase();
        const avail = typeof details.available_qty === 'number' ? Math.max(0, details.available_qty) : 0;
        syncItemPrices(item => {
          const itSku = String(item.sku || '').trim().toLowerCase();
          const itProdId = String(item.productId || '').trim().toLowerCase();
          if ((targetSku && (itSku === targetSku || itProdId === targetSku)) || items.length === 1) {
            return { price: item.price, price_per_sqm: item.price_per_sqm, maxStock: avail };
          }
          return null;
        });
      } else {
        setStockConflictDetails(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8">
      <div className="container-w">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 mb-2 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Вернуться в каталог
            </button>
            <h1 className="font-display text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-brand-700" />
              Корзина заказов
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setIsExcelModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-semibold shadow-2xs transition-all cursor-pointer self-start sm:self-auto"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Загрузить из Excel / CSV</span>
          </button>
        </div>

        {hasDepletedItems && (
          <div className="mb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
              <div>
                <span className="font-bold text-rose-900">Внимание: некоторые товары закончились на складе. </span>
                <span className="text-rose-700 text-[11px]">Удалите их, чтобы продолжить оформление.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoveUnavailableItems}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors cursor-pointer shadow-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Удалить недоступные</span>
            </button>
          </div>
        )}

        {hasZeroPriceItems && (
          <div className="mb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold text-amber-900">В корзине есть позиции с неустановленной ценой. </span>
                <span className="text-amber-800 text-[11px]">Оформление невозможно для товаров с нулевой стоимостью.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoveUnavailableItems}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer shadow-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Удалить позиции без цены</span>
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Левая колонка: товары и размеры */}
          <div className="lg:col-span-7 xl:col-span-8">
            <CartItemsTable
              items={items}
              activeCollection={activeCollection}
              onSelectCollection={setActiveCollection}
              sizeAsc={sizeAsc}
              onToggleSizeSort={() => setSizeAsc(s => !s)}
              onUpdateQuantity={updateQuantity}
              onRemoveItem={removeItem}
              onClearCart={clearCart}
            />
          </div>

          {/* Правая колонка: форма оформления и финансовые лимиты (всегда в поле зрения) */}
          <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-20 z-10 self-start">
            <CartCheckoutForm
              clientName={clientName}
              setClientName={setClientName}
              clientPhone={clientPhone}
              setClientPhone={setClientPhone}
              clientCompany={clientCompany}
              setClientCompany={setClientCompany}
              selectedCity={selectedCity}
              setSelectedCity={setSelectedCity}
              orderComment={orderComment}
              setOrderComment={setOrderComment}
              totalItems={totalItems}
              totalSqm={totalSqm}
              totalPrice={totalPrice}
              submitting={submitting}
              submitError={submitError}
              stockConflictDetails={stockConflictDetails}
              hasDepletedItems={hasDepletedItems}
              hasOverStockItems={hasOverStockItems}
              hasZeroPriceItems={hasZeroPriceItems}
              onRemoveUnavailableItems={handleRemoveUnavailableItems}
              onAutoAdjustQuantities={handleAutoAdjustQuantities}
              isAuthenticated={Boolean(user)}
              onLoginRedirect={() => onNavigate('login')}
              onSubmit={handleSubmit}
              hasMultipleWarehouses={hasMultipleWarehouses}
              warehousesInCart={warehousesInCart}
              requiresApproval={requiresApproval}
              isBlocked={isBlocked}
              exceedsLimit={exceedsLimit}
              creditLimit={creditLimit}
              currentDebt={currentDebt}
              overdueDebt={overdueDebt}
              isAccountant={isAccountant}
            />
          </div>
        </div>
      </div>

      <ExcelBulkOrderModal
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
      />
    </section>
  );
}
