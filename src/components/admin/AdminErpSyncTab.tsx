import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  Send,
  CheckCircle2,
  X,
  Activity,
  Clock,
  Server,
  AlertTriangle,
  Boxes,
  Building2,
  Users,
  FileJson,
  Check,
  Copy,
  Power,
  Search,
  Eye,
} from 'lucide-react';
import {
  syncAllErpData,
  type ErpSyncReport,
  ERP_API_URL,
  updateClientAccessInErp,
  broadcastClientDeactivated,
  isCounterpartyArchivedOrMailing,
  erpFetch,
  getAuthHeaders,
} from '@/lib/erpApi';
import { triggerCatalogReload } from '@/hooks/useProductData';

export interface AdminErpSyncTabProps {
  isAdmin?: boolean;
}

export function AdminErpSyncTab({ isAdmin = true }: AdminErpSyncTabProps) {
  const [report, setReport] = useState<ErpSyncReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'catalog' | 'counterparties' | 'managers' | 'logs' | 'dlq' | 'raw'>('catalog');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logFilterStatus, setLogFilterStatus] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  // T-14: Управление очередью недоставленных заказов DLQ
  const [dlqOrders, setDlqOrders] = useState<any[]>([]);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [dlqRetryingId, setDlqRetryingId] = useState<string | null>(null);
  const [dlqMessage, setDlqMessage] = useState<string | null>(null);

  const fetchDlqOrders = async () => {
    if (!isAdmin) return;
    setDlqLoading(true);
    try {
      const res = await erpFetch('dlq_orders');
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.orders)) {
          setDlqOrders(data.orders);
        }
      }
    } catch (e) {
      console.warn('[DLQ] Failed to fetch DLQ orders:', e);
    } finally {
      setDlqLoading(false);
    }
  };

  const handleRetryDlqOrder = async (orderId: string) => {
    setDlqRetryingId(orderId);
    setDlqMessage(null);
    try {
      const res = await erpFetch('retry_dlq_order', {
        method: 'POST',
        body: { order_id: orderId },
      });
      const data = await res.json();
      if (data.success) {
        setDlqMessage(data.message || 'Заказ успешно возвращен в очередь Outbox');
        fetchDlqOrders();
      } else {
        setDlqMessage(data.error || 'Ошибка повторной отправки');
      }
    } catch {
      setDlqMessage('Сбой обращения к серверу при попытке повтора');
    } finally {
      setDlqRetryingId(null);
    }
  };

  const fetchAuditLogs = async () => {
    setLogsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/audit/logs?limit=100', { headers });
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        setAuditLogs(data.logs);
      }
    } catch (e) {
      console.warn('[AdminErpSync] Failed to fetch audit logs:', e);
    } finally {
      setLogsLoading(false);
    }
  };

  const [outboxLoading, setOutboxLoading] = useState(false);
  const [outboxMessage, setOutboxMessage] = useState<string | null>(null);

  const runOutboxSync = async () => {
    setOutboxLoading(true);
    setOutboxMessage(null);
    try {
      const res = await fetch('/api/outbox/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setOutboxMessage(data.total_pending === 0 ? 'Буфер Outbox пуст: все заказы синхронизированы с ERP' : `Успешно выгружено ${data.succeeded} из ${data.total_pending} заказов в ERP`);
        if (data.succeeded > 0) fetchAuditLogs();
      } else {
        setOutboxMessage(data.error || 'Ошибка синхронизации буфера');
      }
    } catch {
      setOutboxMessage('Сбой обращения к сервису Outbox Worker');
    } finally {
      setOutboxLoading(false);
      setTimeout(() => setOutboxMessage(null), 6000);
    }
  };

  const runSync = async () => {
    setLoading(true);
    setError(null);
    try {
      const rep = await syncAllErpData();
      setReport(rep);
      triggerCatalogReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка синхронизации');
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    runSync();
  }, []);

  const handleCopyJson = () => {
    if (!report) return;
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const products = report?.catalog?.products || [];
  const counterparties: any[] = report?.counterparties?.counterparties || [];
  const managers = report?.regionalManagers?.managers || [];

  const [cpFilter, setCpFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [cpSearch, setCpSearch] = useState('');
  const [cpTogglingId, setCpTogglingId] = useState<number | string | null>(null);
  const [cpBatchLoading, setCpBatchLoading] = useState(false);
  const [cpBatchMessage, setCpBatchMessage] = useState<string | null>(null);

  const cpActiveCount = useMemo(() => counterparties.filter((c: any) => c.is_acting_client).length, [counterparties]);
  const cpArchivedCount = useMemo(() => counterparties.filter((c: any) => c.is_archived_or_mailing).length, [counterparties]);

  const filteredCounterparties = useMemo(() => {
    let list = [...counterparties];
    if (cpFilter === 'active') {
      list = list.filter((c: any) => c.is_acting_client);
    } else if (cpFilter === 'archived') {
      list = list.filter((c: any) => c.is_archived_or_mailing);
    }

    if (cpSearch.trim()) {
      const q = cpSearch.toLowerCase().trim();
      list = list.filter((c: any) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        String(c.id).includes(q) ||
        (c.regional_manager?.name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [counterparties, cpFilter, cpSearch]);

  const handleToggleCounterpartyAccess = async (cp: any) => {
    setCpTogglingId(cp.id);
    const currentlyEnabled = cp.portal_access_enabled !== false && cp.status !== 'inactive';
    const newStatus = !currentlyEnabled;
    try {
      await updateClientAccessInErp(cp.id, newStatus ? 1 : 0);
      if (!newStatus) {
        broadcastClientDeactivated(cp.id);
      }
      setReport(prev => {
        if (!prev?.counterparties?.counterparties) return prev;
        const updatedList = prev.counterparties.counterparties.map((item: any) => {
          if (item.id === cp.id) {
            const isArch = !newStatus ? true : isCounterpartyArchivedOrMailing({ ...item, status: 'active', portal_access_enabled: true });
            return {
              ...item,
              portal_access_enabled: newStatus,
              status: newStatus ? 'active' : 'inactive',
              is_archived_or_mailing: isArch,
              is_acting_client: newStatus && !isArch,
            };
          }
          return item;
        });
        return {
          ...prev,
          counterparties: {
            ...prev.counterparties,
            counterparties: updatedList,
          },
        };
      });
    } catch (err: any) {
      alert(`Ошибка обновления доступа контрагента в ERP: ${err.message}`);
    } finally {
      setCpTogglingId(null);
    }
  };

  const handleBatchDeactivateArchived = async () => {
    const targets = counterparties.filter((c: any) => c.is_archived_or_mailing && c.status !== 'inactive' && c.portal_access_enabled !== false);
    if (targets.length === 0) {
      alert('Все архивные и рассылочные контакты уже деактивированы в ERP.');
      return;
    }
    if (!confirm(`Вы действительно хотите деактивировать доступ в ERP для ${targets.length} недействующих / рассылочных контактов?`)) {
      return;
    }

    setCpBatchLoading(true);
    setCpBatchMessage(null);
    let successCount = 0;
    try {
      for (const item of targets) {
        try {
          await updateClientAccessInErp(item.id, 0);
          broadcastClientDeactivated(item.id);
          successCount++;
        } catch (e) {
          console.warn(`[BatchDeactivate] Failed for client ${item.id}:`, e);
        }
      }
      setCpBatchMessage(`Успешно деактивировано ${successCount} из ${targets.length} недействующих контактов в ERP!`);
      runSync();
    } catch {
      setCpBatchMessage('Сбой при пакетной деактивации контактов в ERP');
    } finally {
      setCpBatchLoading(false);
      setTimeout(() => setCpBatchMessage(null), 8000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Force Sync button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Обмен данными с ERP</h2>
            <p className="text-xs text-slate-500">Диагностика шлюза, остатки, Outbox буфер и аудит</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runOutboxSync}
            disabled={outboxLoading}
            className="btn-secondary flex items-center justify-center gap-1.5 text-xs py-2 px-3 shadow-xs border border-slate-200 cursor-pointer"
            title="Принудительно отправить буферизованные заказы в ERP"
          >
            <Send className={`h-3.5 w-3.5 ${outboxLoading ? 'animate-spin' : ''}`} />
            {outboxLoading ? 'Выгрузка...' : 'Сброс буфера Outbox'}
          </button>

          <button
            onClick={runSync}
            disabled={loading}
            className="btn-primary flex items-center justify-center gap-2 text-xs py-2 px-4 shadow-sm cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Синхронизация...' : 'Принудительно обновить'}
          </button>
        </div>
      </div>

      {outboxMessage && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/90 p-3 flex items-center justify-between text-xs text-blue-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
            <span>{outboxMessage}</span>
          </div>
          <button onClick={() => setOutboxMessage(null)} className="text-blue-500 hover:text-blue-700 cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Gateway Health & Status Banner */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4 flex items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${report?.ping?.success ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Статус шлюза</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`inline-block h-2 w-2 rounded-full ${report?.ping?.success ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <p className="text-xs font-bold text-slate-800">
                {report?.ping?.success ? 'В сети (Online)' : error ? 'Ошибка связи' : 'Проверка...'}
              </p>
            </div>
            {report?.ping?.latencyMs !== undefined && (
              <p className="text-[10px] text-slate-400 mt-0.5">Задержка: {report.ping.latencyMs} мс</p>
            )}
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Время на ERP</p>
            <p className="text-xs font-bold text-slate-800 truncate mt-0.5">
              {report?.ping?.server_time || '—'}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Версия API: {report?.ping?.version || '1.0.0'}</p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Последний обмен</p>
            <p className="text-xs font-bold text-slate-800 mt-0.5">
              {report?.timestamp ? `${report.timestamp}` : '—'}
            </p>
            <p className="text-[10px] text-emerald-600 mt-0.5 font-medium">Кэш каталога обновлён</p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-purple-600">
            <Server className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Адрес шлюза</p>
            <p className="text-[11px] font-mono font-medium text-slate-700 truncate mt-0.5" title={ERP_API_URL}>
              kilem-khan.kz/.../api_portal
            </p>
            <span className="badge bg-purple-50 text-purple-700 text-[9px] mt-0.5">X-Portal-Key активен</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-red-800">Ошибка обмена с сервером ERP</h4>
            <p className="text-xs text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Товары (ERP)</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.totalProducts} поз.</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">В наличии</p>
            <p className="text-lg font-bold text-emerald-600 mt-0.5">{report.totalStockPcs} шт.</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Склады в ERP</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.cities.length}</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Контрагенты</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.totalCounterparties}</p>
          </div>
          <div className="card px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400">Менеджеры</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{report.totalManagers}</p>
          </div>
        </div>
      )}

      {report && report.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h4 className="text-xs font-bold text-amber-900">Замечания по данным ({report.warnings.length}):</h4>
          </div>
          <ul className="space-y-1 text-xs text-amber-800 list-disc list-inside">
            {report.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-b border-slate-200 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('catalog')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'catalog'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Boxes className="h-3.5 w-3.5" />
            Каталог и остатки ({products.length})
          </button>
          <button
            onClick={() => setActiveSubTab('counterparties')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'counterparties'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            Контрагенты ({cpActiveCount} акт. / {counterparties.length})
          </button>
          <button
            onClick={() => setActiveSubTab('managers')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'managers'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Менеджеры ({managers.length})
          </button>
          <button
            onClick={() => setActiveSubTab('raw')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'raw'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileJson className="h-3.5 w-3.5" />
            Сырой JSON
          </button>
          <button
            onClick={() => {
              setActiveSubTab('logs');
              if (auditLogs.length === 0) fetchAuditLogs();
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'logs'
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            Журнал аудита / Telemetry {auditLogs.length > 0 ? `(${auditLogs.length})` : ''}
          </button>
          <button
            onClick={() => {
              setActiveSubTab('dlq');
              fetchDlqOrders();
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'dlq'
                ? 'border-red-600 text-red-700 bg-red-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            Очередь сбоев DLQ {dlqOrders.length > 0 ? `(${dlqOrders.length})` : ''}
          </button>
        </div>

        {activeSubTab === 'raw' && (
          <button
            onClick={handleCopyJson}
            className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium px-2 py-1 rounded bg-brand-50 cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Скопировано!' : 'Копировать JSON'}
          </button>
        )}

        {activeSubTab === 'logs' && (
          <button
            onClick={fetchAuditLogs}
            disabled={logsLoading}
            className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium px-2 py-1 rounded bg-brand-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
            {logsLoading ? 'Загрузка...' : 'Обновить журнал'}
          </button>
        )}
      </div>

      {initialLoading ? (
        <div className="py-16 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-brand-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">Опрос шлюза Synergy ERP...</p>
        </div>
      ) : (
        <div>
          {activeSubTab === 'catalog' && (
            <div className="space-y-3">
              {products.map((p: any) => {
                const totalStock = (p.variants || []).reduce((acc: number, v: any) => {
                  return acc + (v.warehouses || []).reduce((s: number, w: any) => s + (w.stock || 0), 0);
                }, 0);

                return (
                  <div key={p.id} className="card p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="badge font-mono text-[10px]">ID {p.id}</span>
                        <h4 className="text-sm font-bold text-slate-900">{p.name}</h4>
                        <span className="badge bg-slate-100 text-slate-600 text-[10px]">{p.collection}</span>
                        <span className="text-xs text-slate-400">({p.manufacturer})</span>
                      </div>
                      <span className={`badge ${totalStock > 0 ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'bg-slate-100 text-slate-400'}`}>
                        Остаток: {totalStock} шт.
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 font-semibold">
                            <th className="py-1.5 px-3 text-left">Размер</th>
                            <th className="py-1.5 px-3 text-left">SKU</th>
                            <th className="py-1.5 px-3 text-left">Базовая цена</th>
                            <th className="py-1.5 px-3 text-left">Склады с наличием</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(p.variants || []).map((v: any) => {
                            const inStockWh = (v.warehouses || []).filter((w: any) => (w.stock || 0) > 0);
                            const vStock = inStockWh.reduce((s: number, w: any) => s + w.stock, 0);

                            return (
                              <tr key={v.sku} className="hover:bg-slate-25">
                                <td className="py-1.5 px-3 font-semibold text-slate-800">{v.size}</td>
                                <td className="py-1.5 px-3 font-mono text-slate-500">{v.sku}</td>
                                <td className="py-1.5 px-3 text-slate-700">${v.base_price}</td>
                                <td className="py-1.5 px-3">
                                  {vStock > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {inStockWh.map((w: any) => (
                                        <span key={w.city} className="badge bg-emerald-50 text-emerald-700 text-[10px]">
                                          {w.city}: {w.stock} шт.
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-slate-300">Нет на складах</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
              {products.length === 0 && (
                <p className="py-8 text-center text-xs text-slate-400">Товары в ERP не найдены</p>
              )}
            </div>
          )}

          {activeSubTab === 'counterparties' && (
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
          )}

          {activeSubTab === 'managers' && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {managers.map((m: any) => (
                <div key={m.id} className="card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="badge font-mono text-[10px]">ID {m.id}</span>
                    <span className={`badge ${m.role === 'admin' ? 'bg-red-50 text-red-700' : m.role === 'rm' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {m.role_title}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{m.name}</h4>
                  <p className="text-xs text-slate-500 font-mono">Тел: {m.phone || 'Не указан'}</p>
                </div>
              ))}
            </div>
          )}

          {activeSubTab === 'raw' && (
            <div className="card p-4 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto max-h-[500px]">
              <pre className="text-[11px] font-mono leading-relaxed">
                {JSON.stringify(report, null, 2)}
              </pre>
            </div>
          )}

          {activeSubTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex flex-1 items-center gap-2">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Поиск по событию, источнику или ошибке..."
                      value={logSearchQuery}
                      onChange={(e) => setLogSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <select
                    value={logFilterStatus}
                    onChange={(e) => setLogFilterStatus(e.target.value)}
                    className="py-1.5 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="all">Все статусы</option>
                    <option value="success">Только успешные (200)</option>
                    <option value="error">Только ошибки</option>
                    <option value="warning">Предупреждения</option>
                  </select>
                </div>
                <div className="text-[11px] text-slate-500">
                  Показано: {auditLogs.filter(l => (logFilterStatus === 'all' || l.status === logFilterStatus) && (!logSearchQuery.trim() || JSON.stringify(l).toLowerCase().includes(logSearchQuery.toLowerCase()))).length} записей
                </div>
              </div>

              {logsLoading && auditLogs.length === 0 ? (
                <div className="py-12 text-center">
                  <RefreshCw className="h-6 w-6 animate-spin text-brand-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">Загрузка журнала аудита...</p>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <th className="py-2.5 px-3 text-left">Время</th>
                          <th className="py-2.5 px-3 text-left">Событие</th>
                          <th className="py-2.5 px-3 text-left">Направление / Источник</th>
                          <th className="py-2.5 px-3 text-left">Статус</th>
                          <th className="py-2.5 px-3 text-left">Задержка</th>
                          <th className="py-2.5 px-3 text-right">Данные</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {auditLogs
                          .filter(l => (logFilterStatus === 'all' || l.status === logFilterStatus) && (!logSearchQuery.trim() || JSON.stringify(l).toLowerCase().includes(logSearchQuery.toLowerCase())))
                          .map((log: any) => {
                            const date = log.created_at ? new Date(log.created_at) : null;
                            const timeStr = date ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
                            const dateStr = date ? date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';

                            return (
                              <tr key={log.id || Math.random()} className="hover:bg-slate-25">
                                <td className="py-2 px-3 whitespace-nowrap">
                                  <span className="font-mono text-slate-700 block">{timeStr}</span>
                                  <span className="text-[10px] text-slate-400 block">{dateStr}</span>
                                </td>
                                <td className="py-2 px-3">
                                  <span className="font-semibold text-slate-900 block font-mono text-[11px]">{log.event_type}</span>
                                  {(log.payload?.correlation_id || log.correlation_id) && (
                                    <span className="font-mono text-[9px] text-brand-600 block truncate max-w-[140px]" title={log.payload?.correlation_id || log.correlation_id}>
                                      🔗 {log.payload?.correlation_id || log.correlation_id}
                                    </span>
                                  )}
                                  {log.error_message && (
                                    <span className="text-[10px] text-red-600 line-clamp-1 mt-0.5">{log.error_message}</span>
                                  )}
                                </td>
                                <td className="py-2 px-3">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`badge text-[9px] uppercase ${log.direction === 'inbound' ? 'bg-sky-50 text-sky-700' : 'bg-indigo-50 text-indigo-700'}`}>
                                      {log.direction === 'inbound' ? 'Входящий' : 'Исходящий'}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500">{log.source || 'api'}</span>
                                  </div>
                                </td>
                                <td className="py-2 px-3">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`inline-block h-2 w-2 rounded-full ${
                                      log.status === 'success' ? 'bg-emerald-500' : log.status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
                                    }`} />
                                    <span className={`badge text-[10px] ${
                                      log.status === 'success' ? 'bg-emerald-50 text-emerald-700' : log.status === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                                    }`}>
                                      {log.status === 'success' ? 'Успех' : log.status === 'warning' ? 'Предупреждение' : 'Ошибка'}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-500">
                                  {log.latency_ms ? `${log.latency_ms} мс` : '—'}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <button
                                    onClick={() => setSelectedLog(log)}
                                    className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-800 font-medium px-2 py-1 rounded hover:bg-brand-50 cursor-pointer"
                                  >
                                    <Eye className="h-3 w-3" />
                                    Инспектор
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                    {auditLogs.length === 0 && (
                      <div className="py-12 text-center text-xs text-slate-400">
                        Журнал интеграции пока пуст. Записи появятся при оформлении заказов, вебхуках и запросах к ERP.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* T-14: Панель Dead Letter Queue (DLQ) */}
              {activeSubTab === 'dlq' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-red-50/60 border border-red-200/80 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-red-900">
                          Очередь сбоев Dead Letter Queue (DLQ)
                        </div>
                        <div className="text-[11px] text-red-700">
                          Заказы, исчерпавшие 5 автоматических попыток отправки в ERP из-за тайм-аута или сетевого сбоя
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={fetchDlqOrders}
                      disabled={dlqLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-red-700 border border-red-300 rounded-lg hover:bg-red-50 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${dlqLoading ? 'animate-spin' : ''}`} />
                      Обновить
                    </button>
                  </div>

                  {dlqMessage && (
                    <div className="p-3 bg-slate-900 text-white rounded-lg text-xs flex items-center justify-between shadow-md">
                      <span>{dlqMessage}</span>
                      <button onClick={() => setDlqMessage(null)} className="text-slate-400 hover:text-white cursor-pointer">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="py-2.5 px-3">Номер заказа</th>
                            <th className="py-2.5 px-3">Склад</th>
                            <th className="py-2.5 px-3">Сумма</th>
                            <th className="py-2.5 px-3">Попыток</th>
                            <th className="py-2.5 px-3">Причина сбоя / Ошибка</th>
                            <th className="py-2.5 px-3">Время сбоя</th>
                            <th className="py-2.5 px-3 text-right">Действие</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dlqOrders.map((ord: any) => (
                            <tr key={ord.id} className="hover:bg-red-50/20 transition-colors">
                              <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                                {ord.order_number}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {ord.warehouse || 'Основной Склад Астана'}
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                ${Number(ord.total_amount || 0).toLocaleString('ru-RU')}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                                  {ord.retry_count || 5} попыток
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-red-700 max-w-xs truncate" title={ord.notes || ord.last_error}>
                                {ord.notes || ord.last_error || 'Timeout / Connection Refused'}
                              </td>
                              <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                                {ord.updated_at ? new Date(ord.updated_at).toLocaleString('ru-RU') : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  onClick={() => handleRetryDlqOrder(ord.id)}
                                  disabled={dlqRetryingId === ord.id}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
                                >
                                  <RefreshCw className={`h-3 w-3 ${dlqRetryingId === ord.id ? 'animate-spin' : ''}`} />
                                  Повторить
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {dlqOrders.length === 0 && !dlqLoading && (
                        <div className="py-12 text-center text-xs text-slate-400">
                          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                          В очереди DLQ нет сбойных заказов. Все операции синхронизированы в штатном режиме.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Payload Inspector Modal */}
              {selectedLog && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <Activity className="h-4 w-4 text-brand-600" />
                          Аудит события: <span className="font-mono text-brand-700">{selectedLog.event_type}</span>
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          ID: {selectedLog.id} • {selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('ru-RU') : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedLog(null)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="p-4 overflow-y-auto space-y-4">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className={`badge ${selectedLog.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          Статус: {selectedLog.status}
                        </span>
                        <span className="badge bg-slate-100 text-slate-700">
                          Направление: {selectedLog.direction}
                        </span>
                        <span className="badge bg-slate-100 text-slate-700">
                          Источник: {selectedLog.source}
                        </span>
                        {selectedLog.latency_ms && (
                          <span className="badge bg-purple-50 text-purple-700">
                            Задержка: {selectedLog.latency_ms} мс
                          </span>
                        )}
                      </div>

                      {(selectedLog.payload?.correlation_id || selectedLog.correlation_id) && (
                        <div className="p-2.5 rounded-xl bg-blue-50/80 border border-blue-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div>
                            <span className="text-[10px] text-blue-600 uppercase font-bold block">Distributed Correlation-ID (Сквозной трейс):</span>
                            <span className="font-mono font-semibold text-blue-900">{selectedLog.payload?.correlation_id || selectedLog.correlation_id}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const trc = selectedLog.payload?.correlation_id || selectedLog.correlation_id;
                              setLogSearchQuery(trc);
                              setSelectedLog(null);
                            }}
                            className="text-[11px] font-semibold text-blue-700 bg-white border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer shadow-2xs"
                          >
                            🔗 Найти цепочку транзакции
                          </button>
                        </div>
                      )}

                      {selectedLog.error_message && (
                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                          <p className="font-bold text-red-800 mb-0.5">Сообщение об ошибке:</p>
                          {selectedLog.error_message}
                        </div>
                      )}

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-slate-700">Payload / Тело пакета:</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(selectedLog.payload, null, 2));
                            }}
                            className="text-[11px] text-brand-600 hover:text-brand-800 flex items-center gap-1 font-medium cursor-pointer"
                          >
                            <Copy className="h-3 w-3" />
                            Копировать
                          </button>
                        </div>
                        <div className="bg-slate-900 text-slate-100 rounded-xl p-3 overflow-x-auto max-h-[300px]">
                          <pre className="text-[11px] font-mono leading-relaxed">
                            {JSON.stringify(selectedLog.payload, null, 2) || '(Тело пакета отсутствует)'}
                          </pre>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 border-t border-slate-100 bg-slate-50 flex justify-end">
                      <button
                        onClick={() => setSelectedLog(null)}
                        className="btn-secondary text-xs py-1.5 px-4 cursor-pointer"
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminErpSyncTab;
