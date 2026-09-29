import { useState } from 'react';
import { LogIn, Eye, EyeOff, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import type { PageId } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { signIn, signInWithPortal, signUp, deactivationNotice, clearDeactivationNotice } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', company: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    clearDeactivationNotice();
    setBusy(true);

    let err: string | null = null;
    if (isLogin) {
      // 1. Приоритетная единая авторизация по номеру телефона / логину ERP
      const portalRes = await signInWithPortal(form.email, form.password);
      if (portalRes.success) {
        setBusy(false);
        // Сотрудников и админа направляем в панель управления, клиентов — в каталог
        if (portalRes.role === 'admin' || portalRes.role === 'manager_rm' || portalRes.role === 'manager_lm') {
          onNavigate('profile');
        } else {
          onNavigate('catalog');
        }
        return;
      }

      err = portalRes.error || 'Ошибка входа';

      // 2. Резервный fallback для внешних email-учеток
      if (form.email.includes('@') && !form.email.includes('synergy') && !form.email.includes('kilem-khan')) {
        const sbErr = await signIn(form.email, form.password);
        if (!sbErr) {
          setBusy(false);
          onNavigate('profile');
          return;
        }
      }
    } else {
      if (form.password.length < 6) {
        setError('Пароль должен быть не менее 6 символов');
        setBusy(false);
        return;
      }
      err = await signUp(form.email, form.password, {
        full_name: form.name,
        company_name: form.company,
      });
    }

    setBusy(false);
    if (err) {
      setError(err);
    } else {
      onNavigate('profile');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 pt-20 pb-24 lg:pb-8">
      <div className="w-full max-w-md">
        <button
          onClick={() => onNavigate('home')}
          className="mb-8 flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </button>

        <div className="card p-6 sm:p-8">
          <div className="mb-6">
            <img src="/Вектор_Синэнергия.png" alt="Synergiya Group" className="h-12 w-auto" />
          </div>

          <h1 className="text-xl font-bold text-slate-900 mb-1">
            {isLogin ? 'Вход в кабинет' : 'Регистрация'}
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            {isLogin ? 'Войдите для доступа к оптовым ценам и истории заказов' : 'Создайте аккаунт для доступа к оптовым условиям'}
          </p>

          {deactivationNotice && (
            <div className="mb-4 flex items-start justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-900 shadow-xs">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <span>{deactivationNotice}</span>
              </div>
              <button
                type="button"
                onClick={clearDeactivationNotice}
                className="text-amber-600 hover:text-amber-800 text-xs font-semibold px-1"
              >
                ✕
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Имя</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ваше имя"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Компания</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                    placeholder="ООО / ИП"
                    className="input-field"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {isLogin ? 'Номер телефона или логин' : 'Email'}
              </label>
              <input
                type={isLogin ? 'text' : 'email'}
                required
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder={isLogin ? '+7 (708) 698-45-43 или логин' : 'email@company.kz'}
                className="input-field"
                disabled={busy}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Пароль</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Введите пароль"
                  className="input-field pr-10"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {isLogin ? 'Войти' : 'Зарегистрироваться'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => { setIsLogin(!isLogin); setError(null); }}
              className="text-sm text-brand-700 hover:text-brand-800 transition-colors"
            >
              {isLogin ? 'Нет аккаунта? Зарегистрируйтесь' : 'Уже есть аккаунт? Войти'}
            </button>
          </div>

          {/* Единый защищенный вход ERP */}
          <div className="mt-8 pt-5 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400 leading-relaxed">
              🔒 Единый защищенный вход для сотрудников ERP и оптовых клиентов.<br />
              Используйте ваш номер телефона и пароль учетной записи.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
