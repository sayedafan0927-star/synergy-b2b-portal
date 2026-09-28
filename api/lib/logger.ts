/**
 * Enterprise Structured JSON Logger
 * Formats all application and integration logs into standard JSON Lines (JSONL)
 * Compatible with Datadog, AWS CloudWatch, Grafana Loki, and Vercel Log Drains.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  action?: string;
  source?: string;
  ip?: string;
  durationMs?: number;
  statusCode?: number;
  [key: string]: any;
}

export interface StructuredLogMessage {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  context?: Record<string, any>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
}

const SERVICE_NAME = 'synergy-b2b-portal';

class StructuredLogger {
  private formatLog(level: LogLevel, message: string, context?: LogContext, err?: Error): string {
    const logObj: StructuredLogMessage = {
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE_NAME,
      message,
      correlationId: context?.correlationId,
      context: context ? { ...context } : undefined,
    };

    if (err) {
      logObj.error = {
        name: err.name,
        message: err.message,
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
      };
    }

    // Remove correlationId from inner context to avoid redundancy
    if (logObj.context?.correlationId) {
      delete logObj.context.correlationId;
    }

    return JSON.stringify(logObj);
  }

  public debug(message: string, context?: LogContext): void {
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production') {
      console.debug(this.formatLog('debug', message, context));
    }
  }

  public info(message: string, context?: LogContext): void {
    console.info(this.formatLog('info', message, context));
  }

  public warn(message: string, context?: LogContext, err?: Error): void {
    console.warn(this.formatLog('warn', message, context, err));
  }

  public error(message: string, context?: LogContext, err?: Error): void {
    console.error(this.formatLog('error', message, context, err));
  }
}

export const logger = new StructuredLogger();
