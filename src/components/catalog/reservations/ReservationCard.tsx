import React from 'react';
import { Phone, Clock, ChevronDown, Package } from 'lucide-react';
import type { ActiveReservation } from '@/lib/erpApi';
import { useLanguage } from '@/contexts/LanguageContext';

interface ReservationCardProps {
  reservation: ActiveReservation;
  isExpanded: boolean;
  isCatalogMatch: boolean;
  onToggleExpand: () => void;
  formatTtl: (holdExpiresAt?: string, createdAt?: string) => { label: string; isExpiringSoon: boolean };
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
        isCatalogMatch
          ? 'border-amber-300 bg-amber-50/15 shadow-2xs'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Top Row: Client & Order Summary */}
      <div
        className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer bg-white hover:bg-slate-50/50 select-none"
        onClick={onToggleExpand}
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-sm shrink-0 ${
              isCatalogMatch
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
                <span className="badge text-[10px] font-bold bg-amber-500 text-white shadow-2xs">
                  🎯 {t('reservations.badge_current_catalog')}
                </span>
              )}
              <span
                className={`badge text-[10px] font-bold ${
                  res.status === 'processing'
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}
              >
                {res.status === 'processing'
                  ? t('reservations.status_assembly')
                  : t('reservations.status_auto')}
              </span>
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
              <span className="inline-flex items-center gap-1 text-slate-400">
                🏢 {res.warehouse}
              </span>
            </div>

            {/* Direct Product Preview: carpet names, size and quantities visible at a glance */}
            {res.items && res.items.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {res.items.map((it, idx) => (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                      isCatalogMatch
                        ? 'bg-amber-100/90 text-amber-950 border border-amber-300'
                        : 'bg-slate-100 text-slate-800 border border-slate-200'
                    }`}
                  >
                    <Package className="h-3 w-3 text-amber-600 shrink-0" />
                    <span className="truncate max-w-[180px] sm:max-w-none">{it.product_name}</span>
                    <span className="text-slate-600 font-mono font-normal">({it.size})</span>
                    <span className="font-bold font-mono text-amber-800">×{it.quantity}</span>
                  </span>
                ))}
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
                ttl.isExpiringSoon ? 'text-rose-600 font-semibold' : 'text-slate-500'
              }`}
            >
              <Clock className="h-3 w-3 shrink-0" />
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

      {/* Expandable Reserved Items Table */}
      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4 animate-in slide-in-from-top-1 duration-150">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            {t('reservations.items_composition')}
          </p>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
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
                {res.items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-25">
                    <td className="py-2 px-3">
                      <span className="font-semibold text-slate-900 block truncate max-w-[200px] sm:max-w-xs">
                        {item.product_name}
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
