import { useState, useEffect } from 'react';
import { Menu, X, ShoppingCart, User, Shield } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PageId } from '@/types';

interface HeaderProps {
  currentPage: PageId;
  onNavigate: (page: PageId, productId?: string) => void;
}

const NAV_LINKS: { label: string; page: PageId }[] = [
  { label: 'Главная', page: 'home' },
  { label: 'Каталог', page: 'catalog' },
  { label: 'Контакты', page: 'contacts' },
];

export default function Header({ currentPage, onNavigate }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { totalItems } = useCart();
  const { user, profile, isAdmin } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [currentPage]);

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

          <nav className="hidden lg:flex items-center gap-1 shrink-0 ml-auto">
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

          <div className="flex items-center gap-2 shrink-0 ml-3">
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
              {totalItems > 0 && <span className="text-xs font-bold">{totalItems}</span>}
            </button>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

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
