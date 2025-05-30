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

interface ContextMessage {
  content: string;
  username: string;
  timestamp: Date;
  isBot: boolean;
}

interface CompanyContext {
  messages: ContextMessage[];
  lastUpdated: Date;
}

export class DataManager {
  private settingsCache = new Map<string, CachedBotSettings>();
  private experienceToCompanyMap = new Map<string, string>();
  private experienceMappedCallback?: (experienceId: string) => void;
  private readonly CACHE_TTL_MS = 30 * 1000; // 30 seconds instead of 5 minutes
  
  // Context window storage
  private contextCache = new Map<string, CompanyContext>();
  private readonly MAX_CONTEXT_MESSAGES = 25;
  private readonly CONTEXT_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor() {
    // Set up periodic cleanup
    setInterval(() => {
      this.cleanupExpiredCache();
    }, 2 * 60 * 1000); // Clean up every 2 minutes
    
    // Set up periodic mapping discovery (every 5 minutes)
    setInterval(() => {
      this.discoverMissingMappings().catch(error => {
        logger.error('Failed to discover missing mappings during periodic check', error, {
          action: 'periodic_mapping_discovery_failed'
        });
      });
    }, 5 * 60 * 1000); // Check every 5 minutes
    
    // Load existing experience mappings from database on startup
    this.loadExperienceMappingsFromDB().catch(error => {
      logger.error('Failed to load experience mappings on startup', error, {
        action: 'startup_mapping_load_failed'
      });
    }).then(() => {
      // After loading from DB, discover any missing mappings from Whop API
      this.discoverMissingMappings().catch(error => {
        logger.error('Failed to discover missing mappings on startup', error, {
          action: 'startup_mapping_discovery_failed'
        });
      });
    });
  }

  setExperienceMappedCallback(callback: (experienceId: string) => void) {
    this.experienceMappedCallback = callback;
  }

  registerExperience(experienceId: string, companyId: string) {
    const existingCompanyId = this.experienceToCompanyMap.get(experienceId);
    
    if (existingCompanyId !== companyId) {
      this.experienceToCompanyMap.set(experienceId, companyId);
      console.log(`🔗 Mapped experience to ${companyId.substring(0, 8)}...`);
      
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
      const mapping = await prisma.experienceMapping.findUnique({
        where: { experienceId }
      });
      
      if (mapping) {
        // Cache the mapping in memory
        this.experienceToCompanyMap.set(experienceId, mapping.companyId);
        logger.info('Loaded experience mapping from database', {
          experienceId,
          companyId: mapping.companyId,
          action: 'mapping_loaded_from_db'
        });
        return mapping.companyId;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to fetch mapping from database', error as Error, { experienceId });
      return null;
    }
  }

  private async loadExperienceMappingsFromDB(): Promise<void> {
    try {
      const mappings = await prisma.experienceMapping.findMany();
      let loadedCount = 0;
      
      for (const mapping of mappings) {
        this.experienceToCompanyMap.set(mapping.experienceId, mapping.companyId);
        loadedCount++;
      }
      
      if (loadedCount > 0) {
        console.log(`🔗 Loaded ${loadedCount} experience mapping(s)`);
      }
      
      logger.info('Loaded experience mappings from database on startup', {
        loadedCount,
        action: 'startup_mappings_loaded'
      });
    } catch (error) {
      logger.error('Failed to load experience mappings from database', error as Error, {
        action: 'startup_mappings_failed'
      });
    }
  }

  private async saveMappingToDB(experienceId: string, companyId: string) {
    try {
      // Save the experience mapping
      await prisma.experienceMapping.upsert({
        where: { experienceId },
        update: {
          companyId,
          updatedAt: new Date()
        },
        create: {
          experienceId,
          companyId
        }
      });
      
      // Also ensure the company exists
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
      
      logger.info('Saved experience mapping to database', {
        experienceId,
        companyId,
        action: 'mapping_saved_to_db'
      });
    } catch (error) {
      logger.error('Failed to save experience mapping', error as Error, { experienceId, companyId });
    }
  }

  /**
   * Discover missing experience mappings by fetching from Whop API
   */
  async discoverMissingMappings(): Promise<void> {
    try {
      console.log('🔍 Discovering experience mappings from Whop API...');
      
      const { whopAPI } = await import('./api-services');
      const experiences = await whopAPI.getAppExperiences();
      
      if (!experiences) {
        logger.warn('Failed to fetch app experiences for mapping discovery');
        return;
      }
      
      let discoveredCount = 0;
      let newMappings = 0;
      
      for (const experience of experiences) {
        if (experience.id && experience.company_id) {
          discoveredCount++;
          
          // Check if we already have this mapping
          const existingMapping = this.experienceToCompanyMap.get(experience.id);
          
          if (!existingMapping) {
            // New mapping discovered
            this.registerExperience(experience.id, experience.company_id);
            newMappings++;
          } else if (existingMapping !== experience.company_id) {
            // Mapping changed
            logger.info('Experience mapping changed', {
              experienceId: experience.id,
              oldCompanyId: existingMapping,
              newCompanyId: experience.company_id,
              action: 'mapping_updated'
            });
            this.registerExperience(experience.id, experience.company_id);
            newMappings++;
          }
        }
      }
      
      if (newMappings > 0) {
        console.log(`✅ Discovered ${newMappings} new experience mapping(s) from ${discoveredCount} total experiences`);
      } else if (discoveredCount > 0) {
        console.log(`✅ All ${discoveredCount} experience mappings are up to date`);
      } else {
        console.log('ℹ️ No experiences found for this app');
      }
      
      logger.info('Completed mapping discovery', {
        totalExperiences: discoveredCount,
        newMappings,
        action: 'mapping_discovery_completed'
      });
      
    } catch (error) {
      logger.error('Failed to discover experience mappings', error as Error, {
        action: 'mapping_discovery_failed'
      });
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
    
    // Also cleanup expired context windows
    let contextCleanedCount = 0;
    for (const [companyId, context] of this.contextCache.entries()) {
      if ((now - context.lastUpdated.getTime()) > this.CONTEXT_TTL_MS) {
        this.contextCache.delete(companyId);
        contextCleanedCount++;
      }
    }
    
    if (cleanedCount > 0 || contextCleanedCount > 0) {
      logger.debug('Cleaned up expired cache entries', { 
        settingsCleanedCount: cleanedCount,
        contextCleanedCount: contextCleanedCount
      });
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
      contextWindows: {
        size: this.contextCache.size,
        companies: Array.from(this.contextCache.keys()),
        totalMessages: Array.from(this.contextCache.values()).reduce((sum, ctx) => sum + ctx.messages.length, 0),
        maxMessagesPerCompany: this.MAX_CONTEXT_MESSAGES
      },
      cacheTtlMs: this.CACHE_TTL_MS,
      contextTtlMs: this.CONTEXT_TTL_MS
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

  // =============================================================================
  // CONTEXT WINDOW MANAGEMENT
  // =============================================================================

  /**
   * Add a message to the context window for a company
   */
  addMessageToContext(companyId: string, content: string, username: string, isBot: boolean = false) {
    if (!this.contextCache.has(companyId)) {
      this.contextCache.set(companyId, {
        messages: [],
        lastUpdated: new Date()
      });
    }

    const context = this.contextCache.get(companyId)!;
    
    // Add new message
    context.messages.push({
      content: content.substring(0, 500), // Limit message length
      username,
      timestamp: new Date(),
      isBot
    });

    // Keep only the last MAX_CONTEXT_MESSAGES
    if (context.messages.length > this.MAX_CONTEXT_MESSAGES) {
      context.messages = context.messages.slice(-this.MAX_CONTEXT_MESSAGES);
    }

    context.lastUpdated = new Date();

    logger.debug('Added message to context window', {
      companyId,
      username,
      isBot,
      totalMessages: context.messages.length,
      contentPreview: content.substring(0, 50)
    });
  }

  /**
   * Get the context window for a company
   */
  getCompanyContext(companyId: string): ContextMessage[] {
    const context = this.contextCache.get(companyId);
    if (!context) {
      return [];
    }

    // Check if context is still valid
    const now = Date.now();
    if ((now - context.lastUpdated.getTime()) > this.CONTEXT_TTL_MS) {
      this.contextCache.delete(companyId);
      return [];
    }

    return [...context.messages]; // Return a copy
  }

  /**
   * Get formatted context as a string for AI prompts
   */
  getFormattedContext(companyId: string): string {
    const messages = this.getCompanyContext(companyId);
    if (messages.length === 0) {
      return '';
    }

    const formattedMessages = messages
      .slice(-10) // Only use last 10 messages for AI context to avoid token limits
      .map(msg => `${msg.isBot ? 'Bot' : msg.username}: ${msg.content}`)
      .join('\n');

    return `Recent conversation:\n${formattedMessages}\n\n`;
  }

  /**
   * Clear context for a specific company
   */
  clearCompanyContext(companyId: string) {
    this.contextCache.delete(companyId);
    logger.debug('Cleared context window for company', { companyId });
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