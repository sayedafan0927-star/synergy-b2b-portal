import { useState, useEffect, useRef, useCallback } from 'react';
import { UserCheck, Building2, Search, X, Loader2, Check, MessageSquare, Send, CheckCircle2, RotateCw } from 'lucide-react';
import { fetchCounterpartiesFromErp, fetchClientOrdersFromErp, type Counterparty } from '@/lib/erpApi';
import { useToast } from '@/contexts/ToastContext';

interface ManagerOrderSelectorProps {
  checkoutMode: 'manager_self' | 'dealer_client';
  setCheckoutMode: (mode: 'manager_self' | 'dealer_client') => void;
  selectedClient: Counterparty | null;
  onSelectClient: (client: Counterparty | null) => void;
  managerName?: string;
  isAdmin?: boolean;
}

export function ManagerOrderSelector({
  checkoutMode,
  setCheckoutMode,
  selectedClient,
  onSelectClient,
  managerName,
  isAdmin = false,
}: ManagerOrderSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Counterparty[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Admin WhatsApp approval testing states for real orders
  const [showTestBox, setShowTestBox] = useState(false);
  const [testPhone, setTestPhone] = useState('87086984543');
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('55');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testSuccessNotice, setTestSuccessNotice] = useState<string | null>(null);

  const { success: toastSuccess, error: toastError } = useToast();

  const loadRecentOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const res = await fetchClientOrdersFromErp({ limit: 10 });
      if (res && Array.isArray(res.orders)) {
        setRecentOrders(res.orders);
        if (res.orders.length > 0) {
          // Preselect latest pending order if any, else latest order
          const pending = res.orders.find((o: any) => o.status_code === 'pending');
          if (pending) {
            setSelectedOrderId(String(pending.id));
          } else if (!selectedOrderId) {
            setSelectedOrderId(String(res.orders[0].id));
          }
        }
      }
    } catch {
      // Non-blocking
    } finally {
      setLoadingOrders(false);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    if (isAdmin && showTestBox) {
      loadRecentOrders();
    }
  }, [isAdmin, showTestBox, loadRecentOrders]);

  const handleSendTestApproval = async () => {
    const cleanDigits = testPhone.replace(/\D+/g, '');
    if (cleanDigits.length < 10) {
      toastError('Укажите корректный номер телефона (например, 87086984543)');
      return;
    }

    const currentOrder = recentOrders.find((o: any) => String(o.id) === String(selectedOrderId));
    const targetOrderId = currentOrder ? currentOrder.id : (Number(selectedOrderId) || 55);
    const targetDoc = currentOrder?.doc_number || `ORD-${targetOrderId}`;

    setIsSendingTest(true);
    setTestSuccessNotice(null);

    try {
      const res = await fetch('/api/erp?action=request_approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: targetOrderId,
          order_doc_number: targetDoc,
          client_name: currentOrder?.client_name || selectedClient?.name || 'Хоум Стар ИП (Казмарт)',
          client_phone: currentOrder?.client_phone || '87086984543',
          manager_phone: cleanDigits,
          total_amount: currentOrder?.total_amount || 87.56,
          total_sqm: currentOrder?.total_sqm || 6.9,
          items_count: currentOrder?.items_count || 1,
          reason: 'Проверка сквозной цепочки согласования (ERP / WMS ТСД)',
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        toastSuccess(`Запрос на согласование заказа №${targetDoc} отправлен в WhatsApp!`);
        setTestSuccessNotice(
          `Запрос по реальному заказу №${targetDoc} (ID: ${targetOrderId}) отправлен в WhatsApp на +${cleanDigits}. Нажмите «Одобрить» на телефоне — заказ перейдет в статус «На сборке WMS» (picking) и появится в ТСД.`
        );
      } else {
        toastError(data.error || 'Не удалось отправить согласование в WhatsApp');
      }
    } catch (err: any) {
      toastError(`Ошибка отправки: ${err?.message || 'сбой сети'}`);
    } finally {
      setIsSendingTest(false);
    }
  };

  // Debounced counterparty search
  useEffect(() => {
    if (!dropdownOpen || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetchCounterpartiesFromErp({ search: searchQuery.trim(), limit: 15 });
        if (active && res.success && Array.isArray(res.counterparties)) {
          setSearchResults(res.counterparties);
        }
      } catch {
        if (active) setSearchResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, dropdownOpen]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOrderObj = recentOrders.find((o: any) => String(o.id) === String(selectedOrderId));

  return (
    <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3.5 space-y-3 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
            Режим оформления
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-200/70 text-slate-600 border border-slate-300/40">
            Служебный
          </span>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowTestBox(v => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer border ${
              showTestBox
                ? 'bg-brand-700 text-white border-brand-700 shadow-2xs'
                : 'bg-white hover:bg-slate-100 text-brand-700 border-brand-300/80 shadow-2xs'
            }`}
            title="Проверить боевое согласование в WhatsApp"
          >
            <MessageSquare className="h-3.5 w-3.5 text-brand-600" />
            <span>Тест цепочки согласования</span>
          </button>
        )}
      </div>

      {/* Панель боевого тестирования WhatsApp согласования для администратора */}
      {isAdmin && showTestBox && (
        <div className="rounded-lg bg-white border border-brand-200 p-3 text-xs space-y-2.5 shadow-xs animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-slate-900">
              <Send className="h-3.5 w-3.5 text-brand-600" />
              <span>Сквозная проверка WhatsApp-согласования (ERP / WMS ТСД)</span>
            </div>
            <button
              type="button"
              onClick={() => setShowTestBox(false)}
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="text-[11px] text-slate-600 leading-tight">
            Выберите <strong>реальный заказ из 1С:ERP</strong> для отправки боевого запроса на телефон. При одобрении статус в 1С изменится на <em>«На сборке WMS» (picking)</em> и заказ поступит в ТСД склада. При отклонении — бронь аннулируется.
          </p>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <label className="font-semibold text-slate-700">Заказ в базе 1С:ERP:</label>
              <button
                type="button"
                onClick={loadRecentOrders}
                disabled={loadingOrders}
                className="text-brand-600 hover:text-brand-800 flex items-center gap-1 font-medium cursor-pointer"
              >
                <RotateCw className={`h-3 w-3 ${loadingOrders ? 'animate-spin' : ''}`} />
                <span>Обновить статус из ERP</span>
              </button>
            </div>

            <select
              value={selectedOrderId}
              onChange={e => setSelectedOrderId(e.target.value)}
              className="input-field text-xs h-8 py-1 px-2 bg-slate-50 w-full border-slate-200 focus:border-brand-500 font-mono"
            >
              {recentOrders.map(o => (
                <option key={o.id} value={o.id}>
                  Заказ №{o.doc_number || o.id} (ID: {o.id}) — ${Number(o.total_amount || 0).toFixed(2)} — статус: [{o.status_code || o.status}]
                </option>
              ))}
              {recentOrders.length === 0 && (
                <option value="55">Заказ №ORD-WEB-20261003-DE0F (ID: 55)</option>
              )}
            </select>

            {selectedOrderObj && (
              <div className="text-[11px] text-slate-600 pt-0.5 flex items-center justify-between">
                <span>Текущий статус в ERP: <strong className="text-slate-900">{selectedOrderObj.status} ({selectedOrderObj.status_code})</strong></span>
                <span>Клиент: {selectedOrderObj.client_name}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="tel"
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="87086984543"
              className="input-field text-xs h-8 py-1 px-2.5 bg-slate-50 w-full border-slate-200 focus:border-brand-500 focus:bg-white"
            />
            <button
              type="button"
              onClick={handleSendTestApproval}
              disabled={isSendingTest || loadingOrders}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
            >
              {isSendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span>{isSendingTest ? 'Отправка...' : 'Отправить в WhatsApp'}</span>
            </button>
          </div>

          {testSuccessNotice && (
            <div className="flex items-start gap-1.5 p-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] leading-tight">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>{testSuccessNotice}</span>
            </div>
          )}
        </div>
      )}

      {/* Переключатель режимов */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-white rounded-lg border border-slate-200 text-xs shadow-2xs">
        <button
          type="button"
          onClick={() => {
            setCheckoutMode('manager_self');
            onSelectClient(null);
          }}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-semibold transition-all cursor-pointer ${
            checkoutMode === 'manager_self'
              ? 'bg-brand-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <UserCheck className="h-3.5 w-3.5" />
          <span>На себя (Бронь менеджера)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCheckoutMode('dealer_client');
            setDropdownOpen(true);
          }}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-semibold transition-all cursor-pointer ${
            checkoutMode === 'dealer_client'
              ? 'bg-brand-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>На клиента (Дилера)</span>
        </button>
      </div>

      {/* Описание и выбор в зависимости от режима */}
      {checkoutMode === 'manager_self' ? (
        <div className="rounded-lg bg-emerald-50/70 border border-emerald-200/80 px-3 py-2.5 text-[11px] text-emerald-950 flex items-start gap-2.5">
          <UserCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="leading-tight">
            <strong className="text-slate-900 font-bold">Служебный заказ под учетной записью {managerName || 'менеджера'}.</strong>
            <p className="mt-0.5 text-slate-600">
              Товары будут зарезервированы на складе без привязки к лимитам дилеров. В 1C:ERP оператор или менеджер сможет перебросить заказ на нужного контрагента перед отгрузкой.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2" ref={dropdownRef}>
          {selectedClient ? (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-brand-300 shadow-2xs">
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-slate-900 truncate">{selectedClient.name}</span>
                  {selectedClient.city && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-brand-50 text-brand-700 border border-brand-200/60 font-semibold">
                      {selectedClient.city}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                  <span>ID: {selectedClient.id}</span>
                  {selectedClient.phone && <span>тел: {selectedClient.phone}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onSelectClient(null);
                  setSearchQuery('');
                  setDropdownOpen(true);
                }}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                title="Сменить клиента"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  placeholder="Начните вводить название, БИН или телефон клиента..."
                  className="input-field text-xs h-9 py-1 pl-8 pr-7 bg-white w-full border-slate-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-3 pointer-events-none" />
                {searching ? (
                  <Loader2 className="h-3.5 w-3.5 text-brand-600 animate-spin absolute right-2.5 top-3" />
                ) : searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {dropdownOpen && (
                <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg bg-white border border-slate-200 shadow-lg divide-y divide-slate-100 text-xs">
                  {searching && (
                    <div className="p-3 text-center text-slate-400 flex items-center justify-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
                      <span>Поиск в базе ERP...</span>
                    </div>
                  )}

                  {!searching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
                    <div className="p-3 text-center text-slate-400">
                      Клиенты по запросу «{searchQuery}» не найдены
                    </div>
                  )}

                  {!searching && searchQuery.trim().length < 2 && (
                    <div className="p-2.5 text-center text-slate-400 text-[11px]">
                      Введите минимум 2 символа для поиска дилера
                    </div>
                  )}

                  {!searching &&
                    searchResults.map(cp => (
                      <button
                        key={cp.id}
                        type="button"
                        onClick={() => {
                          onSelectClient(cp);
                          setDropdownOpen(false);
                        }}
                        className="w-full text-left p-2.5 hover:bg-brand-50/70 transition-colors flex items-center justify-between cursor-pointer group"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-semibold text-slate-900 truncate">{cp.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                            <span>ID: {cp.id}</span>
                            {cp.city && <span>г. {cp.city}</span>}
                            {cp.phone && <span>тел: {cp.phone}</span>}
                          </div>
                        </div>
                        <Check className="h-4 w-4 text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ManagerOrderSelector;
