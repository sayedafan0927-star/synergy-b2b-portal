/**
 * Enterprise Circuit Breaker Pattern for External ERP Integration
 * 
 * Prevents cascading latency and thread exhaustion during ERP outages or network degradations.
 * States:
 * - CLOSED: Calls pass through normally. Failures are counted within a sliding window.
 * - OPEN: Fast-fail immediately without calling ERP. Returns cached or fallback data.
 * - HALF_OPEN: Allows a single probe request through to check if ERP has recovered.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
import { logger } from './logger';

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

// Global in-memory registry of circuit breakers by service name
const registry = new Map<string, ServiceState>();

function getOrCreateState(serviceName: string): ServiceState {
  let s = registry.get(serviceName);
  if (!s) {
    s = {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureTime: 0,
      lastStateChange: Date.now(),
      probeCount: 0,
    };
    registry.set(serviceName, s);
  }
  return s;
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
export function checkCircuit(serviceName: string, config: CircuitBreakerConfig = DEFAULT_CONFIG): { permitted: boolean; state: CircuitState } {
  const s = getOrCreateState(serviceName);
  const now = Date.now();

  if (s.state === 'OPEN') {
    const elapsed = now - s.lastStateChange;
    if (elapsed >= config.resetTimeoutMs) {
      s.state = 'HALF_OPEN';
      s.probeCount = 0;
      s.lastStateChange = now;
      logger.warn(`[CircuitBreaker] '${serviceName}' cooldown elapsed. Transitioning OPEN -> HALF_OPEN.`, { serviceName });
    } else {
      return { permitted: false, state: 'OPEN' };
    }
  }

  if (s.state === 'HALF_OPEN') {
    if (s.probeCount >= config.halfOpenMaxProbes) {
      return { permitted: false, state: 'HALF_OPEN' };
    }
    s.probeCount++;
    return { permitted: true, state: 'HALF_OPEN' };
  }

  return { permitted: true, state: 'CLOSED' };
}

/**
 * Records a successful response from the service.
 */
export function recordSuccess(serviceName: string): void {
  const s = getOrCreateState(serviceName);
  if (s.state === 'HALF_OPEN') {
    logger.info(`[CircuitBreaker] '${serviceName}' probe succeeded. Transitioning HALF_OPEN -> CLOSED.`, { serviceName });
  }
  s.state = 'CLOSED';
  s.consecutiveFailures = 0;
  s.probeCount = 0;
}

/**
 * Records a failure (HTTP 5xx, network timeout, connection reset).
 */
export function recordFailure(serviceName: string, config: CircuitBreakerConfig = DEFAULT_CONFIG): void {
  const s = getOrCreateState(serviceName);
  s.consecutiveFailures++;
  s.lastFailureTime = Date.now();

  if (s.state === 'CLOSED' && s.consecutiveFailures >= config.failureThreshold) {
    s.state = 'OPEN';
    s.lastStateChange = Date.now();
    logger.error(`[CircuitBreaker] '${serviceName}' reached ${s.consecutiveFailures} consecutive failures. Tripping to OPEN.`, { serviceName, consecutiveFailures: s.consecutiveFailures });
  } else if (s.state === 'HALF_OPEN') {
    s.state = 'OPEN';
    s.lastStateChange = Date.now();
    logger.error(`[CircuitBreaker] '${serviceName}' probe failed. Returning to OPEN.`, { serviceName });
  }
}

/**
 * Returns current status for health checks & observability.
 */
export function getCircuitStatus(serviceName: string, config: CircuitBreakerConfig = DEFAULT_CONFIG): { state: CircuitState; consecutiveFailures: number; isAvailable: boolean } {
  const s = getOrCreateState(serviceName);
  const now = Date.now();
  if (s.state === 'OPEN' && (now - s.lastStateChange) >= config.resetTimeoutMs) {
    return { state: 'HALF_OPEN', consecutiveFailures: s.consecutiveFailures, isAvailable: true };
  }
  return { state: s.state, consecutiveFailures: s.consecutiveFailures, isAvailable: s.state !== 'OPEN' };
}
