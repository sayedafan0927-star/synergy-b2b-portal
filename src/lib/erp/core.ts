import type { PingResult } from './types';

export const ERP_PROXY_URL = '/api/erp';
export const ERP_DIRECT_URL = ERP_PROXY_URL;
export const ERP_API_URL = ERP_PROXY_URL; // alias for backwards compatibility

// ─── 1. In-Flight Request Deduplication Pool ───
const inFlightRequests = new Map<string, Promise<any>>();

export function deduplicateRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing;
  }
  const promise = fn().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  return promise;
}

export function isTokenValid(token: string): boolean {
  if (!token) return false;
  try {
    // 1. Проверка HMAC токена портала (base64url JSON)
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const parsed = JSON.parse(raw);
    if (parsed?.data?.timestamp) {
      // Действителен в течение 24 часов (с запасом 15 минут до истечения)
      return Date.now() - Number(parsed.data.timestamp) < (24 * 3600 - 900) * 1000;
    }
  } catch {}
  try {
    // 2. Проверка стандартного JWT токена Supabase
    const parts = token.split('.');
    if (parts.length === 3) {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64));
      if (payload.exp) {
        return payload.exp * 1000 > Date.now() + 60000; // не менее 1 минуты до истечения
      }
    }
  } catch {}
  return true;
}

export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const requestHeaders: Record<string, string> = {};
  if (typeof window === 'undefined') {
    return requestHeaders;
  }

  try {
    // 1. Приоритет: активная сессия портала (synergy:auth_session или synergy:demo_auth)
    const sessionStr = sessionStorage.getItem('synergy:auth_session') || sessionStorage.getItem('synergy:demo_auth');
    if (sessionStr) {
      const parsedSession = JSON.parse(sessionStr);
      let token = parsedSession?.token;

      const role = parsedSession.profile?.role || parsedSession.user?.role || 'client';
      const isPrivileged = ['admin', 'manager_rm', 'manager_lm', 'supplier'].includes(role);

      // Запрашиваем токен сессии только для клиентских сессий, так как для административных ролей
      // анонимный запрос без существующей авторизации блокируется серверным Anti-Bypass P0 (403 Forbidden)
      if ((!token || forceRefresh || !isTokenValid(token)) && !isPrivileged) {
        if (parsedSession?.user || parsedSession?.profile) {
          try {
            const res = await fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role,
                user: parsedSession.user,
                profile: parsedSession.profile,
              }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data?.token) {
                token = data.token;
                parsedSession.token = token;
                sessionStorage.setItem('synergy:auth_session', JSON.stringify(parsedSession));
                sessionStorage.setItem('synergy:demo_auth', JSON.stringify(parsedSession));
              }
            }
          } catch (tokErr) {
            console.warn('[erpFetch] Session refresh notice:', tokErr);
          }
        }
      }

      if (token && isTokenValid(token)) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
        return requestHeaders;
      }
    }

    // 2. Вторичный источник: сессия Supabase Auth из localStorage (только если токен не истек)
    const sbKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (sbKey) {
      const item = localStorage.getItem(sbKey);
      if (item) {
        const parsed = JSON.parse(item);
        const accessToken = parsed?.access_token || parsed?.currentSession?.access_token;
        if (accessToken && isTokenValid(accessToken)) {
          requestHeaders['Authorization'] = `Bearer ${accessToken}`;
          return requestHeaders;
        }
      }
    }
  } catch (err) {
    console.warn('[erpFetch] getAuthHeaders error:', err);
  }

  return requestHeaders;
}

// ─── 2. Unified Transport (Strictly via Server-Side Proxy /api/erp) ───
export async function erpFetch(
  action: string,
  options: {
    method?: 'GET' | 'POST';
    params?: Record<string, string | number | undefined | null>;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> {
  const method = options.method || 'GET';
  const q = new URLSearchParams();
  q.set('action', action);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null) {
        q.set(k, String(v));
      }
    }
  }

  const proxyEndpoint = `${ERP_PROXY_URL}?${q.toString()}`;

  // Генерация сквозного Correlation-ID для трассировки транзакции
  const correlationId = `trc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  const authHeaders = await getAuthHeaders();

  const requestHeaders: Record<string, string> = {
    'Accept': 'application/json',
    'X-Correlation-ID': correlationId,
    ...authHeaders,
    ...(options.headers || {}),
  };

  if (options.body && method === 'POST') {
    requestHeaders['Content-Type'] = 'application/json';
  }

  // Все обращения осуществляются строго через защищенный серверный шлюз
  let response = await fetch(proxyEndpoint, {
    method,
    headers: requestHeaders,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Self-Healing Session: при 401 прозрачно обновляем токен и повторяем запрос 1 раз
  if (response.status === 401 && typeof window !== 'undefined') {
    try {
      const refreshedHeaders = await getAuthHeaders(true);
      if (refreshedHeaders['Authorization'] && refreshedHeaders['Authorization'] !== requestHeaders['Authorization']) {
        const retryHeaders = {
          ...requestHeaders,
          ...refreshedHeaders,
        };
        response = await fetch(proxyEndpoint, {
          method,
          headers: retryHeaders,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
      }
    } catch (retryErr) {
      console.warn('[erpFetch] 401 self-healing retry notice:', retryErr);
    }
  }

  return response;
}

/**
 * Проверка здоровья контуров интеграции (PostgreSQL, 1C:ERP)
 */
export async function checkSystemHealth(): Promise<{
  status: 'ok' | 'degraded' | 'down';
  timestamp?: string;
  totalLatencyMs?: number;
  checks?: {
    database: { status: string; latencyMs?: number; error?: string };
    erp_gateway: { status: string; latencyMs?: number; error?: string };
  };
}> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) {
      return { status: 'degraded' };
    }
    return await res.json();
  } catch (err: any) {
    return { status: 'down' };
  }
}

/**
 * Проверка соединения с ERP (health check) и измерение задержки.
 */
export async function pingErp(): Promise<PingResult> {
  const start = performance.now();
  const response = await erpFetch('ping', { method: 'GET' });
  const latencyMs = Math.round(performance.now() - start);

  if (!response.ok) {
    throw new Error(`Ошибка пинга ERP (${response.status})`);
  }

  const data = await response.json();
  return {
    success: !!data.success,
    message: data.message || '',
    server_time: data.server_time || '',
    version: data.version || '1.0.0',
    latencyMs,
  };
}
