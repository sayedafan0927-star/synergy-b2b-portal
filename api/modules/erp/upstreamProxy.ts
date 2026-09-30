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
      images: Array.isArray(d.images) ? d.images : [],
      image_thumb: Array.isArray(d.images) && d.images[0] ? d.images[0] : undefined,
      variants: Array.isArray(d.variants) ? d.variants.map((v: any) => ({
        ...v,
        id: v.id || `var-${v.sku}`,
        base_price: Number(v.base_price || (Number(v.price_per_sqm || 15) * Number(v.area_sqm || 1))),
        price_per_sqm: Number(v.price_per_sqm || 15),
        stock: Number(v.free_stock ?? v.stock ?? 0),
        free_stock: Number(v.free_stock ?? v.stock ?? 0),
        reserved_stock: Number(v.reserved_stock ?? 0),
        total_stock: Number(v.total_stock ?? 0),
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

export function handleErpLoginToken(jsonData: any, supabase: SupabaseClient | null) {
  try {
    const SECRET_KEY = process.env.PORTAL_SECRET_KEY || '';
    if (SECRET_KEY) {
      const c = jsonData.client || {};
      const pId = String(c.id || jsonData.client_id || '');
      const uId = `erp-client-${pId}`;
      const fName = String(jsonData.name || c.name || 'Оптовый клиент');
      const phone = String(jsonData.phone || c.phone || '');
      const priceType = String(c.price_type || 'wholesale');

      const sessionData = {
        user: {
          id: uId,
          email: `${phone.replace(/\D+/g, '') || pId}@kilem-khan.kz`,
          user_metadata: { full_name: fName },
        },
        profile: {
          id: uId,
          role: 'client',
          partner_id: pId,
          full_name: fName,
          phone,
          company_name: fName,
          price_type: priceType,
          showroom_warehouse_id: c.showroom_warehouse_id ?? null,
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
              id: crypto.randomUUID(),
              partner_id: pId,
              erp_id: Number(pId) || null,
              full_name: fName,
              company_name: fName,
              phone,
              price_type: priceType,
              role: 'client',
              impersonation_enabled: true,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'partner_id' })
        ).catch((e: any) => console.warn('[API Proxy ERP] Profile upsert notice:', e));
      }
    }
  } catch (tokenErr) {
    console.warn('[API Proxy ERP] Error generating login session token:', tokenErr);
  }
}

export async function handleErpLoginFallback(
  req: VercelRequest,
  res: VercelResponse,
  targetErpUrl: string,
  serverErpKey: string,
  correlationId: string,
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

  if (matchedEmp) {
    const inputPass = String(loginBody.password || req.query?.password || '').trim();
    const handled = await handleEmployeeLoginFallback(
      req,
      res,
      matchedEmp,
      inputCleanPhone,
      inputLogin,
      inputPass,
      correlationId,
    );
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
      if (counterparties.length === 0) {
        const allUrl = `${targetErpUrl}?action=counterparties`;
        const allRes = await fetch(allUrl, { headers: { 'X-Portal-Key': serverErpKey } });
        if (allRes.ok) {
          const allData = await allRes.json();
          counterparties = Array.isArray(allData) ? allData : allData?.counterparties || [];
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
