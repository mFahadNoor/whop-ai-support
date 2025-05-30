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

  // Base personality based on response style
  switch (settings.responseStyle) {
    case 'professional':
      systemPrompt = 'You are a professional and helpful AI assistant for a community support system. Provide clear, accurate, and polite responses.';
      break;
    case 'friendly':
      systemPrompt = 'You are a friendly and warm AI assistant for a community. Be approachable, enthusiastic, and helpful while maintaining professionalism.';
      break;
    case 'casual':
      systemPrompt = 'You are a casual and relaxed AI assistant for a community. Use a conversational tone, be friendly, and help users in a laid-back manner.';
      break;
    case 'technical':
      systemPrompt = 'You are a technical AI assistant for a community. Provide detailed, precise, and technically accurate responses with proper explanations.';
      break;
    case 'custom':
      systemPrompt = settings.botPersonality || 'You are a helpful AI assistant for a community support system.';
      break;
    default:
      systemPrompt = 'You are a helpful AI assistant for a community support system.';
  }

  // Add knowledge base
  if (knowledgeBase && knowledgeBase.trim()) {
    systemPrompt += '\n\nHere is important information about this community:\n' + knowledgeBase.trim();
  }

  // Add custom instructions
  if (settings.customInstructions && settings.customInstructions.trim()) {
    systemPrompt += '\n\nAdditional instructions:\n' + settings.customInstructions.trim();
  }

  // Add response guidelines
  systemPrompt += '\n\nGuidelines:';
  
  if (shouldForceResponse) {
    systemPrompt += '\n- You have been directly mentioned or someone replied to your message, so you should provide a helpful response';
    systemPrompt += '\n- If someone mentions you casually or replies with casual conversation, politely redirect them to ask a specific question';
    systemPrompt += '\n- If they greet you or say hi, respond politely and ask how you can help with this community';
  } else {
    systemPrompt += '\n- ONLY respond to clear questions that need support or information about this community';
    systemPrompt += '\n- Do NOT respond to casual conversation, greetings, or off-topic chat between users';
    systemPrompt += '\n- Focus on questions about the community\'s purpose, features, rules, or how things work';
    systemPrompt += '\n- If the question isn\'t related to your knowledge base, politely redirect to the appropriate resource';
  }
  
  systemPrompt += '\n- Keep responses concise and helpful (under 300 characters when possible)';
  systemPrompt += '\n- Use the community information provided to give accurate, specific answers';
  systemPrompt += '\n- If you don\'t know something, say so instead of guessing';
  systemPrompt += '\n- Be respectful and professional in all responses';
  systemPrompt += '\n- Avoid responding to messages that don\'t need bot intervention';

  return systemPrompt;
}

export function createQuestionAnalysisPrompt(): string {
  return `You are an AI assistant that determines if messages require responses from a community support bot.

Respond with "YES" ONLY if the message:
- Contains a clear question about the community, service, or topic (marked by ?, or question words like what/how/why/when/where/who)
- Asks for help, support, technical assistance, or guidance
- Reports a problem or issue that needs addressing
- Requests specific information, clarification, or instructions
- Asks about features, functionality, or how something works

Respond with "NO" if the message:
- Is casual conversation between users (greetings, small talk, "wassup", "how's it going")
- Contains only statements, comments, or personal updates
- Is off-topic chatter not related to the community's purpose
- Is spam, nonsense, inappropriate, or unclear content
- Contains only emojis, reactions, or very short responses
- Is users talking to each other about unrelated topics
- Is social conversation that doesn't need bot intervention

The bot should ONLY respond to questions that actually need support or information, not casual chat.

Analyze this message and respond with only "YES" or "NO":`;
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

  constructor() {
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.OPENROUTER_API_KEY,
    });

    // Set up periodic cleanup for rate limiter only
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

      // Generate AI response
      const aiResponse = await this.generateAIResponse(truncatedMessage, knowledgeBase, settings, companyId, shouldForceResponse, username);
      if (aiResponse) {
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
      
      // Get conversation context
      const { dataManager } = await import('./data-manager');
      const context = dataManager.getFormattedContext(companyId);

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
              content: context + message
            }
          ],
          max_tokens: config.MAX_AI_RESPONSE_TOKENS,
          temperature: 0.7,
        });
      });

      let aiResponse = response.choices[0]?.message?.content?.trim();
      
      // Add username mention if provided and not already included
      if (aiResponse && username && shouldForceResponse && !aiResponse.includes(`@${username}`)) {
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

    if (cleanedCount > 0) {
      logger.debug('AI engine cleanup completed', { 
        cleanedCacheEntries: cleanedCount,
        remainingCacheSize: 0
      });
    }
  }

  /**
   * Clear rate limits (for admin commands)
   */
  clearRateLimits() {
    this.rateLimiter.clear();
    logger.debug('Cleared AI rate limits');
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      responseCache: {
        size: 0,
        maxSize: 0,
        ttlMs: 0
      },
      rateLimiter: this.rateLimiter.getStats(),
      model: config.OPENROUTER_MODEL,
      rateLimitPerMinute: config.AI_RATE_LIMIT_PER_MINUTE
    };
  }
}

// Create and export singleton instance
export const aiEngine = new AIEngine(); 