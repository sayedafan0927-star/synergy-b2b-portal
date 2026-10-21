import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, ArrowRight, PackageOpen, Clock, Trash2 } from 'lucide-react';
import { Portal } from '@/components/common/Portal';
import { useProducts } from '@/hooks/useProductData';
import { useShowroomMode } from '@/contexts/ShowroomModeContext';
import { useUserPricing } from '@/hooks/usePricing';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCart } from '@/contexts/CartContext';
import { useToast } from '@/contexts/ToastContext';
import { tokenizeSearchQuery, matchesSearchTokens, transliterateCyrillicToLatin } from '@/lib/searchNormalization';
import { fetchSingleProductFromErp } from '@/lib/erpApi';
import { CommandPaletteItem } from './CommandPaletteItem';
import type { PageId, Product, ProductVariant } from '@/types';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: PageId, productId?: string) => void;
}

const SEARCH_HISTORY_KEY = 'synergy:search_history_v1';
const MAX_SEARCH_HISTORY = 10;

function readSearchHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string' && x.trim().length > 0).slice(0, MAX_SEARCH_HISTORY) : [];
  } catch { return []; }
}

function writeSearchHistory(list: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_SEARCH_HISTORY))); } catch {}
}

export function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addedVariantSku, setAddedVariantSku] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => readSearchHistory());

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { products } = useProducts();
  const { isShowroomMode } = useShowroomMode();
  const { getVariantPrice } = useUserPricing();
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();
  const { addItem } = useCart();
  const { success: toastSuccess } = useToast();

  const recordSearchQuery = useCallback((rawTerm: string) => {
    const term = rawTerm.trim();
    if (!term) return;
    setSearchHistory(prev => {
      const next = [term, ...prev.filter(item => item.toLowerCase() !== term.toLowerCase())].slice(0, MAX_SEARCH_HISTORY);
      writeSearchHistory(next);
      return next;
    });
  }, []);

  const removeHistoryItem = useCallback((termToRemove: string) => {
    setSearchHistory(prev => {
      const next = prev.filter(item => item !== termToRemove);
      writeSearchHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setSearchHistory([]);
    writeSearchHistory([]);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = originalOverflow; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setSearchHistory(readSearchHistory());
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const matchedProducts = useMemo(() => {
    if (!query.trim()) return [];
    const tokens = tokenizeSearchQuery(query);
    const results: Product[] = [];
    for (const p of products) {
      const searchable = `${p.name} ${p.collection} ${p.manufacturer || ''} ${p.country || ''} ${p.article || ''} ${p.color || ''} ${(p.variants || [])
        .map(v => `${v.size} ${v.article || ''} ${v.sku || ''} ${v.barcode || ''} ${v.code || ''}`)
        .join(' ')}`;
      if (matchesSearchTokens(searchable, tokens)) {
        results.push(p);
        if (results.length >= 10) break;
      }
    }
    return results;
  }, [query, products]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const navigateAndScrollTop = useCallback((page: PageId, param?: string) => {
    onClose();
    onNavigate(page, param);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    }
  }, [onClose, onNavigate]);

  const handleSelectProduct = useCallback((product: Product) => {
    if (query.trim()) recordSearchQuery(query.trim());
    else if (product.collection || product.article) recordSearchQuery(product.article || product.collection);
    navigateAndScrollTop('product', product.id);
  }, [query, recordSearchQuery, navigateAndScrollTop]);

  const executeSearch = useCallback((rawQuery: string) => {
    const clean = rawQuery.trim();
    if (!clean) return;

    recordSearchQuery(clean);
    const lowerQuery = clean.toLowerCase();
    const phoneticQuery = transliterateCyrillicToLatin(lowerQuery);

    // 1. Direct match by exact article, variant SKU, or code across all products
    const productByArticle = products.find(p => {
      if (p.article && p.article.trim().toLowerCase() === lowerQuery) return true;
      if (p.name && p.name.trim().toLowerCase() === lowerQuery) return true;
      return p.variants?.some(v =>
        (v.article && v.article.trim().toLowerCase() === lowerQuery) ||
        (v.sku && v.sku.trim().toLowerCase() === lowerQuery) ||
        (v.code && v.code.trim().toLowerCase() === lowerQuery) ||
        (v.barcode && v.barcode.trim() === clean)
      );
    });

    if (productByArticle) {
      onClose();
      onNavigate('product', productByArticle.id);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      return;
    }

    // 2. Collection match: check if query matches a known collection name (including Cyrillic phonetic, e.g. 'шанти' -> 'SHANTI')
    const uniqueCollections = Array.from(
      new Set(products.map(p => p.collection).filter(Boolean))
    );
    const stripped = lowerQuery.replace(/^(коллекция|ковер|ковры)\s+/i, '').trim();
    const phoneticStripped = transliterateCyrillicToLatin(stripped);
    const matchedCol = uniqueCollections.find(c => {
      const colLower = c.toLowerCase();
      const colPhonetic = transliterateCyrillicToLatin(colLower);
      return (
        colLower === lowerQuery ||
        colLower === stripped ||
        (phoneticStripped.length >= 2 && (colLower === phoneticStripped || colPhonetic === phoneticStripped || colLower === phoneticQuery))
      );
    });

    if (matchedCol) {
      onClose();
      onNavigate('catalog', matchedCol);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      return;
    }

    // 3. If there is exactly one product matching in the current filtered list
    if (matchedProducts.length === 1) {
      navigateAndScrollTop('product', matchedProducts[0].id);
      return;
    }

    // 4. If all matched products belong to the same collection (e.g. user typed partial collection name)
    if (matchedProducts.length > 0) {
      const distinctCols = Array.from(new Set(matchedProducts.map(p => p.collection).filter(Boolean)));
      if (distinctCols.length === 1 && distinctCols[0]) {
        navigateAndScrollTop('catalog', distinctCols[0]);
        return;
      }
    }

    // 5. Точечный серверный поиск по точному артикулу/SKU/штрихкоду (без скачивания всей базы в память)
    const looksLikeSkuOrBarcode = /^[\w\d\-_.\s]{2,30}$/i.test(clean);
    if (looksLikeSkuOrBarcode) {
      fetchSingleProductFromErp(clean)
        .then(serverProd => {
          if (serverProd && serverProd.id) {
            navigateAndScrollTop('product', serverProd.id);
          } else {
            navigateAndScrollTop('catalog', `search:${clean}`);
          }
        })
        .catch(() => {
          navigateAndScrollTop('catalog', `search:${clean}`);
        });
      return;
    }

    // 6. Otherwise: general search -> open catalog with search query
    navigateAndScrollTop('catalog', `search:${clean}`);
  }, [products, matchedProducts, recordSearchQuery, onClose, onNavigate, navigateAndScrollTop]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      executeSearch(query);
    } else if (matchedProducts[selectedIndex]) {
      handleSelectProduct(matchedProducts[selectedIndex]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < matchedProducts.length - 1 ? prev + 1 : prev));
      scrollActiveIntoView(selectedIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
      scrollActiveIntoView(selectedIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const scrollActiveIntoView = (index: number) => {
    if (!listRef.current) return;
    const itemEl = listRef.current.children[index] as HTMLElement | undefined;
    if (itemEl) {
      itemEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  const handleQuickAddToCart = (e: React.MouseEvent, product: Product, variant?: ProductVariant) => {
    e.stopPropagation();
    const targetVariant = variant || product.variants.find(v => (v.stock || v.free_stock || 0) > 0) || product.variants[0];
    if (!targetVariant) return;

    const stockWh = (targetVariant.warehouses || []).find(w => Number(w.free_stock ?? w.stock ?? 0) > 0) || targetVariant.warehouses?.[0];
    const whStock = Number(stockWh?.free_stock ?? stockWh?.stock ?? targetVariant.free_stock ?? targetVariant.stock ?? 0);
    const inProdQty = Number(targetVariant.in_production_qty ?? 0);
    const isPreorder = whStock <= 0 && inProdQty > 0;
    const availStock = isPreorder ? inProdQty : whStock;
    if (availStock <= 0) return;

    const price = getVariantPrice(product.collection, targetVariant.size, targetVariant.base_price, targetVariant.price_per_sqm);
    const primaryWarehouse = isPreorder ? 'Предзаказ (Фабрика)' : (stockWh?.warehouse_name || stockWh?.city || 'Основной Склад Астана');
    const primaryWhId = isPreorder ? 81 : (stockWh?.warehouse_id || 81);

    addItem({
      productId: product.id,
      item_id: targetVariant.item_id || (Number(targetVariant.id) > 0 ? Number(targetVariant.id) : undefined),
      productName: product.name,
      collection: product.collection,
      image: product.images[0] || '',
      size: targetVariant.size,
      sku: targetVariant.sku,
      warehouse: primaryWarehouse,
      warehouse_id: primaryWhId,
      price,
      price_per_sqm: targetVariant.price_per_sqm,
      area_sqm: targetVariant.area_sqm,
      maxStock: availStock,
      is_preorder: isPreorder || undefined,
      production_eta: isPreorder ? (targetVariant.production_eta ?? product.production_eta ?? null) : undefined,
    }, 1);

    setAddedVariantSku(targetVariant.sku);
    toastSuccess(`Товар ${product.collection} (${targetVariant.size}) добавлен в корзину`);
    setTimeout(() => setAddedVariantSku(null), 1800);
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 md:pt-20 overscroll-contain overflow-y-auto"
        onClick={onClose}
      >
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-modal-backdrop modal-gpu-backdrop pointer-events-none" aria-hidden="true" />
        <div
          className="relative bg-white rounded-2xl max-w-2xl w-full mx-auto shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col max-h-[85vh] max-h-[85dvh] animate-modal-card modal-gpu-card z-10"
          onClick={e => e.stopPropagation()}
        >
          {/* Top Search Input Bar */}
          <form
            onSubmit={handleSubmit}
            action="#"
            role="search"
            className="flex items-center px-3.5 sm:px-4 py-3 border-b border-slate-150 gap-2 sm:gap-3 bg-slate-50/70 shrink-0"
          >
            <Search className="h-5 w-5 text-brand-600 shrink-0" />
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('search.placeholder')}
              className="flex-1 bg-transparent text-base sm:text-sm md:text-base text-slate-900 placeholder:text-slate-400 focus:outline-hidden min-w-0"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer shrink-0"
                title={t('common.reset')}
                aria-label={t('common.reset')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {query.trim() && (
              <button
                type="submit"
                className="flex items-center justify-center h-8 px-2.5 sm:px-3 rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-xs font-semibold shrink-0 transition-colors shadow-2xs cursor-pointer gap-1"
                title={t('search.find_btn')}
              >
                <span className="hidden sm:inline">{t('search.find_btn')}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono text-slate-500 bg-white border border-slate-250 shadow-2xs shrink-0">
              ESC
            </kbd>
          </form>

          {/* Saved Search History when input is empty */}
          {!query.trim() && (
            <div className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <Clock className="h-3.5 w-3.5 text-brand-600" />
                  <span>История запросов</span>
                </div>
                {searchHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Очистить</span>
                  </button>
                )}
              </div>
              {searchHistory.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {searchHistory.map(term => (
                    <div
                      key={term}
                      className="inline-flex items-center rounded-lg bg-slate-100 border border-slate-200/80 hover:border-brand-200 hover:bg-brand-50/70 transition-all"
                    >
                      <button
                        type="button"
                        onClick={() => executeSearch(term)}
                        className="pl-2.5 pr-1.5 py-1.5 text-xs font-medium text-slate-700 hover:text-brand-700 cursor-pointer"
                      >
                        {term}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeHistoryItem(term)}
                        className="pr-2 pl-0.5 py-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                        aria-label={`Удалить запрос ${term}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 py-1">
                  Здесь автоматически сохраняются ваши последние поисковые запросы.
                </p>
              )}
            </div>
          )}

          {/* Results List */}
          {query.trim() && matchedProducts.length > 0 && (
            <div
              ref={listRef}
              className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 overscroll-contain"
            >
              {matchedProducts.map((product, idx) => {
                const firstVariant = product.variants[0];
                const displayPrice = firstVariant
                  ? getVariantPrice(product.collection, firstVariant.size, firstVariant.base_price, firstVariant.price_per_sqm)
                  : 0;

                return (
                  <CommandPaletteItem
                    key={product.id}
                    product={product}
                    isSelected={idx === selectedIndex}
                    isShowroomMode={isShowroomMode}
                    displayPrice={displayPrice}
                    addedVariantSku={addedVariantSku}
                    onSelect={handleSelectProduct}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onQuickAdd={handleQuickAddToCart}
                    formatPrice={formatPrice}
                  />
                );
              })}
            </div>
          )}

          {/* Empty search results */}
          {query.trim() && matchedProducts.length === 0 && (
            <div className="py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <PackageOpen className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800">{t('search.empty')}</p>
            </div>
          )}

          {/* Bottom Footer Shortcuts */}
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-150 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">↑↓</kbd>
                {t('search.nav_hint')}
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">↵</kbd>
                {t('search.open_hint')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigateAndScrollTop('catalog')}
              className="text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <span>{t('search.all_in_catalog')}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default CommandPalette;
