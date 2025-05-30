import { NextRequest, NextResponse } from 'next/server';
import { dataManager } from '@/lib/data-manager';
import { logger } from '@/lib/shared-utils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    const { experienceId } = await request.json();
    
    if (!experienceId) {
      return NextResponse.json(
        { error: 'experienceId is required' },
        { status: 400 }
      );
    }
    
    logger.info('Manual experience mapping request', {
      companyId,
      experienceId,
      action: 'manual_mapping_request'
    });
    
    // Register the experience mapping
    dataManager.registerExperience(experienceId, companyId);
    
    return NextResponse.json({ 
      success: true,
      message: `Mapped experience ${experienceId} to company ${companyId}`,
      mapping: { experienceId, companyId }
    });
    
  } catch (error) {
    logger.error('Failed to create experience mapping', error as Error);
    return NextResponse.json(
      { error: 'Failed to create mapping' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    
    // Get all mappings for this company using the new method
    const mappingsForCompany = dataManager.getAllMappingsForCompany(companyId);
    const stats = dataManager.getStats();
    
    return NextResponse.json({
      companyId,
      mappings: mappingsForCompany,
      totalMappings: mappingsForCompany.length,
      totalSystemMappings: stats.experienceMappings
    });
    
  } catch (error) {
    logger.error('Failed to get experience mappings', error as Error);
    return NextResponse.json(
      { error: 'Failed to get mappings' },
      { status: 500 }
    );
  }
}

