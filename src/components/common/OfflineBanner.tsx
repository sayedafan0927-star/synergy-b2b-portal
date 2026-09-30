import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/registerServiceWorker';

export function OfflineBanner() {
  const isOnline = useNetworkStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[99999] flex w-full items-center justify-center gap-2 border-b border-amber-400 bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white shadow-md transition-all duration-300 animate-in slide-in-from-top-1"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white"></span>
      </span>
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate sm:whitespace-normal">
        Офлайн-режим: просмотр сохраненных остатков, заказы будут отправлены при подключении
      </span>
    </div>
  );
}

export default OfflineBanner;
