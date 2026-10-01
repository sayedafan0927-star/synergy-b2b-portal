import { Phone, Mail, MapPin, MessageCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PageId } from '@/types';

interface FooterProps {
  onNavigate: (page: PageId) => void;
}

export default function Footer({ onNavigate }: FooterProps) {
  const { t, language } = useLanguage();

  const defaultWaMsg = language === 'kz'
    ? 'Сәлеметсіз бе! Synergy-Group кілемдерін көтерме сатып алу бойынша сұрағым бар еді.'
    : 'Здравствуйте! Интересуют оптовые поставки ковров Synergy-Group.';

  return (
    <footer className="border-t border-slate-100 bg-slate-900 text-slate-300">
      <div className="container-w py-12 lg:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="mb-4">
              <img src="/Вектор_Синэнергия.png" alt="Synergiya Group" className="h-10 w-auto brightness-0 invert" />
            </div>
            <p className="text-sm leading-relaxed text-slate-400">
              {t('footer.tagline')}
            </p>
            <div className="mt-4">
              <a
                href={`https://wa.me/77785806866?text=${encodeURIComponent(defaultWaMsg)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#20bd5a] transition-all"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp</span>
              </a>
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">{t('footer.nav_title')}</h4>
            <ul className="space-y-2.5">
              {[
                { label: t('nav.catalog'), page: 'catalog' as PageId },
                { label: t('nav.contacts'), page: 'contacts' as PageId },
                { label: t('nav.profile'), page: 'profile' as PageId },
              ].map(({ label, page }) => (
                <li key={label}>
                  <button
                    onClick={() => onNavigate(page)}
                    className="text-sm text-slate-400 transition-colors hover:text-white"
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contacts */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">{t('footer.contacts_title')}</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <div className="text-sm">
                  <a href="tel:+77785806866" className="hover:text-white transition-colors">
                    +7 (778) 580-68-66
                  </a>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <a href="mailto:synergiya.group@gmail.com" className="text-sm hover:text-white transition-colors">
                  synergiya.group@gmail.com
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <span className="text-sm">{t('contacts.address')}</span>
              </li>
            </ul>
          </div>

          {/* Working hours */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">{t('footer.hours_title')}</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-400">{t('footer.weekdays')}</span>
                <span className="text-white">09:00 — 17:00</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">Сб, Вс</span>
                <span className="text-slate-500">Выходной</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-800 pt-8 sm:flex-row">
          <p className="text-xs text-slate-500">&copy; 2025 Synergy-Group. {t('footer.rights')}</p>
          <div className="flex gap-6">
            <button onClick={() => onNavigate('contacts')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Политика конфиденциальности
            </button>
            <button onClick={() => onNavigate('contacts')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Публичная оферта
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
