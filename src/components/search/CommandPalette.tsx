import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search,
  X,
  ArrowRight,
  PackageOpen,
  Sparkles,
} from 'lucide-react';
import { Portal } from '@/components/common/Portal';
import { useProducts } from '@/hooks/useProductData';
import { useShowroomMode } from '@/contexts/ShowroomModeContext';
import { useUserPricing } from '@/hooks/usePricing';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useCart } from '@/contexts/CartContext';
import { useToast } from '@/contexts/ToastContext';
import { tokenizeSearchQuery, matchesSearchTokens } from '@/lib/searchNormalization';
import { CommandPaletteItem } from './CommandPaletteItem';
import type { PageId, Product, ProductVariant } from '@/types';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: PageId, productId?: string) => void;
}

const POPULAR_SEARCH_SUGGESTIONS = [
  'FLORA',
  'SILK ROAD',
  'VINTAGE',
  'SHAGGY',
  'Дорожки',
  '2x3',
  '1.6x2.3',
];

export function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addedVariantSku, setAddedVariantSku] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isInternalInteractionRef = useRef(false);

  const { products } = useProducts();
  const { isShowroomMode } = useShowroomMode();
  const { getVariantPrice } = useUserPricing();
  const { formatPrice } = useCurrency();
  const { addItem } = useCart();
  const { success: toastSuccess } = useToast();

  // Lock body scroll while modal is active to prevent mobile layout shifting
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
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

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelectProduct = useCallback((product: Product) => {
    onClose();
    onNavigate('product', product.id);
  }, [onClose, onNavigate]);

  const executeSearch = useCallback((rawQuery: string) => {
    const clean = rawQuery.trim();
    if (!clean) return;

    const lowerQuery = clean.toLowerCase();

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
      return;
    }

    // 2. Collection match: check if query matches a known collection name
    const uniqueCollections = Array.from(
      new Set(products.map(p => p.collection).filter(Boolean))
    );
    const stripped = lowerQuery.replace(/^(коллекция|ковер|ковры)\s+/i, '').trim();
    const matchedCol = uniqueCollections.find(c => {
      const colLower = c.toLowerCase();
      return colLower === lowerQuery || colLower === stripped;
    });

    if (matchedCol) {
      onClose();
      onNavigate('catalog', matchedCol);
      return;
    }

    // 3. If there is exactly one product matching in the current filtered list
    if (matchedProducts.length === 1) {
      onClose();
      onNavigate('product', matchedProducts[0].id);
      return;
    }

    // 4. If all matched products belong to the same collection (e.g. user typed partial collection name)
    if (matchedProducts.length > 0) {
      const distinctCols = Array.from(new Set(matchedProducts.map(p => p.collection).filter(Boolean)));
      if (distinctCols.length === 1 && distinctCols[0]) {
        onClose();
        onNavigate('catalog', distinctCols[0]);
        return;
      }
    }

    // 5. Otherwise: general search -> open catalog with search query
    onClose();
    onNavigate('catalog', `search:${clean}`);
  }, [products, matchedProducts, onClose, onNavigate]);

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

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // If focus moved to another element inside the form, don't execute
    if (e.relatedTarget && e.currentTarget.form?.contains(e.relatedTarget as Node)) {
      return;
    }
    // Handle iOS keyboard accessory checkmark "✓" (Done) button
    setTimeout(() => {
      if (!isInternalInteractionRef.current && query.trim()) {
        executeSearch(query);
      }
      isInternalInteractionRef.current = false;
    }, 180);
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

    const price = getVariantPrice(product.collection, targetVariant.size, targetVariant.base_price, targetVariant.price_per_sqm);
    const primaryWarehouse = targetVariant.warehouses?.[0]?.warehouse_name || 'Основной Склад Астана';
    const primaryWhId = targetVariant.warehouses?.[0]?.warehouse_id || 81;

    addItem({
      productId: product.id,
      item_id: targetVariant.item_id,
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
      maxStock: targetVariant.free_stock ?? targetVariant.stock,
    }, 1);

    setAddedVariantSku(targetVariant.sku);
    toastSuccess(`Товар ${product.collection} (${targetVariant.size}) добавлен в корзину`);
    setTimeout(() => setAddedVariantSku(null), 1800);
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 md:pt-20 bg-slate-900/60 backdrop-blur-sm animate-fade-in overscroll-contain overflow-y-auto"
        onPointerDown={e => {
          if (e.target === e.currentTarget) {
            isInternalInteractionRef.current = true;
          }
        }}
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl max-w-2xl w-full mx-auto shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col max-h-[85vh] max-h-[85dvh] animate-scale-in"
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
              onBlur={handleBlur}
              placeholder="Поиск по артикулу, коллекции, размеру..."
              className="flex-1 bg-transparent text-base sm:text-sm md:text-base text-slate-900 placeholder:text-slate-400 focus:outline-hidden min-w-0"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onPointerDown={() => {
                  isInternalInteractionRef.current = true;
                }}
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer shrink-0"
                title="Очистить"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {query.trim() && (
              <button
                type="submit"
                onPointerDown={() => {
                  isInternalInteractionRef.current = true;
                }}
                className="flex items-center justify-center h-8 px-2.5 sm:px-3 rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-xs font-semibold shrink-0 transition-colors shadow-2xs cursor-pointer gap-1"
                title="Найти"
              >
                <span className="hidden sm:inline">Найти</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono text-slate-500 bg-white border border-slate-250 shadow-2xs shrink-0">
              ESC
            </kbd>
          </form>

          {/* Quick Suggestions when input is empty */}
          {!query.trim() && (
            <div className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>Популярные запросы</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_SEARCH_SUGGESTIONS.map(term => (
                  <button
                    key={term}
                    type="button"
                    onPointerDown={() => {
                      isInternalInteractionRef.current = true;
                    }}
                    onClick={() => {
                      setQuery(term);
                      inputRef.current?.focus();
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 border border-slate-200/80 transition-all cursor-pointer"
                  >
                    {term}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
                Совет: Вы можете искать ковры сразу по размерам (<code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">2х3</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">1.6*2.3</code>) или артикулу 1С.
              </p>
            </div>
          )}

          {/* Results List */}
          {query.trim() && matchedProducts.length > 0 && (
            <div
              ref={listRef}
              onPointerDown={() => {
                isInternalInteractionRef.current = true;
              }}
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
              <p className="text-sm font-semibold text-slate-800">По запросу «{query}» ничего не найдено</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Проверьте правильность написания артикула или воспользуйтесь каталогом со всеми коллекциями.
              </p>
            </div>
          )}

          {/* Bottom Footer Shortcuts */}
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-150 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">↑↓</kbd>
                навигация
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">↵</kbd>
                открыть
              </span>
            </div>
            <button
              type="button"
              onPointerDown={() => {
                isInternalInteractionRef.current = true;
              }}
              onClick={() => {
                onClose();
                onNavigate('catalog');
              }}
              className="text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <span>Все товары в каталоге</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default CommandPalette;
