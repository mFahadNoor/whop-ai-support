'use server';

import { verifyUserToken } from '@whop/api';
import { headers } from 'next/headers';
import { dataManager, isValidBotSettings } from '@/lib/data-manager';
import { whopApi } from '@/lib/whop-api';

async function authenticateUser(companyId: string) {
  try {
    // Verify user token from headers
    const headersList = await headers();
    const { userId } = await verifyUserToken(headersList);
    
    if (!userId) {
      throw new Error('No user token found');
    }

    // Check if user has access to this company
    const accessCheck = await whopApi.checkIfUserHasAccessToCompany({ userId, companyId });
    
    if (accessCheck.hasAccessToCompany.accessLevel !== 'owner') {
      throw new Error('Insufficient permissions - owner access required');
    }

    return { userId, success: true };
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

export async function getSettings(companyId: string) {
  try {
    // Authenticate user
    await authenticateUser(companyId);
    
    // Get settings using data manager
    const settings = await dataManager.getBotSettings(companyId);
    
    return { success: true, settings };
  } catch (error: any) {
    console.error('Error fetching bot settings:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to fetch settings' 
    };
  }
}

export async function saveSettings(companyId: string, settings: any) {
  try {
    // Authenticate user
    await authenticateUser(companyId);
    
    if (!isValidBotSettings(settings)) {
      throw new Error('Invalid settings data');
    }

    // Save settings using data manager
    await dataManager.saveBotSettings(companyId, settings);

    console.log(`✅ Settings saved and cache invalidated for company ${companyId}`);

    return { 
      success: true, 
      settings: settings,
      cacheInvalidated: true 
    };
  } catch (error: any) {
    console.error('Error saving bot settings:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to save settings' 
    };
  }
}

export async function clearCache(companyId: string) {
  try {
    // Authenticate user
    await authenticateUser(companyId);
    
    // Force clear cache for this company using data manager
    dataManager.clearCache(companyId);
    console.log(`🔄 Manually cleared cache for company ${companyId}`);
    
    // Force refresh to get latest settings
    const freshSettings = await dataManager.getBotSettings(companyId, true);
    
    return { 
      success: true, 
      message: 'Cache cleared and refreshed',
      settings: freshSettings,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('Error clearing cache:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to clear cache' 
    };
  }
} 