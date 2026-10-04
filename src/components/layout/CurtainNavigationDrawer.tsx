import { useEffect } from 'react';
import { X, Phone, MessageCircle, Eye, EyeOff } from 'lucide-react';
import type { PageId } from '@/types';
import { type Language, SUPPORTED_LANGUAGES } from '@/contexts/LanguageContext';

interface CurtainNavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentPage: PageId;
  onNavigate: (page: PageId, productId?: string) => void;
  user: any;
  profile: any;
  isAdmin: boolean;
  isShowroomMode: boolean;
  toggleShowroomMode: () => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, paramsOrFallback?: any, fallback?: string) => string;
}

export default function CurtainNavigationDrawer({
  isOpen,
  onClose,
  currentPage,
  onNavigate,
  user,
  profile,
  isShowroomMode,
  toggleShowroomMode,
  language,
  setLanguage,
  t,
}: CurtainNavigationDrawerProps) {
  // Lock body scroll and handle Escape key
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

  const handleClose = () => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onClose();
  };

  const handleLinkClick = (page: PageId) => {
    handleClose();
    onNavigate(page);
  };

  const menuItems: { label: string; page: PageId }[] = [
    { label: t('nav.home'), page: 'home' },
    { label: t('nav.catalog'), page: 'catalog' },
    { label: t('nav.contacts'), page: 'contacts' },
    { label: user ? (profile?.company_name || profile?.full_name || t('nav.profile')) : t('nav.login'), page: user ? 'profile' : 'login' },
    { label: t('nav.cart'), page: 'cart' },
  ];

  const defaultWaMsg = t('whatsapp.default_msg');

  return (
    <div
      id="curtain-navigation-drawer"
      aria-hidden={!isOpen ? true : undefined}
      // @ts-expect-error React 18 inert attribute support
      inert={!isOpen ? '' : undefined}
      className={`fixed inset-0 z-[70] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isOpen
          ? 'opacity-100 pointer-events-auto visible'
          : 'opacity-0 pointer-events-none invisible'
      }`}
    >
      {/* Dark backdrop overlay */}
      <div
        onClick={handleClose}
        className={`absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-500 modal-gpu-backdrop ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Pure Editorial Curtain Panel */}
      <div
        className={`relative w-full h-[100dvh] max-h-[100dvh] overflow-y-auto bg-[#161824] text-white shadow-2xl flex flex-col justify-between p-6 sm:p-12 pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+2rem))] transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] modal-gpu-card ${
          isOpen ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        {/* Top bar with close button on left */}
        <div className="flex items-center justify-between w-full max-w-4xl mx-auto">
          <button
            type="button"
            onClick={handleClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white/80 hover:text-white hover:border-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
            aria-label="Закрыть меню"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Centered Editorial Navigation Links */}
        <nav className="my-auto py-4 sm:py-8 flex flex-col items-center justify-center text-center space-y-4 sm:space-y-6">
          {menuItems.map(({ label, page }) => {
            const isActive = currentPage === page;
            return (
              <button
                key={`${page}-${label}`}
                onClick={() => handleLinkClick(page)}
                onTouchStart={() => {
                  if (page === 'catalog') import('@/pages/CatalogPage');
                }}
                className={`block uppercase tracking-[0.25em] text-base sm:text-lg lg:text-xl font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'text-amber-300 font-bold scale-105'
                    : 'text-white/85 hover:text-white hover:tracking-[0.3em]'
                }`}
              >
                {label}
              </button>
            );
          })}
          {/* Service & Legal links for mobile compliance */}
          <div className="pt-2 sm:pt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-white/60 border-t border-white/5 mt-2">
            <button
              onClick={() => handleLinkClick('delivery')}
              className="hover:text-amber-300 transition-colors cursor-pointer"
            >
              Доставка и оплата
            </button>
            <span>•</span>
            <button
              onClick={() => handleLinkClick('returns')}
              className="text-amber-400/90 hover:text-amber-300 transition-colors cursor-pointer font-medium"
            >
              Возврат 14 дней
            </button>
            <span>•</span>
            <button
              onClick={() => handleLinkClick('terms')}
              className="hover:text-amber-300 transition-colors cursor-pointer"
            >
              Оферта и реквизиты
            </button>
          </div>
        </nav>

        {/* Bottom Controls: Language Selector Bar + Action Icons */}
        <div className="w-full max-w-md mx-auto mt-auto pt-5 pb-6 sm:pb-8 border-t border-white/10 flex flex-col items-center justify-center gap-5">
          {/* 4-Language Segmented Controls */}
          <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/10 border border-white/15">
            {SUPPORTED_LANGUAGES.map((langOpt) => {
              const isSelected = language === langOpt.code;
              return (
                <button
                  key={langOpt.code}
                  type="button"
                  onClick={() => setLanguage(langOpt.code)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold font-mono transition-all cursor-pointer flex items-center gap-1 ${
                    isSelected
                      ? 'bg-amber-300 text-slate-950 shadow-md scale-105'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                  title={langOpt.label}
                  aria-label={langOpt.label}
                >
                  <span className="text-sm leading-none">{langOpt.flag}</span>
                  <span>{langOpt.shortLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-4">
            {/* WhatsApp */}
            <a
              href={`https://wa.me/77785806866?text=${encodeURIComponent(defaultWaMsg)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white/80 hover:text-[#4ade80] hover:border-[#4ade80] hover:bg-white/5 transition-all duration-200 cursor-pointer"
              title="WhatsApp"
              aria-label="WhatsApp"
            >
              <MessageCircle className="h-5 w-5" />
            </a>

            {/* Phone */}
            <a
              href="tel:+77785806866"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white/80 hover:text-amber-300 hover:border-amber-300 hover:bg-white/5 transition-all duration-200 cursor-pointer"
              title="+7 (778) 580-68-66"
              aria-label="Телефон"
            >
              <Phone className="h-5 w-5" />
            </a>

            {/* Showroom Presentation Mode */}
            <button
              type="button"
              onClick={toggleShowroomMode}
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-200 cursor-pointer ${
                isShowroomMode
                  ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                  : 'border-white/25 text-white/80 hover:text-white hover:border-white hover:bg-white/5'
              }`}
              title={isShowroomMode ? t('nav.exit_showroom') : t('nav.showroom_banner')}
              aria-label="Режим витрины"
            >
              {isShowroomMode ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
