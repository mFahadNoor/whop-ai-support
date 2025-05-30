import { NextRequest, NextResponse } from 'next/server';
import { dataManager, isValidBotSettings } from '@/lib/data-manager';
import { verifyCompanyAdminAccess } from '@/lib/auth-utils';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    
    // Verify authentication and authorization
    const auth = await verifyCompanyAdminAccess(request, companyId);
    if (!auth.authorized) {
      return NextResponse.json(
        { 
          error: auth.userMessage || auth.error,
          details: auth.error,
          code: 'UNAUTHORIZED' 
        },
        { status: 401 }
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
    
    // Verify authentication and authorization
    const auth = await verifyCompanyAdminAccess(request, companyId);
    if (!auth.authorized) {
      return NextResponse.json(
        { 
          error: auth.userMessage || auth.error,
          details: auth.error,
          code: 'UNAUTHORIZED' 
        },
        { status: 401 }
      );
    }
    
    const { settings } = await request.json();

    if (!isValidBotSettings(settings)) {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }

    // Save settings using data manager
    await dataManager.saveBotSettings(companyId, settings);

    console.log(`✅ Settings saved by user ${auth.userId} for company ${companyId}`);

    return NextResponse.json({ 
      success: true, 
      settings: settings,
      savedBy: auth.userId
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
    
    // Verify authentication and authorization
    const auth = await verifyCompanyAdminAccess(request, companyId);
    if (!auth.authorized) {
      return NextResponse.json(
        { 
          error: auth.userMessage || auth.error,
          details: auth.error,
          code: 'UNAUTHORIZED' 
        },
        { status: 401 }
      );
    }
    
    console.log(`🔄 Getting fresh settings for company ${companyId} (no caching) - requested by user ${auth.userId}`);
    
    // Get latest settings directly from database (no caching)
    const freshSettings = await dataManager.getBotSettings(companyId);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Fresh settings retrieved (no caching enabled)',
      settings: freshSettings,
      requestedBy: auth.userId,
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