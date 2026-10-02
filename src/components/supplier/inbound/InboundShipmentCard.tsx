import React, { useState } from 'react';
import {
  FileText,
  Store,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Download,
  Eye,
} from 'lucide-react';
import type { InboundShipment } from '@/types';
import { DiscrepancyActModal } from './DiscrepancyActModal';

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
  const [isActModalOpen, setIsActModalOpen] = useState(false);
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
        className="p-3.5 sm:p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors select-none"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
            <span className="font-mono font-bold text-slate-900 text-sm sm:text-base flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-brand-600 shrink-0" />
              {docTitle}
            </span>
            {shipment.incoming_doc_date && (
              <span className="badge bg-slate-100 text-slate-700 text-[10px] sm:text-xs">
                ТТН от {shipment.incoming_doc_date}
              </span>
            )}
            <span className="text-slate-300 hidden sm:inline">•</span>
            <span className="font-mono text-[11px] sm:text-xs text-slate-500">
              Акт: {shipment.receipt_doc_number} ({shipment.receipt_date})
            </span>
            {shipment.supplier_name && (
              <span className="badge bg-slate-100 text-slate-600 text-[10px] sm:text-xs">
                {shipment.supplier_name}
              </span>
            )}
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 flex items-center gap-1.5">
            <Store className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="truncate">Склад выгрузки: <strong>{shipment.warehouse_name}</strong> ({shipment.city})</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2 sm:gap-2.5 w-full lg:w-auto pt-2 lg:pt-0 border-t border-slate-100 lg:border-t-0">
          {hasDiscrepancy ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-2.5 sm:px-3 py-1 text-xs font-bold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
              С расхождениями ({shipment.discrepancy?.qty_pcs > 0 ? `+${shipment.discrepancy.qty_pcs}` : shipment.discrepancy?.qty_pcs} шт.)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 sm:px-3 py-1 text-xs font-bold text-emerald-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
              Принято полностью
            </span>
          )}

          {shipment.has_discrepancy_act && (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setIsActModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300/80 px-2.5 py-1 rounded-lg transition-colors cursor-pointer shrink-0"
                title="Просмотреть электронный Акт о расхождении"
              >
                <Eye className="h-3.5 w-3.5 text-amber-700" />
                <span className="hidden sm:inline">Акт расхождений</span>
                <span className="sm:hidden">Акт</span>
              </button>

              {shipment.excel_download_url && (
                <a
                  href={shipment.excel_download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300/80 px-2.5 py-1 rounded-lg transition-colors cursor-pointer shrink-0"
                  title="Скачать Акт о расхождении (.xlsx)"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-700" />
                  <span className="hidden sm:inline">Excel (.xlsx)</span>
                  <span className="sm:hidden">.xlsx</span>
                </a>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 flex items-center gap-1 px-2.5 py-1 rounded-lg border border-brand-200 bg-brand-50/50 cursor-pointer shrink-0"
          >
            {isExpanded ? 'Скрыть' : 'Детализация'}
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {/* Показатели партии: Заявлено vs Факт vs Дельта */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 bg-white p-2.5 sm:p-4 text-xs">
        <div className="p-1.5 sm:p-3 text-center sm:text-left">
          <p className="text-slate-400 uppercase font-semibold text-[9px] sm:text-[10px] tracking-wider mb-1 truncate">
            1. Заявлено
          </p>
          <p className="text-sm sm:text-lg font-bold text-slate-900">
            {shipment.declared?.qty_pcs ?? 0}{' '}
            <span className="text-[10px] sm:text-xs font-normal text-slate-500">шт.</span>
          </p>
          <p className="text-slate-400 text-[10px] sm:text-xs mt-0.5 truncate">{(shipment.declared?.area_sqm ?? 0).toFixed(1)} м²</p>
        </div>

        <div className="p-1.5 sm:p-3 text-center sm:text-left">
          <p className="text-slate-400 uppercase font-semibold text-[9px] sm:text-[10px] tracking-wider mb-1 truncate">
            2. Факт ТСД
          </p>
          <p className="text-sm sm:text-lg font-bold text-emerald-800">
            {shipment.actual?.qty_pcs ?? 0}{' '}
            <span className="text-[10px] sm:text-xs font-normal text-emerald-600">шт.</span>
          </p>
          <p className="text-slate-400 text-[10px] sm:text-xs mt-0.5 truncate">{(shipment.actual?.area_sqm ?? 0).toFixed(1)} м²</p>
        </div>

        <div className="p-1.5 sm:p-3 text-center sm:text-left">
          <p className="text-slate-400 uppercase font-semibold text-[9px] sm:text-[10px] tracking-wider mb-1 truncate">
            3. Дельта
          </p>
          {hasDiscrepancy ? (
            <>
              <p className="text-sm sm:text-lg font-bold text-amber-700">
                {(shipment.discrepancy?.qty_pcs ?? 0) > 0 ? `+${shipment.discrepancy?.qty_pcs}` : shipment.discrepancy?.qty_pcs ?? 0}{' '}
                <span className="text-[10px] sm:text-xs font-normal text-amber-600">шт.</span>
              </p>
              <p className="text-amber-700 font-medium text-[10px] sm:text-xs mt-0.5 truncate">
                {(shipment.discrepancy?.area_sqm ?? 0) > 0 ? `+${(shipment.discrepancy?.area_sqm ?? 0).toFixed(1)}` : (shipment.discrepancy?.area_sqm ?? 0).toFixed(1)} м²
              </p>
            </>
          ) : (
            <>
              <p className="text-sm sm:text-lg font-bold text-emerald-700">
                0 <span className="text-[10px] sm:text-xs font-normal text-slate-400">шт.</span>
              </p>
              <p className="text-emerald-700 font-medium text-[10px] sm:text-xs mt-0.5 truncate">0.0 м²</p>
            </>
          )}
        </div>
      </div>

      {/* Комментарий склада */}
      {shipment.comment && (
        <div className="px-3.5 sm:px-5 py-2.5 sm:py-3 bg-slate-50/70 border-t border-slate-100 text-xs text-slate-600 flex items-start gap-2">
          <span className="font-semibold text-slate-700 shrink-0">Примечание:</span>
          <span className="italic">{shipment.comment}</span>
        </div>
      )}

      {/* Раскрывающийся список расхождений */}
      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-50/50 p-3 sm:p-4">
          {/* Баннер электронного акта расхождений */}
          {shipment.has_discrepancy_act && (
            <div className="mb-4 p-3.5 sm:p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50/60 border border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-800 shrink-0">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-xs sm:text-sm text-slate-900">
                      Официальный акт о расхождении при приёмке
                    </span>
                    {shipment.discrepancy_act_number && (
                      <span className="inline-flex items-center rounded-md bg-amber-200/70 px-2 py-0.5 text-amber-900 font-mono text-[10px] sm:text-xs font-bold">
                        {shipment.discrepancy_act_number}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-600 mt-0.5">
                    Сформирован электронный акт со сводкой недостач, излишков и подписями комиссии склада.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsActModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-semibold text-amber-900 hover:bg-amber-50 transition-colors cursor-pointer shadow-2xs"
                >
                  <Eye className="h-3.5 w-3.5 text-amber-700" />
                  Смотреть акт
                </button>
                {shipment.excel_download_url && (
                  <a
                    href={shipment.excel_download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white transition-colors cursor-pointer shadow-2xs"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Скачать Акт о расхождении (.xlsx)
                  </a>
                )}
              </div>
            </div>
          )}

          {shipment.items && shipment.items.length > 0 ? (
            <>
              <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                Построчный реестр расхождений и позиций ({shipment.items.length} поз.)
              </p>

              {/* Mobile view (< md): адаптивные карточки позиций партии */}
              <div className="md:hidden space-y-2.5">
                {shipment.items.map((it, itIdx) => {
                  const isDiff = it.discrepancy_qty !== 0;
                  return (
                    <div
                      key={itIdx}
                      className={`card p-3 bg-white border ${
                        isDiff ? 'border-amber-300/80 bg-amber-50/20' : 'border-slate-200'
                      } shadow-xs space-y-2 text-xs`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-slate-900 text-sm">{it.article}</p>
                          {it.name && (
                            <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{it.name}</p>
                          )}
                        </div>
                        {it.status === 'shortage' || it.status === 'missing' ? (
                          <span className="badge bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold shrink-0">
                            Недостача
                          </span>
                        ) : it.status === 'surplus' ? (
                          <span className="badge bg-blue-100 text-blue-800 border border-blue-200 text-[10px] font-bold shrink-0">
                            Излишек
                          </span>
                        ) : (
                          <span className="badge bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold shrink-0">
                            Совпало
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono py-1 px-2 rounded bg-slate-50 border border-slate-100">
                        <span>Штрихкод:</span>
                        <span className="font-semibold text-slate-700">{it.barcode || '—'}</span>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 pt-1 text-center">
                        <div className="bg-slate-50 rounded p-1.5 border border-slate-100">
                          <p className="text-[9px] text-slate-400 uppercase font-semibold">Заявлено</p>
                          <p className="font-bold text-slate-800 text-xs mt-0.5">{it.declared_qty} шт</p>
                        </div>
                        <div className="bg-slate-50 rounded p-1.5 border border-slate-100">
                          <p className="text-[9px] text-slate-400 uppercase font-semibold">Факт ТСД</p>
                          <p className="font-bold text-slate-900 text-xs mt-0.5">{it.actual_qty} шт</p>
                        </div>
                        <div className={`rounded p-1.5 border ${
                          isDiff ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        }`}>
                          <p className="text-[9px] uppercase font-semibold">Дельта</p>
                          <p className="font-bold text-xs mt-0.5">
                            {it.discrepancy_qty !== 0
                              ? (it.discrepancy_qty > 0 ? `+${it.discrepancy_qty}` : it.discrepancy_qty)
                              : '0'}{' '}
                            шт
                          </p>
                        </div>
                      </div>

                      {it.reason && (
                        <p className="text-[11px] text-slate-500 italic pt-1 border-t border-slate-100">
                          Примечание: {it.reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop view (>= md): классическая таблица */}
              <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
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

      {/* Модальное окно просмотра акта расхождений */}
      <DiscrepancyActModal
        receiptId={shipment.receipt_id}
        initialActNumber={shipment.discrepancy_act_number}
        excelDownloadUrl={shipment.excel_download_url}
        isOpen={isActModalOpen}
        onClose={() => setIsActModalOpen(false)}
      />
    </div>
  );
}

export default InboundShipmentCard;
