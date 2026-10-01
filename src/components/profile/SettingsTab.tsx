import { useState } from 'react';
import { Settings, Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getAuthHeaders } from '@/lib/erpApi';

export function SettingsTab() {
  const { profile, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    full_name: profile?.full_name ?? '',
    company_name: profile?.company_name ?? '',
    phone: profile?.phone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passSaving, setPassSaving] = useState(false);
  const [passSaved, setPassSaved] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.id);
    if (isUuid) {
      const { error } = await supabase.from('profiles').update({
        full_name: form.full_name,
        company_name: form.company_name,
        phone: form.phone,
      }).eq('id', profile.id);
      if (!error) {
        setSaved(true);
        await refreshProfile();
        setTimeout(() => setSaved(false), 2000);
      }
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  const handleUpdatePassword = async () => {
    if (!profile) return;
    setPassError(null);
    if (newPassword.length < 6) {
      setPassError('Пароль должен содержать не менее 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassError('Пароли не совпадают');
      return;
    }
    setPassSaving(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ new_password: newPassword }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Ошибка смены пароля (${res.status})`);
      }

      setPassSaved(true);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPassSaved(false), 3000);
    } catch (e: any) {
      setPassError(e?.message || 'Ошибка обновления пароля');
    } finally {
      setPassSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-slate-500" />
        <div>
          <h2 className="text-lg font-bold text-slate-900">Настройки профиля</h2>
          <p className="text-sm text-slate-500">Обновите ваши контактные данные и пароль доступа</p>
        </div>
      </div>

      <div className="card p-6 max-w-lg space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Имя</label>
          <input type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Компания</label>
          <input type="text" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className="input-field" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Телефон</label>
          <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input-field" placeholder="+7 (___) ___-__-__" />
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary cursor-pointer">
          {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить контактные данные'}
        </button>
      </div>

      {/* Безопасность и пароль */}
      <div className="card p-6 max-w-lg space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Shield className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-bold text-slate-800">Безопасность и пароль для входа</h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Задайте ваш персональный секретный пароль. Он заменит стартовый пароль по умолчанию при последующих входах на B2B-портал.
        </p>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Новый пароль</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Минимум 6 символов"
            className="input-field"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Повторите новый пароль</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Повторите пароль"
            className="input-field"
          />
        </div>

        {passError && (
          <p className="text-xs text-red-600 font-medium">{passError}</p>
        )}
        {passSaved && (
          <p className="text-xs text-emerald-600 font-semibold">✓ Пароль успешно сохранен и активирован!</p>
        )}

        <button
          onClick={handleUpdatePassword}
          disabled={passSaving || !newPassword}
          className="btn-secondary text-xs cursor-pointer"
        >
          {passSaving ? 'Сохранение...' : 'Установить новый пароль'}
        </button>
      </div>
    </div>
  );
}

export default SettingsTab;
