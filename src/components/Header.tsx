import { useState, useEffect } from 'react';
import { Menu, X, ShoppingCart, User, Shield, Phone, CloudOff, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useShowroomMode } from '@/contexts/ShowroomModeContext';
import { checkSystemHealth } from '@/lib/erpApi';
import { getQueuedOfflineOrders, processOfflineOrderQueue, onOfflineQueueChange } from '@/lib/offlineOrderQueue';
import CurtainNavigationDrawer from '@/components/layout/CurtainNavigationDrawer';
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
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#faf6ee]/95 backdrop-blur-md shadow-xs border-b border-[#e7decb]/90'
          : 'bg-[#faf6ee] border-b border-[#e7decb]/60'
      }`}
    >
      {/* Impersonation Banner inside fixed header */}
      {isImpersonating && profile && (
        <div className="bg-amber-500 text-white px-3 sm:px-4 py-1.5 sm:py-2 text-xs flex items-center justify-between gap-2 shadow-xs border-b border-amber-600/30">
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
        <div className="bg-amber-600 text-white px-3 sm:px-4 py-1.5 text-xs flex items-center justify-between gap-2 shadow-xs border-b border-amber-700/40">
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

      {/* Thompson's Tea Signature Curved Parabolic Arch (Ellipse with rounded-[100%]) */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 pointer-events-none transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] bg-[#faf6ee] border-b border-[#e7decb] shadow-2xs ${
          scrolled
            ? 'w-[280px] sm:w-[340px] h-[100px] -bottom-[12px] rounded-[100%]'
            : 'w-[400px] sm:w-[520px] h-[200px] sm:h-[230px] -bottom-[40px] sm:-bottom-[50px] rounded-[100%]'
        }`}
        style={{ zIndex: 1 }}
      />

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
          {/* Left Column Spacer on Mobile to guarantee absolute center logo */}
          <div className="lg:hidden justify-self-start" />

          {/* Center Column: Logo in Parabolic Arch (Full crest & text at top, collapses to text on scroll) */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="justify-self-center flex flex-col items-center justify-center cursor-pointer transition-all duration-300 py-1 px-3 sm:px-4 min-w-[140px] sm:min-w-[180px]"
            title="Synergiya Group — Главная"
            aria-label="Главная страница"
          >
            {/* Upper Emblem: Smoothly disappears and collapses height when scrolled */}
            <div
              className={`transition-all duration-300 overflow-hidden flex items-center justify-center ${
                scrolled ? 'h-0 opacity-0 mb-0 scale-75' : 'h-10 sm:h-12 opacity-100 mb-1'
              }`}
            >
              <img
                src="/logo-emblem.png"
                alt="Synergiya Crest"
                className="h-full w-auto max-h-11 object-contain"
              />
            </div>

            {/* Brand Wordmark Typography: Always visible and centered */}
            <img
              src="/logo-text.png"
              alt="Synergiya Group"
              className="h-5 sm:h-6 w-auto object-contain transition-all duration-300"
            />
          </button>

          {/* Right Column: Clean, Uncrowded Controls */}
          <div className="justify-self-end flex items-center justify-end gap-1.5 sm:gap-2">
            {/* Phone link: visible on 2xl to avoid any collision on laptops */}
            <a
              href="tel:+77785806866"
              className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-black/5 hover:text-brand-700 transition-colors"
              title="Позвонить в отдел продаж"
            >
              <Phone className="h-3.5 w-3.5 text-brand-600" />
              <span>+7 (778) 580-68-66</span>
            </a>

            {/* Language Switcher (KZ / RU): visible on sm+ */}
            <div className="hidden sm:flex items-center rounded-lg bg-black/5 p-0.5 border border-[#e7decb] text-xs font-bold">
              <button
                type="button"
                onClick={() => setLanguage('kz')}
                className={`rounded-md px-2 py-1 transition-all ${language === 'kz' ? 'bg-[#faf6ee] text-[#003365] shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                title="Қазақ тілі"
              >KZ</button>
              <button
                type="button"
                onClick={() => setLanguage('ru')}
                className={`rounded-md px-2 py-1 transition-all ${language === 'ru' ? 'bg-[#faf6ee] text-[#003365] shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                title="Русский язык"
              >RU</button>
            </div>

            {/* Showroom Presentation Mode Toggle (Витрина / Без оптовых цен) */}
            <button
              type="button"
              onClick={toggleShowroomMode}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                isShowroomMode
                  ? 'bg-amber-500 border-amber-600 text-white shadow-2xs font-bold'
                  : 'bg-black/5 hover:bg-black/10 border-[#e7decb] text-slate-700'
              }`}
              title={
                isShowroomMode
                  ? 'Режим витрины активен: оптовые цены и баланс скрыты. Нажмите для выхода'
                  : 'Включить режим витрины: скрыть оптовые цены для показа каталога клиенту'
              }
            >
              {isShowroomMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isShowroomMode ? 'Витрина вкл' : 'Витрина'}</span>
            </button>

            {/* Currency Switcher ($ USD / ₸ KZT) - Скрыт для всех, кроме администратора */}
            {isEffectiveAdmin && (
              <div className="hidden xl:flex items-center rounded-lg bg-black/5 p-0.5 border border-[#e7decb] text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setCurrency('USD')}
                  className={`rounded-md px-2 py-1 transition-all ${currency === 'USD' ? 'bg-[#faf6ee] text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                  title="Цены в долларах ($)"
                >$</button>
                <button
                  type="button"
                  onClick={() => setCurrency('KZT')}
                  className={`rounded-md px-2 py-1 transition-all ${currency === 'KZT' ? 'bg-[#faf6ee] text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
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

            <button
              onClick={() => onNavigate(user ? 'profile' : 'login')}
              className={`hidden sm:flex h-9 items-center gap-2 rounded-lg px-2.5 transition-colors border ${
                user
                  ? 'border-[#e7decb] bg-black/5 hover:bg-black/10 text-slate-900 shadow-2xs'
                  : 'border-[#e7decb] text-slate-600 hover:bg-black/5 hover:text-slate-800'
              }`}
            >
              {isAdmin ? (
                <Shield className="h-4 w-4 text-brand-700 shrink-0" />
              ) : (
                <User className="h-4 w-4 text-slate-500 shrink-0" />
              )}
              {user && profile ? (
                <div className="flex items-center gap-1.5 text-left">
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white text-slate-700 border border-[#e7decb] shadow-2xs">
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

            <button
              onClick={() => onNavigate('cart')}
              className="relative flex h-9 items-center gap-1.5 rounded-lg bg-black/5 px-3 text-[#003365] transition-colors hover:bg-black/10 border border-[#e7decb]"
              title="Корзина"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
              {totalItems > 0 && <span className="text-xs font-bold">{totalItems}</span>}
            </button>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-9 items-center gap-1.5 px-2.5 rounded-lg text-slate-700 transition-all hover:bg-black/5 hover:text-brand-700 border border-[#e7decb] cursor-pointer"
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
    </header>
  );
}
