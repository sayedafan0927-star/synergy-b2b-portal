import type { User } from '@supabase/supabase-js';
import type { Profile, UserRole, ClientSignInInput, EmployeeSignInInput } from './types';

const AUTH_SESSION_KEY = 'synergy:auth_session';
const DEMO_AUTH_KEY = 'synergy:demo_auth';

export function getDeterministicEmployeeUuid(empId: string | number): string {
  const cleanId = String(empId).replace(/\D+/g, '') || '1';
  return `00000000-0000-4000-8000-${cleanId.padStart(12, '0')}`;
}

export function createDemoUserAndProfile(demoRole: UserRole = 'admin'): { profile: Profile; user: User } {
  const demoProfile: Profile = {
    id: 'demo-' + demoRole,
    role: demoRole,
    partner_id: demoRole === 'client' ? 'PRT-DEMO-001' : (demoRole === 'supplier' ? '6' : null),
    full_name: demoRole === 'admin' ? 'Администратор портала' : demoRole === 'manager_rm' ? 'Региональный менеджер' : demoRole === 'supplier' ? 'Поставщик ISMEN' : 'Клиент (Демо)',
    company_name: demoRole === 'supplier' ? 'ISMEN (Турция)' : 'ТОО «Kilem Khan Synergy»',
    phone: '+7 (777) 123-45-67',
    manager_id: '1',
    price_type: 'wholesale',
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
  return { profile: demoProfile, user: mockUser as User };
}

export function createClientUserAndProfile(client: ClientSignInInput): { profile: Profile; user: User } {
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
  return { profile: clientProfile, user: mockUser as User };
}

export function createEmployeeUserAndProfile(employee: EmployeeSignInInput): { profile: Profile; user: User } {
  const employeeProfile: Profile = {
    id: getDeterministicEmployeeUuid(employee.id),
    role: employee.role,
    partner_id: null,
    full_name: employee.name,
    company_name: 'Synergy Group (ERP)',
    phone: employee.phone || '',
    manager_id: String(employee.id),
    price_type: 'wholesale',
    impersonation_enabled: true,
  };
  const mockUser: unknown = {
    id: employeeProfile.id,
    email: `${(employee.phone || '').replace(/\D+/g, '') || employee.id}@synergy-portal.kz`,
    app_metadata: {},
    user_metadata: { full_name: employeeProfile.full_name },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
  return { profile: employeeProfile, user: mockUser as User };
}

export async function provisionSessionToken(u: unknown, p: Profile, r?: UserRole): Promise<void> {
  const role = r || p.role;
  const isPrivileged = ['admin', 'manager_rm', 'manager_lm', 'supplier'].includes(role);
  if (isPrivileged) {
    const stored = typeof window !== 'undefined' ? sessionStorage.getItem(AUTH_SESSION_KEY) : null;
    let hasToken = false;
    if (stored) {
      try { hasToken = Boolean(JSON.parse(stored)?.token); } catch {}
    }
    if (!hasToken) return;
  }
  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, user: u, profile: p }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.token && typeof window !== 'undefined') {
        const sessionObj = { user: u, profile: p, token: data.token };
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionObj));
        sessionStorage.setItem(DEMO_AUTH_KEY, JSON.stringify(sessionObj));
      }
    }
  } catch (e) {
    console.warn('[AuthContext] Session token provision notice:', e);
  }
}

export async function requestSignedClientToken(clientProfile: Profile, mockUser: unknown): Promise<string | undefined> {
  try {
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    const storedSession = typeof window !== 'undefined' ? sessionStorage.getItem(AUTH_SESSION_KEY) : null;
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        if (parsed?.token) authHeaders['Authorization'] = `Bearer ${parsed.token}`;
      } catch {}
    }
    const tokenRes = await fetch('/api/auth/client-token', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ client: clientProfile, user: mockUser }),
    });
    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();
      return tokenData?.token;
    }
  } catch (tokenErr) {
    console.warn('[AuthContext] Notice obtaining signed client token:', tokenErr);
  }
  return undefined;
}

export function getStoredAuthSession(): { user: User; profile: Profile; token?: string } | null {
  if (typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem(AUTH_SESSION_KEY) || sessionStorage.getItem(DEMO_AUTH_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    sessionStorage.removeItem(DEMO_AUTH_KEY);
    return null;
  }
}

export function saveAuthSession(user: unknown, profile: Profile, token?: string): void {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({ user, profile, token });
  sessionStorage.setItem(AUTH_SESSION_KEY, payload);
  sessionStorage.setItem(DEMO_AUTH_KEY, payload);
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(DEMO_AUTH_KEY);
}
