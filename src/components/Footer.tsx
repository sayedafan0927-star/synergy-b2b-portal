import { Phone, Mail, MapPin, MessageCircle, Globe } from 'lucide-react';
import { useLanguage, SUPPORTED_LANGUAGES } from '@/contexts/LanguageContext';
import { useSiteContent } from '@/lib/siteContentStore';
import type { PageId } from '@/types';

interface FooterProps {
  onNavigate: (page: PageId) => void;
}

export default function Footer({ onNavigate }: FooterProps) {
  const { t, language, setLanguage } = useLanguage();
  const { content } = useSiteContent();
  const c = content.contacts;

  const defaultWaMsg = t('whatsapp.default_msg');

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
            <div className="mt-4 flex items-center gap-3">
              <a
                href={`https://wa.me/${c.whatsappIntl}?text=${encodeURIComponent(defaultWaMsg)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#128C4A] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0f7a40] transition-all"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp</span>
              </a>
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">{t('footer.nav_title')}</h3>
            <ul className="space-y-2.5">
              {[
                { label: t('nav.catalog'), page: 'catalog' as PageId },
                { label: t('nav.contacts'), page: 'contacts' as PageId },
                { label: t('nav.profile'), page: 'profile' as PageId },
              ].map(({ label, page }) => (
                <li key={label}>
                  <button
                    onClick={() => onNavigate(page)}
                    className="text-sm text-slate-400 transition-colors hover:text-white cursor-pointer"
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contacts */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">{t('footer.contacts_title')}</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <div className="text-sm">
                  <a href={`tel:${c.phoneRaw}`} className="hover:text-white transition-colors">
                    {c.phoneDisplay}
                  </a>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <a href={`mailto:${c.email}`} className="text-sm hover:text-white transition-colors">
                  {c.email}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <span className="text-sm">{c.warehouseAddress || t('contacts.address')}</span>
              </li>
            </ul>
          </div>

          {/* Working hours & Languages */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">{t('footer.hours_title')}</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-400">{t('footer.weekdays')}</span>
                <span className="text-white">{c.weekdaysHours || '09:00 — 17:00'}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">Сб, Вс</span>
                <span className="text-slate-400">{c.weekendHours || t('footer.sunday')}</span>
              </li>
            </ul>

            {/* Language Selector in Footer */}
            <div className="mt-6 pt-4 border-t border-slate-800">
              <div className="flex items-center gap-2 mb-2 text-xs text-slate-400">
                <Globe className="h-3.5 w-3.5" />
                <span>Язык / Тіл / Language / Dil:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SUPPORTED_LANGUAGES.map((opt) => (
                  <button
                    key={opt.code}
                    onClick={() => setLanguage(opt.code)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      language === opt.code
                        ? 'bg-brand-600 text-white font-bold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    <span>{opt.flag}</span>
                    <span>{opt.shortLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* B2B Legal Non-Offer Disclaimer for Republic of Kazakhstan */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 text-[11px] text-slate-400/90 leading-relaxed text-center sm:text-left">
          <p>
            Все представленные на сайте сведения о ценах, характеристиках и наличии товаров носят информационный характер и <strong className="text-amber-400/90">не являются публичной офертой</strong> (ст. 395 ГК РК). Все цены указаны в у.е. (условных единицах). Портал предназначен для субъектов предпринимательской деятельности (ТОО, ИП).
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-slate-800/60 pt-6 lg:flex-row">
          <p className="text-xs text-slate-400 text-center lg:text-left">
            &copy; 2025 {c.companyLegalName} (БИН {c.bin}). {t('footer.rights')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <button
              onClick={() => onNavigate('delivery')}
              className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              {t('footer.delivery_payment')}
            </button>
            <button
              onClick={() => onNavigate('returns')}
              className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer font-medium text-amber-400/90 hover:text-amber-300"
            >
              {t('footer.returns_refunds')}
            </button>
            <button
              onClick={() => onNavigate('privacy')}
              className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              {t('footer.privacy_policy')}
            </button>
            <button
              onClick={() => onNavigate('terms')}
              className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              {t('footer.public_offer')}
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
