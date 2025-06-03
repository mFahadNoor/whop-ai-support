/**
 * Shared Utilities and Configuration
 * 
 * This module provides essential utilities, configuration management, and helper functions
 * that are used throughout the AI bot application. It handles:
 * 
 * Key Features:
 * - Environment variable validation and type-safe configuration loading
 * - Structured logging with multiple levels and metadata support
 * - Utility functions for text processing, validation, and question detection
 * - TypeScript interfaces for consistent data structures
 * - Error handling and retry logic utilities
 * 
 * The configuration system automatically validates all required environment variables
 * and provides sensible defaults for optional ones. This ensures the bot fails fast
 * with clear error messages if misconfigured.
 */

import dotenv from 'dotenv';
dotenv.config();

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Represents a processed message from the WebSocket that needs a bot response
 * This is the standardized format used throughout the application
 */
export interface ProcessedMessage {
  entityId: string;        // Unique identifier for the message
  feedId: string;          // ID of the feed/channel where message was posted
  content: string;         // The actual message content
  user: {
    id: string;            // User ID from Whop
    username?: string;     // Display username
    name?: string;         // User's display name
  };
  experienceId: string;    // Whop experience (community) ID
  messageType: 'forumPost' | 'chatMessage'; // Type of message
  replyingToPostId?: string; // ID of the post this message is replying to
}

/**
 * Bot configuration settings stored in the database
 * These settings control how the bot behaves and responds
 */
export interface BotSettings {
  enabled: boolean;                    // Whether the bot is active
  knowledgeBase: string;              // Custom information about the community
  botPersonality?: string;            // Optional personality traits
  botLanguage?: string;               // Language for responses
  customInstructions: string;         // Additional instructions for AI
  presetQA: Array<{                   // Pre-configured question/answer pairs
    id: string;
    question: string;
    answer: string;
    enabled: boolean;
  }>;
  responseStyle: 'professional' | 'friendly' | 'casual' | 'technical' | 'custom';
  autoResponse: boolean;              // Whether to auto-respond to questions
  responseDelay: number;              // Delay before responding (in ms)
}

/**
 * Experience data structure from Whop WebSocket messages
 */
export interface ExperienceData {
  id: string;                         // Experience ID
  bot?: {
    id: string;                       // Bot ID if configured
  };
}

/**
 * WebSocket message structure from Whop
 * This represents the raw message format received from Whop's WebSocket
 */
export interface WebSocketMessage {
  experience?: ExperienceData;
  feedEntity?: {
    post?: {                          // Forum post message
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
    dmsPost?: {                       // Direct message
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

/**
 * Application configuration interface
 * 
 * This interface defines all the configuration options for the AI bot.
 * All values are loaded from environment variables with validation and defaults.
 * 
 * Configuration Categories:
 * - Environment: Runtime environment settings
 * - Database: PostgreSQL connection and logging
 * - Whop API: Integration with Whop platform
 * - OpenRouter AI: AI model configuration
 * - Rate Limiting: Request throttling settings
 * - Caching: Memory and response caching
 * - Performance: Retry logic and timing
 * - Security: Input validation and limits
 */
interface AppConfig {
  // Database
  DATABASE_URL: string;
  DIRECT_URL?: string;
  
  // AI Configuration
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;

  // Whop Configuration
  WHOP_API_KEY: string;
  WHOP_AGENT_USER_ID?: string;
  WHOP_APP_ID?: string;

  // Application Settings
  NODE_ENV: string;
  PORT: number;
  LOG_LEVEL: string;
  
  // Rate Limiting
  AI_RATE_LIMIT_PER_MINUTE: number;
  MESSAGE_RATE_LIMIT_PER_MINUTE: number;
  
  // Performance
  MAX_MEMORY_CACHE_SIZE: number;
  
  // Security & Validation
  MAX_MESSAGE_LENGTH: number;
  MAX_KNOWLEDGE_BASE_SIZE: number;
  MAX_AI_RESPONSE_TOKENS: number;

  // Optional Features
  ENABLE_DB_LOGGING: boolean;
}

// =============================================================================
// ENVIRONMENT VARIABLE HELPERS
// =============================================================================

/**
 * Gets a required environment variable, throws error if missing
 * @param key - Environment variable name
 * @returns The environment variable value
 * @throws Error if the variable is not set
 */
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Gets an optional environment variable with fallback
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The environment variable value or default
 */
function getOptionalEnv(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}

/**
 * Parses an environment variable as integer with fallback
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed integer value
 */
function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parses an environment variable as boolean with fallback
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Boolean value (true for 'true', false otherwise)
 */
function parseEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Loads and validates the complete application configuration
 * 
 * This function reads all environment variables, applies defaults,
 * validates required fields, and returns a typed configuration object.
 * 
 * @returns Complete application configuration
 * @throws Error if any required variables are missing or invalid
 */
function loadConfig(): AppConfig {
  try {
    const config: AppConfig = {
      // Environment
      NODE_ENV: getOptionalEnv('NODE_ENV', 'development'),
      PORT: parseEnvInt('PORT', 3000),
      LOG_LEVEL: getOptionalEnv('LOG_LEVEL', 'info'),
      
      // Database
      DATABASE_URL: getRequiredEnv('DATABASE_URL'),
      DIRECT_URL: getOptionalEnv('DIRECT_URL'),
      ENABLE_DB_LOGGING: parseEnvBool('ENABLE_DB_LOGGING', true),
      
      // Whop API
      WHOP_API_KEY: getRequiredEnv('WHOP_API_KEY'),
      WHOP_AGENT_USER_ID: getOptionalEnv('WHOP_AGENT_USER_ID'),
      WHOP_APP_ID: getOptionalEnv('WHOP_APP_ID'),
      
      // OpenRouter AI
      OPENROUTER_API_KEY: getRequiredEnv('OPENROUTER_API_KEY'),
      OPENROUTER_MODEL: getOptionalEnv('OPENROUTER_MODEL', 'google/gemini-2.0-flash-001'),
      
      // Rate Limiting
      AI_RATE_LIMIT_PER_MINUTE: parseEnvInt('AI_RATE_LIMIT_PER_MINUTE', 10),
      MESSAGE_RATE_LIMIT_PER_MINUTE: parseEnvInt('MESSAGE_RATE_LIMIT_PER_MINUTE', 30),
      
      // Performance
      MAX_MEMORY_CACHE_SIZE: parseEnvInt('MAX_MEMORY_CACHE_SIZE', 1000),
      
      // Security
      MAX_MESSAGE_LENGTH: parseEnvInt('MAX_MESSAGE_LENGTH', 2000),
      MAX_KNOWLEDGE_BASE_SIZE: parseEnvInt('MAX_KNOWLEDGE_BASE_SIZE', 1000000), // 1MB
      MAX_AI_RESPONSE_TOKENS: parseEnvInt('MAX_AI_RESPONSE_TOKENS', 1000),
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

function validateConfig(config: AppConfig): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate required fields
  if (!config.WHOP_API_KEY) {
    errors.push('WHOP_API_KEY is required');
  }
  
  if (!config.OPENROUTER_API_KEY) {
    errors.push('OPENROUTER_API_KEY is required');
  }
  
  if (!config.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }

  // Check optional but important fields
  if (!config.WHOP_AGENT_USER_ID) {
    warnings.push('WHOP_AGENT_USER_ID is not set - bot may not be able to send messages');
  }

  // Validate ranges
  if (config.AI_RATE_LIMIT_PER_MINUTE < 1 || config.AI_RATE_LIMIT_PER_MINUTE > 1000) {
    errors.push('AI_RATE_LIMIT_PER_MINUTE must be between 1 and 1000');
  }
  
  if (config.MESSAGE_RATE_LIMIT_PER_MINUTE < 1 || config.MESSAGE_RATE_LIMIT_PER_MINUTE > 1000) {
    errors.push('MESSAGE_RATE_LIMIT_PER_MINUTE must be between 1 and 1000');
  }
  
  if (config.MAX_MEMORY_CACHE_SIZE < 1 || config.MAX_MEMORY_CACHE_SIZE > 1000) {
    errors.push('MAX_MEMORY_CACHE_SIZE must be between 1 and 1000');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  if (warnings.length > 0) {
    console.warn(`⚠️  Configuration warnings:\n${warnings.join('\n')}`);
  }
}

export const config = loadConfig();

// =============================================================================
// LOGGING SYSTEM
// =============================================================================

/**
 * Represents a single log entry with metadata
 */
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  error?: Error;
  metadata?: Record<string, any>;
}

/**
 * Advanced logging system with level filtering and structured output
 * 
 * Features:
 * - Configurable log levels (debug, info, warn, error)
 * - Structured JSON logging in production
 * - Pretty console output in development
 * - Automatic error stack trace inclusion
 * - Metadata support for contextual information
 * 
 * Usage:
 * ```typescript
 * logger.info('Bot started', { botId: 'abc123' });
 * logger.error('Failed to process message', error, { messageId: 'xyz' });
 * ```
 */
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
 * Pauses execution for a specified number of milliseconds
 * 
 * @param ms - Number of milliseconds to sleep
 * @returns Promise that resolves after the delay
 * 
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes a function with exponential backoff retry logic
 * 
 * This utility automatically retries failed operations with increasing delays
 * between attempts. Useful for handling temporary network failures or rate limits.
 * 
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in milliseconds, doubles each retry (default: 1000)
 * @returns Promise with the function result
 * @throws The last error if all retries fail
 * 
 * @example
 * const result = await retry(
 *   () => fetch('/api/data'),
 *   3,  // Try up to 3 times
 *   500 // Start with 500ms delay
 * );
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
 * Validates and sanitizes string input
 * 
 * @param value - String to validate
 * @param fieldName - Name of the field for error messages
 * @param maxLength - Optional maximum length limit
 * @returns Trimmed and validated string
 * @throws Error if validation fails
 * 
 * @example
 * const username = validateString(input, 'username', 50);
 */
export function validateString(value: string, fieldName: string, maxLength?: number): string {
  if (!value || typeof value !== 'string') {
    throw new Error(`${fieldName} is required and must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }

  if (maxLength && trimmed.length > maxLength) {
    throw new Error(`${fieldName} cannot exceed ${maxLength} characters`);
  }

  return trimmed;
}

/**
 * Removes potentially harmful characters from text
 * 
 * This function sanitizes user input by removing or escaping characters
 * that could be used for injection attacks or cause display issues.
 * 
 * @param text - Text to sanitize
 * @returns Sanitized text safe for storage and display
 * 
 * @example
 * const safe = sanitizeText(userInput);
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/\x00/g, '') // Remove null bytes
    .trim();
}

/**
 * Truncates text to a maximum length with ellipsis
 * 
 * @param text - Text to truncate
 * @param maxLength - Maximum length including ellipsis
 * @returns Truncated text with '...' if needed
 * 
 * @example
 * const short = truncateText('Very long message...', 20);
 * // Returns: "Very long message..."
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Detects if text contains a question using heuristic analysis
 * 
 * This function uses multiple indicators to determine if text contains
 * a question, including question marks, question words, and sentence structure.
 * Made more strict to avoid false positives.
 * 
 * @param text - Text to analyze
 * @returns True if text appears to contain a question
 * 
 * @example
 * isQuestion("How do I join?") // Returns: true
 * isQuestion("Thanks for help") // Returns: false
 */
export function isQuestion(text: string): boolean {
  const normalizedText = text.toLowerCase().trim();
  
  // Must have question mark OR be a clear question pattern
  if (text.includes('?')) return true;
  
  // Very strict question word patterns - must start sentence
  const strictQuestionPatterns = [
    /^how (do|can|to|would|should)/,
    /^what (is|are|do|does|would|should|can)/,
    /^when (do|does|is|are|will|would|should|can)/,
    /^where (is|are|do|does|can|should)/,
    /^why (do|does|is|are|would|should|can)/,
    /^who (is|are|can|should|would)/,
    /^which (is|are|do|does|can|should|would)/,
    /^can (you|i|we|someone)/,
    /^could (you|i|we|someone)/,
    /^would (you|it|this|that)/,
    /^should (i|we|this|that)/,
    /^is (there|this|that|it)/,
    /^are (there|these|those|you)/,
    /^does (this|that|it|anyone)/,
    /^do (you|i|we|they)/,
    /^did (you|anyone|this|that)/,
    /^will (you|this|that|it)/,
    /^have (you|they|we)/,
    /^has (anyone|this|that)/
  ];
  
  return strictQuestionPatterns.some(pattern => pattern.test(normalizedText));
}

/**
 * Extracts key phrases from text for indexing and search
 * 
 * @param text - Text to analyze
 * @returns Array of key phrases
 * 
 * @example
 * const phrases = extractKeyPhrases("How to join Discord server?");
 * // Returns: ["join", "discord", "server"]
 */
export function extractKeyPhrases(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2); // Filter short words
  
  // Remove common stop words
  const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  return words.filter(word => !stopWords.includes(word));
} 