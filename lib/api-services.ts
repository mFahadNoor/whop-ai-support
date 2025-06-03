/**
 * API Services - Whop Platform Integration
 * 
 * This module provides high-level services for integrating with the Whop platform.
 * It handles WebSocket communication, message sending, and API interactions.
 * 
 * Key Features:
 * - WhopAPI: Message sending and API interactions
 * - Rate limiting and retry logic for reliability
 * - Error handling and logging for production use
 * - Message formatting and validation
 * 
 * Service Classes:
 * - WhopAPI: Core API communication and message sending
 * 
 * Usage:
 * ```typitten
 * // Send a message
 * await whopAPI.sendMessage(feedId, 'Hello world!');
 * 
 * // Get API stats
 * const stats = whopAPI.getStats();
 * ```
 */

import crypto from 'crypto';
import { config, logger, retry } from './shared-utils';
import { WhopAPI } from '@whop-apps/sdk';

// =============================================================================
// WHOP API WRAPPER
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class WhopAPIService {
  private baseURL = 'https://api.whop.com/api/v1';
  private messageRateLimit = new Map<string, RateLimitEntry>();
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
  private stats = {
    messagesSent: 0,
    messagesRateLimited: 0,
    apiErrors: 0,
    lastMessageTime: null as Date | null
  };

  constructor() {
    // Periodic cleanup
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Send a message to a Whop feed with rate limiting and retry logic
   * Returns the message ID if successful, null if failed
   */
  async sendMessageWithRetry(feedId: string, content: string): Promise<string | null> {
    try {
      // Rate limiting check
      if (!this.isMessageAllowed(feedId)) {
        this.stats.messagesRateLimited++;
        logger.warn('Message rate limit exceeded', { feedId, contentPreview: content.substring(0, 50) });
        return null;
      }

      // Validate content
      if (!content || content.trim().length === 0) {
        logger.warn('Attempted to send empty message', { feedId });
        return null;
      }

      if (content.length > config.MAX_MESSAGE_LENGTH) {
        content = content.substring(0, config.MAX_MESSAGE_LENGTH - 3) + '...';
        logger.warn('Message truncated due to length', { feedId, originalLength: content.length });
      }

      // Use GraphQL for sending messages to Whop
      const result = await retry(async () => {
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          'Content-Type': 'application/json',
        };

        // Add on-behalf-of header with agent user ID
        if (config.WHOP_AGENT_USER_ID) {
          headers['x-on-behalf-of'] = config.WHOP_AGENT_USER_ID;
        }

        // Determine feed type based on feedId prefix
        let feedType = "dms_feed"; // default
        if (feedId.startsWith("chat_feed_")) {
          feedType = "chat_feed";
        } else if (feedId.startsWith("forum_feed_")) {
          feedType = "forum_feed";
        } else if (feedId.startsWith("dm_")) {
          feedType = "dms_feed";
        }

        // GraphQL mutation to send a message
        const mutation = `
          mutation sendMessage($input: SendMessageInput!) {
            sendMessage(input: $input)
          }
        `;

        const response = await fetch('https://api.whop.com/public-graphql', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: mutation,
            variables: {
              input: {
                feedId: feedId,
                feedType: feedType,
                message: content,
              },
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText} - ${await response.text()}`);
        }

        const result = await response.json();
        
        if (result.errors) {
          throw new Error(`GraphQL Error: ${result.errors.map((e: any) => e.message).join(', ')}`);
        }

        if (!result.data?.sendMessage) {
          throw new Error('Failed to send message - no data returned');
        }

        // The sendMessage mutation should return the message ID
        // If it's just a string, that's the message ID
        // If it's an object, it might have an id field
        let messageId = result.data.sendMessage;
        if (typeof messageId === 'object' && messageId.id) {
          messageId = messageId.id;
        }

        return messageId;
      });

      if (result) {
        this.stats.messagesSent++;
        this.stats.lastMessageTime = new Date();
        logger.info('Message sent successfully via GraphQL', {
          feedId,
          messageId: result,
          action: 'message_sent_success'
        });
        return result;
      }

      return null;

    } catch (error) {
      this.stats.apiErrors++;
      logger.error('Failed to send message after retries', error as Error, { 
        feedId, 
        contentPreview: content.substring(0, 50),
        apiErrors: this.stats.apiErrors
      });
      return null;
    }
  }

  /**
   * Check if sending a message to a feed is allowed (rate limiting)
   */
  private isMessageAllowed(feedId: string): boolean {
    const now = Date.now();
    const entry = this.messageRateLimit.get(feedId);

    if (!entry || now > entry.resetTime) {
      // First message or window expired
      this.messageRateLimit.set(feedId, {
        count: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW_MS
      });
      return true;
    }

    if (entry.count >= config.MESSAGE_RATE_LIMIT_PER_MINUTE) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Get information about a company
   */
  async getCompany(companyId: string): Promise<any> {
    try {
      const response = await retry(async () => {
        return await fetch(`${this.baseURL}/companies/${companyId}`, {
          headers: {
            'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          },
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Failed to fetch company info', error as Error, { companyId });
      return null;
    }
  }

  /**
   * Get information about an experience
   */
  async getExperience(experienceId: string): Promise<any> {
    try {
      const response = await retry(async () => {
        return await fetch(`${this.baseURL}/experiences/${experienceId}`, {
          headers: {
            'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          },
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Failed to fetch experience info', error as Error, { experienceId });
      return null;
    }
  }

  /**
   * Get all experiences for this app (for discovering mappings)
   */
  async getAppExperiences(): Promise<Array<{id: string, company_id: string}> | null> {
    try {
      const response = await retry(async () => {
        return await fetch('https://api.whop.com/v5/app/experiences', {
          headers: {
            'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          },
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      logger.error('Failed to fetch app experiences', error as Error);
      return null;
    }
  }

  /**
   * Get user information
   */
  async getUser(userId: string): Promise<any> {
    try {
      // Use the official Whop SDK to get user information
      const response = await WhopAPI.app().GET("/app/users/{id}", {
        params: { path: { id: userId } }
      });
      
      if (response.data) {
        return response.data;
      }
      return null;
    } catch (error) {
      logger.error('Failed to fetch user info via SDK', error as Error, { userId });
      return null;
    }
  }

  /**
   * Check if user has access to a company/experience
   */
  async checkUserAccess(userId: string, companyId: string): Promise<boolean> {
    try {
      // This would need to be implemented based on Whop's API
      // For now, return true as a placeholder
      return true;
    } catch (error) {
      logger.error('Failed to check user access', error as Error, { userId, companyId });
      return false;
    }
  }

  /**
   * Get feed information
   */
  async getFeed(feedId: string): Promise<any> {
    try {
      const response = await retry(async () => {
        return await fetch(`${this.baseURL}/posts/feed/${feedId}`, {
          headers: {
            'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          },
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Failed to fetch feed info', error as Error, { feedId });
      return null;
    }
  }

  /**
   * Get recent posts from a feed
   */
  async getFeedPosts(feedId: string, limit: number = 10): Promise<any[]> {
    try {
      const response = await retry(async () => {
        return await fetch(`${this.baseURL}/posts/feed/${feedId}?limit=${Math.min(limit, 50)}`, {
          headers: {
            'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          },
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      logger.error('Failed to fetch feed posts', error as Error, { feedId, limit });
      return [];
    }
  }

  /**
   * Clear rate limits (for admin use)
   */
  clearRateLimits() {
    this.messageRateLimit.clear();
    logger.info('Cleared message rate limits');
  }

  /**
   * Cleanup expired rate limit entries
   */
  private cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [feedId, entry] of this.messageRateLimit.entries()) {
      if (now > entry.resetTime) {
        this.messageRateLimit.delete(feedId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up expired rate limit entries', { cleanedCount });
    }
  }

  /**
   * Get API statistics
   */
  getStats() {
    return {
      messagesSent: this.stats.messagesSent,
      messagesRateLimited: this.stats.messagesRateLimited,
      apiErrors: this.stats.apiErrors,
      lastMessageTime: this.stats.lastMessageTime,
      rateLimitedFeeds: this.messageRateLimit.size
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const whopAPI = new WhopAPIService();