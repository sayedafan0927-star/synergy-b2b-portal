import { useState, useMemo } from 'react';
import { Building2, Boxes, X, CheckCircle2, Check, BarChart2 } from 'lucide-react';
import {
  getClientWarehouseSettings,
  saveClientWarehouseSettings,
  resetClientWarehouseSettings,
} from '@/lib/warehouseVisibility';
import { Portal } from '@/components/common/Portal';

export interface ClientWarehouseModalProps {
  client: {
    id: string;
    full_name: string;
    company_name: string;
    phone: string;
    partner_id: string | null;
    showroom_warehouse_id?: number | null;
    showroom_warehouse_name?: string | null;
  };
  onClose: () => void;
}

export function ClientWarehouseModal({ client, onClose }: ClientWarehouseModalProps) {
  const clientId = client.partner_id || client.id;
  const initialSettings = useMemo(() => getClientWarehouseSettings(clientId), [clientId]);

  const [mode, setMode] = useState<'auto' | 'custom'>(initialSettings.mode || 'auto');
  const [showCentral, setShowCentral] = useState<boolean>(initialSettings.showCentralWarehouse !== false);
  const [showShowroom, setShowShowroom] = useState<boolean>(initialSettings.showShowroomWarehouse !== false);
  const [showStockSummary, setShowStockSummary] = useState<boolean>(initialSettings.showStockSummary === true);
  const [saved, setSaved] = useState(false);

  const showroomId = client.showroom_warehouse_id;
  const showroomName = client.showroom_warehouse_name || (showroomId ? `Склад шоурума (ID: ${showroomId})` : null);

  const handleSave = () => {
    saveClientWarehouseSettings(clientId, {
      mode,
      showCentralWarehouse: showCentral,
      showShowroomWarehouse: showShowroom,
      showStockSummary,
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 700);
  };

  const handleResetToAuto = () => {
    resetClientWarehouseSettings(clientId);
    setMode('auto');
    setShowCentral(true);
    setShowShowroom(true);
    setShowStockSummary(false);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 700);
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs animate-modal-backdrop modal-gpu-backdrop" onClick={onClose} aria-hidden="true" />
        <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-100 p-6 space-y-5 animate-modal-card modal-gpu-card z-10" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-snug">Видимость складов для клиента</h3>
              <p className="text-xs text-slate-500 font-medium">
                {client.company_name || client.full_name} {client.partner_id ? `(ID: ${client.partner_id})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode switcher tabs */}
        <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode('auto')}
            className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
              mode === 'auto'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Автоматический режим
          </button>
          <button
            type="button"
            onClick={() => setMode('custom')}
            className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
              mode === 'custom'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Индивидуальная настройка
          </button>
        </div>

        {/* Mode content */}
        {mode === 'auto' ? (
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-100/80 p-4 space-y-2.5 text-xs text-emerald-950">
            <p className="font-semibold text-emerald-900 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Стандартное автоматическое правило:
            </p>
            <ul className="space-y-1.5 pl-5 list-disc text-emerald-800">
              <li>
                <strong>Центральный склад («Основной Склад Астана», ID 81)</strong>: виден клиенту по умолчанию.
              </li>
              <li>
                <strong>Свой персональный склад</strong>:{' '}
                {showroomId ? (
                  <span className="text-emerald-900 font-semibold">{showroomName} (виден клиенту)</span>
                ) : (
                  <span className="text-slate-600 italic">не назначен (клиент видит только центральный склад Астана)</span>
                )}
              </li>
              <li>
                <span className="text-slate-600">Все чужие партнерские склады других городов автоматически скрыты.</span>
              </li>
            </ul>
            <p className="text-[11px] text-emerald-700/80 pt-1">
              Чтобы скрыть склад Астана или персональный склад для этого клиента, выберите «Индивидуальная настройка».
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Переключайте видимость складов для данного клиента:
            </p>

            {/* Warehouse 1: Central Astana */}
            <div className="card p-3.5 flex items-center justify-between gap-3 border-slate-200">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${showCentral ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Основной Склад Астана (ID: 81)</p>
                  <p className="text-[11px] text-slate-500">Центральный склад компании для оптовых поставок</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCentral(v => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showCentral ? 'bg-brand-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    showCentral ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Warehouse 2: Own showroom */}
            <div className={`card p-3.5 flex items-center justify-between gap-3 border-slate-200 ${!showroomId ? 'opacity-60 bg-slate-50' : ''}`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${showShowroom && showroomId ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  <Boxes className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    {showroomName || 'Собственный склад шоурума'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {showroomId
                      ? `Персональный склад дилера (ID: ${showroomId})`
                      : 'У данного клиента нет закреплённого склада в ERP'}
                  </p>
                </div>
              </div>
              {showroomId ? (
                <button
                  type="button"
                  onClick={() => setShowShowroom(v => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    showShowroom ? 'bg-brand-600' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      showShowroom ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              ) : (
                <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-1 rounded">Не назначен</span>
              )}
            </div>
          </div>
        )}

        {/* Permission: Stock Summary & Reservations Bar */}
        <div className="card p-3.5 flex items-center justify-between gap-3 border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${showStockSummary ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}>
              <BarChart2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">
                Виджет сводки остатков и резервы
              </p>
              <p className="text-[11px] text-slate-500">
                Разрешить клиенту видеть общую сводку остатков (Свободно / Резерв / Отгрузка)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowStockSummary(v => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              showStockSummary ? 'bg-indigo-600' : 'bg-slate-200'
            }`}
            title="Включить или выключить виджет сводки остатков для этого клиента"
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                showStockSummary ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-100 pt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {mode === 'custom' && (
              <button
                type="button"
                onClick={handleResetToAuto}
                className="text-xs font-medium text-slate-500 hover:text-brand-700 hover:underline transition-colors cursor-pointer"
              >
                Сбросить на авто-режим
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {saved && (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1 animate-in fade-in">
                <Check className="h-4 w-4" /> Сохранено!
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="btn-primary text-xs px-4 py-2 cursor-pointer"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}

export default ClientWarehouseModal;
