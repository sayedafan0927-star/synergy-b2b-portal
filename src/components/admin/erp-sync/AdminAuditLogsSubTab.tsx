import { useState } from 'react';
import { Search, RefreshCw, Eye, Activity, X } from 'lucide-react';

export interface AdminAuditLogsSubTabProps {
  auditLogs: any[];
  logsLoading: boolean;
  onRefresh: () => void;
}

export function AdminAuditLogsSubTab({
  auditLogs,
  logsLoading,
  onRefresh,
}: AdminAuditLogsSubTabProps) {
  const [logFilterStatus, setLogFilterStatus] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const filteredLogs = auditLogs.filter(l => {
    const matchStatus = logFilterStatus === 'all' || l.status === logFilterStatus;
    const matchQuery = !logSearchQuery.trim() || JSON.stringify(l).toLowerCase().includes(logSearchQuery.toLowerCase());
    return matchStatus && matchQuery;
  });

  return (
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
            className="py-1.5 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
          >
            <option value="all">Все статусы</option>
            <option value="success">Только успешные (200)</option>
            <option value="error">Только ошибки</option>
            <option value="warning">Предупреждения</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-slate-500">
            Показано: {filteredLogs.length} записей
          </div>
          <button
            onClick={onRefresh}
            disabled={logsLoading}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shadow-2xs cursor-pointer"
            title="Обновить журнал"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
          </button>
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
                {filteredLogs.map((log: any) => {
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

              {selectedLog.error_message && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-mono">
                  <strong>Ошибка:</strong> {selectedLog.error_message}
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">
                  Полезная нагрузка (Payload / Response):
                </h4>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60">
                  {JSON.stringify(selectedLog.payload || selectedLog.details || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="btn-secondary text-xs px-4 py-1.5 cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminAuditLogsSubTab;
