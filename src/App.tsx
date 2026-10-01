import { useState, useCallback, useEffect, lazy, Suspense, useTransition } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { RealtimeNotificationsWatcher } from '@/hooks/useRealtimeNotifications';
import WhatsAppWidget from '@/components/WhatsAppWidget';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileNav from '@/components/MobileNav';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ShowroomModeProvider } from '@/contexts/ShowroomModeContext';

// Основные компактные страницы импортируются напрямую для мгновенных переходов
import HomePage from '@/pages/HomePage';
import ContactsPage from '@/pages/ContactsPage';
import LoginPage from '@/pages/LoginPage';

// Code Splitting с автоматическим обновлением при выкатке новой версии на Vercel
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('Expected a JavaScript-or-Wasm module script')
      ) {
        const retryKey = 'chunk_reload_' + (typeof window !== 'undefined' ? window.location.pathname : '');
        if (typeof window !== 'undefined' && !sessionStorage.getItem(retryKey)) {
          sessionStorage.setItem(retryKey, '1');
          window.location.reload();
          return new Promise(() => {}) as any;
        }
      }
      throw err;
    }
  });
}

const CatalogPage = lazyWithRetry(() => import('@/pages/CatalogPage'));
const ProductPage = lazyWithRetry(() => import('@/pages/ProductPage'));
const CartPage = lazyWithRetry(() => import('@/pages/CartPage'));
const ProfilePage = lazyWithRetry(() => import('@/pages/ProfilePage'));

import { useNetworkStatus } from '@/registerServiceWorker';
import { initOfflineQueueAutoSync } from '@/lib/offlineOrderQueue';
import OfflineBanner from '@/components/common/OfflineBanner';
import type { PageId } from '@/types';

function PageLoadingFallback({ page }: { page?: PageId }) {
  if (page === 'catalog') {
    return (
      <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8">
        <div className="container-w">
          <div className="mb-8">
            <div className="skeleton h-8 w-64 mb-3" />
            <div className="skeleton h-4 w-96 max-w-full" />
          </div>
          <div className="mb-6 flex gap-3">
            <div className="skeleton h-11 w-28" />
            <div className="skeleton h-11 w-40" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card overflow-hidden">
                <div className="skeleton aspect-[4/3] rounded-none" />
                <div className="p-3 sm:p-4 space-y-2">
                  <div className="skeleton h-3 w-full" />
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-4 w-20 mt-2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8">
      <div className="container-w py-8">
        <div className="mb-8 space-y-3">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
        <div className="card p-6 md:p-8 space-y-4">
          <div className="skeleton h-6 w-1/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      </div>
    </section>
  );
}

function Preloader({ onFinished }: { onFinished: () => void }) {
  const [phase, setPhase] = useState<'logo' | 'expand' | 'done'>('logo');
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    // Гарантируем полную готовность оптимизированного логотипа перед стартом анимации
    const img = new Image();
    img.src = '/Вектор_Синэнергия.png';
    if (img.complete && img.naturalWidth > 0) {
      setImageReady(true);
    } else {
      img.onload = () => setImageReady(true);
      img.onerror = () => setImageReady(true);
    }
  }, []);

  useEffect(() => {
    // Zero-Wait TTI: мгновенный переход без искусственных задержек для B2B-пользователей
    const t = setTimeout(() => {
      setPhase('done');
      onFinished();
    }, 50);
    return () => clearTimeout(t);
  }, [onFinished]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900 transition-opacity duration-400 ease-out ${
        phase === 'done' ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Radial glow behind logo */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className={`w-72 h-72 rounded-full bg-brand-600/30 blur-3xl transition-all duration-700 ${
            phase === 'logo' ? 'scale-100 opacity-100' : 'scale-125 opacity-0'
          }`}
        />
      </div>

      {/* Logo container */}
      <div
        className={`relative flex flex-col items-center gap-5 transition-all duration-400 ease-out ${
          phase === 'expand' ? 'scale-105 opacity-0 -translate-y-2' : 'scale-100 opacity-100 translate-y-0'
        }`}
      >
        <img
          src="/Вектор_Синэнергия.png"
          alt="Synergiya Group"
          onLoad={() => setImageReady(true)}
          className={`h-28 sm:h-36 w-auto drop-shadow-2xl brightness-0 invert transition-opacity duration-300 ${
            imageReady ? 'opacity-100 animate-preloader-logo' : 'opacity-0'
          }`}
        />
        <div className={`flex items-center gap-2 transition-opacity duration-300 ${imageReady ? 'opacity-100' : 'opacity-0'}`}>
          <div className="h-0.5 w-8 bg-brand-400 rounded-full animate-preloader-line-left" />
          <div className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-preloader-dot" />
          <div className="h-0.5 w-8 bg-brand-400 rounded-full animate-preloader-line-right" />
        </div>
      </div>
    </div>
  );
}

function MainLayout({ children, page, navigate, showFooter }: { children: React.ReactNode; page: PageId; navigate: (page: PageId, id?: string) => void; showFooter: boolean }) {
  const { isImpersonating, profile } = useAuth();
  const showBanner = Boolean(isImpersonating && profile);

  return (
    <div className="flex min-h-screen flex-col">
      <Header currentPage={page} onNavigate={navigate} />
      <main className={`flex-1 transition-all duration-200 ${showBanner ? 'pt-9 sm:pt-9' : ''}`}>{children}</main>
      {showFooter && <Footer onNavigate={navigate} />}
      <MobileNav currentPage={page} onNavigate={navigate} />
      <WhatsAppWidget />
    </div>
  );
}

function parseUrlState(): { page: PageId; id?: string } {
  try {
    const rawPath = typeof window !== 'undefined' ? window.location.pathname.replace(/^\/+|\/+$/g, '') : '';
    if (rawPath && ['home', 'catalog', 'product', 'cart', 'contacts', 'login', 'profile'].includes(rawPath)) {
      return { page: rawPath as PageId };
    }

    const params = new URLSearchParams(window.location.search);
    const prodId = params.get('product');
    if (prodId) return { page: 'product', id: prodId };

    const country = params.get('country');
    if (country) return { page: 'catalog', id: `country:${country}` };

    const search = params.get('search');
    if (search) return { page: 'catalog', id: `search:${search}` };

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
  const [catalogSearch, setCatalogSearch] = useState<string | undefined>(undefined);
  const [preloaderDone, setPreloaderDone] = useState(false);
  const isOnline = useNetworkStatus();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback((target: PageId, id?: string, pushToHistory = true) => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    startTransition(() => {
      setPage(target);
      if (target === 'catalog' && id?.startsWith('country:')) {
        setCatalogCountry(id.slice('country:'.length));
        setCatalogCollection(undefined);
        setCatalogSearch(undefined);
      } else if (target === 'catalog' && id?.startsWith('search:')) {
        setCatalogSearch(id.slice('search:'.length));
        setCatalogCollection(undefined);
        setCatalogCountry(undefined);
      } else if (target === 'catalog' && id) {
        setCatalogCollection(id);
        setCatalogCountry(undefined);
        setCatalogSearch(undefined);
      } else if (target === 'catalog') {
        setCatalogCollection(undefined);
        setCatalogCountry(undefined);
        setCatalogSearch(undefined);
      }
      if (id && target === 'product') setProductId(id);
    });

    if (pushToHistory) {
      const url = new URL(window.location.href);
      url.search = '';
      if (target === 'product' && id) {
        url.searchParams.set('product', id);
      } else if (target === 'catalog') {
        if (id?.startsWith('country:')) {
          url.searchParams.set('country', id.slice('country:'.length));
        } else if (id?.startsWith('search:')) {
          url.searchParams.set('search', id.slice('search:'.length));
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

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
  }, []);

  // Guarantee scroll-to-top on page and filter transitions
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const raf = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(raf);
  }, [page, catalogCountry, catalogCollection, catalogSearch]);

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

  // Фоновая предзагрузка каталога в моменты простоя браузера
  useEffect(() => {
    const prefetch = () => {
      import('@/pages/CatalogPage');
    };
    if (typeof window !== 'undefined') {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(prefetch, { timeout: 2500 });
      } else {
        const timer = setTimeout(prefetch, 1200);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handlePreloaderFinished = useCallback(() => setPreloaderDone(true), []);

  const renderPage = () => {
    switch (page) {
      case 'home': return null;
      case 'catalog': return (
        <CatalogPage
          key={catalogCollection ?? catalogCountry ?? catalogSearch ?? 'all'}
          onNavigate={navigate}
          initialCollection={catalogCollection}
          initialCountry={catalogCountry}
          initialSearch={catalogSearch}
        />
      );
      case 'product': return <ProductPage key={productId} productId={productId} onNavigate={navigate} />;
      case 'cart': return <CartPage onNavigate={navigate} />;
      case 'contacts': return <ContactsPage onNavigate={navigate} />;
      case 'login': return <LoginPage onNavigate={navigate} />;
      case 'profile': return <ProfilePage onNavigate={navigate} />;
      default: return null;
    }
  };

  const showFooter = page !== 'login';

  return (
    <LanguageProvider>
      <AuthProvider>
        <ShowroomModeProvider>
          <CurrencyProvider>
            <CartProvider>
              <ToastProvider>
                <RealtimeNotificationsWatcher />
                <OfflineBanner />
                {isPending && (
                  <div className="fixed top-0 left-0 right-0 z-[99999] h-0.5 bg-gradient-to-r from-brand-600 via-amber-500 to-brand-700 animate-pulse pointer-events-none" />
                )}
                {!preloaderDone && <Preloader onFinished={handlePreloaderFinished} />}
                <ErrorBoundary>
                  <MainLayout page={page} navigate={navigate} showFooter={showFooter}>
                    <Suspense fallback={<PageLoadingFallback page={page} />}>
                      <div
                        className={page === 'home' ? 'contents' : 'hidden'}
                        // @ts-expect-error React 18 inert attribute support
                        inert={page !== 'home' ? '' : undefined}
                        aria-hidden={page !== 'home' ? true : undefined}
                      >
                        <HomePage onNavigate={navigate} isReady={preloaderDone} />
                      </div>
                      {page !== 'home' && renderPage()}
                    </Suspense>
                  </MainLayout>
                </ErrorBoundary>
              </ToastProvider>
            </CartProvider>
          </CurrencyProvider>
        </ShowroomModeProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
