// myth-server/src/api/controllers/auth.controller.ts
import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import UserModel from "../../models/user.model";
import StarterService from "../../services/starter.service";
import SessionService from "../../services/session.service";
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
          gold: newUser.gold,
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
          gold: user.gold,
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
};

export default AuthController;
