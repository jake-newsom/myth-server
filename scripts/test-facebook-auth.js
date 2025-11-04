const axios = require('axios');

// Test script for Facebook authentication
// Note: You'll need to set up Facebook App credentials in your environment

const BASE_URL = 'http://localhost:3000';

async function testFacebookAuth() {
  console.log('🧪 Testing Facebook Authentication...\n');

  // Test 1: Missing access token
  console.log('Test 1: Missing access token');
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/facebook`, {});
    console.log('❌ Should have failed with missing token');
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Correctly rejected missing access token');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  // Test 2: Invalid access token
  console.log('\nTest 2: Invalid access token');
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/facebook`, {
      accessToken: 'invalid_token_123'
    });
    console.log('❌ Should have failed with invalid token');
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Correctly rejected invalid access token');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  // Test 3: Facebook callback endpoint
  console.log('\nTest 3: Facebook OAuth callback (missing code)');
  try {
    const response = await axios.get(`${BASE_URL}/api/auth/facebook/callback`);
    console.log('❌ Should have redirected with error');
  } catch (error) {
    if (error.response?.status === 302) {
      console.log('✅ Correctly redirected for missing code');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  // Test 4: Deauthorization endpoint (missing signed_request)
  console.log('\nTest 4: Facebook deauthorization (missing signed_request)');
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/facebook/deauthorize`, {});
    console.log('❌ Should have failed with missing signed_request');
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Correctly rejected missing signed_request');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  // Test 5: Data deletion endpoint (missing signed_request)
  console.log('\nTest 5: Facebook data deletion (missing signed_request)');
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/facebook/data-deletion`, {});
    console.log('❌ Should have failed with missing signed_request');
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Correctly rejected missing signed_request');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  // Test 6: Facebook link endpoint (no auth token)
  console.log('\nTest 6: Facebook link (no auth token)');
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/facebook/link`, {
      accessToken: 'test_token'
    });
    console.log('❌ Should have failed with no auth token');
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Correctly rejected request without auth token');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  // Test 7: Facebook unlink endpoint (no auth token)
  console.log('\nTest 7: Facebook unlink (no auth token)');
  try {
    const response = await axios.delete(`${BASE_URL}/api/auth/facebook/unlink`);
    console.log('❌ Should have failed with no auth token');
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Correctly rejected request without auth token');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  console.log('\n📝 To test with a valid Facebook token:');
  console.log('1. Set up Facebook App credentials in your .env file:');
  console.log('   FACEBOOK_APP_ID=your_app_id');
  console.log('   FACEBOOK_APP_SECRET=your_app_secret');
  console.log('   API_URL=http://localhost:3000');
  console.log('   CLIENT_URL=http://localhost:3000');
  console.log('2. Get a valid access token from Facebook SDK');
  console.log('3. Replace "VALID_FACEBOOK_TOKEN" in this script with the real token');
  console.log('4. Uncomment the test below\n');

  console.log('📝 To test Facebook link/unlink:');
  console.log('1. First create a regular account via /api/auth/register');
  console.log('2. Login to get JWT token');
  console.log('3. Use JWT token to test /api/auth/facebook/link');
  console.log('4. Use JWT token to test /api/auth/facebook/unlink\n');

  // Test 3: Valid access token (uncomment when you have a real token)
  /*
  console.log('Test 3: Valid access token');
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/facebook`, {
      accessToken: 'VALID_FACEBOOK_TOKEN'
    });
    
    if (response.status === 200 || response.status === 201) {
      console.log('✅ Facebook authentication successful');
      console.log('User:', response.data.user.username);
      console.log('Access Token received:', !!response.data.accessToken);
    }
  } catch (error) {
    console.log('❌ Facebook auth failed:', error.response?.data || error.message);
  }
  */
}

// Only run if server is running
axios.get(`${BASE_URL}/api/health`)
  .then(() => {
    testFacebookAuth();
  })
  .catch(() => {
    console.log('❌ Server is not running. Please start the server first with: npm run dev');
  });
