import { useState, useEffect } from 'react';
import {
  Boxes,
  Database,
  Building2,
  Users,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Server,
  Activity,
  FileJson,
} from 'lucide-react';
import {
  syncAllErpData,
  type ErpSyncReport,
  ERP_API_URL,
  erpFetch,
  getAuthHeaders,
} from '@/lib/erpApi';
import { triggerCatalogReload } from '@/hooks/useProductData';
import {
  AdminCatalogSubTab,
  AdminCounterpartiesSubTab,
  AdminAuditLogsSubTab,
  AdminDlqSubTab,
} from './erp-sync';

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

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // DLQ state
  const [dlqOrders, setDlqOrders] = useState<any[]>([]);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [dlqRetryingId, setDlqRetryingId] = useState<string | null>(null);
  const [dlqMessage, setDlqMessage] = useState<string | null>(null);

  // Outbox state
  const [outboxLoading, setOutboxLoading] = useState(false);
  const [outboxMessage, setOutboxMessage] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Синхронизация с ERP</h2>
          <p className="text-xs text-slate-500">Управление интеграцией, очередью Outbox и телеметрией</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runOutboxSync}
            disabled={outboxLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${outboxLoading ? 'animate-spin text-brand-600' : ''}`} />
            Сброс буфера Outbox
          </button>
          <button
            onClick={runSync}
            disabled={loading}
            className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Синхронизация...' : 'Синхронизировать всё'}
          </button>
        </div>
      </div>

      {outboxMessage && (
        <div className="p-3 text-xs rounded-xl bg-slate-900 text-white flex items-center justify-between">
          <span>{outboxMessage}</span>
          <button onClick={() => setOutboxMessage(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-brand-50 text-brand-700">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Товаров в каталоге</p>
            <p className="text-lg font-bold text-slate-900">{products.length}</p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Контрагентов</p>
            <p className="text-lg font-bold text-slate-900">{counterparties.length}</p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-sky-50 text-sky-700">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Рег. менеджеров</p>
            <p className="text-lg font-bold text-slate-900">{managers.length}</p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Шлюз ERP</p>
            <p className="text-xs font-mono font-semibold text-slate-700 truncate max-w-[140px]" title={ERP_API_URL}>
              {ERP_API_URL.replace('https://', '')}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-4 bg-rose-50 border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Subtabs switcher */}
      <div className="flex border-b border-slate-200 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('catalog')}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeSubTab === 'catalog'
              ? 'border-brand-700 text-brand-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Boxes className="h-3.5 w-3.5" />
          Товары ({products.length})
        </button>

        <button
          onClick={() => setActiveSubTab('counterparties')}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeSubTab === 'counterparties'
              ? 'border-brand-700 text-brand-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Контрагенты ({counterparties.length})
        </button>

        <button
          onClick={() => setActiveSubTab('managers')}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeSubTab === 'managers'
              ? 'border-brand-700 text-brand-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          Менеджеры ({managers.length})
        </button>

        <button
          onClick={() => {
            setActiveSubTab('logs');
            if (auditLogs.length === 0) fetchAuditLogs();
          }}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeSubTab === 'logs'
              ? 'border-brand-700 text-brand-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          Журнал аудита {auditLogs.length > 0 ? `(${auditLogs.length})` : ''}
        </button>

        <button
          onClick={() => {
            setActiveSubTab('dlq');
            if (dlqOrders.length === 0) fetchDlqOrders();
          }}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeSubTab === 'dlq'
              ? 'border-brand-700 text-brand-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          Очередь DLQ {dlqOrders.length > 0 ? `(${dlqOrders.length})` : ''}
        </button>

        <button
          onClick={() => setActiveSubTab('raw')}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeSubTab === 'raw'
              ? 'border-brand-700 text-brand-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileJson className="h-3.5 w-3.5" />
          Сырой JSON
        </button>
      </div>

      {/* Subtab Contents */}
      {initialLoading ? (
        <div className="py-16 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-brand-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Загрузка данных из Synergy ERP...</p>
        </div>
      ) : (
        <div>
          {activeSubTab === 'catalog' && (
            <AdminCatalogSubTab products={products} />
          )}

          {activeSubTab === 'counterparties' && (
            <AdminCounterpartiesSubTab
              counterparties={counterparties}
              onRefreshCounterparties={runSync}
            />
          )}

          {activeSubTab === 'managers' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {managers.map((m: any) => (
                <div key={m.id || m.name} className="card p-4 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 font-bold flex items-center justify-center text-xs">
                      {m.name.charAt(0)}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">{m.name}</h4>
                      <p className="text-[11px] text-slate-400">{m.phone || 'Телефон не указан'}</p>
                    </div>
                  </div>
                  {m.city && (
                    <span className="badge bg-slate-100 text-slate-600 text-[10px]">{m.city}</span>
                  )}
                </div>
              ))}
              {managers.length === 0 && (
                <p className="py-8 text-center text-xs text-slate-400 col-span-3">Менеджеры в ERP не найдены</p>
              )}
            </div>
          )}

          {activeSubTab === 'logs' && (
            <AdminAuditLogsSubTab
              auditLogs={auditLogs}
              logsLoading={logsLoading}
              onRefresh={fetchAuditLogs}
            />
          )}

          {activeSubTab === 'dlq' && (
            <AdminDlqSubTab
              dlqOrders={dlqOrders}
              dlqLoading={dlqLoading}
              dlqRetryingId={dlqRetryingId}
              dlqMessage={dlqMessage}
              onRefresh={fetchDlqOrders}
              onRetryOrder={handleRetryDlqOrder}
              onClearMessage={() => setDlqMessage(null)}
            />
          )}

          {activeSubTab === 'raw' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={handleCopyJson}
                  className="btn-secondary text-xs flex items-center gap-1.5 py-1 px-3 cursor-pointer"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Скопировано!' : 'Копировать JSON'}
                </button>
              </div>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto max-h-[60vh]">
                {JSON.stringify(report, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminErpSyncTab;
