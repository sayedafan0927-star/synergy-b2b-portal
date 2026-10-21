import { Building2, Store, Factory, CheckCircle2, Layers, ChevronDown } from 'lucide-react';
import type { Warehouse } from '@/types';

export interface CatalogWarehouseModeBarProps {
  allWarehouses: string[];
  erpWarehouses?: Warehouse[];
  selectedWarehouses: Set<string>;
  onSelectWarehouse: (warehouseName: string | null) => void;
  onlyInProduction: boolean;
  onSetOnlyInProduction: (val: boolean) => void;
  inProductionCount: number;
  myShowroomName?: string;
}

export function CatalogWarehouseModeBar({
  allWarehouses,
  erpWarehouses = [],
  selectedWarehouses,
  onSelectWarehouse,
  onlyInProduction,
  onSetOnlyInProduction,
  inProductionCount,
  myShowroomName,
}: CatalogWarehouseModeBarProps) {
  const nonHubWarehouses = allWarehouses.filter(
    w => w !== 'Основной Склад Астана' && !w.includes('Астана')
  );

  const hubWarehouse = erpWarehouses.find(
    w => w.warehouse_id === 81 || w.is_hub || (w.warehouse_name || '').includes('Астана')
  );
  const hubTopology = hubWarehouse?.topology;

  if (allWarehouses.length === 0 && inProductionCount === 0) {
    return null;
  }

  const whMetaByName = new Map<string, Warehouse>();
  for (const w of erpWarehouses) {
    const name = w.warehouse_name || w.city;
    if (name) whMetaByName.set(name, w);
  }

  const activeWhList = Array.from(selectedWarehouses);
  const isHubActive = !onlyInProduction && (
    selectedWarehouses.size === 0 ||
    (selectedWarehouses.size === 1 && (activeWhList[0] === 'Основной Склад Астана' || activeWhList[0]?.includes('Астана')))
  );
  const activeConsignmentWh = !onlyInProduction && !isHubActive ? activeWhList[0] : null;
  const activeConsignmentMeta = activeConsignmentWh ? whMetaByName.get(activeConsignmentWh) : undefined;

  return (
    <div className="mb-4 rounded-xl border border-slate-200/90 bg-white p-2.5 sm:p-3 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
          <Building2 className="h-3.5 w-3.5 text-brand-700" />
          <span>Режим склада / источника заказа:</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onSetOnlyInProduction(false);
              onSelectWarehouse(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
              isHubActive
                ? 'bg-brand-700 text-white shadow-xs ring-2 ring-brand-700/20'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Основной Склад Астана</span>
            {hubTopology && hubTopology.storage_cells_count > 0 && (
              <span
                className={`ml-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                  isHubActive
                    ? 'bg-white/15 text-emerald-200'
                    : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {hubTopology.rows_count} рядов · {hubTopology.storage_cells_count} ячеек 1С
              </span>
            )}
            {isHubActive && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
          </button>

          {nonHubWarehouses.length <= 4 ? (
            nonHubWarehouses.map(wh => {
              const isActive = !onlyInProduction && selectedWarehouses.has(wh);
              const isMyStore = Boolean(myShowroomName && wh === myShowroomName);
              return (
                <button
                  key={wh}
                  type="button"
                  onClick={() => {
                    onSetOnlyInProduction(false);
                    onSelectWarehouse(isActive ? null : wh);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-emerald-700 text-white shadow-xs ring-2 ring-emerald-700/20'
                      : 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  <Store className="h-3.5 w-3.5" />
                  <span>{isMyStore ? `Мой склад: ${wh}` : `Склад: ${wh}`}</span>
                  {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />}
                </button>
              );
            })
          ) : (
            <div className="relative inline-flex items-center">
              <Store className={`absolute left-2.5 h-3.5 w-3.5 pointer-events-none ${
                activeConsignmentWh ? 'text-white' : 'text-emerald-700'
              }`} />
              <select
                value={activeConsignmentWh || ''}
                onChange={e => {
                  const val = e.target.value;
                  onSetOnlyInProduction(false);
                  onSelectWarehouse(val ? val : null);
                }}
                aria-label="Выбор склада комиссионера"
                className={`appearance-none rounded-lg pl-8 pr-7 py-1.5 text-xs font-bold transition-all cursor-pointer outline-none ${
                  activeConsignmentWh
                    ? 'bg-emerald-700 text-white shadow-xs ring-2 ring-emerald-700/20'
                    : 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                <option value="" className="bg-white text-slate-800">
                  Склады комиссионеров ({nonHubWarehouses.length})
                </option>
                {nonHubWarehouses.map(wh => {
                  const meta = whMetaByName.get(wh);
                  const citySuffix = meta?.city && meta.city !== wh ? ` — г. ${meta.city}` : '';
                  return (
                    <option key={wh} value={wh} className="bg-white text-slate-800">
                      {wh}{citySuffix}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className={`absolute right-2 h-3.5 w-3.5 pointer-events-none ${
                activeConsignmentWh ? 'text-emerald-100' : 'text-emerald-700'
              }`} />
            </div>
          )}

          {inProductionCount > 0 && (
            <button
              type="button"
              onClick={() => {
                if (onlyInProduction) {
                  onSetOnlyInProduction(false);
                } else {
                  onSelectWarehouse(null);
                  onSetOnlyInProduction(true);
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                onlyInProduction
                  ? 'bg-amber-600 text-white shadow-xs ring-2 ring-amber-600/20'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <Factory className="h-3.5 w-3.5" />
              <span>Предзаказ с фабрики ({inProductionCount})</span>
              {onlyInProduction && <CheckCircle2 className="h-3.5 w-3.5 text-amber-100" />}
            </button>
          )}
        </div>
      </div>

      {isHubActive && hubTopology && hubTopology.storage_cells_count > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-200/80 px-3 py-1.5 text-[11px] text-slate-600">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-brand-700 shrink-0" />
            <span>
              <strong className="text-slate-800">Адресная топология 1С (Астана):</strong>{' '}
              {hubTopology.rows_count} рядов (A1–C2) · {hubTopology.racks_count} стеллажей ·{' '}
              <strong className="text-brand-700">{hubTopology.storage_cells_count} ячеек хранения</strong> ·{' '}
              {hubTopology.special_zones_count} спец. зон (Приёмка / Отгрузка / Возврат / Брак)
            </span>
          </div>
          {nonHubWarehouses.length > 0 && (
            <span className="text-[11px] font-semibold text-emerald-700">
              Партнёрская сеть: {nonHubWarehouses.length} складов комиссионеров
            </span>
          )}
        </div>
      )}

      {activeConsignmentWh && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-900">
          <span>
            🏪 <strong>Склад комиссионера «{activeConsignmentWh}»{activeConsignmentMeta?.city ? ` (г. ${activeConsignmentMeta.city})` : ''}:</strong>{' '}
            консигнационный учёт 1С{activeConsignmentMeta?.topology?.total_locations ? ` (${activeConsignmentMeta.topology.total_locations} зона приёмки)` : ''}. В корзине позиции этого склада формируют отдельный заказ без смешивания с Основным Складом Астана.
          </span>
          <button
            type="button"
            onClick={() => onSelectWarehouse(null)}
            className="shrink-0 text-[11px] font-bold text-emerald-800 underline hover:text-emerald-950 cursor-pointer"
          >
            Вернуться на Склад Астана
          </button>
        </div>
      )}

      {onlyInProduction && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-900">
          <span>
            🏭 <strong>Режим «Предзаказ с фабрики»:</strong> отображаются товары в производстве. В корзине предзаказ оформляется отдельным документом брони производственной квоты.
          </span>
          <button
            type="button"
            onClick={() => onSetOnlyInProduction(false)}
            className="shrink-0 text-[11px] font-bold text-amber-800 underline hover:text-amber-950 cursor-pointer"
          >
            Вернуться на Склад Астана
          </button>
        </div>
      )}
    </div>
  );
}

export default CatalogWarehouseModeBar;
