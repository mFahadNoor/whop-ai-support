import { ProcessedMessage, BotSettings } from './types';
import { companyManager } from './company-manager';
import { messageProcessor } from './message-processor';
import { aiService } from './ai-service';
import { whopAPI } from './whop-api';
import { logger } from './logger';

class BotCoordinator {
  private pendingMessages = new Map<string, ProcessedMessage[]>();
  private processingMessages = new Set<string>();

  constructor() {
    // Set up callback to process pending messages when mappings arrive
    companyManager.setExperienceMappedCallback((experienceId: string) => {
      this.processPendingMessages(experienceId).catch(error => {
        logger.error(`Error processing pending messages for ${experienceId}`, error, {
          experienceId,
          action: 'pending_messages_error',
        });
      });
    });
  }

  /**
   * Process a chat message and execute bot logic
   */
  async processChatMessage(message: ProcessedMessage): Promise<void> {
    if (!message.experienceId) {
      logger.warn('No experienceId in message', {
        entityId: message.entityId,
        feedId: message.feedId,
        action: 'missing_experience_id',
      });
      return;
    }

    // Prevent processing the same message multiple times concurrently
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
      // Clean up after processing
      setTimeout(() => {
        this.processingMessages.delete(messageKey);
      }, 5000);
    }
  }

  /**
   * Internal message processing logic
   */
  private async processMessageInternal(message: ProcessedMessage): Promise<void> {

    // Get company ID for this experience
    let companyId = companyManager.getCompanyId(message.experienceId);
    const messageKey = `${message.entityId}:${message.feedId}`;
    
    if (!companyId) {
      // If no mapping yet, store the message and wait a bit
      console.log(`⏳ No company mapping for experience ${message.experienceId} yet, buffering message...`);
      
      if (!this.pendingMessages.has(message.experienceId)) {
        this.pendingMessages.set(message.experienceId, []);
      }
      this.pendingMessages.get(message.experienceId)!.push(message);
      
      // IMPORTANT: Remove from processing set if we are going to buffer and retry,
      // to prevent the retry from being incorrectly flagged as a duplicate.
      this.processingMessages.delete(messageKey);

      // Try again after a short delay
      setTimeout(async () => {
        await this.processPendingMessages(message.experienceId);
      }, 2000);
      
      return;
    }

    console.log(`🎯 Processing message for company ${companyId}`);

    // Get bot settings for this company
    const settings = await companyManager.getBotSettings(companyId);
    console.log(`⚙️ Bot settings:`, { enabled: settings.enabled, hasKnowledgeBase: !!settings.knowledgeBase });

    const messageLower = message.content.toLowerCase();
    const username = message.user.username || message.user.name || 'Unknown';

    // Handle !help command (always works, regardless of settings)
    if (messageLower === "!help") {
      const helpResponse = "Made by Vortex (@script)";
      console.log(`🆘 Executing !help command for ${username}`);
      
      const success = await whopAPI.sendMessageWithRetry(message.feedId, helpResponse);
      if (success) {
        console.log(`✅ Help command completed for ${username}`);
      } else {
        console.log(`❌ Failed to send help response for ${username}`);
      }
      return;
    }

    // Handle questions with AI (now includes question filtering and preset Q&A checking)
    if (settings.enabled && (settings.knowledgeBase || (settings.presetQA && settings.presetQA.length > 0))) {
      logger.debug('Checking if message requires AI response', {
        companyId,
        username,
        messagePreview: message.content.substring(0, 50),
        action: 'ai_check_start',
      });
      
      const aiResponse = await aiService.analyzeQuestion(
        message.content, 
        settings.knowledgeBase || '', 
        settings, 
        companyId
      );
      
      if (aiResponse) {
        const botMessage = `🤖 ${aiResponse}`;
        const success = await whopAPI.sendMessageWithRetry(message.feedId, botMessage);
        if (success) {
          logger.info('AI response sent successfully', {
            companyId,
            username,
            responseLength: aiResponse.length,
            action: 'ai_response_sent',
          });
        } else {
          logger.error('Failed to send AI response', undefined, {
            companyId,
            username,
            action: 'ai_response_failed',
          });
        }
      } else {
        logger.debug('AI decided not to respond', {
          companyId,
          username,
          messagePreview: message.content.substring(0, 50),
          action: 'ai_no_response',
        });
      }
      return;
    }

    logger.debug('Message did not trigger any bot actions', {
      companyId,
      username,
      messagePreview: message.content.substring(0, 50),
      action: 'no_action_taken',
    });
  }

  /**
   * Process pending messages for an experience when company mapping becomes available
   */
  private async processPendingMessages(experienceId: string): Promise<void> {
    const companyId = companyManager.getCompanyId(experienceId);
    if (!companyId) {
      console.log(`⏳ Still no company mapping for experience ${experienceId}, will retry later`);
      return;
    }

    const pendingMessages = this.pendingMessages.get(experienceId);
    if (!pendingMessages || pendingMessages.length === 0) {
      return;
    }

    console.log(`🔄 Processing ${pendingMessages.length} buffered messages for experience ${experienceId} (company ${companyId})`);

    // Process all pending messages
    for (const message of pendingMessages) {
      await this.processChatMessage(message);
    }

    // Clear the pending messages
    this.pendingMessages.delete(experienceId);
  }

  /**
   * Get comprehensive stats about the bot system
   */
  getSystemStats() {
    return {
      companyManager: companyManager.getStats(),
      messageProcessor: messageProcessor.getStats(),
      aiService: aiService.getStats(),
      whopAPI: whopAPI.getStats(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Perform system cleanup and maintenance
   */
  performMaintenance() {
    console.log('🧹 Performing system maintenance...');
    
    // Clean up old message data
    messageProcessor.cleanup();
    
    const stats = this.getSystemStats();
    console.log('📊 System stats after maintenance:', stats);
  }

  /**
   * Clear all caches (for testing or admin purposes)
   */
  clearAllCaches() {
    companyManager.clearAllCaches();
    aiService.clearRateLimits();
    whopAPI.clearRateLimits();
    console.log('🗑️ All caches cleared');
  }
}

export const botCoordinator = new BotCoordinator();