import { headers } from 'next/headers';
import { config } from './shared-utils';

export interface UserToken {
  userId: string;
  [key: string]: any;
}

export async function verifyUserToken(headersList: Headers): Promise<UserToken | null> {
  try {
    // Get authorization header
    const authorization = headersList.get('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return null;
    }

    const token = authorization.substring(7);
    
    // For now, we'll extract user info from the token
    // In a real implementation, you'd validate this with Whop's API
    return {
      userId: 'user_from_token', // This would be extracted from the actual token
    };
  } catch (error) {
    console.error('Error verifying user token:', error);
    return null;
  }
}

export const whopApi = {
  async checkIfUserHasAccessToCompany({ userId, companyId }: { userId: string; companyId: string }) {
    try {
      // For now, return owner access for all users
      // In a real implementation, you'd check this with Whop's API
      return {
        hasAccessToCompany: {
          accessLevel: 'owner' as const
        }
      };
    } catch (error) {
      console.error('Error checking user access:', error);
      return {
        hasAccessToCompany: {
          accessLevel: 'none' as const
        }
      };
    }
  }
}; 