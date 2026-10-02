import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Search,
  Clock,
  RefreshCw,
  ShieldAlert,
  AlertCircle,
  Building2,
} from 'lucide-react';
import { fetchActiveReservations, type ActiveReservation } from '@/lib/erpApi';
import { Portal } from '@/components/common/Portal';
import { useLanguage } from '@/contexts/LanguageContext';
import { ReservationMetricsBar } from './reservations/ReservationMetricsBar';
import { ReservationCard, clean1CName } from './reservations/ReservationCard';

interface StockReservationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  filterSku?: string;
  catalogSkus?: string[];
  initialTab?: 'all' | 'processing' | 'pending' | 'expired';
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
): { label: string; isExpiringSoon: boolean; isExpired: boolean } {
  const expiryDate = holdExpiresAt
    ? new Date(holdExpiresAt)
    : createdAt
    ? new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000)
    : null;

  if (!expiryDate) {
    return {
      label: t ? t('reservations.ttl_24h', 'Hold TTL 24ч') : 'Hold TTL 24ч',
      isExpiringSoon: false,
      isExpired: false,
    };
  }

  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return {
      label: t
        ? t('reservations.ttl_expired', 'Срок брони истек (ожидает расформирования)')
        : 'Срок брони истек (ожидает расформирования)',
      isExpiringSoon: true,
      isExpired: true,
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
    isExpired: false,
  };
}

export function StockReservationsModal({
  isOpen,
  onClose,
  filterSku,
  catalogSkus,
  initialTab,
}: StockReservationsModalProps) {
  const { t } = useLanguage();
  const [reservations, setReservations] = useState<ActiveReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'catalog' | 'all'>('catalog');
  const [statusFilter, setStatusFilter] = useState<'all' | 'processing' | 'pending' | 'expired'>('all');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  const hasCatalogContext = Boolean(catalogSkus && catalogSkus.length > 0);

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
      if (hasCatalogContext) {
        setScopeFilter('catalog');
      } else {
        setScopeFilter('all');
      }
      setStatusFilter(initialTab || 'all');
    }
  }, [isOpen, filterSku, hasCatalogContext, initialTab]);

  const toggleExpand = (id: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isOrderMatchingCatalog = useCallback(
    (r: ActiveReservation) => {
      if (!catalogSkus || catalogSkus.length === 0) return true;
      const lowerSkus = catalogSkus.map(s => s.toLowerCase().trim());
      return r.items.some(it => {
        const itSku = (it.sku || '').toLowerCase().trim();
        const cleaned = clean1CName(it.product_name);
        const itName = cleaned.name.toLowerCase().trim();
        const itRaw = (it.product_name || '').toLowerCase().trim();
        const itCol = (it.collection || cleaned.collection || '').toLowerCase().trim();
        return lowerSkus.some(
          cs =>
            itSku.includes(cs) ||
            cs.includes(itSku) ||
            itName.includes(cs) ||
            itRaw.includes(cs) ||
            itCol.includes(cs)
        );
      });
    },
    [catalogSkus]
  );

  const catalogMatchedReservations = useMemo(() => {
    return reservations.filter(isOrderMatchingCatalog);
  }, [reservations, isOrderMatchingCatalog]);

  const baseScopedReservations = useMemo(() => {
    if (hasCatalogContext && scopeFilter === 'catalog') {
      return catalogMatchedReservations;
    }
    return reservations;
  }, [reservations, hasCatalogContext, scopeFilter, catalogMatchedReservations]);

  const countAll = baseScopedReservations.length;
  const countAssembly = useMemo(
    () => baseScopedReservations.filter(r => r.status === 'processing').length,
    [baseScopedReservations]
  );
  const countAuto = useMemo(
    () => baseScopedReservations.filter(r => r.status === 'pending' && !formatHoldTtl(r.hold_expires_at, r.created_at).isExpired).length,
    [baseScopedReservations]
  );
  const countExpired = useMemo(
    () => baseScopedReservations.filter(r => formatHoldTtl(r.hold_expires_at, r.created_at).isExpired).length,
    [baseScopedReservations]
  );

  const filteredReservations = useMemo(() => {
    return baseScopedReservations.filter(r => {
      const isExpired = formatHoldTtl(r.hold_expires_at, r.created_at).isExpired;
      if (statusFilter === 'processing' && r.status !== 'processing') return false;
      if (statusFilter === 'pending' && (r.status !== 'pending' || isExpired)) return false;
      if (statusFilter === 'expired' && !isExpired) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchCompany = (r.client_company || '').toLowerCase().includes(q);
        const matchName = (r.client_name || '').toLowerCase().includes(q);
        const matchPhone = (r.client_phone || '').toLowerCase().includes(q);
        const matchOrder = (r.order_number || '').toLowerCase().includes(q);
        const matchItems = r.items.some(
          it =>
            (it.product_name || '').toLowerCase().includes(q) ||
            clean1CName(it.product_name).name.toLowerCase().includes(q) ||
            (it.collection || '').toLowerCase().includes(q) ||
            (it.sku || '').toLowerCase().includes(q)
        );
        return matchCompany || matchName || matchPhone || matchOrder || matchItems;
      }
      return true;
    });
  }, [baseScopedReservations, statusFilter, searchQuery]);

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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs animate-modal-backdrop modal-gpu-backdrop pointer-events-none" aria-hidden="true" />
        <div
          className="relative flex flex-col w-full max-w-4xl max-h-[94vh] sm:max-h-[88vh] rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden animate-modal-card modal-gpu-card z-10"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 sm:px-5 py-3.5 bg-slate-50/50">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800 shadow-2xs shrink-0">
                <Clock className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm sm:text-lg font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                  <span>{t('reservations.title')}</span>
                  <span className="badge bg-amber-100 text-amber-800 text-[11px] font-mono">
                    {filteredReservations.length} {t('reservations.orders_badge')}
                  </span>
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                  {t('reservations.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/60 transition-colors cursor-pointer disabled:opacity-50"
                title={t('reservations.refresh')}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-brand-600' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition-colors cursor-pointer"
                title={t('common.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar (Zero-overflow responsive) */}
          <ReservationMetricsBar
            totalPcs={totalFilteredPcs}
            totalSqm={totalFilteredSqm}
            uniqueClientsCount={uniqueClientsCount}
            fmtNum={fmtNum}
          />

          {/* Scope & Hold State Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-3 sm:px-5 py-2.5 bg-slate-50/60 border-b border-slate-100 text-xs select-none">
            {/* Scope Switcher: Catalog vs All Warehouse */}
            {hasCatalogContext ? (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setScopeFilter('catalog')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    scopeFilter === 'catalog'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'bg-white border border-amber-200 text-amber-900 hover:bg-amber-50'
                  }`}
                >
                  {t('reservations.scope_catalog')} ({catalogMatchedReservations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    scopeFilter === 'all'
                      ? 'bg-slate-800 text-white shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t('reservations.scope_all')} ({reservations.length})
                </button>
              </div>
            ) : <div />}

            {/* Status Switcher: All, Assembly, Auto-reserve, Expired */}
            <div className="flex items-center gap-1.5 self-start sm:self-auto overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-brand-700 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('reservations.tab_all')} ({countAll})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('processing')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  statusFilter === 'processing'
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-indigo-700 hover:bg-indigo-50'
                }`}
              >
                {t('reservations.tab_assembly')} ({countAssembly})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('pending')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  statusFilter === 'pending'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t('reservations.tab_auto')} ({countAuto})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('expired')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  statusFilter === 'expired'
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-rose-700 hover:bg-rose-50'
                }`}
              >
                {t('reservations.tab_expired')} ({countExpired})
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="px-3 sm:px-5 py-2 border-b border-slate-100 bg-white">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('reservations.search_placeholder')}
                className="input-field pl-9 py-1.5 text-xs w-full bg-slate-50/50 focus:bg-white"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* List of Reservations */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3">
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
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  {searchQuery ? t('reservations.empty_search') : t('reservations.empty_desc')}
                </p>
                {holdTypeFilter === 'active' && expiredHoldCount > 0 && !searchQuery && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setHoldTypeFilter('expired')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300/80 text-xs font-semibold transition-all cursor-pointer shadow-2xs"
                    >
                      <span>Показать истекшие резервы ({expiredHoldCount})</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredReservations.map(res => (
                <ReservationCard
                  key={res.id}
                  reservation={res}
                  isExpanded={expandedOrders.has(res.id)}
                  isCatalogMatch={isOrderMatchingCatalog(res)}
                  onToggleExpand={() => toggleExpand(res.id)}
                  formatTtl={(hold, created) => formatHoldTtl(hold, created, t)}
                />
              ))
            )}
          </div>

          {/* Footer (Zero emojis, clean SVG icon) */}
          <div className="border-t border-slate-100 px-4 sm:px-5 py-3 bg-slate-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-[11px] leading-tight">
                {t('reservations.footer_warning')}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary !py-1.5 !px-4 text-xs font-semibold cursor-pointer shrink-0 self-end sm:self-auto"
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
