import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FileSpreadsheet,
  Download,
  AlertTriangle,
  Printer,
  Search,
  Building2,
  Store,
  FileText,
  UserCheck,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { fetchSupplierDiscrepancyAct } from '@/lib/erpApi';
import type { DiscrepancyActResponse } from '@/types';
import { DiscrepancyActItemsTable } from './DiscrepancyActItemsTable';

export interface DiscrepancyActModalProps {
  receiptId: number;
  initialActNumber?: string | null;
  excelDownloadUrl?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DiscrepancyActModal({
  receiptId,
  initialActNumber,
  excelDownloadUrl: initialExcelUrl,
  isOpen,
  onClose,
}: DiscrepancyActModalProps) {
  const [actData, setActData] = useState<DiscrepancyActResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'discrepancies'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !receiptId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchSupplierDiscrepancyAct(receiptId)
      .then((data) => {
        if (cancelled) return;
        if (data && data.success) {
          setActData(data);
        } else {
          setError(data?.error || 'Не удалось загрузить данные акта расхождения');
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('[DiscrepancyActModal] Error loading act:', err);
        setError(err?.message || 'Ошибка связи со шлюзом ERP');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, receiptId]);

  // Закрытие по клавише Esc
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const rawItems = actData?.items || [];

  const filteredItems = useMemo(() => {
    return rawItems.filter((item) => {
      if (filterMode === 'discrepancies') {
        const isDiff = item.status !== 'matched' || item.diff_qty !== 0;
        if (!isDiff) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const articleMatch = item.article.toLowerCase().includes(q);
        const nameMatch = item.name.toLowerCase().includes(q);
        const barcodeMatch = item.barcode ? item.barcode.toLowerCase().includes(q) : false;
        return articleMatch || nameMatch || barcodeMatch;
      }
      return true;
    });
  }, [rawItems, filterMode, searchQuery]);

  if (!isOpen) return null;

  const downloadUrl = actData?.excel_download_url || initialExcelUrl;
  const actNumber = actData?.act_number || initialActNumber || 'АКТ-РАСХОЖДЕНИЙ';
  const summary = actData?.summary;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модального окна */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-amber-100 text-amber-800 shrink-0">
              <FileSpreadsheet className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base sm:text-lg leading-tight truncate">
                  Акт о расхождениях при приёмке
                </h3>
                <span className="font-mono text-xs sm:text-sm font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-md">
                  {actNumber}
                </span>
                {actData?.act_date_formatted && (
                  <span className="text-xs text-slate-500">
                    от {actData.act_date_formatted}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                Сопоставление отгрузочных документов поставщика и фактического сканирования WMS/ТСД
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {downloadUrl && (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                title="Скачать Акт о расхождении (.xlsx)"
              >
                <Download className="h-3.5 w-3.5" />
                Скачать (.xlsx)
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Тело модального окна */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {loading ? (
            <div className="py-20 text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-brand-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-700">Загрузка акта расхождений из 1С:ERP...</p>
              <p className="text-xs text-slate-400 mt-1">Опрос электронного реестра приёмки склада</p>
            </div>
          ) : error ? (
            <div className="p-6 rounded-xl border border-red-200 bg-red-50 text-red-900 space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                Не удалось сформировать электронный просмотр акта
              </div>
              <p className="text-xs text-red-700">{error}</p>
              {downloadUrl && (
                <div className="pt-2">
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    Скачать оригинальный файл Excel (.xlsx) напрямую
                  </a>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Реквизиты документа и сторон */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Building2 className="h-3 w-3 text-slate-500" />
                    Поставщик
                  </span>
                  <p className="font-bold text-slate-900 truncate">
                    {actData?.supplier?.name || 'Поставщик'}
                  </p>
                  <p className="text-slate-500 text-[11px] truncate">
                    {actData?.supplier?.country ? `Страна: ${actData.supplier.country}` : ''}
                    {actData?.supplier?.bin ? ` • БИН: ${actData.supplier.bin}` : ''}
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Store className="h-3 w-3 text-slate-500" />
                    Склад приёмки
                  </span>
                  <p className="font-bold text-slate-900 truncate">
                    {actData?.warehouse?.name || 'Основной Склад Астана'}
                  </p>
                  <p className="text-slate-500 text-[11px] truncate">
                    {actData?.warehouse?.city || 'Астана'}
                    {actData?.warehouse?.address ? `, ${actData.warehouse.address}` : ''}
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <FileText className="h-3 w-3 text-slate-500" />
                    Основание
                  </span>
                  <p className="font-bold text-slate-900 truncate">
                    {actData?.documents?.incoming_doc_number && actData.documents.incoming_doc_number !== 'Не указан'
                      ? `ТТН: ${actData.documents.incoming_doc_number}`
                      : `Ордер: ${actData?.documents?.receipt_doc_number || ''}`}
                  </p>
                  <p className="text-slate-500 text-[11px] truncate">
                    Ордер: {actData?.documents?.receipt_doc_number || 'ПР-2610-0001'}
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <UserCheck className="h-3 w-3 text-slate-500" />
                    Комиссия склада
                  </span>
                  <p className="font-bold text-slate-900 truncate">
                    {actData?.auditor?.name || 'Комиссия WMS'}
                  </p>
                  <p className="text-slate-500 text-[11px] truncate">
                    {actData?.auditor?.role || 'Председатель комиссии по приёмке'}
                  </p>
                </div>
              </div>

              {/* Сводные показатели расхождений (KPI) */}
              {summary && (
                <div className="p-3.5 sm:p-4 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50/60 to-orange-50/40 space-y-3">
                  <div className="grid grid-cols-3 divide-x divide-amber-200/70 text-center">
                    <div className="px-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                        1. По документам (План)
                      </p>
                      <p className="text-base sm:text-xl font-bold text-slate-900 mt-0.5">
                        {summary.plan_qty.toLocaleString('ru-RU')}{' '}
                        <span className="text-xs font-normal text-slate-500">шт</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {summary.plan_sqm.toFixed(1)} м²
                      </p>
                    </div>

                    <div className="px-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                        2. Фактически принято
                      </p>
                      <p className="text-base sm:text-xl font-bold text-emerald-800 mt-0.5">
                        {summary.fact_qty.toLocaleString('ru-RU')}{' '}
                        <span className="text-xs font-normal text-emerald-600">шт</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {summary.fact_sqm.toFixed(1)} м²
                      </p>
                    </div>

                    <div className="px-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                        3. Расхождение (Дельта)
                      </p>
                      <p className={`text-base sm:text-xl font-bold mt-0.5 ${summary.diff_qty < 0 ? 'text-amber-800' : summary.diff_qty > 0 ? 'text-blue-800' : 'text-emerald-800'}`}>
                        {summary.diff_qty > 0 ? `+${summary.diff_qty}` : summary.diff_qty}{' '}
                        <span className="text-xs font-normal">шт</span>
                      </p>
                      <p className="text-xs font-medium text-slate-600 mt-0.5">
                        {summary.diff_sqm > 0 ? `+${summary.diff_sqm.toFixed(1)}` : summary.diff_sqm.toFixed(1)} м²
                      </p>
                    </div>
                  </div>

                  {/* Разбивка по типам замечаний */}
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-2 border-t border-amber-200/60 text-xs">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-medium">
                      Недостача: <strong>{summary.shortage_count} поз.</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 text-blue-900 font-medium">
                      Излишек: <strong>{summary.surplus_count} поз.</strong>
                    </span>
                    {(summary.unplanned_count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-100 text-purple-900 font-medium">
                        Пересорт: <strong>{summary.unplanned_count} поз.</strong>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 font-medium">
                      Совпало: <strong>{summary.matched_count} поз.</strong>
                    </span>
                    <span className="text-slate-400 text-xs ml-auto hidden sm:inline">
                      Всего позиций в акте: {summary.total_positions}
                    </span>
                  </div>
                </div>
              )}

              {/* Панель фильтра и поиска по позициям */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      filterMode === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Все позиции ({rawItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('discrepancies')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                      filterMode === 'discrepancies'
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                    }`}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    Только расхождения
                  </button>
                </div>

                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск по артикулу, штрихкоду..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-brand-500 bg-white"
                  />
                </div>
              </div>

              {/* Таблица позиций (модульный компонент) */}
              <DiscrepancyActItemsTable items={filteredItems} />
            </>
          )}
        </div>

        {/* Подвал модального окна */}
        <div className="px-4 py-3 sm:px-6 sm:py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 text-center sm:text-left">
            Акт заверен подписями комиссии склада и готов к экспорту в 1С:ERP
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              Печать
            </button>
            {downloadUrl && (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Скачать Акт о расхождении (.xlsx)
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DiscrepancyActModal;
