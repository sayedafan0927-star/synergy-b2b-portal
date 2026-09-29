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
  is_active?: boolean;
  status?: string;
  debt_usd?: number;
  balance_usd?: number;
  credit_limit_usd?: number;
  payment_delay_days?: number;
  showroom_warehouse_id?: number | null;
  showroom_warehouse_name?: string | null;
}

export interface ClientSignInInput {
  id: number | string;
  name: string;
  phone?: string;
  price_type?: string;
  showroom_warehouse_id?: number | null;
  showroom_warehouse_name?: string | null;
}

export interface EmployeeSignInInput {
  id: number | string;
  name: string;
  role: UserRole;
  phone?: string;
}

export interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signInWithPortal: (login: string, password: string) => Promise<{ success: boolean; role?: UserRole; error?: string }>;
  signUp: (email: string, password: string, meta: { full_name: string; company_name: string }) => Promise<string | null>;
  signInAsDemo: (role?: UserRole) => void;
  signInAsClient: (client: ClientSignInInput) => void;
  signInAsEmployee: (employee: EmployeeSignInInput) => void;
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
