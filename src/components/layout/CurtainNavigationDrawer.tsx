import { useEffect } from 'react';
import { X, Phone, MessageCircle, Eye, EyeOff } from 'lucide-react';
import type { PageId } from '@/types';

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
  language: 'kz' | 'ru';
  setLanguage: (lang: 'kz' | 'ru') => void;
  t: (key: string) => string;
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

  const handleLinkClick = (page: PageId) => {
    onClose();
    onNavigate(page);
  };

  const menuItems: { label: string; page: PageId }[] = [
    { label: t('nav.home') || 'Главная', page: 'home' },
    { label: t('nav.catalog') || 'Каталог ковров', page: 'catalog' },
    { label: 'О компании', page: 'contacts' },
    { label: t('nav.contacts') || 'Контакты', page: 'contacts' },
    { label: user ? (profile?.company_name || profile?.full_name || 'Личный кабинет') : (t('nav.login') || 'Личный кабинет'), page: user ? 'profile' : 'login' },
    { label: t('nav.cart') || 'Корзина заказов', page: 'cart' },
  ];

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
      {/* Dark backdrop overlay */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-500 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Pure Editorial Curtain Panel (Exact Thompson's Tea Reference: Matte Midnight Slate #161824) */}
      <div
        className={`relative w-full h-[100dvh] max-h-[100dvh] overflow-y-auto bg-[#161824] text-white shadow-2xl flex flex-col justify-between p-6 sm:p-12 transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        {/* Top bar with close button on left (exact reference layout) */}
        <div className="flex items-center justify-between w-full max-w-4xl mx-auto">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white/80 hover:text-white hover:border-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
            aria-label="Закрыть меню"
          >
            <X className="h-5 w-5" />
          </button>

          <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-white/40">
            Synergy B2B
          </span>
        </div>

        {/* Centered Editorial Navigation Links */}
        <nav className="my-auto py-8 flex flex-col items-center justify-center text-center space-y-5 sm:space-y-6">
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
        </nav>

        {/* Bottom Centered Circular Icon Controls (Exact Thompson's Tea Reference) */}
        <div className="w-full max-w-md mx-auto pt-6 border-t border-white/10 flex flex-col items-center gap-4">
          <div className="flex items-center justify-center gap-4">
            {/* WhatsApp */}
            <a
              href={`https://wa.me/77785806866?text=${encodeURIComponent(defaultWaMsg)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white/80 hover:text-[#4ade80] hover:border-[#4ade80] hover:bg-white/5 transition-all duration-200 cursor-pointer"
              title="Написать в WhatsApp"
              aria-label="WhatsApp"
            >
              <MessageCircle className="h-5 w-5" />
            </a>

            {/* Phone */}
            <a
              href="tel:+77785806866"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white/80 hover:text-amber-300 hover:border-amber-300 hover:bg-white/5 transition-all duration-200 cursor-pointer"
              title="Позвонить в отдел продаж"
              aria-label="Позвонить"
            >
              <Phone className="h-5 w-5" />
            </a>

            {/* Language Switcher Circle */}
            <button
              type="button"
              onClick={() => setLanguage(language === 'kz' ? 'ru' : 'kz')}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white/80 hover:text-white hover:border-white hover:bg-white/5 font-mono text-xs font-bold transition-all duration-200 cursor-pointer"
              title={language === 'kz' ? 'Переключить на русский' : 'Қазақ тіліне ауыстыру'}
              aria-label="Сменить язык"
            >
              {language.toUpperCase()}
            </button>

            {/* Showroom Presentation Mode */}
            <button
              type="button"
              onClick={toggleShowroomMode}
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-200 cursor-pointer ${
                isShowroomMode
                  ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                  : 'border-white/25 text-white/80 hover:text-white hover:border-white hover:bg-white/5'
              }`}
              title={isShowroomMode ? 'Режим витрины включен (цены скрыты)' : 'Включить режим витрины'}
              aria-label="Режим витрины"
            >
              {isShowroomMode ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          <span className="font-mono text-[10px] text-white/30 tracking-widest uppercase">
            Алматы • Астана • Шымкент
          </span>
        </div>
      </div>
    </div>
  );
}
