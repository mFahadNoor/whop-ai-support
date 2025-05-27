import { ProcessedMessage, WebSocketMessage } from './types';
import { companyManager } from './company-manager';

const WHOP_AGENT_USER_ID = process.env.WHOP_AGENT_USER_ID;

class MessageProcessor {
  private processedMessages = new Set<string>();
  private recentMessages = new Map<string, Array<{content: string, user: string, timestamp: Date}>>();
  private recentUserMessages = new Map<string, {content: string, timestamp: Date}>();

  /**
   * Process incoming WebSocket message
   */
  async processWebSocketMessage(messageData: WebSocketMessage): Promise<ProcessedMessage | null> {
    // Check if this is an experience mapping message
    if (messageData.experience?.id && messageData.experience?.bot?.id) {
      const experienceId = messageData.experience.id;
      const companyId = messageData.experience.bot.id;
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
      return null;
    }

    if (this.processedMessages.has(messageId)) {
      console.log(`🔄 Skipping duplicate message: ${messageId} (content: "${messageContent?.substring(0, 50) || 'N/A'}...")`);
      return null;
    }

    // Add to processed set with cleanup
    this.processedMessages.add(messageId);
    if (this.processedMessages.size > 1000) {
      const oldestMessage = this.processedMessages.values().next().value;
      if (oldestMessage) {
        this.processedMessages.delete(oldestMessage);
      }
    }

    // Skip bot's own messages
    if (post.user?.id === WHOP_AGENT_USER_ID) {
      console.log(`🤖 Skipping bot's own message`);
      return null;
    }

    // const messageContent = post.content || post.message; // Already defined above
    if (!messageContent || typeof messageContent !== "string") {
      return null;
    }

    // Check for duplicate content from same user within last 10 seconds
    const userId = post.user?.id;
    if (userId) {
      const userMessageKey = `${userId}:${post.feedId}`;
      const recentUserMessage = this.recentUserMessages.get(userMessageKey);
      const now = new Date();
      
      if (recentUserMessage && 
          recentUserMessage.content === messageContent && 
          (now.getTime() - recentUserMessage.timestamp.getTime()) < 10000) {
        console.log(`🔄 Skipping duplicate content from user ${post.user?.username || userId} within 10s: "${messageContent.substring(0, 50)}..."`);
        return null;
      }
      
      // Update recent user message
      this.recentUserMessages.set(userMessageKey, {
        content: messageContent,
        timestamp: now
      });
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

    // TODO: Determine if the message is a forum post based on `messageData` structure
    // For example, if (messageData.feedEntity?.forumPost) { messageType = 'forumPost'; }
    // Defaulting to 'chatMessage' for now.
    const messageType: 'forumPost' | 'chatMessage' = 'chatMessage'; 

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
      totalStoredMessages: Array.from(this.recentMessages.values()).reduce((sum, msgs) => sum + msgs.length, 0)
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
  }
}

export const messageProcessor = new MessageProcessor(); 