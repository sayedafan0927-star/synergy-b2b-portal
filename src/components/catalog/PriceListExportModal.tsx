import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Download, FileSpreadsheet, Search, ShieldCheck, Layers, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchClientDebtFromErp } from '@/lib/erpApi';
import { formatPriceType, normalizeToErpPriceType, resolveContractPriceType } from '@/lib/pricingEngine';
import {
  ERP_SELLING_PRICE_TYPES,
  fetchErpPriceListRows,
  getCachedPriceListRows,
  exportPriceListToExcel,
  exportPriceListToCsv,
  formatSqmPriceUe,
  type CollectionPriceRow,
} from '@/lib/priceListExport';
import type { Product } from '@/types';

const EMPTY_PRODUCTS: Product[] = [];

export interface PriceListExportModalProps {
  open: boolean;
  onClose: () => void;
  fallbackProducts?: Product[];
  clientContracts?: any[];
}

export function PriceListExportModal({
  open,
  onClose,
  fallbackProducts = EMPTY_PRODUCTS,
  clientContracts,
}: PriceListExportModalProps) {
  const { profile, isAdmin, isManager, isImpersonating } = useAuth();
  const isAdminView = Boolean(!isImpersonating && (isAdmin || profile?.role === 'admin'));
  const isStaffMode = Boolean(
    !isImpersonating &&
      profile &&
      (isAdmin || isManager || profile.role === 'admin' || profile.role === 'manager_rm' || profile.role === 'manager_lm')
  );

  const [resolvedClientPriceType, setResolvedClientPriceType] = useState<string>(() =>
    resolveContractPriceType(profile, clientContracts, profile?.price_type || 'price_deferred')
  );
  const [resolvedContractName, setResolvedContractName] = useState<string>('');
  const [selectedStaffType, setSelectedStaffType] = useState<string>('all');
  const [rows, setRows] = useState<CollectionPriceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');

  const fallbackProductsRef = useRef<Product[]>(fallbackProducts);
  fallbackProductsRef.current = fallbackProducts;

  // Для клиента подтягиваем актуальный вид цены напрямую из его договора ERP
  useEffect(() => {
    if (!open || isStaffMode || !profile) return;

    if (Array.isArray(clientContracts) && clientContracts.length > 0) {
      const defCt = clientContracts.find((c: any) => c.is_default) || clientContracts[0];
      const pt = resolveContractPriceType(profile, clientContracts, profile.price_type);
      setResolvedClientPriceType(pt);
      setResolvedContractName(defCt?.contract_number || defCt?.name || '');
      return;
    }

    let cancelled = false;
    const partnerId = profile.partner_id ? Number(profile.partner_id) : undefined;
    const phone = profile.phone || undefined;
    if (partnerId || phone) {
      fetchClientDebtFromErp({ counterpartyId: partnerId, phone, includeInvoices: false })
        .then(res => {
          if (cancelled || !res?.success) return;
          const cts = Array.isArray(res.contracts) ? res.contracts : [];
          const defCt = cts.find((c: any) => c.is_default) || cts[0];
          const pt = resolveContractPriceType(res.client || profile, cts, profile.price_type);
          setResolvedClientPriceType(pt);
          if (defCt?.name || (defCt as any)?.contract_number) {
            setResolvedContractName((defCt as any)?.contract_number || defCt.name || '');
          }
        })
        .catch(() => {});
    } else {
      setResolvedClientPriceType(normalizeToErpPriceType(profile.price_type));
    }
    return () => {
      cancelled = true;
    };
  }, [open, isStaffMode, profile, clientContracts]);

  const effectivePriceType = isStaffMode ? selectedStaffType : resolvedClientPriceType;

  // Фоновый прогрев прайс-листа при заходе в Личный кабинет (чтобы открытие окна занимало 0 мс)
  useEffect(() => {
    if (!profile || open) return;
    const cached = getCachedPriceListRows(effectivePriceType, isStaffMode);
    if (cached && cached.length > 0) {
      setRows(cached);
      return;
    }
    const timer = setTimeout(() => {
      fetchErpPriceListRows({
        priceType: effectivePriceType,
        isStaff: isStaffMode,
        fallbackProducts: fallbackProductsRef.current,
      })
        .then(data => {
          if (data.length > 0) setRows(data);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [profile, open, effectivePriceType, isStaffMode]);

  useEffect(() => {
    if (!open) return;

    const cached = getCachedPriceListRows(effectivePriceType, isStaffMode);
    if (cached && cached.length > 0) {
      setRows(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchErpPriceListRows({
      priceType: effectivePriceType,
      isStaff: isStaffMode,
      fallbackProducts: fallbackProductsRef.current,
      onPartialRows: partial => {
        if (!cancelled && partial.length > 0) {
          setRows(partial);
          setLoading(false);
        }
      },
    })
      .then(data => {
        if (!cancelled) setRows(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, effectivePriceType, isStaffMode]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      r =>
        r.collection.toLowerCase().includes(q) ||
        (isAdminView && r.manufacturer.toLowerCase().includes(q)) ||
        r.country.toLowerCase().includes(q)
    );
  }, [rows, search, isAdminView]);

  if (!open) return null;

  const isAllTypesView = isStaffMode && effectivePriceType === 'all';
  const clientName = !isStaffMode ? profile?.company_name || profile?.full_name || undefined : undefined;

  const handleDownloadExcel = () => {
    exportPriceListToExcel({
      rows: filteredRows,
      priceType: effectivePriceType,
      isStaff: isStaffMode,
      showFactory: isAdminView,
      clientName,
      contractNumber: resolvedContractName || undefined,
    });
  };

  const handleDownloadCsv = () => {
    exportPriceListToCsv({
      rows: filteredRows,
      priceType: effectivePriceType,
      isStaff: isStaffMode,
      showFactory: isAdminView,
      clientName,
      contractNumber: resolvedContractName || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/80 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#003365] text-white shadow-xs">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                {isStaffMode ? 'Выгрузка прайс-листа цен ERP' : 'Прайс-лист по вашему договору'}
              </h2>
              <p className="text-xs text-slate-500">
                {isStaffMode
                  ? 'Актуальные продажные цены коллекций за 1 м² (в у.е.) напрямую из ERP'
                  : 'Индивидуальные оптовые цены коллекций за 1 м² (в у.е.) согласно вашему договору'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Controls Bar: Staff Price Type Selector OR Client Contract Badge */}
        <div className="border-b border-slate-200 bg-white px-5 py-3.5 space-y-3">
          {isStaffMode ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-[#003365]" />
                  Продажный вид цены из ERP:
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  Единица расчёта: <strong className="text-slate-800">за 1 м² (у.е.)</strong>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedStaffType('all')}
                  className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    selectedStaffType === 'all'
                      ? 'bg-[#003365] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Все продажные виды цен (Сводный)
                </button>
                {ERP_SELLING_PRICE_TYPES.map(pt => (
                  <button
                    key={pt.code}
                    type="button"
                    onClick={() => setSelectedStaffType(pt.code)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                      selectedStaffType === pt.code
                        ? 'bg-[#003365] text-white shadow-xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50/70 border border-brand-200/80 px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 text-brand-700 shrink-0" />
                <div className="text-xs">
                  <span className="text-slate-600">Ваш вид цены по договору: </span>
                  <strong className="font-bold text-brand-900">{formatPriceType(resolvedClientPriceType)}</strong>
                  {resolvedContractName && (
                    <span className="ml-1.5 text-slate-500">({resolvedContractName})</span>
                  )}
                </div>
              </div>
              <span className="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 border border-slate-200">
                Цены за 1 м² в у.е.
              </span>
            </div>
          )}

          {/* Search & Count */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isAdminView ? 'Поиск по коллекции или фабрике...' : 'Поиск по коллекции...'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-brand-500 focus:bg-white outline-none"
              />
            </div>
            <div className="text-xs text-slate-500">
              Доступно коллекций: <strong className="text-slate-800">{filteredRows.length}</strong>
            </div>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2.5">
              <Loader2 className="h-6 w-6 animate-spin text-[#003365]" />
              <span className="text-xs font-medium">Загрузка актуального прайс-листа из ERP...</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">
              Коллекции по заданному фильтру не найдены.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#003365] text-white font-semibold">
                    <th className="py-2.5 px-3 text-center w-10">№</th>
                    <th className="py-2.5 px-3.5">Коллекция</th>
                    <th className="py-2.5 px-3">{isAdminView ? 'Фабрика / Страна' : 'Страна'}</th>
                    <th className="py-2.5 px-3 hidden sm:table-cell">Характеристики</th>
                    {isAllTypesView ? (
                      <>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">По факту (за 1 м²)</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">С отсрочкой (за 1 м²)</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Комиссия (за 1 м²)</th>
                      </>
                    ) : (
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Цена за 1 м² (у.е.)</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((row, idx) => (
                    <tr key={row.collection} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-2.5 px-3.5 font-bold text-slate-900 text-sm">{row.collection}</td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {isAdminView && row.manufacturer !== '—' ? `${row.manufacturer} (${row.country})` : row.country}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 hidden sm:table-cell">
                        {[
                          row.density !== '—' ? row.density : '',
                          row.pileHeight !== '—' ? `ворс ${row.pileHeight}` : '',
                        ]
                          .filter(Boolean)
                          .join(' • ') || '—'}
                      </td>
                      {isAllTypesView ? (
                        <>
                          <td className="py-2.5 px-3 text-right font-bold text-[#003365] bg-sky-50/40 whitespace-nowrap">
                            {formatSqmPriceUe(row.pricesByType['price_cash'] || row.pricePerSqm)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-800 bg-emerald-50/40 whitespace-nowrap">
                            {formatSqmPriceUe(row.pricesByType['price_deferred'] || row.pricePerSqm)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-amber-900 bg-amber-50/50 whitespace-nowrap">
                            {formatSqmPriceUe(row.pricesByType['price_commission'] || row.pricePerSqm)}
                          </td>
                        </>
                      ) : (
                        <td className="py-2.5 px-3.5 text-right font-bold text-[#003365] text-sm bg-sky-50/40 whitespace-nowrap">
                          {formatSqmPriceUe(row.pricePerSqm)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <span className="text-[11px] text-slate-500">
            * В выгружаемом файле Excel все цены указаны за 1 м² в <strong>у.е.</strong>
          </span>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={loading || filteredRows.length === 0}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer"
            >
              Скачать CSV
            </button>
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={loading || filteredRows.length === 0}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>Скачать прайс-лист Excel (.xls)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
