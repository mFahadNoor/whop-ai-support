import dotenv from 'dotenv';
dotenv.config();

import WebSocket from "ws";
import { messageProcessor } from './message-processor';
import { botCoordinator } from './bot-coordinator';

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

  // Set up maintenance interval (every 10 minutes)
  const maintenanceInterval = setInterval(() => {
    botCoordinator.performMaintenance();
  }, 10 * 60 * 1000);

  const connect = () => {
    if (!WHOP_APP_API_KEY) {
      console.error("WHOP_APP_API_KEY is not defined, WebSocket cannot connect.");
      return;
    }
    
    const ws = new WebSocket(uri, {
      headers: wsApiHeaders,
    });

    ws.on("open", () => {
      console.log(`✅ Successfully connected to ${uri}`);
      console.log("🤖 AI Bot is now listening for questions and commands...");
      console.log("📊 System stats:", botCoordinator.getSystemStats());
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Process the WebSocket message (handles both experience mapping and chat messages)
        const processedMessage = await messageProcessor.processWebSocketMessage(message);
        
        // If it's a chat message, process it with the bot coordinator
        if (processedMessage) {
          await botCoordinator.processChatMessage(processedMessage);
        }

      } catch (error) {
        console.error("❌ Error processing incoming WebSocket message:", error);
        console.error("Problematic message data:", data.toString().substring(0, 500) + "...");
      }
    });

    ws.on("error", (error) => {
      console.error(`❌ WebSocket error: ${error.message}`);
    });

    ws.on("close", (code, reason) => {
      console.log(`❌ WebSocket disconnected. Code: ${code}, Reason: ${reason.toString()}`);
      console.log("🔄 Attempting to reconnect in 5 seconds...");
      setTimeout(connect, 5000);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('🛑 Received SIGINT, shutting down gracefully...');
      clearInterval(maintenanceInterval);
      ws.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, shutting down gracefully...');
      clearInterval(maintenanceInterval);
      ws.close();
      process.exit(0);
    });
  };

  connect();
}

// Optional: Add a main execution block if you run this file directly
if (require.main === module) {
  console.log('🚀 Starting Whop AI Bot...');
  console.log('📝 Bot features:');
  console.log('   • Company-level configuration (not per-experience)');
  console.log('   • AI-powered question answering');
  console.log('   • !help command');
  console.log('   • Feed summaries (if enabled)');
  console.log('   • Rate limiting and deduplication');
  console.log('   • Automatic maintenance and cleanup');
  console.log('');
  
  startBot().catch(error => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  });
} 