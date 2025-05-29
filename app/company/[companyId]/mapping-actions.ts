'use server';

import { verifyUserToken } from '@whop/api';
import { headers } from 'next/headers';
import { dataManager } from '@/lib/data-manager';
import { whopApi } from '@/lib/whop-api';
import { logger } from '@/lib/shared-utils';

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

export async function createMapping(companyId: string, experienceId: string) {
  try {
    // Authenticate user
    await authenticateUser(companyId);
    
    if (!experienceId) {
      throw new Error('experienceId is required');
    }
    
    logger.info('Manual experience mapping request', {
      companyId,
      experienceId,
      action: 'manual_mapping_request'
    });
    
    // Register the experience mapping
    dataManager.registerExperience(experienceId, companyId);
    
    return { 
      success: true,
      message: `Mapped experience ${experienceId} to company ${companyId}`,
      mapping: { experienceId, companyId }
    };
    
  } catch (error: any) {
    logger.error('Failed to create experience mapping', error as Error);
    return { 
      success: false, 
      error: error.message || 'Failed to create mapping' 
    };
  }
}

export async function getMappings(companyId: string) {
  try {
    // Authenticate user
    await authenticateUser(companyId);
    
    // Get all mappings for this company
    const stats = dataManager.getStats();
    const mappingsForCompany = Object.entries(stats.experienceMappings.mappings)
      .filter(([_, mappedCompanyId]) => mappedCompanyId === companyId)
      .map(([experienceId, mappedCompanyId]) => ({ experienceId, companyId: mappedCompanyId }));
    
    return {
      success: true,
      companyId,
      mappings: mappingsForCompany,
      totalMappings: mappingsForCompany.length
    };
    
  } catch (error: any) {
    logger.error('Failed to get experience mappings', error as Error);
    return { 
      success: false, 
      error: error.message || 'Failed to get mappings' 
    };
  }
} 