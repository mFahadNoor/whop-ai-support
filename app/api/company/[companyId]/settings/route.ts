import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { whopAPI } from '@/lib/whop-api';
import { hasAccess } from '@whop-apps/sdk';
import { headers } from 'next/headers';

// Import the company manager to invalidate cache
let companyManager: any = null;
// Dynamic import to avoid issues with bot running in different context
async function getCompanyManager() {
  if (!companyManager) {
    try {
      const module = await import('@/lib/company-manager');
      companyManager = module.companyManager;
    } catch (error) {
      console.warn('Could not import company manager for cache invalidation:', error);
    }
  }
  return companyManager;
}

// Validation function for bot settings
function isValidBotSettings(settings: any): boolean {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  // Check required fields exist and are correct types
  const requiredFields = {
    enabled: 'boolean',
    knowledgeBase: 'string',
    personality: 'string',
    customInstructions: 'string',
    responseStyle: 'string',
    autoResponse: 'boolean',
    responseDelay: 'number'
  };

  for (const [field, type] of Object.entries(requiredFields)) {
    if (!(field in settings) || typeof settings[field] !== type) {
      console.error(`Invalid field: ${field}, expected ${type}, got ${typeof settings[field]}`);
      return false;
    }
  }

  // Validate responseStyle enum
  const validResponseStyles = ['professional', 'friendly', 'casual', 'technical', 'custom'];
  if (!validResponseStyles.includes(settings.responseStyle)) {
    console.error(`Invalid responseStyle: ${settings.responseStyle}`);
    return false;
  }

  // Validate responseDelay range
  if (settings.responseDelay < 0 || settings.responseDelay > 30) {
    console.error(`Invalid responseDelay: ${settings.responseDelay}`);
    return false;
  }

  // Validate presetQA if it exists
  if (settings.presetQA && Array.isArray(settings.presetQA)) {
    for (const qa of settings.presetQA) {
      if (!qa || typeof qa !== 'object' || 
          typeof qa.id !== 'string' || 
          typeof qa.question !== 'string' || 
          typeof qa.answer !== 'string' || 
          typeof qa.enabled !== 'boolean') {
        console.error('Invalid presetQA item:', qa);
        return false;
      }
    }
  }

  return true;
}

const defaultSettings = {
  enabled: false,
  knowledgeBase: '',
  personality: '',
  customInstructions: '',
  forumPostingEnabled: false,
  targetForumIdForFeedCommand: '',
  presetQA: [],
  responseStyle: 'professional',
  autoResponse: true,
  responseDelay: 1
};

// Helper function to check if user is authorized admin for the company
async function checkAdminAccess(companyId: string): Promise<boolean> {
  try {
    const headersList = await headers();
    const access = await hasAccess({ 
      to: `authorized-${companyId}`, 
      headers: headersList 
    });
    return access;
  } catch (error) {
    console.error('Error checking admin access:', error);
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    
    // Check if user is authorized admin for this company
    const hasAdminAccess = await checkAdminAccess(companyId);
    if (!hasAdminAccess) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }
    
    // Find the company
    const company = await prisma.company.findUnique({
      where: { id: companyId }
    });
    
    // Return the settings from the company config with defaults
    const settings = {
      ...defaultSettings,
      ...((company?.config as any)?.botSettings || {})
    };

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Error fetching bot settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    
    // Check if user is authorized admin for this company
    const hasAdminAccess = await checkAdminAccess(companyId);
    if (!hasAdminAccess) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }
    
    const { settings } = await request.json();

    if (!isValidBotSettings(settings)) {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }

    // Save settings to database
    const updatedCompany = await prisma.company.upsert({
      where: { id: companyId },
      update: {
        config: {
          botSettings: settings
        }
      },
      create: {
        id: companyId,
        name: "AI Support Company",
        config: {
          botSettings: settings
        }
      }
    });

    // IMPORTANT: Invalidate cache so bot gets fresh data immediately
    try {
      const manager = await getCompanyManager();
      if (manager) {
        manager.clearCache(companyId);
        console.log(`🔄 Invalidated cache for company ${companyId} after settings update`);
      }
    } catch (error) {
      console.warn('Could not invalidate cache, bot may use stale data for up to 30 seconds:', error);
    }

    console.log(`✅ Settings saved and cache invalidated for company ${companyId}`);

    return NextResponse.json({ 
      success: true, 
      settings: (updatedCompany.config as any)?.botSettings,
      cacheInvalidated: true
    });
  } catch (error) {
    console.error('Error saving bot settings:', error);
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    
    // Check if user is authorized admin for this company
    const hasAdminAccess = await checkAdminAccess(companyId);
    if (!hasAdminAccess) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }
    
    // Force clear cache for this company
    try {
      const manager = await getCompanyManager();
      if (manager) {
        manager.clearCache(companyId);
        console.log(`🔄 Manually cleared cache for company ${companyId}`);
        
        // Force refresh to get latest settings
        const freshSettings = await manager.getBotSettings(companyId, true);
        
        return NextResponse.json({ 
          success: true, 
          message: 'Cache cleared and refreshed',
          settings: freshSettings,
          timestamp: new Date().toISOString()
        });
      } else {
        return NextResponse.json({ 
          success: false, 
          message: 'Company manager not available - cache not cleared',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      return NextResponse.json(
        { error: 'Failed to clear cache', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in DELETE route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 