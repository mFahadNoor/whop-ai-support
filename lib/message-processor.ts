import { ProcessedMessage, WebSocketMessage } from './types';
import { companyManager } from './company-manager';
import { logger } from './logger';

const WHOP_AGENT_USER_ID = process.env.WHOP_AGENT_USER_ID;

class MessageProcessor {
  private processedMessages = new Set<string>();
  private recentMessages = new Map<string, Array<{content: string, user: string, timestamp: Date}>>();
  private recentUserMessages = new Map<string, {content: string, timestamp: Date}>();
  private readonly MAX_PROCESSED_MESSAGES = 2000; // Increased capacity
  private readonly DUPLICATE_WINDOW_MS = 15000; // Increased to 15 seconds

  /**
   * Process incoming WebSocket message
   */
  async processWebSocketMessage(messageData: WebSocketMessage): Promise<ProcessedMessage | null> {
    // Check if this is an experience mapping message
    if (messageData.experience?.id && messageData.experience?.bot?.id) {
      const experienceId = messageData.experience.id;
      const companyId = messageData.experience.bot.id;
      
      logger.info('Received experience mapping', {
        experienceId,
        companyId,
        action: 'experience_mapping_received'
      });
      
      companyManager.registerExperience(experienceId, companyId);
      return null; // Not a chat message
    }

    // Extract chat message data
    const post = messageData.feedEntity?.dmsPost || messageData.feedEntity?.post;
    if (!post) {
      return null; // Not a chat message
    }

    // Define messageContent earlier
    const messageContent = post.content || post.message;

    // Check for duplicate messages
    const messageId = post.entityId;
    if (!messageId) {
      logger.debug('Message missing entityId, skipping', {
        content: messageContent?.substring(0, 50) || 'N/A',
        action: 'missing_entity_id'
      });
      return null;
    }

    if (this.processedMessages.has(messageId)) {
      console.log(`🔄 Skipping duplicate message: ${messageId} (content: "${messageContent?.substring(0, 50) || 'N/A'}...")`);
      return null;
    }

    // Add to processed set with cleanup
    this.processedMessages.add(messageId);
    if (this.processedMessages.size > this.MAX_PROCESSED_MESSAGES) {
      const oldMessages = Array.from(this.processedMessages).slice(0, this.processedMessages.size - this.MAX_PROCESSED_MESSAGES + 100);
      for (const oldMessageId of oldMessages) {
        this.processedMessages.delete(oldMessageId);
      }
    }

    // Skip bot's own messages
    if (post.user?.id === WHOP_AGENT_USER_ID) {
      console.log(`🤖 Skipping bot's own message`);
      return null;
    }

    if (!messageContent || typeof messageContent !== "string") {
      logger.debug('Message has no content or invalid content type', {
        entityId: messageId,
        contentType: typeof messageContent,
        action: 'invalid_content'
      });
      return null;
    }

    // Check for duplicate content from same user within the duplicate window
    const userId = post.user?.id;
    if (userId) {
      const userMessageKey = `${userId}:${post.feedId}`;
      const recentUserMessage = this.recentUserMessages.get(userMessageKey);
      const now = new Date();
      
      if (recentUserMessage && 
          recentUserMessage.content === messageContent && 
          (now.getTime() - recentUserMessage.timestamp.getTime()) < this.DUPLICATE_WINDOW_MS) {
        console.log(`🔄 Skipping duplicate content from user ${post.user?.username || userId} within ${this.DUPLICATE_WINDOW_MS/1000}s: "${messageContent.substring(0, 50)}..."`);
        return null;
      }
      
      // Update recent user message
      this.recentUserMessages.set(userMessageKey, {
        content: messageContent,
        timestamp: now
      });
      
      // Clean up old user messages
      if (this.recentUserMessages.size > 1000) {
        const cutoff = now.getTime() - this.DUPLICATE_WINDOW_MS;
        for (const [key, value] of this.recentUserMessages.entries()) {
          if (value.timestamp.getTime() < cutoff) {
            this.recentUserMessages.delete(key);
          }
        }
      }
    }

    // Store message for feed summaries
    const username = post.user?.username || post.user?.name || 'Unknown';
    const feedId = post.feedId;
    
    if (!this.recentMessages.has(feedId)) {
      this.recentMessages.set(feedId, []);
    }
    const feedMessages = this.recentMessages.get(feedId)!;
    feedMessages.push({
      content: messageContent,
      user: username,
      timestamp: new Date()
    });
    
    // Keep only last 50 messages per feed
    if (feedMessages.length > 50) {
      feedMessages.splice(0, feedMessages.length - 50);
    }

    // Validate experienceId exists
    if (!post.experienceId) {
      logger.warn('Message missing experienceId', {
        entityId: messageId,
        feedId: post.feedId,
        content: messageContent.substring(0, 50),
        action: 'missing_experience_id'
      });
      return null;
    }

    // TODO: Determine if the message is a forum post based on `messageData` structure
    // For example, if (messageData.feedEntity?.forumPost) { messageType = 'forumPost'; }
    // Defaulting to 'chatMessage' for now.
    const messageType: 'forumPost' | 'chatMessage' = 'chatMessage'; 

    logger.debug('Processing chat message', {
      entityId: messageId,
      feedId: post.feedId,
      experienceId: post.experienceId,
      username: post.user?.username || post.user?.name,
      contentLength: messageContent.length,
      action: 'message_processed'
    });

    return {
      entityId: messageId,
      feedId: feedId,
      content: messageContent,
      user: post.user,
      experienceId: post.experienceId,
      messageType: messageType,
    };
  }

  /**
   * Get recent messages for a feed (for summaries)
   */
  getRecentMessages(feedId: string): Array<{content: string, user: string, timestamp: Date}> {
    return this.recentMessages.get(feedId) || [];
  }

  /**
   * Get stats about processed messages
   */
  getStats() {
    return {
      processedMessagesCount: this.processedMessages.size,
      feedsWithMessages: this.recentMessages.size,
      totalStoredMessages: Array.from(this.recentMessages.values()).reduce((sum, msgs) => sum + msgs.length, 0),
      recentUserMessagesCount: this.recentUserMessages.size,
      duplicateWindowMs: this.DUPLICATE_WINDOW_MS
    };
  }

  /**
   * Clear old data to prevent memory leaks
   */
  cleanup() {
    // Clear messages older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const [feedId, messages] of this.recentMessages.entries()) {
      const filteredMessages = messages.filter(msg => msg.timestamp > oneHourAgo);
      if (filteredMessages.length === 0) {
        this.recentMessages.delete(feedId);
      } else {
        this.recentMessages.set(feedId, filteredMessages);
      }
    }
    
    // Clean up old user messages
    const duplicateWindowAgo = new Date(Date.now() - this.DUPLICATE_WINDOW_MS);
    for (const [key, value] of this.recentUserMessages.entries()) {
      if (value.timestamp < duplicateWindowAgo) {
        this.recentUserMessages.delete(key);
      }
    }
    
    logger.debug('Message processor cleanup completed', {
      action: 'cleanup_completed'
    });
  }
}

export const messageProcessor = new MessageProcessor(); 