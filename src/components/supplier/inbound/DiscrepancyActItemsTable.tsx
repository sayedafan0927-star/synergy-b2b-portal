import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DiscrepancyActItem } from '@/types';

export interface DiscrepancyActItemsTableProps {
  items: DiscrepancyActItem[];
}

export function DiscrepancyActItemsTable({ items }: DiscrepancyActItemsTableProps) {
  const getStatusBadge = (item: DiscrepancyActItem) => {
    switch (item.status) {
      case 'shortage':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
            <AlertTriangle className="h-3 w-3 text-amber-600" />
            Недостача
          </span>
        );
      case 'surplus':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 border border-blue-200">
            Излишек
          </span>
        );
      case 'unplanned':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800 border border-purple-200">
            Пересорт
          </span>
        );
      case 'matched':
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            Совпало
          </span>
        );
    }
  };

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-slate-500 border border-slate-200 rounded-xl bg-slate-50">
        По заданным параметрам фильтрации позиций не найдено
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
            <th className="py-2.5 px-3 w-10 text-center">№</th>
            <th className="py-2.5 px-3">Артикул / Наименование</th>
            <th className="py-2.5 px-3">Штрихкод</th>
            <th className="py-2.5 px-3 text-right">План</th>
            <th className="py-2.5 px-3 text-right">Факт</th>
            <th className="py-2.5 px-3 text-right">Дельта</th>
            <th className="py-2.5 px-3">Статус</th>
            <th className="py-2.5 px-3">Примечание</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item, idx) => {
            const isDiff = item.diff_qty !== 0;
            return (
              <tr
                key={idx}
                className={`hover:bg-slate-50/70 transition-colors ${
                  isDiff ? 'bg-amber-50/30' : ''
                }`}
              >
                <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                  {item.line_num || idx + 1}
                </td>
                <td className="py-2 px-3">
                  <p className="font-bold text-slate-900">{item.article}</p>
                  <p className="text-[11px] text-slate-500 line-clamp-1">{item.name}</p>
                </td>
                <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                  {item.barcode || '—'}
                </td>
                <td className="py-2 px-3 text-right font-medium text-slate-700">
                  {item.plan_qty} шт
                  {item.plan_sqm > 0 && (
                    <span className="block text-[10px] text-slate-400">
                      {item.plan_sqm.toFixed(1)} м²
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-right font-bold text-slate-900">
                  {item.fact_qty} шт
                  {item.fact_sqm > 0 && (
                    <span className="block text-[10px] text-slate-400 font-normal">
                      {item.fact_sqm.toFixed(1)} м²
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-right font-bold">
                  {item.diff_qty !== 0 ? (
                    <span className={item.diff_qty < 0 ? 'text-amber-800' : 'text-blue-800'}>
                      {item.diff_qty > 0 ? `+${item.diff_qty}` : item.diff_qty} шт
                      {item.diff_sqm !== 0 && (
                        <span className="block text-[10px] font-normal">
                          {item.diff_sqm > 0 ? `+${item.diff_sqm.toFixed(1)}` : item.diff_sqm.toFixed(1)} м²
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-emerald-700">0 шт</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  {getStatusBadge(item)}
                </td>
                <td className="py-2 px-3 text-slate-600 text-[11px]">
                  {item.reason || (item.cells && item.cells.length > 0 ? `Ячейки: ${item.cells.join(', ')}` : '—')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DiscrepancyActItemsTable;
