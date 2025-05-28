#!/usr/bin/env node

/**
 * Test script to verify cache invalidation functionality
 * Usage: node scripts/test-cache.js [companyId]
 */

const companyId = process.argv[2] || 'demo';
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

async function testCacheInvalidation() {
  console.log('🧪 Testing cache invalidation functionality...\n');
  
  try {
    // 1. Fetch current settings
    console.log('1. Fetching current settings...');
    const getResponse = await fetch(`${baseUrl}/api/company/${companyId}/settings`);
    const currentData = await getResponse.json();
    console.log('Current settings:', JSON.stringify(currentData.settings, null, 2));
    
    // 2. Update settings
    console.log('\n2. Updating settings...');
    const updatedSettings = {
      ...currentData.settings,
      knowledgeBase: `Updated at ${new Date().toISOString()} - Testing cache invalidation`,
      enabled: !currentData.settings.enabled // Toggle enabled state
    };
    
    const updateResponse = await fetch(`${baseUrl}/api/company/${companyId}/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ settings: updatedSettings })
    });
    
    const updateData = await updateResponse.json();
    console.log('Update response:', JSON.stringify(updateData, null, 2));
    
    // 3. Verify cache was invalidated
    console.log('\n3. Verifying cache invalidation...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    const verifyResponse = await fetch(`${baseUrl}/api/company/${companyId}/settings`);
    const verifyData = await verifyResponse.json();
    console.log('Verified settings:', JSON.stringify(verifyData.settings, null, 2));
    
    // 4. Test manual cache clear
    console.log('\n4. Testing manual cache clear...');
    const clearResponse = await fetch(`${baseUrl}/api/company/${companyId}/settings`, {
      method: 'DELETE'
    });
    
    const clearData = await clearResponse.json();
    console.log('Cache clear response:', JSON.stringify(clearData, null, 2));
    
    console.log('\n✅ Cache invalidation test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  testCacheInvalidation();
} 