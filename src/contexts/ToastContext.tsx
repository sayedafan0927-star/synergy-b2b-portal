import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { Portal } from '@/components/common/Portal';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  success: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
  warning: <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />,
  error: <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />,
  info: <Info className="h-5 w-5 text-brand-600 shrink-0" />,
};

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'bg-white border-emerald-200 text-slate-800 shadow-emerald-500/10',
  warning: 'bg-white border-amber-200 text-slate-800 shadow-amber-500/10',
  error: 'bg-white border-rose-200 text-slate-800 shadow-rose-500/10',
  info: 'bg-white border-brand-200 text-slate-800 shadow-brand-500/10',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duration = toast.duration ?? 5000;

    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);

    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }
    return id;
  }, [dismissToast]);

  const success = useCallback((message: string, title?: string) => {
    return showToast({ type: 'success', message, title });
  }, [showToast]);

  const info = useCallback((message: string, title?: string) => {
    return showToast({ type: 'info', message, title });
  }, [showToast]);

  const warning = useCallback((message: string, title?: string) => {
    return showToast({ type: 'warning', message, title });
  }, [showToast]);

  const error = useCallback((message: string, title?: string) => {
    return showToast({ type: 'error', message, title });
  }, [showToast]);

  const value = useMemo(() => ({
    showToast,
    dismissToast,
    success,
    info,
    warning,
    error,
  }), [showToast, dismissToast, success, info, warning, error]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Portal>
        <div
          aria-live="assertive"
          className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="alert"
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg transition-all transform animate-in slide-in-from-top-2 duration-200 ${TOAST_STYLES[t.type]}`}
            >
              {TOAST_ICONS[t.type]}
              <div className="flex-1 min-w-0">
                {t.title && <h4 className="text-xs font-bold text-slate-900 leading-tight">{t.title}</h4>}
                <p className="text-xs text-slate-600 mt-0.5 leading-snug break-words">{t.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-0.5 rounded cursor-pointer"
                aria-label="Закрыть уведомление"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
