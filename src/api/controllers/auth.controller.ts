// myth-server/src/api/controllers/auth.controller.ts
import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import UserModel from "../../models/user.model";
import StarterService from "../../services/starter.service";
import SessionService from "../../services/session.service";
import FacebookService from "../../services/facebook.service";
import AppleService from "../../services/apple.service";
import GoogleService from "../../services/google.service";
import db from "../../config/db.config";
import logger from "../../utils/logger";
import { User } from "../../types/database.types";
import { AuthenticatedRequest } from "../../types/middleware.types";
import { USER_LIMITS } from "../../config/constants";

// Define a more specific User type that includes password_hash
interface UserWithPassword extends User {
  password_hash: string;
}

// Type guard to check if user has password_hash
function isUserWithPassword(user: any): user is UserWithPassword {
  return user !== null && typeof user === "object" && "password_hash" in user;
}

/**
 * Verify a Facebook signed_request payload using HMAC-SHA256 with the app
 * secret. Returns the decoded payload on success, or null on any failure
 * (bad format, bad signature, JSON parse error, missing app secret).
 *
 * Reference: https://developers.facebook.com/docs/games/gamesonfacebook/login#parsingsr
 */
function verifyFacebookSignedRequest(
  signedRequest: string,
): Record<string, any> | null {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    logger.error(
      "FACEBOOK_APP_SECRET not configured; cannot verify signed_request",
    );
    return null;
  }

  if (!signedRequest || typeof signedRequest !== "string") {
    return null;
  }

  const [encodedSig, payload] = signedRequest.split(".");
  if (!encodedSig || !payload) {
    return null;
  }

  try {
    // Base64url decode the signature.
    const sig = Buffer.from(
      encodedSig.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );

    const expectedSig = crypto
      .createHmac("sha256", appSecret)
      .update(payload)
      .digest();

    if (
      sig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(sig, expectedSig)
    ) {
      logger.warn("Facebook signed_request HMAC verification failed");
      return null;
    }

    const decoded = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");

    const data = JSON.parse(decoded);
    if (!data || typeof data !== "object") {
      return null;
    }
    return data;
  } catch (error) {
    logger.warn("Failed to decode Facebook signed_request", {
      error: (error as Error).message,
    });
    return null;
  }
}

const AuthController = {
  register: async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
      const username =
        typeof req.body.username === "string" ? req.body.username.trim() : "";
      const { password } = req.body;

      // Validate input. Email is no longer collected at registration.
      if (!username || !password) {
        return res.status(400).json({
          error: { message: "Username and password are required." },
        });
      }

      if (username.length > USER_LIMITS.MAX_USERNAME_LENGTH) {
        return res.status(400).json({
          error: {
            message: `Username must be ${USER_LIMITS.MAX_USERNAME_LENGTH} characters or less.`,
          },
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error: { message: "Password must be at least 6 characters long." },
        });
      }

      // Check if username is already taken
      const existingUserByUsername = await UserModel.findByUsername(username);
      if (existingUserByUsername) {
        return res.status(409).json({
          error: { message: "Username already taken." },
        });
      }

      await client.query("BEGIN");

      // Create user (no email)
      const newUser = await UserModel.create({ username, password });

      // Grant starter content (cards and deck)
      await StarterService.grantStarterContent(newUser.user_id);

      await client.query("COMMIT");

      // Generate session and tokens
      const sessionMetadata = SessionService.extractSessionMetadata(req);
      const tokens = SessionService.generateTokenPair(newUser.user_id, ""); // sessionId will be generated
      const sessionId = await SessionService.createSession(
        newUser.user_id,
        tokens,
        sessionMetadata,
      );

      res.status(201).json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.accessTokenExpiresAt,
        user: {
          user_id: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          in_game_currency: newUser.in_game_currency,
          gems: newUser.gems,
          fate_coins: newUser.fate_coins,
          total_xp: newUser.total_xp,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },

  login: async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Accept `username` (preferred) or legacy `email` as the identifier.
      const { password } = req.body;
      const rawIdentifier = req.body.username || req.body.email;
      const identifier =
        typeof rawIdentifier === "string" ? rawIdentifier.trim() : "";

      // Validate input
      if (!identifier || !password) {
        return res.status(400).json({
          error: { message: "Username and password are required." },
        });
      }

      // Find user by username, falling back to email for legacy accounts
      const user = await UserModel.findByUsernameOrEmail(identifier);
      if (!user) {
        return res.status(401).json({
          error: { message: "Invalid username or password." },
        });
      }

      // Check if user has password_hash field
      if (!isUserWithPassword(user)) {
        return res.status(500).json({
          error: { message: "User data corrupted. Please contact support." },
        });
      }

      // Check password
      const isPasswordValid = await bcrypt.compare(
        password,
        user.password_hash,
      );
      if (!isPasswordValid) {
        return res.status(401).json({
          error: { message: "Invalid username or password." },
        });
      }

      // Update last login
      await UserModel.updateLastLogin(user.user_id);

      // Generate session and tokens
      const sessionMetadata = SessionService.extractSessionMetadata(req);
      const tokens = SessionService.generateTokenPair(user.user_id, ""); // sessionId will be generated
      const sessionId = await SessionService.createSession(
        user.user_id,
        tokens,
        sessionMetadata,
      );

      // Invalidate all previous sessions (enforce single active session)
      const invalidatedCount = await SessionService.invalidateOtherUserSessions(
        user.user_id,
        sessionId,
      );
      if (invalidatedCount > 0) {
        logger.debug("Invalidated previous sessions on login", {
          userId: user.user_id,
          invalidatedCount,
        });
      }

      res.status(200).json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.accessTokenExpiresAt,
        user: {
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          in_game_currency: user.in_game_currency,
          gems: user.gems,
          fate_coins: user.fate_coins,
          total_xp: user.total_xp,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  refresh: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          error: { message: "Refresh token is required." },
        });
      }

      // Validate refresh token
      const session = await SessionService.validateRefreshToken(refreshToken);
      if (!session) {
        return res.status(401).json({
          error: { message: "Invalid or expired refresh token." },
        });
      }

      // Rotate tokens
      const newTokens = await SessionService.rotateTokens(
        session.session_id,
        session.user_id,
      );

      res.status(200).json({
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.accessTokenExpiresAt,
      });
    } catch (error) {
      next(error);
    }
  },

  logout: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user || !req.sessionId) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Invalidate the current session
      await SessionService.invalidateSession(req.sessionId);

      res.status(200).json({
        message: "Logged out successfully.",
      });
    } catch (error) {
      next(error);
    }
  },

  logoutAll: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Invalidate all sessions for the user
      await SessionService.invalidateAllUserSessions(req.user.user_id);

      res.status(200).json({
        message: "Logged out from all devices successfully.",
      });
    } catch (error) {
      next(error);
    }
  },

  getSessions: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Get all active sessions for the user
      const sessions = await SessionService.getUserSessions(req.user.user_id);

      res.status(200).json({
        sessions: sessions.map((session) => ({
          session_id: session.session_id,
          device_type: session.device_type,
          user_agent: session.user_agent,
          ip_address: session.ip_address,
          created_at: session.created_at,
          last_used_at: session.last_used_at,
          is_current: session.session_id === req.sessionId,
        })),
      });
    } catch (error) {
      next(error);
    }
  },

  facebookAuth: async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
      const { accessToken } = req.body;

      // Validate input
      if (!accessToken) {
        return res.status(400).json({
          error: { message: "Facebook access token is required." },
        });
      }

      // Validate Facebook token and get user profile
      const facebookProfile =
        await FacebookService.validateTokenAndGetProfile(accessToken);
      if (!facebookProfile) {
        return res.status(401).json({
          error: { message: "Invalid Facebook access token." },
        });
      }

      // Check if user already exists with this Facebook ID
      let user = await UserModel.findByFacebookId(facebookProfile.id);

      if (user) {
        // User exists, log them in
        await UserModel.updateLastLogin(user.user_id);

        // Generate session and tokens
        const sessionMetadata = SessionService.extractSessionMetadata(req);
        const tokens = SessionService.generateTokenPair(user.user_id, "");
        const sessionId = await SessionService.createSession(
          user.user_id,
          tokens,
          sessionMetadata,
        );

        // Invalidate all previous sessions (enforce single active session)
        await SessionService.invalidateOtherUserSessions(
          user.user_id,
          sessionId,
        );

        return res.status(200).json({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.accessTokenExpiresAt,
          user: {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            in_game_currency: user.in_game_currency,
            gems: user.gems,
            fate_coins: user.fate_coins,
            total_xp: user.total_xp,
          },
        });
      }

      // Check if user exists with same email (link accounts) - only if email provided
      if (facebookProfile.email) {
        const existingUserByEmail = await UserModel.findByEmail(
          facebookProfile.email,
        );
        if (
          existingUserByEmail &&
          existingUserByEmail.auth_provider === "local"
        ) {
          return res.status(409).json({
            error: {
              message:
                "An account with this email already exists. Please log in with your email and password first, then link your Facebook account in settings.",
              code: "EMAIL_ALREADY_EXISTS",
            },
          });
        }
      }

      await client.query("BEGIN");

      // Create new user with Facebook authentication
      const baseUsername = FacebookService.generateUsername(
        facebookProfile.name,
        facebookProfile.id,
      );
      const uniqueUsername = await FacebookService.ensureUniqueUsername(
        baseUsername,
        async (username) => {
          const existingUser = await UserModel.findByUsername(username);
          return !!existingUser;
        },
      );

      // Handle missing email from Facebook
      const userEmail =
        facebookProfile.email || `${facebookProfile.id}@facebook.local`;

      const newUser = await UserModel.create({
        username: uniqueUsername,
        email: userEmail,
        facebook_id: facebookProfile.id,
        auth_provider: "facebook",
      });

      // Grant starter content (cards and deck)
      await StarterService.grantStarterContent(newUser.user_id);

      await client.query("COMMIT");

      // Generate session and tokens
      const sessionMetadata = SessionService.extractSessionMetadata(req);
      const tokens = SessionService.generateTokenPair(newUser.user_id, "");
      const sessionId = await SessionService.createSession(
        newUser.user_id,
        tokens,
        sessionMetadata,
      );

      res.status(201).json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.accessTokenExpiresAt,
        user: {
          user_id: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          in_game_currency: newUser.in_game_currency,
          gems: newUser.gems,
          fate_coins: newUser.fate_coins,
          total_xp: newUser.total_xp,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },

  facebookDeauthorize: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const deauthorizedUrl = `${
      process.env.CLIENT_URL || "http://localhost:3000"
    }/account-deauthorized`;

    try {
      const { signed_request } = req.body;

      if (!signed_request) {
        return res.status(400).json({
          error: { message: "Missing signed_request parameter." },
        });
      }

      // Verify the signed_request HMAC. Without this, anyone could POST a
      // forged payload here and force-deauthorize an arbitrary FB user.
      const data = verifyFacebookSignedRequest(signed_request);
      if (!data) {
        // Facebook expects a 200 to avoid retries, but we won't take action.
        return res.status(200).json({ url: deauthorizedUrl });
      }

      if (data.user_id) {
        const user = await UserModel.findByFacebookId(data.user_id);

        if (user) {
          logger.info("Facebook deauthorization processed", {
            userId: user.user_id,
          });

          await SessionService.invalidateAllUserSessions(user.user_id);

          // Note: we currently leave the facebook_id in place so the user can
          // re-link via FB. Adjust here if/when retention policy changes.
        }
      }

      res.status(200).json({ url: deauthorizedUrl });
    } catch (error) {
      logger.error(
        "Facebook deauthorization error",
        undefined,
        error as Error,
      );
      res.status(200).json({ url: deauthorizedUrl });
    }
  },

  facebookDataDeletion: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const baseStatusUrl = `${
      process.env.CLIENT_URL || "http://localhost:3000"
    }/api/auth/facebook/data-deletion-status`;

    try {
      const { signed_request } = req.body;

      if (!signed_request) {
        return res.status(400).json({
          error: { message: "Missing signed_request parameter." },
        });
      }

      const data = verifyFacebookSignedRequest(signed_request);
      if (!data) {
        // Still return 200 so Facebook doesn't retry, but mark it.
        return res.status(200).json({
          url: baseStatusUrl,
          confirmation_code: "invalid_signature",
        });
      }

      if (data.user_id) {
        const facebookUserId = data.user_id;
        const timestamp = Date.now();
        const confirmationCode = `${facebookUserId}_${timestamp}`;

        const user = await UserModel.findByFacebookId(facebookUserId);

        if (user) {
          logger.info("Facebook data deletion request received", {
            userId: user.user_id,
          });

          const client = await db.getClient();
          try {
            await client.query(
              `UPDATE "users" SET facebook_id = NULL WHERE facebook_id = $1`,
              [facebookUserId],
            );
          } finally {
            client.release();
          }

          logger.info("Facebook ID unlinked for data deletion", {
            userId: user.user_id,
          });
        } else {
          logger.debug(
            "Facebook data deletion request for unknown Facebook ID",
          );
        }

        return res.status(200).json({
          url: `${baseStatusUrl}?fb_id=${facebookUserId}&ts=${timestamp}`,
          confirmation_code: confirmationCode,
        });
      }

      res.status(200).json({
        url: baseStatusUrl,
        confirmation_code: "no_user_id",
      });
    } catch (error) {
      logger.error("Facebook data deletion error", undefined, error as Error);
      res.status(200).json({
        url: baseStatusUrl,
        confirmation_code: "error",
      });
    }
  },

  facebookDataDeletionStatus: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { fb_id, ts } = req.query;

      if (!fb_id || !ts) {
        return res.status(400).json({
          error: { message: "Missing required parameters: fb_id and ts" },
        });
      }

      const facebookId = fb_id as string;

      // Check if any user still has this facebook_id
      const user = await UserModel.findByFacebookId(facebookId);

      if (user) {
        // User still exists with this facebook_id - deletion in progress
        // This shouldn't normally happen since we delete immediately
        return res.status(200).json({
          status: "in_progress",
          message: "Data deletion in progress.",
        });
      }

      // No user has this facebook_id - deletion complete
      return res.status(200).json({
        status: "complete",
        message: "Data deletion complete.",
      });
    } catch (error) {
      logger.error(
        "Facebook data deletion status error",
        undefined,
        error as Error,
      );
      return res.status(500).json({
        error: { message: "Failed to check deletion status." },
      });
    }
  },

  facebookLink: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { accessToken } = req.body;

      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Validate input
      if (!accessToken) {
        return res.status(400).json({
          error: { message: "Facebook access token is required." },
        });
      }

      // Validate Facebook token and get user profile
      const facebookProfile =
        await FacebookService.validateTokenAndGetProfile(accessToken);
      if (!facebookProfile) {
        return res.status(401).json({
          error: { message: "Invalid Facebook access token." },
        });
      }

      // Check if this Facebook account is already linked to another user
      const existingFacebookUser = await UserModel.findByFacebookId(
        facebookProfile.id,
      );
      if (
        existingFacebookUser &&
        existingFacebookUser.user_id !== req.user.user_id
      ) {
        return res.status(409).json({
          error: {
            message: "This Facebook account is already linked to another user.",
            code: "FACEBOOK_ALREADY_LINKED",
          },
        });
      }

      // Check if current user already has a Facebook account linked
      if (req.user.facebook_id) {
        return res.status(409).json({
          error: {
            message: "Your account already has a Facebook account linked.",
            code: "FACEBOOK_ALREADY_EXISTS",
          },
        });
      }

      // Link Facebook account to current user
      const client = await db.getClient();
      try {
        await client.query("BEGIN");

        const updateQuery = `
          UPDATE "users" 
          SET facebook_id = $1
          WHERE user_id = $2
          RETURNING user_id, username, email, facebook_id, auth_provider, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login as last_login_at;
        `;

        const { rows } = await client.query(updateQuery, [
          facebookProfile.id,
          req.user.user_id,
        ]);

        await client.query("COMMIT");

        const updatedUser = rows[0];

        res.status(200).json({
          message: "Facebook account linked successfully",
          user: {
            user_id: updatedUser.user_id,
            username: updatedUser.username,
            email: updatedUser.email,
            facebook_id: updatedUser.facebook_id,
            auth_provider: updatedUser.auth_provider,
            in_game_currency: updatedUser.in_game_currency,
            gems: updatedUser.gems,
            fate_coins: updatedUser.fate_coins,
            total_xp: updatedUser.total_xp,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  },

  facebookUnlink: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Check if user has Facebook account linked
      if (!req.user.facebook_id) {
        return res.status(400).json({
          error: { message: "No Facebook account is currently linked." },
        });
      }

      // Check if Facebook is the primary authentication method
      // If user has no password and Facebook is their only auth method, don't allow unlinking
      if (req.user.auth_provider === "facebook" && !req.user.password_hash) {
        return res.status(400).json({
          error: {
            message:
              "Cannot unlink Facebook account as it's your primary authentication method. Please set a password first.",
            code: "PRIMARY_AUTH_METHOD",
          },
        });
      }

      // Unlink Facebook account
      const client = await db.getClient();
      try {
        await client.query("BEGIN");

        const updateQuery = `
          UPDATE "users" 
          SET facebook_id = NULL
          WHERE user_id = $1
          RETURNING user_id, username, email, facebook_id, auth_provider, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login as last_login_at;
        `;

        const { rows } = await client.query(updateQuery, [req.user.user_id]);

        await client.query("COMMIT");

        const updatedUser = rows[0];

        res.status(200).json({
          message: "Facebook account unlinked successfully",
          user: {
            user_id: updatedUser.user_id,
            username: updatedUser.username,
            email: updatedUser.email,
            facebook_id: updatedUser.facebook_id,
            auth_provider: updatedUser.auth_provider,
            in_game_currency: updatedUser.in_game_currency,
            gems: updatedUser.gems,
            fate_coins: updatedUser.fate_coins,
            total_xp: updatedUser.total_xp,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  },

  appleAuth: async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
      const { identityToken, user: appleUser } = req.body;

      // Validate input
      if (!identityToken) {
        return res.status(400).json({
          error: { message: "Apple identity token is required." },
        });
      }

      // Validate Apple token and get user profile
      const appleProfile =
        await AppleService.validateTokenAndGetProfile(identityToken);
      if (!appleProfile) {
        return res.status(401).json({
          error: { message: "Invalid Apple identity token." },
        });
      }

      // Check if user already exists with this Apple ID
      let user = await UserModel.findByAppleId(appleProfile.sub);

      if (user) {
        // User exists, log them in
        await UserModel.updateLastLogin(user.user_id);

        // Generate session and tokens
        const sessionMetadata = SessionService.extractSessionMetadata(req);
        const tokens = SessionService.generateTokenPair(user.user_id, "");
        const sessionId = await SessionService.createSession(
          user.user_id,
          tokens,
          sessionMetadata,
        );

        // Invalidate all previous sessions (enforce single active session)
        await SessionService.invalidateOtherUserSessions(
          user.user_id,
          sessionId,
        );

        return res.status(200).json({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.accessTokenExpiresAt,
          user: {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            in_game_currency: user.in_game_currency,
            gems: user.gems,
            fate_coins: user.fate_coins,
            total_xp: user.total_xp,
          },
        });
      }

      await client.query("BEGIN");

      // Create new user with Apple authentication
      // Apple may provide user info on first sign-in only
      const userName = appleUser?.name
        ? `${appleUser.name.firstName || ""} ${
            appleUser.name.lastName || ""
          }`.trim()
        : undefined;

      const baseUsername = AppleService.generateUsername(
        appleProfile.sub,
        appleProfile.email,
      );
      const uniqueUsername = await AppleService.ensureUniqueUsername(
        baseUsername,
        async (username) => {
          const existingUser = await UserModel.findByUsername(username);
          return !!existingUser;
        },
      );

      // Handle missing email from Apple
      const userEmail =
        appleProfile.email || `${appleProfile.sub}@appleid.local`;

      const newUser = await UserModel.create({
        username: uniqueUsername,
        email: userEmail,
        apple_id: appleProfile.sub,
        auth_provider: "apple",
      });

      // Grant starter content (cards and deck)
      await StarterService.grantStarterContent(newUser.user_id);

      await client.query("COMMIT");

      // Generate session and tokens
      const sessionMetadata = SessionService.extractSessionMetadata(req);
      const tokens = SessionService.generateTokenPair(newUser.user_id, "");
      const sessionId = await SessionService.createSession(
        newUser.user_id,
        tokens,
        sessionMetadata,
      );

      res.status(201).json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.accessTokenExpiresAt,
        user: {
          user_id: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          in_game_currency: newUser.in_game_currency,
          gems: newUser.gems,
          fate_coins: newUser.fate_coins,
          total_xp: newUser.total_xp,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },

  appleLink: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { identityToken } = req.body;

      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Validate input
      if (!identityToken) {
        return res.status(400).json({
          error: { message: "Apple identity token is required." },
        });
      }

      // Validate Apple token and get user profile
      const appleProfile =
        await AppleService.validateTokenAndGetProfile(identityToken);
      if (!appleProfile) {
        return res.status(401).json({
          error: { message: "Invalid Apple identity token." },
        });
      }

      // Check if this Apple account is already linked to another user
      const existingAppleUser = await UserModel.findByAppleId(appleProfile.sub);
      if (existingAppleUser && existingAppleUser.user_id !== req.user.user_id) {
        return res.status(409).json({
          error: {
            message: "This Apple account is already linked to another user.",
            code: "APPLE_ALREADY_LINKED",
          },
        });
      }

      // Check if current user already has an Apple account linked
      if (req.user.apple_id) {
        return res.status(409).json({
          error: {
            message: "Your account already has an Apple account linked.",
            code: "APPLE_ALREADY_EXISTS",
          },
        });
      }

      // Link Apple account to current user
      const client = await db.getClient();
      try {
        await client.query("BEGIN");

        const updateQuery = `
          UPDATE "users" 
          SET apple_id = $1
          WHERE user_id = $2
          RETURNING user_id, username, email, apple_id, auth_provider, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login as last_login_at;
        `;

        const { rows } = await client.query(updateQuery, [
          appleProfile.sub,
          req.user.user_id,
        ]);

        await client.query("COMMIT");

        const updatedUser = rows[0];

        res.status(200).json({
          message: "Apple account linked successfully",
          user: {
            user_id: updatedUser.user_id,
            username: updatedUser.username,
            email: updatedUser.email,
            apple_id: updatedUser.apple_id,
            auth_provider: updatedUser.auth_provider,
            in_game_currency: updatedUser.in_game_currency,
            gems: updatedUser.gems,
            fate_coins: updatedUser.fate_coins,
            total_xp: updatedUser.total_xp,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  },

  appleUnlink: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Check if user has Apple account linked
      if (!req.user.apple_id) {
        return res.status(400).json({
          error: { message: "No Apple account is currently linked." },
        });
      }

      // Check if Apple is the primary authentication method
      // If user has no password and Apple is their only auth method, don't allow unlinking
      if (req.user.auth_provider === "apple" && !req.user.password_hash) {
        return res.status(400).json({
          error: {
            message:
              "Cannot unlink Apple account as it's your primary authentication method. Please set a password first.",
            code: "PRIMARY_AUTH_METHOD",
          },
        });
      }

      // Unlink Apple account
      const client = await db.getClient();
      try {
        await client.query("BEGIN");

        const updateQuery = `
          UPDATE "users" 
          SET apple_id = NULL
          WHERE user_id = $1
          RETURNING user_id, username, email, apple_id, auth_provider, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login as last_login_at;
        `;

        const { rows } = await client.query(updateQuery, [req.user.user_id]);

        await client.query("COMMIT");

        const updatedUser = rows[0];

        res.status(200).json({
          message: "Apple account unlinked successfully",
          user: {
            user_id: updatedUser.user_id,
            username: updatedUser.username,
            email: updatedUser.email,
            apple_id: updatedUser.apple_id,
            auth_provider: updatedUser.auth_provider,
            in_game_currency: updatedUser.in_game_currency,
            gems: updatedUser.gems,
            fate_coins: updatedUser.fate_coins,
            total_xp: updatedUser.total_xp,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  },

  googleAuth: async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
      const { idToken } = req.body;

      // Validate input
      if (!idToken) {
        return res.status(400).json({
          error: { message: "Google ID token is required." },
        });
      }

      // Validate Google token and get user profile
      const googleProfile =
        await GoogleService.validateTokenAndGetProfile(idToken);
      if (!googleProfile) {
        return res.status(401).json({
          error: { message: "Invalid Google ID token." },
        });
      }

      // Check if user already exists with this Google ID
      let user = await UserModel.findByGoogleId(googleProfile.sub);

      if (user) {
        // User exists, log them in
        await UserModel.updateLastLogin(user.user_id);

        // Generate session and tokens
        const sessionMetadata = SessionService.extractSessionMetadata(req);
        const tokens = SessionService.generateTokenPair(user.user_id, "");
        const sessionId = await SessionService.createSession(
          user.user_id,
          tokens,
          sessionMetadata,
        );

        // Invalidate all previous sessions (enforce single active session)
        await SessionService.invalidateOtherUserSessions(
          user.user_id,
          sessionId,
        );

        return res.status(200).json({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.accessTokenExpiresAt,
          user: {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            in_game_currency: user.in_game_currency,
            gems: user.gems,
            fate_coins: user.fate_coins,
            total_xp: user.total_xp,
          },
        });
      }

      await client.query("BEGIN");

      // Create new user with Google authentication
      const baseUsername = GoogleService.generateUsername(
        googleProfile.name || googleProfile.email || "user",
        googleProfile.sub,
      );
      const uniqueUsername = await GoogleService.ensureUniqueUsername(
        baseUsername,
        async (username) => {
          const existingUser = await UserModel.findByUsername(username);
          return !!existingUser;
        },
      );

      // Handle missing email from Google
      const userEmail =
        googleProfile.email || `${googleProfile.sub}@google.local`;

      const newUser = await UserModel.create({
        username: uniqueUsername,
        email: userEmail,
        google_id: googleProfile.sub,
        auth_provider: "google",
      });

      // Grant starter content (cards and deck)
      await StarterService.grantStarterContent(newUser.user_id);

      await client.query("COMMIT");

      // Generate session and tokens
      const sessionMetadata = SessionService.extractSessionMetadata(req);
      const tokens = SessionService.generateTokenPair(newUser.user_id, "");
      const sessionId = await SessionService.createSession(
        newUser.user_id,
        tokens,
        sessionMetadata,
      );

      res.status(201).json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.accessTokenExpiresAt,
        user: {
          user_id: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          in_game_currency: newUser.in_game_currency,
          gems: newUser.gems,
          fate_coins: newUser.fate_coins,
          total_xp: newUser.total_xp,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },

  googleLink: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { idToken } = req.body;

      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Validate input
      if (!idToken) {
        return res.status(400).json({
          error: { message: "Google ID token is required." },
        });
      }

      // Validate Google token and get user profile
      const googleProfile =
        await GoogleService.validateTokenAndGetProfile(idToken);
      if (!googleProfile) {
        return res.status(401).json({
          error: { message: "Invalid Google ID token." },
        });
      }

      // Check if this Google account is already linked to another user
      const existingGoogleUser = await UserModel.findByGoogleId(
        googleProfile.sub,
      );
      if (
        existingGoogleUser &&
        existingGoogleUser.user_id !== req.user.user_id
      ) {
        return res.status(409).json({
          error: {
            message: "This Google account is already linked to another user.",
            code: "GOOGLE_ALREADY_LINKED",
          },
        });
      }

      // Check if current user already has a Google account linked
      if (req.user.google_id) {
        return res.status(409).json({
          error: {
            message: "Your account already has a Google account linked.",
            code: "GOOGLE_ALREADY_EXISTS",
          },
        });
      }

      // Link Google account to current user
      const client = await db.getClient();
      try {
        await client.query("BEGIN");

        const updateQuery = `
          UPDATE "users" 
          SET google_id = $1
          WHERE user_id = $2
          RETURNING user_id, username, email, google_id, auth_provider, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login as last_login_at;
        `;

        const { rows } = await client.query(updateQuery, [
          googleProfile.sub,
          req.user.user_id,
        ]);

        await client.query("COMMIT");

        const updatedUser = rows[0];

        res.status(200).json({
          message: "Google account linked successfully",
          user: {
            user_id: updatedUser.user_id,
            username: updatedUser.username,
            email: updatedUser.email,
            google_id: updatedUser.google_id,
            auth_provider: updatedUser.auth_provider,
            in_game_currency: updatedUser.in_game_currency,
            gems: updatedUser.gems,
            fate_coins: updatedUser.fate_coins,
            total_xp: updatedUser.total_xp,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  },

  googleUnlink: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: { message: "Not authenticated." },
        });
      }

      // Check if user has Google account linked
      if (!req.user.google_id) {
        return res.status(400).json({
          error: { message: "No Google account is currently linked." },
        });
      }

      // Check if Google is the primary authentication method
      // If user has no password and Google is their only auth method, don't allow unlinking
      if (req.user.auth_provider === "google" && !req.user.password_hash) {
        return res.status(400).json({
          error: {
            message:
              "Cannot unlink Google account as it's your primary authentication method. Please set a password first.",
            code: "PRIMARY_AUTH_METHOD",
          },
        });
      }

      // Unlink Google account
      const client = await db.getClient();
      try {
        await client.query("BEGIN");

        const updateQuery = `
          UPDATE "users" 
          SET google_id = NULL
          WHERE user_id = $1
          RETURNING user_id, username, email, google_id, auth_provider, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login as last_login_at;
        `;

        const { rows } = await client.query(updateQuery, [req.user.user_id]);

        await client.query("COMMIT");

        const updatedUser = rows[0];

        res.status(200).json({
          message: "Google account unlinked successfully",
          user: {
            user_id: updatedUser.user_id,
            username: updatedUser.username,
            email: updatedUser.email,
            google_id: updatedUser.google_id,
            auth_provider: updatedUser.auth_provider,
            in_game_currency: updatedUser.in_game_currency,
            gems: updatedUser.gems,
            fate_coins: updatedUser.fate_coins,
            total_xp: updatedUser.total_xp,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  },
};

export default AuthController;
