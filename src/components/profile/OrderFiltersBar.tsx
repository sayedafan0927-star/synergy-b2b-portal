import React from 'react';
import { Search } from 'lucide-react';

export interface OrderFilterTab {
  id: string;
  label: string;
}

export interface OrderFiltersBarProps {
  filterTabs: OrderFilterTab[];
  statusFilter: string;
  onStatusChange: (status: string) => void;
  statusCounts: Record<string, number>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function OrderFiltersBar({
  filterTabs,
  statusFilter,
  onStatusChange,
  statusCounts,
  searchQuery,
  onSearchChange,
}: OrderFiltersBarProps) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {filterTabs.map(t => {
          const count = statusCounts[t.id] ?? 0;
          const active = statusFilter === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onStatusChange(t.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                active ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>{t.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${active ? 'bg-brand-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative w-full sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Поиск по номеру, клиенту..."
          className="input-field pl-9 py-1 text-xs"
        />
      </div>
    </div>
  );
}

export default OrderFiltersBar;
