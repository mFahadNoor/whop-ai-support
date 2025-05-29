import { NextRequest, NextResponse } from 'next/server';
import { verifyUserToken } from '@whop/api';
import { dataManager, isValidBotSettings } from '@/lib/data-manager';
import { whopApi } from '@/lib/whop-api';

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

async function authenticateUser(request: NextRequest, companyId: string) {
  try {
    // Verify user token from headers
    const { userId } = await verifyUserToken(request.headers);
    
    if (!userId) {
      return { error: 'No user token found', status: 401 };
    }

    // Check if user has access to this company
    const accessCheck = await whopApi.checkIfUserHasAccessToCompany({ userId, companyId });
    
    if (accessCheck.hasAccessToCompany.accessLevel !== 'owner') {
      return { error: 'Insufficient permissions - owner access required', status: 403 };
    }

    return { userId, success: true };
  } catch (error) {
    console.error('Authentication error:', error);
    return { error: 'Authentication failed', status: 401 };
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    
    // Authenticate user
    const auth = await authenticateUser(request, companyId);
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }
    
    // Get settings using data manager
    const settings = await dataManager.getBotSettings(companyId);

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
    
    // Authenticate user
    const auth = await authenticateUser(request, companyId);
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }
    
    const { settings } = await request.json();

    if (!isValidBotSettings(settings)) {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }

    // Save settings using data manager
    await dataManager.saveBotSettings(companyId, settings);

    console.log(`✅ Settings saved and cache invalidated for company ${companyId}`);

    return NextResponse.json({ 
      success: true, 
      settings: settings,
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
    
    // Authenticate user
    const auth = await authenticateUser(request, companyId);
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }
    
    // Force clear cache for this company using data manager
    dataManager.clearCache(companyId);
    console.log(`🔄 Manually cleared cache for company ${companyId}`);
    
    // Force refresh to get latest settings
    const freshSettings = await dataManager.getBotSettings(companyId, true);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Cache cleared and refreshed',
      settings: freshSettings,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in DELETE route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 