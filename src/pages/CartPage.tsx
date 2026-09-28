import { useState, useMemo, useEffect } from 'react';
import {
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
  ArrowLeft,
  PackageOpen,
  Send,
  Filter,
  ArrowUpDown,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PageId, CartItem } from '@/types';
import { calcSqm, parseSizeDimensions } from '@/types';
import { submitOrderToErp, fetchClientDebtFromErp, requestOrderApprovalViaWhatsApp } from '@/lib/erpApi';
import { triggerCatalogReload } from '@/hooks/useProductData';
import { getPricingTier } from '@/lib/pricingEngine';
import ProductImage from '@/components/ProductImage';

function sizeArea(size: string): number {
  const { w, h } = parseSizeDimensions(size);
  return w * h;
}

function pluralPositions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'позиция';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'позиции';
  return 'позиций';
}

function fmt2(n: number) { return n.toFixed(2); }
function fmtPrice(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

interface SizeSubtotal {
  size: string;
  qty: number;
  sqm: number;
  sum: number;
  area: number;
}

function calcSizeSubtotals(list: CartItem[]): SizeSubtotal[] {
  const map = new Map<string, SizeSubtotal>();
  for (const item of list) {
    const existing = map.get(item.size);
    const sqm = calcSqm(item.size, item.quantity);
    const sum = item.price * item.quantity;
    if (existing) {
      existing.qty += item.quantity;
      existing.sqm += sqm;
      existing.sum += sum;
    } else {
      map.set(item.size, { size: item.size, qty: item.quantity, sqm, sum, area: sizeArea(item.size) });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.area - b.area);
}

const CITIES = ['Астана', 'Алматы', 'Шымкент'];

export default function CartPage({ onNavigate }: { onNavigate: (page: PageId, productId?: string) => void }) {
  const { items, removeItem, updateQuantity, clearCart, totalItems, totalPrice, totalSqm } = useCart();
  const { user, profile, isImpersonating, impersonatedProfile } = useAuth();

  const [orderDocNumber, setOrderDocNumber] = useState<string | null>(null);
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
    const effectiveProfile = (isImpersonating && impersonatedProfile) ? impersonatedProfile : profile;
    if (!effectiveProfile?.partner_id && !effectiveProfile?.phone) return;
    fetchClientDebtFromErp({
      phone: effectiveProfile.phone,
      counterpartyId: effectiveProfile.partner_id ? Number(effectiveProfile.partner_id) : undefined,
    }).then(res => {
      if (res && res.success && res.found) setDebtReport(res);
    }).catch(() => {});
  }, [profile, isImpersonating, impersonatedProfile]);

  const creditLimit = debtReport?.financials?.credit_limit_usd ?? profile?.credit_limit_usd ?? 0;
  const currentDebt = debtReport?.financials?.total_debt_usd ?? profile?.debt_usd ?? 0;
  const isOverdue = Boolean(debtReport?.financials?.is_overdue || (debtReport?.financials?.overdue_usd && debtReport?.financials?.overdue_usd > 0));
  const isBlocked = Boolean(debtReport?.client?.is_blocked_for_shipment);
  const exceedsLimit = creditLimit > 0 && (currentDebt + totalPrice > creditLimit);
  const requiresApproval = isBlocked || isOverdue || exceedsLimit;

  const collections = useMemo(() => Array.from(new Set(items.map(i => i.collection))).sort(), [items]);

  const filteredItems = useMemo(() => {
    let list = activeCollection !== null ? items.filter(i => i.collection === activeCollection) : [...items];
    list = list.sort((a, b) => {
      const diff = sizeArea(a.size) - sizeArea(b.size);
      return sizeAsc ? diff : -diff;
    });
    return list;
  }, [items, activeCollection, sizeAsc]);

  const groupedByCollection = useMemo(() => {
    const map = new Map<string, CartItem[]>();
    for (const item of filteredItems) {
      const arr = map.get(item.collection) ?? [];
      arr.push(item);
      map.set(item.collection, arr);
    }
    return map;
  }, [filteredItems]);

  const globalSizeSubtotals = useMemo(() => calcSizeSubtotals(filteredItems), [filteredItems]);

  if (orderDocNumber) {
    return (
      <div className="min-h-screen pt-20 pb-24 lg:pb-8">
        <div className="container-w flex flex-col items-center justify-center py-24 text-center">
          <div className={`mb-6 flex h-20 w-20 items-center justify-center rounded-full ${isWaitingApproval ? 'bg-amber-50' : 'bg-emerald-50'}`}>
            {isWaitingApproval ? (
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            )}
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 sm:text-3xl">
            {isWaitingApproval ? 'Заказ отправлен на согласование!' : 'Заказ оформлен!'}
          </h1>
          <div className={`mt-4 rounded-xl border px-6 py-4 ${isWaitingApproval ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <p className={`text-sm mb-1 ${isWaitingApproval ? 'text-amber-700' : 'text-emerald-700'}`}>Номер заказа</p>
            <p className={`text-2xl font-bold font-mono ${isWaitingApproval ? 'text-amber-800' : 'text-emerald-800'}`}>{orderDocNumber}</p>
          </div>
          <p className="mt-4 max-w-md text-slate-500">
            {isWaitingApproval
              ? 'Запрос на согласование условий отгрузки отправлен вашему региональному менеджеру в WhatsApp. Как только заказ будет одобрен, вам придет подтверждающее сообщение в WhatsApp.'
              : 'Наш менеджер свяжется с вами для подтверждения заказа.'}
          </p>
          <button onClick={() => { setOrderDocNumber(null); onNavigate('catalog'); }} className="btn-primary mt-8">
            Продолжить покупки
          </button>
        </div>
      </div>
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
          <button onClick={() => onNavigate('catalog')} className="btn-primary mt-6">Перейти в каталог</button>
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

    const effectiveProfile = (isImpersonating && impersonatedProfile) ? impersonatedProfile : profile;
    const clientId = effectiveProfile?.partner_id
      ? (Number(effectiveProfile.partner_id) || effectiveProfile.partner_id)
      : undefined;

    const fullComment = `${orderComment.trim()}${requiresApproval ? ' [ТРЕБУЕТСЯ АППРУВ В WHATSAPP: ' + (isBlocked ? 'Стоп-лист' : exceedsLimit ? 'Превышение кредитного лимита' : 'Просроченная задолженность') + ']' : ''}`;

    try {
      const data = await submitOrderToErp({
        user_id: effectiveProfile?.id,
        client_id: clientId,
        warehouse_id: 81,
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
          price: item.price,
          price_per_sqm: item.price_per_sqm,
          quantity: item.quantity,
        })),
      });

      if (data.success && data.order?.doc_number) {
        if (requiresApproval) {
          setIsWaitingApproval(true);
          const reason = isBlocked 
            ? 'Ограничение отгрузок (стоп-лист по клиенту)' 
            : exceedsLimit 
              ? `Превышение кредитного лимита (Лимит: $${creditLimit}, Текущий долг: $${currentDebt}, Заказ: $${totalPrice.toFixed(0)})`
              : `Имеется просроченная задолженность ($${debtReport?.financials?.overdue_usd || 0})`;

          requestOrderApprovalViaWhatsApp({
            orderId: data.order.order_id || data.order.doc_number,
            orderDocNumber: data.order.doc_number,
            clientName: clientCompany.trim() || clientName.trim(),
            clientPhone: clientPhone.trim(),
            totalAmount: totalPrice,
            totalSqm: totalSqm,
            itemsCount: totalItems,
            reason,
            managerPhone: debtReport?.regional_manager?.phone,
          }).catch(err => console.warn('Approval dispatch notice:', err));
        } else {
          setIsWaitingApproval(false);
        }

        clearCart();
        setOrderDocNumber(data.order.doc_number);
        setStockConflictDetails(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        throw new Error(data.error || 'Не удалось создать заказ');
      }
    } catch (err: any) {
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

  function renderItemCard(item: CartItem) {
    const key = `${item.productId}-${item.size}-${item.warehouse}`;
    const sqm = calcSqm(item.size, item.quantity);
    const lineTotal = item.price * item.quantity;

    return (
      <div key={key} className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <ProductImage
          src={item.image}
          alt={item.productName}
          loading="lazy"
          decoding="async"
          width={120}
          className="h-16 w-16 shrink-0 rounded-lg object-cover"
        />
        <div className="flex-1 min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{item.productName}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge">{item.size}</span>
            <span className="text-xs text-slate-400">{item.warehouse}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Шт.: <span className="font-medium text-slate-700">{item.quantity}</span></span>
            <span>М²: <span className="font-medium text-slate-700">{fmt2(sqm)}</span></span>
            <span>Сумма: <span className="font-medium text-slate-700">{fmtPrice(lineTotal)}</span></span>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center rounded-lg border border-slate-200">
            <button onClick={() => updateQuantity(item.productId, item.size, item.warehouse, item.quantity - 1)} disabled={item.quantity <= 1} className="flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-30">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center text-sm font-medium text-slate-900">{item.quantity}</span>
            <button onClick={() => updateQuantity(item.productId, item.size, item.warehouse, item.quantity + 1)} className="flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-700">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <span className="w-24 text-right text-sm font-bold text-slate-900">{fmtPrice(lineTotal)}</span>
          <button onClick={() => removeItem(item.productId, item.size, item.warehouse)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  function renderCollectionSubtotal(collection: string, groupItems: CartItem[]) {
    const totalQty = groupItems.reduce((s, i) => s + i.quantity, 0);
    const totalM2 = groupItems.reduce((s, i) => s + calcSqm(i.size, i.quantity), 0);
    const totalSum = groupItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const collSizeSubs = calcSizeSubtotals(groupItems);

    return (
      <div key={`subtotal-${collection}`} className="rounded-xl border border-brand-200 bg-brand-50/50 px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold text-brand-800">{collection}</span>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-600">
            <span>Шт.: <span className="font-semibold text-slate-800">{totalQty}</span></span>
            <span>М²: <span className="font-semibold text-slate-800">{fmt2(totalM2)}</span></span>
            <span>Сумма: <span className="font-semibold text-slate-800">{fmtPrice(totalSum)}</span></span>
          </div>
        </div>
        {collSizeSubs.length > 1 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {collSizeSubs.map(s => (
              <div key={s.size} className="rounded-lg bg-white/70 border border-brand-100 px-3 py-2 text-xs">
                <p className="font-semibold text-slate-700 mb-0.5">{s.size}</p>
                <p className="text-slate-500">{s.qty} шт. / {fmt2(s.sqm)} м² / {fmtPrice(s.sum)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-20 pb-24 lg:pb-8">
      <div className="container-w py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('catalog')} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">Корзина</h1>
              <p className="text-sm text-slate-500">{totalItems} {pluralPositions(totalItems)}</p>
            </div>
          </div>
          <button onClick={clearCart} className="self-start text-sm text-slate-400 transition-colors hover:text-red-500">Очистить</button>
        </div>

        {/* Filter bar */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400 shrink-0" />
            <button onClick={() => setActiveCollection(null)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeCollection === null ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              Все
            </button>
            {collections.map(col => (
              <button key={col} onClick={() => setActiveCollection(activeCollection === col ? null : col)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeCollection === col ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {col}
              </button>
            ))}
          </div>
          <button onClick={() => setSizeAsc(v => !v)} className="btn-secondary flex items-center gap-1.5 text-xs shrink-0">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Размер: {sizeAsc ? 'от меньшего' : 'от большего'}
          </button>
        </div>

        {/* Content grid */}
        <div className="grid gap-8 lg:grid-cols-[1fr,380px]">
          <div className="space-y-3">
            {activeCollection !== null ? (
              Array.from(groupedByCollection.entries()).map(([collection, groupItems]) => (
                <div key={collection} className="space-y-3">
                  {groupItems.map(renderItemCard)}
                  {renderCollectionSubtotal(collection, groupItems)}
                </div>
              ))
            ) : (
              filteredItems.map(renderItemCard)
            )}

            {filteredItems.length === 0 && (
              <p className="py-12 text-center text-sm text-slate-400">Нет товаров для выбранного фильтра</p>
            )}

            {/* Global size subtotals */}
            {globalSizeSubtotals.length > 0 && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-700">Итого по размерам</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {globalSizeSubtotals.map(s => (
                    <div key={s.size} className="rounded-lg bg-white border border-slate-100 px-3 py-2 text-xs">
                      <p className="font-semibold text-slate-800 mb-0.5">{s.size}</p>
                      <p className="text-slate-500">{s.qty} шт.</p>
                      <p className="text-slate-500">{fmt2(s.sqm)} м²</p>
                      <p className="font-medium text-slate-700">{fmtPrice(s.sum)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Order summary sidebar */}
          <div className="lg:sticky lg:top-24 self-start space-y-4">
            {/* Checkout form */}
            <div className="card p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Данные заказа</h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Имя *</label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    placeholder="Ваше имя"
                    className="input-field"
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Телефон *</label>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={e => setClientPhone(e.target.value)}
                    placeholder="+7 (___) ___-__-__"
                    className="input-field"
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Компания</label>
                  <input
                    type="text"
                    value={clientCompany}
                    onChange={e => setClientCompany(e.target.value)}
                    placeholder="ООО / ИП"
                    className="input-field"
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Город доставки</label>
                  <select
                    value={selectedCity}
                    onChange={e => setSelectedCity(e.target.value)}
                    className="input-field"
                    disabled={submitting}
                  >
                    {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Комментарий</label>
                  <textarea
                    value={orderComment}
                    onChange={e => setOrderComment(e.target.value)}
                    placeholder="Дополнительные пожелания..."
                    rows={2}
                    className="input-field resize-none"
                    disabled={submitting}
                  />
                </div>
              </div>
            </div>

            {/* Totals & submit */}
            <div className="card p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Итого</h2>
              {(() => {
                const pricingTier = getPricingTier(profile?.price_type);
                const hasContractDiscount = pricingTier.discountPercent > 0;
                const baseEstimatedTotal = hasContractDiscount ? (totalPrice / (1 - pricingTier.discountPercent / 100)) : totalPrice;
                const totalSavings = baseEstimatedTotal - totalPrice;

                return (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Товары</span>
                      <span className="font-medium text-slate-900">{totalItems} шт.</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Площадь</span>
                      <span className="font-medium text-slate-900">{fmt2(totalSqm)} м²</span>
                    </div>
                    {hasContractDiscount && (
                      <div className="flex items-center justify-between text-xs py-1 px-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                        <span className="text-emerald-800 font-semibold">🏷️ {pricingTier.label}</span>
                        <span className="text-emerald-700 font-bold">Выгода: {fmtPrice(totalSavings)}</span>
                      </div>
                    )}
                    <div className="border-t border-slate-100 pt-3 flex justify-between items-baseline">
                      <div>
                        <span className="font-semibold text-slate-900 block">К оплате</span>
                        {hasContractDiscount && (
                          <span className="text-[11px] text-slate-400 line-through">
                            {fmtPrice(baseEstimatedTotal)}
                          </span>
                        )}
                      </div>
                      <span className="text-xl font-bold text-brand-700">{fmtPrice(totalPrice)}</span>
                    </div>
                  </div>
                );
              })()}

              {submitError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 space-y-2.5">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
                    <div>
                      <p className="font-semibold text-red-900">
                        {stockConflictDetails ? 'Остаток изменился в ERP' : 'Ошибка оформления заказа'}
                      </p>
                      <p className="mt-0.5 text-red-700 leading-relaxed">{submitError}</p>
                    </div>
                  </div>
                  {stockConflictDetails && (
                    <div className="pt-2 border-t border-red-200/60 flex items-center justify-between">
                      <span className="text-[11px] text-red-600">
                        Доступно: <strong>{stockConflictDetails.available_qty ?? 0} шт.</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          triggerCatalogReload();
                          setSubmitError(null);
                          setStockConflictDetails(null);
                        }}
                        className="text-[11px] font-semibold text-red-800 bg-white border border-red-300 rounded px-2.5 py-1 hover:bg-red-100 transition-colors cursor-pointer"
                      >
                        Обновить остатки
                      </button>
                    </div>
                  )}
                </div>
              )}

              {requiresApproval && !submitError && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-amber-800">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>Требуется аппрув отгрузки</span>
                  </div>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    {isBlocked 
                      ? 'По договору действует ограничение на отгрузки.' 
                      : exceedsLimit 
                        ? `Сумма заказа превышает кредитный лимит ($${creditLimit.toLocaleString()}).` 
                        : 'Имеется просроченная задолженность.'}
                    {' '}Заказ будет автоматически направлен на WhatsApp-согласование вашему региональному менеджеру.
                  </p>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary w-full mt-6 relative"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitting ? 'Отправка...' : 'Оформить заказ'}
              </button>
              <p className="mt-3 text-center text-xs text-slate-400">Менеджер свяжется для подтверждения</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
