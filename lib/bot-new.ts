import dotenv from 'dotenv';
dotenv.config();

import WebSocket from "ws";
import { messageProcessor } from './message-processor';
import { botCoordinator } from './bot-coordinator';
import { logger } from './logger';

const WHOP_APP_API_KEY = process.env.WHOP_APP_API_KEY;
const WHOP_AGENT_USER_ID = process.env.WHOP_AGENT_USER_ID;

// Headers for WebSocket connection (values must be strings)
const wsApiHeaders: { [key: string]: string } = {};
if (WHOP_APP_API_KEY) {
  wsApiHeaders["Authorization"] = `Bearer ${WHOP_APP_API_KEY}`;
}
if (WHOP_AGENT_USER_ID) {
  wsApiHeaders["x-on-behalf-of"] = WHOP_AGENT_USER_ID;
}

export async function startBot() {
  const uri = "wss://ws-prod.whop.com/ws/developer";

  if (!WHOP_APP_API_KEY) {
    console.error("❌ WHOP_APP_API_KEY environment variable is not set. Bot cannot start.");
    return;
  }
  if (!WHOP_AGENT_USER_ID) {
    console.warn("⚠️ WHOP_AGENT_USER_ID environment variable is not set. Bot may not skip its own messages correctly or send messages on its own behalf.");
  }

  // Set up maintenance interval (every 5 minutes for more frequent cleanup)
  const maintenanceInterval = setInterval(() => {
    botCoordinator.performMaintenance();
  }, 5 * 60 * 1000);

  // Connection retry logic
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000; // Start with 1 second

  const connect = () => {
    if (!WHOP_APP_API_KEY) {
      console.error("WHOP_APP_API_KEY is not defined, WebSocket cannot connect.");
      return;
    }
    
    console.log(`🔌 Connecting to ${uri}...`);
    const ws = new WebSocket(uri, {
      headers: wsApiHeaders,
    });

    ws.on("open", () => {
      console.log(`✅ Successfully connected to ${uri}`);
      console.log("🤖 AI Bot is now listening for questions and commands...");
      console.log("📊 System stats:", JSON.stringify(botCoordinator.getSystemStats(), null, 2));
      
      // Reset reconnect attempts on successful connection
      reconnectAttempts = 0;
      
      logger.info('Bot WebSocket connected', {
        action: 'websocket_connected',
        uri
      });
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Log incoming message types for debugging
        if (message.experience?.id) {
          logger.debug('Received experience mapping message', {
            experienceId: message.experience.id,
            companyId: message.experience.bot?.id,
            action: 'experience_mapping_received'
          });
        } else if (message.feedEntity?.post || message.feedEntity?.dmsPost) {
          logger.debug('Received chat message', {
            entityId: message.feedEntity?.post?.entityId || message.feedEntity?.dmsPost?.entityId,
            feedId: message.feedEntity?.post?.feedId || message.feedEntity?.dmsPost?.feedId,
            action: 'chat_message_received'
          });
        }
        
        // Process the WebSocket message (handles both experience mapping and chat messages)
        const processedMessage = await messageProcessor.processWebSocketMessage(message);
        
        // If it's a chat message, process it with the bot coordinator
        if (processedMessage) {
          await botCoordinator.processChatMessage(processedMessage);
        }

      } catch (error) {
        console.error("❌ Error processing incoming WebSocket message:", error);
        console.error("Problematic message data:", data.toString().substring(0, 500) + "...");
        
        logger.error('WebSocket message processing error', error, {
          action: 'websocket_message_error',
          messagePreview: data.toString().substring(0, 100)
        });
      }
    });

    ws.on("error", (error) => {
      console.error(`❌ WebSocket error: ${error.message}`);
      logger.error('WebSocket error', error, {
        action: 'websocket_error',
        reconnectAttempts
      });
    });

    ws.on("close", (code, reason) => {
      console.log(`❌ WebSocket disconnected. Code: ${code}, Reason: ${reason.toString()}`);
      
      logger.warn('WebSocket disconnected', {
        code,
        reason: reason.toString(),
        reconnectAttempts,
        action: 'websocket_disconnected'
      });
      
      // Implement exponential backoff for reconnection
      if (reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000); // Max 30 seconds
        reconnectAttempts++;
        
        console.log(`🔄 Attempting to reconnect in ${delay/1000} seconds... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
        setTimeout(connect, delay);
      } else {
        console.error(`❌ Max reconnection attempts (${maxReconnectAttempts}) reached. Bot is shutting down.`);
        logger.error('Max reconnection attempts reached', undefined, {
          action: 'max_reconnect_attempts',
          attempts: reconnectAttempts
        });
        clearInterval(maintenanceInterval);
        process.exit(1);
      }
    });

    // Handle graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`🛑 Received ${signal}, shutting down gracefully...`);
      logger.info('Bot shutdown initiated', { signal, action: 'shutdown_initiated' });
      
      clearInterval(maintenanceInterval);
      ws.close();
      
      setTimeout(() => {
        console.log('✅ Bot shutdown complete');
        process.exit(0);
      }, 1000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  };

  connect();
}

// Optional: Add a main execution block if you run this file directly
if (require.main === module) {
  console.log('🚀 Starting Whop AI Bot...');
  console.log('📝 Bot features:');
  console.log('   • Company-level configuration (not per-experience)');
  console.log('   • AI-powered question answering');
  console.log('   • !help and !refresh commands');
  console.log('   • Feed summaries (if enabled)');
  console.log('   • Rate limiting and deduplication');
  console.log('   • Automatic maintenance and cleanup');
  console.log('   • Improved cache management (30s TTL)');
  console.log('   • Better company mapping retry logic');
  console.log('');
  
  startBot().catch(error => {
    console.error('❌ Failed to start bot:', error);
    logger.error('Bot startup failed', error, { action: 'startup_failed' });
    process.exit(1);
  });
} 