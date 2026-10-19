import React, { useState, useEffect } from 'react';
import { Phone, Building, Clock, RotateCcw, Save } from 'lucide-react';
import { useSiteContent } from '@/lib/siteContentStore';
import { useToast } from '@/contexts/ToastContext';

export function ContactsAndLegalSubTab() {
  const { content, saveSiteContent, resetSiteContentSection } = useSiteContent();
  const toast = useToast();

  const [form, setForm] = useState(content.contacts);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(content.contacts);
  }, [content.contacts]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveSiteContent({ contacts: form });
      toast.success('Контакты, номер WhatsApp и реквизиты компании обновлены на всём сайте!');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    await resetSiteContentSection('contacts');
    toast.success('Контактные данные возвращены к исходным значениям');
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="card p-5 space-y-5 border border-slate-200/90">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <Phone className="h-5 w-5 text-brand-700" />
            <div>
              <h4 className="text-base font-bold text-slate-900">
                Единые контакты отдела продаж и плавающий виджет WhatsApp
              </h4>
              <p className="text-xs text-slate-500">
                Изменения автоматически применяются в подвале сайта (Footer), на странице «Контакты» и в кнопке WhatsApp.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Сбросить контакты
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Телефон (отображаемый на сайте)
            </label>
            <input
              type="text"
              required
              value={form.phoneDisplay}
              onChange={e => setForm(p => ({ ...p, phoneDisplay: e.target.value }))}
              placeholder="+7 (778) 580-68-66"
              className="input-field text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Телефон для звонка (ссылка tel:)
            </label>
            <input
              type="text"
              required
              value={form.phoneRaw}
              onChange={e => setForm(p => ({ ...p, phoneRaw: e.target.value }))}
              placeholder="+77785806866"
              className="input-field text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Номер WhatsApp (международный без +)
            </label>
            <input
              type="text"
              required
              value={form.whatsappIntl}
              onChange={e => setForm(p => ({ ...p, whatsappIntl: e.target.value.replace(/\D/g, '') }))}
              placeholder="77785806866"
              className="input-field text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Официальный Email
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="synergiya.group@gmail.com"
              className="input-field text-xs"
            />
          </div>
        </div>
      </div>

      {/* Склад и график работы */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5 space-y-4 border border-slate-200/90">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <Clock className="h-4 w-4 text-brand-700" />
            <h4 className="text-sm font-bold text-slate-900">Центральный склад и режим работы</h4>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Адрес Центрального склада (Астана)</label>
            <input
              type="text"
              required
              value={form.warehouseAddress}
              onChange={e => setForm(p => ({ ...p, warehouseAddress: e.target.value }))}
              className="input-field text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Часы работы (Пн — Пт)</label>
              <input
                type="text"
                value={form.weekdaysHours}
                onChange={e => setForm(p => ({ ...p, weekdaysHours: e.target.value }))}
                placeholder="09:00 — 17:00"
                className="input-field text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Суббота и Воскресенье</label>
              <input
                type="text"
                value={form.weekendHours}
                onChange={e => setForm(p => ({ ...p, weekendHours: e.target.value }))}
                placeholder="Выходной"
                className="input-field text-xs"
              />
            </div>
          </div>
        </div>

        {/* Юридические реквизиты */}
        <div className="card p-5 space-y-4 border border-slate-200/90">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <Building className="h-4 w-4 text-brand-700" />
            <h4 className="text-sm font-bold text-slate-900">Юридические реквизиты компании</h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Наименование юр. лица</label>
              <input
                type="text"
                required
                value={form.companyLegalName}
                onChange={e => setForm(p => ({ ...p, companyLegalName: e.target.value }))}
                className="input-field text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">БИН</label>
              <input
                type="text"
                required
                value={form.bin}
                onChange={e => setForm(p => ({ ...p, bin: e.target.value }))}
                className="input-field text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Юридический адрес</label>
            <input
              type="text"
              required
              value={form.legalAddress}
              onChange={e => setForm(p => ({ ...p, legalAddress: e.target.value }))}
              className="input-field text-xs"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold cursor-pointer"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? 'Сохранение...' : 'Сохранить контакты и реквизиты'}</span>
        </button>
      </div>
    </form>
  );
}
