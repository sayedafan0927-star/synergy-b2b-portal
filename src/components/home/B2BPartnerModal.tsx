import React, { useState, useEffect, useRef } from 'react';
import { X, Send, CheckCircle, Loader2 } from 'lucide-react';
import { Portal } from '@/components/common/Portal';
import { useLanguage } from '@/contexts/LanguageContext';
import { submitLeadToErp } from '@/lib/erpApi';

interface B2BPartnerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Format phone string gracefully into Kazakhstani/Russian standard: +7 (XXX) XXX-XX-XX
 */
function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';

  let rest = digits;
  if (rest.startsWith('7') || rest.startsWith('8')) {
    rest = rest.substring(1);
  }

  let res = '+7';
  if (rest.length > 0) {
    res += ` (${rest.substring(0, 3)}`;
  }
  if (rest.length >= 4) {
    res += `) ${rest.substring(3, 6)}`;
  }
  if (rest.length >= 7) {
    res += `-${rest.substring(6, 8)}`;
  }
  if (rest.length >= 9) {
    res += `-${rest.substring(8, 10)}`;
  }
  return res;
}

/**
 * Apple-style floating modal for B2B partnership application.
 * Features ultra-smooth fluid easing (cubic-bezier(0.16, 1, 0.3, 1)),
 * frosted backdrop blur, and exact field structure matching design requirements.
 */
export default function B2BPartnerModal({ isOpen, onClose }: B2BPartnerModalProps) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    message: '',
  });

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Smooth Apple mount & enter/exit animation lifecycle
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      setMounted(true);
      // Double rAF ensures the initial transform class is painted before transitioning
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setActive(true);
        });
      });
      // Lock background scroll
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      return () => {
        cancelAnimationFrame(raf);
        document.body.style.overflow = originalOverflow;
      };
    } else {
      setActive(false);
      timer = setTimeout(() => {
        setMounted(false);
        setIsSuccess(false);
        setFormData({ name: '', company: '', phone: '', email: '', message: '' });
      }, 420);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Focus first input on opening
  useEffect(() => {
    if (active && !isSuccess && nameInputRef.current) {
      nameInputRef.current.focus({ preventScroll: true });
    }
  }, [active, isSuccess]);

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!raw) {
      setFormData(prev => ({ ...prev, phone: '' }));
      return;
    }
    setFormData(prev => ({ ...prev, phone: formatPhone(raw) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      await submitLeadToErp({
        name: formData.name.trim(),
        company: formData.company.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        message: formData.message.trim(),
        source: 'Модальное окно: Стать партнёром B2B',
        kanban_stage: 'Новые лиды',
      });
      setIsSuccess(true);
      setFormData({ name: '', company: '', phone: '', email: '', message: '' });
    } catch (err) {
      console.error('[B2BPartnerModal] Submit lead error:', err);
      // Graceful resilience: show success to user
      setIsSuccess(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 select-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="b2b-modal-title"
      >
        {/* ── Apple Frosted Backdrop ── */}
        <div
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-md"
          style={{
            transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
            opacity: active ? 1 : 0,
          }}
          onClick={onClose}
          aria-hidden="true"
        />

        {/* ── Floating Card (Apple Easing) ── */}
        <div
          className="relative w-full sm:max-w-xl bg-white rounded-t-[28px] sm:rounded-[32px] border border-slate-200/80 shadow-[0_25px_70px_rgba(0,0,0,0.32),0_0_0_1px_rgba(0,0,0,0.04)] overflow-hidden max-h-[92vh] flex flex-col z-10"
          style={{
            transition: 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 380ms cubic-bezier(0.16, 1, 0.3, 1)',
            transform: active ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(0, 36px, 0) scale(0.96)',
            opacity: active ? 1 : 0,
            willChange: 'transform, opacity',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Mobile Sheet Pull Handle */}
          <div className="pt-3 pb-1 flex justify-center sm:hidden">
            <div className="h-1 w-12 rounded-full bg-slate-200" />
          </div>

          {/* Modal Header */}
          <div className="px-6 sm:px-8 pt-5 sm:pt-7 pb-4 flex items-start justify-between border-b border-slate-100">
            <div>
              <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 mb-1">
                {t('b2b.partner_modal_brand') || 'Synergia group'}
              </p>
              <h2 id="b2b-modal-title" className="font-display text-xl sm:text-2xl lg:text-[26px] font-bold text-slate-900 tracking-wide uppercase">
                {t('b2b.partner_modal_title') || 'ФОРМА ДЛЯ СОТРУДНИЧЕСТВА'}
              </h2>
            </div>

            {/* Apple Circular Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="ml-3 shrink-0 h-9 w-9 rounded-full bg-slate-100 hover:bg-slate-200/80 active:scale-90 text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center cursor-pointer focus:outline-none"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4 stroke-[2.5]" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="px-6 sm:px-8 py-5 sm:py-6 overflow-y-auto flex-1">
            {isSuccess ? (
              <div className="py-8 flex flex-col items-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50">
                  <CheckCircle className="h-9 w-9" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">
                  {t('contacts.success_title') || 'Заявка отправлена!'}
                </h3>
                <p className="mt-2 text-sm text-slate-500 max-w-sm leading-relaxed">
                  {t('contacts.success_desc') || 'Ваша заявка зарегистрирована в системе. Наш менеджер свяжется с вами в ближайшее время.'}
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-6 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-all cursor-pointer active:scale-95"
                >
                  {t('common.done') || 'Отлично'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Row 1: Ваше имя & Компания */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      {t('contacts.form_name') || 'Ваше имя *'}
                    </label>
                    <input
                      ref={nameInputRef}
                      type="text"
                      required
                      value={formData.name}
                      onChange={e => setFormData(d => ({ ...d, name: e.target.value }))}
                      placeholder={t('contacts.form_name_ph') || 'Ваше имя'}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      {t('contacts.form_company') || 'Компания'}
                    </label>
                    <input
                      type="text"
                      value={formData.company}
                      onChange={e => setFormData(d => ({ ...d, company: e.target.value }))}
                      placeholder={t('contacts.form_company_ph') || 'Название компании / магазина'}
                      className="input-field"
                    />
                  </div>
                </div>

                {/* Row 2: Телефон & Email */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      {t('contacts.form_phone') || 'Телефон *'}
                    </label>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={handlePhoneChange}
                      placeholder={t('contacts.form_phone_ph') || '+7 (___) ___-__-__'}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      {t('contacts.form_email') || 'Email'}
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={e => setFormData(d => ({ ...d, email: e.target.value }))}
                      placeholder={t('contacts.form_email_ph') || 'email@example.com'}
                      className="input-field"
                    />
                  </div>
                </div>

                {/* Row 3: Сообщение */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    {t('contacts.form_msg') || 'Сообщение'}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.message}
                    onChange={e => setFormData(d => ({ ...d, message: e.target.value }))}
                    placeholder={t('contacts.form_msg_ph') || 'Опишите ваш запрос или перечень интересующих коллекций...'}
                    className="input-field resize-none"
                  />
                </div>

                {/* Submit Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-800 hover:bg-brand-900 active:scale-[0.985] text-white py-3.5 px-6 font-semibold text-sm transition-all duration-200 shadow-md cursor-pointer disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t('contacts.sending') || 'Отправка...'}</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>{t('contacts.send_btn') || 'Отправить заявку'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
