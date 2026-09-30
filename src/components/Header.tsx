import { useState, useEffect } from 'react';
import { Menu, X, ShoppingCart, User, Shield, Phone, CloudOff, RefreshCw, Eye, EyeOff, Search } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useShowroomMode } from '@/contexts/ShowroomModeContext';
import { checkSystemHealth } from '@/lib/erpApi';
import { getQueuedOfflineOrders, processOfflineOrderQueue, onOfflineQueueChange } from '@/lib/offlineOrderQueue';
import CurtainNavigationDrawer from '@/components/layout/CurtainNavigationDrawer';
import { CommandPalette } from '@/components/search';
import type { PageId } from '@/types';

interface HeaderProps {
  currentPage: PageId;
  onNavigate: (page: PageId, productId?: string) => void;
}

export default function Header({ currentPage, onNavigate }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState<'ok' | 'degraded' | 'down' | 'loading'>('loading');
  const [offlineCount, setOfflineCount] = useState(0);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const { totalItems } = useCart();
  const { user, profile, isAdmin, realIsAdmin, isImpersonating, stopImpersonation } = useAuth();
  const isEffectiveAdmin = Boolean(isAdmin && !isImpersonating);
  const { language, setLanguage, t } = useLanguage();
  const { currency, setCurrency } = useCurrency();
  const { isShowroomMode, toggleShowroomMode } = useShowroomMode();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Global ⌘K / Ctrl+K keyboard shortcut to open Command Palette from anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    let mounted = true;
    checkSystemHealth()
      .then(res => {
        if (mounted) setSystemStatus(res.status);
      })
      .catch(() => {
        if (mounted) setSystemStatus('down');
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setOfflineCount(getQueuedOfflineOrders().filter(o => o.status !== 'synced').length);
    const unbind = onOfflineQueueChange((orders) => {
      setOfflineCount(orders.filter(o => o.status !== 'synced').length);
    });
    return () => unbind();
  }, []);

  const handleSyncOffline = async () => {
    setIsSyncingOffline(true);
    try { await processOfflineOrderQueue(); } finally { setIsSyncingOffline(false); }
  };

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
      className="fixed top-0 left-0 right-0 z-50 transition-colors duration-300 bg-white"
      style={{ backgroundColor: '#ffffff' }}
    >
      {/* Impersonation Banner inside fixed header */}
      {isImpersonating && profile && (
        <div className="bg-amber-500 text-white px-3 sm:px-4 py-1.5 sm:py-2 text-xs flex items-center justify-between gap-2 border-b border-amber-600/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-2 w-2 rounded-full bg-white animate-ping shrink-0" />
            <span className="truncate">
              <span className="hidden sm:inline">Режим просмотра от имени: </span>
              <span className="sm:hidden font-medium">Просмотр: </span>
              <strong>{profile.full_name || profile.company_name || 'Пользователь'}</strong>
              {profile.company_name && profile.full_name && profile.company_name !== profile.full_name && (
                <span className="hidden md:inline text-amber-100"> ({profile.company_name})</span>
              )}
              {profile.price_type && (
                <span className="ml-1.5 bg-amber-600/90 text-amber-100 px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0">
                  Тип цен: {profile.price_type}
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={stopImpersonation}
            className="rounded bg-white px-2.5 py-1 text-[11px] sm:text-xs font-bold text-amber-900 shadow hover:bg-amber-50 active:scale-95 transition-all shrink-0 whitespace-nowrap cursor-pointer"
          >
            <span className="hidden sm:inline">Вернуться в свой аккаунт</span>
            <span className="sm:hidden">Выйти</span>
          </button>
        </div>
      )}

      {/* Showroom Mode Banner */}
      {isShowroomMode && (
        <div className="bg-amber-600 text-white px-3 sm:px-4 py-1.5 text-xs flex items-center justify-between gap-2 border-b border-amber-700/40">
          <div className="flex items-center gap-2 min-w-0">
            <EyeOff className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              <strong>Режим витрины:</strong> оптовые цены и баланс скрыты для клиента в салоне
            </span>
          </div>
          <button
            type="button"
            onClick={toggleShowroomMode}
            className="rounded bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0"
          >
            Выйти
          </button>
        </div>
      )}

      {/* Mobile Flat Bottom Hairline (Zero protrusion, zero overlap on video or catalog on mobile) */}
      <div className="sm:hidden absolute inset-x-0 top-full -mt-px h-px bg-slate-200" />

      {/* Desktop Left/Right Bottom Border Lines & Spline Arch */}
      <div
        className={`hidden sm:block absolute left-0 top-full -mt-px h-px bg-slate-200 transition-all duration-300 ${
          scrolled ? 'right-[calc(50%+140px)] lg:right-[calc(50%+180px)]' : 'right-[calc(50%+170px)] lg:right-[calc(50%+240px)]'
        }`}
      />
      <div
        className={`hidden sm:block absolute right-0 top-full -mt-px h-px bg-slate-200 transition-all duration-300 ${
          scrolled ? 'left-[calc(50%+140px)] lg:left-[calc(50%+180px)]' : 'left-[calc(50%+170px)] lg:left-[calc(50%+240px)]'
        }`}
      />
      <svg
        className={`hidden sm:block absolute left-1/2 -translate-x-1/2 top-full -mt-px pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-visible ${
          scrolled ? 'w-[280px] lg:w-[360px] h-[14px] lg:h-[18px]' : 'w-[340px] lg:w-[480px] h-[28px] lg:h-[42px]'
        }`}
        viewBox="0 0 500 44"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ zIndex: 1 }}
      >
        <path
          d="M 0,-2 L 500,-2 L 500,0 C 390,0 340,44 250,44 C 160,44 110,0 0,0 Z"
          fill="#ffffff"
          style={{ fill: '#ffffff' }}
        />
        <path
          d="M 0,0.5 C 110,0.5 160,44 250,44 C 340,44 390,0.5 500,0.5"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1.5"
        />
      </svg>

      <div className="container-w relative" style={{ zIndex: 10 }}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center h-16 sm:h-18 w-full gap-2">
          {/* Left Column (Desktop Navigation Links) */}
          <nav className="hidden lg:flex items-center gap-1.5 justify-self-start">
            {navLinks.map(({ label, page }) => (
              <button
                key={page}
                onClick={() => onNavigate(page)}
                onMouseEnter={() => {
                  if (page === 'catalog') import('@/pages/CatalogPage');
                }}
                onTouchStart={() => {
                  if (page === 'catalog') import('@/pages/CatalogPage');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors duration-200 cursor-pointer ${
                  currentPage === page
                    ? 'text-[#003365] bg-[#003365]/10 font-bold'
                    : 'text-slate-700 hover:text-[#003365] hover:bg-black/5'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          {/* Left Column Mobile Controls (Variant 1: Symmetric Search) */}
          <div className="lg:hidden justify-self-start flex items-center">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="sm:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200/80 transition-colors cursor-pointer"
              title="Поиск"
              aria-label="Поиск по артикулу"
            >
              <Search className="h-4 w-4 text-slate-600" />
            </button>
          </div>

          {/* Center Column: Logo in Parabolic Arch (Compact on mobile, perfectly dipped on scroll) */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className={`justify-self-center flex flex-col items-center justify-center cursor-pointer transition-all duration-300 py-1 px-2 sm:px-4 min-w-[110px] sm:min-w-[160px] ${
              scrolled ? 'translate-y-0 sm:translate-y-1.5' : 'translate-y-0 sm:translate-y-2'
            }`}
            title="Synergiya Group — Главная"
            aria-label="Главная страница"
          >
            {/* Upper Emblem: Smoothly disappears and collapses height when scrolled */}
            <div
              className={`transition-all duration-300 overflow-hidden flex items-center justify-center ${
                scrolled ? 'h-0 opacity-0 mb-0 scale-75' : 'h-8 sm:h-10 lg:h-12 opacity-100 mb-0.5 sm:mb-1'
              }`}
            >
              <img
                src="/logo-emblem.png"
                alt="Synergiya Crest"
                className="h-full w-auto max-h-8 sm:max-h-11 object-contain"
              />
            </div>

            {/* Brand Wordmark Typography */}
            <img
              src="/logo-text.png"
              alt="Synergiya Group"
              className="h-4 sm:h-5 lg:h-6 w-auto object-contain transition-all duration-300"
            />
          </button>

          {/* Right Column: Clean, Uncrowded Controls (Mobile shows Cart + Menu for zero clutter) */}
          <div className="justify-self-end flex items-center justify-end gap-1.5 sm:gap-2">
            {/* Phone link: sleek compact icon button on sm+ */}
            <a
              href="tel:+77785806866"
              className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 hover:text-brand-700 transition-colors border border-slate-200 shrink-0"
              title="Позвонить в отдел продаж: +7 (778) 580-68-66"
              aria-label="Позвонить в отдел продаж"
            >
              <Phone className="h-3.5 w-3.5 text-brand-600" />
            </a>

            {/* Language Switcher (KZ / RU): visible on sm+ */}
            <div className="hidden sm:flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setLanguage('kz')}
                className={`rounded-md px-2 py-1 transition-all ${language === 'kz' ? 'bg-white text-[#003365] shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                title="Қазақ тілі"
              >KZ</button>
              <button
                type="button"
                onClick={() => setLanguage('ru')}
                className={`rounded-md px-2 py-1 transition-all ${language === 'ru' ? 'bg-white text-[#003365] shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                title="Русский язык"
              >RU</button>
            </div>

            {/* Showroom Presentation Mode Toggle (Витрина / Без оптовых цен): visible on sm+ */}
            <button
              type="button"
              onClick={toggleShowroomMode}
              className={`hidden sm:flex h-9 items-center gap-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                isShowroomMode
                  ? 'bg-amber-500 border-amber-600 text-white shadow-2xs font-bold'
                  : 'bg-slate-100 hover:bg-slate-200/80 border-slate-200 text-slate-700'
              }`}
              title={
                isShowroomMode
                  ? 'Режим витрины активен: оптовые цены и баланс скрыты. Нажмите для выхода'
                  : 'Включить режим витрины: скрыть оптовые цены для показа каталога клиенту'
              }
            >
              {isShowroomMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="hidden lg:inline">{isShowroomMode ? 'Витрина вкл' : 'Витрина'}</span>
            </button>

            {/* Currency Switcher ($ USD / ₸ KZT) - Скрыт для всех, кроме администратора */}
            {isEffectiveAdmin && (
              <div className="hidden xl:flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setCurrency('USD')}
                  className={`rounded-md px-2 py-1 transition-all ${currency === 'USD' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                  title="Цены в долларах ($)"
                >$</button>
                <button
                  type="button"
                  onClick={() => setCurrency('KZT')}
                  className={`rounded-md px-2 py-1 transition-all ${currency === 'KZT' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                  title="Цены в тенге (₸)"
                >₸</button>
              </div>
            )}

            {/* Offline Orders Queue Badge */}
            {offlineCount > 0 && (
              <button
                type="button"
                onClick={handleSyncOffline}
                disabled={isSyncingOffline}
                title="Есть сохраненные оффлайн-заказы. Нажмите для синхронизации с ERP"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-[11px] font-semibold hover:bg-amber-100 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
              >
                {isSyncingOffline ? (
                  <RefreshCw className="h-3 w-3 animate-spin text-amber-700" />
                ) : (
                  <CloudOff className="h-3.5 w-3.5 text-amber-600 animate-pulse" />
                )}
                <span className="hidden md:inline">Офлайн: {offlineCount}</span>
              </button>
            )}

            {/* Global Quick Search Button (Command Palette ⌘K) - Desktop */}
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="hidden sm:flex h-9 items-center gap-2 rounded-lg px-2.5 transition-colors border border-slate-200 bg-slate-100 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 cursor-pointer shadow-2xs"
              title="Быстрый поиск по артикулу и каталогу (⌘K / Ctrl+K)"
              aria-label="Быстрый поиск"
            >
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden xl:inline text-xs font-medium text-slate-500">Поиск SKU...</span>
              <kbd className="hidden md:inline-flex items-center font-mono text-[10px] font-semibold bg-white border border-slate-250 rounded px-1.5 py-0.5 text-slate-500 shadow-2xs">
                ⌘K
              </kbd>
            </button>

            <button
              onClick={() => onNavigate(user ? 'profile' : 'login')}
              className={`hidden sm:flex h-9 items-center gap-2 rounded-lg px-2.5 transition-colors border ${
                user
                  ? 'border-slate-200 bg-slate-100 hover:bg-slate-200/80 text-slate-900 shadow-2xs'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {isAdmin ? (
                <Shield className="h-4 w-4 text-brand-700 shrink-0" />
              ) : (
                <User className="h-4 w-4 text-slate-500 shrink-0" />
              )}
              {user && profile ? (
                <div className="flex items-center gap-1.5 text-left">
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white text-slate-700 border border-slate-200 shadow-2xs">
                    ID {profile.partner_id || (profile as any).erp_id || (profile.id.length < 8 ? profile.id : profile.id.slice(0, 5))}
                  </span>
                  <span className="text-xs font-semibold text-slate-800 max-w-[80px] xl:max-w-[120px] truncate hidden md:block">
                    {profile.full_name || profile.company_name || user.email?.split('@')[0]}
                  </span>
                </div>
              ) : (
                <span className="text-xs font-semibold">{t('nav.login')}</span>
              )}
            </button>

            {/* Cart Button: Visible on sm+, hidden on mobile (since Cart is in bottom MobileNav) */}
            <button
              onClick={() => onNavigate('cart')}
              className="hidden sm:flex relative h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[#003365] transition-colors hover:bg-slate-200/80 border border-slate-200"
              title="Корзина"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
              {totalItems > 0 && <span className="text-xs font-bold">{totalItems}</span>}
            </button>

            {/* Menu Button: 36x36px on mobile, full width on desktop */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-9 w-9 sm:w-auto items-center justify-center gap-1.5 px-0 sm:px-2.5 rounded-lg text-slate-700 transition-all hover:bg-slate-100 hover:text-brand-700 border border-slate-200 cursor-pointer"
              title="Навигационное меню Synergy"
              aria-label="Открыть меню"
            >
              <Menu className="h-4 w-4" />
              <span className="text-xs font-semibold hidden md:inline">Меню</span>
            </button>
          </div>
        </div>
      </div>

      {/* Fullscreen Editorial Curtain Drawer (Exact Thompson's Tea Reference) */}
      <CurtainNavigationDrawer
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        currentPage={currentPage}
        onNavigate={onNavigate}
        user={user}
        profile={profile}
        isAdmin={Boolean(isAdmin)}
        isShowroomMode={isShowroomMode}
        toggleShowroomMode={toggleShowroomMode}
        language={language}
        setLanguage={setLanguage}
        t={t}
      />

      {/* Global Command Palette (⌘K) Spotlight Modal */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={onNavigate}
      />
    </header>
  );
}
