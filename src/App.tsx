import { useState, useCallback, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
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

function ImpersonationBanner() {
  const { isImpersonating, profile, stopImpersonation } = useAuth();
  if (!isImpersonating || !profile) return null;

  return (
    <div className="bg-amber-500 text-white px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 sticky top-0 z-[60] shadow-md">
      <div className="flex items-center gap-2">
        <span className="flex h-2 w-2 rounded-full bg-white animate-ping" />
        <span>
          Режим просмотра от имени: <strong>{profile.full_name || profile.company_name || 'Пользователь'}</strong>
          {profile.company_name && ` (${profile.company_name})`}
          {profile.price_type && <span className="ml-1.5 bg-amber-600 px-1.5 py-0.5 rounded text-[10px] font-mono">Тип цен: {profile.price_type}</span>}
        </span>
      </div>
      <button
        onClick={stopImpersonation}
        className="rounded bg-white px-3 py-1 text-xs font-bold text-amber-900 shadow hover:bg-amber-50 transition-colors"
      >
        Вернуться в свой аккаунт
      </button>
    </div>
  );
}

function MainLayout({ children, page, navigate, showFooter }: { children: React.ReactNode; page: PageId; navigate: (page: PageId, id?: string) => void; showFooter: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <ImpersonationBanner />
      <Header currentPage={page} onNavigate={navigate} />
      <main className="flex-1">{children}</main>
      {showFooter && <Footer onNavigate={navigate} />}
      <MobileNav currentPage={page} onNavigate={navigate} />
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const [productId, setProductId] = useState<string>('');
  const [catalogCollection, setCatalogCollection] = useState<string | undefined>(undefined);
  const [catalogCountry, setCatalogCountry] = useState<string | undefined>(undefined);
  const [preloaderDone, setPreloaderDone] = useState(false);

  const navigate = useCallback((target: PageId, id?: string) => {
    setPage(target);
    if (target === 'catalog' && id?.startsWith('country:')) {
      setCatalogCountry(id.slice('country:'.length));
      setCatalogCollection(undefined);
    } else if (target === 'catalog' && id) {
      setCatalogCollection(id);
      setCatalogCountry(undefined);
    } else if (target === 'catalog') {
      setCatalogCollection(undefined);
      setCatalogCountry(undefined);
    }
    if (target !== 'product') {
      // keep productId for product page
    }
    if (id && target === 'product') setProductId(id);
    window.scrollTo({ top: 0, behavior: 'auto' });
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
      case 'catalog': return <CatalogPage key={catalogCollection ?? catalogCountry ?? 'all'} onNavigate={navigate} initialCollection={catalogCollection} initialCountry={catalogCountry} />;
      case 'product': return <ProductPage key={productId} productId={productId} onNavigate={navigate} />;
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
        <MainLayout page={page} navigate={navigate} showFooter={showFooter}>
          {renderPage()}
        </MainLayout>
      </CartProvider>
    </AuthProvider>
  );
}
