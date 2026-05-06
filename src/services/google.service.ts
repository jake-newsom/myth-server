import axios from "axios";
import logger from "../utils/logger";

interface GoogleUserProfile {
  sub: string; // Google user ID
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

interface GoogleTokenInfoResponse {
  iss: string;
  azp: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  iat: string;
  exp: string;
  alg: string;
  kid: string;
}

/**
 * Build the list of allowed Google OAuth client IDs (token `aud` values).
 *
 * Native iOS and Android Google Sign-In SDKs issue ID tokens whose `aud` is the
 * platform-specific client ID (not the web client ID), so the server must accept
 * any client ID belonging to the project. Configure via either:
 *   - GOOGLE_ALLOWED_AUDIENCES: comma-separated list (preferred), or
 *   - GOOGLE_CLIENT_ID: single value (legacy/back-compat).
 */
function getAllowedAudiences(): string[] {
  const raw =
    process.env.GOOGLE_ALLOWED_AUDIENCES || process.env.GOOGLE_CLIENT_ID || "";
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

const GoogleService = {
  /**
   * Validate Google ID token and get user profile
   */
  async validateTokenAndGetProfile(
    idToken: string,
  ): Promise<GoogleUserProfile | null> {
    try {
      const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
        idToken,
      )}`;

      const response = await axios.get<GoogleTokenInfoResponse>(tokenInfoUrl);

      const allowedAudiences = getAllowedAudiences();
      if (allowedAudiences.length === 0) {
        logger.error(
          "Google audience validation is not configured (set GOOGLE_ALLOWED_AUDIENCES or GOOGLE_CLIENT_ID)",
        );
        return null;
      }

      if (!allowedAudiences.includes(response.data.aud)) {
        logger.warn("Google token audience mismatch", {
          receivedAud: response.data.aud,
          allowedAudiences,
        });
        return null;
      }

      if (
        response.data.iss !== "https://accounts.google.com" &&
        response.data.iss !== "accounts.google.com"
      ) {
        logger.warn("Google token issuer mismatch");
        return null;
      }

      const profile: GoogleUserProfile = {
        sub: response.data.sub,
        email: response.data.email,
        email_verified:
          typeof response.data.email_verified === "string"
            ? response.data.email_verified === "true"
            : response.data.email_verified,
        name: response.data.name,
        picture: response.data.picture,
        given_name: response.data.given_name,
        family_name: response.data.family_name,
      };

      logger.debug("Google profile validated", { sub: profile.sub });

      return profile;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          "Google token validation error",
          { detail: error.response?.data || error.message },
          error,
        );
      } else {
        logger.error(
          "Google token validation error",
          undefined,
          error as Error,
        );
      }
      return null;
    }
  },

  /**
   * Generate a username from Google profile
   */
  generateUsername(name: string, googleId: string): string {
    // Remove spaces and special characters, convert to lowercase
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Take first 8 characters and add last 4 digits of Google ID
    const baseUsername = cleanName.substring(0, 8);
    const idSuffix = googleId.slice(-4);

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

export default GoogleService;
