import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { authenticateClientViaErp } from '@/lib/erpApi';

export type UserRole = 'admin' | 'manager_rm' | 'manager_lm' | 'supplier' | 'client';

export interface Profile {
  id: string;
  role: UserRole;
  partner_id: string | null;
  full_name: string;
  company_name: string;
  phone: string;
  manager_id: string | null;
  price_type: string;
  impersonation_enabled?: boolean;
  is_active?: boolean;
  status?: string;
  debt_usd?: number;
  balance_usd?: number;
  credit_limit_usd?: number;
  payment_delay_days?: number;
  showroom_warehouse_id?: number | null;
  showroom_warehouse_name?: string | null;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signInWithPortal: (login: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string, meta: { full_name: string; company_name: string }) => Promise<string | null>;
  signInAsDemo: (role?: UserRole) => void;
  signInAsClient: (client: { id: number | string; name: string; phone?: string; price_type?: string; showroom_warehouse_id?: number | null; showroom_warehouse_name?: string | null }) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  deactivationNotice: string | null;
  clearDeactivationNotice: () => void;
  isAdmin: boolean;
  realIsAdmin: boolean;
  isManager: boolean;
  isSupplier: boolean;
  isClient: boolean;
  isImpersonating: boolean;
  impersonatedProfile: Profile | null;
  realProfile: Profile | null;
  impersonateUser: (target: Profile) => void;
  stopImpersonation: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, partner_id, full_name, company_name, phone, manager_id, price_type, impersonation_enabled')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) {
      setProfile(data as Profile);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedDemo = sessionStorage.getItem('synergy:demo_auth');
      if (storedDemo) {
        try {
          const { user: du, profile: dp } = JSON.parse(storedDemo);
          setUser(du);
          setProfile(dp);
          setLoading(false);
          return;
        } catch {
          sessionStorage.removeItem('synergy:demo_auth');
        }
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
    const demoProfile: Profile = {
      id: 'demo-' + demoRole,
      role: demoRole,
      partner_id: 'PRT-DEMO-001',
      full_name: demoRole === 'admin' ? 'Администратор (Демо)' : 'Клиент (Демо)',
      company_name: 'ТОО «Kilem Khan Demo»',
      phone: '+7 (777) 123-45-67',
      manager_id: '1',
      price_type: 'Оптовая',
      impersonation_enabled: true,
    };
    const mockUser: unknown = {
      id: demoProfile.id,
      email: `${demoRole}@kilem-khan.kz`,
      app_metadata: {},
      user_metadata: { full_name: demoProfile.full_name },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    setUser(mockUser as User);
    setProfile(demoProfile);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('synergy:demo_auth', JSON.stringify({ user: mockUser, profile: demoProfile }));
    }
  }, []);

  const signInAsClient = useCallback((client: { id: number | string; name: string; phone?: string; price_type?: string; showroom_warehouse_id?: number | null; showroom_warehouse_name?: string | null }) => {
    const clientProfile: Profile = {
      id: `erp-client-${client.id}`,
      role: 'client',
      partner_id: String(client.id),
      full_name: client.name,
      company_name: client.name,
      phone: client.phone || '',
      manager_id: '1',
      price_type: client.price_type || 'wholesale',
      impersonation_enabled: true,
      showroom_warehouse_id: client.showroom_warehouse_id ?? null,
      showroom_warehouse_name: client.showroom_warehouse_name ?? null,
    };
    const mockUser: unknown = {
      id: clientProfile.id,
      email: `client-${client.id}@kilem-khan.kz`,
      app_metadata: {},
      user_metadata: { full_name: clientProfile.full_name },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    };
    setUser(mockUser as User);
    setProfile(clientProfile);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('synergy:demo_auth', JSON.stringify({ user: mockUser, profile: clientProfile }));
    }
  }, []);

  const [deactivationNotice, setDeactivationNotice] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('synergy:deactivation_notice');
    }
    return null;
  });

  const clearDeactivationNotice = useCallback(() => {
    setDeactivationNotice(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('synergy:deactivation_notice');
    }
  }, []);

  const [impersonatedProfile, setImpersonatedProfile] = useState<Profile | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('synergy:impersonated_profile');
      if (stored) {
        try { return JSON.parse(stored); } catch { return null; }
      }
    }
    return null;
  });

  const impersonateUser = useCallback((target: Profile) => {
    setImpersonatedProfile(target);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('synergy:impersonated_profile', JSON.stringify(target));
    }
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedProfile(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('synergy:impersonated_profile');
    }
  }, []);

  const signOutFn = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore network errors on signout
    }
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('synergy:demo_auth');
      sessionStorage.removeItem('synergy:impersonated_profile');
    }
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
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('synergy:deactivation_notice', msg);
          sessionStorage.removeItem('synergy:demo_auth');
          sessionStorage.removeItem('synergy:impersonated_profile');
        }
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
  const signInWithPortal = useCallback(async (login: string, password: string): Promise<{ success: boolean; error?: string }> => {
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

      setUser(mockUser as User);
      setProfile(clientProfile);
      setDeactivationNotice(null);

      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('synergy:deactivation_notice');
        sessionStorage.setItem('synergy:demo_auth', JSON.stringify({ user: mockUser, profile: clientProfile }));
      }

      setLoading(false);
      return { success: true };
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
        signOut: signOutFn,
        refreshProfile,
        deactivationNotice,
        clearDeactivationNotice,
        isAdmin: realRole === 'admin',
        realIsAdmin: realRole === 'admin',
        isManager: role === 'manager_rm' || role === 'manager_lm',
        isSupplier: role === 'supplier',
        isClient: role === 'client' || !role,
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
