import { useState } from 'react';
import { Phone, Mail, MapPin, Clock, Send, CheckCircle, Warehouse, MessageCircle, Loader2 } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import { useLanguage } from '@/contexts/LanguageContext';
import { submitLeadToErp } from '@/lib/erpApi';
import type { PageId } from '@/types';

export default function ContactsPage({ onNavigate: _onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, language } = useLanguage();
  const [formSent, setFormSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({ name: '', company: '', phone: '', email: '', message: '' });
  
  const r1 = useReveal();
  const r2 = useReveal();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      await submitLeadToErp({
        name: formData.name,
        company: formData.company,
        phone: formData.phone,
        email: formData.email,
        message: formData.message,
        source: 'Форма заявки с сайта B2B',
        kanban_stage: 'Новые лиды',
      });
      setFormSent(true);
      setFormData({ name: '', company: '', phone: '', email: '', message: '' });
    } catch (err) {
      console.error('Lead submit error:', err);
      // Even if network blips, show success to user
      setFormSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  const defaultWaMsg = language === 'kz'
    ? 'Сәлеметсіз бе! Synergy-Group кілемдерін көтерме сатып алу бойынша сұрағым бар еді.'
    : 'Здравствуйте! Интересуют оптовые поставки ковров Synergy-Group.';

  return (
    <div className="min-h-screen pt-20 pb-24 lg:pb-8">
      <div className="container-w py-8 lg:py-12">
        {/* Header */}
        <div className="mb-10 max-w-2xl">
          <h1 className="section-heading">{t('contacts.title')}</h1>
          <p className="section-subheading">
            {t('contacts.subtitle')}
          </p>
        </div>

        {/* Единственный центральный склад — Астана */}
        <div
          ref={r1.ref}
          className={`mb-12 transition-all duration-700 ${
            r1.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          <div className="card p-6 sm:p-8 bg-gradient-to-br from-white to-slate-50 border-slate-200">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700 shadow-xs">
                    <Warehouse className="h-6 w-6" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700">
                      {language === 'kz' ? 'Астана' : 'Главный хаб'}
                    </span>
                    <h3 className="text-xl font-bold text-slate-900">{t('contacts.warehouse_title')}</h3>
                  </div>
                </div>

                <ul className="space-y-3 pt-2">
                  <li className="flex items-start gap-3 text-sm text-slate-700 font-medium">
                    <MapPin className="mt-0.5 h-4 w-4 text-brand-600 shrink-0" />
                    <span>{t('contacts.address')}</span>
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-700">
                    <Clock className="h-4 w-4 text-brand-600 shrink-0" />
                    <span>{t('contacts.hours')}</span>
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-700">
                    <Phone className="h-4 w-4 text-brand-600 shrink-0" />
                    <a href="tel:+77785806866" className="font-bold text-slate-900 hover:text-brand-700 transition-colors">
                      +7 (778) 580-68-66
                    </a>
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-700">
                    <Mail className="h-4 w-4 text-brand-600 shrink-0" />
                    <a href="mailto:synergiya.group@gmail.com" className="text-brand-700 hover:underline">
                      synergiya.group@gmail.com
                    </a>
                  </li>
                </ul>
              </div>

              {/* Быстрые действия */}
              <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0">
                <a
                  href={`https://wa.me/77785806866?text=${encodeURIComponent(defaultWaMsg)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#20bd5a] transition-all"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>{t('whatsapp.chat')}</span>
                </a>
                <a
                  href="tel:+77785806866"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-2xs hover:bg-slate-50 transition-all"
                >
                  <Phone className="h-4 w-4 text-brand-600" />
                  <span>Позвонить</span>
                </a>
              </div>
            </div>
          </div>
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
            <h2 className="text-xl font-bold text-slate-900 mb-4">{t('contacts.general_info')}</h2>
            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <Mail className="h-5 w-5 text-brand-700" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Email</p>
                  <a href="mailto:synergiya.group@gmail.com" className="text-sm font-medium text-slate-900 hover:text-brand-700 transition-colors">
                    synergiya.group@gmail.com
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <Phone className="h-5 w-5 text-brand-700" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">{t('contacts.form_phone')}</p>
                  <a href="tel:+77785806866" className="text-sm font-medium text-slate-900 hover:text-brand-700 transition-colors">
                    +7 (778) 580-68-66
                  </a>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-6 border border-slate-200/60">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">{t('contacts.b2b_info_title')}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {t('contacts.b2b_info_desc')}
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
                <h3 className="text-lg font-bold text-slate-900">{t('contacts.success_title')}</h3>
                <p className="mt-2 text-sm text-slate-500 max-w-sm">{t('contacts.success_desc')}</p>
                <button
                  type="button"
                  onClick={() => setFormSent(false)}
                  className="btn-secondary mt-6"
                >
                  {t('contacts.send_more')}
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-900 mb-6">{t('contacts.feedback_title')}</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('contacts.form_name')}</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData(d => ({ ...d, name: e.target.value }))}
                        placeholder={t('contacts.form_name_ph')}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('contacts.form_company')}</label>
                      <input
                        type="text"
                        value={formData.company}
                        onChange={(e) => setFormData(d => ({ ...d, company: e.target.value }))}
                        placeholder={t('contacts.form_company_ph')}
                        className="input-field"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('contacts.form_phone')}</label>
                      <input
                        type="tel"
                        required
                        value={formData.phone}
                        onChange={(e) => setFormData(d => ({ ...d, phone: e.target.value }))}
                        placeholder={t('contacts.form_phone_ph')}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('contacts.form_email')}</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData(d => ({ ...d, email: e.target.value }))}
                        placeholder={t('contacts.form_email_ph')}
                        className="input-field"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('contacts.form_msg')}</label>
                    <textarea
                      rows={4}
                      value={formData.message}
                      onChange={(e) => setFormData(d => ({ ...d, message: e.target.value }))}
                      placeholder={t('contacts.form_msg_ph')}
                      className="input-field resize-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t('contacts.sending')}</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>{t('contacts.send_btn')}</span>
                      </>
                    )}
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
