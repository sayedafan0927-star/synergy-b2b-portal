import { useState, useEffect, useRef } from 'react';
import { UserCheck, Building2, Search, X, Loader2, Check } from 'lucide-react';
import { fetchCounterpartiesFromErp, type Counterparty } from '@/lib/erpApi';

interface ManagerOrderSelectorProps {
  checkoutMode: 'manager_self' | 'dealer_client';
  setCheckoutMode: (mode: 'manager_self' | 'dealer_client') => void;
  selectedClient: Counterparty | null;
  onSelectClient: (client: Counterparty | null) => void;
  managerName?: string;
}

export function ManagerOrderSelector({
  checkoutMode,
  setCheckoutMode,
  selectedClient,
  onSelectClient,
  managerName,
}: ManagerOrderSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Counterparty[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-900">
          Режим оформления (Менеджер / Администратор)
        </span>
      </div>

      {/* Переключатель режимов */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-white rounded-lg border border-indigo-200/80 text-xs">
        <button
          type="button"
          onClick={() => {
            setCheckoutMode('manager_self');
            onSelectClient(null);
          }}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-semibold transition-all cursor-pointer ${
            checkoutMode === 'manager_self'
              ? 'bg-indigo-600 text-white shadow-2xs'
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
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>На клиента (Дилера)</span>
        </button>
      </div>

      {/* Описание и выбор в зависимости от режима */}
      {checkoutMode === 'manager_self' ? (
        <div className="rounded-lg bg-indigo-100/60 border border-indigo-200/60 px-3 py-2 text-[11px] text-indigo-950 flex items-start gap-2">
          <UserCheck className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
          <div className="leading-tight">
            <strong>Служебный заказ под учетной записью {managerName || 'менеджера'}.</strong>
            <p className="mt-0.5 text-indigo-800">
              Товары будут зарезервированы без привязки к долгам дилеров. В 1C:ERP оператор или менеджер сможет перебросить заказ на нужного контрагента.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2" ref={dropdownRef}>
          {selectedClient ? (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-indigo-300 shadow-2xs">
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-slate-900 truncate">{selectedClient.name}</span>
                  {selectedClient.city && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600 font-medium">
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
                  className="input-field text-xs h-9 py-1 pl-8 pr-7 bg-white w-full border-indigo-200 focus:border-indigo-500"
                />
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-3 pointer-events-none" />
                {searching ? (
                  <Loader2 className="h-3.5 w-3.5 text-indigo-600 animate-spin absolute right-2.5 top-3" />
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
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
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
                        className="w-full text-left p-2.5 hover:bg-indigo-50/70 transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-semibold text-slate-900 truncate">{cp.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                            <span>ID: {cp.id}</span>
                            {cp.city && <span>г. {cp.city}</span>}
                            {cp.phone && <span>тел: {cp.phone}</span>}
                          </div>
                        </div>
                        <Check className="h-4 w-4 text-indigo-600 opacity-0 group-hover:opacity-100" />
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
