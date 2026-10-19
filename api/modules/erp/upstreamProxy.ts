import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleLoginFallback, handleEmployeeLoginFallback } from '../auth/loginHandler';

export function normalizeErpDesigns(jsonData: any) {
  if (Array.isArray(jsonData.designs) && !Array.isArray(jsonData.products)) {
    const normalizedProducts = jsonData.designs.map((d: any) => ({
      id: String(d.design_id || d.id || `design-${d.article}`),
      name: d.name || `${d.collection} ${d.article}`,
      collection: d.collection,
      article: d.article,
      category: d.category || 'Ковры',
      manufacturer: d.manufacturer || 'Karmen Hali',
      country: d.country || 'Турция',
      color: d.color || '',
      material: d.material || '',
      density: String(d.density || ''),
      pile_height: String(d.pile_height || ''),
      has_preorder: Boolean(d.has_preorder),
      in_production_total_qty: Number(d.in_production_total_qty ?? 0),
      production_eta: d.production_eta ?? null,
      images: Array.isArray(d.images) ? d.images : [],
      image_thumb: Array.isArray(d.images) && d.images[0] ? d.images[0] : undefined,
      variants: Array.isArray(d.variants || d.sizes) ? (d.variants || d.sizes).map((v: any) => ({
        ...v,
        id: v.id || v.item_id || `var-${v.sku || v.size}`,
        item_id: v.item_id || v.id,
        base_price: Number(v.base_price || (Number(v.price_per_sqm || 15) * Number(v.area_sqm || 1))),
        price_per_sqm: Number(v.price_per_sqm || 15),
        stock: Number(v.free_stock ?? v.stock_free ?? v.stock ?? 0),
        free_stock: Number(v.free_stock ?? v.stock_free ?? v.stock ?? 0),
        reserved_stock: Number(v.reserved_stock ?? 0),
        total_stock: Number(v.total_stock ?? 0),
        stock_status: v.stock_status,
        in_production_qty: Number(v.in_production_qty ?? 0),
        production_eta: v.production_eta ?? d.production_eta ?? null,
        is_preorder_available: Boolean(v.is_preorder_available || Number(v.in_production_qty ?? 0) > 0),
        warehouses: Array.isArray(v.warehouses) ? v.warehouses.map((w: any) => ({
          ...w,
          stock: Number(w.free_stock ?? w.stock ?? 0),
          free_stock: Number(w.free_stock ?? w.stock ?? 0),
          reserved_stock: Number(w.reserved_stock ?? 0),
          total_stock: Number(w.total_stock ?? 0),
          is_hub: w.warehouse_id === 81 || (w.warehouse_name && w.warehouse_name.includes('Астана')),
        })) : [],
      })) : [],
    }));
    jsonData.products = normalizedProducts;
  }
}

export async function handleErpLoginToken(jsonData: any, supabase: SupabaseClient | null): Promise<boolean> {
  try {
    const SECRET_KEY = process.env.PORTAL_SECRET_KEY || '';
    if (SECRET_KEY) {
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (jsonData.user_type === 'employee' || jsonData.employee) {
        const emp = jsonData.employee || jsonData;
        const empId = String(emp.id || emp.manager_id || '');
        const rawRole = String(emp.role || jsonData.role || 'manager_rm').toLowerCase().trim();
        const empRole = rawRole === 'lm' ? 'manager_lm' : (rawRole === 'admin' ? 'admin' : 'manager_rm');
        const empName = String(emp.name || jsonData.name || 'Сотрудник ERP');
        const empPhone = String(emp.phone || jsonData.phone || '');
        let empProfileId = crypto.randomUUID();

        if (supabase && empId) {
          try {
            const { data: eRow } = await supabase
              .from('profiles')
              .select('id')
              .eq('manager_id', empId)
              .in('role', ['admin', 'manager_rm', 'manager_lm'])
              .maybeSingle();
            if (eRow?.id && UUID_REGEX.test(eRow.id)) empProfileId = eRow.id;
          } catch {}
        }

        const empSessionData = {
          user: {
            id: empProfileId,
            email: `${empPhone.replace(/\D+/g, '') || empId}@synergy-portal.kz`,
            user_metadata: { full_name: empName, erp_emp_id: `erp-employee-${empId}` },
          },
          profile: {
            id: empProfileId,
            role: empRole,
            partner_id: null,
            full_name: empName,
            phone: empPhone,
            company_name: 'Synergy Group (ERP)',
            manager_id: empId,
            price_type: 'wholesale',
            impersonation_enabled: true,
          },
          timestamp: Date.now(),
        };
        const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(empSessionData)).digest('hex');
        const sessionToken = Buffer.from(JSON.stringify({ data: empSessionData, sig })).toString('base64url');
        jsonData.role = empRole;
        if (jsonData.employee) jsonData.employee.role = empRole;
        jsonData.token = sessionToken;
        jsonData.portal_session_token = sessionToken;
        return true;
      }

      const c = jsonData.client || {};
      const pId = String(c.id || jsonData.client_id || '');
      const uId = `erp-client-${pId}`;
      const fName = String(jsonData.name || c.name || 'Оптовый клиент');
      const phone = String(jsonData.phone || c.phone || '');

      let dbProfile: any = null;
      if (pId && supabase) {
        try {
          const { data: pRow } = await supabase
            .from('profiles')
            .select('id, price_type, credit_limit_usd, is_blocked_for_shipment, impersonation_enabled, showroom_warehouse_id, manager_id')
            .eq('partner_id', pId)
            .maybeSingle();
          dbProfile = pRow;
        } catch {}
      }

      if (
        c.is_active === 0 ||
        c.portal_access_enabled === false ||
        c.status === 'inactive' ||
        dbProfile?.is_blocked_for_shipment === true ||
        dbProfile?.impersonation_enabled === false
      ) {
        jsonData.success = false;
        jsonData.code = 'CLIENT_DEACTIVATED';
        jsonData.error = 'Доступ к оптовому порталу заблокирован: учетная запись контрагента деактивирована.';
        delete jsonData.token;
        delete jsonData.portal_session_token;
        return false;
      }

      const firstContract = Array.isArray(c.contracts) && c.contracts.length > 0 ? c.contracts[0] : null;
      const priceType = String(c.price_type || firstContract?.price_type || dbProfile?.price_type || 'wholesale');
      const assignedManagerId = String(
        c.regional_manager?.id || jsonData.regional_manager?.id || c.manager_id || dbProfile?.manager_id || ''
      ).trim() || null;
      const creditLimitUsd = Number(
        c.credit_limit_usd ??
        c.financials?.credit_limit_usd ??
        firstContract?.credit_limit_usd ??
        firstContract?.credit_limit ??
        dbProfile?.credit_limit_usd ??
        0
      );
      const resolvedUserId = (dbProfile?.id && UUID_REGEX.test(dbProfile.id))
        ? dbProfile.id
        : ((typeof c.uuid === 'string' && UUID_REGEX.test(c.uuid)) ? c.uuid : crypto.randomUUID());

      const sessionData = {
        user: {
          id: resolvedUserId,
          email: `${phone.replace(/\D+/g, '') || pId}@kilem-khan.kz`,
          user_metadata: { full_name: fName, erp_client_id: uId },
        },
        profile: {
          id: resolvedUserId,
          role: 'client',
          partner_id: pId,
          manager_id: assignedManagerId,
          full_name: fName,
          phone,
          company_name: fName,
          price_type: priceType,
          showroom_warehouse_id: c.showroom_warehouse_id ?? dbProfile?.showroom_warehouse_id ?? null,
        },
        timestamp: Date.now(),
      };

      const sig = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(sessionData)).digest('hex');
      const signedPayload = { data: sessionData, sig };
      const sessionToken = Buffer.from(JSON.stringify(signedPayload)).toString('base64url');

      jsonData.token = sessionToken;
      jsonData.portal_session_token = sessionToken;

      // Синхронизируем профиль клиента в базе данных
      if (pId && supabase) {
        Promise.resolve(
          supabase
            .from('profiles')
            .upsert({
              id: resolvedUserId,
              partner_id: pId,
              erp_id: Number(pId) || null,
              manager_id: assignedManagerId,
              full_name: fName,
              company_name: fName,
              phone,
              price_type: priceType,
              credit_limit_usd: creditLimitUsd,
              role: 'client',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'partner_id' })
        ).catch((e: any) => console.warn('[API Proxy ERP] Profile upsert notice:', e));
      }
    }
    return true;
  } catch (tokenErr) {
    console.warn('[API Proxy ERP] Error generating login session token:', tokenErr);
    return true;
  }
}

export async function handleErpLoginFallback(
  req: VercelRequest,
  res: VercelResponse,
  targetErpUrl: string,
  serverErpKey: string,
  correlationId: string,
  supabase?: SupabaseClient | null,
): Promise<boolean> {
  let loginBody: any = {};
  try {
    if (Buffer.isBuffer(req.body)) {
      loginBody = JSON.parse(req.body.toString('utf8'));
    } else if (typeof req.body === 'string') {
      loginBody = JSON.parse(req.body || '{}');
    } else if (typeof req.body === 'object' && req.body !== null) {
      loginBody = req.body;
    }
  } catch {}
  const inputLogin = String(loginBody.login || loginBody.phone || req.query?.login || req.query?.phone || '').trim();
  const inputCleanPhone = inputLogin.replace(/\D+/g, '');

  if (!inputLogin) return false;

  let managers: any[] = [];
  try {
    const rmUrl = `${targetErpUrl}?action=regional_managers`;
    const rmRes = await fetch(rmUrl, { headers: { 'X-Portal-Key': serverErpKey } });
    if (rmRes.ok) {
      const rmData = await rmRes.json();
      if (rmData && Array.isArray(rmData.managers)) {
        managers = rmData.managers;
      }
    }
  } catch (rmErr) {
    console.warn('[API Proxy ERP] Error fetching regional managers for auth fallback:', rmErr);
  }

  if (managers.length === 0) {
    console.warn('[AUTH] ERP regional_managers endpoint returned no data or failed. Employee login denied.');
  }

  const matchedEmp = managers.find((m: any) => {
    const mPhoneClean = String(m.phone || '').replace(/\D+/g, '');
    const mUsername = String(m.username || '').toLowerCase().trim();
    const mName = String(m.name || '').toLowerCase().trim();
    const qLow = inputLogin.toLowerCase().trim();

    if (
      inputCleanPhone &&
      mPhoneClean &&
      (mPhoneClean === inputCleanPhone ||
        (mPhoneClean.length >= 10 && inputCleanPhone.endsWith(mPhoneClean.slice(-10))) ||
        (inputCleanPhone.length >= 10 && mPhoneClean.endsWith(inputCleanPhone.slice(-10))))
    ) {
      return true;
    }
    if (mUsername && (mUsername === qLow || qLow.includes(mUsername))) return true;
    if (mName && (mName === qLow || qLow.includes(mName))) return true;
    return false;
  });

  let effectiveEmp = matchedEmp;
  if (!effectiveEmp && supabase) {
    try {
      const qLow = inputLogin.toLowerCase().trim();
      const { data: dbAdmin } = await supabase
        .from('profiles')
        .select('id, full_name, role, phone, manager_id, password_hash')
        .in('role', ['admin', 'manager_rm', 'manager_lm', 'supplier'])
        .or(`full_name.ilike.%${qLow}%,phone.eq.${inputLogin}`)
        .limit(1)
        .maybeSingle();

      if (dbAdmin) {
        effectiveEmp = {
          id: dbAdmin.id,
          name: dbAdmin.full_name || inputLogin,
          role: dbAdmin.role,
          phone: dbAdmin.phone || inputLogin,
        };
      }
    } catch (dbErr) {
      console.warn('[AUTH] Error looking up admin profile in database:', dbErr);
    }
  }

  if (effectiveEmp) {
    const inputPass = String(loginBody.password || req.query?.password || '').trim();
    const empUsername = String(effectiveEmp.username || effectiveEmp.name || '').trim();
    if (empUsername && empUsername.toLowerCase() !== inputLogin.toLowerCase() && inputPass) {
      try {
        const retryRes = await fetch(`${targetErpUrl}?action=login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Portal-Key': serverErpKey },
          body: JSON.stringify({ login: empUsername, password: inputPass }),
        });
        const retryData = retryRes.ok ? await retryRes.json().catch(() => null) : null;
        if (retryData?.success) {
          await handleErpLoginToken(retryData, supabase || null);
          res.status(200).json(retryData);
          return true;
        }
      } catch (retryErr) {
        console.warn('[AUTH] Upstream employee username retry notice:', retryErr);
      }
    }
    const handled = await handleEmployeeLoginFallback(req, res, effectiveEmp, inputCleanPhone, inputLogin, inputPass, correlationId);
    if (handled) return true;
  }

  // 2. Проверяем, не является ли логин/телефон зарегистрированным клиентом (дилером) в ERP
  if (inputCleanPhone && inputCleanPhone.length >= 7) {
    let counterparties: any[] = [];
    try {
      const cpUrl = `${targetErpUrl}?action=counterparties&phone=${encodeURIComponent(inputCleanPhone)}`;
      const cpRes = await fetch(cpUrl, { headers: { 'X-Portal-Key': serverErpKey } });
      if (cpRes.ok) {
        const cpData = await cpRes.json();
        if (Array.isArray(cpData)) {
          counterparties = cpData;
        } else if (cpData && Array.isArray(cpData.counterparties)) {
          counterparties = cpData.counterparties;
        }
      }
      if (counterparties.length === 0 && supabase) {
        // Защита от DoS: вместо тяжелой выгрузки всех контрагентов из 1С используем точечный поиск в базе
        const { data: localProfiles } = await supabase
          .from('profiles')
          .select('id, partner_id, full_name, company_name, phone, price_type, showroom_warehouse_id')
          .eq('role', 'client')
          .ilike('phone', `%${inputCleanPhone.slice(-10)}%`)
          .limit(1);

        if (localProfiles && localProfiles.length > 0) {
          const lp = localProfiles[0];
          counterparties = [{
            id: lp.partner_id || lp.id,
            name: lp.company_name || lp.full_name,
            phone: lp.phone,
            price_type: lp.price_type || 'wholesale',
            showroom_warehouse_id: lp.showroom_warehouse_id,
          }];
        }
      }
    } catch (cpErr) {
      console.warn('[API Proxy ERP] Error fetching counterparties for auth fallback:', cpErr);
    }

    const matchedClient = counterparties.find((c: any) => {
      const cPhoneClean = String(c.phone || '').replace(/\D+/g, '');
      if (!cPhoneClean) return false;
      return (
        cPhoneClean === inputCleanPhone ||
        (cPhoneClean.length >= 10 && inputCleanPhone.endsWith(cPhoneClean.slice(-10))) ||
        (inputCleanPhone.length >= 10 && cPhoneClean.endsWith(inputCleanPhone.slice(-10)))
      );
    });

    if (matchedClient) {
      const inputPass = String(loginBody.password || req.query?.password || '').trim();
      const handled = await handleLoginFallback(
        req,
        res,
        matchedClient,
        inputCleanPhone,
        inputLogin,
        inputPass,
        correlationId,
      );
      if (handled) return true;
    }
  }

  return false;
}

export async function enrichOrdersWithBufferedLocalOrders(
  jsonData: any,
  query: any,
  supabase: SupabaseClient | null
): Promise<void> {
  if (!supabase || !jsonData || !Array.isArray(jsonData.orders)) return;
  try {
    const clientIdParam = String(query?.client_id || query?.partner_id || query?.counterparty_id || '').trim();
    const managerIdParam = String(query?.manager_id || '').trim();
    let q = supabase
      .from('orders')
      .select('*, order_items(*), profiles!user_id(full_name, company_name, phone, partner_id, manager_id)')
      .is('parent_order_id', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (clientIdParam) {
      const { data: pRow } = await supabase.from('profiles').select('id').eq('partner_id', clientIdParam).limit(1).maybeSingle();
      q = pRow?.id ? q.or(`user_id.eq.${pRow.id},partner_id.eq.${clientIdParam}`) : q.eq('partner_id', clientIdParam);
    }

    const { data: dbOrders } = await q;
    if (!Array.isArray(dbOrders) || dbOrders.length === 0) return;

    for (const row of dbOrders) {
      if (row.status === 'cancellation_pending') {
        const doc = String(row.order_number || row.doc_number || '');
        const matchErp = jsonData.orders.find((o: any) => String(o.id || '') === String(row.id) || (doc && String(o.doc_number || o.order_number || '') === doc));
        if (matchErp) {
          matchErp.status = 'cancellation_pending';
          matchErp.status_code = 'cancellation_pending';
        }
      }
    }

    const knownDocs = new Set(jsonData.orders.map((o: any) => String(o.doc_number || o.order_number || '')).filter(Boolean));
    const knownIds = new Set(jsonData.orders.map((o: any) => String(o.id || '')));

    const buffered = dbOrders
      .filter((row: any) => {
        const doc = String(row.order_number || row.doc_number || '');
        if (knownIds.has(String(row.id)) || (doc && knownDocs.has(doc))) return false;
        const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (managerIdParam && String(prof?.manager_id || '') !== managerIdParam && String(row.placed_by_id || '') !== managerIdParam) return false;
        return true;
      })
      .map((row: any) => {
        const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const rawItems = Array.isArray(row.order_items) && row.order_items.length > 0 ? row.order_items : (Array.isArray(row.items) ? row.items : []);
        return {
          id: row.id, doc_number: row.order_number || row.doc_number || `ORD-${String(row.id).slice(0, 8)}`,
          client_id: Number(prof?.partner_id || row.partner_id || clientIdParam || 0) || row.user_id,
          client_name: prof?.company_name || prof?.full_name || 'Клиент', client_phone: prof?.phone || '',
          date: row.created_at, status: row.status || 'pending', status_code: row.status || 'pending',
          warehouse_name: row.warehouse || row.warehouse_name || 'Основной Склад Астана', comment: row.notes || row.comment || '',
          total_amount: Number(row.total_amount || 0), total_sqm: Number(row.total_sqm || 0),
          items_count: Number(row.total_items || rawItems.length || 0),
          items: rawItems.map((it: any, idx: number) => ({
            id: it.id || idx + 1, item_id: it.item_id || it.product_id, name: it.product_name || it.name || 'Ковер',
            size: it.size || 'Стандарт', sku: it.sku || '', warehouse: it.warehouse || row.warehouse || 'Основной Склад Астана',
            warehouse_id: it.warehouse_id, price: Number(it.price || 0), quantity: Number(it.quantity || 1),
          })),
        };
      });

    if (buffered.length > 0) {
      jsonData.orders = [...buffered, ...jsonData.orders];
      jsonData.count = jsonData.orders.length;
    }
  } catch (err) {
    console.warn('[API Proxy ERP] Orders enrichment notice:', err);
  }
}

