import { useState, useEffect } from 'react';
import { Loader2, Send, AlertTriangle, AlertCircle, Boxes, CheckCircle2 } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { fmt2, CITIES, type StockConflictItem } from './types';
import { ManagerOrderSelector } from './ManagerOrderSelector';

interface CartCheckoutFormProps {
  clientName: string;
  setClientName: (v: string) => void;
  clientPhone: string;
  setClientPhone: (v: string) => void;
  clientCompany: string;
  setClientCompany: (v: string) => void;
  selectedCity: string;
  setSelectedCity: (v: string) => void;
  orderComment: string;
  setOrderComment: (v: string) => void;
  totalItems: number;
  totalSqm: number;
  totalPrice: number;
  submitting: boolean;
  submitError: string | null;
  stockConflictDetails: { available_qty?: number; requested_qty?: number; sku?: string } | null;
  conflictItems?: StockConflictItem[] | null;
  hasDepletedItems?: boolean;
  hasOverStockItems?: boolean;
  hasZeroPriceItems?: boolean;
  onRemoveUnavailableItems?: () => void;
  onAutoAdjustQuantities?: () => void;
  isAuthenticated?: boolean;
  onLoginRedirect?: () => void;
  onSubmit: () => void;
  hasMultipleWarehouses: boolean;
  warehousesInCart: Map<string, { count: number; totalAmount: number }>;
  requiresApproval: boolean;
  isBlocked: boolean;
  exceedsLimit: boolean;
  creditLimit: number;
  currentDebt: number;
  overdueDebt: number;
  isAccountant?: boolean;
  isStaff?: boolean;
  isAdmin?: boolean;
  isConsignmentOrder?: boolean;
  consignmentWarehouseName?: string;
  checkoutMode?: 'manager_self' | 'dealer_client';
  setCheckoutMode?: (mode: 'manager_self' | 'dealer_client') => void;
  selectedClient?: any | null;
  onSelectClient?: (client: any) => void;
  managerName?: string;
}

export function CartCheckoutForm({
  clientName,
  setClientName,
  clientPhone,
  setClientPhone,
  clientCompany,
  setClientCompany,
  selectedCity,
  setSelectedCity,
  orderComment,
  setOrderComment,
  totalItems,
  totalSqm,
  totalPrice,
  submitting,
  submitError,
  stockConflictDetails,
  conflictItems = null,
  hasDepletedItems,
  hasOverStockItems,
  hasZeroPriceItems,
  onRemoveUnavailableItems,
  onAutoAdjustQuantities,
  isAuthenticated = true,
  onLoginRedirect,
  onSubmit,
  hasMultipleWarehouses,
  warehousesInCart,
  requiresApproval,
  isBlocked,
  exceedsLimit,
  creditLimit,
  currentDebt,
  overdueDebt,
  isAccountant = false,
  isStaff = false,
  isAdmin = false,
  isConsignmentOrder = false,
  consignmentWarehouseName = '',
  checkoutMode = 'manager_self',
  setCheckoutMode,
  selectedClient = null,
  onSelectClient,
  managerName,
}: CartCheckoutFormProps) {
  const { formatPrice: fmtPrice } = useCurrency();
  const { t } = useLanguage();

  const [submitPhase, setSubmitPhase] = useState<number>(0);

  useEffect(() => {
    if (!submitting) {
      setSubmitPhase(0);
      return;
    }
    const t1 = setTimeout(() => setSubmitPhase(1), 800);
    const t2 = setTimeout(() => setSubmitPhase(2), 2000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [submitting]);

  const isCheckoutDisabled = submitting || hasDepletedItems || hasZeroPriceItems || !isAuthenticated || Boolean(hasOverStockItems) || isAccountant;

  return (
    <div className="card p-4 sm:p-5 space-y-3.5 bg-white border border-slate-200 shadow-sm">
      {/* ─── 1. Заголовок и индикатор мультисклада ─── */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div>
          <h2 className="text-base font-bold text-slate-900">{t('cart.checkout_title')}</h2>
          <p className="text-[11px] text-slate-500">{t('cart.direct_reserving')}</p>
        </div>
        {hasMultipleWarehouses && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Boxes className="h-3 w-3 text-indigo-600" />
            <span>{t('cart.warehouses_count')} {warehousesInCart.size}</span>
          </span>
        )}
      </div>

      {/* ─── 2. СВОДКА И ГЛАВНЫЙ CTA ВЫШЕ ЛИНИИ СГИБА (Above-the-Fold) ─── */}
      <div className="rounded-xl bg-slate-50 border border-slate-200/90 p-3 space-y-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-slate-600">
            {t('cart.total_amount')} ({totalItems} {t('common.pcs')} / {fmt2(totalSqm)} {t('common.sqm')}):
          </span>
          <span className="text-lg font-black text-brand-700">{fmtPrice(totalPrice)}</span>
        </div>

        {isAccountant && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/90 p-2.5 flex items-start gap-2 text-left">
            <AlertCircle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-900 leading-tight">
              {t('cart.accountant_mode', 'Режим бухгалтера: формирование заказов отключено. Доступен только просмотр и экспорт.')}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={isCheckoutDisabled}
          className={`w-full h-11 text-sm font-bold flex items-center justify-center gap-2 rounded-xl transition-all shadow-md ${
            submitting
              ? 'bg-brand-700 text-white cursor-wait opacity-95 shadow-inner'
              : isCheckoutDisabled
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-85'
              : 'btn-primary cursor-pointer hover:shadow-lg'
          }`}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-white shrink-0" />
              <span className="truncate">
                {submitPhase === 0
                  ? t('cart.submitting_step1', 'Проверка цен и остатков...')
                  : submitPhase === 1
                  ? t('cart.submitting_step2', 'Резервирование в Synergy ERP...')
                  : t('cart.submitting_step3', 'Оформление наряда в Synergy ERP...')}
              </span>
            </>
          ) : isAccountant ? (
            <span>{t('cart.accountant_view_only')}</span>
          ) : !isAuthenticated ? (
            <span>{t('cart.login_to_checkout')}</span>
          ) : hasDepletedItems ? (
            <span>{t('cart.remove_depleted')}</span>
          ) : hasZeroPriceItems ? (
            <span>{t('cart.remove_zero_price')}</span>
          ) : hasOverStockItems ? (
            <span>{t('cart.adjust_qty_to_stock')}</span>
          ) : (
            <>
              <Send className="h-4 w-4" />
              <span>{t('cart.submit_order')}</span>
            </>
          )}
        </button>

        {submitting && (
          <div className="flex items-center justify-center gap-1.5 pt-0.5 text-[11px] text-brand-800 animate-pulse font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600 animate-ping shrink-0" />
            <span>Прямое резервирование на складах в Synergy ERP...</span>
          </div>
        )}

        <p className="text-[10px] text-slate-400 text-center leading-tight">
          * Не является публичной офертой (ст. 395 ГК РК). Цены указаны в у.е.
        </p>
      </div>

      {/* ─── 3. Компактные предупреждения и статусы ─── */}
      {!isAuthenticated && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-blue-950">
            <AlertCircle className="h-3.5 w-3.5 text-blue-700 shrink-0" />
            <span>{t('cart.dealer_auth_required', 'Требуется авторизация дилера')}</span>
          </div>
          <p className="text-[11px] text-blue-800 leading-tight">
            {t('cart.dealer_auth_desc')}
          </p>
          {onLoginRedirect && (
            <button
              type="button"
              onClick={onLoginRedirect}
              className="w-full py-1.5 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              {t('cart.login_btn', 'Войти в личный кабинет')}
            </button>
          )}
        </div>
      )}

      {hasDepletedItems && !submitError && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2.5 text-xs text-red-900 space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-red-950">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{t('cart.some_items_depleted')}</span>
          </div>
          {conflictItems && conflictItems.length > 0 && (
            <div className="space-y-1.5">
              {conflictItems.map((c, idx) => (
                <div key={`${c.sku || c.productId}-${idx}`} className="rounded-md bg-white/90 border border-red-300 px-2.5 py-1.5 text-[11px]">
                  <p className="font-extrabold text-red-950 leading-snug">
                    {c.productName || 'Ковровое изделие'}{c.size ? ` (${c.size})` : ''}
                  </p>
                  <p className="text-[10.5px] text-red-800 mt-0.5">
                    {c.collection ? `${c.collection} • ` : ''}SKU: <strong className="font-mono">{c.sku || '—'}</strong>
                    {c.warehouse ? ` • ${c.warehouse}` : ''}
                  </p>
                  <p className="text-[10.5px] font-bold text-red-700 mt-0.5">
                    {t('cart.free_qty')} {c.available_qty ?? 0} {t('common.pcs')} (в заказе: {c.requested_qty ?? 1} {t('common.pcs')})
                  </p>
                </div>
              ))}
            </div>
          )}
          {onRemoveUnavailableItems && (
            <button
              type="button"
              onClick={onRemoveUnavailableItems}
              className="w-full py-1.5 px-2.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              {t('cart.remove_unavailable_btn')}
            </button>
          )}
        </div>
      )}

      {hasZeroPriceItems && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[11px]">{t('cart.zero_price_items_title', 'В корзине есть позиции с неустановленной ценой')}</p>
              <p className="text-[10.5px] mt-0.5 text-amber-800 leading-tight">
                {t('cart.zero_price_items_desc')}
              </p>
            </div>
          </div>
          {onRemoveUnavailableItems && (
            <button
              type="button"
              onClick={onRemoveUnavailableItems}
              className="w-full py-1 px-2.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              {t('cart.remove_zero_price_btn', 'Удалить позиции без цены')}
            </button>
          )}
        </div>
      )}

      {requiresApproval && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            isBlocked ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold mb-0.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{isBlocked ? 'Требуется согласование отгрузки' : 'Внимание по условиям оплаты'}</span>
          </div>
          <p className="text-[11px] leading-tight">
            {isBlocked
              ? 'По организации действует ограничение отгрузок. Заказ будет направлен вашему региональному менеджеру в WhatsApp.'
              : exceedsLimit
              ? `Превышение кредитного лимита (Лимит: ${fmtPrice(creditLimit)}, Долг: ${fmtPrice(currentDebt)}).`
              : `Просроченная задолженность (${fmtPrice(overdueDebt)}).`}
          </p>
        </div>
      )}

      {hasOverStockItems && !submitError && onAutoAdjustQuantities && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2.5 text-xs text-red-900 space-y-2">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[11px] text-red-950">{t('cart.adjust_qty_to_stock')}</p>
              <p className="text-[10.5px] mt-0.5 text-red-800 leading-tight">
                {t('cart.depleted_banner_desc')}
              </p>
            </div>
          </div>
          {conflictItems && conflictItems.length > 0 && (
            <div className="space-y-1.5">
              {conflictItems.map((c, idx) => (
                <div key={`${c.sku || c.productId}-${idx}`} className="rounded-md bg-white/90 border border-red-300 px-2.5 py-1.5 text-[11px]">
                  <p className="font-extrabold text-red-950 leading-snug">
                    {c.productName || 'Ковровое изделие'}{c.size ? ` (${c.size})` : ''}
                  </p>
                  <p className="text-[10.5px] text-red-800 mt-0.5">
                    {c.collection ? `${c.collection} • ` : ''}SKU: <strong className="font-mono">{c.sku || '—'}</strong>
                    {c.warehouse ? ` • ${c.warehouse}` : ''}
                  </p>
                  <p className="text-[10.5px] font-bold text-red-700 mt-0.5">
                    {t('cart.free_qty')} {c.available_qty ?? 0} {t('common.pcs')} (в заказе: {c.requested_qty ?? 1} {t('common.pcs')})
                  </p>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onAutoAdjustQuantities}
            className="w-full py-1.5 px-2.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t('cart.adjust_1click')}</span>
          </button>
        </div>
      )}

      {submitError && (
        <div className="rounded-lg border-2 border-red-500 bg-red-50 px-3 py-2.5 text-xs text-red-900 space-y-2 shadow-2xs">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-xs text-red-950 leading-snug">{submitError}</p>
              {(!conflictItems || conflictItems.length === 0) && stockConflictDetails && (
                <p className="text-[10.5px] mt-0.5 text-red-700">
                  {t('cart.free_qty')} <strong>{stockConflictDetails.available_qty ?? 0} {t('common.pcs')}</strong>
                  {stockConflictDetails.requested_qty ? ` (${stockConflictDetails.requested_qty} ${t('common.pcs')})` : ''}.
                </p>
              )}
            </div>
          </div>
          {conflictItems && conflictItems.length > 0 && (
            <div className="space-y-1.5">
              {conflictItems.map((c, idx) => (
                <div key={`${c.sku || c.productId}-${idx}`} className="rounded-md bg-white border border-red-300 px-2.5 py-2 text-[11px] shadow-2xs">
                  <p className="font-extrabold text-red-950 leading-snug">
                    {c.productName || 'Ковровое изделие'}{c.size ? ` — размер ${c.size}` : ''}
                  </p>
                  <p className="text-[10.5px] text-red-800 mt-0.5">
                    {c.collection ? `Коллекция: ${c.collection} • ` : ''}SKU: <strong className="font-mono">{c.sku || '—'}</strong>
                    {c.warehouse ? ` • Склад: ${c.warehouse}` : ''}
                  </p>
                  <p className="text-[11px] font-bold text-red-700 mt-1">
                    {t('cart.free_qty')} <strong>{c.available_qty ?? 0} {t('common.pcs')}</strong> (запрошено в заказе: <strong>{c.requested_qty ?? 1} {t('common.pcs')}</strong>)
                  </p>
                </div>
              ))}
            </div>
          )}
          {onAutoAdjustQuantities && (stockConflictDetails || hasOverStockItems || (conflictItems && conflictItems.length > 0)) && (
            <button
              type="button"
              onClick={onAutoAdjustQuantities}
              className="w-full py-2 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{t('cart.adjust_1click')}</span>
            </button>
          )}
        </div>
      )}

      {/* ─── 3.5. Селектор режима оформления (скрывается для товаров со склада комиссионера) ─── */}
      {isConsignmentOrder ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5 text-xs text-indigo-950 space-y-1 shadow-2xs">
          <div className="flex items-center gap-1.5 font-bold text-indigo-900">
            <Boxes className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <span>Товар со склада комиссионера</span>
          </div>
          <p className="text-[11px] text-indigo-800 leading-tight">
            Оформление напрямую со склада <strong>«{consignmentWarehouseName || 'Склад комиссионера'}»</strong>
            {selectedClient?.name ? ` (${selectedClient.name})` : ''}. Выбор резерва не требуется.
          </p>
        </div>
      ) : (
        isStaff && setCheckoutMode && onSelectClient && (
          <ManagerOrderSelector
            checkoutMode={checkoutMode || 'manager_self'}
            setCheckoutMode={setCheckoutMode}
            selectedClient={selectedClient || null}
            onSelectClient={onSelectClient}
            managerName={managerName}
            isAdmin={isAdmin}
          />
        )
      )}

      {/* ─── 4. Реквизиты и адрес доставки ─── */}
      <div className="space-y-2.5 pt-1 border-t border-slate-100">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">{t('cart.delivery_params')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">{t('cart.client_name')}</label>
            <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder={t('cart.client_name_ph')} className="input-field text-xs h-9 py-1 px-2.5" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">{t('cart.client_phone')}</label>
            <input type="tel" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="+7 (___) ___-__-__" autoComplete="tel" className="input-field text-xs h-9 py-1 px-2.5" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">{t('cart.client_company')}</label>
            <input type="text" value={clientCompany} onChange={e => setClientCompany(e.target.value)} placeholder={t('cart.client_company_ph')} className="input-field text-xs h-9 py-1 px-2.5" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">{t('cart.delivery_city')}</label>
            <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)} className="input-field text-xs h-9 py-1 px-2.5 cursor-pointer">
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">{t('cart.comment')}</label>
            <input type="text" value={orderComment} onChange={e => setOrderComment(e.target.value)} placeholder={t('cart.comment_ph')} className="input-field text-xs h-9 py-1 px-2.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default CartCheckoutForm;
