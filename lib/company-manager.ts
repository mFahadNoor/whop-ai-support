import { ExperienceData, BotSettings } from './types';
import { prisma } from './prisma';
import { logger } from './logger';

class CompanyManager {
  private experienceToCompanyMap = new Map<string, string>();
  private companySettingsCache = new Map<string, BotSettings>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 30 * 1000; // Reduced to 30 seconds for faster updates
  private readonly MAPPING_RETRY_DELAY = 500; // Faster retry for mappings

  /**
   * Register an experience-to-company mapping
   */
  registerExperience(experienceId: string, companyId: string): void {
    console.log(`🔗 Mapping experience ${experienceId} to company ${companyId}`);
    this.experienceToCompanyMap.set(experienceId, companyId);
    
    // Clear cache for this company when new mapping arrives to ensure fresh data
    this.clearCache(companyId);
    
    // Notify that this experience now has a company mapping
    this.notifyExperienceMapped?.(experienceId);
  }

  /**
   * Set callback for when experience mappings are received
   */
  setExperienceMappedCallback(callback: (experienceId: string) => void): void {
    this.notifyExperienceMapped = callback;
  }

  private notifyExperienceMapped?: (experienceId: string) => void;

  /**
   * Get company ID from experience ID with better retry logic
   */
  getCompanyId(experienceId: string): string | null {
    const companyId = this.experienceToCompanyMap.get(experienceId);
    if (companyId) {
      console.log(`✅ Found company ${companyId} for experience ${experienceId}`);
      return companyId;
    }
    console.log(`❌ No company mapping found for experience ${experienceId}`);
    return null;
  }

  /**
   * Try to fetch company mapping from database if not in memory
   */
  async tryFetchMappingFromDB(experienceId: string): Promise<string | null> {
    try {
      // This is a fallback - in a real scenario you might have a table that maps experiences to companies
      // For now, we'll just return null and rely on the WebSocket mapping messages
      logger.debug('Attempted to fetch mapping from DB but no fallback mechanism implemented', {
        experienceId,
        action: 'mapping_db_fallback'
      });
      return null;
    } catch (error) {
      logger.error('Error trying to fetch mapping from database', error, { experienceId });
      return null;
    }
  }

  /**
   * Get bot settings for a company with caching and force refresh option
   */
  async getBotSettings(companyId: string, forceRefresh: boolean = false): Promise<BotSettings> {
    // Check cache first (unless force refresh is requested)
    if (!forceRefresh) {
      const cached = this.companySettingsCache.get(companyId);
      const expiry = this.cacheExpiry.get(companyId);
      
      if (cached && expiry && Date.now() < expiry) {
        console.log(`📋 Using cached settings for company ${companyId}`);
        return cached;
      }
    }

    // Fetch from database
    console.log(`🔍 Loading settings from database for company ${companyId}${forceRefresh ? ' (force refresh)' : ''}`);
    try {
      const company = await prisma.company.findUnique({
        where: { id: companyId }
      });
      
      // Ensure all BotSettings fields have defaults if not present in DB
      const dbSettings = (company?.config as any)?.botSettings;
      const defaultSettings: BotSettings = {
        enabled: false,
        knowledgeBase: '',
        botPersonality: 'helpful assistant',
        botLanguage: 'en',
        customInstructions: 'You are a helpful AI assistant. Be concise and polite.',
        presetQA: [],
        responseStyle: 'friendly',
        autoResponse: true,
        responseDelay: 0,
        presetQuestions: [],
        presetAnswers: []
      };

      const settings: BotSettings = {
        ...defaultSettings,
        ...(dbSettings || {}),
      };

      // Cache the result with shorter TTL
      this.companySettingsCache.set(companyId, settings);
      this.cacheExpiry.set(companyId, Date.now() + this.CACHE_TTL);

      console.log(`💾 Cached settings for company ${companyId}:`, {
        enabled: settings.enabled,
        hasKnowledgeBase: !!settings.knowledgeBase,
        responseStyle: settings.responseStyle,
        presetQACount: settings.presetQA?.length || 0
      });
      
      logger.info('Company settings loaded', {
        companyId,
        enabled: settings.enabled,
        hasKnowledgeBase: !!settings.knowledgeBase,
        action: 'settings_loaded'
      });
      
      return settings;
    } catch (error) {
      logger.error(`Error fetching settings for company ${companyId}`, error, {
        companyId,
        action: 'settings_fetch_error'
      });
      
      // Fallback to complete default settings on error
      const fallbackSettings: BotSettings = {
        enabled: false,
        knowledgeBase: '',
        botPersonality: 'helpful assistant',
        botLanguage: 'en',
        customInstructions: 'You are a helpful AI assistant. Be concise and polite.',
        presetQA: [],
        responseStyle: 'friendly',
        autoResponse: true,
        responseDelay: 0,
        presetQuestions: [],
        presetAnswers: []
      };
      
      return fallbackSettings;
    }
  }

  /**
   * Clear cache for a specific company (useful when settings are updated)
   */
  clearCache(companyId: string): void {
    this.companySettingsCache.delete(companyId);
    this.cacheExpiry.delete(companyId);
    logger.info('Cache cleared for company', { companyId, action: 'cache_cleared' });
    console.log(`🗑️ Cleared cache for company ${companyId}`);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.companySettingsCache.clear();
    this.cacheExpiry.clear();
    logger.info('All caches cleared', { action: 'all_caches_cleared' });
    console.log(`🗑️ Cleared all caches`);
  }

  /**
   * Force refresh settings for a company
   */
  async refreshSettings(companyId: string): Promise<BotSettings> {
    console.log(`🔄 Force refreshing settings for company ${companyId}`);
    return await this.getBotSettings(companyId, true);
  }

  /**
   * Get stats about the manager
   */
  getStats() {
    return {
      experienceMappings: this.experienceToCompanyMap.size,
      cachedSettings: this.companySettingsCache.size,
      cachedCompanies: Array.from(this.companySettingsCache.keys()),
      cacheTTL: this.CACHE_TTL
    };
  }

  /**
   * Clean up expired cache entries
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    const expiredCompanies: string[] = [];
    
    for (const [companyId, expiry] of this.cacheExpiry.entries()) {
      if (now >= expiry) {
        expiredCompanies.push(companyId);
      }
    }
    
    for (const companyId of expiredCompanies) {
      this.companySettingsCache.delete(companyId);
      this.cacheExpiry.delete(companyId);
    }
    
    if (expiredCompanies.length > 0) {
      console.log(`🧹 Cleaned up ${expiredCompanies.length} expired cache entries`);
    }
  }
}

// Single instance for the entire application
export const companyManager = new CompanyManager(); 