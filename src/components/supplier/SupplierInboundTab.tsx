import { useState, useEffect } from 'react';
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  Printer,
  AlertCircle,
  FileText,
  Store,
  ChevronRight,
} from 'lucide-react';
import { fetchSupplierInboundShipments } from '@/lib/erpApi';
import type {
  InboundShipment,
  SupplierInboundShipmentsResponse,
} from '@/types';

export interface SupplierInboundTabProps {
  selectedSupplierId: number;
  reloadCounter: number;
  supplierName?: string;
}

const FALLBACK_INBOUND_SHIPMENTS: InboundShipment[] = [];

export function SupplierInboundTab({
  selectedSupplierId,
  reloadCounter,
  supplierName,
}: SupplierInboundTabProps) {
  const [inboundData, setInboundData] = useState<SupplierInboundShipmentsResponse | null>(null);
  const [loadingInbound, setLoadingInbound] = useState<boolean>(false);
  const [inboundError, setInboundError] = useState<string | null>(null);
  const [inboundFilter, setInboundFilter] = useState<'all' | 'discrepancy' | 'matched'>('all');
  const [expandedShipmentId, setExpandedShipmentId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingInbound(true);
    setInboundError(null);

    const querySupplierId = selectedSupplierId > 0 ? selectedSupplierId : undefined;

    fetchSupplierInboundShipments(querySupplierId, { status: 'all' })
      .then(data => {
        if (cancelled) return;
        if (data && data.success && Array.isArray(data.shipments)) {
          setInboundData(data);
        } else {
          setInboundData(prev => prev || {
            success: true,
            supplier_id: selectedSupplierId,
            supplier_name: supplierName || 'Поставщик',
            total_shipments: FALLBACK_INBOUND_SHIPMENTS.length,
            shipments: FALLBACK_INBOUND_SHIPMENTS,
          });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('[SupplierCabinet] Inbound shipments endpoint notice:', err);
        setInboundData(prev => prev || {
          success: true,
          supplier_id: selectedSupplierId,
          supplier_name: supplierName || 'Поставщик',
          total_shipments: FALLBACK_INBOUND_SHIPMENTS.length,
          shipments: FALLBACK_INBOUND_SHIPMENTS,
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingInbound(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, reloadCounter, supplierName]);

  const handlePrint = () => {
    window.print();
  };

  const rawShipments = inboundData?.shipments || [];
  const totalShipments = inboundData?.pagination?.total_items ?? inboundData?.total_shipments ?? rawShipments.length;
  const matchedCount = rawShipments.filter(s => !s.has_discrepancy && s.reconciliation_status !== 'discrepancy').length;
  const discrepancyCount = rawShipments.filter(s => s.has_discrepancy || s.reconciliation_status === 'discrepancy').length;
  const totalDeltaPcs = rawShipments.reduce((acc, s) => acc + (s.discrepancy?.qty_pcs || 0), 0);
  const totalDeltaSqm = rawShipments.reduce((acc, s) => acc + (s.discrepancy?.area_sqm || 0), 0);

  const filteredShipments = rawShipments.filter(s => {
    const hasDisc = s.has_discrepancy || s.reconciliation_status === 'discrepancy';
    if (inboundFilter === 'discrepancy') return hasDisc;
    if (inboundFilter === 'matched') return !hasDisc;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Сводные показатели по поставкам */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Всего поставок</span>
            <Truck className="h-4 w-4 text-brand-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {totalShipments}{' '}
            <span className="text-sm font-normal text-slate-500">партий</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Основной склад Астана
          </p>
        </div>

        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Без расхождений</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-950">
            {matchedCount}{' '}
            <span className="text-sm font-normal text-emerald-700">партий</span>
          </p>
          <p className="text-xs text-emerald-600 mt-1">
            100% соответствие ТТН фабрики
          </p>
        </div>

        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">С расхождениями</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold text-amber-950">
            {discrepancyCount}{' '}
            <span className="text-sm font-normal text-amber-700">партий</span>
          </p>
          <p className="text-xs text-amber-600 mt-1">
            Недостачи / излишки / бой
          </p>
        </div>

        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Дельта приемки</span>
            <PackageCheck className="h-4 w-4 text-brand-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {totalDeltaPcs > 0 ? `+${totalDeltaPcs}` : totalDeltaPcs}{' '}
            <span className="text-sm font-normal text-slate-500">шт.</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {totalDeltaSqm > 0 ? `+${totalDeltaSqm.toFixed(1)}` : totalDeltaSqm.toFixed(1)} м² суммарная дельта
          </p>
        </div>
      </div>

      {/* Фильтр статусов приемки */}
      <div className="card p-4 bg-white flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
            Фильтр партий:
          </span>
          <button
            onClick={() => setInboundFilter('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              inboundFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Все партии ({totalShipments})
          </button>
          <button
            onClick={() => setInboundFilter('discrepancy')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              inboundFilter === 'discrepancy'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Только с расхождениями ({discrepancyCount})
          </button>
          <button
            onClick={() => setInboundFilter('matched')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              inboundFilter === 'matched'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            Без замечаний ({matchedCount})
          </button>
        </div>

        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
        >
          <Printer className="h-3.5 w-3.5" />
          Печать реестра
        </button>
      </div>

      {/* Список партий приемки */}
      {loadingInbound ? (
        <div className="card p-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-2" />
          <p className="text-sm text-slate-500">Загрузка актов приемки из ERP...</p>
        </div>
      ) : inboundError ? (
        <div className="card p-6 border-red-200 bg-red-50 text-red-800 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <p className="font-semibold">Ошибка загрузки поставок:</p>
          </div>
          <p>{inboundError}</p>
        </div>
      ) : filteredShipments.length === 0 ? (
        <div className="card p-12 text-center text-slate-500">
          <Truck className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="font-semibold text-slate-700">Нет зарегистрированных поставок</p>
          <p className="text-xs text-slate-400 mt-1">
            {inboundFilter !== 'all' ? 'Нет партий, соответствующих выбранному фильтру' : 'По выбранной фабрике пока нет проведенных приходных накладных в ERP'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredShipments.map((shipment) => {
            const isExpanded = expandedShipmentId === shipment.receipt_id;
            const hasDiscrepancy = shipment.has_discrepancy || shipment.reconciliation_status === 'discrepancy';
            const docTitle = shipment.incoming_doc_number && shipment.incoming_doc_number !== 'Не указан'
              ? shipment.incoming_doc_number
              : shipment.receipt_doc_number;

            return (
              <div
                key={shipment.receipt_id}
                className={`card overflow-hidden border transition-all ${
                  hasDiscrepancy
                    ? 'border-amber-300 bg-amber-50/20'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {/* Шапка накладной — кликабельна для раскрытия */}
                <div
                  onClick={() => setExpandedShipmentId(isExpanded ? null : shipment.receipt_id)}
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
                        setExpandedShipmentId(isExpanded ? null : shipment.receipt_id);
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
          })}
        </div>
      )}
    </div>
  );
}

export default SupplierInboundTab;
