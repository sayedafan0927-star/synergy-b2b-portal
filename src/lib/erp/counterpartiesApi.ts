import { erpFetch, deduplicateRequest } from './core';
import type { ErpClientAuthResult, ClientDebtReport } from './types';

const CP_CACHE_TTL_MS = 15 * 1000;
const cpMemoryCache = new Map<string, { timestamp: number; data: any }>();

/**
 * Получение списка активных региональных менеджеров (РМ) и логистов (ЛМ).
 * При ошибке SQL (500 SQLSTATE[42P10]) на стороне api_portal.php автоматически
 * восстанавливает список менеджеров из рабочего эндпоинта action=sync_bundle.
 */
export async function fetchRegionalManagersFromErp() {
  try {
    const response = await erpFetch('regional_managers', { method: 'GET' });
    if (response.ok) {
      const data = await response.json();
      if (data && data.success && Array.isArray(data.managers)) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[fetchRegionalManagersFromErp] Primary endpoint failed, falling back to sync_bundle:', err);
  }

  // Self-Healing Fallback: получаем менеджеров из живого пакета синхронизации ERP (action=sync_bundle)
  const bundleResp = await erpFetch('sync_bundle', { method: 'GET' });
  if (!bundleResp.ok) {
    throw new Error(`Ошибка загрузки регионалов (${bundleResp.status})`);
  }

  const bundle = await bundleResp.json();
  const rawManagers: any[] = Array.isArray(bundle?.managers) ? bundle.managers : [];
  const rawCounterparties: any[] = Array.isArray(bundle?.counterparties) ? bundle.counterparties : [];

  // Обогащаем менеджеров городами и количеством закрепленных дилеров из справочника контрагентов
  const managers = rawManagers.map((m: any) => {
    const mId = Number(m.id);
    const assignedClients = rawCounterparties.filter((c: any) => {
      const rmId = Number(c.regional_manager?.id ?? c.manager_id ?? -1);
      return (mId > 0 && rmId === mId) || (c.regional_manager?.name && c.regional_manager.name === m.name);
    });
    const cities = Array.from(
      new Set(assignedClients.map((c: any) => c.city).filter((city: any) => city && !String(city).toLowerCase().includes('заполним')))
    );

    return {
      id: m.id,
      name: m.name || m.username || 'Менеджер ERP',
      username: m.username || m.name,
      phone: m.phone || '',
      role: m.role || 'manager_rm',
      city: m.city || (cities.length > 0 ? cities.slice(0, 3).join(', ') : 'Астана / РК'),
      clients_count: assignedClients.length,
    };
  });

  return {
    success: true,
    count: managers.length,
    managers,
  };
}

/**
 * Проверка, является ли контрагент архивным, рассылочным (dummy) или деактивированным.
 */
export function isCounterpartyArchivedOrMailing(c: any): boolean {
  if (!c) return true;
  const name = String(c.name || '').toLowerCase().trim();
  const city = String(c.city || '').toLowerCase().trim();
  const status = String(c.status || '').toLowerCase().trim();
  const access = String(c.access || '').toLowerCase().trim();

  if (
    ['inactive', 'archived', 'archive', 'disabled', 'deleted'].includes(status) ||
    access === 'disabled' ||
    c.is_active === 0 || c.is_active === false || c.is_active === '0' ||
    c.portal_access_enabled === 0 || c.portal_access_enabled === false || c.portal_access_enabled === '0' ||
    c.is_archived === true || c.is_archived === 1 || c.archived === true || c.archived === 1
  ) {
    return true;
  }

  return (
    name.includes('рассылк') ||
    city.includes('заполним позже') ||
    name.includes('архив') ||
    name.includes('[архив]') ||
    name.includes('(архив)') ||
    name.startsWith('для рассылки')
  );
}

export function isCounterpartyActive(c: any): boolean {
  return !isCounterpartyArchivedOrMailing(c);
}

/**
 * Получение списка контрагентов и их договоров (с возможностью поиска по телефону/названию).
 * По умолчанию возвращает СТРОГО действующих активных клиентов (без архива и рассылок).
 */
export async function fetchCounterpartiesFromErp(params: {
  search?: string;
  phone?: string;
  managerId?: number;
  limit?: number;
  includeArchived?: boolean;
} = {}) {
  const cleanPhone = params.phone ? params.phone.replace(/[^\d+]/g, '') : undefined;
  const cacheKey = `cp_${params.search || ''}_${cleanPhone || ''}_${params.managerId || ''}_${params.limit || ''}_${params.includeArchived ? '1' : '0'}`;
  const cached = cpMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CP_CACHE_TTL_MS) {
    return cached.data;
  }

  return deduplicateRequest(cacheKey, async () => {
    const response = await erpFetch('counterparties', {
      method: 'GET',
      params: {
        search: params.search,
        phone: cleanPhone || undefined,
        manager_id: params.managerId,
        limit: params.limit,
      },
    });

    if (!response.ok) {
      throw new Error(`Ошибка загрузки контрагентов (${response.status})`);
    }

    const data = await response.json();
    if (data && Array.isArray(data.counterparties)) {
      const tagged = data.counterparties.map((c: any) => {
        const isArchived = isCounterpartyArchivedOrMailing(c);
        return {
          ...c,
          is_archived_or_mailing: isArchived,
          is_acting_client: !isArchived,
        };
      });

      data.counterparties = params.includeArchived ? tagged : tagged.filter((c: any) => c.is_acting_client);
      data.count = data.counterparties.length;
      data.total_raw_count = tagged.length;
      data.active_count = tagged.filter((c: any) => c.is_acting_client).length;
      data.archived_count = tagged.filter((c: any) => c.is_archived_or_mailing).length;
    }
    cpMemoryCache.set(cacheKey, { timestamp: Date.now(), data });
    return data;
  });
}

/**
 * Прямая аутентификация клиента в Synergy ERP.
 * Вызывает production-эндпоинт action=login с проверкой активности и возвратом showroom_warehouse_id.
 */
export async function authenticateClientViaErp(login: string, password: string): Promise<ErpClientAuthResult> {
  const cleanPhone = login.replace(/[^\d+]/g, '').trim();
  const cleanLogin = cleanPhone || login.trim();

  // 1. Попытка авторизации через action=login в Synergy ERP
  try {
    let response = await erpFetch('login', {
      method: 'POST',
      body: { phone: cleanPhone || login.trim(), login: login.trim(), password: password.trim() },
    });
    let data = await response.json().catch(() => null);

    // Если введён номер телефона, который одновременно привязан к клиенту в 1С и к сотруднику ERP (например, 87086984543 -> afan),
    // шлюз ERP проверяет пароль клиента первым. Проверяем справочник сотрудников по телефону и повторяем вход по логину сотрудника.
    const inputDigits = cleanPhone.replace(/\D+/g, '');
    if ((!response.ok || !data?.success) && inputDigits.length >= 10) {
      try {
        const rmRes = await erpFetch('regional_managers', { method: 'GET' });
        if (rmRes.ok) {
          const rmData = await rmRes.json().catch(() => null);
          const managers: any[] = Array.isArray(rmData?.managers) ? rmData.managers : [];
          const last10 = inputDigits.slice(-10);
          const matchedEmp = managers.find((m: any) => {
            const mDigits = String(m.phone || '').replace(/\D+/g, '');
            return mDigits.length >= 10 && mDigits.slice(-10) === last10;
          });
          const empUsername = String(matchedEmp?.username || matchedEmp?.name || '').trim();
          if (empUsername && empUsername.toLowerCase() !== login.trim().toLowerCase()) {
            const empRetryRes = await erpFetch('login', {
              method: 'POST',
              body: { login: empUsername, password: password.trim() },
            });
            const empRetryData = await empRetryRes.json().catch(() => null);
            if (empRetryRes.ok && empRetryData?.success) {
              response = empRetryRes;
              data = empRetryData;
            }
          }
        }
      } catch (empFallbackErr) {
        console.warn('[authenticateClientViaErp] Employee phone-to-username resolution notice:', empFallbackErr);
      }
    }

    if (response.status === 403 || data?.code === 'CLIENT_DEACTIVATED') {
      return {
        success: false,
        code: 'CLIENT_DEACTIVATED',
        error: data?.error || 'Доступ к сайту заблокирован: учетная запись клиента деактивирована в ERP.',
      };
    }

    if (response.ok && data?.success) {
      if (data.user_type === 'employee' || data.employee) {
        const emp = data.employee || data;
        const rawEmpRole = String(emp.role || 'manager_rm').toLowerCase().trim();
        const normalizedEmpRole = rawEmpRole === 'lm' ? 'manager_lm' : (rawEmpRole === 'admin' ? 'admin' : 'manager_rm');
        return {
          success: true,
          token: data.token || data.portal_session_token,
          user_type: 'employee',
          employee: {
            id: Number(emp.id || emp.manager_id),
            name: emp.name || emp.username || 'Сотрудник ERP',
            role: normalizedEmpRole,
            phone: emp.phone || login,
          },
        };
      }

      const clientId = Number(data.client_id || data.client?.id);
      const clientName = data.name || data.client?.name || 'Клиент ERP';
      const clientPhone = data.phone || data.client?.phone || login;
      const priceType = data.client?.price_type || data.client?.contracts?.[0]?.price_type || 'wholesale';
      const debtUsd = typeof data.debt_usd === 'number' ? data.debt_usd : (data.financials?.debt_usd || 0);
      const balanceUsd = typeof data.balance_usd === 'number' ? data.balance_usd : (data.financials?.balance_usd || 0);
      const showroomId = data.showroom_warehouse_id ?? data.client?.showroom_warehouse_id ?? null;
      const showroomName = data.showroom_warehouse_name ?? data.client?.showroom_warehouse_name ?? null;

      return {
        success: true,
        token: data.token,
        client: {
          id: clientId,
          name: clientName,
          phone: clientPhone,
          price_type: priceType,
          debt_usd: debtUsd,
          balance_usd: balanceUsd,
          showroom_warehouse_id: showroomId,
          showroom_warehouse_name: showroomName,
          regional_manager: data.regional_manager || data.client?.regional_manager,
          contracts: data.client?.contracts || [],
          financials: { debt_usd: debtUsd, balance_usd: balanceUsd },
        },
      };
    }

    if (data && data.error && !data.error.includes('Неизвестное действие')) {
      return { success: false, code: data.code || 'AUTH_FAILED', error: data.error };
    }
  } catch (err: any) {
    console.warn('[authenticateClientViaErp] Network error calling login:', err);
  }

  // 2. Fallback: поиск клиента среди выгруженных активных контрагентов (только при наличии серверного SSO-токена)
  try {
    const cpData = await fetchCounterpartiesFromErp({ phone: cleanLogin, limit: 10 });
    const list = cpData?.counterparties || [];
    const matched = list.find((c: any) => {
      const cPhone = (c.phone || '').replace(/[^\d+]/g, '');
      const cLogin = (c.portal_login || '').replace(/[^\d+]/g, '');
      return (cPhone && cPhone.includes(cleanLogin)) || (cLogin && cLogin.includes(cleanLogin)) || String(c.id) === cleanLogin;
    });

    if (matched) {
      if (matched.is_active === 0 || matched.portal_access_enabled === 0 || matched.status === 'inactive' || matched.access === 'disabled') {
        return {
          success: false,
          code: 'CLIENT_DEACTIVATED',
          error: 'Доступ к сайту заблокирован: учетная запись клиента деактивирована в ERP.',
        };
      }

      let ssoToken: string | undefined;
      try {
        const ssoRes = await erpFetch('sso_link', {
          params: { manager_id: matched.id, role: 'client', phone: cleanPhone || matched.phone },
        });
        if (ssoRes.ok) {
          const ssoData = await ssoRes.json();
          if (ssoData?.token) ssoToken = ssoData.token;
        }
      } catch (ssoErr) {
        console.warn('[authenticateClientViaErp] Error obtaining SSO link token:', ssoErr);
      }

      if (!ssoToken) {
        return {
          success: false,
          code: 'AUTH_FAILED',
          error: 'Не удалось подтвердить учетные данные в ERP. Проверьте телефон и пароль.',
        };
      }

      return {
        success: true,
        token: ssoToken,
        client: {
          id: matched.id,
          name: matched.name,
          phone: matched.phone,
          city: matched.city,
          address: matched.address,
          bin: matched.bin,
          is_active: matched.is_active ?? 1,
          portal_access_enabled: matched.portal_access_enabled ?? 1,
          status: 'active',
          price_type: matched.price_type || matched.contracts?.[0]?.price_type || 'price_deferred',
          debt_usd: typeof matched.debt_usd === 'number' ? matched.debt_usd : (matched.financials?.debt_usd || 0),
          balance_usd: typeof matched.balance_usd === 'number' ? matched.balance_usd : (matched.financials?.balance_usd || 0),
          showroom_warehouse_id: matched.showroom_warehouse_id ?? null,
          showroom_warehouse_name: matched.showroom_warehouse_name ?? null,
          financials: matched.financials,
          regional_manager: matched.regional_manager,
          contracts: matched.contracts || [],
        },
      };
    }
  } catch (cpErr) {
    console.warn('[authenticateClientViaErp] Counterparties fallback error:', cpErr);
  }

  return {
    success: false,
    code: 'AUTH_FAILED',
    error: 'Пользователь с таким логином не найден среди активных клиентов ERP',
  };
}

/**
 * Оповещение всех вкладок браузера о деактивации клиента в ERP.
 */
export function broadcastClientDeactivated(counterpartyId: number | string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('synergy:client-deactivated', { detail: { counterparty_id: counterpartyId } }));
    try {
      const bc = new BroadcastChannel('synergy_client_channel');
      bc.postMessage({ event: 'client_deactivated', counterparty_id: counterpartyId });
      bc.close();
    } catch {}
  }
}

export async function fetchClientDebtFromErp(params: {
  phone?: string;
  counterpartyId?: number;
  search?: string;
  refresh?: boolean;
  includeInvoices?: boolean;
}): Promise<ClientDebtReport> {
  const cleanPhone = params.phone ? params.phone.replace(/[^\d+]/g, '') : undefined;
  const cacheKey = `debt_${params.counterpartyId || ''}_${cleanPhone || ''}_${params.search || ''}_${params.includeInvoices !== false ? '1' : '0'}`;
  if (!params.refresh) {
    const cached = cpMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CP_CACHE_TTL_MS) return cached.data;
  } else {
    cpMemoryCache.delete(cacheKey);
  }

  return deduplicateRequest(params.refresh ? `${cacheKey}_refresh` : cacheKey, async () => {
    const response = await erpFetch('client_debt', {
      method: 'GET',
      params: {
        phone: cleanPhone || undefined,
        counterparty_id: params.counterpartyId,
        partner_id: params.counterpartyId,
        search: params.search,
        refresh: params.refresh ? '1' : undefined,
        include_invoices: params.includeInvoices !== false ? '1' : undefined,
      },
    });
    if (!response.ok) throw new Error(`Ошибка загрузки задолженности (${response.status})`);
    const data = await response.json();
    if (data && data.success) cpMemoryCache.set(cacheKey, { timestamp: Date.now(), data });
    return data;
  });
}

export async function updateClientAccessInErp(clientId: number | string, accessEnabled: boolean | number): Promise<{ success: boolean }> {
  const numClientId = Number(String(clientId).replace(/\D+/g, '')) || clientId;
  const isEnabled = typeof accessEnabled === 'boolean' ? (accessEnabled ? 1 : 0) : accessEnabled;
  const response = await erpFetch('update_client_access', {
    method: 'POST',
    body: { client_id: numClientId, access_enabled: isEnabled },
  });
  if (!response.ok) throw new Error(`Ошибка изменения доступа клиента в ERP (${response.status})`);
  return { success: true };
}

export async function refreshLiveClientBalance(partnerId: string | number): Promise<any> {
  try {
    const response = await erpFetch('refresh_balance', {
      method: 'POST',
      body: { partner_id: String(partnerId) },
    });
    if (response.ok && (response.headers.get('content-type') || '').includes('application/json')) {
      const data = await response.json();
      if (data && data.success !== false) return data;
    }
  } catch {}

  const cleanNumericId = Number(String(partnerId).replace(/\D+/g, '')) || undefined;
  const debtData: any = await fetchClientDebtFromErp({ counterpartyId: cleanNumericId, refresh: true, includeInvoices: true });
  const canonicalDebt = Number(debtData?.total_debt_usd ?? debtData?.financials?.debt_usd ?? debtData?.client?.debt_usd ?? 0);
  const rawBal = Number(debtData?.financials?.balance_usd ?? debtData?.client?.balance_usd ?? 0);

  return {
    success: true,
    source: 'erp_client_debt_live',
    partner_id: String(partnerId),
    financials: debtData?.financials || {
      debt_usd: canonicalDebt,
      balance_usd: rawBal !== 0 ? rawBal : -canonicalDebt,
      overdue_usd: Number(debtData?.overdue_debt_usd ?? 0),
      overdue_days: Number(debtData?.max_overdue_days ?? 0),
      credit_limit_usd: Number(debtData?.client?.credit_limit_usd ?? 50000),
    },
  };
}

