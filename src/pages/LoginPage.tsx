import { useState } from 'react';
import { LogIn, Eye, EyeOff, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import type { PageId } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { signIn, signInWithPortal, signUp, signInAsDemo, signInAsClient, signInAsEmployee, deactivationNotice, clearDeactivationNotice } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [quickAccessTab, setQuickAccessTab] = useState<'employees' | 'clients'>('employees');
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
      const isLikelyPhoneOrLogin = !form.email.includes('@') || /^\+?[\d\s\-()]+$/.test(form.email.trim());
      if (isLikelyPhoneOrLogin) {
        const portalRes = await signInWithPortal(form.email, form.password);
        if (portalRes.success) {
          setBusy(false);
          onNavigate('catalog');
          return;
        }
        err = portalRes.error || 'Ошибка входа';
      } else {
        err = await signIn(form.email, form.password);
        if (err && (err.includes('Supabase') || err.includes('Неверный') || err.includes('fetch'))) {
          // Fallback: пробуем как логин в ERP
          const portalRes = await signInWithPortal(form.email, form.password);
          if (portalRes.success) {
            setBusy(false);
            onNavigate('catalog');
            return;
          }
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
                {isLogin ? 'Номер телефона или Email' : 'Email'}
              </label>
              <input
                type={isLogin ? 'text' : 'email'}
                required
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder={isLogin ? '+7 (701) 123-45-67 или email' : 'email@company.kz'}
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

          {/* Быстрый доступ для сотрудников и клиентов ERP */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex items-center justify-center gap-1.5 p-1 bg-slate-100/80 rounded-lg mb-3">
              <button
                type="button"
                onClick={() => setQuickAccessTab('employees')}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-md transition-all ${
                  quickAccessTab === 'employees'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                👔 Сотрудники ERP
              </button>
              <button
                type="button"
                onClick={() => setQuickAccessTab('clients')}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-md transition-all ${
                  quickAccessTab === 'clients'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                🏢 Клиенты ERP
              </button>
            </div>

            {quickAccessTab === 'employees' ? (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    signInAsEmployee?.({ id: 9, name: 'Нурбол Торебеков', role: 'manager_rm', phone: '87768818101' });
                    onNavigate('profile');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">👔</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Нурбол Торебеков</p>
                      <p className="text-[10px] text-slate-500">Региональный менеджер (РМ) • 87768818101</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded">Войти →</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    signInAsEmployee?.({ id: 12, name: 'Ришат Худайберды', role: 'manager_rm', phone: '87714691133' });
                    onNavigate('profile');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">👔</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Ришат Худайберды</p>
                      <p className="text-[10px] text-slate-500">Региональный менеджер (РМ) • 87714691133</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded">Войти →</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    signInAsEmployee?.({ id: 15, name: 'Суженова Ботагоз', role: 'manager_lm', phone: '87785806866' });
                    onNavigate('profile');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🚚</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Суженова Ботагоз</p>
                      <p className="text-[10px] text-slate-500">Логист склада Астана (ЛМ) • 87785806866</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded">Войти →</span>
                </button>

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      signInAsEmployee?.({ id: 2, name: 'afan', role: 'admin', phone: '87086984543' });
                      onNavigate('profile');
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50/70 p-2 text-xs font-semibold text-brand-800 hover:bg-brand-100 transition-colors cursor-pointer"
                  >
                    <span>👑 afan (Админ)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      signInAsEmployee?.({ id: 1, name: 'admin1', role: 'admin', phone: '87082449730' });
                      onNavigate('profile');
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50/70 p-2 text-xs font-semibold text-brand-800 hover:bg-brand-100 transition-colors cursor-pointer"
                  >
                    <span>👑 admin1 (Админ)</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    signInAsClient({ id: 16, name: 'BIG CARPET ТОО (Сакен)', phone: '87028582444', price_type: 'wholesale' });
                    onNavigate('catalog');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏢</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">BIG CARPET ТОО (Сакен)</p>
                      <p className="text-[10px] text-slate-500">ID: 16 • РМ: Ришат Худайберды</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">В каталог →</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    signInAsClient({ id: 2933, name: 'Erkebulan kilem', phone: '77021856786', price_type: 'wholesale' });
                    onNavigate('catalog');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏢</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Erkebulan kilem</p>
                      <p className="text-[10px] text-slate-500">ID: 2933 • РМ: Нурбол Торебеков</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">В каталог →</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    signInAsClient({ id: 13, name: 'INTERIA LLP ТОО', phone: '87774114271', price_type: 'wholesale' });
                    onNavigate('catalog');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏢</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">INTERIA LLP ТОО</p>
                      <p className="text-[10px] text-slate-500">ID: 13 • РМ: Ришат Худайберды</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">В каталог →</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    signInAsClient({ id: 2976, name: 'Leila carpets', phone: '87010125577', price_type: 'wholesale' });
                    onNavigate('catalog');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏢</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Leila carpets</p>
                      <p className="text-[10px] text-slate-500">ID: 2976 • РМ: Ришат Худайберды</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">В каталог →</span>
                </button>
              </div>
            )}

            <p className="text-[11px] text-slate-400 mt-3 text-center leading-relaxed">
              💡 Также сотрудники (по номеру телефона) и клиенты могут входить напрямую через форму ввода выше.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
