import { Phone, Mail, MapPin, ArrowUpRight } from 'lucide-react';
import type { PageId } from '@/types';

interface FooterProps {
  onNavigate: (page: PageId) => void;
}

export default function Footer({ onNavigate }: FooterProps) {
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
              Оптовые поставки ковровых покрытий. Работаем с 2015 года. Склады в Астане, Алматы и Шымкенте.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Навигация</h4>
            <ul className="space-y-2.5">
              {[
                { label: 'Каталог', page: 'catalog' as PageId },
                { label: 'О компании', page: 'contacts' as PageId },
                { label: 'Контакты', page: 'contacts' as PageId },
                { label: 'Личный кабинет', page: 'profile' as PageId },
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
            <h4 className="text-sm font-semibold text-white mb-4">Контакты</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <div className="text-sm">
                  <a href="tel:+77001234567" className="hover:text-white transition-colors">
                    +7 (700) 123-45-67
                  </a>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <a href="mailto:info@synergy-group.kz" className="text-sm hover:text-white transition-colors">
                  info@synergy-group.kz
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 text-brand-500 shrink-0" />
                <span className="text-sm">г. Астана, ул. Кабанбай Батыра 62</span>
              </li>
            </ul>
          </div>

          {/* Working hours */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Режим работы</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-400">Пн — Пт</span>
                <span className="text-white">09:00 — 18:00</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">Сб</span>
                <span className="text-white">10:00 — 15:00</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">Вс</span>
                <span className="text-slate-500">Выходной</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-800 pt-8 sm:flex-row">
          <p className="text-xs text-slate-500">&copy; 2025 Synergy-Group. Все права защищены.</p>
          <div className="flex gap-6">
            <a href="#" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Политика конфиденциальности
            </a>
            <a href="#" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Публичная оферта
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
