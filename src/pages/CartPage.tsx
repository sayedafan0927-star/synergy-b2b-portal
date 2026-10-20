import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ShoppingCart, ArrowLeft, PackageOpen, AlertCircle, Trash2, FileSpreadsheet } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PageId } from '@/types';
import {
  submitOrderToErp,
  fetchClientDebtFromErp,
  isConsignmentWarehouseItem,
  resolveConsignmentWarehouseOwner,
  invalidateClientCatalogCache,
  type SplitSubOrder,
} from '@/lib/erpApi';
import { enqueueOfflineOrder } from '@/lib/offlineOrderQueue';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useLanguage } from '@/contexts/LanguageContext';
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
  buildEnrichedConflictItems,
  parseInsufficientStockError,
  syncCartItemWithProduct,
  type StockConflictItem,
} from '@/components/cart';

function extractCounterpartyPhone(client: any): string {
  const raw = String(client?.phone || client?.portal_login || client?.contact_phone || '').trim();
  if (!raw) return '';
  return isValidPhone(raw) ? formatPhone(raw) : raw;
}

export default function CartPage({ onNavigate }: { onNavigate: (page: PageId, productId?: string) => void }) {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const { items, removeItem, updateQuantity, syncItemPrices, clearCart, totalItems, totalPrice, totalSqm } = useCart();
  const { user, profile, isImpersonating, impersonatedProfile, isAccountant } = useAuth();
  const { products } = useProducts();
  const { info: toastInfo } = useToast();

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
  const [submitError, setSubmitError] = useState(null as string | null);
  const [stockConflictDetails, setStockConflictDetails] = useState<{ available_qty?: number; requested_qty?: number; sku?: string } | null>(null);
  const [rawConflictItems, setRawConflictItems] = useState<StockConflictItem[]>([]);
  const conflictOverridesRef = useRef<Map<string, number>>(new Map());
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);

  const effectiveProfile = isImpersonating && impersonatedProfile ? impersonatedProfile : profile;
  const isStaff = !isImpersonating && (profile?.role === 'admin' || profile?.role === 'manager_rm' || profile?.role === 'manager_lm');
  const [checkoutMode, setCheckoutMode] = useState<'manager_self' | 'dealer_client'>('manager_self');
  const [selectedClient, setSelectedClient] = useState<any | null>(null);

  const consignmentItem = useMemo(() => items.find(it => isConsignmentWarehouseItem(it)), [items]);
  const isConsignmentOrder = Boolean(consignmentItem);
  const consignmentWarehouseName = consignmentItem?.warehouse || '';

  const { getVariantPrice, getPricePerSqm } = useUserPricing(
    selectedClient?.price_type || (debtReport as any)?.client?.price_type
  );

  const [clientName, setClientName] = useState(() => effectiveProfile?.full_name ?? '');
  const [clientPhone, setClientPhone] = useState(() => {
    if (effectiveProfile?.phone && isValidPhone(effectiveProfile.phone)) return formatPhone(effectiveProfile.phone);
    if (typeof window !== 'undefined' && !isStaff) {
      try {
        const stored = localStorage.getItem(CHECKOUT_PHONE_STORAGE_KEY);
        if (isValidPhone(stored)) return formatPhone(stored);
      } catch {}
    }
    return user?.phone && isValidPhone(user.phone) ? formatPhone(user.phone) : DEFAULT_CHECKOUT_PHONE;
  });
  const [clientCompany, setClientCompany] = useState(() =>
    isStaff && checkoutMode === 'manager_self' ? 'Synergy Group (Внутренний заказ)' : (effectiveProfile?.company_name ?? '')
  );
  const [selectedCity, setSelectedCity] = useState(CITIES[0]);
  const [orderComment, setOrderComment] = useState('');

  // Выбор клиента для менеджера: строго затягиваем телефон и реквизиты самого контрагента (не РМ/ЛМ!)
  const handleSelectClient = useCallback((client: any | null, modeOverride?: 'manager_self' | 'dealer_client') => {
    const activeMode = modeOverride ?? checkoutMode;
    setSelectedClient(client);
    if (client) {
      setClientName(client.name || '');
      setClientCompany(client.name || '');
      setClientPhone(extractCounterpartyPhone(client));
      if (client.city) {
        const matchedCity = CITIES.find(c => c.toLowerCase() === client.city.toLowerCase());
        if (matchedCity) setSelectedCity(matchedCity);
      }
    } else if (activeMode === 'dealer_client') {
      setClientName('');
      setClientCompany('');
      setClientPhone('');
      setDebtReport(null);
    } else {
      setClientName(effectiveProfile?.full_name || 'Менеджер Synergy');
      setClientCompany('Synergy Group (Внутренний заказ)');
      setClientPhone(effectiveProfile?.phone && isValidPhone(effectiveProfile.phone) ? formatPhone(effectiveProfile.phone) : DEFAULT_CHECKOUT_PHONE);
      setDebtReport(null);
    }
  }, [effectiveProfile, checkoutMode]);

  const handleSetCheckoutMode = useCallback((mode: 'manager_self' | 'dealer_client') => {
    setCheckoutMode(mode);
    if (mode === 'dealer_client' && !selectedClient) {
      setClientName('');
      setClientCompany('');
      setClientPhone('');
      setDebtReport(null);
    } else if (mode === 'manager_self') {
      setSelectedClient(null);
      setClientName(effectiveProfile?.full_name || 'Менеджер Synergy');
      setClientCompany('Synergy Group (Внутренний заказ)');
      setClientPhone(effectiveProfile?.phone && isValidPhone(effectiveProfile.phone) ? formatPhone(effectiveProfile.phone) : DEFAULT_CHECKOUT_PHONE);
      setDebtReport(null);
    }
  }, [selectedClient, effectiveProfile]);

  // Если товар положен со склада комиссионера — не спрашиваем на кого резерв, автоматически подтягиваем контрагента этого склада
  useEffect(() => {
    if (!isConsignmentOrder || !consignmentItem) return;
    let active = true;
    resolveConsignmentWarehouseOwner((consignmentItem as any)?.warehouse_id, consignmentItem.warehouse).then(owner => {
      if (!active) return;
      if (owner) {
        setSelectedClient(owner);
        setClientName(owner.name || consignmentWarehouseName);
        setClientCompany(owner.name || consignmentWarehouseName);
        const ownerPhone = extractCounterpartyPhone(owner);
        if (ownerPhone) setClientPhone(ownerPhone);
        if (owner.city) {
          const matchedCity = CITIES.find(c => c.toLowerCase() === owner.city!.toLowerCase());
          if (matchedCity) setSelectedCity(matchedCity);
        }
      } else {
        setClientName(consignmentWarehouseName);
        setClientCompany(consignmentWarehouseName);
      }
    });
    return () => { active = false; };
  }, [isConsignmentOrder, consignmentItem?.warehouse, (consignmentItem as any)?.warehouse_id, consignmentWarehouseName]);

  // Автоматическая подстановка данных профиля (строго только для самого клиента или режима "На себя", без перезаписи телефона контрагента!)
  useEffect(() => {
    if (!effectiveProfile || isConsignmentOrder) return;
    if (!isStaff || isImpersonating) {
      if (effectiveProfile.full_name && !clientName) setClientName(effectiveProfile.full_name);
      if (effectiveProfile.company_name && !clientCompany) setClientCompany(effectiveProfile.company_name);
      if (isValidPhone(effectiveProfile.phone)) setClientPhone(formatPhone(effectiveProfile.phone));
    }
  }, [effectiveProfile, isStaff, isImpersonating, isConsignmentOrder]);

  const handleClientPhoneChange = useCallback((value: string) => {
    const formatted = formatPhone(value);
    setClientPhone(formatted);
    if (typeof window !== 'undefined' && !isStaff && isValidPhone(formatted)) {
      try {
        localStorage.setItem(CHECKOUT_PHONE_STORAGE_KEY, formatted);
      } catch {}
    }
  }, [isStaff]);

  // Загрузка финансового состояния клиента (кредитный лимит, просрочки) и дозаполнение телефона контрагента из карточки долга
  useEffect(() => {
    if (isStaff && !isImpersonating && !isConsignmentOrder && checkoutMode === 'manager_self') {
      setDebtReport(null);
      return;
    }
    const targetPhone = selectedClient ? selectedClient.phone : effectiveProfile?.phone;
    const targetPartnerId = selectedClient ? selectedClient.id : effectiveProfile?.partner_id;
    if (!targetPartnerId && !targetPhone) return;
    fetchClientDebtFromErp({
      phone: targetPhone,
      counterpartyId: Number(targetPartnerId) || undefined,
      search: selectedClient ? selectedClient.name : (effectiveProfile?.full_name || effectiveProfile?.company_name),
    })
      .then(res => {
        if (res?.success && res.found) {
          setDebtReport(res);
          const debtClientPhone = extractCounterpartyPhone((res as any)?.client);
          if (selectedClient && debtClientPhone && !extractCounterpartyPhone(selectedClient)) {
            setClientPhone(debtClientPhone);
          }
        }
      })
      .catch(err => console.warn('Debt check notice:', err));
  }, [profile, isImpersonating, impersonatedProfile, isStaff, isConsignmentOrder, checkoutMode, selectedClient]);

  // Автоматическая тихая синхронизация цен и курса валют (для предзаказа: inProd > 0 ? inProd)
  useEffect(() => {
    if (!products || products.length === 0 || items.length === 0) return;
    const count = syncItemPrices(item =>
      syncCartItemWithProduct(item, products, getVariantPrice, getPricePerSqm, conflictOverridesRef.current)
    );
    if (count > 0) {
      toastInfo(`Цены и доступные остатки для ${count} поз. в корзине актуализированы по прайсу Synergy ERP`, 'Синхронизация цен');
    }
  }, [products, items, syncItemPrices, getVariantPrice, getPricePerSqm, toastInfo, selectedClient?.id, effectiveProfile?.id, effectiveProfile?.price_type]);

  const conflictItems = useMemo(() => buildEnrichedConflictItems(items, rawConflictItems), [items, rawConflictItems]);
  const hasDepletedItems = useMemo(() => items.some(it => it.maxStock === 0), [items]);
  const hasOverStockItems = useMemo(
    () => items.some(it => typeof it.maxStock === 'number' && it.maxStock > 0 && it.quantity > it.maxStock),
    [items]
  );
  const hasZeroPriceItems = useMemo(() => items.some(it => !it.price || it.price <= 0), [items]);

  const handleRemoveUnavailableItems = useCallback(() => {
    const problematicItems = items.filter(it => (!it.price || it.price <= 0) || it.maxStock === 0);
    problematicItems.forEach(it => removeItem(it.productId, it.size, it.warehouse));
    setSubmitError(null); setStockConflictDetails(null); setRawConflictItems([]);
    conflictOverridesRef.current.clear();
    if (problematicItems.length > 0) toastInfo(`Удалено позиций: ${problematicItems.length}. Корзина обновлена.`);
  }, [items, removeItem, toastInfo]);

  const handleAutoAdjustQuantities = useCallback(() => {
    let adjustedCount = 0;
    for (const c of conflictItems) {
      const cSku = String(c.sku || '').trim().toLowerCase();
      const cItemId = Number(c.item_id) || 0;
      const avail = typeof c.available_qty === 'number' ? Math.max(0, c.available_qty) : 0;
      for (const it of items) {
        const itSku = String(it.sku || '').trim().toLowerCase();
        const itProdId = String(it.productId || '').trim().toLowerCase();
        const itItemId = Number(it.item_id) || 0;
        if ((itItemId > 0 && cItemId > 0 && itItemId === cItemId) || (cSku && (itSku === cSku || itProdId === cSku)) || items.length === 1) {
          if (avail === 0) { removeItem(it.productId, it.size, it.warehouse); adjustedCount++; }
          else if (it.quantity > avail) { updateQuantity(it.productId, it.size, it.warehouse, avail); adjustedCount++; }
        }
      }
    }
    for (const it of items) {
      if (typeof it.maxStock === 'number') {
        if (it.maxStock === 0) { removeItem(it.productId, it.size, it.warehouse); adjustedCount++; }
        else if (it.quantity > it.maxStock) { updateQuantity(it.productId, it.size, it.warehouse, it.maxStock); adjustedCount++; }
      }
    }
    setSubmitError(null); setStockConflictDetails(null); setRawConflictItems([]);
    conflictOverridesRef.current.clear();
    if (adjustedCount > 0) {
      toastInfo(`Скорректировано позиций: ${adjustedCount}. Количество выровнено по доступным остаткам складов.`, 'Остатки актуализированы');
    }
  }, [items, conflictItems, removeItem, updateQuantity, toastInfo]);

  const isAdmin = profile?.role === 'admin';
  const isManagerSelfOrder = isStaff && !isConsignmentOrder && checkoutMode === 'manager_self';
  const isBlocked = !isAdmin && !isManagerSelfOrder && debtReport?.client?.is_blocked_for_shipment === true;
  const overdueDebt = debtReport?.financials?.overdue_usd || 0;
  const currentDebt = debtReport?.financials?.total_debt_usd || debtReport?.client?.debt_usd || 0;
  const creditLimit = Number(
    debtReport?.client?.credit_limit_usd || debtReport?.financials?.credit_limit_usd ||
    debtReport?.credit_limit_usd || debtReport?.contracts?.[0]?.credit_limit_usd || effectiveProfile?.credit_limit_usd || 0
  );
  const totalExposure = currentDebt + totalPrice;
  const exceedsLimit = creditLimit > 0 && totalExposure > creditLimit;
  const hasOverdue = overdueDebt > 0;
  const requiresApproval = !isAdmin && !isManagerSelfOrder && (isBlocked || exceedsLimit || hasOverdue);

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
        orderDocNumber={orderDocNumber} splitOrders={splitOrders}
        isOfflineQueued={isOfflineQueued} isServerBuffered={isServerBuffered}
        isWaitingApproval={isWaitingApproval} isPartiallyConfirmed={isPartiallyConfirmed}
        onContinueShopping={() => {
          setOrderDocNumber(null); setSplitOrders(null);
          setIsOfflineQueued(false); setIsServerBuffered(false);
          setIsWaitingApproval(false); setIsPartiallyConfirmed(false);
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
          <h1 className="font-display text-2xl font-bold text-slate-900">{t('cart.empty_title')}</h1>
          <p className="mt-2 text-slate-500">{t('cart.empty_desc')}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => onNavigate('catalog')} className="btn-primary cursor-pointer">{t('cart.back_to_catalog')}</button>
            <button type="button" onClick={() => setIsExcelModalOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-semibold shadow-2xs transition-all cursor-pointer">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>{t('cart.excel_order')}</span>
            </button>
          </div>
        </div>
        <ExcelBulkOrderModal isOpen={isExcelModalOpen} onClose={() => setIsExcelModalOpen(false)} />
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
      setSubmitError('В корзине есть позиции с неустановленной ценой (0 у.е.). Обратитесь к менеджеру или удалите их для оформления заказа.');
      return;
    }
    if (!clientName.trim() || !clientPhone.trim()) {
      setSubmitError('Укажите имя и телефон для оформления заказа');
      return;
    }

    if (typeof window !== 'undefined' && !isStaff && isValidPhone(clientPhone)) {
      try {
        localStorage.setItem(CHECKOUT_PHONE_STORAGE_KEY, clientPhone.trim());
      } catch {}
    }

    setSubmitting(true);
    setSubmitError(null);

    const effectiveProfile = isImpersonating && impersonatedProfile ? impersonatedProfile : profile;
    const isManagerSelfOrder = isStaff && !isConsignmentOrder && checkoutMode === 'manager_self';
    const clientId = isManagerSelfOrder
      ? undefined
      : (selectedClient?.id || (effectiveProfile?.partner_id ? Number(effectiveProfile.partner_id) || effectiveProfile.partner_id : undefined));

    const whSummaryTag = hasMultipleWarehouses
      ? ` [МУЛЬТИСКЛАД: ${Array.from(warehousesInCart.entries())
          .map(([w, d]) => `${w} (${d.count} шт, ${d.totalAmount.toFixed(0)} у.е.)`)
          .join(', ')}]`
      : '';
    const managerTag = isManagerSelfOrder
      ? ` [ВНУТРЕННИЙ ЗАКАЗ: ${profile?.full_name || 'Менеджер'} - Переброска на клиента в ERP]`
      : (selectedClient ? ` [ОФОРМЛЕНО МЕНЕДЖЕРОМ: ${profile?.full_name || 'РМ'} ДЛЯ ${selectedClient.name} (ID: ${selectedClient.id})]` : '');
    const fullComment = `${orderComment.trim()}${whSummaryTag}${managerTag}${
      requiresApproval
        ? ' [ТРЕБУЕТСЯ АППРУВ В WHATSAPP: ' +
          (isBlocked ? 'Стоп-лист' : exceedsLimit ? 'Превышение кредитного лимита' : 'Просроченная задолженность') +
          ']'
        : ''
    }`;

    const effectiveWarehouseId = items.find(it => (it as any).warehouse_id)?.warehouse_id || 81;
    const hasPreorderItems = items.some(it => Boolean(it.is_preorder || String(it.warehouse || '').includes('Предзаказ')));

    const orderPayload = {
      user_id: effectiveProfile?.id,
      client_id: clientId,
      partner_id: clientId,
      warehouse_id: effectiveWarehouseId,
      currency: currency || 'USD',
      is_preorder: hasPreorderItems ? true : undefined,
      buyer: { name: clientCompany.trim() || clientName.trim(), phone: clientPhone.trim() },
      client_name: clientName.trim(),
      client_phone: clientPhone.trim(),
      client_company: clientCompany.trim(),
      city: selectedCity,
      comment: fullComment,
      is_manager_order: isManagerSelfOrder,
      requires_approval: requiresApproval,
      is_held: requiresApproval,
      hold_wms: requiresApproval,
      status: requiresApproval ? 'waiting_approval' : 'pending',
      items: items.map(item => {
        const itemIsPreorder = Boolean(item.is_preorder || String(item.warehouse || '').includes('Предзаказ'));
        return {
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
          qty: item.quantity,
          is_preorder: itemIsPreorder ? true : undefined,
        };
      }),
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
      const docNum = data.order?.doc_number || (data as any)?.doc_number || data.order_number || data.split_orders?.[0]?.doc_number || ((data as any)?.ingest_uuid ? `ORD-BUF-${String((data as any).ingest_uuid).replace(/^ingest_/, '').slice(0, 8).toUpperCase()}` : null) || 'ORD-NEW';
      const isOrderSuccess = Boolean(data.success && (docNum || data.order?.doc_number || data.split_orders?.length || data.status === 'accepted' || (data as any)?.ingest_uuid));

      if (isOrderSuccess) {
        const receivedSplits = data.split_orders || data.order?.split_orders || null;
        setSplitOrders(receivedSplits && receivedSplits.length > 1 ? receivedSplits : null);
        setIsServerBuffered(Boolean(data.order?.is_buffered || (data as any)?.is_buffered || (data as any)?.is_buffered_offline || data.status === 'accepted' || (data as any)?.ingest_uuid));
        setIsOfflineQueued(false);
        setIsWaitingApproval(!isAdmin && (requiresApproval || Boolean((data.order as any)?.requires_approval)));
        setIsPartiallyConfirmed(Boolean(data.is_partially_confirmed || data.status === 'partially_confirmed' || (receivedSplits && receivedSplits.some((s: any) => s.status === 'failed' || s.status === 'cancelled' || s.success === false))));

        clearCart();
        setOrderDocNumber(docNum);
        setStockConflictDetails(null);
        setRawConflictItems([]);
        conflictOverridesRef.current.clear();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        throw new Error(data.error || (data as any)?.message || 'Не удалось создать заказ');
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

      if (err.code === 'INSUFFICIENT_STOCK' || err.details?.code === 'INSUFFICIENT_STOCK') {
        invalidateClientCatalogCache();
        setActiveCollection(null);
        const parsed = parseInsufficientStockError(err, items);
        setSubmitError(parsed.formattedMessage);
        setStockConflictDetails(parsed.primaryDetails);
        setRawConflictItems(parsed.conflicts);

        for (const c of parsed.conflicts) {
          const avail = typeof c.available_qty === 'number' ? Math.max(0, c.available_qty) : 0;
          if (c.sku) conflictOverridesRef.current.set(String(c.sku).trim().toLowerCase(), avail);
          if (c.productId) conflictOverridesRef.current.set(String(c.productId).trim().toLowerCase(), avail);
          if (c.item_id) conflictOverridesRef.current.set(String(c.item_id), avail);
        }

        syncItemPrices(item => {
          const itSku = String(item.sku || '').trim().toLowerCase();
          const itProdId = String(item.productId || '').trim().toLowerCase();
          const itItemId = Number(item.item_id) || 0;
          const matched = parsed.conflicts.find(c => {
            const cSku = String(c.sku || '').trim().toLowerCase();
            const cItemId = Number(c.item_id) || 0;
            return (itItemId > 0 && cItemId > 0 && itItemId === cItemId) || (cSku && (itSku === cSku || itProdId === cSku)) || items.length === 1;
          });
          if (matched) {
            const avail = typeof matched.available_qty === 'number' ? Math.max(0, matched.available_qty) : 0;
            return { price: item.price, price_per_sqm: item.price_per_sqm, maxStock: avail, keepQuantityOnConflict: true };
          }
          return null;
        });

        setTimeout(() => {
          const el = document.querySelector('[data-stock-conflict="true"]');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      } else {
        setSubmitError(err.message || 'Ошибка оформления заказа');
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
            <button type="button" onClick={() => onNavigate('catalog')} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 mb-2 cursor-pointer">
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('cart.back_to_catalog')}
            </button>
            <h1 className="font-display text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-brand-700" />
              {t('cart.title')}
            </h1>
          </div>
          <button type="button" onClick={() => setIsExcelModalOpen(true)} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-semibold shadow-2xs transition-all cursor-pointer self-start sm:self-auto">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>{t('cart.excel_order')}</span>
          </button>
        </div>

        {(hasDepletedItems || conflictItems.length > 0) && (
          <div className="mb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border-2 border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-900 animate-in fade-in shadow-xs">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-red-900">{t('cart.some_items_depleted')} </span>
                <span className="text-red-800 text-[11px]">{t('cart.depleted_banner_desc')}</span>
                {conflictItems.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {conflictItems.map((c, idx) => (
                      <span key={`${c.sku || idx}`} className="inline-flex items-center gap-1 rounded bg-red-100 border border-red-300 px-2 py-0.5 text-[11px] font-bold text-red-900">
                        {c.productName || `SKU ${c.sku}`} ({c.size || '—'}, арт. {c.sku}) — доступно: {c.available_qty ?? 0} шт.
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={handleAutoAdjustQuantities} className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors cursor-pointer shadow-xs">
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t('cart.remove_unavailable_btn', 'Удалить недоступные')}</span>
            </button>
          </div>
        )}

        {hasZeroPriceItems && (
          <div className="mb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold text-amber-900">{t('cart.zero_price_items_title')} </span>
                <span className="text-amber-800 text-[11px]">{t('cart.zero_price_items_desc')}</span>
              </div>
            </div>
            <button type="button" onClick={handleRemoveUnavailableItems} className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer shadow-xs">
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t('cart.remove_zero_price_btn', 'Удалить позиции без цены')}</span>
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
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
              conflictItems={conflictItems}
            />
          </div>

          <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-20 z-10 self-start">
            <CartCheckoutForm
              clientName={clientName} setClientName={setClientName}
              clientPhone={clientPhone} setClientPhone={handleClientPhoneChange}
              clientCompany={clientCompany} setClientCompany={setClientCompany}
              selectedCity={selectedCity} setSelectedCity={setSelectedCity}
              orderComment={orderComment} setOrderComment={setOrderComment}
              totalItems={totalItems} totalSqm={totalSqm} totalPrice={totalPrice}
              submitting={submitting} submitError={submitError} stockConflictDetails={stockConflictDetails}
              conflictItems={conflictItems}
              hasDepletedItems={hasDepletedItems} hasOverStockItems={hasOverStockItems} hasZeroPriceItems={hasZeroPriceItems}
              onRemoveUnavailableItems={handleRemoveUnavailableItems} onAutoAdjustQuantities={handleAutoAdjustQuantities}
              isAuthenticated={Boolean(user)} onLoginRedirect={() => onNavigate('login')} onSubmit={handleSubmit}
              hasMultipleWarehouses={hasMultipleWarehouses} warehousesInCart={warehousesInCart}
              requiresApproval={requiresApproval} isBlocked={isBlocked} exceedsLimit={exceedsLimit}
              creditLimit={creditLimit} currentDebt={currentDebt} overdueDebt={overdueDebt}
              isAccountant={isAccountant} isStaff={isStaff} isAdmin={isAdmin}
              isConsignmentOrder={isConsignmentOrder} consignmentWarehouseName={consignmentWarehouseName}
              checkoutMode={checkoutMode} setCheckoutMode={handleSetCheckoutMode}
              selectedClient={selectedClient} onSelectClient={handleSelectClient}
              managerName={profile?.full_name}
            />
          </div>
        </div>
      </div>

      <ExcelBulkOrderModal isOpen={isExcelModalOpen} onClose={() => setIsExcelModalOpen(false)} />
    </section>
  );
}
