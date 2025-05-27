import { logger } from './logger';
import { config } from './config';
import { prisma } from './prisma';
import { aiService } from './ai-service';
import { whopAPI } from './whop-api';
import { companyManager } from './company-manager';

interface HealthStatus {
  healthy: boolean;
  timestamp: string;
  version: string;
  services: {
    database: ServiceHealth;
    aiService: ServiceHealth;
    whopApi: ServiceHealth;
    companyManager: ServiceHealth;
    memory: ServiceHealth;
  };
  environment: {
    nodeEnv: string;
    hasRequiredEnvVars: boolean;
    missingEnvVars: string[];
  };
}

interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  responseTime?: number;
  details?: any;
}

class HealthChecker {
  private isRunning = false;
  private lastCheck?: HealthStatus;

  async checkHealth(): Promise<HealthStatus> {
    const startTime = Date.now();
    
    logger.info('Starting health check', { action: 'health_check_start' });

    const [database, aiServiceHealth, whopApiHealth, companyManagerHealth, memory] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkAIService(),
      this.checkWhopAPI(),
      this.checkCompanyManager(),
      this.checkMemoryUsage(),
    ]);

    const services = {
      database: this.extractResult(database),
      aiService: this.extractResult(aiServiceHealth),
      whopApi: this.extractResult(whopApiHealth),
      companyManager: this.extractResult(companyManagerHealth),
      memory: this.extractResult(memory),
    };

    const environment = this.checkEnvironment();
    
    const allHealthy = Object.values(services).every(service => service.status === 'healthy') && 
                      environment.hasRequiredEnvVars;

    const health: HealthStatus = {
      healthy: allHealthy,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      services,
      environment,
    };

    this.lastCheck = health;
    
    const totalTime = Date.now() - startTime;
    logger.info('Health check completed', {
      healthy: allHealthy,
      totalTime,
      action: 'health_check_complete',
    });

    // Log metrics for each service
    for (const [serviceName, serviceHealth] of Object.entries(services)) {
      await logger.logHealthCheck(serviceName, serviceHealth.status === 'healthy', {
        status: serviceHealth.status,
        responseTime: serviceHealth.responseTime,
      });
    }

    return health;
  }

  private extractResult(result: PromiseSettledResult<ServiceHealth>): ServiceHealth {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        status: 'unhealthy',
        message: `Health check failed: ${result.reason?.message || 'Unknown error'}`,
      };
    }
  }

  private async checkDatabase(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      // Simple query to check database connectivity
      await prisma.$queryRaw`SELECT 1 as test`;
      
      const responseTime = Date.now() - start;
      
      return {
        status: 'healthy',
        message: 'Database connection is working',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - start;
      
      logger.error('Database health check failed', error, {
        responseTime,
        action: 'database_health_failed',
      });
      
      return {
        status: 'unhealthy',
        message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime,
      };
    }
  }

  private async checkAIService(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const stats = aiService.getStats();
      const responseTime = Date.now() - start;
      
      // Check if there are too many queued requests
      const isHealthy = stats.activeRequests < 50; // Arbitrary threshold
      
      return {
        status: isHealthy ? 'healthy' : 'degraded',
        message: isHealthy ? 'AI service is operational' : 'AI service is under high load',
        responseTime,
        details: stats,
      };
    } catch (error) {
      const responseTime = Date.now() - start;
      
      return {
        status: 'unhealthy',
        message: `AI service check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime,
      };
    }
  }

  private async checkWhopAPI(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const stats = whopAPI.getStats();
      const responseTime = Date.now() - start;
      
      // Check if there are too many queued messages
      const isHealthy = stats.queuedMessages < 100; // Arbitrary threshold
      
      return {
        status: isHealthy ? 'healthy' : 'degraded',
        message: isHealthy ? 'Whop API service is operational' : 'Whop API service has high message queue',
        responseTime,
        details: stats,
      };
    } catch (error) {
      const responseTime = Date.now() - start;
      
      return {
        status: 'unhealthy',
        message: `Whop API check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime,
      };
    }
  }

  private async checkCompanyManager(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const stats = companyManager.getStats();
      const responseTime = Date.now() - start;
      
      return {
        status: 'healthy',
        message: 'Company manager is operational',
        responseTime,
        details: stats,
      };
    } catch (error) {
      const responseTime = Date.now() - start;
      
      return {
        status: 'unhealthy',
        message: `Company manager check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime,
      };
    }
  }

  private async checkMemoryUsage(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const memUsage = process.memoryUsage();
      const responseTime = Date.now() - start;
      
      // Convert to MB
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      const rssMB = Math.round(memUsage.rss / 1024 / 1024);
      
      // Alert if using more than 500MB heap
      const isHealthy = heapUsedMB < 500;
      
      return {
        status: isHealthy ? 'healthy' : 'degraded',
        message: isHealthy ? 'Memory usage is normal' : 'High memory usage detected',
        responseTime,
        details: {
          heapUsedMB,
          heapTotalMB,
          rssMB,
          external: Math.round(memUsage.external / 1024 / 1024),
        },
      };
    } catch (error) {
      const responseTime = Date.now() - start;
      
      return {
        status: 'unhealthy',
        message: `Memory check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime,
      };
    }
  }

  private checkEnvironment(): {
    nodeEnv: string;
    hasRequiredEnvVars: boolean;
    missingEnvVars: string[];
  } {
    const requiredEnvVars = [
      'DATABASE_URL',
      'WHOP_APP_API_KEY',
      'OPENROUTER_API_KEY',
    ];

    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

    return {
      nodeEnv: config.NODE_ENV,
      hasRequiredEnvVars: missingEnvVars.length === 0,
      missingEnvVars,
    };
  }

  getLastCheck(): HealthStatus | undefined {
    return this.lastCheck;
  }

  async startPeriodicHealthChecks(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Health checks already running', { action: 'health_check_already_running' });
      return;
    }

    this.isRunning = true;
    const intervalMs = config.HEALTH_CHECK_INTERVAL_MINUTES * 60 * 1000;

    logger.info('Starting periodic health checks', {
      intervalMinutes: config.HEALTH_CHECK_INTERVAL_MINUTES,
      action: 'health_check_started',
    });

    // Initial health check
    await this.checkHealth();

    // Set up periodic checks
    const interval = setInterval(async () => {
      try {
        await this.checkHealth();
      } catch (error) {
        logger.error('Periodic health check failed', error, {
          action: 'periodic_health_check_error',
        });
      }
    }, intervalMs);

    // Cleanup on process exit
    process.on('exit', () => {
      clearInterval(interval);
      this.isRunning = false;
    });

    process.on('SIGINT', () => {
      clearInterval(interval);
      this.isRunning = false;
    });

    process.on('SIGTERM', () => {
      clearInterval(interval);
      this.isRunning = false;
    });
  }

  stop(): void {
    this.isRunning = false;
    logger.info('Health checks stopped', { action: 'health_check_stopped' });
  }
}

export const healthChecker = new HealthChecker();
export type { HealthStatus, ServiceHealth }; 