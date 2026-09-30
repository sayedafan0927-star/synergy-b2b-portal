import { useState, useMemo } from 'react';
import { Search, Power } from 'lucide-react';
import { updateClientAccessInErp, broadcastClientDeactivated, isCounterpartyArchivedOrMailing } from '@/lib/erpApi';

export interface AdminCounterpartiesSubTabProps {
  counterparties: any[];
  onRefreshCounterparties?: () => void;
}

export function AdminCounterpartiesSubTab({
  counterparties,
  onRefreshCounterparties,
}: AdminCounterpartiesSubTabProps) {
  const [cpFilter, setCpFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [cpSearch, setCpSearch] = useState('');
  const [cpTogglingId, setCpTogglingId] = useState<number | string | null>(null);
  const [cpBatchLoading, setCpBatchLoading] = useState(false);
  const [cpBatchMessage, setCpBatchMessage] = useState<string | null>(null);

  const cpActiveCount = useMemo(() => {
    return counterparties.filter(c => !isCounterpartyArchivedOrMailing(c) && c.portal_access_enabled !== false && c.status !== 'inactive').length;
  }, [counterparties]);

  const cpArchivedCount = useMemo(() => {
    return counterparties.filter(c => isCounterpartyArchivedOrMailing(c)).length;
  }, [counterparties]);

  const filteredCounterparties = useMemo(() => {
    let list = [...counterparties];
    if (cpFilter === 'active') {
      list = list.filter(c => !isCounterpartyArchivedOrMailing(c) && c.portal_access_enabled !== false && c.status !== 'inactive');
    } else if (cpFilter === 'archived') {
      list = list.filter(c => isCounterpartyArchivedOrMailing(c));
    }
    if (cpSearch.trim()) {
      const q = cpSearch.toLowerCase().trim();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        String(c.id).includes(q)
      );
    }
    return list;
  }, [counterparties, cpFilter, cpSearch]);

  const handleToggleCounterpartyAccess = async (counterparty: any) => {
    const isCurrentlyDeactivated = counterparty.portal_access_enabled === false || counterparty.status === 'inactive' || counterparty.is_active === 0;
    const newStatus = isCurrentlyDeactivated ? 1 : 0;
    setCpTogglingId(counterparty.id);

    try {
      const res = await updateClientAccessInErp(counterparty.id, newStatus);
      if (res.success) {
        counterparty.portal_access_enabled = Boolean(newStatus);
        counterparty.status = newStatus ? 'active' : 'inactive';
        counterparty.is_active = newStatus;
        if (!newStatus) {
          broadcastClientDeactivated(counterparty.id);
        }
        onRefreshCounterparties?.();
      } else {
        alert('Ошибка обновления статуса в ERP: ' + ((res as any)?.error || 'неизвестная ошибка'));
      }
    } catch (err: any) {
      alert('Сбой сети при запросе к ERP: ' + (err.message || ''));
    } finally {
      setCpTogglingId(null);
    }
  };

  const handleBatchDeactivateArchived = async () => {
    const archivedToDeactivate = counterparties.filter(
      c => isCounterpartyArchivedOrMailing(c) && (c.portal_access_enabled !== false && c.status !== 'inactive' && c.is_active !== 0)
    );

    if (archivedToDeactivate.length === 0) {
      setCpBatchMessage('Все архивные и рассылочные клиенты уже деактивированы в ERP.');
      return;
    }

    if (!confirm(`Вы действительно хотите деактивировать доступ в ERP для ${archivedToDeactivate.length} архивных/рассылочных контактов?`)) {
      return;
    }

    setCpBatchLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const c of archivedToDeactivate) {
      try {
        const res = await updateClientAccessInErp(c.id, 0);
        if (res.success) {
          c.portal_access_enabled = false;
          c.status = 'inactive';
          c.is_active = 0;
          broadcastClientDeactivated(c.id);
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setCpBatchLoading(false);
    setCpBatchMessage(`Успешно деактивировано в ERP: ${successCount} контактов. Ошибок: ${failCount}.`);
    onRefreshCounterparties?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setCpFilter('active')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              cpFilter === 'active'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ✅ Только действующие ({cpActiveCount})
          </button>
          <button
            type="button"
            onClick={() => setCpFilter('archived')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              cpFilter === 'archived'
                ? 'bg-white text-amber-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📦 Архив / Рассылка ({cpArchivedCount})
          </button>
          <button
            type="button"
            onClick={() => setCpFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              cpFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Все ({counterparties.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={cpSearch}
              onChange={e => setCpSearch(e.target.value)}
              placeholder="Поиск по имени, городу, тел..."
              className="input-field pl-9 py-1.5 text-xs w-full"
            />
          </div>

          <button
            type="button"
            onClick={handleBatchDeactivateArchived}
            disabled={cpBatchLoading || cpArchivedCount === 0}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            title="Отключить доступ в ERP для всех рассылочных и архивных контактов"
          >
            <Power className={`h-3.5 w-3.5 ${cpBatchLoading ? 'animate-spin' : ''}`} />
            {cpBatchLoading ? 'Деактивация...' : 'Деактивировать архив/рассылку в ERP'}
          </button>
        </div>
      </div>

      {cpBatchMessage && (
        <div className="p-3 text-xs rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center justify-between">
          <span>{cpBatchMessage}</span>
          <button onClick={() => setCpBatchMessage(null)} className="text-emerald-600 hover:text-emerald-800 text-xs cursor-pointer">✕</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-3 text-left">ID</th>
                <th className="py-2.5 px-3 text-left">Контрагент</th>
                <th className="py-2.5 px-3 text-left">Город</th>
                <th className="py-2.5 px-3 text-left">Телефон</th>
                <th className="py-2.5 px-3 text-left">Региональный менеджер (РМ)</th>
                <th className="py-2.5 px-3 text-left">Тип цены</th>
                <th className="py-2.5 px-3 text-center">Статус</th>
                <th className="py-2.5 px-3 text-right">Управление доступом</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCounterparties.map((c: any) => {
                const contract = (c.contracts || [])[0];
                const isDeactivated = c.portal_access_enabled === false || c.status === 'inactive' || c.is_active === 0;
                const isMailingOrArchived = c.is_archived_or_mailing;

                return (
                  <tr key={c.id} className="hover:bg-slate-25">
                    <td className="py-2 px-3 font-mono text-slate-400">#{c.id}</td>
                    <td className="py-2 px-3 font-semibold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <span>{c.name}</span>
                        {isMailingOrArchived && !isDeactivated && (
                          <span className="badge bg-amber-50 text-amber-700 text-[9px] px-1.5 py-0.5">Архив / Рассылка</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-slate-600">{c.city || '—'}</td>
                    <td className="py-2 px-3 text-slate-600 font-mono">{c.phone || '—'}</td>
                    <td className="py-2 px-3">
                      {c.regional_manager ? (
                        <div>
                          <span className="font-medium text-slate-800">{c.regional_manager.name}</span>
                          {c.regional_manager.phone && (
                            <span className="text-[10px] text-slate-400 block">{c.regional_manager.phone}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300">Не привязан</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className="badge bg-brand-50 text-brand-700 font-mono text-[10px]">
                        {contract?.price_type || c.price_type || 'standard'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      {isDeactivated ? (
                        <span className="badge bg-rose-50 text-rose-700 border border-rose-200 text-[10px]">
                          Деактивирован
                        </span>
                      ) : isMailingOrArchived ? (
                        <span className="badge bg-amber-50 text-amber-700 border border-amber-200 text-[10px]">
                          Рассылка
                        </span>
                      ) : (
                        <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px]">
                          Действующий
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleCounterpartyAccess(c)}
                        disabled={cpTogglingId === c.id}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                          !isDeactivated
                            ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                        }`}
                        title={!isDeactivated ? 'Отключить доступ клиенту в ERP' : 'Включить доступ клиенту в ERP'}
                      >
                        <Power className={`h-3 w-3 ${cpTogglingId === c.id ? 'animate-spin' : ''}`} />
                        {cpTogglingId === c.id ? '...' : (!isDeactivated ? 'Деактивировать' : 'Активировать')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredCounterparties.length === 0 && (
            <p className="py-8 text-center text-xs text-slate-400">
              {cpSearch ? 'Контрагенты не найдены по запросу' : 'Контрагенты в данной категории отсутствуют'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminCounterpartiesSubTab;
