import axios from "axios";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

interface AppleUserProfile {
  sub: string; // Apple user ID
  email?: string; // Email is optional - user might decline permission
  email_verified?: boolean;
  is_private_email?: boolean;
}

interface AppleTokenPayload {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email?: string;
  email_verified?: string | boolean;
  is_private_email?: string | boolean;
}

const AppleService = {
  /**
   * JWKS client for fetching Apple's public keys
   */
  jwksClientInstance: jwksClient({
    jwksUri: "https://appleid.apple.com/auth/keys",
    cache: true,
    cacheMaxAge: 86400000, // 24 hours
  }),

  /**
   * Get Apple's public key for token verification
   */
  async getApplePublicKey(kid: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.jwksClientInstance.getSigningKey(kid, (err: Error | null, key?: jwksClient.SigningKey) => {
        if (err) {
          reject(err);
        } else {
          const signingKey = key?.getPublicKey();
          if (signingKey) {
            resolve(signingKey);
          } else {
            reject(new Error("Unable to get signing key"));
          }
        }
      });
    });
  },

  /**
   * Validate Apple identity token and extract user profile
   */
  async validateTokenAndGetProfile(
    identityToken: string
  ): Promise<AppleUserProfile | null> {
    try {
      // Decode token header to get the key ID (kid)
      const decodedHeader = jwt.decode(identityToken, { complete: true });
      if (!decodedHeader || typeof decodedHeader === "string") {
        console.error("Invalid Apple token format");
        return null;
      }

      const kid = decodedHeader.header.kid;
      if (!kid) {
        console.error("No kid found in Apple token header");
        return null;
      }

      // Get Apple's public key
      const publicKey = await this.getApplePublicKey(kid);

      // Verify and decode the token
      const decoded = jwt.verify(identityToken, publicKey, {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
        audience: process.env.APPLE_CLIENT_ID,
      }) as AppleTokenPayload;

      // Extract user profile
      const profile: AppleUserProfile = {
        sub: decoded.sub,
        email: decoded.email,
        email_verified:
          typeof decoded.email_verified === "string"
            ? decoded.email_verified === "true"
            : decoded.email_verified,
        is_private_email:
          typeof decoded.is_private_email === "string"
            ? decoded.is_private_email === "true"
            : decoded.is_private_email,
      };

      console.log("Apple Profile:", JSON.stringify(profile, null, 2));

      return profile;
    } catch (error) {
      console.error("Apple token validation error:", error);
      return null;
    }
  },

  /**
   * Generate a username from Apple profile
   */
  generateUsername(appleId: string, email?: string): string {
    if (email && !email.includes("privaterelay.appleid.com")) {
      // Use email prefix if it's not a private relay email
      const emailPrefix = email.split("@")[0].toLowerCase();
      const cleanPrefix = emailPrefix.replace(/[^a-z0-9]/g, "");
      const idSuffix = appleId.slice(-4);
      return `${cleanPrefix.substring(0, 8)}${idSuffix}`;
    }

    // For private relay or no email, use generic prefix
    const idSuffix = appleId.slice(-8);
    return `apple${idSuffix}`;
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

export default AppleService;

