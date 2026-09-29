import { useState, useEffect } from 'react';
import {
  Truck,
  Printer,
  AlertCircle,
} from 'lucide-react';
import { fetchSupplierInboundShipments } from '@/lib/erpApi';
import type {
  InboundShipment,
  SupplierInboundShipmentsResponse,
} from '@/types';
import { InboundSummaryCards } from './inbound/InboundSummaryCards';
import { InboundShipmentCard } from './inbound/InboundShipmentCard';

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
      <InboundSummaryCards
        totalShipments={totalShipments}
        matchedCount={matchedCount}
        discrepancyCount={discrepancyCount}
        totalDeltaPcs={totalDeltaPcs}
        totalDeltaSqm={totalDeltaSqm}
      />

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
          {filteredShipments.map((shipment) => (
            <InboundShipmentCard
              key={shipment.receipt_id}
              shipment={shipment}
              isExpanded={expandedShipmentId === shipment.receipt_id}
              onToggleExpand={() => setExpandedShipmentId(
                expandedShipmentId === shipment.receipt_id ? null : shipment.receipt_id
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default SupplierInboundTab;
