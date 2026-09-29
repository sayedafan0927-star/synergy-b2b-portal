import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import WhatsAppWidget from '@/components/WhatsAppWidget';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileNav from '@/components/MobileNav';

// Code Splitting: Ленивая загрузка страниц для максимального быстродействия
const HomePage = lazy(() => import('@/pages/HomePage'));
const CatalogPage = lazy(() => import('@/pages/CatalogPage'));
const ProductPage = lazy(() => import('@/pages/ProductPage'));
const CartPage = lazy(() => import('@/pages/CartPage'));
const ContactsPage = lazy(() => import('@/pages/ContactsPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));

import { useNetworkStatus } from '@/registerServiceWorker';
import { initOfflineQueueAutoSync } from '@/lib/offlineOrderQueue';
import type { PageId } from '@/types';

function PageLoadingFallback() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center py-24 px-4">
      <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Загрузка раздела...</p>
    </div>
  );
}

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
      <WhatsAppWidget />
    </div>
  );
}

function parseUrlState(): { page: PageId; id?: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    const prodId = params.get('product');
    if (prodId) return { page: 'product', id: prodId };

    const country = params.get('country');
    if (country) return { page: 'catalog', id: `country:${country}` };

    const collection = params.get('collection');
    if (collection) return { page: 'catalog', id: collection };

    const pageParam = params.get('page') as PageId | null;
    if (pageParam && ['home', 'catalog', 'product', 'cart', 'contacts', 'login', 'profile'].includes(pageParam)) {
      return { page: pageParam };
    }

    if (params.has('catalog')) return { page: 'catalog' };
    if (params.has('cart')) return { page: 'cart' };
    if (params.has('contacts')) return { page: 'contacts' };
    if (params.has('login')) return { page: 'login' };
    if (params.has('profile')) return { page: 'profile' };
  } catch {
    // fallback
  }
  return { page: 'home' };
}

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const [productId, setProductId] = useState<string>('');
  const [catalogCollection, setCatalogCollection] = useState<string | undefined>(undefined);
  const [catalogCountry, setCatalogCountry] = useState<string | undefined>(undefined);
  const [preloaderDone, setPreloaderDone] = useState(false);
  const isOnline = useNetworkStatus();

  const navigate = useCallback((target: PageId, id?: string, pushToHistory = true) => {
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
    if (id && target === 'product') setProductId(id);

    if (pushToHistory) {
      const url = new URL(window.location.href);
      url.search = '';
      if (target === 'product' && id) {
        url.searchParams.set('product', id);
      } else if (target === 'catalog') {
        if (id?.startsWith('country:')) {
          url.searchParams.set('country', id.slice('country:'.length));
        } else if (id) {
          url.searchParams.set('collection', id);
        } else {
          url.searchParams.set('page', 'catalog');
        }
      } else if (target !== 'home') {
        url.searchParams.set('page', target);
      }
      window.history.pushState({ page: target, id }, '', url.pathname + url.search);
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // Синхронизация с системной кнопкой «Назад» и свайпом назад
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.page) {
        navigate(state.page, state.id, false);
      } else {
        const parsed = parseUrlState();
        navigate(parsed.page, parsed.id, false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [navigate]);

  // Первоначальное чтение URL при загрузке страницы
  useEffect(() => {
    const initial = parseUrlState();
    if (initial.page !== 'home' || initial.id) {
      navigate(initial.page, initial.id, false);
      window.history.replaceState({ page: initial.page, id: initial.id }, '', window.location.href);
    } else {
      window.history.replaceState({ page: 'home' }, '', window.location.href);
    }
  }, [navigate]);

  useEffect(() => {
    const titles: Record<PageId, string> = {
      home: 'Synergy-Group — Оптовые поставки ковров в Казахстане',
      catalog: 'Каталог ковров оптом — Synergy-Group',
      product: 'Товар — Synergy-Group',
      cart: 'Корзина — Synergy-Group',
      contacts: 'Контакты — Synergy-Group | Склад в Астане',
      login: 'Вход в личный кабинет — Synergy-Group',
      profile: 'Личный кабинет — Synergy-Group',
    };
    document.title = titles[page];
  }, [page]);

  useEffect(() => {
    const cleanup = initOfflineQueueAutoSync();
    return cleanup;
  }, []);

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
    <LanguageProvider>
      <AuthProvider>
        <CurrencyProvider>
          <CartProvider>
            {!preloaderDone && <Preloader onFinished={handlePreloaderFinished} />}
            {!isOnline && (
              <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 z-[9990] flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-500 text-white px-4 py-2.5 shadow-xl text-xs font-semibold backdrop-blur-md">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
                <span>Офлайн-режим: данные каталога загружены из локального кэша</span>
              </div>
            )}
            <MainLayout page={page} navigate={navigate} showFooter={showFooter}>
              <Suspense fallback={<PageLoadingFallback />}>
                {renderPage()}
              </Suspense>
            </MainLayout>
          </CartProvider>
        </CurrencyProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
