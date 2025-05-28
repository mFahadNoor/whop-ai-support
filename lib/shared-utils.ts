import dotenv from 'dotenv';
dotenv.config();

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

export interface ProcessedMessage {
  entityId: string;
  feedId: string;
  content: string;
  user: {
    id: string;
    username?: string;
    name?: string;
  };
  experienceId: string;
  messageType: 'forumPost' | 'chatMessage';
}

export interface BotSettings {
  enabled: boolean;
  knowledgeBase: string;
  botPersonality?: string;
  botLanguage?: string;
  customInstructions: string;
  presetQA: Array<{
    id: string;
    question: string;
    answer: string;
    enabled: boolean;
  }>;
  responseStyle: 'professional' | 'friendly' | 'casual' | 'technical' | 'custom';
  autoResponse: boolean;
  responseDelay: number;
  presetQuestions?: string[];
  presetAnswers?: string[];
}

export interface ExperienceData {
  id: string;
  bot?: {
    id: string;
  };
}

export interface WebSocketMessage {
  experience?: ExperienceData;
  feedEntity?: {
    post?: {
      entityId: string;
      feedId: string;
      content?: string;
      message?: string;
      experienceId: string;
      user?: {
        id: string;
        username?: string;
        name?: string;
      };
    };
    dmsPost?: {
      entityId: string;
      feedId: string;
      content?: string;
      message?: string;
      experienceId: string;
      user?: {
        id: string;
        username?: string;
        name?: string;
      };
    };
  };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface Config {
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
}

// Helper functions for environment variable parsing
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getOptionalEnv(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}

function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
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
    };

    // Validate configuration
    validateConfig(config);
    
    // Log success without using logger to avoid circular dependencies
    console.log('✅ Configuration loaded successfully');
    
    return config;
  } catch (error) {
    console.error('Failed to load configuration:', error);
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

export const config = loadConfig();

// =============================================================================
// LOGGING
// =============================================================================

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  error?: Error;
  metadata?: Record<string, any>;
}

class Logger {
  private logLevel: string;

  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const targetLevelIndex = levels.indexOf(level);
    return targetLevelIndex >= currentLevelIndex;
  }

  private formatLog(entry: LogEntry): string {
    const { timestamp, level, message, error, metadata } = entry;
    let logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    if (metadata && Object.keys(metadata).length > 0) {
      logMessage += `\nMetadata: ${JSON.stringify(metadata, null, 2)}`;
    }
    
    if (error) {
      logMessage += `\nError: ${error.message}\nStack: ${error.stack}`;
    }
    
    return logMessage;
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, error?: Error, metadata?: Record<string, any>) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      error,
      metadata
    };

    const formattedLog = this.formatLog(entry);
    
    if (level === 'error') {
      console.error(formattedLog);
    } else if (level === 'warn') {
      console.warn(formattedLog);
    } else {
      console.log(formattedLog);
    }

    // Skip database logging to avoid circular dependencies
    // Database logging will be handled by data-manager directly when needed
  }

  debug(message: string, metadata?: Record<string, any>) {
    this.log('debug', message, undefined, metadata);
  }

  info(message: string, metadata?: Record<string, any>) {
    this.log('info', message, undefined, metadata);
  }

  warn(message: string, metadata?: Record<string, any>) {
    this.log('warn', message, undefined, metadata);
  }

  error(message: string, error?: Error, metadata?: Record<string, any>) {
    this.log('error', message, error, metadata);
  }
}

export const logger = new Logger();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      
      // Use console.log instead of logger to avoid circular dependencies
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`Retry attempt ${attempt + 1}/${maxRetries + 1} failed, waiting ${delay}ms: ${lastError.message}`);
      }
      
      await sleep(delay);
    }
  }
  
  throw lastError!;
}

/**
 * Validate that a string is not empty and within length limits
 */
export function validateString(value: string, fieldName: string, maxLength?: number): string {
  if (!value || typeof value !== 'string') {
    throw new Error(`${fieldName} is required and must be a string`);
  }
  
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  
  if (maxLength && value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or less`);
  }
  
  return value.trim();
}

/**
 * Sanitize text for safe output
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
    .trim();
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Check if a string contains question indicators
 */
export function isQuestion(text: string): boolean {
  const questionIndicators = [
    '?',
    'how', 'what', 'when', 'where', 'why', 'who', 'which',
    'can', 'could', 'would', 'should', 'will',
    'is', 'are', 'was', 'were', 'do', 'does', 'did',
    'help', 'need', 'problem', 'issue', 'error'
  ];
  
  const lowerText = text.toLowerCase();
  return questionIndicators.some(indicator => lowerText.includes(indicator));
}

/**
 * Extract key phrases from text for better matching
 */
export function extractKeyPhrases(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .slice(0, 10); // Limit to 10 key phrases
} 