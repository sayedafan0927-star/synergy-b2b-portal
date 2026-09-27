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
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, meta: { full_name: string; company_name: string }) => Promise<string | null>;
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
      .select('id, role, partner_id, full_name, company_name, phone, manager_id, price_type')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) {
      setProfile(data as Profile);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchProfile(u.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login')) return 'Неверный email или пароль';
      return error.message;
    }
    return null;
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    meta: { full_name: string; company_name: string },
  ): Promise<string | null> => {
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
    await supabase.auth.signOut();
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
