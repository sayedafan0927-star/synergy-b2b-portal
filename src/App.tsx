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

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const [productId, setProductId] = useState<string>('');

  const navigate = useCallback((target: PageId, id?: string) => {
    setPage(target);
    if (id) setProductId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const titles: Record<PageId, string> = {
      home: 'Synergy-Group — Оптовые поставки ковров',
      catalog: 'Каталог — Synergy-Group',
      product: 'Товар — Synergy-Group',
      cart: 'Корзина — Synergy-Group',
      contacts: 'Контакты — Synergy-Group',
      login: 'Вход — Synergy-Group',
      profile: 'Кабинет — Synergy-Group',
    };
    document.title = titles[page];
  }, [page]);

  const renderPage = () => {
    switch (page) {
      case 'home': return <HomePage onNavigate={navigate} />;
      case 'catalog': return <CatalogPage onNavigate={navigate} />;
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
