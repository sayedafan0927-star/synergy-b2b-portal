import { erpFetch } from './core';
import type { ErpClientAuthResult, ClientDebtReport } from './types';

/**
 * Получение списка активных региональных менеджеров (РМ) и логистов (ЛМ).
 */
export async function fetchRegionalManagersFromErp() {
  const response = await erpFetch('regional_managers', { method: 'GET' });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки регионалов (${response.status})`);
  }

  return await response.json();
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

  // 1. Формальные флаги деактивации / архива
  if (
    status === 'inactive' ||
    status === 'archived' ||
    status === 'archive' ||
    status === 'disabled' ||
    status === 'deleted' ||
    access === 'disabled' ||
    c.is_active === 0 ||
    c.is_active === false ||
    c.is_active === '0' ||
    c.portal_access_enabled === 0 ||
    c.portal_access_enabled === false ||
    c.portal_access_enabled === '0' ||
    c.is_archived === true ||
    c.is_archived === 1 ||
    c.archived === true ||
    c.archived === 1
  ) {
    return true;
  }

  // 2. Семантическая фильтрация недействующих / рассылочных контактов
  if (
    name.includes('рассылк') ||
    city.includes('заполним позже') ||
    name.includes('архив') ||
    name.includes('[архив]') ||
    name.includes('(архив)') ||
    name.startsWith('для рассылки')
  ) {
    return true;
  }

  return false;
}

/**
 * Проверка, является ли контрагент реально действующим активным клиентом B2B.
 */
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
  const response = await erpFetch('counterparties', {
    method: 'GET',
    params: {
      search: params.search,
      phone: params.phone,
      manager_id: params.managerId,
      limit: params.limit,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки контрагентов (${response.status})`);
  }

  const data = await response.json();
  if (data && Array.isArray(data.counterparties)) {
    // Размечаем каждого контрагента метаданными активности
    const tagged = data.counterparties.map((c: any) => {
      const isArchived = isCounterpartyArchivedOrMailing(c);
      return {
        ...c,
        is_archived_or_mailing: isArchived,
        is_acting_client: !isArchived,
      };
    });

    if (params.includeArchived) {
      data.counterparties = tagged;
    } else {
      // По умолчанию фильтруем строго действующих клиентов
      data.counterparties = tagged.filter((c: any) => c.is_acting_client);
    }
    data.count = data.counterparties.length;
    data.total_raw_count = tagged.length;
    data.active_count = tagged.filter((c: any) => c.is_acting_client).length;
    data.archived_count = tagged.filter((c: any) => c.is_archived_or_mailing).length;
  }
  return data;
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
    const response = await erpFetch('login', {
      method: 'POST',
      body: {
        phone: cleanPhone || login.trim(),
        login: login.trim(),
        password: password.trim(),
      },
    });

    const data = await response.json().catch(() => null);

    // Обработка 403 Forbidden: деактивирован в ERP
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
        return {
          success: true,
          token: data.token || data.portal_session_token,
          user_type: 'employee',
          employee: {
            id: Number(emp.id || emp.manager_id),
            name: emp.name || emp.username || 'Сотрудник ERP',
            role: emp.role || 'manager_rm',
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
          financials: {
            debt_usd: debtUsd,
            balance_usd: balanceUsd,
          },
        },
      };
    }

    // Если бэкенд ERP вернул ошибку логина/пароля
    if (data && data.error && !data.error.includes('Неизвестное действие')) {
      return {
        success: false,
        code: data.code || 'AUTH_FAILED',
        error: data.error,
      };
    }
  } catch (err: any) {
    console.warn('[authenticateClientViaErp] Network error calling login:', err);
  }

  // 2. Fallback: поиск клиента среди выгруженных активных контрагентов (Pull Sync)
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

      return {
        success: true,
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
          financials: matched.financials,
          regional_manager: matched.regional_manager,
          contracts: matched.contracts,
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
    } catch {
      // fallback
    }
  }
}

/**
 * Получение персональной задолженности и неоплаченных накладных клиента из ERP.
 */
export async function fetchClientDebtFromErp(params: { phone?: string; counterpartyId?: number; search?: string }): Promise<ClientDebtReport> {
  const response = await erpFetch('client_debt', {
    method: 'GET',
    params: {
      phone: params.phone,
      counterparty_id: params.counterpartyId,
      search: params.search,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка загрузки задолженности (${response.status})`);
  }

  return await response.json();
}

/**
 * Управление доступом дилера к порталу в ERP (action=update_client_access).
 * При отключении дилер мгновенно блокируется (CLIENT_DEACTIVATED).
 */
export async function updateClientAccessInErp(clientId: number | string, accessEnabled: boolean | number): Promise<{ success: boolean }> {
  const numClientId = Number(String(clientId).replace(/\D+/g, '')) || clientId;
  const isEnabled = typeof accessEnabled === 'boolean' ? (accessEnabled ? 1 : 0) : accessEnabled;
  const response = await erpFetch('update_client_access', {
    method: 'POST',
    body: {
      client_id: numClientId,
      access_enabled: isEnabled,
    },
  });

  if (!response.ok) {
    throw new Error(`Ошибка изменения доступа клиента в ERP (${response.status})`);
  }

  return { success: true };
}

/**
 * Принудительное онлайн-обновление актуального баланса дилера из 1C:ERP (минуя локальный кэш)
 */
export async function refreshLiveClientBalance(partnerId: string | number): Promise<any> {
  const response = await erpFetch('refresh_balance', {
    method: 'POST',
    body: { partner_id: String(partnerId) },
  });

  if (!response.ok) {
    throw new Error(`Ошибка онлайн-запроса баланса из ERP (${response.status})`);
  }

  return await response.json();
}

