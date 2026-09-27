import { useState, useCallback, useEffect } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileNav from '@/components/MobileNav';
import HomePage from '@/pages/HomePage';
import CatalogPage from '@/pages/CatalogPage';
import ProductPage from '@/pages/ProductPage';
import CartPage from '@/pages/CartPage';
import ContactsPage from '@/pages/ContactsPage';
import LoginPage from '@/pages/LoginPage';
import ProfilePage from '@/pages/ProfilePage';
import type { PageId } from '@/types';

function Preloader({ onFinished }: { onFinished: () => void }) {
  const [phase, setPhase] = useState<'logo' | 'expand' | 'done'>('logo');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('expand'), 1800);
    const t2 = setTimeout(() => {
      setPhase('done');
      onFinished();
    }, 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onFinished]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900 transition-opacity duration-500 ${
        phase === 'done' ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Radial glow behind logo */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={`w-80 h-80 rounded-full bg-brand-600/20 blur-3xl transition-all duration-1000 ${
            phase === 'logo' ? 'scale-100 opacity-100' : 'scale-150 opacity-0'
          }`}
        />
      </div>

      {/* Logo container */}
      <div
        className={`relative flex flex-col items-center gap-6 transition-all duration-700 ease-out ${
          phase === 'expand' ? 'scale-110 opacity-0 translate-y-[-20px]' : 'scale-100 opacity-100 translate-y-0'
        }`}
      >
        <img
          src="/Вектор_Синэнергия.png"
          alt="Synergiya Group"
          className="h-32 sm:h-40 w-auto drop-shadow-2xl animate-preloader-logo brightness-0 invert"
        />
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-8 bg-brand-400 rounded-full animate-preloader-line-left" />
          <div className="h-1 w-1 rounded-full bg-brand-400 animate-preloader-dot" />
          <div className="h-0.5 w-8 bg-brand-400 rounded-full animate-preloader-line-right" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const [productId, setProductId] = useState<string>('');
  const [catalogCollection, setCatalogCollection] = useState<string | undefined>(undefined);
  const [preloaderDone, setPreloaderDone] = useState(false);

  const navigate = useCallback((target: PageId, id?: string) => {
    setPage(target);
    if (target === 'catalog' && id) {
      setCatalogCollection(id);
    } else if (target === 'catalog') {
      setCatalogCollection(undefined);
    }
    if (target !== 'product') {
      // keep productId for product page
    }
    if (id && target === 'product') setProductId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const titles: Record<PageId, string> = {
      home: 'Synergy-Group — Оптовые поставки ковров в Казахстане',
      catalog: 'Каталог ковров оптом — Synergy-Group',
      product: 'Товар — Synergy-Group',
      cart: 'Корзина — Synergy-Group',
      contacts: 'Контакты — Synergy-Group | Склады в Астане, Алматы, Шымкенте',
      login: 'Вход в личный кабинет — Synergy-Group',
      profile: 'Личный кабинет — Synergy-Group',
    };
    document.title = titles[page];
  }, [page]);

  const handlePreloaderFinished = useCallback(() => setPreloaderDone(true), []);

  const renderPage = () => {
    switch (page) {
      case 'home': return <HomePage onNavigate={navigate} />;
      case 'catalog': return <CatalogPage key={catalogCollection ?? 'all'} onNavigate={navigate} initialCollection={catalogCollection} />;
      case 'product': return <ProductPage productId={productId} onNavigate={navigate} />;
      case 'cart': return <CartPage onNavigate={navigate} />;
      case 'contacts': return <ContactsPage onNavigate={navigate} />;
      case 'login': return <LoginPage onNavigate={navigate} />;
      case 'profile': return <ProfilePage onNavigate={navigate} />;
      default: return <HomePage onNavigate={navigate} />;
    }
  };

  const showFooter = page !== 'login';

  return (
    <AuthProvider>
      <CartProvider>
        {!preloaderDone && <Preloader onFinished={handlePreloaderFinished} />}
        <div className="flex min-h-screen flex-col">
          <Header currentPage={page} onNavigate={navigate} />
          <main className="flex-1">{renderPage()}</main>
          {showFooter && <Footer onNavigate={navigate} />}
          <MobileNav currentPage={page} onNavigate={navigate} />
        </div>
      </CartProvider>
    </AuthProvider>
  );
}
