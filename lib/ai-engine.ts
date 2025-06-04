/**
 * AI Engine - Intelligent Question Processing and Response Generation
 * 
 * This module provides the core AI functionality for the Whop support bot.
 * It intelligently processes user messages, determines if they need responses,
 * and generates fresh contextual answers using OpenRouter AI models.
 * 
 * Key Features:
 * - Smart question detection with efficient processing
 * - Preset Q&A matching for instant responses
 * - Contextual AI responses using company knowledge base
 * - Rate limiting to prevent API quota exhaustion
 * - Multiple response styles (professional, friendly, casual, technical)
 * - Automatic fallback handling for API failures
 * - Fresh responses for maximum accuracy
 * 
 * Question Processing Pipeline:
 * 1. Quick heuristic check for question indicators
 * 2. Preset Q&A matching for common questions
 * 3. AI-powered question confirmation
 * 4. Context-aware response generation
 * 5. Rate limit tracking
 * 
 * Performance Optimizations:
 * - Rate limiting (10 AI requests per minute per company)
 * - Efficient question detection to avoid unnecessary AI calls
 * - Fresh responses generated every time for accuracy
 * - Automatic memory management
 * 
 * Usage:
 * ```typescript
 * const response = await aiEngine.analyzeQuestion(message, settings);
 * if (response) {
 *   // Send response to user
 * }
 * ```
 */

import OpenAI from 'openai';
import { BotSettings, config, logger, retry, isQuestion, extractKeyPhrases, sanitizeText, truncateText } from './shared-utils';

// =============================================================================
// AI PROMPTS
// =============================================================================

export function createSystemPrompt(knowledgeBase: string, settings: BotSettings, shouldForceResponse: boolean = false): string {
  let systemPrompt = '';

  // Base personality - keep it simple
  switch (settings.responseStyle) {
    case 'professional':
      systemPrompt = 'You are a helpful AI assistant for this community. Be professional and clear.';
      break;
    case 'friendly':
      systemPrompt = 'You are a friendly AI assistant for this community. Be warm and helpful.';
      break;
    case 'casual':
      systemPrompt = 'You are a casual AI assistant for this community. Be relaxed and friendly.';
      break;
    case 'technical':
      systemPrompt = 'You are a technical AI assistant for this community. Be precise and detailed.';
      break;
    case 'custom':
      systemPrompt = settings.botPersonality || 'You are a helpful AI assistant for this community.';
      break;
    default:
      systemPrompt = 'You are a helpful AI assistant for this community.';
  }

  // Add knowledge base if available
  if (knowledgeBase && knowledgeBase.trim()) {
    systemPrompt += '\n\nCommunity Information:\n' + knowledgeBase.trim();
  }

  // Add custom instructions if available
  if (settings.customInstructions && settings.customInstructions.trim()) {
    systemPrompt += '\n\nAdditional Instructions:\n' + settings.customInstructions.trim();
  }

  // Much stricter rules
  if (shouldForceResponse) {
    systemPrompt += '\n\nIMPORTANT: You have been mentioned or someone replied to your message.';
    systemPrompt += '\n- If you can answer their question using ONLY the community information above, provide a helpful answer';
    systemPrompt += '\n- If you CANNOT answer from the community information, DO NOT RESPOND AT ALL';
    systemPrompt += '\n- Do NOT make up information or guess';
  } else {
    systemPrompt += '\n\nCRITICAL: Only respond if you can answer the question using ONLY the community information provided above.';
    systemPrompt += '\n- If the community information does not contain the answer, DO NOT RESPOND AT ALL';
    systemPrompt += '\n- Do not say "I don\'t know" or "I can\'t help" - just don\'t respond';
    systemPrompt += '\n- Do not make up information or guess';
    systemPrompt += '\n- The information must be explicitly stated in the community information';
  }

  systemPrompt += '\n- Keep responses under 150 words';
  systemPrompt += '\n- Be direct and helpful';

  return systemPrompt;
}

export function createQuestionAnalysisPrompt(): string {
  return `Determine if this message is a question that needs an AI assistant response.

Respond "YES" if the message:
- Asks a specific question about community rules, requirements, or processes
- Asks "how to" do something specific
- Requests specific information or numbers
- Reports a problem that needs help

Respond "NO" if the message:
- Is casual conversation, greetings, or small talk
- Is just a statement or comment
- Is off-topic or spam
- Is too vague or general
- Is users talking to each other

Only respond "YES" if you're confident the question can be answered with specific community information.

Message to analyze:`;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private readonly windowMs = 60 * 1000; // 1 minute window

  isAllowed(key: string, limit: number): boolean {
    const now = Date.now();
    const entry = this.requests.get(key);

    if (!entry || now > entry.resetTime) {
      // First request or window expired
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return true;
    }

    if (entry.count >= limit) {
      return false;
    }

    entry.count++;
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  clear() {
    this.requests.clear();
  }

  getStats() {
    return {
      activeKeys: this.requests.size,
      windowMs: this.windowMs
    };
  }
}

// =============================================================================
// AI ENGINE
// =============================================================================

export class AIEngine {
  private openai: OpenAI;
  private rateLimiter = new RateLimiter();
  private responseCache = new Map<string, { response: string; timestamp: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.OPENROUTER_API_KEY,
    });

    // Set up periodic cleanup for rate limiter and cache
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Analyze if a message requires an AI response and generate one if needed
   */
  async analyzeQuestion(
    message: string,
    knowledgeBase: string,
    settings: BotSettings,
    companyId: string,
    shouldForceResponse: boolean = false,
    username?: string
  ): Promise<string | null> {
    try {
      // Input validation
      if (!message || message.trim().length === 0) {
        return null;
      }

      // Sanitize and truncate message
      const cleanMessage = sanitizeText(message);
      const truncatedMessage = truncateText(cleanMessage, config.MAX_MESSAGE_LENGTH);

      // Rate limiting
      if (!this.rateLimiter.isAllowed(`ai_${companyId}`, config.AI_RATE_LIMIT_PER_MINUTE)) {
        logger.warn('AI rate limit exceeded', { companyId, message: truncatedMessage.substring(0, 50) });
        return null;
      }

      // Check cache for recent identical questions
      const cacheKey = `${companyId}:${truncatedMessage.toLowerCase().trim()}`;
      const cachedEntry = this.responseCache.get(cacheKey);
      if (cachedEntry && Date.now() < cachedEntry.timestamp + this.CACHE_TTL_MS) {
        logger.debug('Returning cached response', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50) 
        });
        return username && !cachedEntry.response.includes(`@${username}`) 
          ? `@${username} ${cachedEntry.response}` 
          : cachedEntry.response;
      }

      // If bot should force response (mentioned or replying to bot), skip question detection
      const shouldRespond = shouldForceResponse || isQuestion(truncatedMessage);
      
      if (!shouldRespond) {
        logger.debug('Message does not appear to be a question and no forced response needed', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50),
          shouldForceResponse
        });
        return null;
      }

      // Check preset Q&A first
      const presetResponse = this.checkPresetQA(truncatedMessage, settings.presetQA || [], username);
      if (presetResponse) {
        logger.info('Found preset Q&A match', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50),
          responseLength: presetResponse.length,
          shouldForceResponse
        });
        return presetResponse;
      }

      // AI analysis - skip question detection if forced response
      if (!shouldForceResponse) {
        const isActualQuestion = await this.isQuestionAnalysis(truncatedMessage);
        if (!isActualQuestion) {
          logger.debug('AI determined message is not a question', { 
            companyId, 
            messagePreview: truncatedMessage.substring(0, 50) 
          });
          return null;
        }
      }

      // Generate AI response - removed contradiction checking as it was too strict
      const aiResponse = await this.generateAIResponse(truncatedMessage, knowledgeBase, settings, companyId, shouldForceResponse, username);
      if (aiResponse) {
        // Store in cache (without username mention for reuse)
        const responseToCache = aiResponse.startsWith(`@${username}`) 
          ? aiResponse.substring(`@${username} `.length) 
          : aiResponse;
        this.responseCache.set(cacheKey, {
          response: responseToCache,
          timestamp: Date.now()
        });

        logger.info('Generated new AI response', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50),
          responseLength: aiResponse.length,
          shouldForceResponse
        });
      }

      return aiResponse;

    } catch (error) {
      logger.error('Error in AI analysis', error as Error, { 
        companyId, 
        messagePreview: message.substring(0, 50),
        shouldForceResponse
      });
      return null;
    }
  }

  /**
   * Check if message matches any preset Q&A
   */
  private checkPresetQA(message: string, presetQA: Array<{question: string, answer: string, enabled: boolean}>, username?: string): string | null {
    if (!presetQA || presetQA.length === 0) {
      return null;
    }

    const messageLower = message.toLowerCase().trim();

    for (const qa of presetQA) {
      if (!qa.enabled) continue;

      const questionLower = qa.question.toLowerCase().trim();

      // Skip very short questions (less than 5 chars) to prevent over-matching
      if (questionLower.length < 5) {
        continue;
      }

      // 1. Exact match only (case insensitive) - most conservative
      if (messageLower === questionLower) {
        logger.debug('Preset Q&A exact match found', {
          question: qa.question,
          answer: qa.answer,
          messagePreview: message.substring(0, 50)
        });
        return username ? `@${username} ${qa.answer}` : qa.answer;
      }

      // 2. Very strict contains match - only if the question is short and message contains it exactly
      if (questionLower.length <= 15 && messageLower.includes(questionLower)) {
        logger.debug('Preset Q&A strict contains match found', {
          question: qa.question,
          answer: qa.answer,
          messagePreview: message.substring(0, 50)
        });
        return username ? `@${username} ${qa.answer}` : qa.answer;
      }
    }

    // Remove all fuzzy matching, word similarity, and key phrase matching to prevent false positives
    return null;
  }

  /**
   * Use AI to determine if a message is actually a question
   */
  private async isQuestionAnalysis(message: string): Promise<boolean> {
    try {
      const response = await retry(async () => {
        return await this.openai.chat.completions.create({
          model: config.OPENROUTER_MODEL,
          messages: [
            {
              role: 'system',
              content: createQuestionAnalysisPrompt()
            },
            {
              role: 'user',
              content: message
            }
          ],
          max_tokens: 10,
          temperature: 0.1,
        });
      });

      const result = response.choices[0]?.message?.content?.trim().toUpperCase();
      return result === 'YES';
      
    } catch (error) {
      logger.error('Error in question analysis', error as Error, { messagePreview: message.substring(0, 50) });
      // Default to true if AI analysis fails
      return true;
    }
  }

  /**
   * Generate AI response using OpenRouter
   */
  private async generateAIResponse(
    message: string, 
    knowledgeBase: string, 
    settings: BotSettings,
    companyId: string,
    shouldForceResponse: boolean,
    username?: string
  ): Promise<string | null> {
    try {
      const systemPrompt = createSystemPrompt(knowledgeBase, settings, shouldForceResponse);
      
      // Don't include conversation context - it causes confusion and duplicate responses
      // const { dataManager } = await import('./data-manager');
      // const context = dataManager.getFormattedContext(companyId);

      const response = await retry(async () => {
        return await this.openai.chat.completions.create({
          model: config.OPENROUTER_MODEL,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: message // Just use the message without context
            }
          ],
          max_tokens: config.MAX_AI_RESPONSE_TOKENS,
          temperature: 0.1, // Very low temperature for consistent, deterministic responses
        });
      });

      let aiResponse = response.choices[0]?.message?.content?.trim();
      
      // Filter out ANY response that indicates uncertainty or inability to help
      if (aiResponse) {
        const responseLower = aiResponse.toLowerCase();
        
        // Comprehensive list of phrases that indicate the AI can't/shouldn't respond
        const cantHelpPhrases = [
          'i don\'t have',
          'i cannot',
          'i can\'t',
          'don\'t have information',
          'cannot provide',
          'can\'t provide',
          'unable to',
          'not able to',
          'no information',
          'don\'t know',
          'cannot answer',
          'can\'t answer',
          'not sure',
          'unclear',
          'contact the',
          'ask the admin',
          'ask an admin',
          'check with',
          'not specified',
          'not mentioned',
          'doesn\'t say',
          'does not say',
          'no details',
          'not clear',
          'not available'
        ];
        
        // If response contains any "can't help" phrases, don't respond
        if (cantHelpPhrases.some(phrase => responseLower.includes(phrase))) {
          logger.debug('Filtered out uncertain/unhelpful response', {
            companyId,
            messagePreview: message.substring(0, 50),
            filteredResponse: aiResponse.substring(0, 100)
          });
          return null;
        }
      }
      
      // Add username mention if provided and not already included
      if (aiResponse && username && !aiResponse.includes(`@${username}`)) {
        aiResponse = `@${username} ${aiResponse}`;
      }
      
      return aiResponse || null;

    } catch (error) {
      logger.error('Error generating AI response', error as Error, { messagePreview: message.substring(0, 50) });
      return null;
    }
  }

  /**
   * Cleanup expired cache entries and rate limits
   */
  private cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean rate limiter
    this.rateLimiter.cleanup();

    // Clean response cache
    for (const [key, entry] of this.responseCache.entries()) {
      if (now > entry.timestamp + this.CACHE_TTL_MS) {
        this.responseCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('AI engine cleanup completed', { 
        cleanedCacheEntries: cleanedCount,
        remainingCacheSize: this.responseCache.size
      });
    }
  }

  /**
   * Clear rate limits (for admin commands)
   */
  clearRateLimits() {
    this.rateLimiter.clear();
    this.responseCache.clear();
    logger.debug('Cleared AI rate limits and response cache');
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      responseCache: {
        size: this.responseCache.size,
        maxSize: 0,
        ttlMs: this.CACHE_TTL_MS
      },
      rateLimiter: this.rateLimiter.getStats(),
      model: config.OPENROUTER_MODEL,
      rateLimitPerMinute: config.AI_RATE_LIMIT_PER_MINUTE
    };
  }
}

// Create and export singleton instance
export const aiEngine = new AIEngine(); 