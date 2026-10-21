import { Building2, Store, Factory, CheckCircle2 } from 'lucide-react';

export interface CatalogWarehouseModeBarProps {
  allWarehouses: string[];
  selectedWarehouses: Set<string>;
  onSelectWarehouse: (warehouseName: string | null) => void;
  onlyInProduction: boolean;
  onSetOnlyInProduction: (val: boolean) => void;
  inProductionCount: number;
  myShowroomName?: string;
  hasOwnShowroom?: boolean;
}

export function CatalogWarehouseModeBar({
  allWarehouses,
  selectedWarehouses,
  onSelectWarehouse,
  onlyInProduction,
  onSetOnlyInProduction,
  inProductionCount,
  myShowroomName,
  hasOwnShowroom = false,
}: CatalogWarehouseModeBarProps) {
  const nonHubWarehouses = hasOwnShowroom && myShowroomName
    ? allWarehouses.filter(w => w === myShowroomName)
    : [];

  if (nonHubWarehouses.length === 0 && inProductionCount === 0) {
    return null;
  }

  const activeWhList = Array.from(selectedWarehouses);
  const isHubActive = !onlyInProduction && (
    selectedWarehouses.size === 0 ||
    (selectedWarehouses.size === 1 && (activeWhList[0] === 'Основной Склад Астана' || activeWhList[0]?.includes('Астана')))
  );
  const activeConsignmentWh = !onlyInProduction && !isHubActive ? activeWhList[0] : null;

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
            {isHubActive && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
          </button>

          {nonHubWarehouses.map(wh => {
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
          })}

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

      {activeConsignmentWh && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-900">
          <span>
            🏪 <strong>Режим списания со склада «{activeConsignmentWh}»:</strong> отображаются только позиции, числящиеся на этом складе. В корзине они формируют отдельный заказ без смешивания с Основным Складом Астана.
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
