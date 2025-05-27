import { logger } from './logger';

interface Config {
  // Environment
  NODE_ENV: string;
  
  // Database
  DATABASE_URL: string;
  DIRECT_URL?: string;
  ENABLE_DB_LOGGING: boolean;
  
  // Whop API
  WHOP_APP_API_KEY: string;
  WHOP_AGENT_USER_ID?: string;
  WHOP_WEBHOOK_SECRET?: string;
  
  // OpenRouter AI
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  
  // Rate Limiting
  AI_RATE_LIMIT_PER_MINUTE: number;
  MESSAGE_RATE_LIMIT_PER_MINUTE: number;
  
  // Caching
  CACHE_TTL_MINUTES: number;
  MAX_MEMORY_CACHE_SIZE: number;
  
  // Performance
  MAX_RETRIES: number;
  RETRY_DELAY_MS: number;
  WEBSOCKET_RECONNECT_DELAY_MS: number;
  MAINTENANCE_INTERVAL_MINUTES: number;
  
  // Security
  MAX_MESSAGE_LENGTH: number;
  MAX_KNOWLEDGE_BASE_SIZE: number;
  
  // Monitoring
  HEALTH_CHECK_INTERVAL_MINUTES: number;
  METRICS_RETENTION_DAYS: number;
}

function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    logger.warn(`Invalid integer value for ${key}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  
  return parsed;
}

function parseEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  return value.toLowerCase() === 'true';
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getOptionalEnv(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

// Load and validate configuration
function loadConfig(): Config {
  try {
    const config: Config = {
      // Environment
      NODE_ENV: getOptionalEnv('NODE_ENV', 'development'),
      
      // Database
      DATABASE_URL: getRequiredEnv('DATABASE_URL'),
      DIRECT_URL: getOptionalEnv('DIRECT_URL'),
      ENABLE_DB_LOGGING: parseEnvBool('ENABLE_DB_LOGGING', true),
      
      // Whop API
      WHOP_APP_API_KEY: getRequiredEnv('WHOP_APP_API_KEY'),
      WHOP_AGENT_USER_ID: getOptionalEnv('WHOP_AGENT_USER_ID'),
      WHOP_WEBHOOK_SECRET: getOptionalEnv('WHOP_WEBHOOK_SECRET'),
      
      // OpenRouter AI
      OPENROUTER_API_KEY: getRequiredEnv('OPENROUTER_API_KEY'),
      OPENROUTER_MODEL: getOptionalEnv('OPENROUTER_MODEL', 'google/gemini-2.0-flash-001'),
      
      // Rate Limiting
      AI_RATE_LIMIT_PER_MINUTE: parseEnvInt('AI_RATE_LIMIT_PER_MINUTE', 10),
      MESSAGE_RATE_LIMIT_PER_MINUTE: parseEnvInt('MESSAGE_RATE_LIMIT_PER_MINUTE', 30),
      
      // Caching
      CACHE_TTL_MINUTES: parseEnvInt('CACHE_TTL_MINUTES', 5),
      MAX_MEMORY_CACHE_SIZE: parseEnvInt('MAX_MEMORY_CACHE_SIZE', 1000),
      
      // Performance
      MAX_RETRIES: parseEnvInt('MAX_RETRIES', 3),
      RETRY_DELAY_MS: parseEnvInt('RETRY_DELAY_MS', 1000),
      WEBSOCKET_RECONNECT_DELAY_MS: parseEnvInt('WEBSOCKET_RECONNECT_DELAY_MS', 5000),
      MAINTENANCE_INTERVAL_MINUTES: parseEnvInt('MAINTENANCE_INTERVAL_MINUTES', 10),
      
      // Security
      MAX_MESSAGE_LENGTH: parseEnvInt('MAX_MESSAGE_LENGTH', 2000),
      MAX_KNOWLEDGE_BASE_SIZE: parseEnvInt('MAX_KNOWLEDGE_BASE_SIZE', 1000000), // 1MB
      
      // Monitoring
      HEALTH_CHECK_INTERVAL_MINUTES: parseEnvInt('HEALTH_CHECK_INTERVAL_MINUTES', 5),
      METRICS_RETENTION_DAYS: parseEnvInt('METRICS_RETENTION_DAYS', 30),
    };

    // Validate configuration
    validateConfig(config);
    
    logger.info('Configuration loaded successfully', {
      action: 'config_load',
      environment: config.NODE_ENV,
      hasWhopKey: !!config.WHOP_APP_API_KEY,
      hasOpenRouterKey: !!config.OPENROUTER_API_KEY,
      dbLoggingEnabled: config.ENABLE_DB_LOGGING,
    });
    
    return config;
  } catch (error) {
    logger.error('Failed to load configuration', error);
    throw error;
  }
}

function validateConfig(config: Config): void {
  const errors: string[] = [];

  // Validate required fields
  if (!config.WHOP_APP_API_KEY) {
    errors.push('WHOP_APP_API_KEY is required');
  }
  
  if (!config.OPENROUTER_API_KEY) {
    errors.push('OPENROUTER_API_KEY is required');
  }
  
  if (!config.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }

  // Validate ranges
  if (config.AI_RATE_LIMIT_PER_MINUTE < 1 || config.AI_RATE_LIMIT_PER_MINUTE > 1000) {
    errors.push('AI_RATE_LIMIT_PER_MINUTE must be between 1 and 1000');
  }
  
  if (config.MESSAGE_RATE_LIMIT_PER_MINUTE < 1 || config.MESSAGE_RATE_LIMIT_PER_MINUTE > 1000) {
    errors.push('MESSAGE_RATE_LIMIT_PER_MINUTE must be between 1 and 1000');
  }
  
  if (config.CACHE_TTL_MINUTES < 1 || config.CACHE_TTL_MINUTES > 1440) {
    errors.push('CACHE_TTL_MINUTES must be between 1 and 1440 (24 hours)');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

// Export singleton configuration
export const config = loadConfig();

// Export utility functions for testing
export { loadConfig, validateConfig }; 