import { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';
import type { PageId } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';

interface CookieBannerProps {
  onNavigate: (page: PageId) => void;
}

const COOKIE_STORAGE_KEY = 'synergy:cookie_consent_v1';

export default function CookieBanner({ onNavigate }: CookieBannerProps) {
  const [visible, setVisible] = useState(false);
  const { language } = useLanguage();

  useEffect(() => {
    try {
      const consented = localStorage.getItem(COOKIE_STORAGE_KEY);
      if (!consented) {
        // Small delay so page renders first without CLS
        const timer = setTimeout(() => setVisible(true), 900);
        return () => clearTimeout(timer);
      }
    } catch {
      // Storage unavailable
    }
  }, []);

  const handleAccept = () => {
    try {
      localStorage.setItem(COOKIE_STORAGE_KEY, 'true');
    } catch {}
    setVisible(false);
  };

  if (!visible) return null;

  const messages: Record<string, { text: string; accept: string; link: string }> = {
    ru: {
      text: 'Мы используем файлы cookie для корректной работы сайта, сохранения корзины и оформления заказов.',
      accept: 'Понятно',
      link: 'Политика конфиденциальности',
    },
    kz: {
      text: 'Біз сайттың дұрыс жұмыс істеуі, себетті сақтау және тапсырыстарды рәсімдеу үшін cookie файлдарын қолданамыз.',
      accept: 'Түсінікті',
      link: 'Құпиялылық саясаты',
    },
    en: {
      text: 'We use cookies to ensure proper website functionality, shopping cart persistence, and order processing.',
      accept: 'Accept',
      link: 'Privacy Policy',
    },
    tr: {
      text: 'Web sitesinin düzgün çalışması, sepetin kaydedilmesi ve siparişlerin işlenmesi için çerezler (cookies) kullanıyoruz.',
      accept: 'Anladım',
      link: 'Gizlilik Politikası',
    },
  };

  const currentMsg = messages[language] || messages.ru;

  return (
    <aside
      aria-label="Уведомление об использовании файлов cookie"
      className="fixed bottom-20 lg:bottom-6 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-md z-[65] animate-in fade-in slide-in-from-bottom-4 duration-300 pointer-events-auto"
    >
      <div className="rounded-2xl bg-slate-900/95 backdrop-blur-md border border-slate-700/80 p-4 sm:p-5 shadow-2xl text-slate-200 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/20 text-brand-400 shrink-0 mt-0.5">
            <Cookie className="h-4 w-4" />
          </div>
          <div className="text-xs sm:text-sm text-slate-300 leading-relaxed pr-2">
            <span>{currentMsg.text} </span>
            <button
              type="button"
              onClick={() => onNavigate('privacy')}
              className="text-amber-400 hover:text-amber-300 underline font-medium cursor-pointer transition-colors"
            >
              {currentMsg.link}
            </button>
          </div>
          <button
            type="button"
            onClick={handleAccept}
            className="text-slate-400 hover:text-white transition-colors p-1 shrink-0 cursor-pointer"
            aria-label="Закрыть уведомление о cookie"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/80">
          <button
            type="button"
            onClick={handleAccept}
            className="rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-4 py-2 transition-all cursor-pointer shadow-sm hover:shadow"
          >
            {currentMsg.accept}
          </button>
        </div>
      </div>
    </aside>
  );
}
