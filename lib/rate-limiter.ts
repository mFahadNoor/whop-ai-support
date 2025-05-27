import { logger } from './logger';
import { config } from './config';

interface RateLimitEntry {
  count: number;
  resetTime: number;
  firstRequestTime: number;
}

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyPrefix: string;
}

class RateLimiter {
  private limitsMap = new Map<string, RateLimitEntry>();
  private cleanupInterval?: NodeJS.Timeout;
  
  constructor() {
    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Check if a request is within rate limits
   */
  async checkLimit(key: string, options: RateLimitOptions): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  }> {
    const now = Date.now();
    const fullKey = `${options.keyPrefix}:${key}`;
    
    let entry = this.limitsMap.get(fullKey);
    
    // If no entry exists or the window has expired, create/reset
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 1,
        resetTime: now + options.windowMs,
        firstRequestTime: now,
      };
      this.limitsMap.set(fullKey, entry);
      
      logger.debug('Rate limit entry created/reset', {
        key: fullKey,
        windowMs: options.windowMs,
        maxRequests: options.maxRequests,
      });
      
      return {
        allowed: true,
        remaining: options.maxRequests - 1,
        resetTime: entry.resetTime,
      };
    }
    
    // Check if we're within limits
    if (entry.count >= options.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      
      logger.warn('Rate limit exceeded', {
        key: fullKey,
        count: entry.count,
        maxRequests: options.maxRequests,
        retryAfter,
        action: 'rate_limit_exceeded',
      });
      
      // Log metric for monitoring
      await logger.logMetric('rate_limit.exceeded', 1, {
        prefix: options.keyPrefix,
        key,
        maxRequests: options.maxRequests,
      });
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
        retryAfter,
      };
    }
    
    // Increment count
    entry.count++;
    
    logger.debug('Rate limit check passed', {
      key: fullKey,
      count: entry.count,
      remaining: options.maxRequests - entry.count,
    });
    
    return {
      allowed: true,
      remaining: options.maxRequests - entry.count,
      resetTime: entry.resetTime,
    };
  }

  /**
   * Get current rate limit status without incrementing
   */
  getStatus(key: string, options: RateLimitOptions): {
    count: number;
    remaining: number;
    resetTime: number;
  } {
    const now = Date.now();
    const fullKey = `${options.keyPrefix}:${key}`;
    const entry = this.limitsMap.get(fullKey);
    
    if (!entry || now > entry.resetTime) {
      return {
        count: 0,
        remaining: options.maxRequests,
        resetTime: now + options.windowMs,
      };
    }
    
    return {
      count: entry.count,
      remaining: Math.max(0, options.maxRequests - entry.count),
      resetTime: entry.resetTime,
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  resetLimit(key: string, options: RateLimitOptions): void {
    const fullKey = `${options.keyPrefix}:${key}`;
    this.limitsMap.delete(fullKey);
    
    logger.info('Rate limit reset', {
      key: fullKey,
      action: 'rate_limit_reset',
    });
  }

  /**
   * Clean up expired entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    const beforeSize = this.limitsMap.size;
    let removed = 0;
    
    for (const [key, entry] of this.limitsMap.entries()) {
      if (now > entry.resetTime) {
        this.limitsMap.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug('Rate limiter cleanup completed', {
        beforeSize,
        afterSize: this.limitsMap.size,
        removed,
        action: 'rate_limit_cleanup',
      });
      
      // Log cleanup metrics
      logger.logMetric('rate_limit.cleanup.entries_removed', removed);
      logger.logMetric('rate_limit.memory.active_entries', this.limitsMap.size);
    }
    
    // Additional memory protection - if we have too many entries, log a warning
    if (this.limitsMap.size > config.MAX_MEMORY_CACHE_SIZE) {
      logger.warn('Rate limiter memory usage high', {
        entries: this.limitsMap.size,
        maxSize: config.MAX_MEMORY_CACHE_SIZE,
        action: 'memory_warning',
      });
    }
  }

  /**
   * Get statistics about rate limiter usage
   */
  getStats(): {
    totalEntries: number;
    activeEntries: number;
    expiredEntries: number;
  } {
    const now = Date.now();
    let activeEntries = 0;
    let expiredEntries = 0;
    
    for (const entry of this.limitsMap.values()) {
      if (now > entry.resetTime) {
        expiredEntries++;
      } else {
        activeEntries++;
      }
    }
    
    return {
      totalEntries: this.limitsMap.size,
      activeEntries,
      expiredEntries,
    };
  }

  /**
   * Force cleanup and clear all entries
   */
  clear(): void {
    const size = this.limitsMap.size;
    this.limitsMap.clear();
    
    logger.info('Rate limiter cleared', {
      clearedEntries: size,
      action: 'rate_limit_clear',
    });
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.clear();
  }
}

// Create rate limiter instances for different services
export const aiRateLimiter = new RateLimiter();
export const messageRateLimiter = new RateLimiter();

// Predefined rate limit configurations
export const RateLimitConfigs = {
  AI_ANALYSIS: {
    maxRequests: config.AI_RATE_LIMIT_PER_MINUTE,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'ai',
  },
  MESSAGE_SEND: {
    maxRequests: config.MESSAGE_RATE_LIMIT_PER_MINUTE,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'message',
  },
  FORUM_POST: {
    maxRequests: 5, // More restrictive for forum posts
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'forum',
  },
} as const;

// Cleanup on process exit
process.on('exit', () => {
  aiRateLimiter.destroy();
  messageRateLimiter.destroy();
});

process.on('SIGINT', () => {
  aiRateLimiter.destroy();
  messageRateLimiter.destroy();
});

process.on('SIGTERM', () => {
  aiRateLimiter.destroy();
  messageRateLimiter.destroy();
}); 