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
    <div className="card p-5 sm:p-6 space-y-5">
      <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">Оформление заказа</h2>

      {/* Контактные данные покупателя */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Контактное лицо <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            placeholder="ФИО покупателя"
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Телефон <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            value={clientPhone}
            onChange={e => setClientPhone(e.target.value)}
            placeholder="+7 (___) ___-__-__"
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Компания / Салон</label>
          <input
            type="text"
            value={clientCompany}
            onChange={e => setClientCompany(e.target.value)}
            placeholder="Название организации"
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Город доставки</label>
          <select
            value={selectedCity}
            onChange={e => setSelectedCity(e.target.value)}
            className="input-field text-sm cursor-pointer"
          >
            {CITIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Комментарий к заказу</label>
          <textarea
            value={orderComment}
            onChange={e => setOrderComment(e.target.value)}
            rows={2}
            placeholder="Пожелания по доставке, ТК, упаковке..."
            className="input-field text-sm resize-none"
          />
        </div>
      </div>

      {/* Уведомление о мультискладе */}
      {hasMultipleWarehouses && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-900">
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <Boxes className="h-4 w-4 text-indigo-600 shrink-0" />
            <span>Заказ из нескольких складов ({warehousesInCart.size})</span>
          </div>
          <p className="text-slate-600 text-[11px] leading-relaxed">
            Позиции находятся на разных региональных складах и будут скомплектованы отдельными накладными.
          </p>
        </div>
      )}

      {/* Предупреждение о согласовании / лимитах */}
      {requiresApproval && (
        <div
          className={`rounded-xl border p-3.5 text-xs ${
            isBlocked ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{isBlocked ? 'Требуется согласование отгрузки' : 'Внимание по условиям оплаты'}</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            {isBlocked
              ? 'По вашей организации действует временное ограничение отгрузок. Заказ будет отправлен на подтверждение вашему региональному менеджеру в WhatsApp.'
              : exceedsLimit
              ? `Сумма заказа превышает доступный кредитный лимит (Лимит: ${fmtPrice(creditLimit)}, Долг: ${fmtPrice(currentDebt)}). Менеджер свяжется для подтверждения оплаты.`
              : `Имеется просроченная задолженность (${fmtPrice(overdueDebt)}). Заказ поступит в обработку после согласования.`}
          </p>
        </div>
      )}

      {/* Сводка стоимости */}
      <div className="border-t border-slate-100 pt-4 space-y-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Всего позиций:</span>
          <span className="font-semibold text-slate-800">{totalItems} шт</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Общая площадь:</span>
          <span className="font-semibold text-slate-800">{fmt2(totalSqm)} м²</span>
        </div>
        <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-100">
          <span>Итого к оплате:</span>
          <span className="text-xl font-extrabold text-brand-700">{fmtPrice(totalPrice)}</span>
        </div>
      </div>

      {/* Предупреждение для неавторизованных пользователей */}
      {!isAuthenticated && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900 space-y-2">
          <div className="flex items-center gap-2 font-bold text-blue-950">
            <AlertCircle className="h-4 w-4 text-blue-700 shrink-0" />
            <span>Требуется авторизация дилера</span>
          </div>
          <p className="text-[11px] text-blue-800 leading-relaxed">
            Оптовые заказы и резервирование ковров на складах Synergy доступны только авторизованным партнерам.
          </p>
          {onLoginRedirect && (
            <button
              type="button"
              onClick={onLoginRedirect}
              className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Войти в личный кабинет
            </button>
          )}
        </div>
      )}

      {/* Предупреждение о товарах без цены */}
      {hasZeroPriceItems && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">В корзине есть позиции с неустановленной ценой</p>
              <p className="text-[11px] mt-0.5 text-amber-800">
                Оформление заказа невозможно до подтверждения стоимости менеджером. Удалите позиции с нулевой ценой или свяжитесь с отделом продаж.
              </p>
            </div>
          </div>
          {onRemoveUnavailableItems && (
            <button
              type="button"
              onClick={onRemoveUnavailableItems}
              className="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Удалить позиции без цены
            </button>
          )}
        </div>
      )}

      {/* Ошибки валидации / остатков */}
      {submitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{submitError}</p>
              {stockConflictDetails && (
                <p className="text-[11px] mt-1 text-red-700">
                  Доступно на складе: <strong>{stockConflictDetails.available_qty ?? 0} шт</strong>
                  {stockConflictDetails.requested_qty ? ` (запрошено: ${stockConflictDetails.requested_qty} шт)` : ''}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Кнопка отправки заказа */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || hasDepletedItems || hasZeroPriceItems || !isAuthenticated}
        className={`w-full h-12 text-sm font-bold flex items-center justify-center gap-2 rounded-xl transition-all shadow-md ${
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
  );
}
export default CartCheckoutForm;
