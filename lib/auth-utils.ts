/**
 * Authentication Utilities
 * 
 * Shared authentication and authorization utilities for API routes.
 * Provides company ownership verification and user access control.
 */

import { NextRequest } from 'next/server';
import { verifyUserToken } from '@whop/api';
import { WhopAPI } from '@whop-apps/sdk';
import { dataManager } from './data-manager';

export interface AuthResult {
  authorized: boolean;
  userId: string | null;
  error: string | null;
  userMessage?: string; // User-friendly message for display
}

/**
 * Verify that a user has admin access to a specific company
 * Checks multiple levels of access:
 * 1. Company owner
 * 2. Authorized company admin
 * 3. Experience member (fallback)
 */
export async function verifyCompanyAdminAccess(
  request: NextRequest, 
  companyId: string
): Promise<AuthResult> {
  try {
    // Verify user token
    const { userId } = await verifyUserToken(request.headers);
    
    if (!userId) {
      return { 
        authorized: false, 
        userId: null, 
        error: 'No valid user token',
        userMessage: 'You must be logged in to access this page. Please sign in and try again.'
      };
    }

    // Check if user owns or has admin access to this specific company
    try {
      // Get company information using WhopAPI
      const companyResponse = await WhopAPI.app().GET("/app/companies/{id}", {
        params: { path: { id: companyId } }
      });

      if (!companyResponse.data) {
        return { 
          authorized: false, 
          userId, 
          error: 'Company not found',
          userMessage: 'This company could not be found. Please check the URL and try again.'
        };
      }

      const company = companyResponse.data;

      // Check if user is the company owner
      if (company.owner && company.owner.id === userId) {
        console.log(`✅ User ${userId} verified as owner of company ${companyId}`);
        return { authorized: true, userId, error: null };
      }

      // Check if user is an authorized user/admin
      if (company.authorized_user && company.authorized_user.id === userId) {
        console.log(`✅ User ${userId} verified as authorized admin of company ${companyId}`);
        return { authorized: true, userId, error: null };
      }

      // User doesn't have access to this company
      console.log(`❌ User ${userId} denied access to company ${companyId} - not owner or admin`);
      return { 
        authorized: false, 
        userId, 
        error: 'You do not have admin access to this company',
        userMessage: `You don't have permission to manage settings for this company. Only the company owner or authorized administrators can access this page.`
      };

    } catch (apiError) {
      console.error('Error checking company ownership:', apiError);
      
      // Fallback: Check if user has any memberships/access to experiences for this company
      try {
        // Get experience ID for this company
        const experienceId = dataManager.getExperienceIdByCompanyId(companyId);
        
        if (experienceId) {
          // Get user's experiences to see if they have access
          const userExperiences = await WhopAPI.me({ req: request }).GET("/me/experiences", {
            params: { query: { company_id: companyId } }
          });

          if (userExperiences.data && userExperiences.data.data.length > 0) {
            console.log(`✅ User ${userId} has experience access to company ${companyId}`);
            return { authorized: true, userId, error: null };
          }
        }
      } catch (fallbackError) {
        console.error('Fallback auth check failed:', fallbackError);
      }

      return { 
        authorized: false, 
        userId, 
        error: 'Unable to verify company access',
        userMessage: 'Unable to verify your access to this company. Please contact support if you believe you should have access.'
      };
    }
    
  } catch (error) {
    console.error('Authentication error:', error);
    return { 
      authorized: false, 
      userId: null, 
      error: 'Authentication failed',
      userMessage: 'Authentication failed. Please try refreshing the page or signing in again.'
    };
  }
}

/**
 * Basic user token verification
 */
export async function verifyUser(request: NextRequest): Promise<AuthResult> {
  try {
    const { userId } = await verifyUserToken(request.headers);
    
    if (!userId) {
      return { 
        authorized: false, 
        userId: null, 
        error: 'No valid user token',
        userMessage: 'You must be logged in to access this feature.'
      };
    }

    return { authorized: true, userId, error: null };
    
  } catch (error) {
    console.error('User verification error:', error);
    return { 
      authorized: false, 
      userId: null, 
      error: 'Authentication failed',
      userMessage: 'Authentication failed. Please try signing in again.'
    };
  }
} 