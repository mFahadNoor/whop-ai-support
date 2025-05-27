// This file can be used for any helper functions your application might need.
// For now, it is a placeholder as the previous functions were removed.

import { prisma } from "./prisma";

// GraphQL query to get experienceId from feedId
const GET_CHAT_FEED = `
  query GetChatFeedDetails($feedId: ID!) {
    chatFeed(feedId: $feedId) {
      id
      experienceId
    }
  }
`;

/**
 * Get the experienceId for a chat feed using GraphQL query
 * @param feedId The ID of the feed
 * @returns The experienceId of the feed
 */
export async function getChatFeedExperienceId(
  feedId: string
): Promise<string | null> {
  try {
    // Headers for GraphQL request
    const WHOP_APP_API_KEY = process.env.WHOP_APP_API_KEY;
    const WHOP_AGENT_USER_ID = process.env.WHOP_AGENT_USER_ID;
    
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    
    if (WHOP_APP_API_KEY) {
      headers["Authorization"] = `Bearer ${WHOP_APP_API_KEY}`;
    }
    if (WHOP_AGENT_USER_ID) {
      headers["x-on-behalf-of"] = WHOP_AGENT_USER_ID;
    }

    console.log(`📡 Making GraphQL request for feedId: ${feedId}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch("https://api.whop.com/public-graphql", {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: GET_CHAT_FEED,
        variables: { feedId }
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log(`📡 GraphQL response status: ${response.status}`);

    if (!response.ok) {
      console.error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error("GraphQL errors:", data.errors);
      return null;
    }

    const experienceId = data.data?.chatFeed?.experienceId;
    
    if (experienceId) {
      console.log(`🎯 GraphQL: Found experienceId ${experienceId} for feedId ${feedId}`);
      return experienceId;
    } else {
      console.log(`❌ GraphQL: No experienceId found for feedId ${feedId}`);
      return null;
    }
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`⏰ GraphQL request timed out for feedId: ${feedId}`);
    } else {
      console.error("Error getting chat feed details:", error);
    }
    return null;
  }
}

/**
 * Find or create a company record for a given companyId
 * For now, this is simplified without database operations
 */
export async function findOrCreateCompany(
  companyId: string, 
  config?: Record<string, any>
) {
  // Simplified version - just return a mock company object
  return {
    id: companyId,
    name: "AI Bot Company",
    config: {
      bizName: "Community",
      bizId: "biz_test",
      botSettings: {
        enabled: false,
        knowledgeBase: '',
        aiProvider: 'openai',
        apiKey: '',
        screenshotSummaries: false,
        forumPostingEnabled: false
      },
      ...config
    }
  };
}

/**
 * Get all commands for a specific experience
 * 
 * @param experienceId - The experience ID
 * @returns Array of commands for this experience
 */
export async function getExperienceCommands(experienceId: string) {
  // TODO: Implement when CustomCommand model is added to Prisma schema
  return [];
}

/**
 * Create a command for a specific experience
 * 
 * @param experienceId - The experience ID
 * @param trigger - Command trigger
 * @param response - Command response
 * @param type - Command type ("command" or "keyword")
 * @returns The created command
 */
export async function createExperienceCommand(
  experienceId: string,
  trigger: string,
  response: string,
  type: string = "command"
) {
  // TODO: Implement when CustomCommand model is added to Prisma schema
  console.log(`TODO: Create command ${trigger} for experience ${experienceId}`);
  return null;
}

/**
 * Delete a command from a specific experience
 * 
 * @param experienceId - The experience ID
 * @param commandId - The command ID to delete
 * @returns The deleted command
 */
export async function deleteExperienceCommand(experienceId: string, commandId: string) {
  // TODO: Implement when CustomCommand model is added to Prisma schema
  console.log(`TODO: Delete command ${commandId} for experience ${experienceId}`);
  return null;
}

// You can call this to track metrics
export async function sendWhopWebhook({
  content,
  experienceId = "exp_default",
}: {
  content: string;
  experienceId?: string;
}) {
  const payload = {
    content,
  };

  const webhookUrl = process.env.DEFAULT_WEBHOOK_URL || "";

  if (!webhookUrl) {
    console.log("No webhook URL configured, skipping webhook");
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      console.error(
        `Webhook failed with status ${response.status}: ${responseBody}`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error sending webhook: ${errorMessage}`);
  }
}

// Temporary mapping from chat experienceId to bot installation experienceId
const CHAT_TO_BOT_MAPPING: Record<string, string> = {
  'exp_HZsGHr6WEahQMM': 'exp_qCPzh0pDEE0YZx', // Map chat exp to bot installation exp
};

// Get experience ID from feed ID - uses GraphQL query for accurate mapping
export async function getFeedExperienceId(feedId: string): Promise<string | null> {
  try {
    console.log(`🔍 Looking up experienceId for feedId: ${feedId}`);
    
    // Use the GraphQL query to get the chat experienceId
    const chatExperienceId = await getChatFeedExperienceId(feedId);
    
    if (chatExperienceId) {
      console.log(`🎯 Found chat experienceId for feed ${feedId}: ${chatExperienceId}`);
      
      // Map chat experienceId to bot installation experienceId
      const botExperienceId = CHAT_TO_BOT_MAPPING[chatExperienceId] || chatExperienceId;
      
      if (botExperienceId !== chatExperienceId) {
        console.log(`🔄 Mapped chat exp ${chatExperienceId} to bot exp ${botExperienceId}`);
      }
      
      return botExperienceId;
    }

    console.error(`❌ No experienceId found for feed ${feedId}`);
    return null;

  } catch (error) {
    console.error(`Error getting experience ID for feed ${feedId}:`, error);
    return null;
  }
} 