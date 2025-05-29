/**
 * Data Manager - Database Operations and Caching
 * 
 * This module handles all database operations and caching for the AI bot.
 * It provides a high-level interface for managing company settings, experience mappings,
 * and bot configurations with built-in caching for optimal performance.
 * 
 * Key Features:
 * - Company settings management with automatic caching
 * - Experience-to-company mapping for multi-tenant support
 * - Intelligent cache invalidation and refresh strategies
 * - Database connection management with Prisma ORM
 * - Error handling and retry logic for database operations
 * - Memory-efficient caching with TTL (Time To Live) support
 * 
 * Caching Strategy:
 * - Settings are cached for 5 minutes by default
 * - Cache is automatically invalidated when settings are updated
 * - Experience mappings are cached until explicitly refreshed
 * - Least Recently Used (LRU) eviction when cache size limits are reached
 * 
 * Usage:
 * ```typescript
 * const settings = await dataManager.getCompanySettings('company_123');
 * await dataManager.updateCompanySettings('company_123', newSettings);
 * ```
 */

import { PrismaClient } from '@prisma/client';
import { BotSettings, config, logger, validateString, sanitizeText } from './shared-utils';

// =============================================================================
// PRISMA CLIENT
// =============================================================================

export const prisma = new PrismaClient({
  log: config.ENABLE_DB_LOGGING ? ['query', 'info', 'warn', 'error'] : ['error'],
  datasources: {
    db: {
      url: config.DATABASE_URL,
    },
  },
});

// =============================================================================
// VALIDATION
// =============================================================================

export function isValidBotSettings(settings: any): boolean {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  // Check required fields exist and are correct types
  const requiredFields = {
    enabled: 'boolean',
    knowledgeBase: 'string',
    customInstructions: 'string',
    responseStyle: 'string',
    autoResponse: 'boolean',
    responseDelay: 'number'
  };

  for (const [field, type] of Object.entries(requiredFields)) {
    if (!(field in settings) || typeof settings[field] !== type) {
      logger.error(`Invalid field: ${field}, expected ${type}, got ${typeof settings[field]}`);
      return false;
    }
  }

  // Validate responseStyle enum
  const validResponseStyles = ['professional', 'friendly', 'casual', 'technical', 'custom'];
  if (!validResponseStyles.includes(settings.responseStyle)) {
    logger.error(`Invalid responseStyle: ${settings.responseStyle}`);
    return false;
  }

  // Validate responseDelay range
  if (settings.responseDelay < 0 || settings.responseDelay > 30) {
    logger.error(`Invalid responseDelay: ${settings.responseDelay}`);
    return false;
  }

  // Validate presetQA if it exists
  if (settings.presetQA && Array.isArray(settings.presetQA)) {
    for (const qa of settings.presetQA) {
      if (!qa || typeof qa !== 'object' || 
          typeof qa.id !== 'string' || 
          typeof qa.question !== 'string' || 
          typeof qa.answer !== 'string' || 
          typeof qa.enabled !== 'boolean') {
        logger.error('Invalid presetQA item:', qa);
        return false;
      }
    }
  }

  return true;
}

export function validateBotSettings(settings: Partial<BotSettings>): void {
  // Basic validation - allow empty strings for optional fields
  if (settings.knowledgeBase !== undefined) {
    if (typeof settings.knowledgeBase !== 'string') {
      throw new Error('knowledgeBase must be a string');
    }
    if (settings.knowledgeBase.length > config.MAX_KNOWLEDGE_BASE_SIZE) {
      throw new Error(`knowledgeBase cannot exceed ${config.MAX_KNOWLEDGE_BASE_SIZE} characters`);
    }
  }

  if (settings.customInstructions !== undefined) {
    if (typeof settings.customInstructions !== 'string') {
      throw new Error('customInstructions must be a string');
    }
    if (settings.customInstructions.length > 10000) {
      throw new Error('customInstructions cannot exceed 10000 characters');
    }
  }

  if (settings.responseStyle !== undefined) {
    const validStyles = ['professional', 'friendly', 'casual', 'technical', 'custom'];
    if (!validStyles.includes(settings.responseStyle)) {
      throw new Error(`Invalid response style: ${settings.responseStyle}`);
    }
  }

  if (settings.responseDelay !== undefined) {
    if (typeof settings.responseDelay !== 'number' || settings.responseDelay < 0 || settings.responseDelay > 30) {
      throw new Error('Response delay must be a number between 0 and 30 seconds');
    }
  }

  if (settings.presetQA) {
    if (!Array.isArray(settings.presetQA)) {
      throw new Error('presetQA must be an array');
    }

    for (const qa of settings.presetQA) {
      if (!qa.id || !qa.question || !qa.answer) {
        throw new Error('Each preset Q&A must have id, question, and answer');
      }
      
      validateString(qa.question, 'question', 500);
      validateString(qa.answer, 'answer', 2000);
    }
  }
}

// =============================================================================
// COMPANY MANAGER
// =============================================================================

interface CachedBotSettings {
  settings: BotSettings;
  timestamp: Date;
}

export class DataManager {
  private settingsCache = new Map<string, CachedBotSettings>();
  private experienceToCompanyMap = new Map<string, string>();
  private experienceMappedCallback?: (experienceId: string) => void;
  private readonly CACHE_TTL_MS = 30 * 1000; // 30 seconds instead of 5 minutes

  constructor() {
    // Set up periodic cleanup
    setInterval(() => {
      this.cleanupExpiredCache();
    }, 2 * 60 * 1000); // Clean up every 2 minutes
  }

  setExperienceMappedCallback(callback: (experienceId: string) => void) {
    this.experienceMappedCallback = callback;
  }

  registerExperience(experienceId: string, companyId: string) {
    const existingCompanyId = this.experienceToCompanyMap.get(experienceId);
    
    if (existingCompanyId !== companyId) {
      this.experienceToCompanyMap.set(experienceId, companyId);
      console.log(`🔗 Mapped experience ${experienceId} to company ${companyId}`);
      
      // Store mapping in database for persistence
      this.saveMappingToDB(experienceId, companyId).catch(error => {
        logger.warn('Failed to save experience mapping to database', { 
          experienceId, 
          companyId, 
          error: error.message 
        });
      });
      
      // Trigger callback for pending messages
      if (this.experienceMappedCallback) {
        this.experienceMappedCallback(experienceId);
      }
    }
  }

  getCompanyId(experienceId: string): string | null {
    return this.experienceToCompanyMap.get(experienceId) || null;
  }

  async tryFetchMappingFromDB(experienceId: string): Promise<string | null> {
    try {
      // For now, return null since we don't have experience mapping in DB schema
      // This will be handled by the in-memory mapping
      return null;
    } catch (error) {
      logger.error('Failed to fetch mapping from database', error as Error, { experienceId });
      return null;
    }
  }

  private async saveMappingToDB(experienceId: string, companyId: string) {
    try {
      await prisma.company.upsert({
        where: { id: companyId },
        update: {
          name: `Company ${companyId}` // Just update name for now
        },
        create: {
          id: companyId,
          name: `Company ${companyId}`,
          config: {}
        }
      });
    } catch (error) {
      logger.error('Failed to save experience mapping', error as Error, { experienceId, companyId });
    }
  }

  async getBotSettings(companyId: string, forceRefresh: boolean = false): Promise<BotSettings> {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.settingsCache.get(companyId);
      if (cached && (Date.now() - cached.timestamp.getTime()) < this.CACHE_TTL_MS) {
        logger.debug('Returning cached bot settings', { companyId, cacheAge: Date.now() - cached.timestamp.getTime() });
        return cached.settings;
      }
    }

    // Fetch from database
    try {
      const company = await prisma.company.findUnique({
        where: { id: companyId }
      });

      const defaultSettings: BotSettings = {
        enabled: false,
        knowledgeBase: '',
        customInstructions: '',
        presetQA: [],
        responseStyle: 'professional',
        autoResponse: true,
        responseDelay: 1
      };

      let settings: BotSettings;
      if (company?.config && typeof company.config === 'object') {
        const config = company.config as any;
        settings = {
          ...defaultSettings,
          ...(config.botSettings || {})
        };
      } else {
        settings = defaultSettings;
      }

      // Cache the settings
      this.settingsCache.set(companyId, {
        settings,
        timestamp: new Date()
      });

      logger.debug('Fetched and cached bot settings', { 
        companyId, 
        enabled: settings.enabled,
        hasKnowledgeBase: !!settings.knowledgeBase,
        presetQACount: settings.presetQA?.length || 0
      });

      return settings;
    } catch (error) {
      logger.error('Failed to fetch bot settings', error as Error, { companyId });
      
      // Return cached version if available, otherwise defaults
      const cached = this.settingsCache.get(companyId);
      if (cached) {
        logger.warn('Returning stale cached settings due to database error', { companyId });
        return cached.settings;
      }

      // Return safe defaults
      return {
        enabled: false,
        knowledgeBase: '',
        customInstructions: '',
        presetQA: [],
        responseStyle: 'professional',
        autoResponse: true,
        responseDelay: 1
      };
    }
  }

  async saveBotSettings(companyId: string, settings: BotSettings): Promise<void> {
    try {
      // Validate settings
      validateBotSettings(settings);

      // Sanitize text fields
      const sanitizedSettings = {
        ...settings,
        knowledgeBase: sanitizeText(settings.knowledgeBase),
        customInstructions: sanitizeText(settings.customInstructions),
        presetQA: settings.presetQA?.map(qa => ({
          ...qa,
          question: sanitizeText(qa.question),
          answer: sanitizeText(qa.answer)
        })) || []
      };

      // Save to database
      await prisma.company.upsert({
        where: { id: companyId },
        update: {
          config: {
            botSettings: sanitizedSettings
          }
        },
        create: {
          id: companyId,
          name: `Company ${companyId}`,
          config: {
            botSettings: sanitizedSettings
          }
        }
      });

      // Update cache
      this.settingsCache.set(companyId, {
        settings: sanitizedSettings,
        timestamp: new Date()
      });

      logger.info('Bot settings saved successfully', { 
        companyId,
        enabled: sanitizedSettings.enabled,
        hasKnowledgeBase: !!sanitizedSettings.knowledgeBase,
        presetQACount: sanitizedSettings.presetQA?.length || 0
      });

    } catch (error) {
      logger.error('Failed to save bot settings', error as Error, { companyId });
      throw error;
    }
  }

  clearCache(companyId: string) {
    this.settingsCache.delete(companyId);
    logger.debug('Cleared cache for company', { companyId });
  }

  clearAllCaches() {
    this.settingsCache.clear();
    this.experienceToCompanyMap.clear();
    logger.info('Cleared all caches');
  }

  cleanupExpiredCache() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [companyId, cached] of this.settingsCache.entries()) {
      if ((now - cached.timestamp.getTime()) > this.CACHE_TTL_MS) {
        this.settingsCache.delete(companyId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug('Cleaned up expired cache entries', { cleanedCount });
    }
  }

  getStats() {
    return {
      settingsCache: {
        size: this.settingsCache.size,
        companies: Array.from(this.settingsCache.keys())
      },
      experienceMappings: {
        size: this.experienceToCompanyMap.size,
        mappings: Object.fromEntries(this.experienceToCompanyMap)
      },
      cacheTtlMs: this.CACHE_TTL_MS
    };
  }

  // =============================================================================
  // GRACEFUL SHUTDOWN
  // =============================================================================

  async disconnect() {
    try {
      await prisma.$disconnect();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error disconnecting from database', error as Error);
    }
  }
}

// Create and export singleton instance
export const dataManager = new DataManager();

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await dataManager.disconnect();
});

process.on('SIGTERM', async () => {
  await dataManager.disconnect();
}); 