import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Portal } from '@/components/common/Portal';
import { updateOrderStatusInErp, cancelOrderViaPortal } from '@/lib/erpApi';
import { supabase } from '@/lib/supabase';
import { triggerCatalogReload } from '@/hooks/useProductData';

interface ParsedApprovalIntent {
  decision: 'approve' | 'reject';
  orderId: string;
  orderDocNumber: string;
  expired?: boolean;
}

const INITIAL_SEARCH = typeof window !== 'undefined' ? window.location.search : '';

function parseInitialApprovalIntent(searchStr: string): ParsedApprovalIntent | null {
  if (!searchStr) return null;
  try {
    const params = new URLSearchParams(searchStr);
    const rawDecision = params.get('decision');
    const token = params.get('token');
    let decision: 'approve' | 'reject' | null =
      rawDecision === 'approve' || rawDecision === 'reject' ? rawDecision : null;
    let orderId = params.get('order_id') || '';
    let orderDocNumber = params.get('doc') || '';
    let expired = false;

    if (token) {
      try {
        const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(decodeURIComponent(escape(atob(base64))));
        if (decoded?.orderId) orderId = String(decoded.orderId);
        if (decoded?.orderDocNumber) orderDocNumber = String(decoded.orderDocNumber);
        if (!decision && (decoded?.decision === 'approve' || decoded?.decision === 'reject')) {
          decision = decoded.decision;
        }
        if (decoded?.expiresAt && Date.now() > Number(decoded.expiresAt)) {
          expired = true;
        }
      } catch {
        try {
          const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
          const decoded = JSON.parse(atob(base64));
          if (decoded?.orderId) orderId = String(decoded.orderId);
          if (!decision && (decoded?.decision === 'approve' || decoded?.decision === 'reject')) {
            decision = decoded.decision;
          }
          if (decoded?.expiresAt && Date.now() > Number(decoded.expiresAt)) {
            expired = true;
          }
        } catch {}
      }
    }

    if (!decision || !orderId) return null;
    return {
      decision,
      orderId,
      orderDocNumber: orderDocNumber || `ORD-${orderId}`,
      expired,
    };
  } catch {
    return null;
  }
}

export default function WhatsAppApprovalOverlay() {
  const [intent, setIntent] = useState<ParsedApprovalIntent | null>(() =>
    parseInitialApprovalIntent(INITIAL_SEARCH)
  );
  const [status, setStatus] = useState<'processing' | 'done' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!intent) return;
    if (intent.expired) {
      setStatus('error');
      setErrorMsg('Срок действия ссылки согласования (24 часа) истек.');
      return;
    }

    let active = true;
    (async () => {
      try {
        if (intent.decision === 'approve') {
          await updateOrderStatusInErp({
            orderId: intent.orderId,
            status: 'picking',
            comment: 'Согласовано руководителем через WhatsApp -> Передано на сборку в WMS (ТСД)',
          });
          try {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.orderId);
            const q = supabase.from('orders').update({ status: 'picking', updated_at: new Date().toISOString() });
            await (isUuid ? q.eq('id', intent.orderId) : q.eq('order_number', intent.orderDocNumber));
          } catch {}
        } else {
          await cancelOrderViaPortal({
            order_id: intent.orderId,
            order_number: intent.orderDocNumber,
            reason: 'Отклонено руководителем через WhatsApp',
          }).catch(async () => {
            await updateOrderStatusInErp({
              orderId: intent.orderId,
              status: 'cancelled',
              comment: 'Отклонено руководителем через WhatsApp',
            });
          });
          triggerCatalogReload();
        }
        if (active) setStatus('done');
      } catch (err: any) {
        if (active) {
          setStatus('error');
          setErrorMsg(err?.message || 'Не удалось обновить статус заказа в Synergy ERP.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [intent]);

  if (!intent) return null;

  const isApprove = intent.decision === 'approve';

  return (
    <Portal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-modal-backdrop modal-gpu-backdrop"
          onClick={() => setIntent(null)}
          aria-hidden="true"
        />
        <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 text-center space-y-4 animate-modal-card modal-gpu-card">
          {status === 'processing' && (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Обработка решения по заказу №{intent.orderDocNumber}...
              </h3>
              <p className="text-xs text-slate-500">
                Синхронизация статуса со шлюзом Synergy ERP и складской системой WMS (ТСД)
              </p>
            </>
          )}

          {status === 'done' && (
            <>
              <div
                className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
                  isApprove ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                }`}
              >
                {isApprove ? <CheckCircle2 className="h-8 w-8" /> : <XCircle className="h-8 w-8" />}
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                {isApprove ? 'Заказ ОДОБРЕН' : 'Заказ ОТКЛОНЕН'}
              </h3>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-left text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Номер заказа:</span>
                  <span className="font-bold text-slate-900">№{intent.orderDocNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Новый статус:</span>
                  <span className={`font-bold ${isApprove ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {isApprove ? 'На сборке WMS (ТСД)' : 'Отменён (резервы сняты)'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIntent(null)}
                className="btn-primary w-full justify-center cursor-pointer"
              >
                Перейти на портал Synergy B2B
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Не удалось выполнить действие</h3>
              <p className="text-xs text-rose-600">{errorMsg}</p>
              <button
                type="button"
                onClick={() => setIntent(null)}
                className="btn-primary w-full justify-center cursor-pointer"
              >
                Закрыть
              </button>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
