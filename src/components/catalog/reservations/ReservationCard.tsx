import React from 'react';
import { Phone, Clock, ChevronDown, Package, Building2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ActiveReservation } from '@/lib/erpApi';
import { useLanguage } from '@/contexts/LanguageContext';

interface ReservationCardProps {
  reservation: ActiveReservation;
  isExpanded: boolean;
  isCatalogMatch: boolean;
  onToggleExpand: () => void;
  formatTtl: (holdExpiresAt?: string, createdAt?: string) => { label: string; isExpiringSoon: boolean; isExpired: boolean };
}

export function clean1CName(rawName?: string): { name: string; sku: string; color: string; collection: string } {
  if (!rawName) return { name: 'Ковер', sku: '', color: '', collection: '' };
  const m = rawName.match(/^([A-ZА-Я0-9\s-]+?)(?:\s*<[^>]*>)?\s*\(([^)]+)\)/i);
  if (m) {
    const coll = m[1].replace(/^(ковер|дорожка)\s+/i, '').trim();
    const inside = m[2].trim();
    const firstComma = inside.indexOf(',');
    if (firstComma > 0) {
      const sku = inside.slice(0, firstComma).trim();
      const afterFirst = inside.slice(firstComma + 1).trim();
      const typeMatch = afterFirst.match(/\b(STAN|R|СТАН|РУЛОН)\b\s*,\s*([^)]+)$/i);
      const color = typeMatch ? typeMatch[2].trim() : '';
      return {
        name: `${coll} ${sku}${color ? ` • ${color}` : ''}`,
        sku,
        color,
        collection: coll,
      };
    }
  }
  const clean = rawName.replace(/<[^>]+>/g, '').trim();
  const coll = clean.split(' ')[0] || '';
  return { name: clean, sku: '', color: '', collection: coll };
}

export function ReservationCard({
  reservation: res,
  isExpanded,
  isCatalogMatch,
  onToggleExpand,
  formatTtl,
}: ReservationCardProps) {
  const { t } = useLanguage();
  const ttl = formatTtl(res.hold_expires_at, res.created_at);

  return (
    <div
      className={`card transition-all overflow-hidden ${
        ttl.isExpired
          ? 'border-slate-200 bg-slate-50/40 opacity-90'
          : isCatalogMatch
          ? 'border-amber-300 bg-amber-50/15 shadow-2xs'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Top Row: Client & Order Summary */}
      <div
        className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer bg-white hover:bg-slate-50/50 select-none"
        onClick={onToggleExpand}
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-sm shrink-0 ${
              ttl.isExpired
                ? 'bg-slate-100 text-slate-500'
                : isCatalogMatch
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {(res.client_company || res.client_name || 'K').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 text-sm truncate">
                {res.client_company || res.client_name}
              </span>
              {res.client_company && res.client_name && res.client_company !== res.client_name && (
                <span className="text-xs text-slate-500 truncate">
                  ({res.client_name})
                </span>
              )}
              {isCatalogMatch && (
                <span className="badge text-[10px] font-bold bg-amber-600 text-white shadow-2xs">
                  {t('reservations.badge_current_catalog')}
                </span>
              )}
              {ttl.isExpired ? (
                <span className="badge text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                  {t('reservations.status_expired_badge')}
                </span>
              ) : (
                <span className="badge text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {t('reservations.status_active_badge')}
                </span>
              )}
              <span
                className={`badge text-[10px] font-bold ${
                  res.status === 'processing'
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {res.status === 'processing'
                  ? t('reservations.status_assembly')
                  : t('reservations.status_auto')}
              </span>
              {res.status === 'processing' && (
                <span className="badge text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 font-mono">
                  {res.assembly_progress || `0 / ${res.total_items} шт.`}
                </span>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2.5 text-xs text-slate-500 flex-wrap">
              <span className="font-mono font-semibold text-slate-700">
                № {res.order_number}
              </span>
              {res.client_phone && (
                <a
                  href={`tel:${res.client_phone}`}
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-brand-700 hover:underline font-medium"
                >
                  <Phone className="h-3 w-3" />
                  <span>{res.client_phone}</span>
                </a>
              )}
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Building2 className="h-3 w-3 text-slate-400" />
                <span>{res.warehouse}</span>
              </span>
              {res.total_amount > 0 && (
                <span className="font-mono font-bold text-slate-800 bg-slate-100/90 px-1.5 py-0.5 rounded text-[11px] border border-slate-200">
                  {res.total_amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {res.currency || 'USD'}
                </span>
              )}
            </div>

            {/* Direct Product Preview: clean nomenclature row with no emojis */}
            {res.items && res.items.length > 0 && (
              <div className="mt-2.5 space-y-1.5">
                {res.items.map((it, idx) => {
                  const cleaned = clean1CName(it.product_name);
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 border text-xs ${
                        isCatalogMatch
                          ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                          : 'bg-slate-50 border-slate-200/80 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Package className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                        <span className="font-semibold truncate">
                          {cleaned.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono">
                        <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-700 whitespace-nowrap">
                          {it.size}
                        </span>
                        <span className="bg-amber-100 border border-amber-300 font-extrabold text-amber-900 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {it.quantity} {t('common.pcs')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right side: Volume and expand action */}
        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <div className="text-left sm:text-right">
            <p className="text-xs font-extrabold text-slate-900 font-mono">
              {res.total_items} {t('common.pcs')}{' '}
              <span className="text-amber-700 font-semibold font-mono">
                ({res.total_sqm} {t('common.sqm')})
              </span>
            </p>
            <div
              className={`text-[11px] font-medium flex items-center gap-1 sm:justify-end ${
                ttl.isExpired
                  ? 'text-rose-600 font-semibold'
                  : ttl.isExpiringSoon
                  ? 'text-amber-600 font-semibold'
                  : 'text-slate-500'
              }`}
            >
              {ttl.isExpired ? (
                <AlertTriangle className="h-3 w-3 shrink-0 text-rose-500" />
              ) : (
                <Clock className="h-3 w-3 shrink-0 text-slate-400" />
              )}
              <span>{ttl.label}</span>
            </div>
          </div>

          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label={t('reservations.show_composition')}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Expandable Reserved Items Breakdown */}
      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4 animate-in slide-in-from-top-1 duration-150">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            {t('reservations.items_composition')}
          </p>

          {/* Mobile view: readable stacked cards */}
          <div className="block sm:hidden space-y-2">
            {res.items.map((item, idx) => {
              const cleaned = clean1CName(item.product_name);
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                        <span className="font-bold text-slate-900 text-xs leading-snug">
                          {cleaned.name}
                        </span>
                      </div>
                      {item.sku && (
                        <span className="font-mono text-[10px] text-slate-400 pl-5 block mt-0.5">
                          {t('reservations.art_label')} {item.sku}
                        </span>
                      )}
                    </div>
                    <span className="badge text-[11px] font-mono font-extrabold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-lg shrink-0">
                      {item.quantity} {t('common.pcs')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[11px]">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="bg-slate-100 border border-slate-200 font-mono font-semibold text-slate-700 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                        {item.size}
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-500 text-[10px] truncate">
                        <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                        <span className="truncate">{item.warehouse}</span>
                      </span>
                    </div>
                    <span className="font-mono font-bold text-emerald-800 text-[11px] shrink-0">
                      {item.total_sqm} {t('common.sqm')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop view: structured table */}
          <div className="hidden sm:block rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-3">{t('reservations.col_product')}</th>
                  <th className="py-2.5 px-2">{t('reservations.col_size')}</th>
                  <th className="py-2.5 px-2">{t('reservations.col_warehouse')}</th>
                  <th className="py-2.5 px-2 text-right">{t('reservations.col_qty')}</th>
                  <th className="py-2.5 px-3 text-right">{t('reservations.col_area')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {res.items.map((item, idx) => {
                  const cleaned = clean1CName(item.product_name);
                  return (
                    <tr key={idx} className="hover:bg-slate-25">
                      <td className="py-2 px-3">
                        <span className="font-semibold text-slate-900 block truncate max-w-[220px] sm:max-w-xs">
                          {cleaned.name}
                        </span>
                        {item.sku && (
                          <span className="font-mono text-[10px] text-slate-400">
                            {t('reservations.art_label')} {item.sku}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 font-mono font-medium text-slate-800 whitespace-nowrap">
                        {item.size}
                      </td>
                      <td className="py-2 px-2 text-slate-500 text-[11px] whitespace-nowrap">
                        {item.warehouse}
                      </td>
                      <td className="py-2 px-2 text-right font-bold text-slate-900 whitespace-nowrap">
                        {item.quantity} {t('common.pcs')}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-emerald-800 whitespace-nowrap font-mono">
                        {item.total_sqm} {t('common.sqm')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
