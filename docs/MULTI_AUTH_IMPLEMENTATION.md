# Multi-Provider Authentication Implementation Guide

## Overview

The server now supports multiple authentication providers per account. Users can authenticate with:
- **Email/Password** (local authentication)
- **Facebook** (via access token)
- **Apple** (via identity token)
- **Google** (via ID token)

Users can link multiple providers to a single account, allowing them to sign in using any linked method.

## Breaking Changes

### Removed Endpoints
- `GET /api/auth/facebook/callback` - OAuth redirect flow removed for consistency

### Behavior Changes
- **Email matching no longer required** when linking social accounts
- All social providers now use **token validation only** (no OAuth redirects)

## Authentication Flow

### Token Validation Method
All social providers follow the same pattern:

1. Client authenticates user with provider SDK (Apple/Google/Facebook)
2. Provider SDK returns a signed token (identity token or access token)
3. Client sends token to your server
4. Server validates token signature using provider's public keys
5. Server creates/updates user and returns session tokens

This is secure because:
- Tokens are cryptographically signed by the provider
- Server verifies signatures using provider's public keys
- Forged tokens will fail validation

## API Endpoints

### Authentication (Public)

#### Register with Email/Password
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "thor_hammer",
  "email": "thor@asgard.com",
  "password": "mjolnir123"
}
```

#### Login with Email/Password
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "thor@asgard.com",
  "password": "mjolnir123"
}
```

#### Authenticate with Facebook
```http
POST /api/auth/facebook
Content-Type: application/json

{
  "accessToken": "EAABwzLixnjYBOZCZCZC..."
}
```

**Response (200 for login, 201 for new user):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": "2024-01-15T10:30:00Z",
  "user": {
    "user_id": "uuid",
    "username": "thor_hammer",
    "email": "thor@asgard.com",
    "in_game_currency": 0,
    "gems": 0,
    "fate_coins": 2,
    "total_xp": 0
  }
}
```

#### Authenticate with Apple
```http
POST /api/auth/apple
Content-Type: application/json

{
  "identityToken": "eyJraWQiOiJlWGF1bm1...",
  "user": {
    "name": {
      "firstName": "Thor",
      "lastName": "Odinson"
    }
  }
}
```

**Note:** The `user` object is optional and only provided by Apple on first sign-in.

**Response:** Same as Facebook (200 for login, 201 for new user)

#### Authenticate with Google
```http
POST /api/auth/google
Content-Type: application/json

{
  "idToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Response:** Same as Facebook (200 for login, 201 for new user)

### Account Linking (Protected - Requires Bearer Token)

All linking endpoints require authentication via Bearer token in the Authorization header:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

#### Link Facebook Account
```http
POST /api/auth/facebook/link
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "accessToken": "EAABwzLixnjYBOZCZCZC..."
}
```

**Success Response (200):**
```json
{
  "message": "Facebook account linked successfully",
  "user": {
    "user_id": "uuid",
    "username": "thor_hammer",
    "email": "thor@asgard.com",
    "facebook_id": "1234567890",
    "auth_provider": "local",
    "in_game_currency": 100,
    "gems": 50,
    "fate_coins": 2,
    "total_xp": 1000
  }
}
```

**Error Responses:**
- `400` - Token missing
- `401` - Invalid token or not authenticated
- `409` - Account already linked (see error codes below)

#### Unlink Facebook Account
```http
DELETE /api/auth/facebook/unlink
Authorization: Bearer {accessToken}
```

**Success Response (200):**
```json
{
  "message": "Facebook account unlinked successfully",
  "user": { ... }
}
```

**Error Responses:**
- `400` - No Facebook account linked, or it's the primary auth method
- `401` - Not authenticated

#### Link Apple Account
```http
POST /api/auth/apple/link
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "identityToken": "eyJraWQiOiJlWGF1bm1..."
}
```

**Response:** Same structure as Facebook link

#### Unlink Apple Account
```http
DELETE /api/auth/apple/unlink
Authorization: Bearer {accessToken}
```

**Response:** Same structure as Facebook unlink

#### Link Google Account
```http
POST /api/auth/google/link
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "idToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Response:** Same structure as Facebook link

#### Unlink Google Account
```http
DELETE /api/auth/google/unlink
Authorization: Bearer {accessToken}
```

**Response:** Same structure as Facebook unlink

## Error Codes

### Linking Errors (409 Conflict)

When linking fails, the response includes an error code:

```json
{
  "error": {
    "message": "This Facebook account is already linked to another user.",
    "code": "FACEBOOK_ALREADY_LINKED"
  }
}
```

**Error Codes:**
- `FACEBOOK_ALREADY_LINKED` - This Facebook account is linked to a different user
- `FACEBOOK_ALREADY_EXISTS` - Current user already has a Facebook account linked
- `APPLE_ALREADY_LINKED` - This Apple account is linked to a different user
- `APPLE_ALREADY_EXISTS` - Current user already has an Apple account linked
- `GOOGLE_ALREADY_LINKED` - This Google account is linked to a different user
- `GOOGLE_ALREADY_EXISTS` - Current user already has a Google account linked

### Unlinking Errors (400 Bad Request)

```json
{
  "error": {
    "message": "Cannot unlink Facebook account as it's your primary authentication method. Please set a password first.",
    "code": "PRIMARY_AUTH_METHOD"
  }
}
```

**Error Code:**
- `PRIMARY_AUTH_METHOD` - Cannot unlink the only authentication method

## TypeScript Type Definitions

### User Type
```typescript
interface User {
  user_id: string;
  username: string;
  email: string;
  password_hash?: string;
  facebook_id?: string;
  apple_id?: string;
  google_id?: string;
  auth_provider: "local" | "facebook" | "apple" | "google";
  role?: "user" | "admin";
  in_game_currency: number;
  gems: number;
  fate_coins: number;
  card_fragments: number;
  total_xp: number;
  pack_count: number;
  win_streak_multiplier: number;
  tower_floor: number;
  created_at: Date;
  last_login: Date;
}
```

### Authentication Request Types

```typescript
// Email/Password Registration
interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

// Email/Password Login
interface LoginRequest {
  email: string;
  password: string;
}

// Facebook Authentication
interface FacebookAuthRequest {
  accessToken: string; // Facebook access token from Facebook SDK
}

// Apple Authentication
interface AppleAuthRequest {
  identityToken: string; // Apple identity token from Sign in with Apple
  user?: {
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
}

// Google Authentication
interface GoogleAuthRequest {
  idToken: string; // Google ID token from Google Sign-In
}
```

### Authentication Response Type

```typescript
interface AuthResponse {
  accessToken: string;      // JWT access token (15 min expiry)
  refreshToken: string;     // JWT refresh token (90 day expiry)
  expiresAt: string;        // ISO 8601 timestamp
  user: {
    user_id: string;
    username: string;
    email: string;
    in_game_currency: number;
    gems: number;
    fate_coins: number;
    total_xp: number;
  };
}
```

### Link Account Request Types

```typescript
interface FacebookLinkRequest {
  accessToken: string;
}

interface AppleLinkRequest {
  identityToken: string;
}

interface GoogleLinkRequest {
  idToken: string;
}
```

### Link/Unlink Response Type

```typescript
interface LinkResponse {
  message: string;
  user: {
    user_id: string;
    username: string;
    email: string;
    apple_id?: string;
    google_id?: string;
    facebook_id?: string;
    auth_provider: string;
    in_game_currency: number;
    gems: number;
    fate_coins: number;
    total_xp: number;
  };
}
```

### Error Response Type

```typescript
interface ErrorResponse {
  error: {
    message: string;
    code?: string;
  };
}
```

## Client Implementation Guide

### 1. Initial Authentication

Users can sign in using any of the four methods. The flow is the same for all:

```typescript
// Example: Apple Sign In
async function signInWithApple() {
  try {
    // 1. Get identity token from Apple SDK
    const appleAuth = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      ],
    });

    // 2. Send to your server
    const response = await fetch('https://your-api.com/api/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identityToken: appleAuth.identityToken,
        user: appleAuth.fullName ? {
          name: {
            firstName: appleAuth.fullName.givenName,
            lastName: appleAuth.fullName.familyName,
          }
        } : undefined,
      }),
    });

    const data = await response.json();

    // 3. Store tokens
    await SecureStore.setItemAsync('accessToken', data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);

    return data.user;
  } catch (error) {
    console.error('Apple sign in failed:', error);
    throw error;
  }
}
```

### 2. Linking Additional Providers

After a user is authenticated, they can link additional providers:

```typescript
async function linkAppleAccount() {
  try {
    // 1. Get current access token
    const accessToken = await SecureStore.getItemAsync('accessToken');

    // 2. Get Apple identity token
    const appleAuth = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });

    // 3. Link to account
    const response = await fetch('https://your-api.com/api/auth/apple/link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        identityToken: appleAuth.identityToken,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message);
    }

    const data = await response.json();
    return data.user;
  } catch (error) {
    console.error('Failed to link Apple account:', error);
    throw error;
  }
}
```

### 3. Unlinking Providers

```typescript
async function unlinkAppleAccount() {
  try {
    const accessToken = await SecureStore.getItemAsync('accessToken');

    const response = await fetch('https://your-api.com/api/auth/apple/unlink', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      
      // Handle specific error: can't unlink primary auth method
      if (error.error.code === 'PRIMARY_AUTH_METHOD') {
        alert('You need to set a password before unlinking your only sign-in method.');
        return;
      }
      
      throw new Error(error.error.message);
    }

    const data = await response.json();
    return data.user;
  } catch (error) {
    console.error('Failed to unlink Apple account:', error);
    throw error;
  }
}
```

### 4. Checking Linked Accounts

The user object returned from authentication includes all linked provider IDs:

```typescript
interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  facebook_id?: string;  // Present if Facebook is linked
  apple_id?: string;     // Present if Apple is linked
  google_id?: string;    // Present if Google is linked
  // ... other fields
}

function getLinkedProviders(user: UserProfile): string[] {
  const providers = [];
  
  if (user.password_hash !== undefined) providers.push('email');
  if (user.facebook_id) providers.push('facebook');
  if (user.apple_id) providers.push('apple');
  if (user.google_id) providers.push('google');
  
  return providers;
}
```

### 5. UI Example: Account Settings

```typescript
function AccountSettingsScreen({ user }: { user: UserProfile }) {
  const hasPassword = user.password_hash !== undefined;
  const hasFacebook = !!user.facebook_id;
  const hasApple = !!user.apple_id;
  const hasGoogle = !!user.google_id;

  return (
    <View>
      <Text>Connected Accounts</Text>
      
      {/* Email/Password */}
      <AccountRow
        provider="Email/Password"
        connected={hasPassword}
        onConnect={() => showSetPasswordDialog()}
        onDisconnect={null} // Can't disconnect password
      />
      
      {/* Facebook */}
      <AccountRow
        provider="Facebook"
        connected={hasFacebook}
        onConnect={() => linkFacebookAccount()}
        onDisconnect={() => unlinkFacebookAccount()}
      />
      
      {/* Apple */}
      <AccountRow
        provider="Apple"
        connected={hasApple}
        onConnect={() => linkAppleAccount()}
        onDisconnect={() => unlinkAppleAccount()}
      />
      
      {/* Google */}
      <AccountRow
        provider="Google"
        connected={hasGoogle}
        onConnect={() => linkGoogleAccount()}
        onDisconnect={() => unlinkGoogleAccount()}
      />
    </View>
  );
}
```

## Security Considerations

### Token Validation
- **Apple**: Server validates identity tokens using Apple's JWKS (public keys)
- **Google**: Server validates ID tokens using Google's tokeninfo endpoint
- **Facebook**: Server validates access tokens using Facebook's debug_token endpoint

### Primary Authentication Method
Users cannot unlink their only authentication method. They must:
1. Have a password set, OR
2. Have at least one other provider linked

This prevents users from locking themselves out of their accounts.

### Token Storage
- Store access/refresh tokens securely (e.g., iOS Keychain, Android Keystore)
- Never store tokens in plain text or AsyncStorage
- Use libraries like `expo-secure-store` or `react-native-keychain`

## Provider SDK Setup

### Apple Sign In
```bash
# React Native
npm install @invertase/react-native-apple-authentication

# Expo
# Built into expo-apple-authentication
```

**iOS Configuration:**
- Enable "Sign in with Apple" capability in Xcode
- Add Sign in with Apple to your Apple Developer account

### Google Sign In
```bash
# React Native
npm install @react-native-google-signin/google-signin

# Expo
expo install @react-native-google-signin/google-signin
```

**Configuration:**
- Create OAuth 2.0 Client ID in Google Cloud Console
- Add SHA-1 fingerprint for Android
- Configure OAuth consent screen

### Facebook Login
```bash
# React Native
npm install react-native-fbsdk-next

# Expo
expo install expo-facebook
```

**Configuration:**
- Create Facebook App in Facebook Developer Console
- Add Facebook App ID to your app configuration
- Configure OAuth redirect URIs

## Testing

### Test Accounts
Create test accounts for each provider:
- **Apple**: Use Apple's test accounts in App Store Connect
- **Google**: Use test users in Google Cloud Console
- **Facebook**: Use test users in Facebook App Dashboard

### Test Scenarios
1. ✅ Sign up with each provider
2. ✅ Sign in with each provider
3. ✅ Link multiple providers to one account
4. ✅ Unlink providers (when not primary)
5. ✅ Attempt to unlink primary auth method (should fail)
6. ✅ Sign in with different linked providers for same account
7. ✅ Attempt to link already-linked provider (should fail)

## Migration Notes

### Existing Users
- Existing users with `auth_provider: 'local'` or `'facebook'` will continue to work
- They can link additional providers at any time
- No data migration required

### Database
Run the migration to add new columns:
```bash
npm run migrate:up
```

This adds:
- `apple_id` column (nullable, unique)
- `google_id` column (nullable, unique)
- Indexes on both columns

## Support

For issues or questions:
1. Check server logs for detailed error messages
2. Verify environment variables are set correctly
3. Ensure provider SDKs are configured properly
4. Test with provider's test accounts first

## Changelog

### v2.0.0 - Multi-Provider Authentication
- ✅ Added Apple Sign In support
- ✅ Added Google Sign In support
- ✅ Added account linking/unlinking for all providers
- ✅ Removed email-matching requirement for linking
- ✅ Removed Facebook OAuth callback (standardized on token validation)
- ✅ Updated OpenAPI documentation


