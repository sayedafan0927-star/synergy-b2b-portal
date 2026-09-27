import { useState, useEffect, useMemo, useRef } from 'react';
import { Menu, X, ShoppingCart, Search, User, Shield, Package } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProducts } from '@/hooks/useProductData';
import type { PageId, Product } from '@/types';
import ProductImage from '@/components/ProductImage';

interface HeaderProps {
  currentPage: PageId;
  onNavigate: (page: PageId, productId?: string) => void;
}

const NAV_LINKS: { label: string; page: PageId }[] = [
  { label: 'Главная', page: 'home' },
  { label: 'Каталог', page: 'catalog' },
  { label: 'Контакты', page: 'contacts' },
];

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-brand-100 text-brand-800 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function Header({ currentPage, onNavigate }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const { totalItems } = useCart();
  const { user, profile, isAdmin } = useAuth();
  const { products } = useProducts();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [currentPage]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const searchResults = useMemo<Product[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return products
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.collection.toLowerCase().includes(q) ||
        p.manufacturer.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q) ||
        p.variants.some(v => v.sku.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [products, searchQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onNavigate('catalog');
      setSearchOpen(false);
    }
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-apple ${
        scrolled
          ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-slate-100'
          : 'bg-white'
      }`}
    >
      <div className="container-w">
        <div className="flex h-16 items-center justify-between lg:h-18">
          {/* Logo */}
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80 shrink-0"
          >
            <img
              src="/Вектор_Синэнергия.png"
              alt="Synergiya Group"
              className="h-12 sm:h-14 w-auto"
            />
          </button>

          {/* Smart search bar */}
          <div ref={searchRef} className="relative flex-1 max-w-md mx-4 hidden sm:block">
            <form onSubmit={handleSearchSubmit}>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Поиск по названию, коллекции, SKU..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-4 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all focus:bg-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </form>

            {/* Search dropdown */}
            {searchOpen && searchQuery.trim().length >= 2 && (
              <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-slate-100 bg-white shadow-xl overflow-hidden z-50">
                {searchResults.length > 0 ? (
                  <>
                    {searchResults.map(product => {
                      const stock = product.variants.reduce((s, v) => s + v.warehouses.reduce((a, w) => a + w.stock, 0), 0);
                      return (
                        <button
                          key={product.id}
                          onClick={() => {
                            onNavigate('product', product.id);
                            setSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                        >
                          <ProductImage
                            src={product.image_thumb || product.images[0]}
                            alt={product.name}
                            loading="lazy"
                            decoding="async"
                            width={80}
                            className="h-10 w-10 rounded object-cover shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {highlightMatch(product.name, searchQuery)}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {highlightMatch(product.collection, searchQuery)} · {product.manufacturer}
                            </p>
                          </div>
                          <span className={`text-xs font-semibold shrink-0 ${stock > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {stock} шт.
                          </span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        onNavigate('catalog');
                        setSearchOpen(false);
                      }}
                      className="w-full px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors"
                    >
                      Все результаты →
                    </button>
                  </>
                ) : (
                  <div className="px-4 py-6 text-center">
                    <Package className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">Ничего не найдено</p>
                    <p className="text-xs text-slate-400 mt-1">Попробуйте изменить запрос</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1 shrink-0">
            {NAV_LINKS.map(({ label, page }) => (
              <button
                key={page}
                onClick={() => onNavigate(page)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  currentPage === page
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Mobile search toggle */}
            <button
              onClick={() => { setSearchOpen(!searchOpen); }}
              className="sm:hidden flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>

            <button
              onClick={() => onNavigate(user ? 'profile' : 'login')}
              className={`hidden sm:flex h-9 items-center gap-1.5 rounded-lg px-2.5 transition-colors ${
                user ? 'text-brand-700 bg-brand-50 hover:bg-brand-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              {isAdmin ? <Shield className="h-[18px] w-[18px]" /> : <User className="h-[18px] w-[18px]" />}
              {user && profile && (
                <span className="text-xs font-medium max-w-[80px] truncate hidden lg:block">
                  {profile.full_name || user.email?.split('@')[0]}
                </span>
              )}
            </button>

            <button
              onClick={() => onNavigate('cart')}
              className="relative flex h-9 items-center gap-1.5 rounded-lg bg-brand-50 px-3 text-brand-700 transition-colors hover:bg-brand-100"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
              {totalItems > 0 && (
                <span className="text-xs font-bold">{totalItems}</span>
              )}
            </button>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile search bar (expandable) */}
        {searchOpen && (
          <div className="sm:hidden pb-3">
            <form onSubmit={handleSearchSubmit}>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  autoFocus
                  placeholder="Поиск..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </form>
            {searchQuery.trim().length >= 2 && (
              <div className="mt-2 rounded-xl border border-slate-100 bg-white shadow-lg overflow-hidden max-h-80 overflow-y-auto">
                {searchResults.length > 0 ? (
                  <>
                    {searchResults.map(product => {
                      const stock = product.variants.reduce((s, v) => s + v.warehouses.reduce((a, w) => a + w.stock, 0), 0);
                      return (
                        <button
                          key={product.id}
                          onClick={() => {
                            onNavigate('product', product.id);
                            setSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                        >
                          <ProductImage
                            src={product.image_thumb || product.images[0]}
                            alt={product.name}
                            loading="lazy"
                            decoding="async"
                            width={80}
                            className="h-10 w-10 rounded object-cover shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {highlightMatch(product.name, searchQuery)}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {highlightMatch(product.collection, searchQuery)} · {product.manufacturer}
                            </p>
                          </div>
                          <span className={`text-xs font-semibold shrink-0 ${stock > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {stock} шт.
                          </span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        onNavigate('catalog');
                        setSearchOpen(false);
                      }}
                      className="w-full px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors"
                    >
                      Все результаты →
                    </button>
                  </>
                ) : (
                  <div className="px-4 py-6 text-center">
                    <Package className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">Ничего не найдено</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile menu */}
      <div
        className={`lg:hidden overflow-hidden transition-all duration-300 ease-apple ${
          mobileOpen ? 'max-h-64 border-b border-slate-100' : 'max-h-0'
        }`}
      >
        <nav className="container-w flex flex-col gap-1 pb-4">
          {NAV_LINKS.map(({ label, page }) => (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                currentPage === page
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => onNavigate('profile')}
            className="sm:hidden w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Личный кабинет
          </button>
        </nav>
      </div>
    </header>
  );
}
