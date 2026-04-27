import axios from "axios";
import logger from "../utils/logger";

interface FacebookUserProfile {
  id: string;
  name: string;
  email?: string; // Email is optional - user might decline permission
  picture?: {
    data: {
      url: string;
    };
  };
}

interface FacebookTokenValidation {
  data: {
    app_id: string;
    type: string;
    application: string;
    data_access_expires_at: number;
    expires_at: number;
    is_valid: boolean;
    scopes: string[];
    user_id: string;
  };
}

const FacebookService = {
  /**
   * Validate Facebook access token and get user profile
   */
  async validateTokenAndGetProfile(
    accessToken: string,
  ): Promise<FacebookUserProfile | null> {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      logger.error(
        "Facebook auth misconfigured: FACEBOOK_APP_ID or FACEBOOK_APP_SECRET missing",
      );
      return null;
    }

    try {
      // 1. Validate the token via debug_token (server-to-server with app token).
      const tokenValidationUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(
        accessToken,
      )}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;

      const tokenResponse =
        await axios.get<FacebookTokenValidation>(tokenValidationUrl);
      const tokenData = tokenResponse.data?.data;

      if (!tokenData || !tokenData.is_valid) {
        logger.warn("Invalid Facebook token", {
          is_valid: tokenData?.is_valid,
        });
        return null;
      }

      // 2. Confirm the token was issued for *our* Facebook app. Without this
      // check, an attacker could use a token from any FB app to log in here.
      if (tokenData.app_id !== appId) {
        logger.warn("Facebook token issued for wrong app_id", {
          expected: appId,
          actual: tokenData.app_id,
        });
        return null;
      }

      // 3. Reject expired tokens. expires_at === 0 means "never expires"
      // (long-lived page tokens etc.) which we still allow.
      if (
        typeof tokenData.expires_at === "number" &&
        tokenData.expires_at !== 0 &&
        tokenData.expires_at * 1000 < Date.now()
      ) {
        logger.warn("Facebook token is expired");
        return null;
      }

      // 4. Fetch the user profile.
      const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${encodeURIComponent(
        accessToken,
      )}`;
      const profileResponse = await axios.get<FacebookUserProfile>(profileUrl);
      const profile = profileResponse.data;

      // 5. Cross-check: the user_id from debug_token must match /me?id=...
      if (!profile?.id || profile.id !== tokenData.user_id) {
        logger.warn("Facebook profile id mismatch with debug_token user_id");
        return null;
      }

      logger.debug("Facebook profile validated", { userId: profile.id });
      return profile;
    } catch (error) {
      logger.error(
        "Facebook token validation error",
        undefined,
        error as Error,
      );
      return null;
    }
  },

  /**
   * Generate a username from Facebook profile
   */
  generateUsername(name: string, facebookId: string): string {
    // Remove spaces and special characters, convert to lowercase
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Take first 8 characters and add last 4 digits of Facebook ID
    const baseUsername = cleanName.substring(0, 8);
    const idSuffix = facebookId.slice(-4);

    return `${baseUsername}${idSuffix}`;
  },

  /**
   * Ensure username is unique by appending numbers if needed
   */
  async ensureUniqueUsername(
    baseUsername: string,
    checkFunction: (username: string) => Promise<boolean>,
  ): Promise<string> {
    let username = baseUsername;
    let counter = 1;

    while (await checkFunction(username)) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    return username;
  },
};

export default FacebookService;
