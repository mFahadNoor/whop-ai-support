import { NextRequest, NextResponse } from 'next/server';
import { dataManager } from '@/lib/data-manager';
import { logger } from '@/lib/shared-utils';
import { verifyCompanyAdminAccess } from '@/lib/auth-utils';

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
      userId: auth.userId,
      action: 'manual_mapping_request'
    });
    
    // Register the experience mapping
    dataManager.registerExperience(experienceId, companyId);
    
    return NextResponse.json({ 
      success: true,
      message: `Mapped experience ${experienceId} to company ${companyId}`,
      mapping: { experienceId, companyId },
      createdBy: auth.userId
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
    
    // Get all mappings for this company using the new method
    const mappingsForCompany = dataManager.getAllMappingsForCompany(companyId);
    const stats = dataManager.getStats();
    
    return NextResponse.json({
      companyId,
      mappings: mappingsForCompany,
      totalMappings: mappingsForCompany.length,
      totalSystemMappings: stats.experienceMappings,
      requestedBy: auth.userId
    });
    
  } catch (error) {
    logger.error('Failed to get experience mappings', error as Error);
    return NextResponse.json(
      { error: 'Failed to get mappings' },
      { status: 500 }
    );
  }
}

