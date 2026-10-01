import { useState, useRef, useMemo } from 'react';
import {
  FileSpreadsheet,
  Upload,
  X,
  ShoppingCart,
  Download,
  ClipboardPaste,
} from 'lucide-react';
import { Portal } from '@/components/common/Portal';
import { useProducts } from '@/hooks/useProductData';
import { useUserPricing } from '@/hooks/usePricing';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useCart } from '@/contexts/CartContext';
import { useToast } from '@/contexts/ToastContext';
import { normalizeDimensions } from '@/lib/searchNormalization';
import { BulkParsedRowItem, type ParsedBulkRow } from './bulk/BulkParsedRowItem';
import type { Product, ProductVariant } from '@/types';

export interface ExcelBulkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExcelBulkOrderModal({ isOpen, onClose }: ExcelBulkOrderModalProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedBulkRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { products } = useProducts();
  const { getVariantPrice } = useUserPricing();
  const { formatPrice } = useCurrency();
  const { addItem } = useCart();
  const { success: toastSuccess, error: toastError } = useToast();

  const handleDownloadTemplate = () => {
    const csvContent = 'Артикул;Размер;Количество\nFLORA 9568B;2x3;5\nSILK ROAD 102;1.6x2.3;2\nVINTAGE 405;2.4x3.4;1';
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'synergy_b2b_bulk_order_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const processRawLines = (lines: string[]) => {
    const results: ParsedBulkRow[] = [];

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.toLowerCase().includes('артикул') || trimmed.toLowerCase().includes('sku')) {
        continue;
      }

      const parts = trimmed.split(/[\t;,]+/).map(p => p.trim());
      if (parts.length < 2) continue;

      const rawArticle = parts[0];
      const rawSize = normalizeDimensions(parts[1]);
      const rawQty = parts[2] ? parseInt(parts[2].replace(/\D+/g, ''), 10) || 1 : 1;

      const cleanArt = rawArticle.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      let matchedProduct: Product | undefined;
      let matchedVariant: ProductVariant | undefined;

      for (const prod of products) {
        const prodArt = (prod.article || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const prodCol = (prod.collection || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

        if (prodArt.includes(cleanArt) || prodCol.includes(cleanArt) || cleanArt.includes(prodArt) || cleanArt.includes(prodCol)) {
          const cleanSize = rawSize.toLowerCase().replace(/\s+/g, '');
          const vMatch = prod.variants.find(v => {
            const vSize = normalizeDimensions(v.size).toLowerCase().replace(/\s+/g, '');
            return vSize === cleanSize || vSize.includes(cleanSize) || cleanSize.includes(vSize);
          });

          if (vMatch) {
            matchedProduct = prod;
            matchedVariant = vMatch;
            break;
          }
        }
      }

      if (matchedProduct && matchedVariant) {
        const stock = matchedVariant.free_stock ?? matchedVariant.stock ?? 0;
        const price = getVariantPrice(matchedProduct.collection, matchedVariant.size, matchedVariant.base_price, matchedVariant.price_per_sqm);

        results.push({
          rawLine: trimmed,
          article: matchedProduct.collection || matchedProduct.article || rawArticle,
          size: matchedVariant.size,
          qty: rawQty,
          product: matchedProduct,
          variant: matchedVariant,
          status: stock >= rawQty ? 'matched' : (stock > 0 ? 'insufficient_stock' : 'not_found'),
          availableStock: stock,
          price,
        });
      } else {
        results.push({
          rawLine: trimmed,
          article: rawArticle,
          size: rawSize,
          qty: rawQty,
          status: 'not_found',
          availableStock: 0,
          price: 0,
        });
      }
    }

    setParsedRows(results);

    // Серверное доразрешение артикулов, если их не было в оперативной памяти клиента
    const notFoundIndices = results
      .map((r, i) => (r.status === 'not_found' ? i : -1))
      .filter(i => i >= 0);

    if (notFoundIndices.length > 0) {
      (async () => {
        try {
          const itemsToResolve = notFoundIndices.map(idx => ({
            article: results[idx].article,
            size: results[idx].size,
            qty: results[idx].qty,
            rawLine: String(idx),
          }));

          const response = await fetch('/api/catalog/resolve-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsToResolve }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data?.success && Array.isArray(data.results)) {
              let changed = false;
              for (const r of data.results) {
                const targetIdx = parseInt(r.rawLine, 10);
                if (!isNaN(targetIdx) && results[targetIdx] && r.status !== 'not_found' && r.product && r.variant) {
                  const fetched = r.product;
                  const vMatch = r.variant;
                  const price = getVariantPrice(fetched.collection || fetched.name, vMatch.size, vMatch.base_price, vMatch.price_per_sqm);
                  results[targetIdx] = {
                    ...results[targetIdx],
                    product: fetched,
                    variant: vMatch,
                    status: r.status,
                    availableStock: r.availableStock,
                    price,
                  };
                  changed = true;
                }
              }
              if (changed) {
                setParsedRows([...results]);
              }
            }
          }
        } catch (resolveErr) {
          console.warn('[ExcelBulkOrder] Batch resolution fallback:', resolveErr);
        }
      })();
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target?.result as string;
      if (content) {
        const lines = content.split(/\r\n|\n|\r/);
        processRawLines(lines);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleApplyToCart = () => {
    const validItems = parsedRows.filter(r => r.product && r.variant && r.availableStock > 0);
    if (validItems.length === 0) {
      toastError('Нет доступных к заказу позиций');
      return;
    }

    for (const row of validItems) {
      const prod = row.product!;
      const v = row.variant!;
      const orderQty = Math.min(row.qty, row.availableStock);
      const wh = v.warehouses?.[0]?.warehouse_name || 'Основной Склад Астана';
      const whId = v.warehouses?.[0]?.warehouse_id || 81;

      addItem({
        productId: prod.id,
        item_id: v.item_id,
        productName: prod.name,
        collection: prod.collection,
        image: prod.images[0] || '',
        size: v.size,
        sku: v.sku,
        warehouse: wh,
        warehouse_id: whId,
        price: row.price,
        price_per_sqm: v.price_per_sqm,
        area_sqm: v.area_sqm,
        maxStock: row.availableStock,
      }, orderQty);
    }

    toastSuccess(`В корзину успешно добавлено ${validItems.length} поз.`);
    onClose();
  };

  const summary = useMemo(() => {
    const matched = parsedRows.filter(r => r.status === 'matched').length;
    const partial = parsedRows.filter(r => r.status === 'insufficient_stock').length;
    const notFound = parsedRows.filter(r => r.status === 'not_found').length;
    const totalAmount = parsedRows.reduce((s, r) => s + (r.product ? r.price * Math.min(r.qty, r.availableStock) : 0), 0);
    return { matched, partial, notFound, totalAmount };
  }, [parsedRows]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
        <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-150 bg-slate-50/80">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Массовый заказ (Excel / CSV)</h3>
                <p className="text-xs text-slate-500">Загрузка файла со сметой или вставка списка артикулов</p>
              </div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Mode Switcher */}
          <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3 border-b border-slate-100">
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'upload' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Загрузка файла</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('paste')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'paste' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span>Вставка текста</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Шаблон CSV</span>
            </button>
          </div>

          {/* Main Area */}
          <div className="p-5 flex-1 overflow-y-auto space-y-4">
            {parsedRows.length === 0 ? (
              activeTab === 'upload' ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-250 hover:border-brand-400 rounded-2xl p-8 text-center bg-slate-50/50 hover:bg-brand-50/30 transition-all cursor-pointer"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                    }}
                  />
                  <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-3">
                    <Upload className="h-6 w-6" />
                  </div>
                  <p className="font-semibold text-slate-800 text-sm">Перетащите файл сюда или нажмите для выбора</p>
                  <p className="text-xs text-slate-400 mt-1">Поддерживаются форматы .csv и .txt с разделителями (точка с запятой или табуляция)</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    rows={6}
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    placeholder="Вставьте строки из Excel скопировав ячейки (Артикул [Tab] Размер [Tab] Количество):&#10;FLORA 9568B&#9;2x3&#9;5&#10;SILK ROAD&#9;1.6x2.3&#9;2"
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs font-mono text-slate-800 focus:outline-hidden focus:border-brand-500 bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={() => processRawLines(pastedText.split(/\r\n|\n|\r/))}
                    disabled={!pastedText.trim()}
                    className="btn-primary w-full py-2.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    Распознать позиции
                  </button>
                </div>
              )
            ) : (
              <div className="space-y-3">
                {/* Summary Badges */}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                    <span className="text-emerald-700 font-bold block text-sm">{summary.matched}</span>
                    <span className="text-emerald-600 text-[11px]">В наличии</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-100">
                    <span className="text-amber-700 font-bold block text-sm">{summary.partial}</span>
                    <span className="text-amber-600 text-[11px]">Частично</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-100">
                    <span className="text-rose-700 font-bold block text-sm">{summary.notFound}</span>
                    <span className="text-rose-600 text-[11px]">Не найдено</span>
                  </div>
                </div>

                {/* Parsed List Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                      <tr>
                        <th className="py-2 px-3">Статус</th>
                        <th className="py-2 px-3">Номенклатура</th>
                        <th className="py-2 px-3">Размер</th>
                        <th className="py-2 px-3 text-right">Запрос / Склад</th>
                        <th className="py-2 px-3 text-right">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedRows.map((row, i) => (
                        <BulkParsedRowItem
                          key={i}
                          row={row}
                          formatPrice={formatPrice}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={() => setParsedRows([])}
                  className="text-xs text-slate-500 hover:text-slate-700 underline cursor-pointer"
                >
                  Сбросить и загрузить другой файл
                </button>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          {parsedRows.length > 0 && (
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-150 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 block">Итого к добавлению:</span>
                <span className="text-sm font-bold text-slate-900">{formatPrice(summary.totalAmount)}</span>
              </div>
              <button
                type="button"
                onClick={handleApplyToCart}
                disabled={summary.matched + summary.partial === 0}
                className="btn-primary py-2 px-4 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>Добавить {summary.matched + summary.partial} поз. в корзину</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

export default ExcelBulkOrderModal;
