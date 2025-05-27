import { ExperienceData, BotSettings } from './types';
import { prisma } from './prisma';

class CompanyManager {
  private experienceToCompanyMap = new Map<string, string>();
  private companySettingsCache = new Map<string, BotSettings>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Register an experience-to-company mapping
   */
  registerExperience(experienceId: string, companyId: string): void {
    console.log(`🔗 Mapping experience ${experienceId} to company ${companyId}`);
    this.experienceToCompanyMap.set(experienceId, companyId);
    
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
   * Get company ID from experience ID
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
   * Get bot settings for a company with caching
   */
  async getBotSettings(companyId: string): Promise<BotSettings> {
    // Check cache first
    const cached = this.companySettingsCache.get(companyId);
    const expiry = this.cacheExpiry.get(companyId);
    
    if (cached && expiry && Date.now() < expiry) {
      console.log(`📋 Using cached settings for company ${companyId}`);
      return cached;
    }

    // Fetch from database
    console.log(`🔍 Loading settings from database for company ${companyId}`);
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

      // Cache the result
      this.companySettingsCache.set(companyId, settings);
      this.cacheExpiry.set(companyId, Date.now() + this.CACHE_TTL);

      console.log(`💾 Cached settings for company ${companyId}:`, settings);
      return settings;
    } catch (error) {
      console.error(`❌ Error fetching settings for company ${companyId}:`, error);
      // Fallback to complete default settings on error
      return {
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
    }
  }

  /**
   * Clear cache for a specific company (useful when settings are updated)
   */
  clearCache(companyId: string): void {
    this.companySettingsCache.delete(companyId);
    this.cacheExpiry.delete(companyId);
    console.log(`🗑️ Cleared cache for company ${companyId}`);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.companySettingsCache.clear();
    this.cacheExpiry.clear();
    console.log(`🗑️ Cleared all caches`);
  }

  /**
   * Get stats about the manager
   */
  getStats() {
    return {
      experienceMappings: this.experienceToCompanyMap.size,
      cachedSettings: this.companySettingsCache.size,
      cachedCompanies: Array.from(this.companySettingsCache.keys())
    };
  }
}

// Single instance for the entire application
export const companyManager = new CompanyManager(); 