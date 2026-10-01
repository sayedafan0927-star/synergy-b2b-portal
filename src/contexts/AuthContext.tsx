import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { authenticateClientViaErp } from '@/lib/erpApi';
import type { UserRole, B2BSubRole, Profile, AuthContextValue, ClientSignInInput, EmployeeSignInInput } from './auth/types';
import {
  getDeterministicEmployeeUuid,
  createDemoUserAndProfile,
  createClientUserAndProfile,
  createEmployeeUserAndProfile,
  provisionSessionToken,
  requestSignedClientToken,
  getStoredAuthSession,
  saveAuthSession,
  clearAuthSession,
  renewSessionIfActive,
} from './auth/sessionStore';
import {
  getStoredImpersonation,
  saveStoredImpersonation,
  getStoredDeactivationNotice,
  saveStoredDeactivationNotice,
} from './auth/impersonationStore';

export type { UserRole, B2BSubRole, Profile };
export { getDeterministicEmployeeUuid };

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, b2b_role, partner_id, full_name, company_name, phone, manager_id, price_type, impersonation_enabled')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) {
      setProfile(data as Profile);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 1. Проверяем наличие SSO-токена из ERP в адресной строке
      const urlParams = new URLSearchParams(window.location.search);
      const ssoParam = urlParams.get('sso_session');
      if (ssoParam) {
        urlParams.delete('sso_session');
        const newSearch = urlParams.toString();
        const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
        window.history.replaceState({ page: 'profile' }, document.title, cleanUrl);

        try {
          const p = JSON.parse(atob(ssoParam.replace(/-/g, '+').replace(/_/g, '/')));
          if (p?.data?.user && p?.data?.profile) {
            setUser(p.data.user);
            setProfile(p.data.profile);
            saveAuthSession(p.data.user, p.data.profile, ssoParam);
          }
        } catch {}

        fetch('/api/auth/verify-sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ssoParam }),
        })
          .then(res => res.json())
          .then(data => {
            if (data?.success && data.user && data.profile) {
              const sessionToken = data.token || data.portal_session_token || ssoParam;
              setUser(data.user);
              setProfile(data.profile);
              saveAuthSession(data.user, data.profile, sessionToken);
            } else {
              console.warn('[AuthContext] SSO verification rejected:', data?.error);
            }
          })
          .catch(err => {
            console.warn('[AuthContext] Failed to verify SSO token via server:', err);
          })
          .finally(() => {
            setLoading(false);
          });
        return;
      }

      // 2. Проверяем сохраненную сессию
      const parsed = getStoredAuthSession();
      if (parsed) {
        const su = parsed.user;
        const sp = parsed.profile;
        setUser(su);
        setProfile(sp);
        setLoading(false);

        if (!parsed.token && (su || sp)) {
          const effectiveRole = sp?.role || (su as any)?.role || 'client';
          const isPrivileged = ['admin', 'manager_rm', 'manager_lm', 'supplier'].includes(effectiveRole);
          if (!isPrivileged) {
            fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: effectiveRole, user: su, profile: sp }),
            })
              .then(r => r.json())
              .then(resData => {
                if (resData?.token) saveAuthSession(su, sp, resData.token);
              })
              .catch(() => {});
          }
        }
        return;
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchProfile(u.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }).catch((err) => {
      console.warn('Supabase getSession failed:', err);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        (async () => { await fetchProfile(u.id); })();
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Тихое продление сессии при активной работе дилера (Sliding Session Renewal)
  useEffect(() => {
    if (!user || !profile || typeof window === 'undefined') return;

    let lastRenew = Date.now();
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastRenew > 15 * 60 * 1000) {
        lastRenew = now;
        renewSessionIfActive(user, profile);
      }
    };

    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, [user, profile]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login')) return 'Неверный email или пароль';
        return error.message;
      }
      return null;
    } catch (err: unknown) {
      console.warn('Supabase signIn network error:', err);
      const msg = (err as Error)?.message || '';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch')) {
        return 'База данных Supabase на паузе (paused) или недоступна. Восстановите проект на supabase.com или используйте Демо-вход ниже.';
      }
      return msg || 'Ошибка подключения к серверу авторизации';
    }
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    meta: { full_name: string; company_name: string },
  ): Promise<string | null> => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: meta },
      });
      if (error) {
        if (error.message.includes('already registered')) return 'Этот email уже зарегистрирован';
        return error.message;
      }
      return null;
    } catch (err: unknown) {
      console.warn('Supabase signUp network error:', err);
      return 'База данных Supabase на паузе (paused). Восстановите проект на supabase.com или используйте Демо-вход ниже.';
    }
  }, []);

  const signInAsDemo = useCallback((demoRole: UserRole = 'admin') => {
    const { profile: demoProfile, user: mockUser } = createDemoUserAndProfile(demoRole);
    setUser(mockUser);
    setProfile(demoProfile);
    saveAuthSession(mockUser, demoProfile);
    provisionSessionToken(mockUser, demoProfile, demoRole);
  }, []);

  const signInAsClient = useCallback((client: ClientSignInInput) => {
    const { profile: clientProfile, user: mockUser } = createClientUserAndProfile(client);
    setUser(mockUser);
    setProfile(clientProfile);
    saveAuthSession(mockUser, clientProfile);
    provisionSessionToken(mockUser, clientProfile, 'client');
  }, []);

  const signInAsEmployee = useCallback((employee: EmployeeSignInInput) => {
    const { profile: employeeProfile, user: mockUser } = createEmployeeUserAndProfile(employee);
    setUser(mockUser);
    setProfile(employeeProfile);
    saveAuthSession(mockUser, employeeProfile);
    provisionSessionToken(mockUser, employeeProfile, employee.role);
  }, []);

  const [deactivationNotice, setDeactivationNotice] = useState<string | null>(() => getStoredDeactivationNotice());

  const clearDeactivationNotice = useCallback(() => {
    setDeactivationNotice(null);
    saveStoredDeactivationNotice(null);
  }, []);

  const [impersonatedProfile, setImpersonatedProfile] = useState<Profile | null>(() => getStoredImpersonation());

  const impersonateUser = useCallback((target: Profile) => {
    setImpersonatedProfile(target);
    saveStoredImpersonation(target);
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedProfile(null);
    saveStoredImpersonation(null);
  }, []);

  const signOutFn = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore network errors on signout
    }
    clearAuthSession();
    saveStoredImpersonation(null);
    setUser(null);
    setProfile(null);
    stopImpersonation();
  }, [stopImpersonation]);

  // Мгновенная деактивация: слушатель события client_deactivated от ERP
  useEffect(() => {
    const handleDeactivation = (targetId: number | string) => {
      const activePartnerId = profile?.partner_id;
      const activeUserId = user?.id;

      if (
        (activePartnerId && String(activePartnerId) === String(targetId)) ||
        (activeUserId && activeUserId.includes(String(targetId)))
      ) {
        console.warn(`[AuthContext] Instant deactivation event received for counterparty_id=${targetId}. Revoking all sessions.`);
        const msg = 'Доступ к сайту заблокирован: учетная запись клиента деактивирована в ERP.';
        setDeactivationNotice(msg);
        saveStoredDeactivationNotice(msg);
        clearAuthSession();
        saveStoredImpersonation(null);
        setUser(null);
        setProfile(null);
        stopImpersonation();
      }
    };

    const domHandler = (e: CustomEvent<{ counterparty_id?: number | string }>) => {
      if (e.detail?.counterparty_id) {
        handleDeactivation(e.detail.counterparty_id);
      }
    };

    window.addEventListener('synergy:client-deactivated', domHandler as EventListener);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('synergy_client_channel');
      bc.onmessage = (event) => {
        if (event.data?.event === 'client_deactivated' && event.data?.counterparty_id) {
          handleDeactivation(event.data.counterparty_id);
        }
      };
    } catch {
      // fallback
    }

    return () => {
      window.removeEventListener('synergy:client-deactivated', domHandler as EventListener);
      if (bc) bc.close();
    };
  }, [profile, user, stopImpersonation]);

  /**
   * Прямая авторизация клиента через ERP (проверка логина, пароля и статуса is_active).
   */
  const signInWithPortal = useCallback(async (login: string, password: string): Promise<{ success: boolean; role?: UserRole; error?: string }> => {
    setLoading(true);
    try {
      const res = await authenticateClientViaErp(login, password);

      if (!res.success) {
        setLoading(false);
        return {
          success: false,
          error: res.error || 'Ошибка входа',
        };
      }

      if (res.user_type === 'employee' && res.employee) {
        const { profile: employeeProfile, user: mockUser } = createEmployeeUserAndProfile({
          id: res.employee.id,
          name: res.employee.name,
          role: res.employee.role as UserRole,
          phone: res.employee.phone,
        });

        setUser(mockUser);
        setProfile(employeeProfile);
        setDeactivationNotice(null);
        saveStoredDeactivationNotice(null);
        saveAuthSession(mockUser, employeeProfile, res.token);

        setLoading(false);
        return { success: true, role: employeeProfile.role };
      }

      const client = res.client!;
      const clientProfile: Profile = {
        id: `erp-client-${client.id}`,
        role: 'client',
        partner_id: String(client.id),
        full_name: client.name,
        company_name: client.name,
        phone: client.phone || '',
        manager_id: client.regional_manager?.id ? String(client.regional_manager.id) : '1',
        price_type: client.contracts?.[0]?.price_type || 'wholesale',
        is_active: true,
        status: 'active',
        debt_usd: client.financials?.debt_usd ?? client.debt_usd,
        balance_usd: client.financials?.balance_usd ?? client.balance_usd,
        credit_limit_usd: client.financials?.credit_limit_usd,
        payment_delay_days: client.financials?.payment_delay_days,
        showroom_warehouse_id: client.showroom_warehouse_id ?? null,
        showroom_warehouse_name: client.showroom_warehouse_name ?? null,
        impersonation_enabled: true,
      };

      const mockUser: unknown = {
        id: clientProfile.id,
        email: `${client.phone || client.id}@kilem-khan.kz`,
        app_metadata: {},
        user_metadata: { full_name: clientProfile.full_name },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      };

      const sessionToken = res.token || (await requestSignedClientToken(clientProfile, mockUser));

      setUser(mockUser as User);
      setProfile(clientProfile);
      setDeactivationNotice(null);
      saveStoredDeactivationNotice(null);
      saveAuthSession(mockUser, clientProfile, sessionToken);

      setLoading(false);
      return { success: true, role: 'client' };
    } catch (err: any) {
      setLoading(false);
      return {
        success: false,
        error: err?.message || 'Не удалось выполнить вход в систему',
      };
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const effectiveProfile = impersonatedProfile ?? profile;
  const role = effectiveProfile?.role;
  const realRole = profile?.role;
  const b2bRole: B2BSubRole = effectiveProfile?.b2b_role || 'director';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: effectiveProfile,
        loading,
        signIn,
        signInWithPortal,
        signUp,
        signInAsDemo,
        signInAsClient,
        signInAsEmployee,
        signOut: signOutFn,
        refreshProfile,
        deactivationNotice,
        clearDeactivationNotice,
        isAdmin: realRole === 'admin',
        realIsAdmin: realRole === 'admin',
        isManager: role === 'manager_rm' || role === 'manager_lm',
        isSupplier: role === 'supplier',
        isClient: role === 'client' || !role,
        b2bRole,
        isAccountant: b2bRole === 'accountant',
        isBuyer: b2bRole === 'buyer',
        isDirector: b2bRole === 'director',
        isImpersonating: impersonatedProfile !== null,
        impersonatedProfile,
        realProfile: profile,
        impersonateUser,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
