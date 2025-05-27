import { config } from './config';
import { logger } from './logger';

// Input sanitization and validation utilities

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ValidationResult<T> {
  isValid: boolean;
  data?: T;
  errors: string[];
}

/**
 * Validate and sanitize company ID
 */
export function validateCompanyId(companyId: unknown): ValidationResult<string> {
  const errors: string[] = [];

  if (typeof companyId !== 'string') {
    errors.push('Company ID must be a string');
    return { isValid: false, errors };
  }

  if (!companyId.trim()) {
    errors.push('Company ID cannot be empty');
    return { isValid: false, errors };
  }

  // Basic format validation (adjust pattern as needed)
  const companyIdPattern = /^[a-zA-Z0-9_-]{1,255}$/;
  if (!companyIdPattern.test(companyId)) {
    errors.push('Company ID contains invalid characters');
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: companyId.trim(),
    errors: [],
  };
}

/**
 * Validate and sanitize message content
 */
export function validateMessage(message: unknown): ValidationResult<string> {
  const errors: string[] = [];

  if (typeof message !== 'string') {
    errors.push('Message must be a string');
    return { isValid: false, errors };
  }

  if (!message.trim()) {
    errors.push('Message cannot be empty');
    return { isValid: false, errors };
  }

  if (message.length > config.MAX_MESSAGE_LENGTH) {
    errors.push(`Message too long (max ${config.MAX_MESSAGE_LENGTH} characters)`);
    return { isValid: false, errors };
  }

  // Basic content sanitization
  const sanitized = message
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .trim();

  if (!sanitized) {
    errors.push('Message contains only invalid characters');
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: sanitized,
    errors: [],
  };
}

/**
 * Validate knowledge base content
 */
export function validateKnowledgeBase(knowledgeBase: unknown): ValidationResult<string> {
  const errors: string[] = [];

  if (typeof knowledgeBase !== 'string') {
    errors.push('Knowledge base must be a string');
    return { isValid: false, errors };
  }

  // Allow empty knowledge base
  if (knowledgeBase === '') {
    return {
      isValid: true,
      data: '',
      errors: [],
    };
  }

  if (knowledgeBase.length > config.MAX_KNOWLEDGE_BASE_SIZE) {
    errors.push(`Knowledge base too large (max ${config.MAX_KNOWLEDGE_BASE_SIZE} characters)`);
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: knowledgeBase,
    errors: [],
  };
}

/**
 * Validate bot settings object
 */
export function validateBotSettings(settings: unknown): ValidationResult<any> {
  const errors: string[] = [];

  if (!settings || typeof settings !== 'object') {
    errors.push('Settings must be an object');
    return { isValid: false, errors };
  }

  const settingsObj = settings as any;

  // Validate enabled flag
  if (settingsObj.enabled !== undefined && typeof settingsObj.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  // Validate knowledge base if provided
  if (settingsObj.knowledgeBase !== undefined) {
    const kbValidation = validateKnowledgeBase(settingsObj.knowledgeBase);
    if (!kbValidation.isValid) {
      errors.push(...kbValidation.errors.map(err => `knowledgeBase: ${err}`));
    }
  }

  // Validate response style
  const validResponseStyles = ['professional', 'friendly', 'casual', 'technical', 'custom'];
  if (settingsObj.responseStyle && !validResponseStyles.includes(settingsObj.responseStyle)) {
    errors.push(`responseStyle must be one of: ${validResponseStyles.join(', ')}`);
  }

  // Validate response delay
  if (settingsObj.responseDelay !== undefined) {
    const delay = settingsObj.responseDelay;
    if (typeof delay !== 'number' || delay < 0 || delay > 30) {
      errors.push('responseDelay must be a number between 0 and 30 seconds');
    }
  }

  // Validate custom instructions length
  if (settingsObj.customInstructions && typeof settingsObj.customInstructions === 'string') {
    if (settingsObj.customInstructions.length > 2000) {
      errors.push('customInstructions too long (max 2000 characters)');
    }
  }

  // Validate presetQA array
  if (settingsObj.presetQA !== undefined) {
    if (!Array.isArray(settingsObj.presetQA)) {
      errors.push('presetQA must be an array');
    } else if (settingsObj.presetQA.length > 50) {
      errors.push('presetQA array too large (max 50 items)');
    } else {
      settingsObj.presetQA.forEach((qa: any, index: number) => {
        if (!qa || typeof qa !== 'object') {
          errors.push(`presetQA[${index}] must be an object`);
        } else {
          if (!qa.id || typeof qa.id !== 'string') {
            errors.push(`presetQA[${index}].id is required and must be a string`);
          }
          if (!qa.question || typeof qa.question !== 'string' || qa.question.length > 500) {
            errors.push(`presetQA[${index}].question is required and must be a string (max 500 chars)`);
          }
          if (!qa.answer || typeof qa.answer !== 'string' || qa.answer.length > 2000) {
            errors.push(`presetQA[${index}].answer is required and must be a string (max 2000 chars)`);
          }
          if (qa.enabled !== undefined && typeof qa.enabled !== 'boolean') {
            errors.push(`presetQA[${index}].enabled must be a boolean`);
          }
        }
      });
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: settingsObj,
    errors: [],
  };
}

/**
 * Validate feed ID format
 */
export function validateFeedId(feedId: unknown): ValidationResult<string> {
  const errors: string[] = [];

  if (typeof feedId !== 'string') {
    errors.push('Feed ID must be a string');
    return { isValid: false, errors };
  }

  if (!feedId.trim()) {
    errors.push('Feed ID cannot be empty');
    return { isValid: false, errors };
  }

  // Basic format validation for Whop feed IDs
  const feedIdPattern = /^(chat_feed_|forum_feed_|dms_feed_)[a-zA-Z0-9_-]+$/;
  if (!feedIdPattern.test(feedId)) {
    errors.push('Invalid feed ID format');
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: feedId.trim(),
    errors: [],
  };
}

/**
 * Rate limiting validation helper
 */
export function validateRateLimit(
  identifier: string,
  action: string,
  maxPerWindow: number = 10,
  windowMs: number = 60000
): boolean {
  try {
    // This is a simple in-memory check
    // In production, you might want to use Redis or similar
    const now = Date.now();
    const key = `${action}:${identifier}`;
    
    // For now, just log rate limit checks
    logger.debug('Rate limit check', {
      identifier,
      action,
      key,
    });
    
    return true; // Simplified for now
  } catch (error) {
    logger.error('Rate limit validation error', error, {
      identifier,
      action: 'rate_limit_validation_error',
    });
    return false;
  }
}

/**
 * General purpose data sanitizer
 */
export function sanitizeObject(obj: any, maxDepth: number = 10): any {
  if (maxDepth <= 0) {
    return '[Max depth exceeded]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return obj.slice(0, 1000); // Limit string length
  }

  if (typeof obj === 'number') {
    return isFinite(obj) ? obj : 0;
  }

  if (typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 100).map(item => sanitizeObject(item, maxDepth - 1));
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    const keys = Object.keys(obj).slice(0, 50); // Limit number of keys
    
    for (const key of keys) {
      if (key.length <= 100) { // Limit key length
        sanitized[key] = sanitizeObject(obj[key], maxDepth - 1);
      }
    }
    
    return sanitized;
  }

  return String(obj).slice(0, 100);
}

/**
 * Middleware to validate request body
 */
export function validateRequestBody<T>(
  validator: (data: unknown) => ValidationResult<T>
) {
  return (data: unknown): T => {
    const result = validator(data);
    
    if (!result.isValid) {
      throw new ValidationError(`Validation failed: ${result.errors.join(', ')}`);
    }
    
    return result.data!;
  };
} 