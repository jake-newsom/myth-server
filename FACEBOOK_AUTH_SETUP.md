# Facebook Authentication Setup

This guide explains how to set up Facebook authentication for the Viking Vengeance API.

## Prerequisites

1. A Facebook Developer Account
2. A Facebook App configured for your project

## Facebook App Setup

### 1. Create a Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click "My Apps" → "Create App"
3. Choose "Consumer" as the app type
4. Fill in your app details:
   - App Name: "Viking Vengeance" (or your preferred name)
   - App Contact Email: Your email
   - App Purpose: Gaming/Entertainment

### 2. Configure Facebook Login

1. In your Facebook App dashboard, go to "Add a Product"
2. Find "Facebook Login" and click "Set Up"
3. Choose "Web" as the platform
4. Add your website URL (e.g., `http://localhost:3000` for development)

### 3. Get App Credentials

1. Go to Settings → Basic in your Facebook App dashboard
2. Copy your App ID and App Secret
3. Add these to your environment variables

## Environment Variables

Add the following variables to your `.env` file:

```bash
# Facebook OAuth Configuration
FACEBOOK_APP_ID=your_facebook_app_id_here
FACEBOOK_APP_SECRET=your_facebook_app_secret_here

# Application URLs (required for callbacks and redirects)
API_URL=http://localhost:3000  # Your API base URL
CLIENT_URL=http://localhost:3000  # Your client application URL
```

## Facebook App Configuration URLs

When setting up your Facebook App, you'll need to configure these URLs:

### Valid OAuth Redirect URIs

```
http://localhost:3000/api/auth/facebook/callback  # Development
https://yourapi.com/api/auth/facebook/callback    # Production
```

### Deauthorize Callback URL

```
http://localhost:3000/api/auth/facebook/deauthorize  # Development
https://yourapi.com/api/auth/facebook/deauthorize    # Production
```

### Data Deletion Request URL

```
http://localhost:3000/api/auth/facebook/data-deletion  # Development
https://yourapi.com/api/auth/facebook/data-deletion    # Production
```

## API Endpoints

### 1. Token-Based Authentication (Recommended for Mobile/SPA)

```
POST /api/auth/facebook
```

### Request Body

```json
{
  "accessToken": "facebook_access_token_from_client"
}
```

### Response (Success - Existing User)

```json
{
  "accessToken": "jwt_access_token",
  "refreshToken": "jwt_refresh_token",
  "expiresAt": "2024-01-01T12:00:00.000Z",
  "user": {
    "user_id": "uuid",
    "username": "generated_username",
    "email": "user@facebook.com",
    "in_game_currency": 0,
    "gold": 0,
    "gems": 0,
    "fate_coins": 0,
    "total_xp": 0
  }
}
```

### Response (Success - New User)

Same as above, but with HTTP status 201 (Created) instead of 200 (OK).

### Error Responses

#### 400 - Missing Access Token

```json
{
  "error": {
    "message": "Facebook access token is required."
  }
}
```

#### 401 - Invalid Access Token

```json
{
  "error": {
    "message": "Invalid Facebook access token."
  }
}
```

#### 409 - Email Already Exists

```json
{
  "error": {
    "message": "An account with this email already exists. Please log in with your email and password first, then link your Facebook account in settings.",
    "code": "EMAIL_ALREADY_EXISTS"
  }
}
```

### 2. Web-Based OAuth Flow (Alternative for Web Apps)

```
GET /api/auth/facebook/callback
```

This endpoint handles the OAuth callback from Facebook. To initiate the flow, redirect users to:

```
https://www.facebook.com/v18.0/dialog/oauth?client_id=YOUR_APP_ID&redirect_uri=YOUR_API_URL/api/auth/facebook/callback&scope=email&response_type=code&state=OPTIONAL_STATE
```

### 3. Compliance Endpoints (Required by Facebook)

#### Deauthorization Callback

```
POST /api/auth/facebook/deauthorize
```

#### Data Deletion Request

```
POST /api/auth/facebook/data-deletion
```

These endpoints are called by Facebook and must be configured in your Facebook App settings.

### 4. Account Linking Endpoints (Protected)

#### Link Facebook Account

```
POST /api/auth/facebook/link
Authorization: Bearer jwt_access_token
```

**Request Body:**

```json
{
  "accessToken": "facebook_access_token_from_sdk"
}
```

**Success Response:**

```json
{
  "message": "Facebook account linked successfully",
  "user": {
    "user_id": "uuid",
    "username": "existing_username",
    "email": "user@example.com",
    "facebook_id": "facebook_user_id",
    "auth_provider": "local",
    "gold": 100,
    "gems": 50,
    "fate_coins": 25,
    "total_xp": 1500
  }
}
```

#### Unlink Facebook Account

```
DELETE /api/auth/facebook/unlink
Authorization: Bearer jwt_access_token
```

**Success Response:**

```json
{
  "message": "Facebook account unlinked successfully",
  "user": {
    "user_id": "uuid",
    "username": "existing_username",
    "email": "user@example.com",
    "facebook_id": null,
    "auth_provider": "local",
    "gold": 100,
    "gems": 50,
    "fate_coins": 25,
    "total_xp": 1500
  }
}
```

## Client Integration

### Web (JavaScript)

```javascript
// Initialize Facebook SDK
window.fbAsyncInit = function () {
  FB.init({
    appId: "YOUR_FACEBOOK_APP_ID",
    cookie: true,
    xfbml: true,
    version: "v18.0",
  });
};

// Login with Facebook
function loginWithFacebook() {
  FB.login(
    function (response) {
      if (response.authResponse) {
        // Send the access token to your API
        fetch("/api/auth/facebook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessToken: response.authResponse.accessToken,
          }),
        })
          .then((response) => response.json())
          .then((data) => {
            // Handle successful authentication
            localStorage.setItem("accessToken", data.accessToken);
            localStorage.setItem("refreshToken", data.refreshToken);
          });
      }
    },
    { scope: "email" }
  );
}

// Alternative: Web-based OAuth flow
function loginWithFacebookOAuth() {
  const clientId = "YOUR_FACEBOOK_APP_ID";
  const redirectUri = encodeURIComponent(
    "YOUR_API_URL/api/auth/facebook/callback"
  );
  const scope = "email";
  const state = Math.random().toString(36).substring(7); // CSRF protection

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;

  // Store state for verification
  sessionStorage.setItem("facebook_oauth_state", state);

  // Redirect to Facebook
  window.location.href = authUrl;
}

// Handle the callback (on your success page)
function handleAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const accessToken = urlParams.get("accessToken");
  const refreshToken = urlParams.get("refreshToken");

  if (accessToken && refreshToken) {
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    // Redirect to app
    window.location.href = "/dashboard";
  }
}
```

### React Native

```javascript
import { LoginManager, AccessToken } from "react-native-fbsdk-next";

async function loginWithFacebook() {
  try {
    const result = await LoginManager.logInWithPermissions(["email"]);

    if (result.isCancelled) {
      console.log("Login cancelled");
      return;
    }

    const data = await AccessToken.getCurrentAccessToken();

    if (data) {
      // Send token to your API
      const response = await fetch("YOUR_API_URL/api/auth/facebook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: data.accessToken,
        }),
      });

      const authData = await response.json();
      // Handle successful authentication
    }
  } catch (error) {
    console.error("Facebook login error:", error);
  }
}
```

## Security Considerations

1. **Token Validation**: The API validates Facebook tokens server-side using Facebook's Graph API
2. **Rate Limiting**: Facebook auth endpoints are rate-limited to prevent abuse
3. **Account Linking**: Existing email accounts require manual linking to prevent account takeover
4. **Username Generation**: Usernames are automatically generated from Facebook profile data
5. **Email Handling**: If Facebook doesn't provide email (user declined permission), a placeholder email is generated: `{facebook_id}@facebook.local`

## Testing

Run the test script to verify Facebook authentication:

```bash
node scripts/test-facebook-auth.js
```

Note: You'll need valid Facebook credentials and a running server to test with real tokens.

## Database Schema

The Facebook authentication adds the following fields to the `users` table:

- `facebook_id`: Unique Facebook user ID
- `auth_provider`: Either 'local' or 'facebook'
- `password_hash`: Now nullable for social auth users

## Troubleshooting

### Common Issues

1. **Invalid Token Error**: Ensure your Facebook App ID and Secret are correct
2. **CORS Issues**: Make sure your domain is added to Facebook App settings
3. **Email Conflicts**: Users with existing accounts need to link manually

### Debug Mode

Enable debug logging by setting:

```bash
NODE_ENV=development
```

This will provide more detailed error messages in the console.
