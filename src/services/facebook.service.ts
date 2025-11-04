import axios from "axios";

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
    accessToken: string
  ): Promise<FacebookUserProfile | null> {
    try {
      // First, validate the token
      const tokenValidationUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;

      const tokenResponse = await axios.get<FacebookTokenValidation>(
        tokenValidationUrl
      );

      if (!tokenResponse.data.data.is_valid) {
        console.error("Invalid Facebook token");
        return null;
      }

      // Get user profile
      const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`;

      const profileResponse = await axios.get<FacebookUserProfile>(profileUrl);

      // Debug: Log what Facebook actually returns
      console.log(
        "Facebook Profile Response:",
        JSON.stringify(profileResponse.data, null, 2)
      );

      return profileResponse.data;
    } catch (error) {
      console.error("Facebook token validation error:", error);
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
    checkFunction: (username: string) => Promise<boolean>
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
