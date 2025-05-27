import { logger } from './logger';
import { config } from './config';
import { messageRateLimiter, RateLimitConfigs } from './rate-limiter';

// Headers for fetch requests
const fetchApiHeaders: HeadersInit = {
  "Content-Type": "application/json",
};
if (config.WHOP_APP_API_KEY) {
  fetchApiHeaders["Authorization"] = `Bearer ${config.WHOP_APP_API_KEY}`;
}
if (config.WHOP_AGENT_USER_ID) {
  fetchApiHeaders["x-on-behalf-of"] = config.WHOP_AGENT_USER_ID;
}

class WhopAPI {
  private messageQueue = new Map<string, Promise<boolean>>();

  /**
   * Check if the request is rate limited
   */
  private async checkRateLimit(feedId: string): Promise<boolean> {
    const result = await messageRateLimiter.checkLimit(feedId, RateLimitConfigs.MESSAGE_SEND);
    
    if (!result.allowed) {
      logger.warn('Message rate limit exceeded', {
        feedId,
        remaining: result.remaining,
        retryAfter: result.retryAfter,
        action: 'message_rate_limited',
      });
    }
    
    return result.allowed;
  }

  /**
   * Send a message to a feed
   */
  async sendMessage(feedId: string, message: string): Promise<boolean> {
    if (!config.WHOP_APP_API_KEY) {
      logger.error("WHOP_APP_API_KEY not configured", undefined, {
        feedId,
        action: 'send_message_failed',
      });
      return false;
    }

    // Check rate limiting
    if (!(await this.checkRateLimit(feedId))) {
      return false;
    }

    // Deduplicate concurrent identical messages
    const messageKey = `${feedId}:${message}`;
    if (this.messageQueue.has(messageKey)) {
      logger.debug('Deduplicating message send', {
        feedId,
        messageLength: message.length,
        action: 'message_deduplicated',
      });
      return await this.messageQueue.get(messageKey)!;
    }

    const promise = this.performMessageSend(feedId, message);
    this.messageQueue.set(messageKey, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up the request from queue after a short delay
      setTimeout(() => {
        this.messageQueue.delete(messageKey);
      }, 3000);
    }
  }

  /**
   * Perform the actual message send
   */
  private async performMessageSend(feedId: string, message: string): Promise<boolean> {
    const mutation = `mutation sendMessage($input: SendMessageInput!) {
      sendMessage(input: $input)
    }`;

    let feedType = "dms_feed"; // default
    if (feedId.startsWith("chat_feed_")) {
      feedType = "chat_feed";
    } else if (feedId.startsWith("forum_feed_")) {
      feedType = "forum_feed";
    }

    const payload = {
      query: mutation,
      variables: {
        input: {
          feedId,
          feedType,
          message,
        },
      },
    };

    try {
      logger.info('Sending message to feed', {
        feedId,
        feedType,
        messageLength: message.length,
        action: 'sending_message',
      });
      
      const response = await fetch("https://api.whop.com/public-graphql", {
        method: "POST",
        headers: fetchApiHeaders,
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        logger.error(`Failed to send message (${response.status})`, undefined, {
          feedId,
          statusCode: response.status,
          responseText: responseText.substring(0, 500),
          action: 'send_message_failed',
        });
        return false;
      }

      const responseData = JSON.parse(responseText);
      if (responseData.errors) {
        logger.error("GraphQL errors in message send", undefined, {
          feedId,
          errors: responseData.errors,
          action: 'graphql_errors',
        });
        return false;
      }

      logger.info("Message sent successfully", {
        feedId,
        messageId: responseData.data?.sendMessage,
        action: 'message_sent',
      });
      
      await logger.logMetric('whop_api.message_sent.success', 1, { feedId, feedType });
      return true;
    } catch (error) {
      logger.error("Error sending message", error, {
        feedId,
        action: 'send_message_error',
      });
      
      await logger.logMetric('whop_api.message_sent.error', 1, { feedId, feedType });
      return false;
    }
  }

  /**
   * Send message with retry logic
   */
  async sendMessageWithRetry(feedId: string, message: string, maxRetries: number = config.MAX_RETRIES): Promise<boolean> {
    return await logger.withTiming('send_message_with_retry', async () => {
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const success = await this.sendMessage(feedId, message);
        if (success) {
          if (attempt > 1) {
            logger.info('Message send succeeded after retry', {
              feedId,
              attempt,
              totalAttempts: maxRetries + 1,
              action: 'retry_success',
            });
          }
          return true;
        }

        if (attempt <= maxRetries) {
          const delay = config.RETRY_DELAY_MS * attempt; // Exponential backoff
          logger.warn('Retrying message send', {
            feedId,
            attempt: attempt + 1,
            totalAttempts: maxRetries + 1,
            delayMs: delay,
            action: 'retrying_message',
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      logger.error(`Failed to send message after all retry attempts`, undefined, {
        feedId,
        totalAttempts: maxRetries + 1,
        action: 'all_retries_failed',
      });
      
      await logger.logMetric('whop_api.message_retry.failed', 1, { feedId });
      return false;
    }, { feedId });
  }

  /**
   * Get stats about the API service
   */
  getStats() {
    const rateLimiterStats = messageRateLimiter.getStats();
    return {
      queuedMessages: this.messageQueue.size,
      rateLimitedFeeds: rateLimiterStats.totalEntries,
      activeRequests: Array.from(this.messageQueue.keys()),
      rateLimiterStats,
    };
  }

  /**
   * Clear rate limits (for testing or admin purposes)
   */
  clearRateLimits() {
    messageRateLimiter.clear();
    logger.info('Cleared all message rate limits', {
      action: 'rate_limits_cleared',
    });
  }
}

export const whopAPI = new WhopAPI();
