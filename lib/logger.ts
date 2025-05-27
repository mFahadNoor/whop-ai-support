import { prisma } from './prisma';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  companyId?: string;
  experienceId?: string;
  feedId?: string;
  userId?: string;
  action?: string;
  duration?: number;
  [key: string]: any;
}

class Logger {
  private isDev = process.env.NODE_ENV !== 'production';
  private enableDbLogging = process.env.ENABLE_DB_LOGGING === 'true';

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` | ${JSON.stringify(context)}` : '';
    return `[${timestamp}] ${level}: ${message}${contextStr}`;
  }

  private async saveToDatabase(level: LogLevel, message: string, stack?: string, context?: LogContext) {
    if (!this.enableDbLogging) return;
    
    try {
      await prisma.errorLog.create({
        data: {
          level,
          message,
          stack,
          context: context || {},
          companyId: context?.companyId,
        },
      });
    } catch (error) {
      // Fallback to console if DB logging fails
      console.error('Failed to save log to database:', error);
    }
  }

  debug(message: string, context?: LogContext) {
    if (this.isDev) {
      console.log(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message: string, context?: LogContext) {
    console.log(this.formatMessage('INFO', message, context));
    
    if (context?.companyId || context?.action) {
      this.saveToDatabase('INFO', message, undefined, context);
    }
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatMessage('WARN', message, context));
    this.saveToDatabase('WARN', message, undefined, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const stack = error instanceof Error ? error.stack : String(error);
    console.error(this.formatMessage('ERROR', message, context));
    
    if (stack) {
      console.error('Stack trace:', stack);
    }

    this.saveToDatabase('ERROR', message, stack, context);
  }

  // Metric logging for production monitoring
  async logMetric(metricName: string, value: number, tags?: Record<string, any>) {
    if (!this.enableDbLogging) return;

    try {
      await prisma.systemMetric.create({
        data: {
          metricName,
          metricValue: value,
          tags: tags || {},
        },
      });
    } catch (error) {
      console.error('Failed to log metric:', error);
    }
  }

  // Performance monitoring
  async withTiming<T>(operation: string, fn: () => Promise<T>, context?: LogContext): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      
      this.info(`Operation completed: ${operation}`, { 
        ...context, 
        duration,
        action: operation 
      });
      
      await this.logMetric(`operation.${operation}.duration`, duration, context);
      await this.logMetric(`operation.${operation}.success`, 1, context);
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      
      this.error(`Operation failed: ${operation}`, error, { 
        ...context, 
        duration,
        action: operation 
      });
      
      await this.logMetric(`operation.${operation}.duration`, duration, context);
      await this.logMetric(`operation.${operation}.error`, 1, context);
      
      throw error;
    }
  }

  // Health check logging
  async logHealthCheck(service: string, healthy: boolean, details?: any) {
    await this.logMetric(`health.${service}`, healthy ? 1 : 0, details);
    
    if (!healthy) {
      this.error(`Health check failed for ${service}`, undefined, { 
        service, 
        details,
        action: 'health_check' 
      });
    }
  }
}

export const logger = new Logger(); 