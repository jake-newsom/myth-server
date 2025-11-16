// myth-server/src/api/controllers/auth.controller.ts
import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import UserModel from "../../models/user.model";
import StarterService from "../../services/starter.service";
import SessionService from "../../services/session.service";
import FacebookService from "../../services/facebook.service";
import db from "../../config/db.config";
import { User } from "../../types/database.types";
import { AuthenticatedRequest } from "../../types/middleware.types";

// Define a more specific User type that includes password_hash
interface UserWithPassword extends User {
  password_hash: string;
}

// Type guard to check if user has password_hash
function isUserWithPassword(user: any): user is UserWithPassword {
  return user !== null && typeof user === "object" && "password_hash" in user;
}

const AuthController = {
  register: async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
      const { username, email, password } = req.body;

      // Validate input
      if (!username || !email || !password) {
        return res.status(400).json({
          error: { message: "Username, email, and password are required." },
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error: { message: "Password must be at least 6 characters long." },
        });
      }

      // Check if user already exists
      const existingUserByEmail = await UserModel.findByEmail(email);
      if (existingUserByEmail) {
        return res.status(409).json({
          error: { message: "Email already in use." },
        });
      }

      const existingUserByUsername = await UserModel.findByUsername(username);
      if (existingUserByUsername) {
        return res.status(409).json({
          error: { message: "Username already taken." },
        });
      }

      await client.query("BEGIN");

      // Create user
      const newUser = await UserModel.create({ username, email, password });

      // Grant starter content (cards and deck)
      await StarterService.grantStarterContent(newUser.user_id);

      await client.query("COMMIT");

      // Generate session and tokens
      const sessionMetadata = SessionService.extractSessionMetadata(req);
      const tokens = SessionService.generateTokenPair(newUser.user_id, ""); // sessionId will be generated
      const sessionId = await SessionService.createSession(
        newUser.user_id,
        tokens,
        sessionMetadata
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
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          error: { message: "Email and password are required." },
        });
      }

      // Find user by email
      const user = await UserModel.findByEmail(email);
      if (!user) {
        return res.status(401).json({
          error: { message: "Invalid email or password." },
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
        user.password_hash
      );
      if (!isPasswordValid) {
        return res.status(401).json({
          error: { message: "Invalid email or password." },
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
        sessionMetadata
      );

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
        session.user_id
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
    next: NextFunction
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
    next: NextFunction
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
    next: NextFunction
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
      const facebookProfile = await FacebookService.validateTokenAndGetProfile(
        accessToken
      );
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
          sessionMetadata
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
          facebookProfile.email
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
        facebookProfile.id
      );
      const uniqueUsername = await FacebookService.ensureUniqueUsername(
        baseUsername,
        async (username) => {
          const existingUser = await UserModel.findByUsername(username);
          return !!existingUser;
        }
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
        sessionMetadata
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
    next: NextFunction
  ) => {
    try {
      const { signed_request } = req.body;

      if (!signed_request) {
        return res.status(400).json({
          error: { message: "Missing signed_request parameter." },
        });
      }

      // Parse the signed request from Facebook
      const [encodedSig, payload] = signed_request.split(".");

      if (!payload) {
        return res.status(400).json({
          error: { message: "Invalid signed_request format." },
        });
      }

      // Decode the payload
      const decodedPayload = Buffer.from(payload, "base64").toString("utf8");
      const data = JSON.parse(decodedPayload);

      if (data.user_id) {
        // Find and deactivate user account or handle deauthorization
        const user = await UserModel.findByFacebookId(data.user_id);

        if (user) {
          // Log the deauthorization event
          console.log(
            `Facebook deauthorization for user: ${user.user_id} (Facebook ID: ${data.user_id})`
          );

          // Invalidate all sessions for this user
          await SessionService.invalidateAllUserSessions(user.user_id);

          // Optionally: Mark account as deauthorized or delete Facebook connection
          // You might want to add a deauthorized_at timestamp or remove facebook_id
          // This depends on your data retention policy
        }
      }

      // Facebook expects a 200 response with a confirmation URL
      res.status(200).json({
        url: `${
          process.env.CLIENT_URL || "http://localhost:3000"
        }/account-deauthorized`,
      });
    } catch (error) {
      console.error("Facebook deauthorization error:", error);
      // Still return 200 to Facebook to avoid retries
      res.status(200).json({
        url: `${
          process.env.CLIENT_URL || "http://localhost:3000"
        }/account-deauthorized`,
      });
    }
  },

  facebookDataDeletion: async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { signed_request } = req.body;

      if (!signed_request) {
        return res.status(400).json({
          error: { message: "Missing signed_request parameter." },
        });
      }

      // Parse the signed request from Facebook
      const [encodedSig, payload] = signed_request.split(".");

      if (!payload) {
        return res.status(400).json({
          error: { message: "Invalid signed_request format." },
        });
      }

      // Decode the payload
      const decodedPayload = Buffer.from(payload, "base64").toString("utf8");
      const data = JSON.parse(decodedPayload);

      if (data.user_id) {
        const user = await UserModel.findByFacebookId(data.user_id);

        if (user) {
          console.log(
            `Facebook data deletion request for user: ${user.user_id} (Facebook ID: ${data.user_id})`
          );

          // Generate a confirmation code for tracking
          const confirmationCode = `DEL_${Date.now()}_${user.user_id.slice(
            -8
          )}`;

          // Log the deletion request - you might want to store this in a separate table
          // for compliance tracking and to handle the actual deletion process

          // Return confirmation code and status URL
          return res.status(200).json({
            url: `${
              process.env.CLIENT_URL || "http://localhost:3000"
            }/data-deletion-status?code=${confirmationCode}`,
            confirmation_code: confirmationCode,
          });
        }
      }

      // Default response if user not found
      res.status(200).json({
        url: `${
          process.env.CLIENT_URL || "http://localhost:3000"
        }/data-deletion-status`,
      });
    } catch (error) {
      console.error("Facebook data deletion error:", error);
      // Still return 200 to Facebook
      res.status(200).json({
        url: `${
          process.env.CLIENT_URL || "http://localhost:3000"
        }/data-deletion-status`,
      });
    }
  },

  facebookCallback: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, state, error, error_description } = req.query;

      // Handle Facebook OAuth errors
      if (error) {
        const errorMsg = error_description || "Facebook authentication failed";
        return res.redirect(
          `${
            process.env.CLIENT_URL || "http://localhost:3000"
          }/auth/error?message=${encodeURIComponent(errorMsg as string)}`
        );
      }

      if (!code) {
        return res.redirect(
          `${
            process.env.CLIENT_URL || "http://localhost:3000"
          }/auth/error?message=${encodeURIComponent(
            "No authorization code received"
          )}`
        );
      }

      // Exchange code for access token
      const tokenUrl = "https://graph.facebook.com/v18.0/oauth/access_token";
      const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID!,
        client_secret: process.env.FACEBOOK_APP_SECRET!,
        redirect_uri: `${
          process.env.API_URL || "http://localhost:3000"
        }/api/auth/facebook/callback`,
        code: code as string,
      });

      const tokenResponse = await fetch(`${tokenUrl}?${params}`, {
        method: "GET",
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        return res.redirect(
          `${
            process.env.CLIENT_URL || "http://localhost:3000"
          }/auth/error?message=${encodeURIComponent(tokenData.error.message)}`
        );
      }

      // Use the existing Facebook auth logic
      const facebookProfile = await FacebookService.validateTokenAndGetProfile(
        tokenData.access_token
      );

      if (!facebookProfile) {
        return res.redirect(
          `${
            process.env.CLIENT_URL || "http://localhost:3000"
          }/auth/error?message=${encodeURIComponent(
            "Failed to get Facebook profile"
          )}`
        );
      }

      // Check if user exists
      let user = await UserModel.findByFacebookId(facebookProfile.id);

      if (!user) {
        // Check for existing email (only if email provided)
        if (facebookProfile.email) {
          const existingUserByEmail = await UserModel.findByEmail(
            facebookProfile.email
          );
          if (
            existingUserByEmail &&
            existingUserByEmail.auth_provider === "local"
          ) {
            return res.redirect(
              `${
                process.env.CLIENT_URL || "http://localhost:3000"
              }/auth/error?message=${encodeURIComponent(
                "Email already exists with local account"
              )}`
            );
          }
        }

        // Create new user
        const client = await db.getClient();
        try {
          await client.query("BEGIN");

          const baseUsername = FacebookService.generateUsername(
            facebookProfile.name,
            facebookProfile.id
          );
          const uniqueUsername = await FacebookService.ensureUniqueUsername(
            baseUsername,
            async (username) => {
              const existingUser = await UserModel.findByUsername(username);
              return !!existingUser;
            }
          );

          // Handle missing email from Facebook
          const userEmail =
            facebookProfile.email || `${facebookProfile.id}@facebook.local`;

          user = await UserModel.create({
            username: uniqueUsername,
            email: userEmail,
            facebook_id: facebookProfile.id,
            auth_provider: "facebook",
          });

          await StarterService.grantStarterContent(user.user_id);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }

      // Update last login
      await UserModel.updateLastLogin(user.user_id);

      // Generate session and tokens
      const sessionMetadata = SessionService.extractSessionMetadata(req);
      const tokens = SessionService.generateTokenPair(user.user_id, "");
      await SessionService.createSession(user.user_id, tokens, sessionMetadata);

      // Redirect to client with tokens (you might want to use a more secure method)
      const redirectUrl = new URL(
        `${process.env.CLIENT_URL || "http://localhost:3000"}/auth/success`
      );
      redirectUrl.searchParams.set("accessToken", tokens.accessToken);
      redirectUrl.searchParams.set("refreshToken", tokens.refreshToken);

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error("Facebook callback error:", error);
      res.redirect(
        `${
          process.env.CLIENT_URL || "http://localhost:3000"
        }/auth/error?message=${encodeURIComponent("Authentication failed")}`
      );
    }
  },

  facebookLink: async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
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
      const facebookProfile = await FacebookService.validateTokenAndGetProfile(
        accessToken
      );
      if (!facebookProfile) {
        return res.status(401).json({
          error: { message: "Invalid Facebook access token." },
        });
      }

      // Check if this Facebook account is already linked to another user
      const existingFacebookUser = await UserModel.findByFacebookId(
        facebookProfile.id
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

      // Optional: Check if Facebook email matches user email (only if Facebook provided email)
      if (
        facebookProfile.email &&
        !req.user.email.endsWith("@facebook.local") &&
        facebookProfile.email !== req.user.email
      ) {
        return res.status(409).json({
          error: {
            message: "Facebook email doesn't match your account email.",
            code: "EMAIL_MISMATCH",
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
    next: NextFunction
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
};

export default AuthController;
