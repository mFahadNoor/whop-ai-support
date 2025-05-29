import { verifyUserToken } from '@whop/api';
import { headers } from 'next/headers';
import ClientPage from './client-page';

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const resolvedParams = await params;
  
  try {
    // Check authentication using Whop SDK
    const headersList = await headers();
    const { userId } = await verifyUserToken(headersList);
    
    if (!userId) {
      return <ClientPage companyId={resolvedParams.companyId} isAuthorized={false} userId={null} />;
    }

    // For now, if we have a valid userId, consider them authorized
    // You can add more specific company ownership checks here if needed
    return <ClientPage companyId={resolvedParams.companyId} isAuthorized={true} userId={userId} />;
    
    } catch (error) {
    console.error('Authentication error:', error);
    return <ClientPage companyId={resolvedParams.companyId} isAuthorized={false} userId={null} />;
  }
} 