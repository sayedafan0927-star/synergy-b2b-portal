import React from 'react';
import type { SupplierDefectItem } from '@/types';

export interface SupplierDefectMobileCardProps {
  defect: SupplierDefectItem;
}

export function SupplierDefectMobileCard({ defect }: SupplierDefectMobileCardProps) {
  return (
    <div className="card p-3.5 bg-white border border-slate-200/80 shadow-xs space-y-2.5 text-xs">
      {/* Шапка: акт, дата, статус */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-slate-900 text-xs">{defect.act_number}</span>
          <span className="text-[11px] text-slate-400">{defect.act_date}</span>
        </div>
        <span
          className={`badge text-[10px] font-bold ${
            defect.status === 'inspecting'
              ? 'bg-amber-100 text-amber-800 border-amber-300'
              : defect.status === 'discounted'
                ? 'bg-blue-100 text-blue-800 border-blue-300'
                : 'bg-slate-100 text-slate-700 border-slate-300'
          }`}
        >
          {defect.status_label}
        </span>
      </div>

      {/* Ковер / Артикул / Коллекция / Размер */}
      <div className="flex items-start justify-between gap-2 pt-1 border-t border-slate-100">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-slate-900 text-sm">{defect.article}</span>
            <span className="badge bg-brand-50 text-brand-700 border border-brand-200/60 text-[10px] font-semibold">
              {defect.collection}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Размер: <strong className="text-slate-700">{defect.size}</strong> • {defect.warehouse_name} ({defect.city})
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="font-bold text-slate-900 text-xs">{defect.qty_pcs} шт</span>
          <p className="text-[10px] text-slate-400">{defect.area_sqm.toFixed(1)} м²</p>
        </div>
      </div>

      {/* Тип брака и комментарий */}
      <div className="space-y-1 pt-1 border-t border-slate-100">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              defect.defect_type === 'factory_defect'
                ? 'bg-amber-100 text-amber-900 border border-amber-200'
                : defect.defect_type === 'transit_damage'
                  ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                  : 'bg-purple-100 text-purple-900 border border-purple-200'
            }`}
          >
            {defect.defect_type_label}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            Ответственность: <strong className="text-slate-700">{defect.responsible_party}</strong>
          </span>
        </div>
        {defect.comment && (
          <p className="text-[11px] text-slate-600 italic bg-slate-50 p-2 rounded-lg border border-slate-100 mt-1">
            {defect.comment}
          </p>
        )}
      </div>
    </div>
  );
}

export default SupplierDefectMobileCard;
