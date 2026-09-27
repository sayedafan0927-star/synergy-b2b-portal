import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

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
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, meta: { full_name: string; company_name: string }) => Promise<string | null>;
  signInAsDemo: (role?: UserRole) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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

const AuthContext = createContext<AuthContextValue | null>(null);

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
        signUp,
        signInAsDemo,
        signOut: signOutFn,
        refreshProfile,
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
