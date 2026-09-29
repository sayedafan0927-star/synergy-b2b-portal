import { AlertTriangle, RefreshCw, X, CheckCircle2 } from 'lucide-react';

export interface AdminDlqSubTabProps {
  dlqOrders: any[];
  dlqLoading: boolean;
  dlqRetryingId: string | null;
  dlqMessage: string | null;
  onRefresh: () => void;
  onRetryOrder: (id: string) => void;
  onClearMessage: () => void;
}

export function AdminDlqSubTab({
  dlqOrders,
  dlqLoading,
  dlqRetryingId,
  dlqMessage,
  onRefresh,
  onRetryOrder,
  onClearMessage,
}: AdminDlqSubTabProps) {
  return (
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
          onClick={onRefresh}
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
          <button onClick={onClearMessage} className="text-slate-400 hover:text-white cursor-pointer">
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
                      onClick={() => onRetryOrder(ord.id)}
                      disabled={dlqRetryingId === ord.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${dlqRetryingId === ord.id ? 'animate-spin' : ''}`} />
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
  );
}

export default AdminDlqSubTab;
