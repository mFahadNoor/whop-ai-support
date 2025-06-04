/**
 * Core Bot - Main Bot Service and Orchestration
 * 
 * This is the main entry point for the Whop AI bot service. It orchestrates
 * all the different components and provides the core bot functionality including
 * WebSocket connection management, message processing, and AI responses.
 * 
 * Key Features:
 * - WebSocket connection to Whop with automatic reconnection
 * - Real-time message processing and AI response generation
 * - Multi-tenant support for multiple companies/experiences
 * - Graceful shutdown and error recovery
 * - Health monitoring and maintenance tasks
 * 
 * Architecture:
 * - Uses WebSocket for real-time communication with Whop
 * - Integrates DataManager for settings and caching
 * - Uses AIEngine for intelligent response generation
 * - Leverages WhopAPI for sending messages and API calls
 * 
 * Message Processing Flow:
 * 1. Receive message from WebSocket
 * 2. Parse and validate message structure
 * 3. Check if company has bot enabled
 * 4. Process message through AI engine
 * 5. Send response if needed
 * 6. Handle any errors gracefully
 * 
 * Usage:
 * ```bash
 * # Start the bot service
 * npm run bot
 * ```
 */

import dotenv from 'dotenv';
dotenv.config();

import WebSocket from "ws";
import { ProcessedMessage, BotSettings, WebSocketMessage } from './shared-utils';
import { dataManager } from './data-manager';
import { aiEngine } from './ai-engine';
import { whopAPI } from './api-services';
import { logger } from './shared-utils';

const WHOP_API_KEY = process.env.WHOP_API_KEY;
const WHOP_AGENT_USER_ID = process.env.WHOP_AGENT_USER_ID;

// Bot username for @ mention detection
let BOT_USERNAME: string | null = null;

/**
 * Message Processor - Handles incoming WebSocket messages and deduplication
 */
class MessageProcessor {
  private processedMessages = new Set<string>();
  private recentMessages = new Map<string, Array<{content: string, user: string, timestamp: Date}>>();
  private recentUserMessages = new Map<string, {content: string, timestamp: Date}>();
  private readonly MAX_PROCESSED_MESSAGES = 2000;
  private readonly DUPLICATE_WINDOW_MS = 15000;

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
      
      dataManager.registerExperience(experienceId, companyId);
      return null; // Not a chat message
    }

    // Extract chat message data
    const post = messageData.feedEntity?.dmsPost || messageData.feedEntity?.post;
    if (!post) return null;

    const messageContent = post.content || post.message;
    const messageId = post.entityId;
    const replyingToPostId = (post as any).replyingToPostId; // Extract reply information
    
    if (!messageId) {
      logger.debug('Message missing entityId, skipping', {
        content: messageContent?.substring(0, 50) || 'N/A',
        action: 'missing_entity_id'
      });
      return null;
    }

    // Check for duplicates
    if (this.processedMessages.has(messageId)) {
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

    // Check for duplicate content from same user
    const userId = post.user?.id;
    if (userId) {
      const userMessageKey = `${userId}:${post.feedId}`;
      const recentUserMessage = this.recentUserMessages.get(userMessageKey);
      const now = new Date();
      
      if (recentUserMessage && 
          recentUserMessage.content === messageContent && 
          (now.getTime() - recentUserMessage.timestamp.getTime()) < this.DUPLICATE_WINDOW_MS) {
        return null;
      }
      
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

    if (!post.experienceId) {
      logger.warn('Message missing experienceId', {
        entityId: messageId,
        feedId: post.feedId,
        content: messageContent.substring(0, 50),
        action: 'missing_experience_id'
      });
      return null;
    }

    const messageType: 'forumPost' | 'chatMessage' = 'chatMessage';

    logger.debug('Processing chat message', {
      entityId: messageId,
      feedId: post.feedId,
      experienceId: post.experienceId,
      username: post.user?.username || post.user?.name,
      contentLength: messageContent.length,
      action: 'message_processed'
    });

    if (!post.user) {
      logger.debug('Message missing user information', {
        entityId: messageId,
        feedId: post.feedId,
        action: 'missing_user'
      });
      return null;
    }

    return {
      entityId: messageId,
      feedId: feedId,
      content: messageContent,
      user: post.user,
      experienceId: post.experienceId,
      messageType: messageType,
      replyingToPostId: replyingToPostId,
    };
  }

  getRecentMessages(feedId: string): Array<{content: string, user: string, timestamp: Date}> {
    return this.recentMessages.get(feedId) || [];
  }

  getStats() {
    return {
      processedMessagesCount: this.processedMessages.size,
      feedsWithMessages: this.recentMessages.size,
      totalStoredMessages: Array.from(this.recentMessages.values()).reduce((sum, msgs) => sum + msgs.length, 0),
      recentUserMessagesCount: this.recentUserMessages.size,
      duplicateWindowMs: this.DUPLICATE_WINDOW_MS
    };
  }

  cleanup() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const [feedId, messages] of this.recentMessages.entries()) {
      const filteredMessages = messages.filter(msg => msg.timestamp > oneHourAgo);
      if (filteredMessages.length === 0) {
        this.recentMessages.delete(feedId);
      } else {
        this.recentMessages.set(feedId, filteredMessages);
      }
    }
    
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

/**
 * Bot Coordinator - Main bot logic and message processing
 */
class BotCoordinator {
  private pendingMessages = new Map<string, ProcessedMessage[]>();
  private processingMessages = new Set<string>();
  private readonly MAX_PENDING_RETRIES = 5;
  private readonly INITIAL_RETRY_DELAY = 500;
  private readonly MAX_RETRY_DELAY = 5000;
  private retryCount = new Map<string, number>();

  constructor() {
    // Set up callback to process pending messages when mappings arrive
    dataManager.setExperienceMappedCallback((experienceId: string) => {
      this.processPendingMessages(experienceId).catch(error => {
        logger.error(`Error processing pending messages for ${experienceId}`, error, {
          experienceId,
          action: 'pending_messages_error',
        });
      });
    });
    
    // Fetch bot username on startup
    this.initializeBotInfo();
  }
  
  private async initializeBotInfo() {
    if (WHOP_AGENT_USER_ID) {
      try {
        const botUser = await whopAPI.getUser(WHOP_AGENT_USER_ID);
        if (botUser?.username) {
          BOT_USERNAME = botUser.username;
          console.log(`🤖 Bot username: @${BOT_USERNAME}`);
        }
      } catch (error) {
        logger.warn('Failed to fetch bot username for @ mention detection', { error });
      }
    }
  }
  
  /**
   * Check if message contains @ mention of the bot
   */
  private isBotMentioned(content: string): boolean {
    if (!BOT_USERNAME) {
      console.log('🐛 DEBUG: BOT_USERNAME is null/undefined');
      return false;
    }
    
    // Multiple patterns to check for mentions
    const patterns = [
      // Standard @username pattern
      new RegExp(`@${BOT_USERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
      // Pattern without word boundary (in case of special formatting)
      new RegExp(`@${BOT_USERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      // Pattern for "AI Support's agent" format
      new RegExp(`@AI\\s+Support'?s?\\s+agent`, 'i'),
      // Pattern for any variation of the bot name
      new RegExp(`@(AI\\s+Support|ai-support|ai\\s+support)`, 'i'),
    ];
    
    let isMatched = false;
    let matchedPattern = '';
    
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        isMatched = true;
        matchedPattern = pattern.toString();
        break;
      }
    }
    
    console.log('🐛 DEBUG: Mention check', {
      content,
      botUsername: BOT_USERNAME,
      patterns: patterns.map(p => p.toString()),
      matchedPattern,
      isMatched
    });
    
    return isMatched;
  }

  async processChatMessage(message: ProcessedMessage): Promise<void> {
    if (!message.experienceId) {
      logger.warn('No experienceId in message', {
        entityId: message.entityId,
        feedId: message.feedId,
        action: 'missing_experience_id',
      });
      return;
    }

    const messageKey = `${message.entityId}:${message.feedId}`;
    if (this.processingMessages.has(messageKey)) {
      logger.debug('Already processing message, skipping duplicate', {
        entityId: message.entityId,
        feedId: message.feedId,
        action: 'duplicate_processing_skipped',
      });
      return;
    }

    logger.info('Starting to process message', {
      entityId: message.entityId,
      feedId: message.feedId,
      username: message.user.username || message.user.name,
      experienceId: message.experienceId,
      action: 'message_processing_start',
    });
    this.processingMessages.add(messageKey);

    try {
      await this.processMessageInternal(message);
    } finally {
      setTimeout(() => {
        this.processingMessages.delete(messageKey);
      }, 5000);
    }
  }

  private async processMessageInternal(message: ProcessedMessage): Promise<void> {
    const experienceId = message.experienceId;
    let companyId = dataManager.getCompanyId(experienceId);
    
    if (!companyId) {
      console.log(`🔄 No mapping found for experience ${experienceId}, checking database...`);
      companyId = await dataManager.tryFetchMappingFromDB(experienceId);
      
      if (!companyId) {
        // Buffer the message for later processing when mapping arrives
        if (!this.pendingMessages.has(experienceId)) {
          this.pendingMessages.set(experienceId, []);
        }
        
        const pendingMessages = this.pendingMessages.get(experienceId)!;
        pendingMessages.push(message);
        
        // Limit pending messages per experience to prevent memory issues
        if (pendingMessages.length > 50) {
          pendingMessages.shift(); // Remove oldest message
        }
        
        const retryCount = this.retryCount.get(experienceId) || 0;
        
        if (retryCount < this.MAX_PENDING_RETRIES) {
          this.retryCount.set(experienceId, retryCount + 1);
          
          const delay = Math.min(
            this.INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
            this.MAX_RETRY_DELAY
          );
          
          console.log(`📦 Buffered message for experience ${experienceId} (${pendingMessages.length} pending, retry ${retryCount + 1}/${this.MAX_PENDING_RETRIES})`);
          
          // Retry after delay
          setTimeout(async () => {
            const currentCompanyId = dataManager.getCompanyId(experienceId);
            if (currentCompanyId) {
              // Mapping found, process pending messages
              await this.processPendingMessages(experienceId);
            } else {
              // Still no mapping, try fetching from DB again
              const dbCompanyId = await dataManager.tryFetchMappingFromDB(experienceId);
              if (dbCompanyId) {
                await this.processPendingMessages(experienceId);
              }
            }
          }, delay);
        } else {
          console.log(`❌ Max retries reached for experience ${experienceId}, dropping ${pendingMessages.length} messages`);
          this.pendingMessages.delete(experienceId);
          this.retryCount.delete(experienceId);
        }
        
        return;
      }
    }

    const settings = await dataManager.getBotSettings(companyId);

    const messageLower = message.content.toLowerCase();
    const username = message.user.username || message.user.name || 'Unknown';
    
    // Check for admin commands (only for @script user)
    if (username === 'script' && message.content.trim() === '!clct') {
      // Clear context command - admin only
      dataManager.clearCompanyContext(companyId);
      const adminResponse = '@script done, cleared context.';
      const messageId = await whopAPI.sendMessageWithRetry(message.feedId, adminResponse);
      if (messageId) {
        dataManager.trackBotMessage(messageId);
        logger.info('Admin command executed: clear context', {
          companyId,
          username,
          command: '!clct',
          action: 'admin_clear_context',
        });
      }
      return;
    }
    
    // Check if bot is mentioned
    const isMentioned = this.isBotMentioned(message.content);
    
    // Check if this message is replying to a bot message
    const isReplyingToBotMessage = !!(message.replyingToPostId && dataManager.isBotMessageTracked(message.replyingToPostId));

    // For replies to bot messages, check if the reply actually needs a response
    // Don't force response if it's just information/help being provided by moderators
    const shouldForceResponseForReply = isReplyingToBotMessage && (
      // Only force response if the reply contains a question or seems to be asking for clarification
      message.content.includes('?') ||
      /\b(how|what|when|where|why|can|could|would|should|is|are|does|do|did|will|have|has)\b/i.test(message.content.toLowerCase()) ||
      // Or if it's a short response that might need clarification
      (message.content.length < 50 && !/\b(thanks|thank you|ok|okay|got it|understood|perfect|great|awesome)\b/i.test(message.content.toLowerCase()))
    );

    // Handle AI responses
    if (settings.enabled && (settings.knowledgeBase || (settings.presetQA && settings.presetQA.length > 0))) {
      logger.debug('Checking if message requires AI response', {
        companyId,
        username,
        messagePreview: message.content.substring(0, 50),
        isMentioned,
        isReplyingToBotMessage,
        shouldForceResponseForReply,
        botEnabled: settings.enabled,
        hasKnowledgeBase: !!settings.knowledgeBase,
        hasPresetQA: !!(settings.presetQA && settings.presetQA.length > 0),
        action: 'ai_check_start',
      });
      
      // Add user message to context window
      dataManager.addMessageToContext(companyId, message.content, username, false);
      
      // Determine if bot should respond (mentioned OR replying to bot message OR normal question detection)
      const shouldForceResponse = isMentioned || shouldForceResponseForReply;
      
      const aiResponse = await aiEngine.analyzeQuestion(
        message.content, 
        settings.knowledgeBase || '', 
        settings, 
        companyId,
        shouldForceResponse,
        username // Pass username for mentions
      );
      
      if (aiResponse) {
        const botMessage = `🤖 ${aiResponse}`;
        const messageId = await whopAPI.sendMessageWithRetry(message.feedId, botMessage);
        if (messageId) {
          // Track the bot message ID for reply detection
          dataManager.trackBotMessage(messageId);
          
          // Add bot response to context window
          dataManager.addMessageToContext(companyId, aiResponse, 'AI Support', true);
          
          logger.info('AI response sent successfully', {
            companyId,
            username,
            responseLength: aiResponse.length,
            wasMentioned: isMentioned,
            wasReplyingToBotMessage: isReplyingToBotMessage,
            shouldForceResponseForReply,
            botMessageId: messageId,
            action: 'ai_response_sent',
          });
        } else {
          logger.error('Failed to send AI response', undefined, {
            companyId,
            username,
            wasMentioned: isMentioned,
            wasReplyingToBotMessage: isReplyingToBotMessage,
            shouldForceResponseForReply,
            action: 'ai_response_failed',
          });
        }
      } else {
        // Bot was mentioned/replied to but AI decided not to respond - this is correct behavior
        logger.debug('Bot was mentioned but AI decided not to respond (no suitable answer)', {
          companyId,
          username,
          messagePreview: message.content.substring(0, 50),
          wasMentioned: isMentioned,
          wasReplyingToBotMessage: isReplyingToBotMessage,
          shouldForceResponseForReply,
          action: 'mentioned_but_no_response',
        });
      }
      return;
    } else {
      // Bot is not properly configured - add detailed logging
      logger.debug('Bot not configured to respond', {
        companyId,
        username,
        messagePreview: message.content.substring(0, 50),
        botEnabled: settings.enabled,
        hasKnowledgeBase: !!settings.knowledgeBase,
        knowledgeBaseLength: settings.knowledgeBase?.length || 0,
        hasPresetQA: !!(settings.presetQA && settings.presetQA.length > 0),
        presetQACount: settings.presetQA?.length || 0,
        isMentioned,
        isReplyingToBotMessage,
        action: 'bot_not_configured',
      });
      
      if (isMentioned || shouldForceResponseForReply) {
        // Bot is mentioned or someone replied to bot with a question but not enabled - send a gentle message
        const notEnabledMessage = `@${username} Thanks for reaching out! However, I'm currently not configured for this community. An admin can enable me in the settings.`;
        const messageId = await whopAPI.sendMessageWithRetry(message.feedId, notEnabledMessage);
        if (messageId) {
          // Track the not-enabled message ID too
          dataManager.trackBotMessage(messageId);
          
          logger.info('Bot mentioned/replied to but not enabled response sent', {
            companyId,
            username,
            isMentioned,
            isReplyingToBotMessage,
            shouldForceResponseForReply,
            botMessageId: messageId,
            action: 'mention_not_enabled_sent',
          });
        }
        return;
      } else {
        // Still add non-bot messages to context even if bot doesn't respond
        dataManager.addMessageToContext(companyId, message.content, username, false);
      }
    }

    logger.debug('Message did not trigger any bot actions', {
      companyId,
      username,
      messagePreview: message.content.substring(0, 50),
      action: 'no_action_taken',
    });
  }

  private async processPendingMessages(experienceId: string): Promise<void> {
    const companyId = dataManager.getCompanyId(experienceId);
    if (!companyId) {
      return;
    }

    const pendingMessages = this.pendingMessages.get(experienceId);
    if (!pendingMessages || pendingMessages.length === 0) {
      return;
    }

    console.log(`🔄 Processing ${pendingMessages.length} buffered messages`);

    this.retryCount.delete(experienceId);

    for (const message of pendingMessages) {
      await this.processChatMessage(message);
    }

    this.pendingMessages.delete(experienceId);
  }

  getSystemStats() {
    return {
      dataManager: dataManager.getStats(),
      messageProcessor: messageProcessor.getStats(),
      aiEngine: aiEngine.getStats(),
      whopAPI: whopAPI.getStats(),
      pendingMessages: {
        experiencesWithPending: this.pendingMessages.size,
        totalPendingMessages: Array.from(this.pendingMessages.values()).reduce((sum, msgs) => sum + msgs.length, 0),
        retryingExperiences: this.retryCount.size
      },
      timestamp: new Date().toISOString()
    };
  }

  performMaintenance() {
    console.log('🧹 Running maintenance...');
    
    messageProcessor.cleanup();
    dataManager.cleanupExpiredContext();
    
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    
    for (const [experienceId, messages] of this.pendingMessages.entries()) {
      const oldestMessage = messages[0];
      if (oldestMessage && now - new Date(oldestMessage.user.id).getTime() > staleThreshold) {
        this.pendingMessages.delete(experienceId);
        this.retryCount.delete(experienceId);
      }
    }
  }

  clearAllCaches() {
    dataManager.clearAllCaches();
    aiEngine.clearRateLimits();
    whopAPI.clearRateLimits();
    
    this.pendingMessages.clear();
    this.retryCount.clear();
    
    console.log('🗑️ All caches cleared');
  }
}

/**
 * Bot WebSocket Connection Manager
 */
class BotWebSocket {
  private ws?: WebSocket;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;
  private maintenanceInterval?: NodeJS.Timeout;

  async start() {
    const uri = "wss://ws-prod.whop.com/ws/developer";

    if (!WHOP_API_KEY) {
      console.error("❌ WHOP_API_KEY environment variable is not set. Bot cannot start.");
      return;
    }
    if (!WHOP_AGENT_USER_ID) {
      console.warn("⚠️ WHOP_AGENT_USER_ID environment variable is not set. Bot may not skip its own messages correctly.");
    }

    // Set up maintenance interval
    this.maintenanceInterval = setInterval(() => {
      botCoordinator.performMaintenance();
    }, 5 * 60 * 1000);

    this.connect(uri);
  }

  private connect(uri: string) {
    if (!WHOP_API_KEY) {
      console.error("WHOP_API_KEY is not defined, WebSocket cannot connect.");
      return;
    }
    
    console.log(`🔌 Connecting to ${uri}...`);
    
    // Headers for WebSocket connection
    const wsApiHeaders: { [key: string]: string } = {};
    if (WHOP_API_KEY) {
      wsApiHeaders["Authorization"] = `Bearer ${WHOP_API_KEY}`;
    }
    if (WHOP_AGENT_USER_ID) {
      wsApiHeaders["x-on-behalf-of"] = WHOP_AGENT_USER_ID;
    }

    this.ws = new WebSocket(uri, {
      headers: wsApiHeaders,
    });

    this.ws.on("open", () => {
      console.log(`✅ Bot connected to Whop`);
      console.log(`🤖 Listening for messages and commands...`);
      
      this.reconnectAttempts = 0;
      
      logger.info('Bot WebSocket connected', {
        action: 'websocket_connected',
        uri
      });
    });

    this.ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Process the WebSocket message
        const processedMessage = await messageProcessor.processWebSocketMessage(message);
        
        if (processedMessage) {
          await botCoordinator.processChatMessage(processedMessage);
        }

      } catch (error) {
        console.error("❌ Error processing incoming WebSocket message:", error);
        console.error("Problematic message data:", data.toString().substring(0, 500) + "...");
        
        logger.error('WebSocket message processing error', error as Error, {
          action: 'websocket_message_error',
          messagePreview: data.toString().substring(0, 100)
        });
      }
    });

    this.ws.on("error", (error) => {
      console.error(`❌ WebSocket error: ${error.message}`);
      logger.error('WebSocket error', error, {
        action: 'websocket_error',
        reconnectAttempts: this.reconnectAttempts
      });
    });

    this.ws.on("close", (code, reason) => {
      console.log(`❌ WebSocket disconnected. Code: ${code}, Reason: ${reason.toString()}`);
      
      logger.warn('WebSocket disconnected', {
        code,
        reason: reason.toString(),
        reconnectAttempts: this.reconnectAttempts,
        action: 'websocket_disconnected'
      });
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        
        console.log(`🔄 Attempting to reconnect in ${delay/1000} seconds... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(uri), delay);
      } else {
        console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Bot is shutting down.`);
        logger.error('Max reconnection attempts reached', undefined, {
          action: 'max_reconnect_attempts',
          attempts: this.reconnectAttempts
        });
        this.cleanup();
        process.exit(1);
      }
    });

    // Handle graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`🛑 Received ${signal}, shutting down gracefully...`);
      logger.info('Bot shutdown initiated', { signal, action: 'shutdown_initiated' });
      
      this.cleanup();
      
      setTimeout(() => {
        console.log('✅ Bot shutdown complete');
        process.exit(0);
      }, 1000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  private cleanup() {
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Create instances
const messageProcessor = new MessageProcessor();
const botCoordinator = new BotCoordinator();
const botWebSocket = new BotWebSocket();

// Main export function
export async function startBot() {
  console.log('🚀 Starting Whop AI Bot...\n');
  console.log('Features:');
  console.log('  • Smart AI question detection');
  console.log('  • @ mention detection');
  console.log('  • 25-message context window');
  console.log('  • Admin-only configuration');
  console.log('  • Real-time responses');
  console.log('  • Rate limiting & caching\n');
  
  await botWebSocket.start();
}

// Export for external access
export { botCoordinator, messageProcessor };

// Main execution block
if (require.main === module) {
  startBot().catch(error => {
    console.error('❌ Failed to start bot:', error);
    logger.error('Bot startup failed', error, { action: 'startup_failed' });
    process.exit(1);
  });
}