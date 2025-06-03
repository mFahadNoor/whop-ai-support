import { verifyUserToken } from '@whop/api';
import { config } from './shared-utils';

export { verifyUserToken };

export const whopApi = {
  async checkIfUserHasAccessToCompany({ userId, companyId }: { userId: string; companyId: string }) {
    try {
      // Use the real Whop API to check user access
      const response = await fetch(`https://api.whop.com/api/v5/companies/${companyId}/members/${userId}`, {
        headers: {
          'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          // User is not a member of this company
          return {
            hasAccessToCompany: {
              accessLevel: 'none' as const
            }
          };
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const memberData = await response.json();
      
      // Check if user is an owner/admin
      // The API returns role information in the member data
      const isOwner = memberData.role === 'owner' || memberData.is_owner === true;
      
      return {
        hasAccessToCompany: {
          accessLevel: isOwner ? 'owner' as const : 'none' as const
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
  },

  async retrieveUser({ userId }: { userId: string }) {
    try {
      const response = await fetch(`https://api.whop.com/api/v5/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${config.WHOP_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const userData = await response.json();
      return {
        publicUser: userData
      };
    } catch (error) {
      console.error('Error retrieving user:', error);
      return null;
    }
  }
}; 