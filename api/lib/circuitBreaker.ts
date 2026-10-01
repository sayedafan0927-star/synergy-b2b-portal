/**
 * Enterprise Circuit Breaker Pattern for External ERP Integration
 * 
 * Prevents cascading latency and thread exhaustion during ERP outages or network degradations.
 * Uses Upstash Redis / Vercel KV for persistent state across serverless function instances,
 * with graceful in-memory fallback when Redis is unavailable.
 * 
 * States:
 * - CLOSED: Calls pass through normally. Failures are counted within a sliding window.
 * - OPEN: Fast-fail immediately without calling ERP. Returns cached or fallback data.
 * - HALF_OPEN: Allows a single probe request through to check if ERP has recovered.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
import { logger } from './logger';
import { getRedisClient } from './redis';
import { sendSystemAlert } from './alerting';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening (default: 5)
  resetTimeoutMs: number;        // Time to stay OPEN before attempting HALF_OPEN (default: 30,000ms)
  halfOpenMaxProbes: number;     // Number of probe requests allowed in HALF_OPEN (default: 1)
}

interface ServiceState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
  lastStateChange: number;
  probeCount: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 1,
};

// In-memory fallback map for local development or when Redis is offline
const memoryRegistry = new Map<string, ServiceState>();

// L1 Fast In-Memory Cache (5s TTL) to eliminate Redis HTTP REST overhead on high RPS
interface L1CacheEntry {
  state: ServiceState;
  expiry: number;
}
const l1StateCache = new Map<string, L1CacheEntry>();
const L1_TTL_MS = 5000;

async function getServiceState(serviceName: string, bypassL1 = false): Promise<ServiceState> {
  const now = Date.now();
  if (!bypassL1) {
    const cachedL1 = l1StateCache.get(serviceName);
    if (cachedL1 && cachedL1.expiry > now) {
      return cachedL1.state;
    }
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `circuit:${serviceName}`;
      const state = (await redis.get(key)) as ServiceState | null;
      if (state) {
        l1StateCache.set(serviceName, { state, expiry: now + L1_TTL_MS });
        return state;
      }
    } catch (err) {
      console.warn(`[CircuitBreaker] Redis get failed for '${serviceName}', falling back to memory:`, err);
    }
  }

  let s = memoryRegistry.get(serviceName);
  if (!s) {
    s = {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureTime: 0,
      lastStateChange: Date.now(),
      probeCount: 0,
    };
    memoryRegistry.set(serviceName, s);
  }
  l1StateCache.set(serviceName, { state: s, expiry: now + L1_TTL_MS });
  return s;
}

async function saveServiceState(serviceName: string, state: ServiceState): Promise<void> {
  memoryRegistry.set(serviceName, state);
  l1StateCache.set(serviceName, { state, expiry: Date.now() + L1_TTL_MS });

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `circuit:${serviceName}`;
      // Expire after 10 minutes of inactivity
      await redis.set(key, state, { ex: 600 });
    } catch (err) {
      console.warn(`[CircuitBreaker] Redis save failed for '${serviceName}':`, err);
    }
  }
}

export class CircuitBreakerError extends Error {
  public serviceName: string;
  public remainingCooldownMs: number;

  constructor(serviceName: string, remainingCooldownMs: number) {
    super(`[Circuit Breaker] Service '${serviceName}' is temporarily unavailable (Circuit OPEN). Fast-failing.`);
    this.name = 'CircuitBreakerError';
    this.serviceName = serviceName;
    this.remainingCooldownMs = remainingCooldownMs;
  }
}

/**
 * Checks whether an external call to the service is permitted.
 * If the circuit is OPEN and reset timeout has elapsed, it transitions to HALF_OPEN.
 * If OPEN and cooldown not elapsed, throws CircuitBreakerError.
 */
export async function checkCircuit(
  serviceName: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): Promise<{ permitted: boolean; state: CircuitState }> {
  const s = await getServiceState(serviceName);
  const now = Date.now();

  if (s.state === 'OPEN') {
    const elapsed = now - s.lastStateChange;
    if (elapsed >= config.resetTimeoutMs) {
      s.state = 'HALF_OPEN';
      s.probeCount = 0;
      s.lastStateChange = now;
      logger.warn(`[CircuitBreaker] '${serviceName}' cooldown elapsed. Transitioning OPEN -> HALF_OPEN.`, { serviceName });
      await saveServiceState(serviceName, s);
    } else {
      return { permitted: false, state: 'OPEN' };
    }
  }

  if (s.state === 'HALF_OPEN') {
    if (s.probeCount >= config.halfOpenMaxProbes) {
      return { permitted: false, state: 'HALF_OPEN' };
    }
    s.probeCount++;
    await saveServiceState(serviceName, s);
    return { permitted: true, state: 'HALF_OPEN' };
  }

  return { permitted: true, state: 'CLOSED' };
}

/**
 * Records a successful response from the service.
 */
export async function recordSuccess(serviceName: string): Promise<void> {
  const s = await getServiceState(serviceName);
  if (s.state === 'HALF_OPEN') {
    logger.info(`[CircuitBreaker] '${serviceName}' probe succeeded. Transitioning HALF_OPEN -> CLOSED.`, { serviceName });
  }
  s.state = 'CLOSED';
  s.consecutiveFailures = 0;
  s.probeCount = 0;
  await saveServiceState(serviceName, s);
}

/**
 * Records a failure (HTTP 5xx, network timeout, connection reset).
 */
export async function recordFailure(
  serviceName: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): Promise<void> {
  const s = await getServiceState(serviceName, true);
  s.consecutiveFailures++;
  s.lastFailureTime = Date.now();

  if (s.state === 'CLOSED' && s.consecutiveFailures >= config.failureThreshold) {
    s.state = 'OPEN';
    s.lastStateChange = Date.now();
    logger.error(`[CircuitBreaker] '${serviceName}' reached ${s.consecutiveFailures} consecutive failures. Tripping to OPEN.`, {
      serviceName,
      consecutiveFailures: s.consecutiveFailures,
    });
    sendSystemAlert({
      level: 'CRITICAL',
      title: `Circuit Breaker Tripped to OPEN ('${serviceName}')`,
      description: `Зафиксировано ${s.consecutiveFailures} последовательных сбоев ERP. Запросы переведены в режим автономного буфера и кэша.`,
      metadata: { serviceName, consecutiveFailures: s.consecutiveFailures, resetTimeoutMs: config.resetTimeoutMs },
    }).catch(() => {});
  } else if (s.state === 'HALF_OPEN') {
    s.state = 'OPEN';
    s.lastStateChange = Date.now();
    logger.error(`[CircuitBreaker] '${serviceName}' probe failed. Returning to OPEN.`, { serviceName });
    sendSystemAlert({
      level: 'WARNING',
      title: `Circuit Breaker Probe Failed ('${serviceName}')`,
      description: `Пробный запрос к ERP не удался. Контур остается в состоянии OPEN.`,
      metadata: { serviceName },
    }).catch(() => {});
  }

  await saveServiceState(serviceName, s);
}

/**
 * Returns current status for health checks & observability.
 */
export async function getCircuitStatus(
  serviceName: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): Promise<{ state: CircuitState; consecutiveFailures: number; isAvailable: boolean }> {
  const s = await getServiceState(serviceName);
  const now = Date.now();
  if (s.state === 'OPEN' && now - s.lastStateChange >= config.resetTimeoutMs) {
    return { state: 'HALF_OPEN', consecutiveFailures: s.consecutiveFailures, isAvailable: true };
  }
  return { state: s.state, consecutiveFailures: s.consecutiveFailures, isAvailable: s.state !== 'OPEN' };
}
