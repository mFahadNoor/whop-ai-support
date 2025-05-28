import { config, logger, retry, sleep } from './shared-utils';

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
   */
  async sendMessageWithRetry(feedId: string, content: string): Promise<boolean> {
    try {
      // Rate limiting check
      if (!this.isMessageAllowed(feedId)) {
        this.stats.messagesRateLimited++;
        logger.warn('Message rate limit exceeded', { feedId, contentPreview: content.substring(0, 50) });
        return false;
      }

      // Validate content
      if (!content || content.trim().length === 0) {
        logger.warn('Attempted to send empty message', { feedId });
        return false;
      }

      if (content.length > config.MAX_MESSAGE_LENGTH) {
        content = content.substring(0, config.MAX_MESSAGE_LENGTH - 3) + '...';
        logger.warn('Message truncated due to length', { feedId, originalLength: content.length });
      }

      // Send message with retry logic
      const success = await retry(async () => {
        const response = await fetch(`${this.baseURL}/posts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.WHOP_APP_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            feed_id: feedId,
            content: content.trim(),
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return true;
      }, config.MAX_RETRIES, config.RETRY_DELAY_MS);

      if (success) {
        this.stats.messagesSent++;
        this.stats.lastMessageTime = new Date();
        
        logger.debug('Message sent successfully', { 
          feedId, 
          contentLength: content.length,
          messagesSent: this.stats.messagesSent
        });
      }

      return success;

    } catch (error) {
      this.stats.apiErrors++;
      logger.error('Failed to send message after retries', error as Error, { 
        feedId, 
        contentPreview: content.substring(0, 50),
        apiErrors: this.stats.apiErrors
      });
      return false;
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
            'Authorization': `Bearer ${config.WHOP_APP_API_KEY}`,
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
            'Authorization': `Bearer ${config.WHOP_APP_API_KEY}`,
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
   * Get user information
   */
  async getUser(userId: string): Promise<any> {
    try {
      const response = await retry(async () => {
        return await fetch(`${this.baseURL}/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${config.WHOP_APP_API_KEY}`,
          },
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Failed to fetch user info', error as Error, { userId });
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
            'Authorization': `Bearer ${config.WHOP_APP_API_KEY}`,
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
            'Authorization': `Bearer ${config.WHOP_APP_API_KEY}`,
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
// WEBHOOK HANDLERS
// =============================================================================

export class WebhookService {
  private webhookSecret: string | null;

  constructor() {
    this.webhookSecret = config.WHOP_WEBHOOK_SECRET || null;
  }

  /**
   * Verify webhook signature
   */
  verifySignature(body: string, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.warn('Webhook secret not configured, skipping signature verification');
      return true; // Allow if no secret configured
    }

    try {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(body)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error('Error verifying webhook signature', error as Error);
      return false;
    }
  }

  /**
   * Process webhook events
   */
  async processWebhook(event: any): Promise<void> {
    try {
      logger.info('Processing webhook event', { 
        type: event.type,
        id: event.id,
        timestamp: event.timestamp 
      });

      switch (event.type) {
        case 'company.updated':
          await this.handleCompanyUpdated(event);
          break;
        case 'experience.updated':
          await this.handleExperienceUpdated(event);
          break;
        case 'user.membership.created':
          await this.handleMembershipCreated(event);
          break;
        case 'user.membership.deleted':
          await this.handleMembershipDeleted(event);
          break;
        default:
          logger.debug('Unhandled webhook event type', { type: event.type });
      }
    } catch (error) {
      logger.error('Error processing webhook', error as Error, { eventType: event.type, eventId: event.id });
    }
  }

  private async handleCompanyUpdated(event: any) {
    // Clear company cache when company is updated
    const companyId = event.data?.id;
    if (companyId) {
      const { dataManager } = await import('./data-manager');
      dataManager.clearCache(companyId);
      logger.info('Cleared cache for updated company', { companyId });
    }
  }

  private async handleExperienceUpdated(event: any) {
    // Handle experience updates
    logger.info('Experience updated', { experienceId: event.data?.id });
  }

  private async handleMembershipCreated(event: any) {
    // Handle new memberships
    logger.info('Membership created', { 
      userId: event.data?.user_id,
      companyId: event.data?.company_id 
    });
  }

  private async handleMembershipDeleted(event: any) {
    // Handle membership deletions
    logger.info('Membership deleted', { 
      userId: event.data?.user_id,
      companyId: event.data?.company_id 
    });
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const whopAPI = new WhopAPIService();
export const webhookService = new WebhookService(); 