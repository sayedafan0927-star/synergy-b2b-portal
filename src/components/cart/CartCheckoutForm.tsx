import { Loader2, Send, AlertTriangle, AlertCircle, Boxes } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { fmt2, CITIES } from './types';

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
  hasDepletedItems?: boolean;
  hasZeroPriceItems?: boolean;
  onRemoveUnavailableItems?: () => void;
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
  hasDepletedItems,
  hasZeroPriceItems,
  onRemoveUnavailableItems,
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
}: CartCheckoutFormProps) {
  const { formatPrice: fmtPrice } = useCurrency();

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <h2 className="text-base font-bold text-slate-900">Оформление заказа</h2>
        {hasMultipleWarehouses && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Boxes className="h-3 w-3 text-indigo-600" />
            <span>Складов: {warehousesInCart.size}</span>
          </span>
        )}
      </div>

      {/* Компактная 2-колоночная сетка контактных данных */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
            Контактное лицо <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            placeholder="ФИО покупателя"
            className="input-field text-xs h-9 py-1 px-2.5"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
            Телефон <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            value={clientPhone}
            onChange={e => setClientPhone(e.target.value)}
            placeholder="+7 (___) ___-__-__"
            className="input-field text-xs h-9 py-1 px-2.5"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Компания / Салон</label>
          <input
            type="text"
            value={clientCompany}
            onChange={e => setClientCompany(e.target.value)}
            placeholder="Название организации"
            className="input-field text-xs h-9 py-1 px-2.5"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Город доставки</label>
          <select
            value={selectedCity}
            onChange={e => setSelectedCity(e.target.value)}
            className="input-field text-xs h-9 py-1 px-2.5 cursor-pointer"
          >
            {CITIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Комментарий к заказу</label>
          <input
            type="text"
            value={orderComment}
            onChange={e => setOrderComment(e.target.value)}
            placeholder="Пожелания по доставке, ТК, упаковке..."
            className="input-field text-xs h-9 py-1 px-2.5"
          />
        </div>
      </div>

      {/* Уведомление о мультискладе при наличии */}
      {hasMultipleWarehouses && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900">
          <div className="flex items-center gap-1.5 font-bold mb-0.5">
            <Boxes className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <span>Заказ из нескольких складов ({warehousesInCart.size})</span>
          </div>
          <p className="text-slate-600 text-[11px] leading-tight">
            Позиции находятся на разных региональных складах и будут скомплектованы отдельными накладными.
          </p>
        </div>
      )}

      {/* Предупреждение о согласовании / лимитах */}
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
              ? 'По вашей организации действует временное ограничение отгрузок. Заказ будет отправлен на подтверждение вашему региональному менеджеру в WhatsApp.'
              : exceedsLimit
              ? `Сумма заказа превышает доступный кредитный лимит (Лимит: ${fmtPrice(creditLimit)}, Долг: ${fmtPrice(currentDebt)}). Менеджер свяжется для подтверждения оплаты.`
              : `Имеется просроченная задолженность (${fmtPrice(overdueDebt)}). Заказ поступит в обработку после согласования.`}
          </p>
        </div>
      )}

      {/* Предупреждение для неавторизованных пользователей */}
      {!isAuthenticated && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-900 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-blue-950">
            <AlertCircle className="h-3.5 w-3.5 text-blue-700 shrink-0" />
            <span>Требуется авторизация дилера</span>
          </div>
          <p className="text-[11px] text-blue-800 leading-tight">
            Оптовые заказы и резервирование ковров на складах Synergy доступны только авторизованным партнерам.
          </p>
          {onLoginRedirect && (
            <button
              type="button"
              onClick={onLoginRedirect}
              className="w-full py-1.5 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Войти в личный кабинет
            </button>
          )}
        </div>
      )}

      {/* Компактное предупреждение о товарах без цены */}
      {hasZeroPriceItems && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[11px]">В корзине есть позиции с неустановленной ценой</p>
              <p className="text-[10.5px] mt-0.5 text-amber-800 leading-tight">
                Оформление невозможно до подтверждения стоимости. Удалите их или свяжитесь с отделом продаж.
              </p>
            </div>
          </div>
          {onRemoveUnavailableItems && (
            <button
              type="button"
              onClick={onRemoveUnavailableItems}
              className="w-full py-1.5 px-2.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Удалить позиции без цены
            </button>
          )}
        </div>
      )}

      {/* Ошибки валидации / остатков */}
      {submitError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[11px]">{submitError}</p>
              {stockConflictDetails && (
                <p className="text-[10.5px] mt-0.5 text-red-700">
                  Доступно на складе: <strong>{stockConflictDetails.available_qty ?? 0} шт</strong>
                  {stockConflictDetails.requested_qty ? ` (запрошено: ${stockConflictDetails.requested_qty} шт)` : ''}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Сводка стоимости и кнопка чекаута (выше линии сгиба) */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>Позиций: <strong className="text-slate-800">{totalItems} шт</strong> ({fmt2(totalSqm)} м²)</span>
          <div className="text-right">
            <span className="text-base font-extrabold text-brand-700">{fmtPrice(totalPrice)}</span>
          </div>
        </div>

        {/* Кнопка отправки заказа */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || hasDepletedItems || hasZeroPriceItems || !isAuthenticated}
          className={`w-full h-11 text-sm font-bold flex items-center justify-center gap-2 rounded-xl transition-all shadow-md ${
            hasDepletedItems || hasZeroPriceItems || !isAuthenticated
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-80'
              : 'btn-primary cursor-pointer'
          }`}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Оформление заказа...</span>
            </>
          ) : !isAuthenticated ? (
            <span>Войдите для оформления заказа</span>
          ) : hasDepletedItems ? (
            <span>Удалите закончившиеся товары</span>
          ) : hasZeroPriceItems ? (
            <span>Удалите товары без цены</span>
          ) : (
            <>
              <Send className="h-4 w-4" />
              <span>Подтвердить и отправить заказ</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
export default CartCheckoutForm;
