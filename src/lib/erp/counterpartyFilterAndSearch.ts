import { normalizeHomoglyphs, toCanonicalSearchString } from '../searchNormalization';
import { isCentralWarehouse } from '../warehouseVisibility';
import type { Counterparty } from './types';

/**
 * Определяет, является ли запись контрагента из ERP технической заглушкой склада
 * (например, "Туткабек склад(Асхоум)", "Test Warehouse", "Жоргараева(Аяулым)" без телефона/города и т.д.).
 * Такие записи не должны выводиться как клиенты в поиске корзины и личного кабинета.
 */
export function isCounterpartyWarehouseStub(c: any): boolean {
  if (!c) return true;
  const name = String(c.name || '').trim();
  const nameLower = name.toLowerCase();
  const whName = String(c.showroom_warehouse_name || c.warehouse_name || '').trim();
  const whNameLower = whName.toLowerCase();
  const whId = c.showroom_warehouse_id ?? c.warehouse_id ?? null;
  const phone = String(c.phone || '').trim();
  const city = String(c.city || '').trim();

  // 1. Явное упоминание склада в названии контрагента или его складе-заглушке
  if (
    nameLower.includes('склад') ||
    nameLower.includes('warehouse') ||
    whNameLower.includes('test warehouse')
  ) {
    return true;
  }

  // 2. Название контрагента полностью совпадает с названием склада-шоурума
  // (например, "Mega Arzan Home(Арзан Сатпаева)", "Берекет(Мирас)", "Жоргараева(Аяулым)", "Пиушко(Сыганак)", "Раджан 2", "Тиара")
  if (whNameLower && nameLower === whNameLower) {
    const hasLegalEntityMarker = /(^|\s)(ип|тоо|ip|too|llp)(\s|$)/i.test(name);
    if (!hasLegalEntityMarker) {
      return true;
    }
  }

  // 3. Привязан склад комиссионера, но у записи нет ни телефона, ни города (техническая карточка склада в 1С/ERP)
  if (whId && !phone && !city) {
    return true;
  }

  return false;
}

/**
 * Проверка, является ли контрагент архивным, рассылочным, тестовым, системным,
 * заглушкой склада или деактивированным.
 */
export function isCounterpartyArchivedOrMailing(c: any): boolean {
  if (!c) return true;
  const name = String(c.name || '').toLowerCase().trim();
  const city = String(c.city || '').toLowerCase().trim();
  const status = String(c.status || '').toLowerCase().trim();
  const access = String(c.access || '').toLowerCase().trim();
  const coopType = String(c.cooperation_type || '').toLowerCase().trim();

  if (
    ['inactive', 'archived', 'archive', 'disabled', 'deleted'].includes(status) ||
    access === 'disabled' ||
    c.is_active === 0 || c.is_active === false || c.is_active === '0' ||
    c.portal_access_enabled === 0 || c.portal_access_enabled === false || c.portal_access_enabled === '0' ||
    c.is_archived === true || c.is_archived === 1 || c.archived === true || c.archived === 1
  ) {
    return true;
  }

  // Исключаем поставщиков и склады из клиентского справочника
  if (coopType === 'поставщик' || coopType === 'supplier') {
    return true;
  }

  if (isCounterpartyWarehouseStub(c)) {
    return true;
  }

  // Архивные, рассылочные, тестовые и служебные записи ERP
  return (
    name.includes('рассылк') ||
    name.startsWith('для рассылки') ||
    city.includes('заполним позже') ||
    city === 'сатана' ||
    name.includes('архив') ||
    name.includes('[архив]') ||
    name.includes('(архив)') ||
    name.includes('мусор') ||
    name.includes('неверный') ||
    name.includes('тестов') ||
    name === 'тест' ||
    name.includes('test client') ||
    name.includes('идемпотентн') ||
    name.includes('kilem khan demo') ||
    name.includes('клиент (демо)') ||
    name.includes('новый механизм') ||
    name.includes('поставщик уточняется') ||
    name.includes('розничный покупатель') ||
    name.includes('synergy group (erp)') ||
    name === 'afan (synergy group (erp))'
  );
}

export function isCounterpartyActive(c: any): boolean {
  return !isCounterpartyArchivedOrMailing(c);
}

/**
 * Нормализует телефон к цифрам и приводит казахстанские номера (87... / +77... / 77...) к единому виду
 * для поиска как по '8701...', так и по '+7 (701)...' или '701...'.
 */
export function normalizePhoneForSearch(phone: string | undefined | null): string {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    return digits.slice(1); // последние 10 цифр (например, 7011200777)
  }
  return digits;
}

/**
 * Дедупликация контрагентов по ID и связывание складов комиссионеров с реальными активными контрагентами.
 */
export function deduplicateAndEnrichCounterparties(rawList: any[]): {
  all: Counterparty[];
  warehouseOwnerMap: Map<number, Counterparty>;
  warehouseNameOwnerMap: Map<string, Counterparty>;
} {
  const byId = new Map<number | string, Counterparty>();
  const stubRecords: any[] = [];

  for (const item of rawList) {
    if (!item || item.id == null) continue;
    const id = Number(item.id) || item.id;
    const whId = item.showroom_warehouse_id ?? item.warehouse_id ?? null;
    const whName = String(item.showroom_warehouse_name || item.warehouse_name || '').trim();

    if (isCounterpartyWarehouseStub(item)) {
      stubRecords.push(item);
    }

    const existing = byId.get(id);
    if (!existing) {
      const whIds = whId ? [Number(whId)] : [];
      const whNames = whName ? [whName] : [];
      const isArchived = isCounterpartyArchivedOrMailing(item);
      byId.set(id, {
        ...item,
        id,
        showroom_warehouse_ids: whIds,
        showroom_warehouse_names: whNames,
        is_warehouse_stub: isCounterpartyWarehouseStub(item),
        is_archived_or_mailing: isArchived,
        is_acting_client: !isArchived,
      });
    } else {
      if (whId && !existing.showroom_warehouse_ids.includes(Number(whId))) {
        existing.showroom_warehouse_ids.push(Number(whId));
      }
      if (whName && !existing.showroom_warehouse_names.includes(whName)) {
        existing.showroom_warehouse_names.push(whName);
      }
      if (!existing.phone && item.phone) existing.phone = item.phone;
      if (!existing.city && item.city) existing.city = item.city;
      if ((!existing.contracts || existing.contracts.length === 0) && Array.isArray(item.contracts) && item.contracts.length > 0) {
        existing.contracts = item.contracts;
      }
    }
  }

  const all = Array.from(byId.values()).sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'ru')
  );
  const activeClients = all.filter(c => c.is_acting_client);

  const warehouseOwnerMap = new Map<number, Counterparty>();
  const warehouseNameOwnerMap = new Map<string, Counterparty>();

  // 1. Прямая привязка складов от действующих контрагентов
  for (const c of activeClients) {
    const whIds: number[] = Array.isArray(c.showroom_warehouse_ids) ? c.showroom_warehouse_ids : [];
    const whNames: string[] = Array.isArray(c.showroom_warehouse_names) ? c.showroom_warehouse_names : [];
    for (const wid of whIds) {
      if (wid && !warehouseOwnerMap.has(wid)) {
        warehouseOwnerMap.set(wid, c);
      }
    }
    for (const wname of whNames) {
      const key = wname.toLowerCase().trim();
      if (key && !warehouseNameOwnerMap.has(key)) {
        warehouseNameOwnerMap.set(key, c);
      }
    }
  }

  // 2. Привязка складов из технических карточек-заглушек к реальным активным клиентам по фамилии/названию/телефону
  for (const stub of stubRecords) {
    const wid = Number(stub.showroom_warehouse_id ?? stub.warehouse_id ?? 0);
    const wname = String(stub.showroom_warehouse_name || stub.warehouse_name || stub.name || '').trim();
    const stubPhone10 = normalizePhoneForSearch(stub.phone);
    const basePrefix = String(stub.name || '')
      .split(/[(\s]/)[0]
      .replace(/[^a-zа-яё0-9]/gi, '')
      .toLowerCase();

    let matchedOwner = activeClients.find(c => {
      if (stubPhone10 && stubPhone10.length >= 10 && normalizePhoneForSearch(c.phone) === stubPhone10) {
        return true;
      }
      if (basePrefix.length >= 4) {
        const cNameLower = String(c.name || '').toLowerCase();
        return cNameLower.startsWith(basePrefix) || cNameLower.includes(basePrefix);
      }
      return false;
    });

    if (!matchedOwner) {
      matchedOwner = byId.get(Number(stub.id) || stub.id);
    }

    if (matchedOwner) {
      if (wid && !warehouseOwnerMap.has(wid)) {
        warehouseOwnerMap.set(wid, matchedOwner);
      }
      if (wname && !warehouseNameOwnerMap.has(wname.toLowerCase())) {
        warehouseNameOwnerMap.set(wname.toLowerCase(), matchedOwner);
      }
      // Склад из заглушки доступен для поиска/выбора через владельца (оригинальное название)
      const mo = matchedOwner as any;
      if (!Array.isArray(mo.linked_warehouse_names)) mo.linked_warehouse_names = [];
      if (wname && !mo.linked_warehouse_names.includes(wname)) mo.linked_warehouse_names.push(wname);
    }
  }

  return { all, warehouseOwnerMap, warehouseNameOwnerMap };
}

/**
 * Определяет, является ли склад в корзине складом комиссионера (партнерским шоурумом),
 * а не Центральным складом Астаны (ID 81) и не Предзаказом (Фабрика).
 */
export function isConsignmentWarehouseItem(item: {
  warehouse?: string;
  warehouse_id?: number | null;
  is_preorder?: boolean;
}): boolean {
  if (!item) return false;
  const whName = String(item.warehouse || '').trim();
  const whLower = whName.toLowerCase();
  if (item.is_preorder || whLower.includes('предзаказ') || whLower.includes('фабрика') || whLower.includes('factory')) {
    return false;
  }
  if (!whName && !item.warehouse_id) {
    return false;
  }
  if (isCentralWarehouse({ warehouse_id: item.warehouse_id ?? undefined, warehouse_name: whName })) {
    return false;
  }
  return true;
}

/**
 * Умный мульти-токен поиск по активным контрагентам с поддержкой:
 * - Независимости от регистра (Кириллица / Латиница) и омоглифов
 * - Поиска с 1-го символа
 * - Поиска по любому фрагменту телефона (8701..., +7 701..., 701...)
 * - Поиска по названию ИП/ТОО, ФИО, городу, БИН и ID
 * - Ранжирования по релевантности (точные совпадения и совпадения с начала слова выше)
 */
export function searchCounterpartiesSmart<T extends Record<string, any>>(
  list: T[],
  rawQuery: string,
  limit?: number
): T[] {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) {
    return limit ? list.slice(0, limit) : list;
  }

  const qLower = trimmed.toLowerCase();
  const qCanonical = toCanonicalSearchString(trimmed);
  const qTokens = qCanonical.split(/\s+/).filter(Boolean);
  const qRawTokens = qLower.split(/\s+/).filter(Boolean);
  const qDigits = trimmed.replace(/\D+/g, '');
  const qPhoneNorm = normalizePhoneForSearch(trimmed);

  const scored: Array<{ item: T; score: number }> = [];

  for (const item of list) {
    const name = String(item.name || item.full_name || item.company_name || '');
    const nameLower = name.toLowerCase();
    const nameCanonical = toCanonicalSearchString(name);
    const city = String(item.city || '');
    const cityLower = city.toLowerCase();
    const cityCanonical = toCanonicalSearchString(city);
    const phone = String(item.phone || item.portal_login || '');
    const phoneDigits = phone.replace(/\D+/g, '');
    const phoneNorm = normalizePhoneForSearch(phone);
    const bin = String(item.bin || '');
    const idStr = String(item.partner_id ?? item.id ?? '');
    // Названия складов комиссионера (шоурумов) — чтобы можно было искать по складу, а не только по контрагенту
    const warehouseText = [
      item.showroom_warehouse_name,
      item.warehouse_name,
      ...(Array.isArray(item.showroom_warehouse_names) ? item.showroom_warehouse_names : []),
      ...(Array.isArray(item.linked_warehouse_names) ? item.linked_warehouse_names : []),
    ].filter(Boolean).join(' ');
    const warehouseLower = warehouseText.toLowerCase();
    const warehouseCanonical = toCanonicalSearchString(warehouseText);

    const combinedRaw = `${nameLower} ${warehouseLower} ${cityLower} ${phoneDigits} ${phoneNorm} ${bin.toLowerCase()} ${idStr.toLowerCase()}`;
    const combinedCanonical = `${nameCanonical} ${warehouseCanonical} ${cityCanonical} ${phoneDigits} ${phoneNorm} ${bin.toLowerCase()} ${idStr.toLowerCase()}`;

    // Проверяем, что все токены запроса присутствуют (в обычном, каноническом или цифровом виде)
    const matchesAllTokens = qRawTokens.every((rawTok, idx) => {
      const canTok = qTokens[idx] || normalizeHomoglyphs(rawTok);
      const tokDigits = rawTok.replace(/\D+/g, '');
      const tokPhoneNorm = normalizePhoneForSearch(rawTok);

      if (combinedRaw.includes(rawTok) || (canTok && combinedCanonical.includes(canTok))) {
        return true;
      }
      if (tokDigits.length >= 2 && (phoneDigits.includes(tokDigits) || phoneNorm.includes(tokPhoneNorm) || idStr.includes(tokDigits) || bin.includes(tokDigits))) {
        return true;
      }
      return false;
    });

    if (!matchesAllTokens) continue;

    // Расчет веса релевантности
    let score = 10;
    if (idStr === qLower) score += 100;
    if (nameLower === qLower || nameCanonical === qCanonical) score += 90;
    if (nameLower.startsWith(qLower) || (qCanonical && nameCanonical.startsWith(qCanonical))) score += 60;
    else if (nameLower.includes(qLower) || (qCanonical && nameCanonical.includes(qCanonical))) score += 35;

    if (qDigits.length >= 3) {
      if (phoneNorm && qPhoneNorm && phoneNorm.includes(qPhoneNorm)) score += 50;
      else if (phoneDigits.includes(qDigits)) score += 45;
      else if (bin.includes(qDigits)) score += 40;
      else if (idStr.startsWith(qDigits)) score += 30;
    }

    if (warehouseLower && (warehouseLower.includes(qLower) || (qCanonical && warehouseCanonical.includes(qCanonical)))) {
      score += 30;
    }

    if (cityLower.startsWith(qLower) || (qCanonical && cityCanonical.startsWith(qCanonical))) {
      score += 25;
    }

    scored.push({ item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const nameA = String(a.item.name || a.item.full_name || '');
    const nameB = String(b.item.name || b.item.full_name || '');
    return nameA.localeCompare(nameB, 'ru');
  });

  const results = scored.map(s => s.item);
  return limit ? results.slice(0, limit) : results;
}
