import { NextRequest, NextResponse } from 'next/server';
import { dataManager, isValidBotSettings } from '@/lib/data-manager';

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