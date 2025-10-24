import crypto from "crypto";
import jwt from "jsonwebtoken";
import db from "../config/db.config";
import config from "../config";
import { Request } from "express";

export interface SessionData {
  session_id: string;
  user_id: string;
  access_token_hash: string;
  refresh_token_hash: string;
  access_token_expires_at: Date;
  refresh_token_expires_at: Date;
  device_type?: string;
  user_agent?: string;
  ip_address?: string;
  created_at: Date;
  last_used_at: Date;
  is_active: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface SessionMetadata {
  deviceType?: string;
  userAgent?: string;
  ipAddress?: string;
}

class SessionService {
  private readonly ACCESS_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes in milliseconds
  private readonly REFRESH_TOKEN_EXPIRY = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds
  private readonly JWT_SECRET =
    config.jwtSecret || "fallback_dev_secret_do_not_use_in_production";

  /**
   * Generate a cryptographically secure random token
   */
  private generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Hash a token using SHA-256
   */
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Generate JWT access token with user ID and session ID
   */
  private generateAccessToken(userId: string, sessionId: string): string {
    return jwt.sign(
      {
        userId,
        sessionId,
        type: "access",
      },
      this.JWT_SECRET,
      { expiresIn: "15m" }
    );
  }

  /**
   * Generate a pair of access and refresh tokens
   */
  generateTokenPair(userId: string, sessionId?: string): TokenPair {
    const now = new Date();
    const actualSessionId = sessionId || crypto.randomUUID();
    const accessToken = this.generateAccessToken(userId, actualSessionId);
    const refreshToken = this.generateToken();

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(now.getTime() + this.ACCESS_TOKEN_EXPIRY),
      refreshTokenExpiresAt: new Date(
        now.getTime() + this.REFRESH_TOKEN_EXPIRY
      ),
    };
  }

  /**
   * Extract device information from request headers
   */
  extractSessionMetadata(req: Request): SessionMetadata {
    const userAgent = req.get("User-Agent");
    const ipAddress =
      req.ip || req.connection.remoteAddress || req.socket.remoteAddress;

    // Simple device type detection based on user agent
    let deviceType = "unknown";
    if (userAgent) {
      if (/Mobile|Android|iPhone|iPad/.test(userAgent)) {
        deviceType = "mobile";
      } else if (/Tablet|iPad/.test(userAgent)) {
        deviceType = "tablet";
      } else {
        deviceType = "desktop";
      }
    }

    return {
      deviceType,
      userAgent: userAgent?.substring(0, 500), // Limit length
      ipAddress,
    };
  }

  /**
   * Create a new session in the database
   */
  async createSession(
    userId: string,
    tokens: TokenPair,
    metadata: SessionMetadata
  ): Promise<string> {
    const client = await db.getClient();
    try {
      const sessionId = crypto.randomUUID();

      const query = `
        INSERT INTO user_sessions (
          session_id, user_id, access_token_hash, refresh_token_hash,
          access_token_expires_at, refresh_token_expires_at,
          device_type, user_agent, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING session_id
      `;

      const values = [
        sessionId,
        userId,
        this.hashToken(tokens.accessToken),
        this.hashToken(tokens.refreshToken),
        tokens.accessTokenExpiresAt,
        tokens.refreshTokenExpiresAt,
        metadata.deviceType,
        metadata.userAgent,
        metadata.ipAddress,
      ];

      const result = await client.query(query, values);
      return result.rows[0].session_id;
    } finally {
      client.release();
    }
  }

  /**
   * Validate an access token and return session data
   */
  async validateAccessToken(token: string): Promise<SessionData | null> {
    try {
      // First verify JWT structure and extract payload
      const decoded = jwt.verify(token, this.JWT_SECRET) as any;
      if (
        !decoded ||
        !decoded.userId ||
        !decoded.sessionId ||
        decoded.type !== "access"
      ) {
        return null;
      }

      // Then check if session exists in database and is valid
      const client = await db.getClient();
      try {
        const query = `
          SELECT * FROM user_sessions 
          WHERE session_id = $1 
            AND access_token_hash = $2 
            AND access_token_expires_at > NOW() 
            AND is_active = true
        `;

        const result = await client.query(query, [
          decoded.sessionId,
          this.hashToken(token),
        ]);

        if (result.rows.length === 0) {
          return null;
        }

        return result.rows[0] as SessionData;
      } finally {
        client.release();
      }
    } catch (error) {
      // JWT verification failed or database error
      return null;
    }
  }

  /**
   * Validate a refresh token and return session data
   */
  async validateRefreshToken(token: string): Promise<SessionData | null> {
    const client = await db.getClient();
    try {
      const query = `
        SELECT * FROM user_sessions 
        WHERE refresh_token_hash = $1 
          AND refresh_token_expires_at > NOW() 
          AND is_active = true
      `;

      const result = await client.query(query, [this.hashToken(token)]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0] as SessionData;
    } finally {
      client.release();
    }
  }

  /**
   * Rotate tokens for a session (generate new tokens and update database)
   */
  async rotateTokens(sessionId: string, userId: string): Promise<TokenPair> {
    const client = await db.getClient();
    try {
      const tokens = this.generateTokenPair(userId, sessionId);

      const query = `
        UPDATE user_sessions 
        SET access_token_hash = $1,
            refresh_token_hash = $2,
            access_token_expires_at = $3,
            refresh_token_expires_at = $4,
            last_used_at = NOW()
        WHERE session_id = $5 AND is_active = true
        RETURNING session_id
      `;

      const values = [
        this.hashToken(tokens.accessToken),
        this.hashToken(tokens.refreshToken),
        tokens.accessTokenExpiresAt,
        tokens.refreshTokenExpiresAt,
        sessionId,
      ];

      const result = await client.query(query, values);

      if (result.rows.length === 0) {
        throw new Error("Session not found or inactive");
      }

      return tokens;
    } finally {
      client.release();
    }
  }

  /**
   * Update last used timestamp for a session
   */
  async updateLastUsed(sessionId: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query(
        "UPDATE user_sessions SET last_used_at = NOW() WHERE session_id = $1",
        [sessionId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Invalidate a specific session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query(
        "UPDATE user_sessions SET is_active = false WHERE session_id = $1",
        [sessionId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Invalidate all sessions for a user
   */
  async invalidateAllUserSessions(userId: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query(
        "UPDATE user_sessions SET is_active = false WHERE user_id = $1",
        [userId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Clean up expired sessions (should be run periodically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const client = await db.getClient();
    try {
      const result = await client.query(`
        DELETE FROM user_sessions 
        WHERE refresh_token_expires_at < NOW() 
           OR (is_active = false AND last_used_at < NOW() - INTERVAL '7 days')
      `);

      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<SessionData[]> {
    const client = await db.getClient();
    try {
      const result = await client.query(
        `
        SELECT session_id, user_id, device_type, user_agent, ip_address,
               created_at, last_used_at, access_token_expires_at, refresh_token_expires_at
        FROM user_sessions 
        WHERE user_id = $1 AND is_active = true
        ORDER BY last_used_at DESC
      `,
        [userId]
      );

      return result.rows as SessionData[];
    } finally {
      client.release();
    }
  }
}

export default new SessionService();
