import { useState } from 'react';
import { Phone, Mail, MapPin, Clock, Send, CheckCircle, Warehouse } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import type { PageId } from '@/types';

const WAREHOUSES = [
  {
    city: 'Астана',
    address: 'ул. Кабанбай Батыра 62, склад 4',
    phone: '+7 (700) 123-45-67',
    hours: 'Пн-Пт 09:00-18:00, Сб 10:00-15:00',
  },
  {
    city: 'Алматы',
    address: 'ул. Жандосова 98, склад 2',
    phone: '+7 (700) 234-56-78',
    hours: 'Пн-Пт 09:00-18:00, Сб 10:00-15:00',
  },
  {
    city: 'Шымкент',
    address: 'ул. Тауке хана 45, склад 1',
    phone: '+7 (700) 345-67-89',
    hours: 'Пн-Пт 09:00-18:00',
  },
];

export default function ContactsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [formSent, setFormSent] = useState(false);
  const [formData, setFormData] = useState({ name: '', company: '', phone: '', email: '', message: '' });
  const r1 = useReveal();
  const r2 = useReveal();
  const r3 = useReveal();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormSent(true);
    setFormData({ name: '', company: '', phone: '', email: '', message: '' });
  };

  return (
    <div className="min-h-screen pt-20 pb-24 lg:pb-8">
      <div className="container-w py-8 lg:py-12">
        {/* Header */}
        <div className="mb-12 max-w-2xl">
          <h1 className="section-heading">Контакты</h1>
          <p className="section-subheading">
            Свяжитесь с нами для оптового заказа или посетите один из наших складов
          </p>
        </div>

        {/* Warehouses */}
        <div
          ref={r1.ref}
          className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-12 transition-all duration-700 ${
            r1.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          {WAREHOUSES.map((wh) => (
            <div key={wh.city} className="card p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50">
                  <Warehouse className="h-5 w-5 text-brand-700" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">{wh.city}</h3>
              </div>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-2.5 text-sm text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" />
                  {wh.address}
                </li>
                <li className="flex items-start gap-2.5 text-sm text-slate-600">
                  <Phone className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" />
                  <a href={`tel:${wh.phone.replace(/\D/g, '')}`} className="hover:text-brand-700 transition-colors">
                    {wh.phone}
                  </a>
                </li>
                <li className="flex items-start gap-2.5 text-sm text-slate-600">
                  <Clock className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" />
                  {wh.hours}
                </li>
              </ul>
            </div>
          ))}
        </div>

        {/* Contact info + form */}
        <div
          ref={r2.ref}
          className={`grid gap-8 lg:grid-cols-2 transition-all duration-700 delay-100 ${
            r2.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          {/* Info */}
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-4">Общие контакты</h2>
            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <Mail className="h-5 w-5 text-brand-700" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Email</p>
                  <a href="mailto:info@synergy-group.kz" className="text-sm font-medium text-slate-900 hover:text-brand-700 transition-colors">
                    info@synergy-group.kz
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <Phone className="h-5 w-5 text-brand-700" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Телефон</p>
                  <a href="tel:+77001234567" className="text-sm font-medium text-slate-900 hover:text-brand-700 transition-colors">
                    +7 (700) 123-45-67
                  </a>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-6">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Для оптовых клиентов</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Мы предлагаем индивидуальные условия для оптовых партнёров: специальные цены, 
                отсрочку платежа, бесплатную доставку от определённого объёма. Заполните форму 
                обратной связи или позвоните нам для обсуждения условий сотрудничества.
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="card p-6 lg:p-8">
            {formSent ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                  <CheckCircle className="h-7 w-7 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Заявка отправлена</h3>
                <p className="mt-2 text-sm text-slate-500">Мы свяжемся с вами в ближайшее время</p>
                <button onClick={() => setFormSent(false)} className="btn-secondary mt-6">
                  Отправить ещё
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-900 mb-6">Обратная связь</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Имя *</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData(d => ({ ...d, name: e.target.value }))}
                        placeholder="Ваше имя"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Компания</label>
                      <input
                        type="text"
                        value={formData.company}
                        onChange={(e) => setFormData(d => ({ ...d, company: e.target.value }))}
                        placeholder="Название компании"
                        className="input-field"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Телефон *</label>
                      <input
                        type="tel"
                        required
                        value={formData.phone}
                        onChange={(e) => setFormData(d => ({ ...d, phone: e.target.value }))}
                        placeholder="+7 (___) ___-__-__"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData(d => ({ ...d, email: e.target.value }))}
                        placeholder="email@example.com"
                        className="input-field"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Сообщение</label>
                    <textarea
                      rows={4}
                      value={formData.message}
                      onChange={(e) => setFormData(d => ({ ...d, message: e.target.value }))}
                      placeholder="Опишите ваш запрос..."
                      className="input-field resize-none"
                    />
                  </div>
                  <button type="submit" className="btn-primary w-full">
                    <Send className="h-4 w-4" />
                    Отправить заявку
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
