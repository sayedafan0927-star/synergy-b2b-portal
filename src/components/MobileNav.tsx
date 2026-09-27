import { Home, LayoutGrid, ShoppingCart, User } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import type { PageId } from '@/types';

interface MobileNavProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

const TABS: { icon: typeof Home; label: string; page: PageId }[] = [
  { icon: Home, label: 'Главная', page: 'home' },
  { icon: LayoutGrid, label: 'Каталог', page: 'catalog' },
  { icon: ShoppingCart, label: 'Корзина', page: 'cart' },
  { icon: User, label: 'Кабинет', page: 'profile' },
];

export default function MobileNav({ currentPage, onNavigate }: MobileNavProps) {
  const { totalItems } = useCart();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/95 backdrop-blur-md lg:hidden">
      <div className="flex h-16 items-stretch">
        {TABS.map(({ icon: Icon, label, page }) => {
          const active = currentPage === page;
          return (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-brand-700' : 'text-slate-400'
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
