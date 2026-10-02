import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  Clock,
  User,
  Building2,
  Phone,
  Package,
  Layers,
  ChevronDown,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { fetchActiveReservations, type ActiveReservation } from '@/lib/erpApi';
import { Portal } from '@/components/common/Portal';
import { useLanguage } from '@/contexts/LanguageContext';

interface StockReservationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  filterSku?: string;
}

function fmtNum(n: number, decimals = 0): string {
  if (n === undefined || n === null || isNaN(n)) return '0';
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatHoldTtl(
  holdExpiresAt?: string,
  createdAt?: string,
  t?: (key: string, fallback?: string) => string
): { label: string; isExpiringSoon: boolean } {
  const expiryDate = holdExpiresAt
    ? new Date(holdExpiresAt)
    : createdAt
    ? new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000)
    : null;

  if (!expiryDate) {
    return { label: t ? t('reservations.ttl_24h', 'Hold TTL 24ч') : 'Hold TTL 24ч', isExpiringSoon: false };
  }

  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return {
      label: t ? t('reservations.ttl_expired', 'Срок брони истек (ожидает расформирования)') : 'Срок брони истек (ожидает расформирования)',
      isExpiringSoon: true,
    };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  const isExpiringSoon = hours < 3;
  const timeStr = expiryDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const left = t ? t('reservations.ttl_left', 'Осталось') : 'Осталось';
  const hStr = t ? t('reservations.ttl_h', 'ч') : 'ч';
  const mStr = t ? t('reservations.ttl_m', 'мин') : 'мин';
  const until = t ? t('reservations.ttl_until', 'до') : 'до';

  return {
    label: `${left} ${hours}${hStr} ${minutes}${mStr} (${until} ${timeStr})`,
    isExpiringSoon,
  };
}

export function StockReservationsModal({ isOpen, onClose, filterSku }: StockReservationsModalProps) {
  const { t } = useLanguage();
  const [reservations, setReservations] = useState<ActiveReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processing'>('all');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActiveReservations({ sku: filterSku });
      if (data?.success && Array.isArray(data.reservations)) {
        setReservations(data.reservations);
      } else {
        throw new Error(data?.error || 'Не удалось получить данные резервов');
      }
    } catch (err: any) {
      console.warn('[StockReservationsModal] Load error:', err);
      setError(err?.message || 'Ошибка загрузки резервов');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, filterSku]);

  const toggleExpand = (id: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredReservations = useMemo(() => {
    return reservations.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchCompany = (r.client_company || '').toLowerCase().includes(q);
        const matchName = (r.client_name || '').toLowerCase().includes(q);
        const matchPhone = (r.client_phone || '').toLowerCase().includes(q);
        const matchOrder = (r.order_number || '').toLowerCase().includes(q);
        const matchItems = r.items.some(
          it => (it.product_name || '').toLowerCase().includes(q) || (it.collection || '').toLowerCase().includes(q) || (it.sku || '').toLowerCase().includes(q)
        );
        return matchCompany || matchName || matchPhone || matchOrder || matchItems;
      }
      return true;
    });
  }, [reservations, statusFilter, searchQuery]);

  const totalFilteredPcs = useMemo(
    () => filteredReservations.reduce((sum, r) => sum + r.total_items, 0),
    [filteredReservations]
  );

  const totalFilteredSqm = useMemo(
    () => Math.round(filteredReservations.reduce((sum, r) => sum + r.total_sqm, 0) * 100) / 100,
    [filteredReservations]
  );

  const uniqueClientsCount = useMemo(
    () => new Set(filteredReservations.map(r => r.client_company || r.client_name).filter(Boolean)).size,
    [filteredReservations]
  );

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs animate-modal-backdrop modal-gpu-backdrop pointer-events-none" aria-hidden="true" />
        <div
          className="relative flex flex-col w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden animate-modal-card modal-gpu-card z-10"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50/50">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800 shadow-2xs">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                  <span>{t('reservations.title')}</span>
                  <span className="badge bg-amber-100 text-amber-800 text-[11px] font-mono">
                    {reservations.length} {t('reservations.orders_badge')}
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  {t('reservations.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/60 transition-colors cursor-pointer disabled:opacity-50"
                title={t('reservations.refresh')}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-brand-600' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition-colors cursor-pointer"
                title={t('common.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 px-5 py-3 border-b border-slate-100 bg-white text-xs select-none">
            <div className="rounded-xl bg-amber-50/60 border border-amber-200/80 p-2.5 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white shrink-0">
                <Package className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-amber-800">{t('reservations.total_in_reserve')}</p>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 font-mono">
                  {fmtNum(totalFilteredPcs)} <span className="text-xs font-medium text-slate-500">{t('common.pcs')}</span>
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50/60 border border-emerald-200/80 p-2.5 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shrink-0">
                <Layers className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-emerald-800">{t('reservations.total_area')}</p>
                <p className="text-sm sm:text-base font-extrabold text-emerald-950 font-mono">
                  {fmtNum(totalFilteredSqm, 2)} <span className="text-xs font-medium text-emerald-700">{t('common.sqm')}</span>
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-indigo-50/60 border border-indigo-200/80 p-2.5 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shrink-0">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-bold text-indigo-800">{t('reservations.clients')}</p>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 font-mono">
                  {uniqueClientsCount} <span className="text-xs font-medium text-slate-500">{t('reservations.counterparties')}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/30">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('reservations.search_placeholder')}
                className="input-field pl-9 py-1.5 text-xs w-full bg-white"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-brand-700 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('reservations.tab_all')} ({reservations.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('pending')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  statusFilter === 'pending'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('reservations.tab_auto')} ({reservations.filter(r => r.status === 'pending').length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('processing')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  statusFilter === 'processing'
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('reservations.tab_assembly')} ({reservations.filter(r => r.status === 'processing').length})
              </button>
            </div>
          </div>

          {/* List of Reservations */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
            {loading ? (
              <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
                <RefreshCw className="h-7 w-7 animate-spin text-amber-500" />
                <p className="text-xs font-medium">{t('reservations.loading')}</p>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-800 flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{t('common.error')}</p>
                  <p className="mt-0.5">{error}</p>
                </div>
              </div>
            ) : filteredReservations.length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <Clock className="h-10 w-10 mx-auto text-slate-300 mb-2.5" />
                <p className="text-sm font-semibold text-slate-700">{t('reservations.empty_title')}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {searchQuery ? t('reservations.empty_search') : t('reservations.empty_desc')}
                </p>
              </div>
            ) : (
              filteredReservations.map(res => {
                const isExpanded = expandedOrders.has(res.id);
                const ttl = formatHoldTtl(res.hold_expires_at, res.created_at, t);

                return (
                  <div
                    key={res.id}
                    className="card border-slate-200 hover:border-amber-300 transition-all overflow-hidden"
                  >
                    {/* Top Row: Client & Order Summary */}
                    <div
                      className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer bg-white hover:bg-slate-50/50 select-none"
                      onClick={() => toggleExpand(res.id)}
                    >
                      <div className="flex items-start sm:items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 font-bold text-sm shrink-0">
                          {(res.client_company || res.client_name || 'K').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm truncate">
                              {res.client_company || res.client_name}
                            </span>
                            {res.client_company && res.client_name && res.client_company !== res.client_name && (
                              <span className="text-xs text-slate-500 truncate">
                                ({res.client_name})
                              </span>
                            )}
                            <span
                              className={`badge text-[10px] font-bold ${
                                res.status === 'processing'
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {res.status === 'processing' ? t('reservations.status_assembly') : t('reservations.status_auto')}
                            </span>
                          </div>

                          <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
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
                        </div>
                      </div>

                      {/* Right side: Volume and expand action */}
                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                        <div className="text-left sm:text-right">
                          <p className="text-xs font-extrabold text-slate-900 font-mono">
                            {res.total_items} {t('common.pcs')} <span className="text-amber-700 font-semibold font-mono">({res.total_sqm} {t('common.sqm')})</span>
                          </p>
                          <div className={`text-[11px] font-medium flex items-center gap-1 sm:justify-end ${ttl.isExpiringSoon ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                            <Clock className="h-3 w-3 shrink-0" />
                            <span>{ttl.label}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                          aria-label={t('reservations.show_composition')}
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
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
                                    {item.sku && <span className="font-mono text-[10px] text-slate-400">{t('reservations.art_label')} {item.sku}</span>}
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
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-5 py-3.5 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
            <span className="text-[11px]">
              {t('reservations.footer_warning')}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary !py-1.5 !px-4 text-xs font-semibold cursor-pointer"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default StockReservationsModal;
