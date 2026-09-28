import { useState, useEffect } from 'react';
import { Menu, X, ShoppingCart, User, Shield, Phone } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PageId } from '@/types';

interface HeaderProps {
  currentPage: PageId;
  onNavigate: (page: PageId, productId?: string) => void;
}

export default function Header({ currentPage, onNavigate }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { totalItems } = useCart();
  const { user, profile, isAdmin } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  const navLinks: { label: string; page: PageId }[] = [
    { label: t('nav.home'), page: 'home' },
    { label: t('nav.catalog'), page: 'catalog' },
    { label: t('nav.contacts'), page: 'contacts' },
  ];

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
            {navLinks.map(({ label, page }) => (
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
            {/* Phone link in Header */}
            <a
              href="tel:+77785806866"
              className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-brand-700 transition-colors"
              title="Позвонить в отдел продаж"
            >
              <Phone className="h-3.5 w-3.5 text-brand-600" />
              <span>+7 (778) 580-68-66</span>
            </a>

            {/* Language Switcher (KZ / RU) */}
            <div className="flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200/80 text-xs font-bold">
              <button
                type="button"
                onClick={() => setLanguage('kz')}
                className={`rounded-md px-2 py-1 transition-all ${
                  language === 'kz'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Қазақ тілі"
              >
                KZ
              </button>
              <button
                type="button"
                onClick={() => setLanguage('ru')}
                className={`rounded-md px-2 py-1 transition-all ${
                  language === 'ru'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Русский язык"
              >
                RU
              </button>
            </div>

            <button
              onClick={() => onNavigate(user ? 'profile' : 'login')}
              className={`hidden sm:flex h-9 items-center gap-2 rounded-lg px-2.5 transition-colors border ${
                user
                  ? 'border-slate-200 bg-slate-50/80 hover:bg-slate-100 text-slate-900 shadow-2xs'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              {isAdmin ? (
                <Shield className="h-4 w-4 text-brand-700 shrink-0" />
              ) : (
                <User className="h-4 w-4 text-slate-500 shrink-0" />
              )}
              {user && profile ? (
                <div className="flex items-center gap-1.5 text-left">
                  {/* Деликатный ID пользователя */}
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white text-slate-700 border border-slate-200/90 shadow-2xs">
                    ID {profile.partner_id || (profile as any).erp_id || (profile.id.length < 8 ? profile.id : profile.id.slice(0, 5))}
                  </span>
                  {/* Имя */}
                  <span className="text-xs font-semibold text-slate-800 max-w-[100px] xl:max-w-[140px] truncate hidden md:block">
                    {profile.full_name || profile.company_name || user.email?.split('@')[0]}
                  </span>
                </div>
              ) : (
                <span className="text-xs font-semibold">{t('nav.login')}</span>
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
          mobileOpen ? 'max-h-96 border-b border-slate-100' : 'max-h-0'
        }`}
      >
        <nav className="container-w flex flex-col gap-1 pb-4">
          {navLinks.map(({ label, page }) => (
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
          <a
            href="tel:+77785806866"
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            <Phone className="h-4 w-4 text-brand-600" />
            <span>+7 (778) 580-68-66</span>
          </a>
          {user && profile ? (
            <button
              onClick={() => onNavigate('profile')}
              className="sm:hidden w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium bg-slate-50 border border-slate-200/80 flex items-center justify-between text-slate-800"
            >
              <div className="flex items-center gap-2">
                {isAdmin ? <Shield className="h-4 w-4 text-brand-700" /> : <User className="h-4 w-4 text-slate-500" />}
                <span className="font-semibold">{profile.full_name || profile.company_name || user.email}</span>
              </div>
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                ID {profile.partner_id || (profile as any).erp_id || profile.id.slice(0, 5)}
              </span>
            </button>
          ) : (
            <button
              onClick={() => onNavigate('login')}
              className="sm:hidden w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {t('nav.login')}
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
