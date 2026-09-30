import { useState, useMemo, useEffect } from 'react';
import { ShoppingCart, ArrowLeft, PackageOpen } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PageId } from '@/types';
import { submitOrderToErp, fetchClientDebtFromErp, type SplitSubOrder } from '@/lib/erpApi';
import { enqueueOfflineOrder } from '@/lib/offlineOrderQueue';
import { useCurrency } from '@/contexts/CurrencyContext';
import {
  CartSuccessModal,
  CartItemsTable,
  CartCheckoutForm,
  CITIES,
} from '@/components/cart';

export default function CartPage({ onNavigate }: { onNavigate: (page: PageId, productId?: string) => void }) {
  const { currency } = useCurrency();
  const { items, removeItem, updateQuantity, clearCart, totalItems, totalPrice, totalSqm } = useCart();
  const { profile, isImpersonating, impersonatedProfile } = useAuth();

  const [orderDocNumber, setOrderDocNumber] = useState<string | null>(null);
  const [splitOrders, setSplitOrders] = useState<SplitSubOrder[] | null>(null);
  const [isOfflineQueued, setIsOfflineQueued] = useState(false);
  const [isServerBuffered, setIsServerBuffered] = useState(false);
  const [isWaitingApproval, setIsWaitingApproval] = useState(false);
  const [debtReport, setDebtReport] = useState<any | null>(null);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [sizeAsc, setSizeAsc] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stockConflictDetails, setStockConflictDetails] = useState<{ available_qty?: number; requested_qty?: number; sku?: string } | null>(null);

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
        onContinueShopping={() => {
          setOrderDocNumber(null);
          setSplitOrders(null);
          setIsOfflineQueued(false);
          setIsServerBuffered(false);
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
          <p className="mt-2 text-slate-500">Добавьте товары из каталога, чтобы оформить заказ</p>
          <button type="button" onClick={() => onNavigate('catalog')} className="btn-primary mt-6 cursor-pointer">
            Перейти в каталог
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
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
        item_id: item.item_id || (Number(item.productId) > 0 ? Number(item.productId) : undefined),
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
        setStockConflictDetails(err.details || {});
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
        <div className="mb-6 flex items-center justify-between">
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
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

          {/* Правая колонка: форма оформления и финансовые лимиты */}
          <div className="lg:col-span-5 xl:col-span-4 sticky top-24">
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
              onSubmit={handleSubmit}
              hasMultipleWarehouses={hasMultipleWarehouses}
              warehousesInCart={warehousesInCart}
              requiresApproval={requiresApproval}
              isBlocked={isBlocked}
              exceedsLimit={exceedsLimit}
              creditLimit={creditLimit}
              currentDebt={currentDebt}
              overdueDebt={overdueDebt}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
