import { useEffect } from 'react';
import { X, Phone, MessageCircle, Shield, User, Eye, EyeOff, CloudOff, RefreshCw, Warehouse, ChevronRight } from 'lucide-react';
import type { PageId } from '@/types';

interface CurtainNavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentPage: PageId;
  onNavigate: (page: PageId, productId?: string) => void;
  navLinks: { label: string; page: PageId }[];
  user: any;
  profile: any;
  isAdmin: boolean;
  systemStatus: 'ok' | 'degraded' | 'down' | 'loading';
  offlineCount: number;
  isSyncingOffline: boolean;
  onSyncOffline: () => void;
  isShowroomMode: boolean;
  toggleShowroomMode: () => void;
  language: 'kz' | 'ru';
  setLanguage: (lang: 'kz' | 'ru') => void;
  t: (key: string) => string;
}

export default function CurtainNavigationDrawer({
  isOpen,
  onClose,
  currentPage,
  onNavigate,
  navLinks,
  user,
  profile,
  isAdmin,
  systemStatus,
  offlineCount,
  isSyncingOffline,
  onSyncOffline,
  isShowroomMode,
  toggleShowroomMode,
  language,
  setLanguage,
  t,
}: CurtainNavigationDrawerProps) {
  // Lock body scroll and listen for Escape key when open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  const handleLinkClick = (page: PageId) => {
    onClose();
    onNavigate(page);
  };

  const defaultWaMsg = language === 'kz'
    ? 'Сәлеметсіз бе! Synergy-Group кілемдерін көтерме сатып алу бойынша сұрағым бар еді.'
    : 'Здравствуйте! Интересуют оптовые поставки ковров Synergy-Group.';

  return (
    <div
      id="curtain-navigation-drawer"
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-50 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isOpen
          ? 'opacity-100 pointer-events-auto visible'
          : 'opacity-0 pointer-events-none invisible'
      }`}
    >
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/70 backdrop-blur-md transition-opacity duration-500 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Slide-down Curtain Panel (Thompson's Tea Style: Deep Sapphire #003365 + Nocturnal Graphite + Gold Accents) */}
      <div
        className={`relative w-full max-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#05111e] via-[#07192d] to-[#040c16] text-white shadow-2xl border-b border-amber-400/20 transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        {/* Subtle radial luxury glow */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#003365] via-transparent to-transparent"
        />

        {/* Decorative Golden Hairline at Top */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

        <div className="container-w relative py-5 sm:py-6 px-4 sm:px-8">
          {/* Top Bar inside Curtain */}
          <div className="flex items-center justify-between border-b border-white/10 pb-5">
            <div className="flex items-center gap-3">
              <img
                src="/Вектор_Синэнергия.png"
                alt="Synergiya Group"
                className="h-10 sm:h-12 w-auto brightness-0 invert"
              />
              <div className="hidden sm:block border-l border-amber-400/30 pl-3">
                <span className="block text-[10px] tracking-[0.2em] font-bold text-amber-300/90 uppercase">
                  B2B Портал ковров
                </span>
                <span className="block text-[11px] text-slate-300 font-light">
                  Прямой доступ к оптовым складам
                </span>
              </div>
            </div>

            {/* Close button with subtle golden ring */}
            <button
              type="button"
              onClick={onClose}
              className="group flex items-center gap-2 rounded-full border border-amber-400/30 bg-white/5 hover:bg-amber-400/10 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white transition-all duration-200 cursor-pointer"
              aria-label="Закрыть меню"
            >
              <span className="hidden sm:inline text-amber-200/90 group-hover:text-amber-100 uppercase tracking-widest text-[11px]">
                Закрыть
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 group-hover:bg-amber-400/20 group-hover:rotate-90 transition-transform duration-300">
                <X className="h-4 w-4 text-amber-300" />
              </div>
            </button>
          </div>

          {/* Main Body Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-8 sm:py-10">
            {/* Primary Editorial Navigation Links */}
            <nav className="lg:col-span-7 flex flex-col gap-2">
              <span className="text-[11px] font-mono tracking-widest text-amber-300/70 uppercase mb-2">
                — Навигация по порталу
              </span>

              {navLinks.map(({ label, page }, index) => {
                const isActive = currentPage === page;
                return (
                  <button
                    key={page}
                    onClick={() => handleLinkClick(page)}
                    onTouchStart={() => {
                      if (page === 'catalog') import('@/pages/CatalogPage');
                    }}
                    className={`group flex items-center justify-between text-left py-2.5 sm:py-3 transition-all duration-300 cursor-pointer ${
                      isActive
                        ? 'text-amber-300 translate-x-2'
                        : 'text-slate-200 hover:text-white hover:translate-x-2'
                    }`}
                    style={{
                      transitionDelay: isOpen ? `${index * 50}ms` : '0ms',
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-xs text-amber-400/50 group-hover:text-amber-400 transition-colors">
                        0{index + 1}
                      </span>
                      <span className="font-display text-2xl sm:text-3xl font-semibold tracking-wide">
                        {label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-xs uppercase tracking-widest text-amber-300 font-mono hidden sm:inline">
                        Открыть
                      </span>
                      <ChevronRight className="h-5 w-5 text-amber-300" />
                    </div>
                  </button>
                );
              })}

              {/* Extra Account / Cart Links in drawer */}
              <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-3">
                <button
                  onClick={() => handleLinkClick(user ? 'profile' : 'login')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-amber-400/20 text-sm font-semibold text-slate-100 hover:text-white transition-all cursor-pointer"
                >
                  {isAdmin ? (
                    <Shield className="h-4 w-4 text-amber-400" />
                  ) : (
                    <User className="h-4 w-4 text-amber-400" />
                  )}
                  <span>
                    {user && profile
                      ? profile.full_name || profile.company_name || 'Личный кабинет'
                      : t('nav.login')}
                  </span>
                  {user && profile && (
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 border border-amber-400/30">
                      ID {profile.partner_id || (profile as any).erp_id || profile.id.slice(0, 5)}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => handleLinkClick('cart')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 text-sm font-semibold text-amber-200 hover:text-white transition-all cursor-pointer"
                >
                  <span>Перейти в корзину заказов</span>
                  <ChevronRight className="h-4 w-4 text-amber-300" />
                </button>
              </div>
            </nav>

            {/* Secondary Panel: Direct Wholesale Contacts & Status Controls */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-6 lg:border-l lg:border-white/10 lg:pl-8">
              {/* Direct Sales Connection */}
              <div className="rounded-2xl bg-white/[0.03] border border-amber-400/20 p-5 backdrop-blur-sm">
                <span className="text-[11px] font-mono tracking-widest text-amber-300/80 uppercase block mb-3">
                  — Отдел оптовых поставок
                </span>

                <div className="space-y-3">
                  <a
                    href="tel:+77785806866"
                    className="flex items-center gap-3 text-slate-200 hover:text-amber-200 transition-colors group"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-300 group-hover:scale-105 transition-transform">
                      <Phone className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold tracking-wide">+7 (778) 580-68-66</div>
                      <div className="text-[11px] text-slate-400">Пн-Сб с 9:00 до 19:00 (Астана)</div>
                    </div>
                  </a>

                  <a
                    href={`https://wa.me/77785806866?text=${encodeURIComponent(defaultWaMsg)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 border border-[#25D366]/30 px-4 py-3 text-xs font-bold text-[#4ade80] hover:text-white transition-all"
                  >
                    <div className="flex items-center gap-2.5">
                      <MessageCircle className="h-4 w-4 text-[#25D366]" />
                      <span>Написать персональному менеджеру</span>
                    </div>
                    <span className="text-[10px] font-mono bg-[#25D366]/20 px-2 py-0.5 rounded text-emerald-300 uppercase">
                      WhatsApp
                    </span>
                  </a>
                </div>
              </div>

              {/* Preferences & Quick System Controls */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  {/* Language switch */}
                  <div className="flex items-center rounded-xl bg-white/5 p-1 border border-white/10 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setLanguage('kz')}
                      className={`rounded-lg px-3 py-1.5 transition-all ${
                        language === 'kz'
                          ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Қазақша (KZ)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage('ru')}
                      className={`rounded-lg px-3 py-1.5 transition-all ${
                        language === 'ru'
                          ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Русский (RU)
                    </button>
                  </div>

                  {/* Showroom presentation mode toggle */}
                  <button
                    type="button"
                    onClick={toggleShowroomMode}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                      isShowroomMode
                        ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold shadow-xs'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                    }`}
                  >
                    {isShowroomMode ? <EyeOff className="h-4 w-4 text-amber-300" /> : <Eye className="h-4 w-4 text-slate-400" />}
                    <span>{isShowroomMode ? 'Витрина вкл (цены скрыты)' : 'Режим витрины'}</span>
                  </button>
                </div>

                {/* Offline queue sync trigger if pending orders exist */}
                {offlineCount > 0 && (
                  <button
                    type="button"
                    onClick={onSyncOffline}
                    disabled={isSyncingOffline}
                    className="w-full flex items-center justify-between px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-200 text-xs font-semibold hover:bg-amber-500/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isSyncingOffline ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-300" />
                      ) : (
                        <CloudOff className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
                      )}
                      <span>Офлайн-заказов в очереди: {offlineCount}</span>
                    </div>
                    <span className="underline uppercase tracking-wider text-[10px]">
                      {isSyncingOffline ? 'Синхронизация...' : 'Синхронизировать'}
                    </span>
                  </button>
                )}

                {/* Real-time Status Badges */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/10">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-3.5 w-3.5 text-amber-400" />
                    <span>3 оптовых склада (Алматы, Астана, Шымкент)</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        systemStatus === 'ok'
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                          : systemStatus === 'degraded'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    <span className="uppercase text-slate-300">
                      {systemStatus === 'ok' ? 'ERP 1C Online' : 'ERP Offline'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Carpet Kilim Ornament Fringe Line */}
        <div className="h-3 w-full bg-[#030912] border-t border-amber-400/20 flex items-center justify-center overflow-hidden">
          <div className="w-full max-w-5xl flex items-center justify-between px-4 opacity-40">
            {Array.from({ length: 24 }).map((_, i) => (
              <span key={i} className="text-[8px] text-amber-300/80 select-none">
                ✦
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
