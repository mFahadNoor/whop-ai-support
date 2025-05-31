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

  // Add bot role clarification
  systemPrompt += '\n\n🤖 CRITICAL ROLE UNDERSTANDING:';
  systemPrompt += '\n- You are an AI assistant bot created by the community owners/creators to help their members';
  systemPrompt += '\n- You do NOT own this community - you are a helpful assistant working FOR the community creators';
  systemPrompt += '\n- When the knowledge base uses "my", "I", "me", or "mine" - these refer to the COMMUNITY CREATORS, NOT YOU';
  systemPrompt += '\n- You should say "the creator\'s" or "this community\'s" instead of "my" when referring to ownership';
  systemPrompt += '\n- NEVER claim ownership of the community - always refer to it as belonging to the creators/owners';
  systemPrompt += '\n- You are sharing information ON BEHALF OF the creators, not as the owner yourself';

  // Add knowledge base with strict instructions
  if (knowledgeBase && knowledgeBase.trim()) {
    systemPrompt += '\n\n=== COMMUNITY KNOWLEDGE BASE ===';
    systemPrompt += '\n(This information was provided by the community creators/owners for you to share with members)';
    systemPrompt += '\n' + knowledgeBase.trim();
    systemPrompt += '\n=== END OF KNOWLEDGE BASE ===';
    
    systemPrompt += '\n\n📝 IMPORTANT: When sharing this information, rephrase ownership statements:';
    systemPrompt += '\n- Instead of "This is my personal whop" → say "This is the creator\'s personal whop"';
    systemPrompt += '\n- Instead of "my friends and family" → say "the creator\'s friends and family"';
    systemPrompt += '\n- Instead of "I created this" → say "the creator created this"';
    systemPrompt += '\n- Always make it clear you are an assistant sharing the creator\'s information';
  }

  // Add custom instructions
  if (settings.customInstructions && settings.customInstructions.trim()) {
    systemPrompt += '\n\nAdditional instructions from the community creators:\n' + settings.customInstructions.trim();
  }

  // Add ULTRA-STRICT response guidelines
  systemPrompt += '\n\n🚨 ULTRA-STRICT RULES - FOLLOW EXACTLY OR DO NOT RESPOND:';
  
  if (shouldForceResponse) {
    systemPrompt += '\n- You have been directly mentioned or someone replied to your message';
    systemPrompt += '\n- If they ask a question you cannot answer from the knowledge base, say: "I don\'t have specific information about that in my knowledge base. Please contact the community administrators for help."';
    systemPrompt += '\n- If they greet you or say hi, respond politely and ask how you can help with this community';
    systemPrompt += '\n- STILL follow all knowledge base restrictions below even when forced to respond';
  } else {
    systemPrompt += '\n- ONLY respond if you can answer the question with 100% CERTAINTY using ONLY the knowledge base';
    systemPrompt += '\n- If there is ANY doubt, contradiction, or missing information - DO NOT RESPOND AT ALL';
    systemPrompt += '\n- If you cannot answer the question based EXCLUSIVELY on your knowledge base, DO NOT respond at all';
    systemPrompt += '\n- NEVER say "sorry I can\'t help" or similar - just don\'t respond if you can\'t help';
    systemPrompt += '\n- Do NOT respond to casual conversation, greetings, or off-topic chat between users';
  }
  
  // ULTRA-STRICT knowledge base enforcement
  systemPrompt += '\n\n🔒 KNOWLEDGE BASE RESTRICTIONS - ABSOLUTELY CRITICAL:';
  systemPrompt += '\n- You can ONLY use information that is EXPLICITLY and CLEARLY written in the knowledge base above';
  systemPrompt += '\n- If there are ANY contradictions in the knowledge base (different numbers, conflicting info), DO NOT respond at all';
  systemPrompt += '\n- NEVER make assumptions, add details, or infer information not directly stated';
  systemPrompt += '\n- NEVER mention products, services, or concepts not explicitly mentioned in the knowledge base';
  systemPrompt += '\n- If the knowledge base doesn\'t contain the EXACT answer to the question, DO NOT respond at all';
  systemPrompt += '\n- Do NOT combine or extrapolate from knowledge base information';
  systemPrompt += '\n- Stick to the EXACT facts and numbers provided - if numbers conflict, don\'t respond';
  systemPrompt += '\n- If you detect any inconsistency or contradiction in the knowledge base, DO NOT respond';
  
  // Add contradiction detection
  systemPrompt += '\n\n⚠️ CONTRADICTION DETECTION:';
  systemPrompt += '\n- Before responding, check if the knowledge base contains conflicting information';
  systemPrompt += '\n- Look for different numbers, requirements, or rules that contradict each other';
  systemPrompt += '\n- If you find ANY contradictory information, DO NOT respond - the knowledge base needs to be cleaned up first';
  systemPrompt += '\n- Only respond if the information is crystal clear and consistent';
  
  systemPrompt += '\n\n📝 RESPONSE GUIDELINES:';
  systemPrompt += '\n- Keep responses concise and helpful (under 300 characters when possible)';
  systemPrompt += '\n- Quote or paraphrase ONLY from the knowledge base provided';
  systemPrompt += '\n- Use EXACT numbers and facts from the knowledge base - no approximations';
  systemPrompt += '\n- If you don\'t know something from the knowledge base, don\'t respond rather than guessing';
  systemPrompt += '\n- Be respectful and professional in all responses';
  systemPrompt += '\n- Never hallucinate or make up information';
  systemPrompt += '\n- When referring to the community, remember it belongs to the creators, not you';

  return systemPrompt;
}

export function createQuestionAnalysisPrompt(): string {
  return `You are an AI assistant that determines if messages require responses from a community support bot.

The bot can ONLY answer questions using information from a specific community knowledge base. It MUST NOT respond unless it has 100% certainty it can answer correctly.

Respond with "YES" ONLY if the message:
- Contains a very specific, clear question about community requirements, processes, or rules
- Asks for exact numbers, thresholds, or specific criteria (like "how many views needed?")
- Requests specific information about submission requirements, approval processes, or technical specifications
- Reports a specific problem that needs addressing within the community
- Asks "how to" do something very specific within the community

Respond with "NO" if the message:
- Is casual conversation between users (greetings, small talk, "wassup", "how's it going", "hey guys")
- Contains only statements, comments, or personal updates  
- Is off-topic chatter not related to the community's purpose
- Is spam, nonsense, inappropriate, or unclear content
- Contains only emojis, reactions, or very short responses
- Is users talking to each other about unrelated topics
- Is social conversation that doesn't need bot intervention
- Asks about things completely unrelated to the community (general life questions, other topics)
- Asks VAGUE or BROAD questions like "what are the rules?" or "tell me about this place" (too general)
- Asks for information that would require general knowledge rather than community-specific knowledge
- Is a question that's too open-ended or would require the bot to make assumptions
- Asks about technical issues, platform features, or account linking that require admin/platform support
- Contains questions that clearly cannot be answered from a community knowledge base
- Asks for help that requires human judgment or interpretation

IMPORTANT: Only respond "YES" if you are 99% certain the question can be answered with specific, factual information from a community knowledge base. When in doubt, respond "NO". Err on the side of NOT responding rather than guessing.

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
   * Check if knowledge base contains contradictory information
   */
  private hasContradictions(knowledgeBase: string): boolean {
    if (!knowledgeBase || knowledgeBase.trim().length === 0) {
      return false;
    }

    const text = knowledgeBase.toLowerCase();
    
    // Generic approach: Look for multiple different numbers in the same context
    // This will work for any community, not just one specific type
    const sentences = text.split(/[.!?\n]/);
    const numbersInContext = new Map<string, number[]>();
    
    // Extract numbers with their context words
    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence.length < 5) continue;
      
      // Look for numbers followed by common units/contexts
      const numberMatches = trimmedSentence.match(/(\d+(?:k|,\d{3})*)\s*([a-z]+)/gi);
      
      if (numberMatches && numberMatches.length > 0) {
        for (const match of numberMatches) {
          const parts = match.match(/(\d+(?:k|,\d{3})*)\s*([a-z]+)/i);
          if (parts) {
            let num = parseInt(parts[1].replace(/[k,]/g, ''));
            if (parts[1].includes('k')) {
              num = num * 1000;
            }
            
            const context = parts[2].toLowerCase();
            
            if (!numbersInContext.has(context)) {
              numbersInContext.set(context, []);
            }
            numbersInContext.get(context)!.push(num);
          }
        }
      }
    }
    
    // Check for contradictions within the same context
    for (const [context, numbers] of numbersInContext.entries()) {
      const uniqueNumbers = [...new Set(numbers)];
      if (uniqueNumbers.length > 1) {
        logger.warn('Knowledge base contradiction detected', {
          context,
          conflictingNumbers: uniqueNumbers,
          knowledgeBase: knowledgeBase.substring(0, 200)
        });
        return true;
      }
    }
    
    return false;
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

      // Check for contradictions in knowledge base before generating response
      if (knowledgeBase && this.hasContradictions(knowledgeBase)) {
        logger.warn('Knowledge base has contradictions - not responding', {
          companyId,
          messagePreview: truncatedMessage.substring(0, 50)
        });
        
        // If forced to respond (mentioned), provide a helpful message
        if (shouldForceResponse && username) {
          return `@${username} I noticed there's conflicting information in my knowledge base. Please contact the community administrators to clarify the requirements.`;
        }
        
        return null;
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
      
      // Filter out "sorry" type responses - treat them as no response
      if (aiResponse) {
        const responseLower = aiResponse.toLowerCase();
        const sorryPatterns = [
          'sorry',
          'can\'t help',
          'cannot help',
          'unable to help',
          'don\'t have information',
          'not related to',
          'unrelated to',
          'off-topic',
          'not relevant',
          'outside my knowledge',
          'beyond my scope'
        ];
        
        // If the response contains any "sorry" patterns, treat it as no response
        if (sorryPatterns.some(pattern => responseLower.includes(pattern))) {
          logger.debug('Filtered out "sorry" type response', {
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