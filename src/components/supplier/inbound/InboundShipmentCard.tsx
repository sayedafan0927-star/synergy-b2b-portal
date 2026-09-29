import React from 'react';
import {
  FileText,
  Store,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import type { InboundShipment } from '@/types';

export interface InboundShipmentCardProps {
  shipment: InboundShipment;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function InboundShipmentCard({
  shipment,
  isExpanded,
  onToggleExpand,
}: InboundShipmentCardProps) {
  const hasDiscrepancy = shipment.has_discrepancy || shipment.reconciliation_status === 'discrepancy';
  const docTitle = shipment.incoming_doc_number && shipment.incoming_doc_number !== 'Не указан'
    ? shipment.incoming_doc_number
    : shipment.receipt_doc_number;

  return (
    <div
      className={`card overflow-hidden border transition-all ${
        hasDiscrepancy
          ? 'border-amber-300 bg-amber-50/20'
          : 'border-slate-200 bg-white'
      }`}
    >
      {/* Шапка накладной — кликабельна для раскрытия */}
      <div
        onClick={onToggleExpand}
        className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors select-none"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono font-bold text-slate-900 text-base flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-brand-600" />
              {docTitle}
            </span>
            {shipment.incoming_doc_date && (
              <span className="badge bg-slate-100 text-slate-700 text-xs">
                ТТН от {shipment.incoming_doc_date}
              </span>
            )}
            <span className="text-slate-300">•</span>
            <span className="font-mono text-xs text-slate-500">
              Акт ERP: {shipment.receipt_doc_number} ({shipment.receipt_date})
            </span>
            {shipment.supplier_name && (
              <span className="badge bg-slate-100 text-slate-600 text-xs">
                Фабрика: {shipment.supplier_name}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Store className="h-3.5 w-3.5 text-slate-400" />
            <span>Склад выгрузки: <strong>{shipment.warehouse_name}</strong> ({shipment.city})</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          {hasDiscrepancy ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-xs font-bold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
              С расхождениями ({shipment.discrepancy?.qty_pcs > 0 ? `+${shipment.discrepancy.qty_pcs}` : shipment.discrepancy?.qty_pcs} шт.)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 border border-emerald-300 px-3 py-1 text-xs font-bold text-emerald-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
              Принято полностью
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 flex items-center gap-1 px-2.5 py-1 rounded-lg border border-brand-200 bg-brand-50/50 cursor-pointer"
          >
            {isExpanded ? 'Скрыть детали' : 'Детализация'}
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {/* Показатели партии: Заявлено vs Факт vs Дельта */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 bg-white p-4 text-xs">
        <div className="p-3">
          <p className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-1">
            1. По накладной фабрики (Заявлено)
          </p>
          <p className="text-lg font-bold text-slate-900">
            {shipment.declared?.qty_pcs ?? 0}{' '}
            <span className="text-xs font-normal text-slate-500">шт.</span>
          </p>
          <p className="text-slate-500 mt-0.5">{(shipment.declared?.area_sqm ?? 0).toFixed(1)} м² продукции</p>
        </div>

        <div className="p-3">
          <p className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-1">
            2. Принято на склад (Факт ТСД)
          </p>
          <p className="text-lg font-bold text-emerald-800">
            {shipment.actual?.qty_pcs ?? 0}{' '}
            <span className="text-xs font-normal text-emerald-600">шт.</span>
          </p>
          <p className="text-slate-500 mt-0.5">{(shipment.actual?.area_sqm ?? 0).toFixed(1)} м² на балансе</p>
        </div>

        <div className="p-3">
          <p className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-1">
            3. Результат сверки (Дельта)
          </p>
          {hasDiscrepancy ? (
            <>
              <p className="text-lg font-bold text-amber-700">
                {(shipment.discrepancy?.qty_pcs ?? 0) > 0 ? `+${shipment.discrepancy?.qty_pcs}` : shipment.discrepancy?.qty_pcs ?? 0}{' '}
                <span className="text-xs font-normal text-amber-600">шт.</span>
              </p>
              <p className="text-amber-700 font-medium mt-0.5">
                {(shipment.discrepancy?.area_sqm ?? 0) > 0 ? `+${(shipment.discrepancy?.area_sqm ?? 0).toFixed(1)}` : (shipment.discrepancy?.area_sqm ?? 0).toFixed(1)} м²
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-emerald-700">
                0 <span className="text-xs font-normal text-slate-400">шт.</span>
              </p>
              <p className="text-emerald-700 font-medium mt-0.5">0.0 м² (Сошлось идеально)</p>
            </>
          )}
        </div>
      </div>

      {/* Комментарий склада */}
      {shipment.comment && (
        <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-100 text-xs text-slate-600 flex items-start gap-2">
          <span className="font-semibold text-slate-700 shrink-0">Примечание склада:</span>
          <span className="italic">{shipment.comment}</span>
        </div>
      )}

      {/* Раскрывающийся список расхождений */}
      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-50/50 p-4">
          {shipment.items && shipment.items.length > 0 ? (
            <>
              <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Построчный реестр расхождений и позиций партии ({shipment.items.length} поз.)
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                      <th className="py-2.5 px-3">Артикул / Наименование</th>
                      <th className="py-2.5 px-3">Штрихкод</th>
                      <th className="py-2.5 px-3 text-right">Заявлено</th>
                      <th className="py-2.5 px-3 text-right">Факт</th>
                      <th className="py-2.5 px-3 text-right">Дельта</th>
                      <th className="py-2.5 px-3">Статус сверки</th>
                      <th className="py-2.5 px-3">Причина / Примечание</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shipment.items.map((it, itIdx) => {
                      const isDiff = it.discrepancy_qty !== 0;
                      return (
                        <tr key={itIdx} className={`hover:bg-slate-50/70 ${isDiff ? 'bg-amber-50/30' : ''}`}>
                          <td className="py-2 px-3">
                            <p className="font-bold text-slate-900">{it.article}</p>
                            <p className="text-[11px] text-slate-500">{it.name}</p>
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                            {it.barcode || '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-medium text-slate-700">
                            {it.declared_qty} шт
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            {it.actual_qty} шт
                          </td>
                          <td className="py-2 px-3 text-right font-bold">
                            {it.discrepancy_qty !== 0 ? (
                              <span className="text-amber-700">
                                {it.discrepancy_qty > 0 ? `+${it.discrepancy_qty}` : it.discrepancy_qty} шт
                              </span>
                            ) : (
                              <span className="text-emerald-700">0 шт</span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {it.status === 'shortage' || it.status === 'missing' ? (
                              <span className="badge bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold">
                                Недостача
                              </span>
                            ) : it.status === 'surplus' ? (
                              <span className="badge bg-blue-100 text-blue-800 border border-blue-200 text-[10px] font-bold">
                                Излишек
                              </span>
                            ) : (
                              <span className="badge bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                                Совпало
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {it.reason || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-lg border border-slate-200 bg-white text-center text-xs text-slate-500">
              {hasDiscrepancy ? (
                <p className="text-amber-800">
                  Обнаружены расхождения по накладной. Построчная детализация в процессе заполнения оператором WMS.
                </p>
              ) : (
                <p className="text-emerald-700 font-medium">
                  Все позиции партии приняты на склад в 100% соответствии со спецификацией производителя. Замечаний нет.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default InboundShipmentCard;
