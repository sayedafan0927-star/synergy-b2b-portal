/**
 * Enterprise Message Queue Broker for Asynchronous Outbox Synchronization (T-35)
 * 
 * Decouples Outbox processing from synchronous HTTP lifecycles and Vercel execution timeouts.
 * Supports:
 * - Redis Reliable List Queue (LPUSH / RPOP)
 * - Upstash QStash Webhook Publisher (when QSTASH_TOKEN is present)
 * - In-Memory Fallback Queue for local development and offline environments
 */

import { getRedisClient, isRedisConfigured } from './redis';
import { logger } from './logger';

export interface QueuedOutboxMessage {
  orderId: string;
  orderDoc: string;
  correlationId?: string;
  enqueuedAt: number;
  attempts?: number;
}

const OUTBOX_QUEUE_KEY = 'outbox:queue:orders';
const inMemoryQueue: QueuedOutboxMessage[] = [];

/**
 * Enqueue an order into the dedicated message broker
 */
export async function enqueueOutboxOrder(msg: {
  orderId: string;
  orderDoc: string;
  correlationId?: string;
}): Promise<boolean> {
  const payload: QueuedOutboxMessage = {
    orderId: msg.orderId,
    orderDoc: msg.orderDoc,
    correlationId: msg.correlationId,
    enqueuedAt: Date.now(),
    attempts: 0,
  };

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.lpush(OUTBOX_QUEUE_KEY, JSON.stringify(payload));
      logger.info('[QueueBroker] Order enqueued to Redis outbox queue', {
        orderId: msg.orderId,
        orderDoc: msg.orderDoc,
      });

      // Optional QStash integration if QStash token is configured
      const qstashToken = process.env.QSTASH_TOKEN;
      const qstashUrl = process.env.QSTASH_URL || 'https://qstash.upstash.io/v2/publish';
      const appHost = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://b2b.synergy.kz';

      if (qstashToken) {
        fetch(`${qstashUrl}/${appHost}/api/outbox/sync`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${qstashToken}`,
            'Content-Type': 'application/json',
            'Upstash-Retries': '3',
            'Upstash-Timeout': '30s',
          },
          body: JSON.stringify({ source: 'queue_broker', orderId: msg.orderId }),
        }).catch(err => {
          logger.debug('[QueueBroker] QStash dispatch notice:', { error: (err as Error)?.message });
        });
      }

      return true;
    } catch (err) {
      logger.warn('[QueueBroker] Redis enqueue failed, falling back to memory queue:', err as Error);
    }
  }

  // In-memory queue fallback
  inMemoryQueue.push(payload);
  if (inMemoryQueue.length > 500) {
    inMemoryQueue.shift(); // Bound memory footprint
  }
  return true;
}

/**
 * Dequeue up to `limit` orders from the message broker
 */
export async function dequeueOutboxOrders(limit = 4): Promise<QueuedOutboxMessage[]> {
  const result: QueuedOutboxMessage[] = [];
  const redis = getRedisClient();

  if (redis) {
    try {
      for (let i = 0; i < limit; i++) {
        const raw = await redis.rpop(OUTBOX_QUEUE_KEY);
        if (!raw) break;
        try {
          const item = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (item && item.orderId) {
            result.push(item);
          }
        } catch {
          // ignore corrupted message
        }
      }
      return result;
    } catch (err) {
      logger.warn('[QueueBroker] Redis dequeue failed, checking memory queue:', err as Error);
    }
  }

  // Dequeue from memory fallback
  const count = Math.min(limit, inMemoryQueue.length);
  return inMemoryQueue.splice(0, count);
}

/**
 * Returns current broker queue metrics
 */
export async function getOutboxQueueStats(): Promise<{
  queueLength: number;
  isRedisActive: boolean;
}> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const len = await redis.llen(OUTBOX_QUEUE_KEY);
      return { queueLength: Number(len || 0), isRedisActive: true };
    } catch {
      return { queueLength: inMemoryQueue.length, isRedisActive: false };
    }
  }
  return { queueLength: inMemoryQueue.length, isRedisActive: false };
}
