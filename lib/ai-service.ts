import { BotSettings } from './types';
import { logger } from './logger';
import { config } from './config';
import { aiRateLimiter, RateLimitConfigs } from './rate-limiter';
import {
  SYSTEM_PROMPT,
  buildPrompt,
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt
} from './ai-prompts';

interface AIResponse {
  shouldRespond: boolean;
  response: string | null;
  reason: string;
}

class AIService {
  private requestQueue = new Map<string, Promise<string | null>>();

  /**
   * Check if the request is rate limited
   */
  private async checkRateLimit(companyId: string): Promise<boolean> {
    const result = await aiRateLimiter.checkLimit(companyId, RateLimitConfigs.AI_ANALYSIS);
    return result.allowed;
  }

  /**
   * Check if message contains question indicators
   */
  private containsQuestionIndicators(message: string): boolean {
    // Skip very short messages (likely not real questions)
    if (message.trim().length < 3) {
      return false;
    }
    
    // Skip very long messages (likely spam or not questions)
    if (message.length > 500) {
      return false;
    }
    
    // Skip messages that are mostly emojis or special characters
    const alphanumericCount = (message.match(/[a-zA-Z0-9]/g) || []).length;
    if (alphanumericCount < message.length * 0.3) {
      return false;
    }
    
    const questionWords = ['how', 'what', 'why', 'when', 'where', 'can', 'is', 'are', 'do', 'does', 'will', 'would', 'could', 'should', 'who', 'which'];
    const messageLower = message.toLowerCase();
    
    // Check for question mark
    if (message.includes('?')) {
      return true;
    }
    
    // Check for question words at the beginning of message
    const words = messageLower.split(' ');
    return questionWords.some(qWord => words[0] === qWord);
  }

  /**
   * Check for direct preset Q&A matches first
   */
  private checkPresetQA(question: string, presetQA: Array<{id: string, question: string, answer: string, enabled: boolean}>): string | null {
    if (!presetQA || presetQA.length === 0) {
      return null;
    }

    const questionLower = question.toLowerCase().trim();
    
    for (const qa of presetQA) {
      if (!qa.enabled) continue;
      
      const qaQuestionLower = qa.question.toLowerCase().trim();
      
      // Check for exact match or very similar match
      if (qaQuestionLower === questionLower) {
        return qa.answer;
      }
      
      // Check for partial match (question contains the preset question or vice versa)
      if (questionLower.includes(qaQuestionLower) || qaQuestionLower.includes(questionLower)) {
        // Only match if it's substantial (at least 60% similarity)
        const similarity = Math.max(
          qaQuestionLower.length / questionLower.length,
          questionLower.length / qaQuestionLower.length
        );
        if (similarity >= 0.6) {
          return qa.answer;
        }
      }
    }
    
    return null;
  }

  /**
   * Cache for recent similar questions to avoid duplicate AI calls
   */
  private similarQuestionCache = new Map<string, { answer: string | null, timestamp: number }>();
  private readonly CACHE_TTL = 300000; // 5 minutes
  
  /**
   * Check if we have a cached answer for a similar question
   */
  private checkSimilarQuestionCache(question: string, companyId: string): string | null {
    const questionKey = `${companyId}:${question.toLowerCase().trim()}`;
    const cached = this.similarQuestionCache.get(questionKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.answer;
    }
    
    // Clean up expired cache entries periodically
    if (this.similarQuestionCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of this.similarQuestionCache.entries()) {
        if ((now - value.timestamp) > this.CACHE_TTL) {
          this.similarQuestionCache.delete(key);
        }
      }
    }
    
    return null;
  }
  
  /**
   * Store answer in similar question cache
   */
  private storeSimilarQuestionCache(question: string, companyId: string, answer: string | null): void {
    const questionKey = `${companyId}:${question.toLowerCase().trim()}`;
    this.similarQuestionCache.set(questionKey, {
      answer,
      timestamp: Date.now()
    });
  }

  /**
   * Analyze a question with AI
   */
  async analyzeQuestion(
    question: string, 
    knowledgeBase: string, 
    settings: BotSettings,
    companyId: string
  ): Promise<string | null> {
    if (!settings.enabled) {
      return null;
    }

    // First check: Does the message contain question indicators?
    if (!this.containsQuestionIndicators(question)) {
      logger.debug('Message does not contain question indicators, skipping AI', {
        companyId,
        questionPreview: question.substring(0, 50),
        action: 'ai_skipped_no_question',
      });
      return null;
    }

    // Second check: Look for direct preset Q&A matches first
    if (settings.presetQA && settings.presetQA.length > 0) {
      const presetAnswer = this.checkPresetQA(question, settings.presetQA);
      if (presetAnswer) {
        logger.info('Found direct preset Q&A match', {
          companyId,
          questionPreview: question.substring(0, 50),
          action: 'preset_qa_match',
        });
        await logger.logMetric('ai.preset_qa.used', 1, { companyId });
        return presetAnswer;
      }
    }

    // Third check: Look for cached similar questions
    const cachedAnswer = this.checkSimilarQuestionCache(question, companyId);
    if (cachedAnswer !== null) {
      logger.info('Found cached answer for similar question', {
        companyId,
        questionPreview: question.substring(0, 50),
        action: 'cached_answer_used',
      });
      await logger.logMetric('ai.cache.hit', 1, { companyId });
      return cachedAnswer;
    }

    if (!config.OPENROUTER_API_KEY) {
      logger.error('OPENROUTER_API_KEY not found in environment variables', undefined, {
        companyId,
        action: 'missing_api_key',
      });
      return null;
    }

    if (!(await this.checkRateLimit(companyId))) {
      logger.warn('AI rate limit exceeded', {
        companyId,
        questionPreview: question.substring(0, 50),
        action: 'ai_rate_limited',
      });
      return null;
    }

    const requestKey = `${companyId}:${question.toLowerCase().trim()}`;
    if (this.requestQueue.has(requestKey)) {
      logger.debug('Deduplicating AI request', {
        companyId,
        questionPreview: question.substring(0, 50),
        action: 'ai_request_deduplicated',
      });
      return await this.requestQueue.get(requestKey)!;
    }

    // Use AI with preset Q&A included in prompt
    const prompt = buildPrompt(question, knowledgeBase, settings.presetQA || []);
    
    const promise = this.performAIRequest(prompt, companyId);
    this.requestQueue.set(requestKey, promise);

    try {
      const result = await promise;
      // Store result in cache for future similar questions
      this.storeSimilarQuestionCache(question, companyId, result);
      return result;
    } finally {
      // Clean up the request from queue after a short delay
      setTimeout(() => {
        this.requestQueue.delete(requestKey);
      }, 5000);
    }
  }

  /**
   * Perform the actual AI request
   */
  private async performAIRequest(question: string, companyId: string): Promise<string | null> {
    return await logger.withTiming('ai_analysis', async () => {
      try {
        logger.info('Analyzing message with AI', {
          companyId,
          questionLength: question.length,
          model: config.OPENROUTER_MODEL,
          action: 'ai_analysis_start',
        });
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://whop.com',
            'X-Title': 'Whop AI Bot'
          },
          body: JSON.stringify({
            model: config.OPENROUTER_MODEL,
            messages: [
              { role: 'user', content: question }
            ],
            max_tokens: 400,
            temperature: 0.3, // Lower temperature for more consistent JSON responses
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('OpenRouter API error', undefined, {
            companyId,
            statusCode: response.status,
            errorText: errorText.substring(0, 500),
            action: 'openrouter_api_error',
          });
          await logger.logMetric('ai.openrouter.error', 1, { companyId, status: response.status });
          return null;
        }

        const data = await response.json();
        const aiResponseText = data.choices[0]?.message?.content?.trim();
        
        if (!aiResponseText) {
          logger.error('No response from AI', undefined, {
            companyId,
            action: 'ai_no_response',
          });
          await logger.logMetric('ai.response.empty', 1, { companyId });
          return null;
        }

        // Clean up potential markdown code block
        let cleanResponseText = aiResponseText;
        if (cleanResponseText.startsWith("```json")) {
          cleanResponseText = cleanResponseText.substring(7);
        }
        if (cleanResponseText.endsWith("```")) {
          cleanResponseText = cleanResponseText.substring(0, cleanResponseText.length - 3);
        }
        cleanResponseText = cleanResponseText.trim();

        // Parse the JSON response
        try {
          const aiResponse: AIResponse = JSON.parse(cleanResponseText);
          
          logger.info('AI analysis completed', {
            companyId,
            shouldRespond: aiResponse.shouldRespond,
            reason: aiResponse.reason,
            responseLength: aiResponse.response?.length || 0,
            action: 'ai_analysis_complete',
          });
          
          if (aiResponse.shouldRespond && aiResponse.response) {
            await logger.logMetric('ai.response.provided', 1, { companyId });
            return aiResponse.response;
          } else {
            await logger.logMetric('ai.response.declined', 1, { companyId });
            return null;
          }
        } catch (parseError) {
          logger.error('Failed to parse AI JSON response', parseError, {
            companyId,
            rawResponse: aiResponseText.substring(0, 500),
            action: 'ai_parse_error',
          });
          await logger.logMetric('ai.response.parse_error', 1, { companyId });
          return null;
        }
      } catch (error) {
        logger.error('Error analyzing question with AI', error, {
          companyId,
          action: 'ai_analysis_error',
        });
        await logger.logMetric('ai.analysis.error', 1, { companyId });
        return null;
      }
    }, { companyId });
  }

  /**
   * Generate a feed summary
   */
  async generateFeedSummary(
    messages: Array<{content: string, user: string, timestamp: Date}>,
    companyId: string
  ): Promise<string | null> {
    if (messages.length === 0) {
      return "No recent messages to summarize.";
    }

    if (!config.OPENROUTER_API_KEY) {
      logger.error('OPENROUTER_API_KEY not found for summary generation', undefined, {
        companyId,
        action: 'summary_missing_api_key',
      });
      return "Unable to generate summary - API key not configured.";
    }

    // Check rate limiting
    if (!(await this.checkRateLimit(companyId))) {
      logger.warn('Summary rate limit exceeded', {
        companyId,
        action: 'summary_rate_limited',
      });
      return "⚠️ Too many summary requests. Please wait a moment before requesting another summary.";
    }

    const conversationText = messages
      .slice(-20) // Last 20 messages
      .map(msg => `${msg.user}: ${msg.content}`)
      .join('\n');

    const prompt = `Summarize this conversation in a concise, engaging way. Focus on key topics discussed and important information shared:

${conversationText}

Summary:`;

    return await logger.withTiming('feed_summary_generation', async () => {
      try {
        logger.info('Generating feed summary', {
          companyId,
          messageCount: messages.length,
          action: 'summary_generation_start',
        });
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://whop.com',
            'X-Title': 'Whop AI Bot'
          },
          body: JSON.stringify({
            model: config.OPENROUTER_MODEL,
            messages: [
              { role: 'system', content: 'You are a helpful assistant that creates concise conversation summaries.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 200,
            temperature: 0.5,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('OpenRouter API error during summary generation', undefined, {
            companyId,
            statusCode: response.status,
            errorText: errorText.substring(0, 500),
            action: 'summary_api_error',
          });
          await logger.logMetric('ai.summary.api_error', 1, { companyId });
          return "Unable to generate summary at this time.";
        }

        const data = await response.json();
        const summary = data.choices[0]?.message?.content?.trim();
        
        if (summary) {
          logger.info('Feed summary generated successfully', {
            companyId,
            summaryLength: summary.length,
            action: 'summary_generated',
          });
          await logger.logMetric('ai.summary.success', 1, { companyId });
          return summary;
        } else {
          logger.error('No valid summary from AI', undefined, {
            companyId,
            action: 'summary_empty_response',
          });
          await logger.logMetric('ai.summary.empty', 1, { companyId });
          return "Unable to generate summary at this time.";
        }
      } catch (error) {
        logger.error('Error generating summary', error, {
          companyId,
          action: 'summary_generation_error',
        });
        await logger.logMetric('ai.summary.error', 1, { companyId });
        return "Unable to generate summary at this time.";
      }
    }, { companyId });
  }

  /**
   * Get stats about the AI service
   */
  getStats() {
    const rateLimiterStats = aiRateLimiter.getStats();
    return {
      activeRequests: this.requestQueue.size,
      rateLimitedCompanies: rateLimiterStats.totalEntries,
      queuedRequests: Array.from(this.requestQueue.keys()),
      rateLimiterStats,
    };
  }

  /**
   * Clear rate limits (for testing or admin purposes)
   */
  clearRateLimits() {
    aiRateLimiter.clear();
    logger.info('Cleared all AI rate limits', {
      action: 'ai_rate_limits_cleared',
    });
  }
}

export const aiService = new AIService(); 