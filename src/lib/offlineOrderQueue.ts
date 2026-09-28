import { submitOrderToErp, type CreateOrderPayload, type SplitSubOrder } from './erpApi';

export interface QueuedOfflineOrder {
  id: string;
  createdAt: string;
  payload: CreateOrderPayload;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retries: number;
  lastError?: string;
  docNumber?: string;
  splitOrders?: SplitSubOrder[];
}

const STORAGE_KEY = 'synergy:offline_order_queue';
const EVENT_KEY = 'synergy:offline-queue-updated';

/**
 * Returns all queued offline orders from localStorage
 */
export function getQueuedOfflineOrders(): QueuedOfflineOrder[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('[OfflineQueue] Failed to parse queue from localStorage:', err);
    return [];
  }
}

function saveQueue(list: QueuedOfflineOrder[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: list }));
  } catch (err) {
    console.error('[OfflineQueue] Failed to save queue to localStorage:', err);
  }
}

/**
 * Add a new order payload to the offline sync queue
 */
export function enqueueOfflineOrder(payload: CreateOrderPayload): QueuedOfflineOrder {
  const queue = getQueuedOfflineOrders();
  const id = `OFFLINE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const entry: QueuedOfflineOrder = {
    id,
    createdAt: new Date().toISOString(),
    payload,
    status: 'pending',
    retries: 0,
  };

  queue.push(entry);
  saveQueue(queue);
  console.log(`[OfflineQueue] Enqueued order ${id} for offline sync.`);
  return entry;
}

/**
 * Remove an order from the queue
 */
export function removeQueuedOrder(id: string): void {
  const queue = getQueuedOfflineOrders().filter(o => o.id !== id);
  saveQueue(queue);
}

/**
 * Clear synced orders from the queue
 */
export function clearCompletedOrders(): void {
  const queue = getQueuedOfflineOrders().filter(o => o.status !== 'synced');
  saveQueue(queue);
}

/**
 * Subscribe to offline queue changes
 */
export function onOfflineQueueChange(callback: (orders: QueuedOfflineOrder[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = () => {
    callback(getQueuedOfflineOrders());
  };

  window.addEventListener(EVENT_KEY, handler);
  window.addEventListener('storage', handler);

  return () => {
    window.removeEventListener(EVENT_KEY, handler);
    window.removeEventListener('storage', handler);
  };
}

let isProcessing = false;

/**
 * Process all pending offline orders and sync them with ERP
 */
export async function processOfflineOrderQueue(): Promise<{ synced: number; failed: number }> {
  if (isProcessing) {
    return { synced: 0, failed: 0 };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    console.log('[OfflineQueue] Device is offline. Skipping queue flush.');
    return { synced: 0, failed: 0 };
  }

  const queue = getQueuedOfflineOrders();
  const pending = queue.filter(o => o.status === 'pending' || o.status === 'failed');

  if (pending.length === 0) {
    return { synced: 0, failed: 0 };
  }

  isProcessing = true;
  let synced = 0;
  let failed = 0;

  console.log(`[OfflineQueue] Processing ${pending.length} queued offline orders...`);

  for (const order of pending) {
    // Update status to syncing
    order.status = 'syncing';
    saveQueue(queue);

    try {
      const res = await submitOrderToErp(order.payload);

      if (res.success && (res.order?.doc_number || res.split_orders?.length)) {
        order.status = 'synced';
        order.docNumber = res.order?.doc_number || res.split_orders?.[0]?.doc_number;
        order.splitOrders = res.split_orders || res.order?.split_orders;
        delete order.lastError;
        synced++;
        console.log(`[OfflineQueue] Successfully synced order ${order.id} -> ${order.docNumber}`);
      } else {
        throw new Error(res.error || 'ERP rejected order sync');
      }
    } catch (err: any) {
      order.status = 'failed';
      order.retries = (order.retries || 0) + 1;
      order.lastError = err?.message || 'Network error during sync';
      failed++;
      console.warn(`[OfflineQueue] Failed to sync order ${order.id} (attempt ${order.retries}):`, order.lastError);
    }

    saveQueue(queue);
  }

  isProcessing = false;

  // Cleanup synced orders older than 5 minutes
  setTimeout(() => {
    clearCompletedOrders();
  }, 300000);

  return { synced, failed };
}

/**
 * Initializes automatic background synchronization when online
 */
export function initOfflineQueueAutoSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleOnline = () => {
    console.log('[OfflineQueue] Network connection restored. Triggering offline queue sync...');
    processOfflineOrderQueue().catch(err => console.error('[OfflineQueue] Auto-sync error:', err));
  };

  window.addEventListener('online', handleOnline);

  // If already online at startup, check for any pending orders
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    const queue = getQueuedOfflineOrders();
    if (queue.some(o => o.status === 'pending')) {
      setTimeout(() => {
        processOfflineOrderQueue().catch(err => console.error('[OfflineQueue] Startup sync error:', err));
      }, 3000);
    }
  }

  return () => {
    window.removeEventListener('online', handleOnline);
  };
}
