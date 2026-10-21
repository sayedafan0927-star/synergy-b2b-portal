import { useState, useEffect } from 'react';
import { Home, LayoutGrid, ShoppingCart, User } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PageId } from '@/types';

interface MobileNavProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

export default function MobileNav({ currentPage, onNavigate }: MobileNavProps) {
  const { totalItems } = useCart();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [isInputFocused, setIsInputFocused] = useState(false);

  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isEditable(e.target)) setIsInputFocused(true);
    };
    const onFocusOut = () => {
      setTimeout(() => {
        if (!isEditable(document.activeElement)) setIsInputFocused(false);
      }, 60);
    };
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const tabs: { icon: typeof Home; label: string; page: PageId }[] = [
    { icon: Home, label: t('nav.home'), page: 'home' },
    { icon: LayoutGrid, label: t('nav.catalog'), page: 'catalog' },
    { icon: ShoppingCart, label: t('nav.cart'), page: 'cart' },
    { icon: User, label: t('nav.profile_short'), page: 'profile' },
  ];

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white shadow-sm lg:hidden transition-transform duration-200 ${
        isInputFocused ? 'translate-y-full pointer-events-none opacity-0' : 'translate-y-0 opacity-100'
      }`}
    >
      <div className="flex h-16 items-stretch">
        {tabs.map(({ icon: Icon, label, page }) => {
          const active = currentPage === page || (page === 'profile' && currentPage === 'login');
          return (
            <button
              key={page}
              onClick={() => onNavigate(page === 'profile' && !user ? 'login' : page)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                active ? 'text-brand-700 font-semibold' : 'text-slate-400'
              }`}
            >
              <div className="relative">
                <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
                {page === 'cart' && totalItems > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-bold text-white">
                    {totalItems}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
