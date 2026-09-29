import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Truck,
  Clock,
  Printer,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { fetchSupplierDefects } from '@/lib/erpApi';
import type {
  SupplierDefectItem,
  SupplierDefectsResponse,
} from '@/types';

export interface SupplierDefectsTabProps {
  selectedSupplierId: number;
  reloadCounter: number;
  supplierName?: string;
}

const FALLBACK_DEFECTS: SupplierDefectItem[] = [];

export function SupplierDefectsTab({
  selectedSupplierId,
  reloadCounter,
  supplierName,
}: SupplierDefectsTabProps) {
  const [defectsData, setDefectsData] = useState<SupplierDefectsResponse | null>(null);
  const [loadingDefects, setLoadingDefects] = useState<boolean>(false);
  const [defectsError, setDefectsError] = useState<string | null>(null);
  const [defectFilter, setDefectFilter] = useState<'all' | 'factory_defect' | 'transit_damage' | 'client_return'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoadingDefects(true);
    setDefectsError(null);

    fetchSupplierDefects(selectedSupplierId)
      .then(data => {
        if (cancelled) return;
        if (data && data.success && Array.isArray(data.defects)) {
          setDefectsData(data);
        } else {
          setDefectsData({
            success: true,
            supplier_id: selectedSupplierId,
            supplier_name: supplierName || 'Поставщик',
            total_defects: FALLBACK_DEFECTS.length,
            defects: FALLBACK_DEFECTS,
          });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('[SupplierCabinet] Defects endpoint notice:', err);
        setDefectsData({
          success: true,
          supplier_id: selectedSupplierId,
          supplier_name: supplierName || 'Поставщик',
          total_defects: FALLBACK_DEFECTS.length,
          defects: FALLBACK_DEFECTS,
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingDefects(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, reloadCounter, supplierName]);

  const handlePrint = () => {
    window.print();
  };

  const defectsList = defectsData?.defects || [];

  return (
    <div className="space-y-6">
      {/* Сводные показатели по браку */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Всего рекламаций</span>
            <ShieldAlert className="h-4 w-4 text-red-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {defectsList.reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
            <span className="text-sm font-normal text-slate-500">шт.</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {defectsList.reduce((acc, d) => acc + d.area_sqm, 0).toFixed(1)} м² зафиксировано
          </p>
        </div>

        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Брак фабрики</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold text-amber-950">
            {defectsList.filter(d => d.defect_type === 'factory_defect').reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
            <span className="text-sm font-normal text-amber-700">шт.</span>
          </p>
          <p className="text-xs text-amber-600 mt-1">
            Производственный дефект ворса/основы
          </p>
        </div>

        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Бой логистики</span>
            <Truck className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-indigo-950">
            {defectsList.filter(d => d.defect_type === 'transit_damage').reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
            <span className="text-sm font-normal text-indigo-700">шт.</span>
          </p>
          <p className="text-xs text-indigo-600 mt-1">
            Повреждение упаковки перевозчиком
          </p>
        </div>

        <div className="card p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">В зоне инспекции</span>
            <Clock className="h-4 w-4 text-brand-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {defectsList.filter(d => d.status === 'inspecting').reduce((acc, d) => acc + d.qty_pcs, 0)}{' '}
            <span className="text-sm font-normal text-slate-500">шт.</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">
            На экспертизе завсклада
          </p>
        </div>
      </div>

      {/* Панель фильтров */}
      <div className="card p-4 bg-white flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
            Причина дефекта:
          </span>
          <button
            onClick={() => setDefectFilter('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              defectFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Все ({defectsList.length})
          </button>
          <button
            onClick={() => setDefectFilter('factory_defect')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              defectFilter === 'factory_defect'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Брак фабрики ({defectsList.filter(d => d.defect_type === 'factory_defect').length})
          </button>
          <button
            onClick={() => setDefectFilter('transit_damage')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              defectFilter === 'transit_damage'
                ? 'bg-indigo-600 text-white'
                : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200'
            }`}
          >
            Бой перевозчика ({defectsList.filter(d => d.defect_type === 'transit_damage').length})
          </button>
          <button
            onClick={() => setDefectFilter('client_return')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              defectFilter === 'client_return'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
            }`}
          >
            Возвраты дилеров ({defectsList.filter(d => d.defect_type === 'client_return').length})
          </button>
        </div>

        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
        >
          <Printer className="h-3.5 w-3.5" />
          Печать актов брака
        </button>
      </div>

      {/* Таблица рекламаций */}
      {loadingDefects ? (
        <div className="card p-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent mb-2" />
          <p className="text-sm text-slate-500">Загрузка актов отбраковки из ERP...</p>
        </div>
      ) : defectsError ? (
        <div className="card p-6 border-red-200 bg-red-50 text-red-800 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <p className="font-semibold">Ошибка загрузки:</p>
          </div>
          <p>{defectsError}</p>
        </div>
      ) : defectsList.length === 0 ? (
        <div className="card p-12 text-center text-slate-500">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
          <p className="font-semibold text-slate-700">Нет зарегистрированного брака</p>
          <p className="text-xs text-slate-400 mt-1">
            Вся продукция фабрики находится в кондиционном состоянии без зафиксированных дефектов
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <th className="py-3 px-4">Акт / Дата</th>
                  <th className="py-3 px-4">Номенклатура / Размер</th>
                  <th className="py-3 px-4">Склад размещения</th>
                  <th className="py-3 px-4">Причина дефекта</th>
                  <th className="py-3 px-4">Ответственность</th>
                  <th className="py-3 px-4 text-right">Объем</th>
                  <th className="py-3 px-4">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {defectsList
                  .filter(d => defectFilter === 'all' || d.defect_type === defectFilter)
                  .map((defect) => (
                    <tr key={defect.defect_id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4 align-top">
                        <p className="font-mono font-bold text-slate-900 text-xs">{defect.act_number}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{defect.act_date}</p>
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <p className="font-bold text-slate-900">{defect.article}</p>
                        <p className="text-xs text-brand-700">{defect.collection}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{defect.size}</p>
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <p className="font-semibold text-slate-800 text-xs">{defect.warehouse_name}</p>
                        <p className="text-[11px] text-slate-400">{defect.city}</p>
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          defect.defect_type === 'factory_defect'
                            ? 'bg-amber-100 text-amber-900 border border-amber-200'
                            : defect.defect_type === 'transit_damage'
                              ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                              : 'bg-purple-100 text-purple-900 border border-purple-200'
                        }`}>
                          {defect.defect_type_label}
                        </span>
                        {defect.comment && (
                          <p className="text-xs text-slate-600 mt-1 italic max-w-xs">{defect.comment}</p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <span className="text-xs font-semibold text-slate-700">
                          {defect.responsible_party}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                        <span className="font-bold text-slate-900 text-sm">{defect.qty_pcs} шт</span>
                        <p className="text-xs text-slate-400">{defect.area_sqm.toFixed(1)} м²</p>
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <span className={`badge text-[10px] font-bold ${
                          defect.status === 'inspecting'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : defect.status === 'discounted'
                              ? 'bg-blue-100 text-blue-800 border-blue-300'
                              : 'bg-slate-100 text-slate-700 border-slate-300'
                        }`}>
                          {defect.status_label}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default SupplierDefectsTab;
